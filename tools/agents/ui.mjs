// Local control panel for the containerised CLI agents.
//
//   node ui.mjs        then open http://localhost:7391
//
// This has to run on your machine, not as a hosted page: every action here
// shells out to docker. No dependencies - Node's stdlib only.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 7391);
// agents.json is the single source of truth for who is in play, so disabling one
// is a config change rather than an edit here and in five other files.
const CONFIG = JSON.parse(readFileSync(path.join(HERE, 'agents.json'), 'utf8'));
const AGENTS = CONFIG.enabled;
const DISABLED = CONFIG.disabled || {};

const image = (a) => (a === 'codex' ? 'stride-agent-codex-official' : `stride-agent-${a}`);

// Gemini's credential store cannot be read in a container other than the one
// that wrote it, and docker takes the hostname from the random container ID
// unless told otherwise. --name does NOT set the hostname; only --hostname does.
const baseArgs = (a) => {
  const d = ['run', '--rm', '-v', `agent-${a}-home:/home/agent`];
  if (a === 'gemini') d.push('--hostname', 'stride-agent-gemini');
  return d;
};

function docker(args, { timeoutMs = 600000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn('docker', args, { windowsHide: true });
    let out = '';
    const cap = (b) => { out += b.toString(); if (out.length > 400000) out = out.slice(-400000); };
    p.stdout.on('data', cap);
    p.stderr.on('data', cap);
    const timer = setTimeout(() => { try { p.kill(); } catch {} }, timeoutMs);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: String(e) }); });
  });
}

// ------------------------------------------------------------------ status --
async function checkAgent(a) {
  const d = [...baseArgs(a), image(a)];

  if (a === 'claude') {
    const { out } = await docker([...d, 'claude', 'auth', 'status'], { timeoutMs: 90000 });
    if (/"loggedIn":\s*true/.test(out)) {
      const plan = out.match(/"subscriptionType":\s*"([^"]+)"/)?.[1] ?? 'subscription';
      const email = out.match(/"email":\s*"([^"]+)"/)?.[1] ?? '';
      return { ready: true, detail: `Claude ${plan}`, extra: email };
    }
    return { ready: false, detail: 'not signed in' };
  }

  if (a === 'codex') {
    const { out } = await docker([...d, 'codex', 'login', 'status'], { timeoutMs: 90000 });
    if (/Logged in/i.test(out)) return { ready: true, detail: 'ChatGPT sign-in', extra: '' };
    return { ready: false, detail: 'not signed in' };
  }

  // Gemini has no status command, and a credential file on disk proves nothing:
  // we have seen files that exist but cannot be decrypted. So actually ask it.
  const { out } = await docker([...d, 'gemini', '--prompt', 'reply with the single word OK'], { timeoutMs: 120000 });
  if (/Corrupted credentials/i.test(out)) return { ready: false, detail: 'credentials unreadable' };
  if (/Auth method|GEMINI_API_KEY/i.test(out)) return { ready: false, detail: 'not signed in' };
  if (/\bOK\b/.test(out)) return { ready: true, detail: 'Google sign-in', extra: '' };
  return { ready: false, detail: 'no response' };
}

// -------------------------------------------------------------------- jobs --
const jobs = new Map();
let jobSeq = 0;

const TASK_PROMPT =
  'Read TASK.md in the current directory and implement exactly what it asks. Create roman.js. ' +
  'Then run `node verify.js` and keep fixing roman.js until it prints RESULT: PASS. ' +
  'Do not edit TASK.md or verify.js.';

function startJob(agents, prompt, graded) {
  const id = String(++jobSeq);
  const job = {
    id, done: false,
    items: agents.map((a) => ({ agent: a, state: 'queued', verdict: '', seconds: 0, log: '', folder: '' })),
  };
  jobs.set(id, job);

  (async () => {
    // Must not end in '.' - Win32 silently strips trailing dots from directory
    // names, so the folder you create is not the folder you can later list.
    // Matches the yyyyMMdd-HHmmss that agents.ps1 uses.
    const t = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}`;
    for (const item of job.items) {
      const a = item.agent;
      const run = path.join(HERE, 'runs', a, stamp);
      mkdirSync(run, { recursive: true });
      item.folder = run;
      if (graded) {
        copyFileSync(path.join(HERE, 'workspace', 'TASK.md'), path.join(run, 'TASK.md'));
        copyFileSync(path.join(HERE, 'workspace', 'verify.js'), path.join(run, 'verify.js'));
      }

      const cmd = {
        claude: ['claude', '--print', '--permission-mode', 'bypassPermissions', prompt],
        codex: ['codex', 'exec', '--dangerously-bypass-approvals-and-sandbox', prompt],
        gemini: ['gemini', '--yolo', '--prompt', prompt],
      }[a];

      item.state = 'running';
      const t0 = Date.now();
      const { out } = await docker([...baseArgs(a), '-v', `${run}:/work`, '-w', '/work', image(a), ...cmd]);
      item.seconds = Math.round((Date.now() - t0) / 1000);
      item.log = out;
      writeFileSync(path.join(run, 'agent-output.txt'), out);

      if (graded) {
        if (existsSync(path.join(run, 'roman.js'))) {
          // Grade in a clean node image, never in the agent's own container:
          // an agent must not be able to mark its own homework.
          const g = await docker(['run', '--rm', '-v', `${run}:/work`, '-w', '/work', 'node:24-slim', 'node', 'verify.js']);
          const m = g.out.match(/(\d+) passed, (\d+) failed/);
          item.verdict = /RESULT:\s*PASS/.test(g.out) ? 'PASS' : m ? `FAIL (${m[2]} failed)` : 'FAIL';
          item.gradeLog = g.out;
        } else {
          item.verdict = 'no file produced';
        }
      } else {
        item.verdict = 'done';
      }
      item.state = 'finished';
    }
    job.done = true;
  })();

  return id;
}

// ------------------------------------------------------------------- login --
// Claude's login ends at a "Paste code here" prompt and a container TTY on
// Windows cannot receive a paste, so it runs detached with stdin on a fifo and
// the code is delivered from out here. Codex and Gemini need a real terminal
// (Gemini's TUI only redraws when driven through a pipe), so for those we open
// one for the user rather than pretending we can do it in the browser.
const CLAUDE_HELPER = 'claude-login';

function stripAnsi(s) {
  return s
    .replace(/\]8;;[^]*(|\\)/g, '')
    .replace(/\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\r/g, '');
}

async function claudeLoginStart() {
  await docker(['rm', '-f', CLAUDE_HELPER], { timeoutMs: 60000 });
  const init = path.join(HERE, 'login-init.sh');
  if (!existsSync(init)) return { error: 'login-init.sh is missing' };

  await docker(['run', '-d', '--name', CLAUDE_HELPER,
    '-v', 'agent-claude-home:/home/agent',
    '-v', `${init}:/init.sh:ro`,
    image('claude'), 'bash', '/init.sh'], { timeoutMs: 120000 });

  await docker(['exec', CLAUDE_HELPER, 'bash', '-lc',
    'for i in $(seq 1 40); do grep -q https:// /tmp/out 2>/dev/null && break; sleep 1; done'], { timeoutMs: 120000 });

  const { out } = await docker(['exec', CLAUDE_HELPER, 'bash', '-lc', 'cat /tmp/out 2>/dev/null']);
  const clean = stripAnsi(out);
  let url = clean.match(/https:\/\/claude\.com\/cai\/oauth\/authorize\?\S+/)?.[0];
  if (!url) return { error: 'no sign-in URL appeared', raw: clean.slice(0, 2000) };
  // The hyperlink target and the visible text are concatenated; keep the first.
  const second = url.indexOf('https://', 8);
  if (second > 0) url = url.slice(0, second);
  return { url };
}

async function claudeLoginCode(code) {
  const clean = String(code || '').trim();
  if (!clean) return { error: 'no code given' };
  // Single-quote for the shell so '#' in code#state is not read as a comment.
  const safe = clean.replace(/'/g, `'\\''`);
  await docker(['exec', CLAUDE_HELPER, 'bash', '-lc', `printf '%s\\n' '${safe}' > /tmp/in`], { timeoutMs: 120000 });
  await docker(['exec', CLAUDE_HELPER, 'bash', '-lc',
    `for i in $(seq 1 30); do grep -qEi 'logged in|success|error|invalid|expired|EXITCODE' /tmp/out 2>/dev/null && break; sleep 1; done`], { timeoutMs: 120000 });
  const status = await checkAgent('claude');
  await docker(['rm', '-f', CLAUDE_HELPER], { timeoutMs: 60000 });
  return { ok: status.ready, status };
}

function openTerminalLogin(agent) {
  // A login shell left running keeps holding the OAuth callback ports, and the
  // next attempt then fails with "port is already allocated" - which names the
  // port but not the container. login.cmd reclaims it by a fixed name.
  const script = path.join(HERE, 'login.cmd');
  if (!existsSync(script)) return { error: 'login.cmd is missing' };
  const child = spawn('cmd.exe', ['/c', 'start', '', script, agent], { detached: true, stdio: 'ignore' });
  child.unref();
  return { opened: true };
}

// ------------------------------------------------------------------ server --
function send(res, code, body, type = 'application/json') {
  const data = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, readFileSync(path.join(HERE, 'ui.html'), 'utf8'), 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/api/agents') {
      return send(res, 200, { enabled: AGENTS, disabled: DISABLED });
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      const one = url.searchParams.get('agent');
      const list = one ? [one] : AGENTS;
      const entries = await Promise.all(list.map(async (a) => [a, await checkAgent(a)]));
      return send(res, 200, Object.fromEntries(entries));
    }

    if (req.method === 'POST' && url.pathname === '/api/job') {
      const { agents, prompt, graded } = await readBody(req);
      const list = (agents || []).filter((a) => AGENTS.includes(a));
      if (!list.length) return send(res, 400, { error: 'no agents given' });
      const id = startJob(list, graded ? TASK_PROMPT : String(prompt || '').trim(), !!graded);
      return send(res, 200, { id });
    }

    if (req.method === 'GET' && url.pathname === '/api/job') {
      const job = jobs.get(url.searchParams.get('id'));
      if (!job) return send(res, 404, { error: 'unknown job' });
      return send(res, 200, job);
    }

    if (req.method === 'POST' && url.pathname === '/api/login/start') {
      const { agent } = await readBody(req);
      if (agent === 'claude') return send(res, 200, await claudeLoginStart());
      if (agent === 'codex' || agent === 'gemini') return send(res, 200, openTerminalLogin(agent));
      return send(res, 400, { error: 'unknown agent' });
    }

    if (req.method === 'POST' && url.pathname === '/api/login/code') {
      const { code } = await readBody(req);
      return send(res, 200, await claudeLoginCode(code));
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: String(e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Agent control panel:  http://localhost:${PORT}\n  (Ctrl+C to stop)\n`);
});

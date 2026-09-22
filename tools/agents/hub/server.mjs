// Shared context hub for the containerised CLI agents.
//
//   node server.mjs         then open http://localhost:7400
//
// Agents connect over MCP (all three CLIs speak it natively over HTTP).
// The browser gets live updates over SSE. See DESIGN.md for why those two and
// not a websocket to the agents.

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { Store } from './db.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 7400);
const PROJECT = process.env.PROJECT || 'default';

const store = new Store(path.join(HERE, 'data', 'hub.db'));

// Which agents are actually in play. Read per call rather than cached, so
// editing agents.json takes effect without restarting the hub. A disabled agent
// keeps its history in the log - it just stops being reported as an available
// peer, so no agent waits on one that will never answer.
function roster() {
  try {
    const cfg = JSON.parse(readFileSync(path.join(HERE, '..', 'agents.json'), 'utf8'));
    return cfg.roster && typeof cfg.roster === 'object' ? cfg.roster : null;
  } catch { return null; }
}
function enabledAgents() {
  const r = roster();
  return r ? Object.keys(r) : null;
}

// agents.json is authoritative for who exists and what they may do, so the hub
// takes its roster from there on boot. Tokens are preserved: registerAgent
// returns the existing one for a known name.
for (const [name, m] of Object.entries(roster() ?? {})) {
  store.registerAgent({
    name, projectId: PROJECT, model: m.model, runtime: m.runtime,
    role: m.role, approvalMode: m.approval_mode,
  });
}

// ---------------------------------------------------------------- MCP tools --
// Every tool returns head_sequence so an agent can tell its view is stale
// without a separate round trip.
function buildServer(agent) {
  const server = new McpServer({ name: 'stride-context', version: '1.0.0' });
  const project = agent.project_id;

  // A read that does not record itself cannot later prove what the agent knew.
  const observed = (fn) => () => {
    const value = fn();
    const seen = value && typeof value === 'object' && 'head_sequence' in value ? value.head_sequence : null;
    if (seen !== null) store.observe(agent.name, seen);
    return value;
  };

  const run = (fn) => {
    try {
      const value = fn();
      return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: { result: value } };
    } catch (e) {
      // Conflicts are expected under concurrency and must be actionable, not
      // opaque: tell the agent what the current state is so it can retry.
      const detail = e.conflict ? ` current=${JSON.stringify(e.conflict)}` : '';
      return { isError: true, content: [{ type: 'text', text: `${e.message}${detail}` }] };
    }
  };

  // NOT named whoami: that collides with the Unix command of the same name, and
  // an agent with shell access will run `whoami` and get the container user
  // ('agent') instead of calling this tool. Observed in a real run.
  server.registerTool('agent_identity',
    { description: 'Which agent you are, on what model, and under what approval mode, plus the other agents currently active. The hub decides this from your token; you cannot claim to be another agent. Do NOT use the shell whoami command for this - it returns the container user, not your agent identity.',
      inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true } },
    () => run(() => ({
      agent: agent.name, project: project, model: agent.model, role: agent.role,
      approval_mode: agent.approval_mode, head_sequence: store.headSequence(project),
      can_assign_work: agent.role === 'manager',
      teammates: (() => {
        const on = enabledAgents();
        const cfg = roster() ?? {};
        return store.listAgents()
          .filter((a) => a.name !== agent.name && (!on || on.includes(a.name)))
          .map((a) => ({ name: a.name, role: a.role, model: a.model, purpose: cfg[a.name]?.purpose ?? null, last_seen_at: a.last_seen_at }));
      })(),
    })));

  server.registerTool('context_head',
    { description: 'The approved shared context for this project: requirements, decisions and constraints every agent must work from. Read this before starting work.',
      inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true } },
    () => run(observed(() => store.contextHead(project))));

  server.registerTool('context_get',
    { description: 'One context document with its full revision history, so you can see how a decision changed and who approved it.',
      inputSchema: z.object({ document_id: z.string() }).strict(), annotations: { readOnlyHint: true } },
    (i) => run(() => store.contextGet(project, i.document_id) ?? { error: 'no such document' }));

  server.registerTool('context_propose',
    { description: 'Propose a new or changed requirement, decision or constraint. It is recorded as PENDING and does not take effect until a human approves it. Pass expected_version when changing an existing document; a stale version is rejected rather than overwriting another agent.',
      inputSchema: z.object({
        request_id: z.string().min(8).describe('Unique per proposal. Resending the same id is a safe no-op.'),
        kind: z.enum(['requirement', 'decision', 'constraint', 'note']),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(20000),
        change_note: z.string().min(1).max(500).describe('Why this change.'),
        document_id: z.string().optional().describe('Omit to create a new document.'),
        expected_version: z.number().int().positive().optional(),
      }).strict() },
    (i) => run(() => store.proposeRevision(project, agent.name, {
      documentId: i.document_id, kind: i.kind, title: i.title, body: i.body,
      changeNote: i.change_note, expectedVersion: i.expected_version, requestId: i.request_id,
    })));

  server.registerTool('feed_read',
    { description: 'What every agent and human has done, in order, since a sequence number. This is how you find out what the other agents are doing - they do not message you directly. Poll with since=<the head_sequence you last saw>.',
      inputSchema: z.object({ since: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(200).default(50) }).strict(),
      annotations: { readOnlyHint: true } },
    (i) => run(observed(() => store.feed(project, { since: i.since ?? 0, limit: i.limit ?? 50 }))));

  server.registerTool('note_append',
    { description: 'Publish a finding, warning or decision for the other agents to read. Use this instead of trying to message an agent directly.',
      inputSchema: z.object({
        request_id: z.string().min(8),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(20000),
        tags: z.array(z.string()).max(10).default([]),
      }).strict() },
    (i) => run(() => store.appendNote(project, agent.name, { title: i.title, body: i.body, tags: i.tags ?? [], requestId: i.request_id })));

  server.registerTool('work_list',
    { description: 'Work items for this project and who currently holds each one.',
      inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true } },
    () => run(observed(() => store.listWork(project))));

  server.registerTool('work_create',
    { description: 'Create a work item and optionally assign it to a teammate. Only the manager may do this. Break a task into items small enough that one member can finish one, and assign each to whoever is best suited - call agent_identity first to see who is available and what each is for.',
      inputSchema: z.object({
        request_id: z.string().min(8),
        title: z.string().min(1).max(200),
        body: z.string().max(20000).default(''),
        assignee: z.string().optional().describe('Leave out to let anyone take it.'),
      }).strict() },
    (i) => run(() => store.createWorkItem(project, { title: i.title, body: i.body ?? '', assignee: i.assignee ?? null, actor: agent.name, requestId: i.request_id })));

  server.registerTool('work_assign',
    { description: 'Move a work item to a different teammate, or unassign it. Only the manager may do this. An item assigned to someone else cannot be claimed by anyone but them.',
      inputSchema: z.object({
        request_id: z.string().min(8), item_id: z.string(),
        assignee: z.string().nullable().optional().describe('Null or omitted unassigns it.'),
      }).strict() },
    (i) => run(() => store.assignWork(project, agent.name, { itemId: i.item_id, assignee: i.assignee ?? null, requestId: i.request_id })));

  server.registerTool('work_claim',
    { description: 'Take an exclusive time-limited lease on a work item so no other agent duplicates it. Fails if another agent holds a live lease. Claim before you start.',
      inputSchema: z.object({
        request_id: z.string().min(8), item_id: z.string(),
        lease_seconds: z.number().int().min(60).max(86400).default(1800),
      }).strict() },
    (i) => run(() => store.claimWork(project, agent.name, { itemId: i.item_id, leaseSeconds: i.lease_seconds ?? 1800, requestId: i.request_id })));
  // The returned lease_generation is a fence, not a receipt: hold it and pass it
  // back to work_release. If your lease lapsed and someone else took the item,
  // your generation is stale and your result is refused rather than overwriting
  // theirs. Time alone cannot express that.

  server.registerTool('work_release',
    { description: 'Give up a work item, with the outcome. Use done when finished, or open to hand it back. Pass the lease_generation you were given when you claimed it.',
      inputSchema: z.object({
        request_id: z.string().min(8), item_id: z.string(),
        outcome: z.enum(['done', 'open', 'blocked']),
        summary: z.string().max(2000).optional(),
        lease_generation: z.number().int().min(1).optional()
          .describe('The lease_generation work_claim gave you. Pass it: if your lease lapsed and another agent took over, this is what stops your result overwriting theirs.'),
      }).strict() },
    (i) => run(() => store.releaseWork(project, agent.name, { itemId: i.item_id, outcome: i.outcome, summary: i.summary, requestId: i.request_id, leaseGeneration: i.lease_generation })));

  return server;
}

// ------------------------------------------------------------------- HTTP ---
const sseClients = new Set();
store.onEvent(() => {
  const line = `data: ${JSON.stringify({ at: Date.now() })}\n\n`;
  for (const res of sseClients) { try { res.write(line); } catch { sseClients.delete(res); } }
});

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(s);
};

function body(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

// Node's req/res to a Web Request the MCP handler understands, and back.
async function toWebRequest(req, raw) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x)); else if (v != null) headers.set(k, v);
  }
  headers.delete('content-length');
  return new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method, headers,
    ...(raw && req.method === 'POST' ? { body: raw } : {}),
  });
}

async function sendWebResponse(res, webRes) {
  const buf = Buffer.from(await webRes.arrayBuffer());
  const h = {};
  webRes.headers.forEach((v, k) => { h[k] = v; });
  delete h['content-length'];
  res.writeHead(webRes.status, h);
  res.end(buf);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    // ---- MCP: the agents' entry point ----
    if (url.pathname === '/mcp') {
      const auth = req.headers.authorization || '';
      const token = auth.replace(/^Bearer\s+/i, '').trim() || url.searchParams.get('token');
      const agent = token ? store.agentByToken(token) : null;
      if (!agent) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
        return res.end(JSON.stringify({ error: 'unknown or missing agent token' }));
      }
      let raw = '';
      if (req.method === 'POST') { for await (const c of req) raw += c; }
      const handler = createMcpHandler(() => buildServer(agent), { legacy: 'stateless', responseMode: 'json' });
      try {
        const webRes = await handler.fetch(await toWebRequest(req, raw));
        return await sendWebResponse(res, webRes);
      } finally { await handler.close(); }
    }

    // ---- live feed for the browser ----
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      return json(res, 200, {
        project: PROJECT,
        head_sequence: store.headSequence(PROJECT),
        // Only roster members. Names registered before the roster existed stay in
        // the database and keep their entries in the log - the history of who did
        // what must remain readable - but they are not part of the team now and
        // listing them here would misrepresent who is working.
        agents: (() => {
          const on = enabledAgents();
          return store.listAgents().filter((a) => !on || on.includes(a.name));
        })(),
        context: store.contextHead(PROJECT).documents,
        pending: store.pending(PROJECT).revisions,
        work: store.listWork(PROJECT).items,
        feed: store.feed(PROJECT, { since: Math.max(0, store.headSequence(PROJECT) - 60), limit: 60 }).events.reverse(),
      });
    }

    if (url.pathname === '/api/context/decide' && req.method === 'POST') {
      const { document_id, version, approve, approver } = await body(req);
      return json(res, 200, store.decideRevision(PROJECT, document_id, version, {
        approve: !!approve, approver: approver || 'human',
      }));
    }

    if (url.pathname === '/api/policy' && req.method === 'POST') {
      const { name, model, approval_mode } = await body(req);
      return json(res, 200, store.setPolicy(name, { model, approvalMode: approval_mode }));
    }

    if (url.pathname === '/api/work/close' && req.method === 'POST') {
      const { item_id, reason } = await body(req);
      return json(res, 200, store.closeWork(PROJECT, 'human', { itemId: item_id, reason }));
    }

    if (url.pathname === '/api/work' && req.method === 'POST') {
      const { title, body: b } = await body(req);
      if (!title) return json(res, 400, { error: 'title is required' });
      return json(res, 200, store.createWorkItem(PROJECT, { title, body: b || '' }));
    }

    if (url.pathname === '/api/token' && req.method === 'POST') {
      const { name, model, approval_mode } = await body(req);
      if (!name) return json(res, 400, { error: 'name is required' });
      // Pass these through undefined when absent. Defaulting here would defeat the
      // COALESCE in registerAgent and silently reset an agent's controller policy
      // every time connect.ps1 re-registers it - which is exactly what happened.
      const token = store.registerAgent({ name, projectId: PROJECT, model, approvalMode: approval_mode });
      return json(res, 200, { name, token, url: `http://host.docker.internal:${PORT}/mcp` });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const f = path.join(HERE, 'hub.html');
      if (!existsSync(f)) return json(res, 404, { error: 'hub.html missing' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(readFileSync(f));
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 500, { error: String(e && e.message ? e.message : e) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Context hub`);
  console.log(`    UI      http://localhost:${PORT}`);
  console.log(`    MCP     http://localhost:${PORT}/mcp   (containers: http://host.docker.internal:${PORT}/mcp)`);
  console.log(`    project ${PROJECT}\n`);
});

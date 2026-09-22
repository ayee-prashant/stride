// The baseline's run log — condition A of M1C.
//
// Without this the comparison is rigged. STRIDE would "win" traceability
// against a harness that records nothing, which would demonstrate that I wrote
// a logger, not that the platform earns its machinery. So the baseline gets
// what a competent engineer would build in an afternoon: one JSONL record per
// step, with enough to answer the ten pre-registered questions.
//
//   node runlog.mjs <logfile> append '<json>'
//   node runlog.mjs <logfile> hash <file>
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);

export function record(logFile, entry) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  appendFileSync(logFile, line + '\n', 'utf8');
  return line;
}

export function hashFile(f) {
  try { return existsSync(f) ? sha(readFileSync(f)) : null; } catch { return null; }
}

const [, , logFile, cmd, arg] = process.argv;
if (logFile && cmd === 'append') {
  record(logFile, JSON.parse(arg));
} else if (logFile && cmd === 'hash') {
  process.stdout.write(hashFile(arg) ?? '');
} else if (logFile && cmd === 'step') {
  // Values arrive through the environment, not as an assembled JSON argument.
  // Building the JSON in bash produced `"abc"abc` from a parameter expansion
  // and three of seven records were silently dropped - the log looked like it
  // was working because the simple records still landed.
  const n = (v) => (v === undefined || v === '' ? null : Number(v));
  const s_ = (v) => (v === undefined || v === '' ? null : v);
  record(logFile, {
    step: s_(process.env.RL_STEP),
    actor: s_(process.env.RL_ACTOR),
    role: s_(process.env.RL_ROLE),
    model: s_(process.env.RL_MODEL),
    runtime: s_(process.env.RL_RUNTIME),
    seconds: n(process.env.RL_SECONDS),
    tokens: n(process.env.RL_TOKENS),
    spec_hash: s_(process.env.RL_SPEC_HASH),
    parse_js_before: s_(process.env.RL_BEFORE),
    parse_js_after: s_(process.env.RL_AFTER),
    transcript: s_(process.env.RL_TRANSCRIPT),
  });
}

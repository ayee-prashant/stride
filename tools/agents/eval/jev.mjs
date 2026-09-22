// A typed classifier for the evaluation harness.
//
// Three judgements in this harness were made with grep, and at least one was
// demonstrably wrong: `grep -qiE 'fail|violat'` matched the word "fail" inside
// the sentence "No violations found" and triggered an unnecessary fourth agent
// invocation, inflating the cost figure in a comparison I then drew conclusions
// from. A regex counts whether a word appears; the question was whether a report
// asserts a failure. Those are different questions.
//
// This asks the question instead, and returns a calibrated probability rather
// than a boolean, so a borderline case can be recorded as borderline instead of
// silently rounded.
//
//   OPENROUTER_API_KEY, or ~/.openrouter/key as a fallback.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const MODEL = '~typesafe/jev-latest';

export function apiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  try { return readFileSync(path.join(os.homedir(), '.openrouter', 'key'), 'utf8').trim(); }
  catch { return null; }
}

/** Ask typed questions about a state. Returns { answers, usage, model }.
 *  Throws rather than guessing: a classifier that silently falls back to a
 *  regex when the call fails would reintroduce the bug it replaces. */
export async function decide(state, questions, { timeoutMs = 60000 } = {}) {
  const key = apiKey();
  if (!key) throw new Error('no OPENROUTER_API_KEY and no ~/.openrouter/key');

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, state, questions }),
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`decisions API ${res.status}: ${text.slice(0, 300)}`);
    const body = JSON.parse(text);
    if (!body.answers) throw new Error(`no answers in response: ${text.slice(0, 300)}`);
    return body;
  } finally { clearTimeout(timer); }
}

/** A single yes/no question, returned as a probability in [0,1]. */
export async function noul(state, instructions, criteria, opts) {
  const r = await decide(state, { q: { type: 'noul', instructions, criteria } }, opts);
  return { p: r.answers.q.noul, usage: r.usage, model: r.model };
}

// Run directly to sanity-check the key and the endpoint:
//   node jev.mjs "some state" "some yes/no question"
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const [, , state, question] = process.argv;
  if (!state || !question) { console.log('usage: node jev.mjs "<state>" "<yes/no question>"'); process.exit(2); }
  const r = await noul(state, question, { true: 'yes', false: 'no' });
  console.log(`  p=${r.p}   model=${r.model}   cost=$${r.usage.cost}`);
}

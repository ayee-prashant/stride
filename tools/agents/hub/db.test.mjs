// Checks the invariants that make concurrent agents safe. Run: node db.test.mjs
import { Store } from './db.mjs';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'data', 'test.db');
for (const s of ['', '-wal', '-shm']) { try { rmSync(FILE + s); } catch {} }

const s = new Store(FILE);
const P = 'proj1';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const throws = (name, fn, match) => {
  try { fn(); fail++; console.log(`  FAIL  ${name} (expected a throw)`); }
  catch (e) {
    if (!match || match.test(e.message)) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name} (wrong error: ${e.message})`); }
  }
};

console.log('\nagents');
const tClaude = s.registerAgent({ name: 'claude', projectId: P, model: 'opus', approvalMode: 'auto' });
const tCodex = s.registerAgent({ name: 'codex', projectId: P });
ok('token issued', typeof tClaude === 'string' && tClaude.length === 32);
ok('token resolves to the right agent', s.agentByToken(tClaude).name === 'claude');
ok('re-register keeps the same token', s.registerAgent({ name: 'claude', projectId: P }) === tClaude);
ok('unknown token is null', s.agentByToken('nope') === null);

console.log('\nre-registering must not wipe controller settings');
s.setPolicy('claude', { model: 'opus-4', approvalMode: 'auto' });
s.registerAgent({ name: 'claude', projectId: P });          // connect.ps1 does this, with no policy
const kept = s.listAgents().find((a) => a.name === 'claude');
ok('model survives a bare re-register', kept.model === 'opus-4', `got ${kept.model}`);
ok('approval mode survives a bare re-register', kept.approval_mode === 'auto', `got ${kept.approval_mode}`);
s.registerAgent({ name: 'claude', projectId: P, model: 'opus-5' });
ok('an explicit model still updates', s.listAgents().find((a) => a.name === 'claude').model === 'opus-5');
// The HTTP route must pass absent fields through as undefined, not coerce them to
// a default - doing so defeats the COALESCE above. This mirrors what /api/token does.
s.setPolicy('claude', { model: 'opus-4', approvalMode: 'auto' });
const routeShape = { name: 'claude', projectId: P, model: undefined, approvalMode: undefined };
s.registerAgent(routeShape);
ok('the route shape preserves approval mode', s.listAgents().find((a) => a.name === 'claude').approval_mode === 'auto',
   `got ${s.listAgents().find((a) => a.name === 'claude').approval_mode}`);

console.log('\nmonotonic sequence');
const before = s.headSequence(P);
const r1 = s.proposeRevision(P, 'claude', { kind: 'decision', title: 'Use MCP', body: 'All three CLIs speak it.', changeNote: 'initial', requestId: 'r1' });
const r2 = s.proposeRevision(P, 'codex', { kind: 'constraint', title: 'No API keys', body: 'Subscription only.', changeNote: 'initial', requestId: 'r2' });
ok('sequence advances by one per append', r2.head_sequence === r1.head_sequence + 1, `${r1.head_sequence} -> ${r2.head_sequence}`);
ok('sequence started from the stored head', r1.head_sequence === before + 1);

console.log('\nidempotency — a retry must not double-write');
const seqBefore = s.headSequence(P);
const replay = s.proposeRevision(P, 'claude', { kind: 'decision', title: 'Use MCP', body: 'All three CLIs speak it.', changeNote: 'initial', requestId: 'r1' });
ok('same request_id is flagged as a replay', replay.replayed === true);
ok('same request_id returns the original version', replay.version === r1.version);
ok('a replay does not advance the sequence', s.headSequence(P) === seqBefore, `head is now ${s.headSequence(P)}`);
throws('a missing request_id is refused', () => s.proposeRevision(P, 'claude', { kind: 'note', title: 'x', body: 'y', changeNote: 'z' }), /request_id/);

console.log('\noptimistic concurrency — a stale writer must lose');
const v2 = s.proposeRevision(P, 'codex', { documentId: r1.document_id, kind: 'decision', title: 'Use MCP over HTTP', body: 'Verified against all three binaries.', changeNote: 'refined', expectedVersion: 1, requestId: 'r3' });
ok('a correct expected_version is accepted', v2.version === 2);
throws('a stale expected_version is rejected',
  () => s.proposeRevision(P, 'gemini', { documentId: r1.document_id, kind: 'decision', title: 'Something else', body: 'Written from an old read.', changeNote: 'stale', expectedVersion: 1, requestId: 'r4' }),
  /stale write/);

console.log('\nagents cannot approve their own context');
const headView = s.contextHead(P);
ok('a pending revision is not in the approved view', headView.documents.length === 0, `saw ${headView.documents.length}`);
ok('a pending revision is listed for human review', s.pending(P).revisions.length > 0);
s.decideRevision(P, r1.document_id, 2, { approve: true, approver: 'human:prashant' });
const after = s.contextHead(P);
ok('an approved revision appears', after.documents.some((d) => d.id === r1.document_id));
ok('the approver is recorded', after.documents.find((d) => d.id === r1.document_id).approved_by === 'human:prashant');
throws('a revision cannot be decided twice', () => s.decideRevision(P, r1.document_id, 2, { approve: true, approver: 'human:prashant' }), /not pending/);

console.log('\nwork leases — two agents must not do the same job');
const w = s.createWorkItem(P, { title: 'Write the roman numeral converter' });
const claim = s.claimWork(P, 'claude', { itemId: w.id, requestId: 'c1' });
ok('first claim succeeds', claim.claimed_by === 'claude');
throws('a second agent cannot claim it', () => s.claimWork(P, 'gemini', { itemId: w.id, requestId: 'c2' }), /already claimed/);
ok('the holder re-claiming is fine', s.claimWork(P, 'claude', { itemId: w.id, requestId: 'c3' }).claimed_by === 'claude');
s.releaseWork(P, 'claude', { itemId: w.id, outcome: 'done', summary: '31/31 pass', requestId: 'c4' });
ok('released work is done', s.listWork(P).items.find((i) => i.id === w.id).state === 'done');
ok('a released item has no holder', s.listWork(P).items.find((i) => i.id === w.id).claimed_by === null);

console.log('\nexpired lease returns the work to the pool');
const w2 = s.createWorkItem(P, { title: 'Expires immediately' });
s.claimWork(P, 'claude', { itemId: w2.id, leaseSeconds: -1, requestId: 'c5' });
const stolen = s.claimWork(P, 'gemini', { itemId: w2.id, requestId: 'c6' });
ok('another agent can take over an expired lease', stolen.claimed_by === 'gemini');

console.log('\nthe feed is how agents see each other');
const feed = s.feed(P, { since: 0, limit: 100 });
ok('events are strictly ordered', feed.events.every((e, i) => i === 0 || e.sequence > feed.events[i - 1].sequence));
ok('another agent can see what claude did', feed.events.some((e) => e.actor === 'claude' && e.kind === 'work_claimed'));
ok('the human decision is in the log too', feed.events.some((e) => e.kind === 'context_approved'));
const tail = s.feed(P, { since: feed.head_sequence });
ok('reading from head returns nothing new', tail.events.length === 0);
const note = s.appendNote(P, 'gemini', { title: 'Found a race', body: 'Two agents wrote the same file.', tags: ['risk'], requestId: 'n1' });
ok('a note advances the sequence', note.sequence === feed.head_sequence + 1);
ok('the note is readable by others', s.feed(P, { since: feed.head_sequence }).events[0].payload.title === 'Found a race');

console.log('\nlive listeners (these drive the SSE feed)');
let seen = 0;
const off = s.onEvent(() => seen++);
s.appendNote(P, 'codex', { title: 'ping', body: 'x', requestId: 'n2' });
ok('a listener is notified on write', seen === 1);
off();
s.appendNote(P, 'codex', { title: 'ping2', body: 'x', requestId: 'n3' });
ok('an unsubscribed listener stops', seen === 1);

console.log(`\n  ${pass} passed, ${fail} failed`);
console.log(fail === 0 ? '  RESULT: PASS\n' : '  RESULT: FAIL\n');
process.exit(fail === 0 ? 0 : 1);

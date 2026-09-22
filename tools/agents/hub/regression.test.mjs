// Regressions for bugs found in review. Each one failed before its fix.
// Run: node regression.test.mjs
import { Store } from './db.mjs';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'data', 'regression.db');
for (const s of ['', '-wal', '-shm']) { try { rmSync(FILE + s); } catch {} }

const s = new Store(FILE);
const P = 'proj';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

console.log('\na pending proposal must not hide approved context');
// Found in review: contextHead joined on current_version, which advances on
// every proposal. So proposing an unapproved change removed the approved
// revision from every other agent's view - an agent could suppress a
// constraint it did not want to follow simply by proposing an edit to it.
const d1 = s.proposeRevision(P, 'claude', { kind: 'constraint', title: 'No API keys', body: 'Subscription only.', changeNote: 'v1', requestId: 'q1' });
s.decideRevision(P, d1.document_id, 1, { approve: true, approver: 'human' });
ok('approved v1 is visible', s.contextHead(P).documents.length === 1);
s.proposeRevision(P, 'codex', { documentId: d1.document_id, kind: 'constraint', title: 'REWRITTEN', body: 'Unapproved.', changeNote: 'v2', expectedVersion: 1, requestId: 'q2' });
const seen = s.contextHead(P).documents;
ok('approved v1 survives an unapproved v2', seen.length === 1, `saw ${seen.length}`);
ok('and it is still the approved text', seen[0]?.title === 'No API keys', `saw ${seen[0]?.title}`);
ok('reporting the approved version, not the pending one', seen[0]?.current_version === 1, `saw v${seen[0]?.current_version}`);

console.log('\npending revisions are still reviewable by a human');
const pend = s.pending(P);
ok('the pending proposal is listed for review', pend.revisions.length === 1, `saw ${pend.revisions.length}`);
ok('it carries the version a human must decide on', pend.revisions[0]?.version === 2);

console.log('\nonce approved, the new version takes over');
s.decideRevision(P, d1.document_id, 2, { approve: true, approver: 'human' });
ok('v2 is now the approved text', s.contextHead(P).documents[0].title === 'REWRITTEN');
ok('nothing is left pending', s.pending(P).revisions.length === 0);

console.log('\na rejected proposal leaves the approved text in place');
s.proposeRevision(P, 'gemini', { documentId: d1.document_id, kind: 'constraint', title: 'BAD IDEA', body: 'No.', changeNote: 'v3', expectedVersion: 2, requestId: 'q3' });
s.decideRevision(P, d1.document_id, 3, { approve: false, approver: 'human' });
ok('rejection restores the approved view', s.contextHead(P).documents[0].title === 'REWRITTEN');
ok('a rejected revision is not pending', s.pending(P).revisions.length === 0);

console.log('\nan expired lease must read as available, not held');
// Found in review: claimWork correctly let another agent take over an expired
// lease, but listWork still reported state=claimed with the old holder, so a
// human (and any agent reading the list) saw abandoned work as in progress.
const w = s.createWorkItem(P, { title: 'Something abandoned', requestId: 'w1' });
s.claimWork(P, 'claude', { itemId: w.id, leaseSeconds: -1, requestId: 'w2' });
const item = s.listWork(P).items.find((i) => i.id === w.id);
ok('an expired claim reads as open', item.state === 'open', `saw ${item.state}`);
ok('and has no holder', item.claimed_by === null, `saw ${item.claimed_by}`);
const expiredEvent = s.feed(P, { since: 0, limit: 200 }).events.filter((e) => e.kind === 'work_lease_expired');
ok('the expiry is recorded in the log, not silent', expiredEvent.length === 1, `saw ${expiredEvent.length}`);
ok('a live lease is untouched', (() => {
  const w2 = s.createWorkItem(P, { title: 'Held properly', requestId: 'w3' });
  s.claimWork(P, 'codex', { itemId: w2.id, leaseSeconds: 3600, requestId: 'w4' });
  return s.listWork(P).items.find((i) => i.id === w2.id).state === 'claimed';
})());

console.log('\ncreating work is atomic and idempotent');
// Found in review: the row was inserted outside the transaction that wrote its
// event, so a failure could leave an item with no entry in the log. And with no
// request_id a retried call created a second item.
const before = s.listWork(P).items.length;
const a = s.createWorkItem(P, { title: 'Only once', requestId: 'w5' });
const b = s.createWorkItem(P, { title: 'Only once', requestId: 'w5' });
ok('a repeated request_id returns the same item', a.id === b.id, `${a.id} vs ${b.id}`);
ok('and does not create a second one', s.listWork(P).items.length === before + 1);
ok('the item has a matching event', s.feed(P, { since: 0, limit: 200 }).events.some((e) => e.kind === 'work_created' && e.payload?.id === a.id));

console.log(`\n  ${pass} passed, ${fail} failed`);
console.log(fail === 0 ? '  RESULT: PASS\n' : '  RESULT: FAIL\n');
process.exit(fail === 0 ? 0 : 1);

// A time-based lease does not stop a zombie worker, and an ordered log does not
// prove what an agent knew. These cover both. Run: node fencing.test.mjs
import { Store } from './db.mjs';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'data', 'fencing.db');
for (const s of ['', '-wal', '-shm']) { try { rmSync(FILE + s); } catch {} }

const s = new Store(FILE);
const P = 'fence';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} ${x}`); } };
const throws = (n, fn, m) => {
  try { fn(); fail++; console.log(`  FAIL  ${n} (expected a throw)`); }
  catch (e) { if (!m || m.test(e.message)) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} (${e.message})`); } }
};

s.registerAgent({ name: 'manager', projectId: P, runtime: 'claude', role: 'manager' });
s.registerAgent({ name: 'agent1', projectId: P, runtime: 'codex', role: 'implementer' });
s.registerAgent({ name: 'agent2', projectId: P, runtime: 'codex', role: 'implementer' });

console.log('\nlease fencing - a zombie worker must not clobber its successor');
const w = s.createWorkItem(P, { title: 'Long job', actor: 'manager', requestId: 'f1' });

// agent1 takes it and is handed generation 1.
const c1 = s.claimWork(P, 'agent1', { itemId: w.id, leaseSeconds: -1, requestId: 'f2' });
ok('a claim issues a generation', c1.lease_generation === 1, `got ${c1.lease_generation}`);

// It stalls past the lease. agent2 takes over and gets generation 2.
const c2 = s.claimWork(P, 'agent2', { itemId: w.id, requestId: 'f3' });
ok('a takeover after expiry mints a new generation', c2.lease_generation === 2, `got ${c2.lease_generation}`);

// agent1 wakes up and tries to finish. Time has moved on; its token has not.
throws('the stalled worker is refused on its old generation',
  () => s.releaseWork(P, 'agent1', { itemId: w.id, outcome: 'done', leaseGeneration: c1.lease_generation, requestId: 'f4' }),
  /stale lease/);
ok('the item still belongs to the current holder', s.listWork(P).items.find((i) => i.id === w.id).claimed_by === 'agent2');

// The current holder's token works.
ok('the current holder can release', s.releaseWork(P, 'agent2', { itemId: w.id, outcome: 'done', leaseGeneration: c2.lease_generation, requestId: 'f5' }).state === 'done');

console.log('\ngenerations never go backwards');
const w2 = s.createWorkItem(P, { title: 'Contended', actor: 'manager', requestId: 'f6' });
let gens = [];
for (const [who, req] of [['agent1', 'g1'], ['agent2', 'g2'], ['agent1', 'g3']]) {
  s.db.prepare('UPDATE work_items SET lease_until=? WHERE project_id=? AND id=?').run('2000-01-01T00:00:00.000Z', P, w2.id);
  gens.push(s.claimWork(P, who, { itemId: w2.id, requestId: req }).lease_generation);
}
ok('each takeover increments', gens.join(',') === '1,2,3', gens.join(','));
throws('the very first generation is still refused at the end',
  () => s.releaseWork(P, 'agent1', { itemId: w2.id, outcome: 'done', leaseGeneration: 1, requestId: 'g4' }), /stale lease/);

console.log('\ncausal tracking - the log must show what an actor had read');
// agent1 reads up to the current head, then the manager changes something.
const headNow = s.headSequence(P);
s.observe('agent1', headNow);
s.appendNote(P, 'manager', { title: 'Requirement changed', body: 'Everything is different now.', requestId: 'h1' });
s.appendNote(P, 'manager', { title: 'And again', body: 'More change.', requestId: 'h2' });

// agent1 acts WITHOUT re-reading. Ordering alone would hide this.
const act = s.appendNote(P, 'agent1', { title: 'Work done', body: 'Built from what I read earlier.', requestId: 'h3' });
const ev = s.feed(P, { since: act.sequence - 1, limit: 5 }).events.find((e) => e.sequence === act.sequence);
ok('the write records what the actor had observed', ev.payload.based_on_sequence === headNow, `based_on ${ev.payload.based_on_sequence}, expected ${headNow}`);
ok('and how stale that made it', ev.payload.stale_by === 2, `stale_by ${ev.payload.stale_by}`);

// After catching up, the same actor is no longer stale.
s.observe('agent1', s.headSequence(P));
const act2 = s.appendNote(P, 'agent1', { title: 'Caught up', body: 'Read everything first.', requestId: 'h4' });
const ev2 = s.feed(P, { since: act2.sequence - 1, limit: 5 }).events.find((e) => e.sequence === act2.sequence);
ok('an up-to-date actor records zero staleness', ev2.payload.stale_by === 0, `stale_by ${ev2.payload.stale_by}`);

console.log('\nan observation cursor never moves backwards');
s.observe('agent1', 5);
ok('re-reading older history does not un-know newer', s.observedSequence('agent1') > 5, `cursor ${s.observedSequence('agent1')}`);

console.log('\nhuman and system actions carry no staleness claim');
const hv = s.createWorkItem(P, { title: 'From a person', actor: 'human', requestId: 'h5' });
const hev = s.feed(P, { since: hv.head_sequence - 1, limit: 3 }).events.find((e) => e.sequence === hv.head_sequence);
ok('a human write has no based_on_sequence', hev.payload.based_on_sequence === undefined);

console.log(`\n  ${pass} passed, ${fail} failed`);
console.log(fail === 0 ? '  RESULT: PASS\n' : '  RESULT: FAIL\n');
process.exit(fail === 0 ? 0 : 1);

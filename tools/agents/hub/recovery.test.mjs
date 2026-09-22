// M1B — does coordination survive failure without lying?
//
// These kill things rather than mock them. The bar is four invariants, and
// "recovers automatically" is deliberately not one of them:
//
//   NO SILENT LOSS       produced work stays recoverable
//   NO FALSE SUCCESS     unfinished work is never promoted
//   NO DUPLICATE AUTHORITY  two workers cannot both own a generation
//   EXPLAINABLE RECOVERY the human can find out what happened
//
// A system that stops and says "I have commit X, work Y never completed, worker
// Z is gone" has passed. One that quietly guesses has not.
import { Store } from './db.mjs';
import { execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'data', 'recovery.db');
const clean = () => { for (const s of ['', '-wal', '-shm']) { try { rmSync(FILE + s); } catch {} } };
clean();

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} ${x}`); } };
const throws = (n, fn, m) => {
  try { fn(); fail++; console.log(`  FAIL  ${n} (expected a throw)`); }
  catch (e) { if (!m || m.test(e.message)) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} (${e.message})`); } }
};
const crash = (mode) => {
  try { return execFileSync(process.execPath, [path.join(HERE, 'crash-child.mjs'), FILE, mode], { encoding: 'utf8' }); }
  catch (e) { return (e.stdout ?? '') + (e.stderr ?? ''); }  // SIGKILL is the point
};

const P = 'recovery';

console.log('\nhub killed mid-write: committed once, or absent - never half-applied');
crash('mid-transaction');
{
  const s = new Store(FILE);
  const item = s.listWork(P).items.find((i) => i.id === 'w_crash');
  ok('the uncommitted work item did not survive', !item, `found ${JSON.stringify(item)}`);
  const ev = s.feed(P, { since: 0, limit: 50 }).events.filter((e) => e.summary === 'should not survive');
  ok('nor its event', ev.length === 0, `found ${ev.length}`);
  ok('the sequence was not advanced by the dead write', s.headSequence(P) === 0, `head is ${s.headSequence(P)}`);
  ok('the database is still usable after the kill', typeof s.headSequence(P) === 'number');
}

console.log('\nhub killed immediately after commit: the write is durable');
const out = crash('after-commit');
const committed = JSON.parse((out.match(/\{[^}]*\}/) ?? ['{}'])[0]);
{
  const s = new Store(FILE);
  const item = s.listWork(P).items.find((i) => i.id === committed.id);
  ok('the committed work item survived the kill', !!item, 'it was lost');
  ok('its event survived too', s.feed(P, { since: 0, limit: 50 }).events.some((e) => e.kind === 'work_created'));
  ok('the sequence matches what the dead process was told', s.headSequence(P) === committed.head_sequence,
    `head ${s.headSequence(P)} vs reported ${committed.head_sequence}`);
}

console.log('\nrestart reconstructs state rather than losing it');
{
  const s1 = new Store(FILE);
  const w = s1.createWorkItem(P, { title: 'survives a restart', actor: 'human', requestId: 'r-1' });
  s1.registerAgent({ name: 'agent1', projectId: P, runtime: 'codex', role: 'implementer', model: 'terra' });
  const c = s1.claimWork(P, 'agent1', { itemId: w.id, requestId: 'r-2' });
  const headBefore = s1.headSequence(P);

  const s2 = new Store(FILE);   // a fresh process would see exactly this
  const after = s2.listWork(P).items.find((i) => i.id === w.id);
  ok('work survives', !!after);
  ok('ownership survives', after.claimed_by === 'agent1', `claimed_by ${after.claimed_by}`);
  ok('the lease generation survives', after.lease_generation === c.lease_generation);
  ok('the roster survives', s2.listAgents().some((a) => a.name === 'agent1' && a.role === 'implementer'));
  ok('the sequence does not rewind', s2.headSequence(P) === headBefore);
  ok('history is intact', s2.feed(P, { since: 0, limit: 200 }).events.length > 0);
}

console.log('\nNO FALSE SUCCESS: a dead worker cannot leave work looking finished');
{
  const s = new Store(FILE);
  const w = s.createWorkItem(P, { title: 'worker dies holding it', actor: 'human', requestId: 'f-1' });
  s.claimWork(P, 'agent1', { itemId: w.id, leaseSeconds: -1, requestId: 'f-2' });   // and then dies
  const item = s.listWork(P).items.find((i) => i.id === w.id);
  ok('it is not marked done', item.state !== 'done', `state ${item.state}`);
  ok('it is reclaimable, not stuck', item.state === 'open', `state ${item.state}`);
  ok('and it has no phantom owner', item.claimed_by === null);
  ok('the expiry is in the log, not silent',
    s.feed(P, { since: 0, limit: 200 }).events.some((e) => e.kind === 'work_lease_expired'));
}

console.log('\nNO DUPLICATE AUTHORITY: the zombie cannot write after being replaced');
{
  const s = new Store(FILE);
  s.registerAgent({ name: 'agent2', projectId: P, runtime: 'codex', role: 'implementer' });
  const w = s.createWorkItem(P, { title: 'contended', actor: 'human', requestId: 'd-1' });
  const first = s.claimWork(P, 'agent1', { itemId: w.id, leaseSeconds: -1, requestId: 'd-2' });
  const second = s.claimWork(P, 'agent2', { itemId: w.id, requestId: 'd-3' });
  ok('the replacement holds a later generation', second.lease_generation > first.lease_generation);
  throws('the zombie is refused',
    () => s.releaseWork(P, 'agent1', { itemId: w.id, outcome: 'done', leaseGeneration: first.lease_generation, requestId: 'd-4' }),
    /stale lease/);
  ok('and the item still belongs to the replacement',
    s.listWork(P).items.find((i) => i.id === w.id).claimed_by === 'agent2');
}

console.log('\ninterrupted network: a retry must not double-write');
{
  const s = new Store(FILE);
  const w = s.createWorkItem(P, { title: 'retried', actor: 'human', requestId: 'n-1' });
  const c = s.claimWork(P, 'agent1', { itemId: w.id, requestId: 'n-2' });
  const before = s.headSequence(P);
  // The agent sent this, the reply was lost, so it sends it again.
  const a = s.releaseWork(P, 'agent1', { itemId: w.id, outcome: 'done', leaseGeneration: c.lease_generation, requestId: 'n-3' });
  const b = s.releaseWork(P, 'agent1', { itemId: w.id, outcome: 'done', leaseGeneration: c.lease_generation, requestId: 'n-3' });
  ok('the retry is a replay, not a second write', b.replayed === true);
  ok('it returns the original result', a.id === b.id && a.state === b.state);
  ok('and advanced the sequence exactly once', s.headSequence(P) === before + 1,
    `head ${s.headSequence(P)}, expected ${before + 1}`);
}

console.log('\nEXPLAINABLE RECOVERY: the human can reconstruct what happened');
{
  const s = new Store(FILE);
  const evs = s.feed(P, { since: 0, limit: 500 }).events;
  ok('every event names an actor', evs.every((e) => !!e.actor));
  ok('abnormal events are recorded, not just normal ones',
    evs.some((e) => e.kind === 'work_lease_expired'));
  const expiry = evs.find((e) => e.kind === 'work_lease_expired');
  ok('an expiry says who lost the work', !!expiry.payload?.previous_holder, JSON.stringify(expiry.payload));
  ok('and when their lease had run to', !!expiry.payload?.lease_until);
  ok('agent writes record what the actor had read',
    evs.some((e) => e.actor === 'agent1' && e.payload && 'based_on_sequence' in e.payload));
}

console.log('\nsplit brain: artifact exists, coordination write never landed');
{
  const s = new Store(FILE);
  const w = s.createWorkItem(P, { title: 'pushed then died', actor: 'human', requestId: 'sb-1' });
  s.claimWork(P, 'agent1', { itemId: w.id, leaseSeconds: -1, requestId: 'sb-2' });
  // The worker pushed a commit to its branch and never called work_release.
  const rec = s.recoveryCandidates(P).candidates.find((c) => c.id === w.id);
  ok('the abandoned item is reported as needing attention', !!rec, 'it was invisible');
  ok('it names who held it', rec.last_holder === 'agent1');
  ok('and the branch to go and look at', rec.branch === 'agent/agent1');
  ok('it does not claim a commit it was never told about', rec.commit_sha === null);
  ok('and says why it is listed', /abandoned without reporting/.test(rec.reason), rec.reason);
  ok('it is NOT silently marked done', s.listWork(P).items.find((i) => i.id === w.id).state !== 'done');
}
console.log('\na reported commit is linked, so completed work is traceable');
{
  const s = new Store(FILE);
  const w = s.createWorkItem(P, { title: 'reports properly', actor: 'human', requestId: 'sb-3' });
  const c = s.claimWork(P, 'agent1', { itemId: w.id, requestId: 'sb-4' });
  s.releaseWork(P, 'agent1', { itemId: w.id, outcome: 'done', commit: 'abc1234', leaseGeneration: c.lease_generation, requestId: 'sb-5' });
  const item = s.listWork(P).items.find((i) => i.id === w.id);
  ok('the commit is stored on the work item', item.commit_sha === 'abc1234', `got ${item.commit_sha}`);
  ok('and is in the log for provenance',
    s.feed(P, { since: 0, limit: 300 }).events.some((e) => e.kind === 'work_released' && e.payload?.commit === 'abc1234'));
  ok('completed work is not listed as needing recovery',
    !s.recoveryCandidates(P).candidates.some((x) => x.id === w.id));
}

console.log(`\n  ${pass} passed, ${fail} failed`);
console.log(fail === 0 ? '  RESULT: PASS\n' : '  RESULT: FAIL\n');
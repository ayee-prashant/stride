// Role and assignment rules. Run: node roles.test.mjs
import { Store } from './db.mjs';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'data', 'roles.db');
for (const s of ['', '-wal', '-shm']) { try { rmSync(FILE + s); } catch {} }

const s = new Store(FILE);
const P = 'team';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} ${x}`); } };
const throws = (n, fn, m) => {
  try { fn(); fail++; console.log(`  FAIL  ${n} (expected a throw)`); }
  catch (e) { if (!m || m.test(e.message)) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} (${e.message})`); } }
};

console.log('\nthe roster');
s.registerAgent({ name: 'manager', projectId: P, model: 'claude-opus-5', runtime: 'claude', role: 'manager', approvalMode: 'auto' });
s.registerAgent({ name: 'agent1', projectId: P, model: 'gpt-5.6-terra', runtime: 'codex', role: 'implementer', approvalMode: 'auto' });
s.registerAgent({ name: 'agent2', projectId: P, model: 'gpt-5.6-sol', runtime: 'codex', role: 'implementer', approvalMode: 'auto' });
s.registerAgent({ name: 'tester', projectId: P, model: 'claude-sonnet-5', runtime: 'claude', role: 'tester', approvalMode: 'auto' });
const roster = s.listAgents();
ok('four members registered', roster.length === 4, `saw ${roster.length}`);
// Two members share a runtime while being different agents on different models.
const codex = roster.filter((a) => a.runtime === 'codex');
ok('two members share the codex runtime', codex.length === 2);
ok('but run different models', codex[0].model !== codex[1].model, `${codex[0].model} vs ${codex[1].model}`);
const claude = roster.filter((a) => a.runtime === 'claude');
ok('two members share the claude runtime', claude.length === 2);
ok('but run different models', claude[0].model !== claude[1].model, `${claude[0].model} vs ${claude[1].model}`);
ok('each has a distinct token', new Set(roster.map((a) => a.name)).size === 4);

console.log('\nonly the manager may create work');
const w1 = s.createWorkItem(P, { title: 'Implement the parser', actor: 'manager', assignee: 'agent1', requestId: 'm1' });
ok('the manager can create and assign in one step', w1.assignee === 'agent1');
throws('an implementer cannot create work', () => s.createWorkItem(P, { title: 'sneaky', actor: 'agent1', requestId: 'm2' }), /only the manager/);
throws('the tester cannot create work either', () => s.createWorkItem(P, { title: 'sneaky', actor: 'tester', requestId: 'm3' }), /only the manager/);
ok('a human still can', typeof s.createWorkItem(P, { title: 'from the human', actor: 'human', requestId: 'm4' }).id === 'string');

console.log('\nassignment is honoured, not advisory');
throws('agent2 cannot take work assigned to agent1',
  () => s.claimWork(P, 'agent2', { itemId: w1.id, requestId: 'c1' }), /assigned to agent1/);
ok('agent1 can take its own work', s.claimWork(P, 'agent1', { itemId: w1.id, requestId: 'c2' }).claimed_by === 'agent1');

console.log('\nunassigned work is open to anyone');
const w2 = s.createWorkItem(P, { title: 'Anyone can do this', actor: 'manager', requestId: 'm5' });
ok('an unassigned item has no assignee', w2.assignee === null);
ok('agent2 can take it', s.claimWork(P, 'agent2', { itemId: w2.id, requestId: 'c3' }).claimed_by === 'agent2');

console.log('\nreassignment');
const w3 = s.createWorkItem(P, { title: 'Write the tests', actor: 'manager', assignee: 'agent1', requestId: 'm6' });
throws('an implementer cannot reassign', () => s.assignWork(P, 'agent1', { itemId: w3.id, assignee: 'agent1', requestId: 'a1' }), /only the manager/);
ok('the manager can move it to the tester', s.assignWork(P, 'manager', { itemId: w3.id, assignee: 'tester', requestId: 'a2' }).assignee === 'tester');
throws('assigning to someone who does not exist is refused',
  () => s.assignWork(P, 'manager', { itemId: w3.id, assignee: 'nobody', requestId: 'a3' }), /no such agent/);
ok('the tester can now claim it', s.claimWork(P, 'tester', { itemId: w3.id, requestId: 'c4' }).claimed_by === 'tester');

console.log('\nthe plan is visible in the log');
const feed = s.feed(P, { since: 0, limit: 100 }).events;
ok('creation records who it was for', feed.some((e) => e.kind === 'work_created' && e.payload?.assignee === 'agent1'));
ok('reassignment is recorded', feed.some((e) => e.kind === 'work_assigned' && e.payload?.assignee === 'tester'));
ok('every work event names its actor', feed.filter((e) => e.kind.startsWith('work_')).every((e) => !!e.actor));

console.log('\nclosing work is human-only and abandons rather than deletes');
const w9 = s.createWorkItem(P, { title: 'Written from a bad brief', actor: 'manager', assignee: 'agent1', requestId: 'm9' });
throws('the manager cannot close an item', () => s.closeWork(P, 'manager', { itemId: w9.id, reason: 'x' }), /only a human/);
throws('an implementer cannot close one', () => s.closeWork(P, 'agent1', { itemId: w9.id, reason: 'x' }), /only a human/);
s.closeWork(P, 'human', { itemId: w9.id, reason: 'superseded by the corrected brief' });
const closed = s.listWork(P).items.find((i) => i.id === w9.id);
ok('a closed item is abandoned, not gone', closed && closed.state === 'abandoned');
ok('and carries the reason', closed.outcome === 'superseded by the corrected brief');
ok('and is unassigned so nobody waits on it', closed.assignee === null);
ok('the closure is in the log', s.feed(P, { since: 0, limit: 200 }).events.some((e) => e.kind === 'work_abandoned'));

console.log(`\n  ${pass} passed, ${fail} failed`);
console.log(fail === 0 ? '  RESULT: PASS\n' : '  RESULT: FAIL\n');
process.exit(fail === 0 ? 0 : 1);

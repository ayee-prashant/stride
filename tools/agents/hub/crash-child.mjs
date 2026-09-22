// Helper for recovery.test.mjs. Opens the real store, starts a real write, and
// is killed at a chosen point so the parent can inspect what survived.
//
//   node crash-child.mjs <db> <mode>
//
// modes:
//   mid-transaction   kill after writing inside a transaction, before COMMIT
//   after-commit      kill immediately after COMMIT returns
import { Store } from './db.mjs';

const [, , dbFile, mode] = process.argv;
const s = new Store(dbFile);
const P = 'recovery';

s.registerAgent({ name: 'worker', projectId: P, runtime: 'codex', role: 'manager' });

if (mode === 'mid-transaction') {
  // Reach into the same connection the Store uses, so this is the real
  // transaction boundary rather than a simulation of one.
  s.db.exec('BEGIN IMMEDIATE');
  s.db.prepare('INSERT INTO work_items(id,project_id,title,body,state,version,created_at) VALUES(?,?,?,?,?,1,?)')
    .run('w_crash', P, 'written but never committed', '', 'open', new Date().toISOString());
  s.db.prepare('INSERT OR IGNORE INTO context_heads(project_id, sequence) VALUES(?, 0)').run(P);
  s.db.prepare('UPDATE context_heads SET sequence = sequence + 1 WHERE project_id = ?').run(P);
  s.db.prepare(`INSERT INTO context_events(project_id,sequence,kind,actor,summary,created_at)
                VALUES(?,(SELECT sequence FROM context_heads WHERE project_id=?),?,?,?,?)`)
    .run(P, P, 'work_created', 'worker', 'should not survive', new Date().toISOString());
  console.log('wrote inside transaction, about to die');
  process.kill(process.pid, 'SIGKILL');
}

if (mode === 'after-commit') {
  const r = s.createWorkItem(P, { title: 'committed then died', actor: 'human', requestId: 'crash-1' });
  console.log(JSON.stringify({ id: r.id, head_sequence: r.head_sequence }));
  process.kill(process.pid, 'SIGKILL');
}

setTimeout(() => process.exit(0), 5000);

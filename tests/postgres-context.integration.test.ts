import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Repository } from "../lib/server/repository.ts";
import { PostgresDatabase } from "../lib/server/postgres-adapter.ts";
import { ContextRepository } from "../lib/server/context-repository.ts";
import { contextContract, publication, revise } from "./context-contract.ts";
import { setTimeout as delay } from "node:timers/promises";

const value = process.env.TEST_DATABASE_URL;
if (!value) throw new Error("TEST_DATABASE_URL must point to the isolated local CI database");
const url = new URL(value);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/stride_test") throw new Error("Integration tests require a local database named stride_test");

test("PostgreSQL context contract and concurrent approvals", async t => {
  const pool = new Pool({ connectionString: value, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  t.after(() => pool.end());
  await migrate(drizzle(pool), { migrationsFolder: "drizzle-postgres" });
  const repo = new Repository(new PostgresDatabase(pool));
  const fixture = async () => {
    const suffix = crypto.randomUUID();
    const owner = { userId: `context_owner_${suffix}`, email: `context_owner_${suffix}@example.test`, displayName: "Context owner" };
    const other = { userId: `context_member_${suffix}`, email: `context_member_${suffix}@example.test`, displayName: "Context member" };
    const workspace = (await repo.bootstrap(owner)).workspaces[0].id;
    await repo.bootstrap(other);
    const project = (await repo.metadata(owner.userId, workspace)).projects[0].id;
    return { repo, owner, other, workspace, project };
  };
  await contextContract(t, fixture);
  await t.test("two machines cannot publish competing versions; event cursors follow commit order", async () => {
    const f = await fixture(); const c = new ContextRepository(repo);
    const first = await c.publish(f.owner.userId, f.workspace, f.project, publication());
    const writers = await Promise.allSettled([
      c.publish(f.owner.userId, f.workspace, f.project, revise(first, { body: "Machine one proposal accepted." })),
      c.publish(f.owner.userId, f.workspace, f.project, revise(first, { body: "Machine two proposal accepted." })),
    ]);
    assert.equal(writers.filter(w => w.status === "fulfilled").length, 1);
    const rejected = writers.find(w => w.status === "rejected");
    assert.equal(rejected?.status === "rejected" ? rejected.reason.status : null, 409);
    assert.deepEqual((await c.changes(f.owner.userId, f.workspace, f.project, 0)).events.map(e => e.sequence), [1, 2]);
    const input = publication({ title: "Idempotent concurrent acceptance" });
    const [one, two] = await Promise.all([c.publish(f.owner.userId, f.workspace, f.project, input), c.publish(f.owner.userId, f.workspace, f.project, input)]);
    assert.deepEqual(one, two);
    assert.equal((await c.brief(f.owner.userId, f.workspace, f.project)).sequence, 3);
  });
  await t.test("a concurrent requirement revision cannot leave an older task brief current", async () => {
    const f = await fixture(); const c = new ContextRepository(repo);
    const doc = await c.publish(f.owner.userId, f.workspace, f.project, publication());
    const task = await repo.createTask(f.owner.userId, f.workspace, { project_id: f.project, title: "Two-machine context binding" });
    const [prepared, revised] = await Promise.allSettled([
      c.createTaskBrief(f.owner.userId, f.workspace, task.id, { request_id: crypto.randomUUID(), task_version: task.version, context_sequence: 1, requirement_ids: [doc.document_id] }),
      c.publish(f.owner.userId, f.workspace, f.project, revise(doc, { body: "New material requirement." })),
    ]);
    assert.equal(revised.status, "fulfilled");
    if (prepared.status === "fulfilled") assert.equal((await c.taskBrief(f.owner.userId, f.workspace, task.id)).check?.state, "stale");
    else { assert.equal(prepared.reason.status, 409); assert.equal((await c.taskBrief(f.owner.userId, f.workspace, task.id)).brief, null); }
  });
  await t.test("publication serializes with a concurrent permission revocation", async () => {
    const f = await fixture(); const c = new ContextRepository(repo);
    await repo.addMember(f.owner.userId, f.workspace, { email: f.other.email, role: "admin" });
    const client = await pool.connect(); let write: Promise<unknown> | undefined;
    try {
      await client.query("BEGIN");
      await client.query("UPDATE memberships SET role='member' WHERE workspace_id=$1 AND user_id=$2", [f.workspace, f.other.userId]);
      write = c.publish(f.other.userId, f.workspace, f.project, publication());
      void write.catch(() => {}); // Keep the original rejection for assert.rejects below.
      // Observe a real database lock instead of depending on a sleep to order writers.
      let blocked = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        const state = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname='stride_test' AND wait_event_type='Lock' AND query LIKE 'UPDATE memberships SET role=role%' LIMIT 1");
        if (state.rowCount) { blocked = true; break; }
        await delay(25);
      }
      assert.equal(blocked, true);
      await client.query("COMMIT");
      await assert.rejects(write, { status: 409 });
      assert.equal((await c.brief(f.owner.userId, f.workspace, f.project)).documents.length, 0);
    } finally { await client.query("ROLLBACK"); client.release(); if (write) await write.catch(() => {}); }
  });
});

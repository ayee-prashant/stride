import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Repository } from "../lib/server/repository.ts";
import { PostgresDatabase } from "../lib/server/postgres-adapter.ts";
import { parseTaskQuery } from "../lib/domain.ts";

const value = process.env.TEST_DATABASE_URL;
if (!value) throw new Error("TEST_DATABASE_URL must point to the isolated local CI database");
const url = new URL(value);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/stride_test") throw new Error("Integration tests require a local database named stride_test");

test("PostgreSQL migrations and repository contract", async t => {
  const pool = new Pool({ connectionString: value, max: 4, connectionTimeoutMillis: 5_000, statement_timeout: 10_000 });
  t.after(() => pool.end());
  await migrate(drizzle(pool), { migrationsFolder: "drizzle-postgres" });
  const db = new PostgresDatabase(pool); const repo = new Repository(db);
  const suffix = crypto.randomUUID();
  const owner = { userId: `owner_${suffix}`, email: `owner_${suffix}@example.test`, displayName: "Fixture owner" };
  const other = { userId: `other_${suffix}`, email: `other_${suffix}@example.test`, displayName: "Fixture member" };
  const result = await repo.bootstrap(owner); await repo.bootstrap(owner); await repo.bootstrap(other);
  const workspace = result.workspaces[0].id;
  const project = (await repo.metadata(owner.userId, workspace)).projects[0].id;
  await assert.rejects(repo.metadata(other.userId, workspace), { status: 404 });
  await assert.rejects(repo.createTask(other.userId, workspace, { title: "Denied", project_id: project }), { status: 404 });
  await repo.addMember(owner.userId, workspace, { email: other.email });
  await assert.rejects(repo.createProject(other.userId, workspace, { name: "Denied" }), { status: 403 });
  let task = await repo.createTask(owner.userId, workspace, { title: "Ship_100%!", project_id: project });
  task = await repo.updateTask(owner.userId, workspace, task.id, { version: task.version, assignee_id: other.userId, status: "in_progress" });
  task = await repo.updateTask(other.userId, workspace, task.id, { version: task.version, status: "done" });
  assert.ok(task.completed_at);
  task = await repo.updateTask(owner.userId, workspace, task.id, { version: task.version, status: "todo" });
  assert.equal(task.completed_at, null);
  assert.equal((await repo.activity(owner.userId, workspace, task.id)).length, 4);
  for (const query of ["%", "_", "!"]) {
    assert.equal((await repo.listTasks(owner.userId, workspace, parseTaskQuery(new URLSearchParams({ query })))).tasks.length, 1);
  }
  const version = task.version;
  const writes = await Promise.allSettled([
    repo.updateTask(owner.userId, workspace, task.id, { version, title: "Writer one" }),
    repo.updateTask(owner.userId, workspace, task.id, { version, title: "Writer two" }),
  ]);
  assert.equal(writes.filter(write => write.status === "fulfilled").length, 1);
  assert.equal(writes.filter(write => write.status === "rejected" && write.reason.status === 409).length, 1);
  assert.equal((await repo.activity(owner.userId, workspace, task.id)).length, 5);
  const before = await repo.task(owner.userId, workspace, task.id);
  await assert.rejects(db.batch([
    db.prepare("UPDATE tasks SET title=? WHERE id=?").bind("Must roll back", task.id),
    db.prepare("INSERT INTO activity (id,workspace_id,task_id,actor_id,action,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), workspace, task.id, "nonexistent-actor", "updated", new Date().toISOString()),
  ]));
  assert.equal((await repo.task(owner.userId, workspace, task.id)).title, before.title);
  task = await repo.updateTask(owner.userId, workspace, task.id, { version: before.version, archived: true });
  assert.equal((await repo.listTasks(owner.userId, workspace, parseTaskQuery(new URLSearchParams()))).tasks.length, 0);
  await repo.updateTask(owner.userId, workspace, task.id, { version: task.version, archived: false });
  for (let i = 0; i < 120; i++) await repo.rateLimit(owner.userId, 60_000);
  await assert.rejects(repo.rateLimit(owner.userId, 60_000), { status: 429 });
  await repo.rateLimit(owner.userId, 120_000);
});

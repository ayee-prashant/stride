import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTaskQuery } from "../lib/domain.ts";
import { fixture } from "./sqlite.ts";
import type { Statement, SqlResult } from "../lib/server/repository.ts";

const query = (s = "") => parseTaskQuery(new URLSearchParams(s));
test("bootstrap is idempotent and creates an empty first project", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  await f.repo.bootstrap(f.owner); await f.repo.bootstrap(f.owner);
  assert.equal(f.db.raw.prepare("SELECT COUNT(*) AS n FROM workspaces WHERE owner_id='owner'").get()?.n, 1);
  assert.equal((await f.repo.metadata("owner", f.workspace)).projects.length, 1);
  assert.equal((await f.repo.listTasks("owner", f.workspace, query())).tasks.length, 0);
});
test("cross-workspace reads and writes are denied", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  await assert.rejects(f.repo.metadata("other", f.workspace), { status: 404 });
  await assert.rejects(f.repo.createTask("other", f.workspace, { title: "Attack", project_id: f.project }), { status: 404 });
  await assert.rejects(f.repo.listTasks("other", f.workspace, query()), { status: 404 });
});
test("members manage tasks but not projects or memberships", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  await f.repo.addMember("owner", f.workspace, { email: f.other.email });
  await f.repo.createTask("other", f.workspace, { title: "Member work", project_id: f.project });
  await assert.rejects(f.repo.createProject("other", f.workspace, { name: "No" }), { status: 403 });
  await assert.rejects(f.repo.addMember("other", f.workspace, { email: f.owner.email }), { status: 403 });
  await assert.rejects(f.repo.addMember("owner", f.workspace, { email: f.owner.email, role: "member" }), { code: "OWNER_PROTECTED" });
});
test("invalid project/assignee references are rejected without partial task or audit rows", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  for (const input of [{ project_id: "project_other" }, { project_id: f.project, assignee_id: "other" }]) await assert.rejects(f.repo.createTask("owner", f.workspace, { title: "Invalid", ...input }), { status: 400 });
  assert.equal(f.db.raw.prepare("SELECT COUNT(*) AS n FROM tasks").get()?.n, 0);
  assert.equal(f.db.raw.prepare("SELECT COUNT(*) AS n FROM activity").get()?.n, 0);
});
test("create, assign, start, complete and reopen preserve state and audit history", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  let task = await f.repo.createTask("owner", f.workspace, { title: "Ship", project_id: f.project });
  task = await f.repo.updateTask("owner", f.workspace, task.id, { version: task.version, assignee_id: "owner", due_date: "2026-09-20" });
  task = await f.repo.updateTask("owner", f.workspace, task.id, { version: task.version, status: "in_progress" });
  task = await f.repo.updateTask("owner", f.workspace, task.id, { version: task.version, status: "done" });
  assert.ok(task.completed_at); assert.equal(task.version, 4);
  assert.equal((await f.repo.listTasks("owner", f.workspace, query())).tasks.length, 0);
  task = await f.repo.updateTask("owner", f.workspace, task.id, { version: task.version, status: "todo" });
  assert.equal(task.completed_at, null); assert.equal(task.assignee_id, "owner");
  assert.equal((await f.repo.activity("owner", f.workspace, task.id)).length, 5);
});
test("stale updates cannot overwrite or create phantom audit events", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  const task = await f.repo.createTask("owner", f.workspace, { title: "Original", project_id: f.project });
  await f.repo.updateTask("owner", f.workspace, task.id, { version: 1, title: "First edit" });
  await assert.rejects(f.repo.updateTask("owner", f.workspace, task.id, { version: 1, title: "Stale edit" }), { status: 409 });
  assert.equal((await f.repo.task("owner", f.workspace, task.id)).title, "First edit");
  assert.equal((await f.repo.activity("owner", f.workspace, task.id)).length, 2);
});
test("task archive hides tasks, protects edits, and supports explicit restore", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  let task = await f.repo.createTask("owner", f.workspace, { title: "Keep", project_id: f.project });
  task = await f.repo.updateTask("owner", f.workspace, task.id, { version: 1, archived: true });
  assert.equal((await f.repo.listTasks("owner", f.workspace, query())).tasks.length, 0);
  assert.equal((await f.repo.listTasks("owner", f.workspace, query("archived=true"))).tasks.length, 1);
  await assert.rejects(f.repo.updateTask("owner", f.workspace, task.id, { version: 2, title: "No" }), { code: "ARCHIVED" });
  task = await f.repo.updateTask("owner", f.workspace, task.id, { version: 2, archived: false });
  assert.equal(task.archived_at, null);
});
test("archived projects hide tasks and block mutation until restored", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  const task = await f.repo.createTask("owner", f.workspace, { title: "Keep", project_id: f.project });
  await f.repo.updateProject("owner", f.workspace, f.project, { version: 1, archived: true });
  await assert.rejects(f.repo.updateTask("owner", f.workspace, task.id, { version: 1, title: "No" }), { status: 409 });
  assert.equal((await f.repo.listTasks("owner", f.workspace, query())).tasks.length, 0);
  await f.repo.updateProject("owner", f.workspace, f.project, { version: 2, archived: false });
  assert.equal((await f.repo.listTasks("owner", f.workspace, query())).tasks.length, 1);
});
test("filtering, literal SQL text, and pagination work without query injection", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  for (let i = 0; i < 5; i++) await f.repo.createTask("owner", f.workspace, { title: i === 0 ? "'; DROP TABLE tasks; -- 100%" : `Task ${i}`, project_id: f.project, priority: i % 2 ? "high" : "low" });
  const page = await f.repo.listTasks("owner", f.workspace, query("limit=2")); assert.equal(page.tasks.length, 2); assert.equal(page.hasMore, true);
  const next = await f.repo.listTasks("owner", f.workspace, query("limit=2&offset=2")); assert.equal(next.tasks.some(row => page.tasks.some(p => p.id === row.id)), false);
  assert.equal((await f.repo.listTasks("owner", f.workspace, query("priority=high"))).tasks.length, 2);
  assert.equal((await f.repo.listTasks("owner", f.workspace, query("query=100%25"))).tasks.length, 1);
});
test("mutation quota resets in the next window and is persisted", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  for (let i = 0; i < 120; i++) await f.repo.rateLimit("owner", 60000);
  await assert.rejects(f.repo.rateLimit("owner", 60000), { status: 429 });
  await f.repo.rateLimit("owner", 120000);
  assert.equal(f.db.raw.prepare("SELECT hits FROM mutation_limits WHERE user_id='owner'").get()?.hits, 1);
});
test("search treats percent, underscore and its escape marker as literal text", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  for (const title of ["Fix_100%!Done", "FixX100ZDone", "Ordinary work"]) {
    await f.repo.createTask("owner", f.workspace, { title, project_id: f.project });
  }
  for (const term of ["_", "%", "!", "fix_100%!done"]) {
    const params = new URLSearchParams({ query: term });
    const result = await f.repo.listTasks("owner", f.workspace, parseTaskQuery(params));
    assert.deepEqual(result.tasks.map(task => task.title), ["Fix_100%!Done"]);
  }
});
test("database rejects cross-tenant project references independent of service validation", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  const task = await f.repo.createTask("owner", f.workspace, { title: "Safe", project_id: f.project });
  assert.throws(() => f.db.raw.prepare("UPDATE tasks SET project_id='project_other' WHERE id=?").run(task.id), /FOREIGN KEY/);
});
test("common project and assignee queries use their intended indexes", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  for (const [field, index] of [["project_id", "idx_tasks_workspace_project_archive"], ["assignee_id", "idx_tasks_workspace_assignee_archive"]]) {
    const plan = f.db.raw.prepare(`EXPLAIN QUERY PLAN SELECT id FROM tasks WHERE workspace_id=? AND ${field}=? AND archived_at IS NULL`).all(f.workspace, f.project);
    assert.ok(plan.some(row => String(row.detail).includes(index)));
  }
});
test("a concurrent update after the read is stopped by SQL compare-and-swap", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  const task = await f.repo.createTask("owner", f.workspace, { title: "Original", project_id: f.project });
  const batch = f.db.batch.bind(f.db);
  f.db.batch = async function<T>(statements: Statement[]): Promise<SqlResult<T>[]> {
    f.db.raw.prepare("UPDATE tasks SET title='Concurrent winner',version=2,last_mutation_id='concurrent' WHERE id=?").run(task.id);
    return batch<T>(statements);
  };
  await assert.rejects(f.repo.updateTask("owner", f.workspace, task.id, { version: 1, title: "Losing edit" }), { status: 409 });
  assert.equal((await f.repo.task("owner", f.workspace, task.id)).title, "Concurrent winner");
  assert.equal((await f.repo.activity("owner", f.workspace, task.id)).length, 1);
});
test("an audit failure rolls the entire task mutation back", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  f.db.raw.exec("CREATE TRIGGER test_reject_audit BEFORE INSERT ON activity BEGIN SELECT RAISE(ABORT,'test failure'); END");
  await assert.rejects(f.repo.createTask("owner", f.workspace, { title: "Rollback", project_id: f.project }));
  assert.equal(f.db.raw.prepare("SELECT COUNT(*) AS n FROM tasks").get()?.n, 0);
});
test("forged reassignment preserves both task and history", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  const task = await f.repo.createTask("owner", f.workspace, { title: "Private", project_id: f.project });
  await assert.rejects(f.repo.updateTask("owner", f.workspace, task.id, { version: 1, assignee_id: "other" }), { status: 409 });
  assert.equal((await f.repo.task("owner", f.workspace, task.id)).assignee_id, null);
  assert.equal((await f.repo.activity("owner", f.workspace, task.id)).length, 1);
});

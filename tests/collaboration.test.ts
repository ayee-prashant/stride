import { test } from "node:test";
import assert from "node:assert/strict";
import { dateAtOffset, parseComment, parseNotificationQuery, parsePageQuery, parseTaskQuery } from "../lib/domain.ts";
import { Repository } from "../lib/server/repository.ts";
import { fixture } from "./sqlite.ts";

const page = { limit: 20, offset: 0, tz_offset: 0 };
const query = (value = "") => parseTaskQuery(new URLSearchParams(value));

test("comment and inbox inputs have bounded, strict schemas", () => {
  assert.deepEqual(parseComment({ body: "  Ready  " }), { body: "Ready", mentioned_user_ids: [] });
  for (const value of [{ body: " " }, { body: "a".repeat(4001) }, { body: "Hi", author_id: "forged" }, { body: "Hi", mentioned_user_ids: ["a", "a"] }, { body: "Hi", mentioned_user_ids: Array.from({ length: 11 }, (_, n) => String(n)) }]) assert.throws(() => parseComment(value));
  for (const value of [{ limit: 51 }, { offset: -1 }, { tz_offset: 841 }, { tz_offset: "0" }, { recipient_id: "other" }]) assert.throws(() => parseNotificationQuery(value));
  for (const value of ["offset=", "limit=0", "limit=51", "offset=100001", "limit=10&limit=20", "author_id=forged"]) assert.throws(() => parsePageQuery(new URLSearchParams(value)));
  assert.equal(dateAtOffset(new Date("2026-09-14T00:30:00Z"), 480), "2026-09-13");
});

test("quick creation has a responsible person and creator-owned tasks stay in My Tasks", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  let task = await f.repo.createTask("owner", f.workspace, { project_id: f.project, title: "Quick task" });
  assert.equal(task.assignee_id, "owner"); assert.equal(task.responsible_id, "owner");
  task = await f.repo.updateTask("owner", f.workspace, task.id, { version: task.version, assignee_id: null });
  assert.equal(task.responsible_id, "owner"); assert.equal(task.responsible_name, "Owner");
  assert.equal((await f.repo.listTasks("owner", f.workspace, query("assignee_id=owner"))).tasks.length, 1);
  assert.equal((await f.repo.notifications("owner", f.workspace, page)).unreadCount, 0);
});

test("assignment alerts are atomic, recipient-private, and absent for stale changes", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  await f.repo.addMember("owner", f.workspace, { email: f.other.email });
  const task = await f.repo.createTask("owner", f.workspace, { project_id: f.project, title: "Assign me" });
  await f.repo.updateTask("owner", f.workspace, task.id, { version: task.version, assignee_id: "other" });
  await assert.rejects(f.repo.updateTask("owner", f.workspace, task.id, { version: task.version, assignee_id: "other" }), { status: 409 });
  const inbox = await f.repo.notifications("other", f.workspace, page);
  assert.equal(inbox.unreadCount, 1); assert.equal(inbox.notifications[0].kind, "assignment");
  assert.equal((await f.repo.notifications("owner", f.workspace, page)).notifications.length, 0);
  await assert.rejects(f.repo.readNotification("owner", f.workspace, inbox.notifications[0].id, {}), { status: 404 });
  await assert.rejects(f.repo.readNotification("other", "ws_other", inbox.notifications[0].id, {}), { status: 404 });
  await f.repo.readNotification("other", f.workspace, inbox.notifications[0].id, {});
  assert.equal((await f.repo.notifications("other", f.workspace, page)).unreadCount, 0);
});

test("comments persist plain text, create activity and notify only valid mentioned teammates", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  const task = await f.repo.createTask("owner", f.workspace, { project_id: f.project, title: "Discuss" });
  await assert.rejects(f.repo.createComment("other", f.workspace, task.id, { body: "Private" }), { status: 404 });
  await assert.rejects(f.repo.createComment("owner", f.workspace, task.id, { body: "Foreign mention", mentioned_user_ids: ["other"] }), { status: 400 });
  await f.repo.addMember("owner", f.workspace, { email: f.other.email });
  const body = "@Other please check <script>alert('text only')</script>";
  const comment = await f.repo.createComment("owner", f.workspace, task.id, { body, mentioned_user_ids: ["other", "owner"] });
  assert.equal(comment.body, body); assert.equal(comment.author_id, "owner");
  const saved = (await f.repo.comments("other", f.workspace, task.id, { limit: 30, offset: 0 })).comments[0];
  assert.deepEqual(saved.mentioned_user_ids, ["other", "owner"]); assert.equal(saved.body, body);
  assert.equal((await f.repo.activity("owner", f.workspace, task.id))[0].action, "commented");
  assert.equal((await f.repo.task("owner", f.workspace, task.id)).version, task.version);
  const inbox = await f.repo.notifications("other", f.workspace, page);
  assert.equal(inbox.unreadCount, 1); assert.equal(inbox.notifications[0].kind, "mention");
  assert.equal((await f.repo.notifications("owner", f.workspace, page)).unreadCount, 0);
});

test("notification failure rolls back the comment and its activity", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  await f.repo.addMember("owner", f.workspace, { email: f.other.email });
  const task = await f.repo.createTask("owner", f.workspace, { project_id: f.project, title: "Atomic" });
  f.db.raw.exec("CREATE TRIGGER deny_notification BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  await assert.rejects(f.repo.createComment("owner", f.workspace, task.id, { body: "Must roll back", mentioned_user_ids: ["other"] }));
  assert.equal((await f.repo.comments("owner", f.workspace, task.id, { limit: 30, offset: 0 })).comments.length, 0);
  assert.equal((await f.repo.activity("owner", f.workspace, task.id)).length, 1);
  await assert.rejects(f.repo.updateTask("owner", f.workspace, task.id, { version: 1, assignee_id: "other" }));
  assert.equal((await f.repo.task("owner", f.workspace, task.id)).version, 1);
});

test("archived projects and deleted tasks reject new comments but retain discussion for restore", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  let task = await f.repo.createTask("owner", f.workspace, { project_id: f.project, title: "Recovery" });
  await f.repo.createComment("owner", f.workspace, task.id, { body: "Keep this context" });
  task = await f.repo.updateTask("owner", f.workspace, task.id, { version: task.version, archived: true });
  await assert.rejects(f.repo.createComment("owner", f.workspace, task.id, { body: "Blocked" }), { status: 409 });
  assert.equal((await f.repo.comments("owner", f.workspace, task.id, { limit: 30, offset: 0 })).comments.length, 1);
  task = await f.repo.updateTask("owner", f.workspace, task.id, { version: task.version, archived: false });
  await f.repo.updateProject("owner", f.workspace, f.project, { version: 1, archived: true });
  await assert.rejects(f.repo.createComment("owner", f.workspace, task.id, { body: "Blocked project" }), { status: 409 });
  assert.equal((await f.repo.comments("owner", f.workspace, task.id, { limit: 30, offset: 0 })).comments.length, 1);
});

test("overdue reminders deduplicate, honor the viewer date, and disappear when resolved", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  const repo = new Repository(f.db, () => new Date("2026-09-14T00:30:00Z"));
  let task = await repo.createTask("owner", f.workspace, { project_id: f.project, title: "Due yesterday", due_date: "2026-09-13" });
  assert.equal((await repo.notifications("owner", f.workspace, { ...page, tz_offset: 480 }, true)).unreadCount, 0);
  assert.equal((await repo.notifications("owner", f.workspace, page, true)).unreadCount, 1);
  assert.equal((await repo.notifications("owner", f.workspace, page, true)).notifications.length, 1);
  assert.equal((await repo.notifications("owner", f.workspace, { ...page, tz_offset: 480 }, true)).notifications.length, 0);
  await repo.readNotification("owner", f.workspace, null, {});
  assert.equal((await repo.notifications("owner", f.workspace, page, true)).unreadCount, 0);
  task = await repo.updateTask("owner", f.workspace, task.id, { version: task.version, due_date: "2026-09-12" });
  assert.equal((await repo.notifications("owner", f.workspace, page, true)).unreadCount, 1);
  await repo.updateTask("owner", f.workspace, task.id, { version: task.version, status: "done" });
  assert.equal((await repo.notifications("owner", f.workspace, page, true)).notifications.length, 0);
});

test("bounded overdue catch-up eventually includes more than one batch", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  const repo = new Repository(f.db, () => new Date("2026-09-14T12:00:00Z"));
  for (let n = 0; n < 103; n++) await repo.createTask("owner", f.workspace, { project_id: f.project, title: `Catch-up ${n}`, due_date: "2026-09-13" });
  assert.equal((await repo.notifications("owner", f.workspace, page, true)).unreadCount, 100);
  assert.equal((await repo.notifications("owner", f.workspace, page, true)).unreadCount, 103);
  assert.equal((await repo.notifications("owner", f.workspace, page, true)).unreadCount, 103);
});

test("date/status filters and priority sorting cover the full filtered result", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  const repo = new Repository(f.db, () => new Date("2026-09-14T12:00:00Z"));
  for (const item of [{ title: "Low overdue", due_date: "2026-09-13", priority: "low" }, { title: "Medium today", due_date: "2026-09-14" }, { title: "High upcoming", due_date: "2026-09-15", priority: "high" }, { title: "No date", status: "in_progress" }, { title: "Completed", due_date: "2026-09-12", status: "done" }]) await repo.createTask("owner", f.workspace, { project_id: f.project, ...item });
  for (const due of ["overdue", "today", "upcoming", "none"]) assert.equal((await repo.listTasks("owner", f.workspace, query(`due=${due}`))).tasks.length, 1);
  assert.equal((await repo.listTasks("owner", f.workspace, query("sort=priority"))).tasks[0].title, "High upcoming");
  assert.equal((await repo.listTasks("owner", f.workspace, query("sort=due_date"))).tasks[0].title, "Low overdue");
  assert.equal((await repo.listTasks("owner", f.workspace, query("status=in_progress"))).tasks[0].title, "No date");
  assert.equal((await repo.listTasks("owner", f.workspace, query("include_done=true&due=overdue"))).tasks.length, 1);
});

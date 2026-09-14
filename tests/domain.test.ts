import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarDate, localToday, parseTaskCreate, parseTaskPatch, parseProject, parseMember, parseTaskQuery, taskGroup } from "../lib/domain.ts";

test("title-only tasks have safe defaults and no invented due date or owner", () => {
  assert.deepEqual(parseTaskCreate({ title: "  Ship  ", project_id: "p" }), { title: "Ship", project_id: "p", description: "", status: "todo", priority: "medium", assignee_id: null, due_date: null });
});
test("task inputs reject excess fields, blank titles, long text, and invalid enums", () => {
  for (const patch of [{ title: " " }, { title: "a".repeat(201) }, { status: "review" }, { priority: "urgent" }, { role: "admin" }, { description: "a".repeat(8001) }]) assert.throws(() => parseTaskCreate({ title: "Task", project_id: "p", ...patch }));
});
test("invalid JSON shapes and control characters are rejected", () => {
  for (const input of [null, [], "task", 1, { title: "a\u0000b", project_id: "p" }]) assert.throws(() => parseTaskCreate(input));
});
test("calendar validation rejects normalized non-dates and accepts leap days", () => {
  assert.equal(calendarDate("2024-02-29"), "2024-02-29"); assert.equal(calendarDate(null), null);
  for (const input of ["2025-02-29", "2026-04-31", "2026-13-01", "2026-01-01T00:00Z", "1899-01-01", ""]) assert.throws(() => calendarDate(input));
});
test("patches require versions, preserve explicit null, and reject moves", () => {
  assert.deepEqual(parseTaskPatch({ version: 2, assignee_id: null, due_date: null }), { version: 2, assignee_id: null, due_date: null });
  for (const input of [{ title: "New" }, { version: 0, status: "done" }, { version: 1 }, { version: 1, project_id: "other" }, { version: 1, archived: "true" }]) assert.throws(() => parseTaskPatch(input));
});
test("project and member values are normalized and limited", () => {
  assert.equal(parseProject({ name: " A " }).name, "A");
  assert.deepEqual(parseMember({ email: " USER@EXAMPLE.TEST " }), { email: "user@example.test", role: "member" });
  assert.throws(() => parseMember({ email: "invalid" })); assert.throws(() => parseMember({ email: "u@x.test", role: "owner" }));
});
test("pagination and search are bounded and reject duplicate parameters", () => {
  assert.equal(parseTaskQuery(new URLSearchParams()).limit, 50);
  for (const query of ["limit=101", "limit=0", "offset=-1", "offset=100001", "limit=10&limit=20", "include_done=maybe", "sort=raw-sql"]) assert.throws(() => parseTaskQuery(new URLSearchParams(query)));
});
test("urgency uses date-only comparison and never labels completed work overdue", () => {
  assert.equal(taskGroup({ status: "todo", due_date: "2026-09-13" }, "2026-09-14"), "Overdue");
  assert.equal(taskGroup({ status: "todo", due_date: "2026-09-14" }, "2026-09-14"), "Today");
  assert.equal(taskGroup({ status: "todo", due_date: "2026-09-15" }, "2026-09-14"), "Upcoming");
  assert.equal(taskGroup({ status: "todo", due_date: null }, "2026-09-14"), "No due date");
  assert.equal(taskGroup({ status: "done", due_date: "2026-09-13" }, "2026-09-14"), "Completed");
  assert.equal(localToday(new Date(2026, 8, 14, 1)), "2026-09-14");
});

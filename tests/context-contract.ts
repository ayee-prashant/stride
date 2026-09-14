import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { Identity } from "../lib/domain.ts";
import type { ContextPublish, ContextRevision } from "../lib/context.ts";
import { ContextRepository } from "../lib/server/context-repository.ts";
import type { Repository } from "../lib/server/repository.ts";

export const publication = (overrides: Partial<ContextPublish> = {}): ContextPublish => ({
  request_id: crypto.randomUUID(), document_id: null, expected_version: 0, kind: "requirement",
  title: "Users can reset their password", body: "An admitted user can request a single-use reset link. Expired links fail safely.",
  state: "active", change_note: "Accept the password recovery requirement.", ...overrides,
});
export const revise = (document: ContextRevision, overrides: Partial<ContextPublish> = {}) => publication({
  document_id: document.document_id, expected_version: document.version, kind: document.kind,
  title: document.title, body: document.body, state: document.state, ...overrides,
});
type Fixture = { repo: Repository; owner: Identity; other: Identity; workspace: string; project: string };

/** Same behavioral contract runs against native SQLite and real PostgreSQL migrations. */
export async function contextContract(t: TestContext, fixture: () => Promise<Fixture>) {
  await t.test("only current human admins publish; members read and tenant boundaries hide history", async () => {
    const f = await fixture(); const c = new ContextRepository(f.repo);
    assert.deepEqual(await c.brief(f.owner.userId, f.workspace, f.project), { sequence: 0, documents: [], can_publish: true });
    await assert.rejects(c.brief(f.other.userId, f.workspace, f.project), { status: 404 });
    await f.repo.addMember(f.owner.userId, f.workspace, { email: f.other.email });
    await assert.rejects(c.publish(f.other.userId, f.workspace, f.project, publication()), { status: 403 });
    const doc = await c.publish(f.owner.userId, f.workspace, f.project, publication());
    assert.equal(doc.approved_by, f.owner.userId);
    assert.equal((await c.brief(f.other.userId, f.workspace, f.project)).can_publish, false);
    await f.repo.statement("DELETE FROM memberships WHERE workspace_id=? AND user_id=?", f.workspace, f.other.userId).run();
    await assert.rejects(c.history(f.other.userId, f.workspace, f.project, doc.document_id), { status: 404 });
    await assert.rejects(c.changes(f.other.userId, f.workspace, f.project, 0), { status: 404 });
  });
  await t.test("publication preserves original revisions, rejects stale writers and replays a lost response once", async () => {
    const f = await fixture(); const c = new ContextRepository(f.repo); const input = publication();
    const first = await c.publish(f.owner.userId, f.workspace, f.project, input);
    assert.deepEqual(await c.publish(f.owner.userId, f.workspace, f.project, input), first);
    await assert.rejects(c.publish(f.owner.userId, f.workspace, f.project, { ...input, body: "Different request" }), { status: 409 });
    const second = await c.publish(f.owner.userId, f.workspace, f.project, revise(first, { body: "Accepted links expire after fifteen minutes." }));
    await assert.rejects(c.publish(f.owner.userId, f.workspace, f.project, revise(first)), { status: 409 });
    const history = await c.history(f.owner.userId, f.workspace, f.project, first.document_id);
    assert.deepEqual(history.revisions, [second, first]);
    assert.equal((await c.brief(f.owner.userId, f.workspace, f.project)).sequence, 2);
    const events = await c.changes(f.owner.userId, f.workspace, f.project, 0);
    assert.deepEqual(events.events.map(e => e.sequence), [1, 2]);
    assert.equal(events.next_cursor, 2);
    assert.deepEqual((await c.changes(f.owner.userId, f.workspace, f.project, 2)).events, []);
  });
  await t.test("duplicate active titles require reviewing the existing document", async () => {
    const f = await fixture(); const c = new ContextRepository(f.repo);
    const doc = await c.publish(f.owner.userId, f.workspace, f.project, publication());
    await assert.rejects(c.publish(f.owner.userId, f.workspace, f.project, publication({ title: doc.title.toUpperCase() })), { status: 409 });
    await c.publish(f.owner.userId, f.workspace, f.project, revise(doc, { state: "retired" }));
    assert.equal((await c.brief(f.owner.userId, f.workspace, f.project)).documents[0].state, "retired");
  });
  await t.test("briefs include selected requirements and all decisions and constraints, with immutable evidence", async () => {
    const f = await fixture(); const c = new ContextRepository(f.repo);
    const requirement = await c.publish(f.owner.userId, f.workspace, f.project, publication());
    const decision = await c.publish(f.owner.userId, f.workspace, f.project, publication({ kind: "decision", title: "Use existing authentication" }));
    const constraint = await c.publish(f.owner.userId, f.workspace, f.project, publication({ kind: "constraint", title: "Do not log reset tokens" }));
    await c.publish(f.owner.userId, f.workspace, f.project, publication({ title: "Unrelated billing requirement" }));
    const task = await f.repo.createTask(f.owner.userId, f.workspace, { project_id: f.project, title: "Implement reset expiry" });
    const input = { request_id: crypto.randomUUID(), task_version: task.version, requirement_ids: [requirement.document_id], context_sequence: 4 };
    const result = await c.createTaskBrief(f.owner.userId, f.workspace, task.id, input);
    assert.ok(result.brief);
    assert.equal(result.check?.state, "current");
    assert.equal(result.check?.execution_ready, false);
    assert.equal(result.brief.payload.source_coverage.github, "not_connected");
    assert.deepEqual(new Set(result.brief.payload.documents.map(d => d.document_id)), new Set([requirement.document_id, decision.document_id, constraint.document_id]));
    assert.deepEqual((await c.createTaskBrief(f.owner.userId, f.workspace, task.id, input)).brief, result.brief);
    await assert.rejects(c.createTaskBrief(f.owner.userId, f.workspace, task.id, { ...input, requirement_ids: [decision.document_id] }), { status: 409 });
    await c.publish(f.owner.userId, f.workspace, f.project, revise(requirement, { body: "Changed expiry requirement." }));
    const stale = await c.taskBrief(f.owner.userId, f.workspace, task.id, result.brief.id);
    assert.equal(stale.check?.state, "stale");
    assert.deepEqual(stale.brief, result.brief);
    await assert.rejects(c.createTaskBrief(f.owner.userId, f.workspace, task.id, { ...input, request_id: crypto.randomUUID() }), { status: 409 });
  });
  await t.test("unrelated requirements and status changes preserve a brief; new project constraints invalidate it", async () => {
    const f = await fixture(); const c = new ContextRepository(f.repo);
    const requirement = await c.publish(f.owner.userId, f.workspace, f.project, publication());
    let task = await f.repo.createTask(f.owner.userId, f.workspace, { project_id: f.project, title: "Implement reset expiry" });
    await c.createTaskBrief(f.owner.userId, f.workspace, task.id, { request_id: crypto.randomUUID(), task_version: task.version, requirement_ids: [requirement.document_id], context_sequence: 1 });
    await c.publish(f.owner.userId, f.workspace, f.project, publication({ title: "Unrelated dashboard" }));
    task = await f.repo.updateTask(f.owner.userId, f.workspace, task.id, { version: task.version, status: "in_progress" });
    assert.equal((await c.taskBrief(f.owner.userId, f.workspace, task.id)).check?.state, "current");
    await c.publish(f.owner.userId, f.workspace, f.project, publication({ kind: "constraint", title: "Use approved email provider" }));
    assert.equal((await c.taskBrief(f.owner.userId, f.workspace, task.id)).check?.state, "stale");
  });
  await t.test("task scope changes and retired requirements invalidate prior briefs", async () => {
    const f = await fixture(); const c = new ContextRepository(f.repo);
    const doc = await c.publish(f.owner.userId, f.workspace, f.project, publication());
    let task = await f.repo.createTask(f.owner.userId, f.workspace, { project_id: f.project, title: "Implement reset expiry" });
    await c.createTaskBrief(f.owner.userId, f.workspace, task.id, { request_id: crypto.randomUUID(), task_version: task.version, requirement_ids: [doc.document_id], context_sequence: 1 });
    task = await f.repo.updateTask(f.owner.userId, f.workspace, task.id, { version: task.version, description: "Also handle revoked admissions." });
    assert.deepEqual((await c.taskBrief(f.owner.userId, f.workspace, task.id)).check?.reasons, ["The task title or description changed."]);
    await c.publish(f.owner.userId, f.workspace, f.project, revise(doc, { state: "retired" }));
    assert.equal((await c.taskBrief(f.owner.userId, f.workspace, task.id)).check?.reasons.length, 2);
    await f.repo.updateTask(f.owner.userId, f.workspace, task.id, { version: task.version, status: "done" });
    assert.equal((await c.taskBrief(f.owner.userId, f.workspace, task.id)).check?.state, "unavailable");
  });
  await t.test("cross-project requirements, forged approvals and archived projects cannot enter briefs", async () => {
    const f = await fixture(); const c = new ContextRepository(f.repo);
    const second = await f.repo.createProject(f.owner.userId, f.workspace, { name: "Separate project", description: "" });
    const doc = await c.publish(f.owner.userId, f.workspace, second.id, publication());
    const task = await f.repo.createTask(f.owner.userId, f.workspace, { project_id: f.project, title: "Implement reset expiry" });
    await assert.rejects(c.createTaskBrief(f.owner.userId, f.workspace, task.id, { request_id: crypto.randomUUID(), task_version: task.version, requirement_ids: [doc.document_id], context_sequence: 0 }), { status: 400 });
    await assert.rejects(c.publish(f.owner.userId, f.workspace, f.project, { ...publication(), approved_by: "agent" }), { status: 400 });
    await f.repo.updateProject(f.owner.userId, f.workspace, second.id, { version: second.version, archived: true });
    assert.equal((await c.brief(f.owner.userId, f.workspace, second.id)).can_publish, false);
    await assert.rejects(c.publish(f.owner.userId, f.workspace, second.id, publication()), { status: 409 });
  });
}

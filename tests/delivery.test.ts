import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./sqlite.ts";
import { DeliveryService } from "../lib/server/delivery-service.ts";
import { AgentConnections } from "../lib/server/agent-connections.ts";
import { AgentRegistryRepository } from "../lib/server/agent-registry.ts";
import { digest } from "../lib/server/delivery-store.ts";
import { parseReport, validatePlan } from "../lib/delivery.ts";
import type { AgentActor, AgentReport } from "../lib/delivery.ts";
import { REVIEW_GATES } from "../lib/delivery.ts";

const rid = () => crypto.randomUUID();
const report = (): AgentReport => ({ outcome: "pass", summary: "Requirements prepared for human acceptance", evidence: { summary: "Reviewed the human brief", checks: [{ name: "Scope reviewed", result: "pass", details: "Acceptance criteria and exclusions recorded" }], candidate: null, environment: null, artifact: null }, findings: [], requirements: [{ title: "Simple task completion", body: "A signed-in human can complete their assigned task. Keep agent approval boundaries explicit." }], plan: [], next_action: "BA human to review requirements" });
async function setup() {
  const f = await fixture(); const s = new DeliveryService(f.repo); const c = new AgentConnections(f.repo); const roles = new AgentRegistryRepository(f.repo); const user = f.owner.userId;
  await s.initialize(user, f.workspace, f.project, { request_id: rid(), expected_version: 0, reviewers: Object.fromEntries(REVIEW_GATES.map(g => [g, user])), reason: "Initialize accountable humans" });
  const template = roles.template("business_analysis");
  const registration = await roles.register(user, f.workspace, f.project, { request_id: rid(), role_id: "business_analysis", template_hash: template.hash, profile: { alias: "BA 1", operator_id: user, tool_label: "CLI" }, read_paths: ["docs"], write_paths: [], reason: "Requirements specialist" });
  const b = (await roles.mutate(user, f.workspace, f.project, registration.binding.id, "initialize", { request_id: rid(), expected_version: registration.binding.version, template_hash: template.hash, reason: "Accept responsibility" })).binding;
  const result = await s.createDiscovery(user, f.workspace, f.project, { request_id: rid(), kind: "requirements", title: "Define first release", description: "Make tasks easy while humans approve agent work", acceptance: ["Clear in-scope and excluded behavior"] });
  const t = result.ticket!;
  const assigned = await s.assign(user, f.workspace, f.project, t.id, { request_id: rid(), expected_version: t.version, binding_id: b.id, reason: "Manually selected BA 1" });
  const enrolled = await c.enroll(user, f.workspace, f.project, { request_id: rid(), binding_id: b.id, binding_version: b.version, template_hash: b.template_hash, name: "BA laptop", accept_responsibility: true });
  const connection = await c.attachClients(user, f.workspace, f.project, enrolled.id, { agent: rid(), companion: rid() });
  const actor: AgentActor = { kind: "agent", connection_id: connection.id, profile_id: b.profile_id, operator_id: user, workspace_id: f.workspace, project_id: f.project, session_id: "isolated-contract-session" };
  const packet = (await s.detail(user, f.workspace, f.project, t.id)).packet!;
  await c.initialize(actor, { request_id: rid(), template_hash: b.template_hash, accept_role: true, accept_exclusions: true });
  const prepare = () => c.heartbeat(actor, { preparation: { packet_id: packet.id, packet_hash: packet.hash, checkout: null, repository_id: null, clean: true } });
  await prepare();
  const startInput = { request_id: rid(), expected_version: assigned.ticket!.version, connection_id: connection.id, packet_hash: packet.hash, accept_start: true, reason: "Reviewed exact BA work and local preparation" };
  return { ...f, s, c, roles, b, t, actor, connection, packet, prepare, startInput };
}
test("BA work needs role acknowledgement, companion preparation and a separate exact human start", async () => {
  const f = await setup();
  await assert.rejects(f.s.claim(f.actor, { request_id: rid(), ticket_id: f.t.id, attempt_id: rid(), packet_hash: f.packet.hash }));
  await assert.rejects(f.repo.updateTask(f.owner.userId, f.workspace, f.t.task_id, { version: 1, status: "done" }), /human delivery gates/);
  const authorized = await f.s.authorizeStart(f.owner.userId, f.workspace, f.project, f.t.id, f.startInput);
  const input = { request_id: rid(), ticket_id: f.t.id, attempt_id: authorized.ticket!.attempt_id, packet_hash: f.packet.hash };
  const started = await f.s.claim(f.actor, input); assert.equal(started.execution_authorized, true);
  assert.equal((await f.s.claim(f.actor, input)).replayed, true);
  const outcome = report();
  const submitted = await f.s.writeAttempt(f.actor, "submit", { request_id: rid(), attempt_id: authorized.ticket!.attempt_id, expected_version: 2, submit: outcome });
  assert.equal(submitted.ticket!.phase, "in_review");
  assert.equal((await f.s.configuration(f.workspace, f.project)).baseline, null);
  const reviewed = await f.s.review(f.owner.userId, f.workspace, f.project, f.t.id, { request_id: rid(), expected_version: submitted.ticket!.version, decision: "accept", report_hash: digest(outcome), reason: "Scope and acceptance criteria approved by BA human" });
  assert.equal(reviewed.ticket!.phase, "accepted");
  assert.equal((await f.repo.task(f.owner.userId, f.workspace, f.t.task_id)).status, "done");
  assert.equal((await f.s.configuration(f.workspace, f.project)).baseline?.documents.length, 1);
  const events = await f.repo.statement("SELECT actor_kind,actor_id,operator_id FROM delivery_events WHERE action='report_submitted'").first<{ actor_kind: string; actor_id: string; operator_id: string }>();
  assert.equal(events?.actor_kind, "agent"); assert.equal(events?.actor_id, f.b.profile_id); assert.equal(events?.operator_id, f.owner.userId);
  await assert.rejects(f.repo.updateTask(f.owner.userId, f.workspace, f.t.task_id, { version: 2, status: "todo" }), /immutable/);
});
test("revocation fences claims and writes; reconnecting does not revive an old approval", async () => {
  const f = await setup(); const started = await f.s.authorizeStart(f.owner.userId, f.workspace, f.project, f.t.id, f.startInput);
  const current = await f.c.connection(f.workspace, f.project, f.connection.id);
  await f.c.revoke(f.owner.userId, f.workspace, f.project, current.id, { request_id: rid(), expected_version: current.version, reason: "Laptop disconnected" });
  await assert.rejects(f.s.claim(f.actor, { request_id: rid(), ticket_id: f.t.id, attempt_id: started.ticket!.attempt_id, packet_hash: f.packet.hash }), /revoked/);
  assert.equal((await f.s.attempt(f.workspace, f.project, started.ticket!.attempt_id!)).state, "cancelled");
});
test("expired companion lease cannot be resurrected by a late heartbeat", async () => {
  const f = await setup(); const authorized = await f.s.authorizeStart(f.owner.userId, f.workspace, f.project, f.t.id, f.startInput);
  await f.s.claim(f.actor, { request_id: rid(), ticket_id: f.t.id, attempt_id: authorized.ticket!.attempt_id, packet_hash: f.packet.hash });
  await f.repo.statement("UPDATE delivery_attempts SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?", authorized.ticket!.attempt_id!).run();
  await f.prepare(); await f.s.reconcile();
  assert.equal((await f.s.attempt(f.workspace, f.project, authorized.ticket!.attempt_id!)).state, "lease_lost");
  await assert.rejects(f.s.writeAttempt(f.actor, "submit", { request_id: rid(), attempt_id: authorized.ticket!.attempt_id, expected_version: 2, submit: report() }), /no longer active/);
});
test("removed and re-added membership has a new epoch and rejects the previous connection", async () => {
  const f = await setup(); await f.repo.addMember(f.owner.userId, f.workspace, { email: f.other.email, role: "member" });
  const before = await f.repo.statement("SELECT epoch FROM memberships WHERE workspace_id=? AND user_id=?", f.workspace, f.other.userId).first<{ epoch: string }>();
  await f.repo.statement("DELETE FROM memberships WHERE workspace_id=? AND user_id=?", f.workspace, f.other.userId).run();
  await f.repo.addMember(f.owner.userId, f.workspace, { email: f.other.email, role: "member" });
  const after = await f.repo.statement("SELECT epoch FROM memberships WHERE workspace_id=? AND user_id=?", f.workspace, f.other.userId).first<{ epoch: string }>();
  assert.notEqual(before?.epoch, after?.epoch);
  await f.repo.statement("UPDATE memberships SET epoch=? WHERE workspace_id=? AND user_id=?", rid(), f.workspace, f.owner.userId).run();
  await assert.rejects(f.c.validateConnection(f.actor), /membership|Membership/);
});
test("strict reports reject fake authority, contradictory QA and cyclic plans", () => {
  assert.throws(() => parseReport({ ...report(), approved_by: "agent" }));
  const failed = report(); failed.evidence.checks[0].result = "fail"; assert.throws(() => parseReport(failed), /passing report/);
  const issues = report(); issues.outcome = "issues"; assert.throws(() => parseReport(issues), /findings/);
  assert.throws(() => validatePlan([{ key: "a", depends_on: ["b"] }, { key: "b", depends_on: ["a"] }] as never), /acyclic/);
});

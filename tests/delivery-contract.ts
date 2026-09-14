import type { Identity } from "../lib/domain.ts";
import { DeliveryService } from "../lib/server/delivery-service.ts";
import { AgentConnections } from "../lib/server/agent-connections.ts";
import { AgentRegistryRepository } from "../lib/server/agent-registry.ts";
import type { Repository } from "../lib/server/repository.ts";
import type { AgentActor, AgentReport } from "../lib/delivery.ts";
import { REVIEW_GATES } from "../lib/delivery.ts";
import assert from "node:assert/strict";
import type { AgentRole } from "../lib/agents.ts";
import type { DeliveryTicket, Candidate, VerifiedEvidence } from "../lib/delivery.ts";
import { parseBinding } from "../lib/github-context.ts";
import { RepositorySources } from "../lib/server/repository-sources.ts";
import { observation } from "./repository-source-contract.ts";
import { digest } from "../lib/server/delivery-store.ts";
export type DeliveryFixture = { repo: Repository; owner: Identity; other: Identity; workspace: string; project: string };
export const rid = () => crypto.randomUUID();
export const report = (): AgentReport => ({ outcome: "pass", summary: "Requirements prepared for human acceptance", evidence: { summary: "Reviewed the human brief", checks: [{ name: "Scope reviewed", result: "pass", details: "Acceptance criteria and exclusions recorded" }], candidate: null, environment: null, artifact: null }, findings: [], requirements: [{ title: "Simple task completion", body: "A signed-in human can complete their assigned task. Keep agent approval boundaries explicit." }], plan: [], next_action: "BA human to review requirements" });
export async function setupDelivery(makeFixture: () => Promise<DeliveryFixture>) {
  const f = await makeFixture(); const isolatedOptions = { sessionActive: async () => true }; const s = new DeliveryService(f.repo, isolatedOptions); const c = new AgentConnections(f.repo, isolatedOptions); const roles = new AgentRegistryRepository(f.repo); const user = f.owner.userId;
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

export async function completeDelivery(makeFixture: () => Promise<DeliveryFixture>) {
  const f = await setupDelivery(makeFixture); const user = f.owner.userId; let current = f.t;
  async function submitAssigned(ticket: DeliveryTicket, actor: AgentActor, packetHash: string, connectionId: string, result: AgentReport) {
    const authorized = await f.s.authorizeStart(user, f.workspace, f.project, ticket.id, { request_id: rid(), expected_version: ticket.version, connection_id: connectionId, packet_hash: packetHash, accept_start: true, reason: "Human reviewed the exact work packet" });
    const claimed = await f.s.claim(actor, { request_id: rid(), ticket_id: ticket.id, attempt_id: authorized.ticket!.attempt_id, packet_hash: packetHash }); assert.equal(claimed.execution_authorized, true);
    const saved = await f.s.writeAttempt(actor, "submit", { request_id: rid(), attempt_id: authorized.ticket!.attempt_id, expected_version: 2, submit: result });
    return saved.ticket!;
  }
  async function accept(ticket: DeliveryTicket, _result: AgentReport) { void _result; return (await f.s.review(user, f.workspace, f.project, ticket.id, { request_id: rid(), expected_version: ticket.version, decision: "accept", report_hash: digest(ticket.payload.report), reason: "Human independently reviewed the submitted outcome" })).ticket!; }
  const ba = report(); current = await f.s.ticket(f.workspace, f.project, f.t.id); current = await submitAssigned(current, f.actor, f.packet.hash, f.connection.id, ba); await accept(current, ba);
  const binding = parseBinding({ key: `test_${rid()}`, workspace_id: f.workspace, project_id: f.project, repository_id: 1234, installation_id: 5678, owner: "fixture", repository: "project", branch: "main", paths: ["docs/ARCHITECTURE.md"] });
  const sources = new RepositorySources(f.repo, [binding]); await sources.connect(user, f.workspace, f.project, { request_id: rid(), binding_key: binding.key, version: 0 });
  const sourceClaim = await sources.claim(); assert.ok(sourceClaim); await sources.finish(sourceClaim, { ...observation(binding), observed_at: f.repo.now().toISOString() });
  const options = { sessionActive: async () => true, bindings: [binding], verifyEvidence: async (input: { candidate: Candidate; environment?: string; artifact?: string }): Promise<VerifiedEvidence> => ({ provenance: "github_verified", ...input.candidate, checks: [{ name: "Independent provider fixture", conclusion: "success" }], deployment: input.environment ? { id: "fixture-deployment", environment: input.environment, artifact: input.artifact!, state: "success" } : null, observed_at: f.repo.now().toISOString() }) };
  f.s = new DeliveryService(f.repo, options); f.c = new AgentConnections(f.repo, options);
  const actors = new Map<AgentRole, { actor: AgentActor; bindingId: string; connectionId: string }>();
  async function stage(ticket: DeliveryTicket, result: AgentReport) {
    let a = actors.get(ticket.role_id);
    if (!a) {
      const template = f.roles.template(ticket.role_id); const registered = (await f.roles.register(user, f.workspace, f.project, { request_id: rid(), role_id: ticket.role_id, template_hash: template.hash, profile: { alias: `${ticket.role_id} 1`, operator_id: user, tool_label: "Contract client" }, read_paths: ["docs/"], write_paths: ticket.role_id === "development" ? ["docs/"] : [], reason: "Initialize specialist responsibilities" })).binding;
      const approved = (await f.roles.mutate(user, f.workspace, f.project, registered.id, "initialize", { request_id: rid(), expected_version: registered.version, template_hash: template.hash, reason: "Operator accepted role and exclusions" })).binding;
      const enrolled = await f.c.enroll(user, f.workspace, f.project, { request_id: rid(), binding_id: approved.id, binding_version: approved.version, template_hash: approved.template_hash, name: `${ticket.role_id} laptop`, accept_responsibility: true });
      const conn = await f.c.attachClients(user, f.workspace, f.project, enrolled.id, { agent: rid(), companion: rid() });
      const actor: AgentActor = { ...f.actor, connection_id: conn.id, profile_id: approved.profile_id };
      await f.c.initialize(actor, { request_id: rid(), template_hash: approved.template_hash, accept_role: true, accept_exclusions: true });
      a = { actor, bindingId: approved.id, connectionId: conn.id }; actors.set(ticket.role_id, a);
    }
    const assigned = (await f.s.assign(user, f.workspace, f.project, ticket.id, { request_id: rid(), expected_version: ticket.version, binding_id: a.bindingId, reason: "Manual assignment based on availability" })).ticket!;
    const packet = (await f.s.detail(user, f.workspace, f.project, ticket.id)).packet!;
    await f.c.heartbeat(a.actor, { preparation: { packet_id: packet.id, packet_hash: packet.hash, checkout: packet.payload.candidate?.commit ?? packet.payload.repository?.commit ?? null, repository_id: packet.payload.repository?.repository_id ?? null, clean: true } });
    return submitAssigned(assigned, a.actor, packet.hash, a.connectionId, result);
  }
  const architecture = (await f.s.createDiscovery(user, f.workspace, f.project, { request_id: rid(), kind: "architecture", title: "Design the delivery", description: "Review the accepted baseline and create a bounded plan", acceptance: ["Each ticket has scope and a human review path"] })).ticket!;
  const baseline = (await f.s.configuration(f.workspace, f.project)).baseline!;
  const design: AgentReport = { ...report(), summary: "Plan prepared", requirements: [{ title: "Approved architecture", body: "Use the existing modular monolith and explicit human gates." }], plan: [{ key: "TASK-1", title: "Implement task completion", description: "Implement only the accepted task behavior", requirement_ids: baseline.documents.map(d => d.id), acceptance: ["Task completion is authorized and logged"], todo: ["Implement", "Test", "Submit evidence"], read_paths: ["docs"], write_paths: ["docs"], depends_on: [], review_roles: ["security_review", "ux_accessibility", "performance_data", "documentation"] }] };
  await accept(await stage(architecture, design), design);
  const ticketRows = await f.repo.statement("SELECT id FROM delivery_tickets WHERE workspace_id=? AND project_id=? AND kind='delivery'", f.workspace, f.project).all<{ id: string }>(); assert.equal(ticketRows.results.length, 1);
  current = await f.s.ticket(f.workspace, f.project, ticketRows.results[0].id);
  const candidate: Candidate = { repository_id: 1234, commit: "b".repeat(40), pull_request: 8 };
  const implementation: AgentReport = { ...report(), summary: "Implementation checked", requirements: [], evidence: { ...report().evidence, candidate } };
  current = await accept(await stage(current, implementation), implementation);
  for (const role of ["security_review", "ux_accessibility", "performance_data", "documentation", "peer_review"] as const) { assert.equal(current.role_id, role); current = await accept(await stage(current, implementation), implementation); }
  assert.equal(current.role_id, "quality_assurance");
  const failure: AgentReport = { ...implementation, outcome: "issues", findings: [{ title: "Missing negative case", reproduction: "Use a revoked session", expected: "Access denied", actual: "Request accepted", route: "development" }] };
  current = await stage(current, failure);
  await assert.rejects(accept(current, failure), /cannot pass/);
  await assert.rejects(f.s.authorizeEnvironment(user, f.workspace, f.project, current.id, "uat", { request_id: rid(), expected_version: current.version, environment: "uat", artifact: "immutable-test-artifact", reason: "Invalid attempt to skip failed QA", accept_authorization: true }));
  current = (await f.s.review(user, f.workspace, f.project, current.id, { request_id: rid(), expected_version: current.version, decision: "return", report_hash: digest(failure), reason: "Confirmed QA finding; return to development" })).ticket!;
  assert.equal(current.role_id, "development"); assert.equal(current.payload.candidate, null);
  current = await accept(await stage(current, implementation), implementation);
  for (const role of ["security_review", "ux_accessibility", "performance_data", "documentation", "peer_review", "quality_assurance"] as const) { assert.equal(current.role_id, role); current = await accept(await stage(current, implementation), implementation); }
  assert.equal(current.phase, "uat_authorization");
  current = (await f.s.authorizeEnvironment(user, f.workspace, f.project, current.id, "uat", { request_id: rid(), expected_version: current.version, environment: "uat", artifact: "immutable-test-artifact", reason: "Reviewed the deployed UAT candidate", accept_authorization: true })).ticket!;
  const uat: AgentReport = { ...implementation, evidence: { ...implementation.evidence, environment: "uat", artifact: "immutable-test-artifact" } };
  current = await accept(await stage(current, uat), uat); assert.equal(current.phase, "release_authorization");
  await assert.rejects(f.s.authorizeEnvironment(user, f.workspace, f.project, current.id, "release", { request_id: rid(), expected_version: current.version, environment: "production", artifact: "different-artifact", configuration: "v1", migration: "None", recovery: "Rollback", reason: "Invalid artifact swap", accept_authorization: true }), /passed UAT/);
  current = (await f.s.authorizeEnvironment(user, f.workspace, f.project, current.id, "release", { request_id: rid(), expected_version: current.version, environment: "production", artifact: "immutable-test-artifact", configuration: "v1", migration: "No schema changes", recovery: "Restore prior image and verify health", reason: "Approved exact tested artifact for production", accept_authorization: true })).ticket!;
  const production: AgentReport = { ...implementation, evidence: { ...implementation.evidence, environment: "production", artifact: "immutable-test-artifact" } };
  current = await accept(await stage(current, production), production); assert.equal(current.phase, "accepted"); assert.equal((await f.repo.task(user, f.workspace, current.task_id)).status, "done");
  return { ...f, current };
}

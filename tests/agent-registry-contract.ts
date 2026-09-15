import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { AgentRegistryRepository } from "../lib/server/agent-registry.ts";
import type { AgentBinding } from "../lib/agents.ts";
import type { Identity } from "../lib/domain.ts";
import type { Repository } from "../lib/server/repository.ts";

type Fixture = { repo: Repository; owner: Identity; other: Identity; workspace: string; project: string };
export function registration(service: AgentRegistryRepository, operator: string, overrides: Record<string, unknown> = {}) {
  return { request_id: crypto.randomUUID(), profile: { alias: "DEV-1", operator_id: operator, tool_label: "Reported test tool" }, role_id: "development", template_hash: service.template("development").hash, read_paths: ["lib/", "tests/"], write_paths: ["lib/", "tests/"], reason: "Review a scoped developer role", ...overrides };
}
export function decision(binding: AgentBinding) { return { request_id: crypto.randomUUID(), expected_version: binding.version, template_hash: binding.template_hash, reason: "I reviewed this role and accept operator responsibility" }; }

export async function agentRegistryContract(t: TestContext, fixture: () => Promise<Fixture>) {
  await t.test("registration preserves identity and waits for the named human operator", async () => {
    const f = await fixture(); const s = new AgentRegistryRepository(f.repo);
    await f.repo.addMember(f.owner.userId, f.workspace, { email: f.other.email, role: "member" });
    const v = registration(s, f.other.userId); const created = await s.register(f.owner.userId, f.workspace, f.project, v);
    assert.match(created.binding.profile_id, /^[a-f0-9-]{36}$/); assert.equal(created.binding.state, "pending");
    assert.equal(created.binding.execution_ready, false); assert.equal(created.binding.connection_state, "not_connected");
    await assert.rejects(s.mutate(f.owner.userId, f.workspace, f.project, created.binding.id, "initialize", decision(created.binding)), { status: 403 });
    const accepted = await s.mutate(f.other.userId, f.workspace, f.project, created.binding.id, "initialize", decision(created.binding));
    assert.equal(accepted.binding.state, "initialized"); assert.equal(accepted.binding.approved_by, f.other.userId);
    assert.equal(accepted.binding.execution_ready, false);
    const second = await s.register(f.owner.userId, f.workspace, f.project, registration(s, f.other.userId, { profile: { id: created.binding.profile_id }, role_id: "quality_assurance", template_hash: s.template("quality_assurance").hash }));
    assert.equal(second.binding.profile_id, created.binding.profile_id); assert.equal(second.binding.state, "pending");
    assert.equal((await s.list(f.owner.userId, f.workspace, f.project)).profiles.length, 1);
  });
  await t.test("scope changes clear approval and stale decisions cannot initialize a new revision", async () => {
    const f = await fixture(); const s = new AgentRegistryRepository(f.repo);
    const first = (await s.register(f.owner.userId, f.workspace, f.project, registration(s, f.owner.userId))).binding;
    const accepted = (await s.mutate(f.owner.userId, f.workspace, f.project, first.id, "initialize", decision(first))).binding;
    const revised = (await s.mutate(f.owner.userId, f.workspace, f.project, first.id, "configure", { request_id: crypto.randomUUID(), expected_version: accepted.version, template_hash: first.template_hash, read_paths: ["tests/"], write_paths: [], reason: "Narrow the file scope" })).binding;
    assert.equal(revised.state, "pending"); assert.equal(revised.approved_by, null);
    await assert.rejects(s.mutate(f.owner.userId, f.workspace, f.project, first.id, "initialize", decision(first)), { status: 409 });
    const history = (await s.history(f.owner.userId, f.workspace, f.project, first.id)).events;
    assert.deepEqual(history.map(e => e.action), ["configured", "initialized", "registered"]);
    assert.deepEqual(history[1].snapshot.write_paths, ["lib/", "tests/"]); assert.equal(history[1].snapshot.approved_by, f.owner.userId);
    assert.ok(history.every(e => e.actor_kind === "human" && e.actor_id === f.owner.userId && !Number.isNaN(Date.parse(e.created_at))));
  });
  await t.test("retries are scoped and never revive a revoked role", async () => {
    const f = await fixture(); const s = new AgentRegistryRepository(f.repo); const v = registration(s, f.owner.userId);
    const first = await s.register(f.owner.userId, f.workspace, f.project, v);
    assert.equal((await s.register(f.owner.userId, f.workspace, f.project, v)).event_id, first.event_id);
    await assert.rejects(s.register(f.owner.userId, f.workspace, f.project, { ...v, reason: "Different decision" }), { status: 409 });
    const accept = decision(first.binding); const active = await s.mutate(f.owner.userId, f.workspace, f.project, first.binding.id, "initialize", accept);
    await s.mutate(f.owner.userId, f.workspace, f.project, first.binding.id, "revoke", { request_id: crypto.randomUUID(), expected_version: active.binding.version, reason: "Withdraw the role" });
    const replay = await s.mutate(f.owner.userId, f.workspace, f.project, first.binding.id, "initialize", accept);
    assert.equal(replay.replayed, true); assert.equal(replay.binding.state, "revoked");
    assert.equal((await s.history(f.owner.userId, f.workspace, f.project, first.binding.id)).events.length, 3);
  });
  await t.test("tenant, admin, operator membership and project boundaries are checked", async () => {
    const f = await fixture(); const s = new AgentRegistryRepository(f.repo);
    await assert.rejects(s.list(f.other.userId, f.workspace, f.project), { status: 404 });
    await assert.rejects(s.register(f.owner.userId, f.workspace, f.project, registration(s, f.other.userId)), { status: 409 });
    await f.repo.addMember(f.owner.userId, f.workspace, { email: f.other.email, role: "member" });
    await assert.rejects(s.register(f.other.userId, f.workspace, f.project, registration(s, f.other.userId)), { status: 403 });
    const first = (await s.register(f.owner.userId, f.workspace, f.project, registration(s, f.other.userId))).binding;
    await assert.rejects(s.mutate(f.other.userId, f.workspace, f.project, first.id, "configure", { request_id: crypto.randomUUID(), expected_version: first.version, template_hash: first.template_hash, read_paths: [], write_paths: [], reason: "Unauthorized edit" }), { status: 403 });
    await f.repo.statement("DELETE FROM memberships WHERE workspace_id=? AND user_id=?", f.workspace, f.other.userId).run();
    assert.equal((await s.binding(f.owner.userId, f.workspace, f.project, first.id)).operator_available, false);
    await assert.rejects(s.mutate(f.other.userId, f.workspace, f.project, first.id, "initialize", decision(first)), { status: 404 });
    const project = (await f.repo.metadata(f.owner.userId, f.workspace)).projects.find(p => p.id === f.project)!;
    await f.repo.updateProject(f.owner.userId, f.workspace, f.project, { version: project.version, archived: true });
    await assert.rejects(s.register(f.owner.userId, f.workspace, f.project, registration(s, f.owner.userId, { profile: { alias: "DEV-2", operator_id: f.owner.userId, tool_label: "" } })), { status: 409 });
    const revoked = await s.mutate(f.owner.userId, f.workspace, f.project, first.id, "revoke", { request_id: crypto.randomUUID(), expected_version: first.version, reason: "Revoke after operator departure and archive" });
    assert.equal(revoked.binding.state, "revoked");
  });
  await t.test("old templates cannot be initialized and historical instructions remain intact", async () => {
    const f = await fixture(); const s = new AgentRegistryRepository(f.repo);
    const first = (await s.register(f.owner.userId, f.workspace, f.project, registration(s, f.owner.userId))).binding;
    const changed = new AgentRegistryRepository(f.repo, [{ ...s.template("development"), hash: "f".repeat(64), body: "A changed trusted role template" }]);
    assert.equal((await changed.binding(f.owner.userId, f.workspace, f.project, first.id)).template_current, false);
    await assert.rejects(changed.mutate(f.owner.userId, f.workspace, f.project, first.id, "initialize", decision(first)), { status: 409 });
    assert.equal((await changed.history(f.owner.userId, f.workspace, f.project, first.id)).events[0].snapshot.template_body, first.template_body);
  });
  await t.test("duplicate roles and aliases cannot manufacture more identities", async () => {
    const f = await fixture(); const s = new AgentRegistryRepository(f.repo);
    const first = (await s.register(f.owner.userId, f.workspace, f.project, registration(s, f.owner.userId))).binding;
    await assert.rejects(s.register(f.owner.userId, f.workspace, f.project, registration(s, f.owner.userId, { profile: { id: first.profile_id } })), { status: 409 });
    await assert.rejects(s.register(f.owner.userId, f.workspace, f.project, registration(s, f.owner.userId, { profile: { alias: "dev-1", operator_id: f.owner.userId, tool_label: "" } })), { status: 409 });
    const otherProject = await f.repo.createProject(f.owner.userId, f.workspace, { name: "Second project" });
    await assert.rejects(s.binding(f.owner.userId, f.workspace, otherProject.id, first.id), { status: 404 });
    const linked = await s.register(f.owner.userId, f.workspace, otherProject.id, registration(s, f.owner.userId, { profile: { id: first.profile_id } }));
    assert.equal(linked.binding.profile_id, first.profile_id); assert.equal(linked.binding.state, "pending");
  });
}

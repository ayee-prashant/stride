import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./sqlite.ts";
import { agentRegistryContract, registration } from "./agent-registry-contract.ts";
import { AgentRegistryRepository } from "../lib/server/agent-registry.ts";
import { parseAgentRegistration, parseAgentDecision } from "../lib/agents.ts";
import { handleApi } from "../lib/server/http.ts";

test("human-owned agent registry contract", t => agentRegistryContract(t, fixture));
test("role requests reject forged actors, permissions and unsafe path scopes", async () => {
  const f = await fixture(); const s = new AgentRegistryRepository(f.repo); const v = registration(s, f.owner.userId);
  for (const change of [{ agent_id: "self" }, { approved_by: f.owner.userId }, { state: "initialized" }, { role_id: "administrator" }, { command: "anything" }, { read_paths: ["../outside"] }, { read_paths: ["/root"] }, { read_paths: ["lib/**"] }, { read_paths: [".git/config"] }, { read_paths: ["lib\\file"] }, { read_paths: ["lib/", "lib/"] }, { read_paths: ["lib/safe"], write_paths: ["lib/elsewhere"] }]) assert.throws(() => parseAgentRegistration({ ...v, ...change }), { status: 400 });
  assert.throws(() => parseAgentDecision({ request_id: crypto.randomUUID(), expected_version: 1, reason: "Reason", actor_id: f.owner.userId }, false), { status: 400 });
});
test("agent audit failure rolls back the profile and role together", async () => {
  const f = await fixture(); const s = new AgentRegistryRepository(f.repo);
  f.db.raw.exec("CREATE TRIGGER reject_agent_event BEFORE INSERT ON agent_role_events BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END;");
  await assert.rejects(s.register(f.owner.userId, f.workspace, f.project, registration(s, f.owner.userId)), /fixture audit failure/);
  const list = await s.list(f.owner.userId, f.workspace, f.project);
  assert.equal(list.profiles.length, 0); assert.equal(list.bindings.length, 0);
});
test("agent HTTP uses real human guards, bounded queries and no execution endpoint", async () => {
  const f = await fixture(); const s = new AgentRegistryRepository(f.repo);
  const base = `https://stride.test/api/projects/${f.project}/agents`; const suffix = `?workspace_id=${f.workspace}`;
  const dependencies = { identity: async () => f.owner, repository: () => f.repo };
  const request = (path: string, body: unknown, origin = "https://stride.test") => new Request(`${base}${path}${suffix}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await handleApi(request("", registration(s, f.owner.userId)), { ...dependencies, identity: async () => null })).status, 401);
  assert.equal((await handleApi(request("", registration(s, f.owner.userId), "https://other.test"), dependencies)).status, 403);
  const response = await handleApi(request("", registration(s, f.owner.userId)), dependencies);
  assert.equal(response.status, 201); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const result = await response.json(); assert.equal(result.binding.state, "pending");
  assert.equal((await handleApi(request(`/${result.binding.id}/start`, {}), dependencies)).status, 404);
  for (const query of ["&workspace_id=other", "&offset=-1", "&offset=201", "&profile_id=spoof"]) assert.equal((await handleApi(new Request(`${base}${suffix}${query}`), dependencies)).status, 400);
  assert.equal((await handleApi(new Request(`${base}/roles/development${suffix}`), { ...dependencies, identity: async () => f.other })).status, 404);
});

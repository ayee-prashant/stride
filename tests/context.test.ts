import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./sqlite.ts";
import { contextContract, publication } from "./context-contract.ts";
import { ContextRepository } from "../lib/server/context-repository.ts";
import { parseContextPublish, parseTaskBrief } from "../lib/context.ts";
import { handleApi } from "../lib/server/http.ts";

test("project context contract", t => contextContract(t, fixture));
test("strict bounded inputs reject forged authority, duplicate selections and invalid revisions", () => {
  for (const input of [null, [], { ...publication(), agent_id: "developer" }, publication({ expected_version: 1 }), publication({ body: "x".repeat(6001) }), publication({ request_id: "not-a-uuid" })]) assert.throws(() => parseContextPublish(input), { status: 400 });
  for (const ids of [[], ["one", "one"], Array.from({ length: 21 }, (_, i) => `${i}`)]) assert.throws(() => parseTaskBrief({ request_id: crypto.randomUUID(), task_version: 1, requirement_ids: ids, context_sequence: 0 }), { status: 400 });
});
test("audit failure rolls back the document, revision and sequence together", async () => {
  const f = await fixture(); const c = new ContextRepository(f.repo);
  f.db.raw.exec("CREATE TRIGGER reject_context_event BEFORE INSERT ON context_events BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END;");
  await assert.rejects(c.publish(f.owner.userId, f.workspace, f.project, publication()), /fixture audit failure/);
  assert.deepEqual(await c.brief(f.owner.userId, f.workspace, f.project), { sequence: 0, documents: [], can_publish: true });
  assert.equal((await f.repo.statement("SELECT COUNT(*) AS n FROM context_revisions").first<{ n: number }>())?.n, 0);
});
test("context HTTP keeps authentication, JSON origin guards, private caching and strict query validation", async () => {
  const f = await fixture();
  const dependencies = { identity: async () => f.owner, repository: () => f.repo };
  const endpoint = `https://stride.test/api/projects/${f.project}/context`;
  const suffix = `?workspace_id=${f.workspace}`;
  const request = (body: unknown, origin = "https://stride.test") => new Request(`${endpoint}/documents${suffix}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await handleApi(request(publication()), { ...dependencies, identity: async () => null })).status, 401);
  assert.equal((await handleApi(request(publication(), "https://attacker.test"), dependencies)).status, 403);
  const response = await handleApi(request(publication()), dependencies);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).approved_by, f.owner.userId);
  assert.equal((await handleApi(new Request(`${endpoint}${suffix}&workspace_id=ws_other`), dependencies)).status, 400);
  assert.equal((await handleApi(new Request(`${endpoint}/changes${suffix}&after=-1`), dependencies)).status, 400);
  assert.equal((await handleApi(new Request(`${endpoint}/changes${suffix}&after=2147483648`), dependencies)).status, 400);
  assert.equal((await handleApi(new Request(`${endpoint}${suffix}`), { ...dependencies, identity: async () => f.other })).status, 404);
});

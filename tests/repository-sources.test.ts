import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./sqlite.ts";
import { connectInput, observation, repositorySourceContract, sourceFixture } from "./repository-source-contract.ts";
import { handleApi } from "../lib/server/http.ts";
import { reconcileSource } from "../lib/server/reconcile-source.ts";

test("repository sources behavioral contract", t => repositorySourceContract(t, fixture));
test("enrollment and its receipt roll back with a failed source event", async () => {
  const base = await fixture(); const f = sourceFixture(base);
  base.db.raw.exec("CREATE TRIGGER reject_source_event BEFORE INSERT ON repository_source_events BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END;");
  await assert.rejects(f.sources.connect(f.owner.userId, f.workspace, f.project, connectInput(f.binding)), /fixture audit failure/);
  assert.equal(await f.sources.row(f.workspace, f.project), null);
  assert.equal((await f.repo.statement("SELECT COUNT(*) AS n FROM repository_source_receipts").first<{ n: number }>())?.n, 0);
  assert.equal((await f.context.brief(f.owner.userId, f.workspace, f.project)).sequence, 0);
});
test("HTTP source operations retain origin, identity, query and private response boundaries", async () => {
  const f = sourceFixture(await fixture()); const deps = { identity: async () => f.owner, repository: () => f.repo, githubBindings: () => [f.binding] };
  const endpoint = `https://stride.test/api/projects/${f.project}/repository?workspace_id=${f.workspace}`;
  const request = (origin = "https://stride.test") => new Request(endpoint, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(connectInput(f.binding)) });
  assert.equal((await handleApi(request(), { ...deps, identity: async () => null })).status, 401);
  assert.equal((await handleApi(request("https://attacker.test"), deps)).status, 403);
  assert.equal((await handleApi(new Request(endpoint + "&installation_id=777"), deps)).status, 400);
  const connected = await handleApi(request(), deps); assert.equal(connected.status, 202);
  assert.equal(connected.headers.get("cache-control"), "private, no-store");
  assert.equal((await connected.json()).source.state, "pending");
  assert.equal((await handleApi(new Request(endpoint), { ...deps, identity: async () => f.other })).status, 404);
});
test("worker reconciliation publishes only after the network completes and sanitizes unexpected provider failures", async () => {
  const f = sourceFixture(await fixture());
  await f.sources.connect(f.owner.userId, f.workspace, f.project, connectInput(f.binding));
  assert.equal(await reconcileSource(f.sources, { inspect: async () => { assert.equal((await f.sources.view(f.owner.userId, f.workspace, f.project)).source?.state, "syncing"); throw new Error("private provider response"); } }), "unavailable");
  assert.equal((await f.sources.view(f.owner.userId, f.workspace, f.project)).source?.reason, "upstream_unavailable");
  assert.equal(await reconcileSource(f.sources, { inspect: async () => observation(f.binding) }), "idle");
  f.advance(61);
  assert.equal(await reconcileSource(f.sources, { inspect: async () => observation(f.binding) }), "observed");
});

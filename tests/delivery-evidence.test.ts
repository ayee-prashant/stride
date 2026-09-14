import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { GitHubEvidenceProvider, DeliveryEvidenceStore } from "../lib/server/delivery-evidence.ts";
import type { GitHubBinding } from "../lib/github-context.ts";
import { setupDelivery } from "./delivery-contract.ts";
import { fixture } from "./sqlite.ts";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const candidate = { repository_id: 12345, pull_request: 7, commit: "a".repeat(40) };
const binding: GitHubBinding = { key: "evidence", workspace_id: "test-workspace", project_id: "test-project", repository_id: 12345, installation_id: 6789, owner: "fixture", repository: "project", branch: "main", paths: ["README.md"] };
function provider(b = binding, override?: (path: string) => unknown) {
  const requests: { path: string; method?: string; body?: BodyInit | null }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://api.github.com"); assert.equal(init?.redirect, "error");
    requests.push({ path: url.pathname, method: init?.method, body: init?.body });
    let data = override?.(url.pathname);
    if (data === undefined) {
      if (url.pathname.endsWith("/access_tokens")) data = { token: "isolated-worker-token" };
      else if (url.pathname === "/repos/fixture/project") data = { id: 12345, full_name: "fixture/project" };
      else if (url.pathname.endsWith("/pulls/7")) data = { number: 7, head: { sha: candidate.commit, repo: { id: 12345 } }, base: { ref: "main", repo: { id: 12345 } } };
      else if (url.pathname.endsWith("/check-runs")) data = { total_count: 1, check_runs: [{ name: "CI", head_sha: candidate.commit, status: "completed", conclusion: "success" }] };
      else if (url.pathname.endsWith("/status")) data = { sha: candidate.commit, total_count: 0, statuses: [] };
      else if (url.pathname.endsWith("/deployments")) data = [{ id: 2, sha: candidate.commit, environment: "uat", payload: "invalid payload" }, { id: 3, sha: candidate.commit, environment: "uat", payload: JSON.stringify({ artifact: "sha256:immutable-image" }) }];
      else if (url.pathname.endsWith("/deployments/3/statuses")) data = [{ state: "success" }];
      else throw new Error("Unexpected GitHub endpoint");
    }
    return Response.json(data);
  };
  return { instance: new GitHubEvidenceProvider({ clientId: "Iv1.test", privateKey: keys.privateKey, bindings: [b] }, fetcher), requests };
}
test("independent GitHub evidence pins repository, PR, successful checks and deployed artifact", async () => {
  const p = provider(); const input = { workspace_id: binding.workspace_id, project_id: binding.project_id, candidate, environment: "uat", artifact: "sha256:immutable-image" };
  const result = await p.instance.inspectEvidence(binding, input);
  assert.equal(result.deployment?.id, "3"); assert.equal(result.provenance, "github_verified");
  const grant = JSON.parse(String(p.requests[0].body)); assert.deepEqual(grant.repository_ids, [12345]); assert.ok(Object.values(grant.permissions).every(v => v === "read"));
  assert.equal(JSON.stringify(result).includes("isolated-worker-token"), false);
  await assert.rejects(p.instance.inspectEvidence(binding, { ...input, candidate: { ...candidate, repository_id: 9999 } }), { code: "access_unavailable" });
  for (const path of ["/pulls/7", "/check-runs", "/status"]) {
    const broken = provider(binding, p => p.endsWith(path) ? path === "/pulls/7" ? { number: 7, head: { sha: "b".repeat(40), repo: { id: 12345 } }, base: { ref: "main", repo: { id: 12345 } } } : path === "/check-runs" ? { total_count: 1, check_runs: [{ head_sha: candidate.commit, status: "completed", conclusion: "failure" }] } : { sha: candidate.commit, total_count: 101, statuses: [] } : undefined);
    await assert.rejects(broken.instance.inspectEvidence(binding, input));
  }
  await assert.rejects(p.instance.inspectEvidence(binding, { ...input, artifact: "different-image" }));
});
test("evidence requests persist and stale worker generations cannot overwrite newer verification", async () => {
  const f = await setupDelivery(fixture); const b = { ...binding, workspace_id: f.workspace, project_id: f.project }; const store = new DeliveryEvidenceStore(f.repo, [b]);
  const input = { workspace_id: f.workspace, project_id: f.project, candidate };
  await assert.rejects(store.verified(input), /queued/); await assert.rejects(store.verified(input), /queued/);
  assert.equal((await f.repo.statement("SELECT COUNT(*) AS n FROM delivery_evidence").first<{ n: number }>())!.n, 1);
  let release!: () => void; let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; }); const delay = new Promise<void>(resolve => { release = resolve; });
  const old = provider(b).instance; const original = old.inspectEvidence.bind(old);
  old.inspectEvidence = async (...args) => { entered(); await delay; return { ...await original(...args), observed_at: "2000-01-01T00:00:00.000Z" }; };
  const inFlight = store.process(old); await waiting;
  await f.repo.statement("UPDATE delivery_evidence SET lease_until='2000-01-01T00:00:00.000Z'").run();
  assert.equal(await store.process(provider(b).instance), true); release(); await inFlight;
  const verified = await store.verified(input); assert.notEqual(verified.observed_at, "2000-01-01T00:00:00.000Z");
  await f.repo.statement("UPDATE delivery_evidence SET observed_at='2000-01-01T00:00:00.000Z'").run();
  await assert.rejects(store.verified(input), /queued/);
});

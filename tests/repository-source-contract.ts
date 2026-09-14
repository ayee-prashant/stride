import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { TestContext } from "node:test";
import type { Identity } from "../lib/domain.ts";
import { parseBinding } from "../lib/github-context.ts";
import type { GitHubBinding, GitHubObservation } from "../lib/github-context.ts";
import { Repository } from "../lib/server/repository.ts";
import { ContextRepository } from "../lib/server/context-repository.ts";
import { RepositorySources } from "../lib/server/repository-sources.ts";
import { GitHubContextError } from "../lib/server/github-context-provider.ts";
import { publication } from "./context-contract.ts";

type Fixture = { repo: Repository; owner: Identity; other: Identity; workspace: string; project: string };
export function sourceFixture(f: Fixture) {
  let time = new Date("2026-09-14T12:00:00.000Z");
  const repo = new Repository(f.repo.db, () => time);
  const binding = parseBinding({ key: "ci_repository", workspace_id: f.workspace, project_id: f.project, repository_id: 1234, installation_id: 5678, owner: "fixture", repository: "project", branch: "main", paths: ["docs/ARCHITECTURE.md"] });
  const sources = new RepositorySources(repo, [binding]); const context = new ContextRepository(repo, [binding]);
  return { ...f, repo, binding, sources, context, advance: (seconds: number) => { time = new Date(time.getTime() + seconds * 1000); }, now: () => time };
}
export function observation(binding: GitHubBinding, head = "a", body = "Repository fact, not an adopted product decision."): GitHubObservation {
  const bytes = Buffer.from(body); const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  const files = binding.paths.map(path => ({ path, blob_sha: blob, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, body }));
  const manifest = { repository_id: binding.repository_id, branch: binding.branch, head_sha: head.repeat(40), tree_sha: "f".repeat(40), files: files.map(({ path, blob_sha, sha256, size }) => ({ path, blob_sha, sha256, size })) };
  return { ...manifest, files, full_name: `${binding.owner}/${binding.repository}`, manifest_hash: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"), observed_at: "2026-09-14T12:00:00.000Z", coverage: "configured_files", repository_mode: "observed" };
}
export const connectInput = (binding: GitHubBinding, version = 0) => ({ request_id: crypto.randomUUID(), binding_key: binding.key, version });
export const mutateInput = (version: number) => ({ request_id: crypto.randomUUID(), version });
export async function sync(f: ReturnType<typeof sourceFixture>, head = "a") {
  const claim = await f.sources.claim(); assert.ok(claim);
  assert.equal(await f.sources.finish(claim, observation(f.binding, head)), true);
  return claim;
}

export async function repositorySourceContract(t: TestContext, fixture: () => Promise<Fixture>) {
  await t.test("source enrollment requires a human admin and an explicit project grant", async () => {
    const f = sourceFixture(await fixture()); const input = connectInput(f.binding);
    await assert.rejects(f.sources.view(f.other.userId, f.workspace, f.project), { status: 404 });
    await f.repo.addMember(f.owner.userId, f.workspace, { email: f.other.email });
    await assert.rejects(f.sources.connect(f.other.userId, f.workspace, f.project, input), { status: 403 });
    await assert.rejects(f.sources.connect(f.owner.userId, f.workspace, f.project, { ...input, binding_key: "some_other_project" }), { code: "SOURCE_NOT_APPROVED" });
    await assert.rejects(f.sources.connect(f.owner.userId, f.workspace, f.project, { ...input, installation_id: 99 }), { status: 400 });
    const first = await f.sources.connect(f.owner.userId, f.workspace, f.project, input);
    assert.equal(first.source?.state, "pending"); assert.equal(first.source?.observation, null);
    assert.equal((await f.sources.view(f.other.userId, f.workspace, f.project)).can_manage, false);
    await f.repo.statement("DELETE FROM memberships WHERE workspace_id=? AND user_id=?", f.workspace, f.other.userId).run();
    await assert.rejects(f.sources.refresh(f.other.userId, f.workspace, f.project, mutateInput(1)), { status: 404 });
  });
  await t.test("lost-response retries cannot undo a later disconnect or reconnect", async () => {
    const f = sourceFixture(await fixture()); const input = connectInput(f.binding);
    const connected = await f.sources.connect(f.owner.userId, f.workspace, f.project, input);
    assert.deepEqual((await f.sources.connect(f.owner.userId, f.workspace, f.project, input)).receipt, connected.receipt);
    const disconnect = mutateInput(1);
    await f.sources.disconnect(f.owner.userId, f.workspace, f.project, disconnect);
    const replay = await f.sources.connect(f.owner.userId, f.workspace, f.project, input);
    assert.equal(replay.source?.state, "disconnected"); assert.deepEqual(replay.receipt, connected.receipt);
    await assert.rejects(f.sources.connect(f.owner.userId, f.workspace, f.project, { ...input, version: 2 }), { status: 409 });
    await f.sources.connect(f.owner.userId, f.workspace, f.project, connectInput(f.binding, 2));
    assert.equal((await f.sources.disconnect(f.owner.userId, f.workspace, f.project, disconnect)).source?.state, "pending");
    assert.equal((await f.context.changes(f.owner.userId, f.workspace, f.project, 0)).events.length, 3);
  });
  await t.test("worker loss, expired claims and disconnects fence late observations", async () => {
    const f = sourceFixture(await fixture());
    await f.sources.connect(f.owner.userId, f.workspace, f.project, connectInput(f.binding));
    const first = await f.sources.claim(); assert.ok(first);
    assert.equal(await f.sources.claim(), null);
    f.advance(61);
    const replacement = await f.sources.claim(); assert.ok(replacement);
    assert.ok(replacement.source.generation > first.source.generation);
    assert.equal(await f.sources.finish(first, observation(f.binding)), false);
    assert.equal(await f.sources.finish(replacement, observation(f.binding)), true);
    assert.equal(await f.sources.finish(replacement, observation(f.binding, "b")), false);
    f.advance(121); const running = await f.sources.claim(); assert.ok(running);
    await f.sources.disconnect(f.owner.userId, f.workspace, f.project, mutateInput(1));
    assert.equal(await f.sources.finish(running, observation(f.binding, "b")), false);
    assert.equal((await f.sources.view(f.owner.userId, f.workspace, f.project)).source?.observation, null);
  });
  await t.test("source and human events share a resumable sequence; unchanged observations are reused", async () => {
    const f = sourceFixture(await fixture());
    await f.sources.connect(f.owner.userId, f.workspace, f.project, connectInput(f.binding));
    await f.context.publish(f.owner.userId, f.workspace, f.project, publication());
    await sync(f); f.advance(121); await sync(f);
    assert.deepEqual((await f.context.changes(f.owner.userId, f.workspace, f.project, 0)).events.map(e => [e.sequence, e.kind]), [[1, "connected"], [2, "document_published"], [3, "observed"]]);
    f.advance(121); let claim = await f.sources.claim(); assert.ok(claim);
    await f.sources.finish(claim, new GitHubContextError("access_unavailable"));
    assert.equal((await f.sources.view(f.owner.userId, f.workspace, f.project)).source?.observation, null);
    f.advance(61); claim = await f.sources.claim(); assert.ok(claim);
    await f.sources.finish(claim, new GitHubContextError("access_unavailable"));
    f.advance(61); await sync(f);
    const events = await f.context.changes(f.owner.userId, f.workspace, f.project, 3);
    assert.deepEqual(events.events.map(e => e.kind), ["unavailable", "observed"]);
    assert.ok(events.events.every(e => e.created_by === null && e.document_id === null));
    assert.equal(Number((await f.repo.statement("SELECT COUNT(*) AS n FROM repository_observations WHERE project_id=?", f.project).first<{ n: number }>())?.n), 1);
  });
  await t.test("task briefs pin verified files and fail closed during outages, stale reads and removed grants", async () => {
    const f = sourceFixture(await fixture());
    const doc = await f.context.publish(f.owner.userId, f.workspace, f.project, publication());
    const task = await f.repo.createTask(f.owner.userId, f.workspace, { title: "Implement an accepted requirement", project_id: f.project });
    const prepare = async () => f.context.createTaskBrief(f.owner.userId, f.workspace, task.id, { request_id: crypto.randomUUID(), task_version: task.version, requirement_ids: [doc.document_id], context_sequence: (await f.context.brief(f.owner.userId, f.workspace, f.project)).sequence });
    const human = await prepare(); assert.ok(human.brief);
    await f.sources.connect(f.owner.userId, f.workspace, f.project, connectInput(f.binding));
    await assert.rejects(prepare(), { code: "SOURCE_NOT_CURRENT" });
    await sync(f);
    assert.equal((await f.context.taskBrief(f.owner.userId, f.workspace, task.id, human.brief.id)).check?.state, "stale");
    const ready = await prepare(); assert.ok(ready.brief?.payload.repository);
    assert.equal(ready.brief.payload.repository.observation.head_sha, "a".repeat(40));
    assert.equal(ready.check?.execution_ready, false);
    assert.equal((await f.context.brief(f.owner.userId, f.workspace, f.project)).documents.length, 1);
    f.advance(121); await sync(f, "b");
    const stale = await f.context.taskBrief(f.owner.userId, f.workspace, task.id, ready.brief.id);
    assert.equal(stale.check?.state, "stale"); assert.deepEqual(stale.brief, ready.brief);
    const restricted = new ContextRepository(f.repo, []);
    assert.equal((await restricted.taskBrief(f.owner.userId, f.workspace, task.id)).brief, null);
    assert.equal((await new RepositorySources(f.repo, []).view(f.owner.userId, f.workspace, f.project)).source?.repository, "Restricted repository");
    const current = await prepare(); assert.ok(current.brief);
    f.advance(181);
    assert.equal((await f.context.taskBrief(f.owner.userId, f.workspace, task.id)).brief, null);
    await assert.rejects(prepare(), { code: "SOURCE_NOT_CURRENT" });
    const claim = await f.sources.claim(); assert.ok(claim);
    await f.sources.finish(claim, new GitHubContextError("access_unavailable"));
    assert.equal((await f.context.taskBrief(f.owner.userId, f.workspace, task.id)).check?.state, "unavailable");
    f.advance(61); await sync(f, "b");
    assert.deepEqual((await f.context.taskBrief(f.owner.userId, f.workspace, task.id)).brief, current.brief);
    await f.sources.disconnect(f.owner.userId, f.workspace, f.project, mutateInput(1));
    assert.equal((await f.context.taskBrief(f.owner.userId, f.workspace, task.id)).brief, null);
  });
  await t.test("manual refresh honors provider cooldowns; archived projects and revoked grants are not polled", async () => {
    const f = sourceFixture(await fixture());
    await f.sources.connect(f.owner.userId, f.workspace, f.project, connectInput(f.binding));
    const claim = await f.sources.claim(); assert.ok(claim);
    await f.sources.finish(claim, new GitHubContextError("rate_limited", 600));
    f.advance(61); await f.sources.refresh(f.owner.userId, f.workspace, f.project, mutateInput(1));
    assert.equal(await f.sources.claim(), null);
    f.advance(600); assert.equal(await new RepositorySources(f.repo, []).claim(), null);
    await f.repo.statement("UPDATE projects SET archived_at=? WHERE id=?", f.now().toISOString(), f.project).run();
    assert.equal(await f.sources.claim(), null);
    await assert.rejects(f.sources.refresh(f.owner.userId, f.workspace, f.project, mutateInput(1)), { status: 409 });
  });
}

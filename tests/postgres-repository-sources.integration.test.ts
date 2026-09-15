import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Repository } from "../lib/server/repository.ts";
import { PostgresDatabase } from "../lib/server/postgres-adapter.ts";
import { connectInput, mutateInput, observation, repositorySourceContract, sourceFixture, sync } from "./repository-source-contract.ts";
import { publication } from "./context-contract.ts";

const value = process.env.TEST_DATABASE_URL;
if (!value) throw new Error("TEST_DATABASE_URL must point to the isolated local CI database");
const url = new URL(value);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/stride_test") throw new Error("Integration tests require a local database named stride_test");

test("PostgreSQL source reconciliation and competing workers", async t => {
  const pool = new Pool({ connectionString: value, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  t.after(() => pool.end());
  await migrate(drizzle(pool), { migrationsFolder: "drizzle-postgres" });
  const repo = new Repository(new PostgresDatabase(pool));
  const fixture = async () => {
    const suffix = crypto.randomUUID();
    const owner = { userId: `source_owner_${suffix}`, email: `source_owner_${suffix}@example.test`, displayName: "Source owner" };
    const other = { userId: `source_member_${suffix}`, email: `source_member_${suffix}@example.test`, displayName: "Source member" };
    const workspace = (await repo.bootstrap(owner)).workspaces[0].id;
    await repo.bootstrap(other);
    const project = (await repo.metadata(owner.userId, workspace)).projects[0].id;
    return { repo, owner, other, workspace, project };
  };
  await repositorySourceContract(t, fixture);
  await t.test("twenty competing source workers yield one fenced claim", async () => {
    const f = sourceFixture(await fixture());
    const input = connectInput(f.binding);
    const enrolled = await Promise.all([f.sources.connect(f.owner.userId, f.workspace, f.project, input), f.sources.connect(f.owner.userId, f.workspace, f.project, input)]);
    assert.deepEqual(enrolled[0].receipt, enrolled[1].receipt);
    const claims = (await Promise.all(Array.from({ length: 20 }, () => f.sources.claim()))).filter(c => c !== null);
    assert.equal(claims.length, 1);
    assert.equal(await f.sources.finish(claims[0], observation(f.binding)), true);
    f.advance(121); const running = await f.sources.claim(); assert.ok(running);
    await Promise.all([f.sources.finish(running, observation(f.binding, "b")), f.sources.disconnect(f.owner.userId, f.workspace, f.project, mutateInput(1))]);
    const view = await f.sources.view(f.owner.userId, f.workspace, f.project);
    assert.equal(view.source?.state, "disconnected"); assert.equal(view.source?.observation, null);
  });
  await t.test("a concurrent source update cannot leave a brief pinned to the old commit current", async () => {
    const f = sourceFixture(await fixture());
    await f.sources.connect(f.owner.userId, f.workspace, f.project, connectInput(f.binding));
    await sync(f);
    const doc = await f.context.publish(f.owner.userId, f.workspace, f.project, publication());
    const task = await f.repo.createTask(f.owner.userId, f.workspace, { project_id: f.project, title: "Concurrent repository observation" });
    const sequence = (await f.context.brief(f.owner.userId, f.workspace, f.project)).sequence;
    f.advance(121); const running = await f.sources.claim(); assert.ok(running);
    const results = await Promise.allSettled([
      f.context.createTaskBrief(f.owner.userId, f.workspace, task.id, { request_id: crypto.randomUUID(), task_version: task.version, context_sequence: sequence, requirement_ids: [doc.document_id] }),
      f.sources.finish(running, observation(f.binding, "b")),
    ]);
    assert.equal(results[1].status, "fulfilled");
    if (results[0].status === "fulfilled") {
      const saved = await f.context.taskBrief(f.owner.userId, f.workspace, task.id);
      assert.equal(saved.brief?.payload.repository?.observation.head_sha, "b".repeat(40));
    } else assert.equal(results[0].reason.status, 409);
    const events = (await f.context.changes(f.owner.userId, f.workspace, f.project, 0)).events;
    assert.deepEqual(events.map(e => e.sequence), [1, 2, 3, 4]);
  });
});

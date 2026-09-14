import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Repository } from "../lib/server/repository.ts";
import { PostgresDatabase } from "../lib/server/postgres-adapter.ts";
import { ContextRepository } from "../lib/server/context-repository.ts";
import { contextContract, publication, revise } from "./context-contract.ts";

const value = process.env.TEST_DATABASE_URL;
if (!value) throw new Error("TEST_DATABASE_URL must point to the isolated local CI database");
const url = new URL(value);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/stride_test") throw new Error("Integration tests require a local database named stride_test");

test("PostgreSQL context contract and concurrent approvals", async t => {
  const pool = new Pool({ connectionString: value, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  t.after(() => pool.end());
  await migrate(drizzle(pool), { migrationsFolder: "drizzle-postgres" });
  const repo = new Repository(new PostgresDatabase(pool));
  const fixture = async () => {
    const suffix = crypto.randomUUID();
    const owner = { userId: `context_owner_${suffix}`, email: `context_owner_${suffix}@example.test`, displayName: "Context owner" };
    const other = { userId: `context_member_${suffix}`, email: `context_member_${suffix}@example.test`, displayName: "Context member" };
    const workspace = (await repo.bootstrap(owner)).workspaces[0].id;
    await repo.bootstrap(other);
    const project = (await repo.metadata(owner.userId, workspace)).projects[0].id;
    return { repo, owner, other, workspace, project };
  };
  await contextContract(t, fixture);
  await t.test("two machines cannot publish competing versions; event cursors follow commit order", async () => {
    const f = await fixture(); const c = new ContextRepository(repo);
    const first = await c.publish(f.owner.userId, f.workspace, f.project, publication());
    const writers = await Promise.allSettled([
      c.publish(f.owner.userId, f.workspace, f.project, revise(first, { body: "Machine one proposal accepted." })),
      c.publish(f.owner.userId, f.workspace, f.project, revise(first, { body: "Machine two proposal accepted." })),
    ]);
    assert.equal(writers.filter(w => w.status === "fulfilled").length, 1);
    const rejected = writers.find(w => w.status === "rejected");
    assert.equal(rejected?.status === "rejected" ? rejected.reason.status : null, 409);
    assert.deepEqual((await c.changes(f.owner.userId, f.workspace, f.project, 0)).events.map(e => e.sequence), [1, 2]);
    const input = publication({ title: "Idempotent concurrent acceptance" });
    const [one, two] = await Promise.all([c.publish(f.owner.userId, f.workspace, f.project, input), c.publish(f.owner.userId, f.workspace, f.project, input)]);
    assert.deepEqual(one, two);
    assert.equal((await c.brief(f.owner.userId, f.workspace, f.project)).sequence, 3);
  });
});

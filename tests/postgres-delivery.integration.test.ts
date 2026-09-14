import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Repository } from "../lib/server/repository.ts";
import { PostgresDatabase } from "../lib/server/postgres-adapter.ts";
import { completeDelivery, setupDelivery, rid } from "./delivery-contract.ts";

const value = process.env.TEST_DATABASE_URL;
if (!value) throw new Error("An isolated TEST_DATABASE_URL is required");
const url = new URL(value); if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/stride_test") throw new Error("Delivery tests require local stride_test");
test("PostgreSQL full human delivery and concurrency contract", async t => {
  const pool = new Pool({ connectionString: value, max: 6, connectionTimeoutMillis: 5000, statement_timeout: 10000 }); t.after(() => pool.end());
  await migrate(drizzle(pool), { migrationsFolder: "drizzle-postgres" }); const repo = new Repository(new PostgresDatabase(pool));
  async function fixture() {
    const suffix = rid(); const owner = { userId: `delivery_owner_${suffix}`, email: `delivery_owner_${suffix}@example.test`, displayName: "Delivery owner" }; const other = { userId: `delivery_other_${suffix}`, email: `delivery_other_${suffix}@example.test`, displayName: "Delivery member" };
    const workspace = (await repo.bootstrap(owner)).workspaces[0].id; await repo.bootstrap(other); const project = (await repo.metadata(owner.userId, workspace)).projects[0].id;
    return { repo, owner, other, workspace, project };
  }
  await t.test("requirements through rework and verified production acceptance", async () => { await completeDelivery(fixture); });
  await t.test("concurrent start retries share one grant and only one distinct claim wins", async () => {
    const f = await setupDelivery(fixture);
    const start = () => f.s.authorizeStart(f.owner.userId, f.workspace, f.project, f.t.id, f.startInput);
    const [a, b] = await Promise.all([start(), start()]); assert.equal(a.ticket!.attempt_id, b.ticket!.attempt_id);
    const claims = await Promise.allSettled([1, 2].map(() => f.s.claim(f.actor, { request_id: rid(), ticket_id: f.t.id, attempt_id: a.ticket!.attempt_id, packet_hash: f.packet.hash })));
    assert.equal(claims.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(Number((await repo.statement("SELECT COUNT(*) AS n FROM delivery_attempts WHERE workspace_id=? AND ticket_id=?", f.workspace, f.t.id).first<{ n: string }>())!.n), 1);
    assert.equal(Number((await repo.statement("SELECT COUNT(*) AS n FROM delivery_events WHERE workspace_id=? AND action='attempt_started'", f.workspace).first<{ n: string }>())!.n), 1);
  });
  await t.test("no-op membership locks preserve epoch; actual authority changes rotate it", async () => {
    const f = await setupDelivery(fixture); await repo.addMember(f.owner.userId, f.workspace, { email: f.other.email, role: "member" });
    const epoch = async () => (await repo.statement("SELECT epoch FROM memberships WHERE workspace_id=? AND user_id=?", f.workspace, f.other.userId).first<{ epoch: string }>())!.epoch;
    const first = await epoch(); await repo.statement("UPDATE memberships SET role=role WHERE workspace_id=? AND user_id=?", f.workspace, f.other.userId).run(); assert.equal(await epoch(), first);
    await repo.addMember(f.owner.userId, f.workspace, { email: f.other.email, role: "admin" }); assert.notEqual(await epoch(), first);
  });
});

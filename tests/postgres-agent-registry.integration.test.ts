import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Repository } from "../lib/server/repository.ts";
import { PostgresDatabase } from "../lib/server/postgres-adapter.ts";
import { AgentRegistryRepository } from "../lib/server/agent-registry.ts";
import { agentRegistryContract, registration, decision } from "./agent-registry-contract.ts";

const value = process.env.TEST_DATABASE_URL;
if (!value) throw new Error("An isolated TEST_DATABASE_URL is required");
const url = new URL(value);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/stride_test") throw new Error("Agent contracts require local stride_test");
test("PostgreSQL human agent registry and competing decisions", async t => {
  const pool = new Pool({ connectionString: value, max: 5, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  t.after(() => pool.end());
  await migrate(drizzle(pool), { migrationsFolder: "drizzle-postgres" });
  const repo = new Repository(new PostgresDatabase(pool)); const service = new AgentRegistryRepository(repo);
  const fixture = async () => {
    const suffix = crypto.randomUUID();
    const owner = { userId: `agent_owner_${suffix}`, email: `agent_owner_${suffix}@example.test`, displayName: "Agent owner" };
    const other = { userId: `agent_operator_${suffix}`, email: `agent_operator_${suffix}@example.test`, displayName: "Agent operator" };
    const workspace = (await repo.bootstrap(owner)).workspaces[0].id; await repo.bootstrap(other);
    return { repo, owner, other, workspace, project: (await repo.metadata(owner.userId, workspace)).projects[0].id };
  };
  await agentRegistryContract(t, fixture);
  await t.test("concurrent initialization and configuration have one version winner", async () => {
    const f = await fixture(); const s = service;
    await repo.addMember(f.owner.userId, f.workspace, { email: f.other.email, role: "member" });
    const first = (await s.register(f.owner.userId, f.workspace, f.project, registration(s, f.other.userId))).binding;
    const results = await Promise.allSettled([
      s.mutate(f.other.userId, f.workspace, f.project, first.id, "initialize", decision(first)),
      s.mutate(f.owner.userId, f.workspace, f.project, first.id, "configure", { request_id: crypto.randomUUID(), expected_version: first.version, template_hash: first.template_hash, read_paths: [], write_paths: [], reason: "Concurrent configuration change" }),
    ]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const rejected = results.find(r => r.status === "rejected"); assert.equal(rejected?.status === "rejected" ? rejected.reason.status : null, 409);
    assert.equal((await s.history(f.owner.userId, f.workspace, f.project, first.id)).events.length, 2);
  });
  await t.test("concurrent retries share one profile and event", async () => {
    const f = await fixture(); const input = registration(service, f.owner.userId);
    const [a, b] = await Promise.all([service.register(f.owner.userId, f.workspace, f.project, input), service.register(f.owner.userId, f.workspace, f.project, input)]);
    assert.equal(a.event_id, b.event_id); assert.equal(a.binding.profile_id, b.binding.profile_id);
    assert.equal((await service.list(f.owner.userId, f.workspace, f.project)).profiles.length, 1);
  });
  await t.test("different humans on different projects cannot race beyond the workspace profile quota", async () => {
    const f = await fixture(); await repo.addMember(f.owner.userId, f.workspace, { email: f.other.email, role: "admin" });
    const second = await repo.createProject(f.owner.userId, f.workspace, { name: "Other agent project" });
    for (let i = 0; i < 19; i++) await service.register(f.owner.userId, f.workspace, f.project, registration(service, f.owner.userId, { profile: { alias: `PROFILE-${i}`, operator_id: f.owner.userId, tool_label: "" } }));
    const results = await Promise.allSettled([
      service.register(f.owner.userId, f.workspace, f.project, registration(service, f.owner.userId, { profile: { alias: "LAST-A", operator_id: f.owner.userId, tool_label: "" } })),
      service.register(f.other.userId, f.workspace, second.id, registration(service, f.other.userId, { profile: { alias: "LAST-B", operator_id: f.other.userId, tool_label: "" } })),
    ]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const rejected = results.find(r => r.status === "rejected"); assert.equal(rejected?.status === "rejected" ? rejected.reason.status : null, 409);
    assert.equal((await service.list(f.owner.userId, f.workspace, f.project)).profiles.length, 20);
  });
  await t.test("admin demotion while registration waits prevents the write", async () => {
    const f = await fixture(); await repo.addMember(f.owner.userId, f.workspace, { email: f.other.email, role: "admin" });
    const client = await pool.connect(); let write: Promise<unknown> | undefined;
    try {
      await client.query("BEGIN"); await client.query("UPDATE memberships SET role='member' WHERE workspace_id=$1 AND user_id=$2", [f.workspace, f.other.userId]);
      write = service.register(f.other.userId, f.workspace, f.project, registration(service, f.other.userId)); void write.catch(() => {});
      let blocked = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        const state = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname='stride_test' AND wait_event_type='Lock' AND query LIKE 'UPDATE memberships SET role=role%' LIMIT 1");
        if (state.rowCount) { blocked = true; break; } await delay(25);
      }
      assert.equal(blocked, true); await client.query("COMMIT"); await assert.rejects(write, { status: 409 });
      assert.equal((await service.list(f.owner.userId, f.workspace, f.project)).profiles.length, 0);
    } finally { await client.query("ROLLBACK"); client.release(); if (write) await write.catch(() => {}); }
  });
});

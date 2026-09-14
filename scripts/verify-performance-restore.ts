import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { Repository } from "../lib/server/repository.ts";
import { PostgresDatabase } from "../lib/server/postgres-adapter.ts";
import { parseTaskQuery } from "../lib/domain.ts";

const input = process.env.TEST_DATABASE_URL;
const url = new URL(input ?? ""); const container = process.env.TEST_POSTGRES_CONTAINER;
if (process.env.CI !== "true" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/stride_test" || !container || !/^[a-f0-9]{12,64}$/.test(container)) throw new Error("Restore and performance checks require the isolated CI PostgreSQL container");
const pool = new Pool({ connectionString: input, max: 3, statement_timeout: 10000 });
const folder = mkdtempSync(join(tmpdir(), "stride-restore-")); let restorePool: Pool | undefined;
try {
  const repo = new Repository(new PostgresDatabase(pool)); const suffix = crypto.randomUUID();
  const user = { userId: `perf_${suffix}`, email: `perf_${suffix}@example.test`, displayName: "Performance fixture" };
  const workspace = (await repo.bootstrap(user)).workspaces[0].id; const project = (await repo.metadata(user.userId, workspace)).projects[0].id;
  await pool.query(`INSERT INTO tasks(id,workspace_id,project_id,title,status,priority,assignee_id,due_date,last_mutation_id,created_by,updated_by,created_at,updated_at)
    SELECT $1||':'||g,$1,$2,'Performance task '||g,CASE WHEN g%3=0 THEN 'in_progress' ELSE 'todo' END,
    CASE WHEN g%3=0 THEN 'high' WHEN g%3=1 THEN 'medium' ELSE 'low' END,$3,
    CASE WHEN g%4=0 THEN NULL ELSE '2026-09-'||lpad((1+g%28)::text,2,'0') END,$1||':'||g,$3,$3,$4,$4 FROM generate_series(1,20000) AS g`, [workspace, project, user.userId, new Date().toISOString()]);
  await pool.query("ANALYZE tasks");
  const scenarios = [
    ["my_tasks", { assignee_id: user.userId }], ["project_board", { project_id: project, include_done: "true" }],
    ["overdue_high", { due: "overdue", priority: "high" }], ["title_search", { query: "task 19", sort: "priority" }],
  ] as const;
  for (const [name, filters] of scenarios) {
    const query = parseTaskQuery(new URLSearchParams(filters)); const durations: number[] = []; let bytes = 0;
    for (let sample = 0; sample < 21; sample++) {
      const start = performance.now(); const result = await repo.listTasks(user.userId, workspace, query);
      if (sample) durations.push(performance.now() - start); assert.ok(result.tasks.length <= 50); bytes = Buffer.byteLength(JSON.stringify(result));
    }
    durations.sort((a, b) => a - b); const p95 = durations[Math.ceil(durations.length * .95) - 1];
    assert.ok(p95 < 1000, `CI query budget exceeded for ${name}`);
    console.log(JSON.stringify({ event: "query_benchmark", fixtureTasks: 20000, scenario: name, samples: durations.length, p50_ms: Number(durations[9].toFixed(2)), p95_ms: Number(p95.toFixed(2)), response_bytes: bytes, environment: "isolated_unloaded_CI" }));
  }
  const plan = await pool.query("EXPLAIN (FORMAT JSON) SELECT id FROM tasks WHERE workspace_id=$1 AND assignee_id=$2 AND archived_at IS NULL AND due_date='2026-09-14'", [workspace, user.userId]);
  assert.match(JSON.stringify(plan.rows), /Index|Bitmap/);
  // Use the service container's matching PG18 binaries; no production destination is accepted.
  const backup = join(folder, "stride.dump");
  execFileSync("docker", ["exec", container, "pg_dump", "-U", "stride_test", "-d", "stride_test", "--format=custom", "--no-owner", "--no-privileges", "--file=/tmp/stride-ci.dump"], { stdio: "pipe" });
  execFileSync("docker", ["cp", `${container}:/tmp/stride-ci.dump`, backup], { stdio: "pipe" });
  execFileSync("docker", ["exec", container, "createdb", "-U", "stride_test", "stride_restore"], { stdio: "pipe" });
  execFileSync("docker", ["exec", container, "pg_restore", "-U", "stride_test", "--dbname=stride_restore", "--no-owner", "--no-privileges", "--exit-on-error", "/tmp/stride-ci.dump"], { stdio: "pipe" });
  const restoredUrl = new URL(url); restoredUrl.pathname = "/stride_restore"; restorePool = new Pool({ connectionString: restoredUrl.href, max: 1 });
  const tables = ["tasks", "checklist_items", "memberships", "comments", "notifications", "invitations", "account_admissions", "saved_views", "task_templates", "attachments", "email_outbox"];
  for (const table of tables) {
    const sourceCount = await pool.query<{ n: number }>(`SELECT COUNT(*)::integer AS n FROM ${table}`);
    const restoredCount = await restorePool.query<{ n: number }>(`SELECT COUNT(*)::integer AS n FROM ${table}`);
    assert.equal(sourceCount.rows[0].n, restoredCount.rows[0].n, `Restored count differs for ${table}`);
  }
  const restoredRepo = new Repository(new PostgresDatabase(restorePool));
  const restoredPage = await restoredRepo.listTasks(user.userId, workspace, parseTaskQuery(new URLSearchParams({ limit: "50", assignee_id: user.userId })));
  assert.equal(restoredPage.tasks.length, 50);
  const sample = restoredPage.tasks[0]; await restoredRepo.updateTask(user.userId, workspace, sample.id, { version: sample.version, status: "done" });
  assert.equal((await repo.task(user.userId, workspace, sample.id)).status, sample.status);
  console.log(JSON.stringify({ event: "backup_restore_verified", tables: tables.length, fixtureTasks: 20000, isolatedDatabase: "stride_restore", independent_write_verified: true }));
} finally {
  await restorePool?.end(); await pool.end(); rmSync(folder, { recursive: true, force: true });
}

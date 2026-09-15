import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { hashPassword } from "better-auth/crypto";
import { loadLocalSettings, provisioningEnvironment } from "./local-environment.mjs";

// Runs only in the dedicated ephemeral local-setup CI job, never a user's database.
if (process.env.CI !== "true" || process.env.STRIDE_LOCAL_FIXTURE !== "isolated-runner") throw new Error("Requires the isolated local-setup CI job.");
const root = fileURLToPath(new URL("../", import.meta.url));
const settings = await loadLocalSettings(root);
assert.equal(settings?.appPort, 3109); assert.equal(settings?.dbPort, 55439);
const adminUrl = new URL(provisioningEnvironment(settings).MIGRATION_DATABASE_URL);
assert.equal(adminUrl.hostname, "127.0.0.1"); assert.equal(adminUrl.pathname, "/stride_local");
const admin = new Pool({ connectionString: adminUrl.href, max: 1 });
const changedPassword = await hashPassword(randomBytes(32).toString("hex"));
try {
  const tables = await admin.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'");
  assert.ok(tables.rows[0].count >= 41);
  const changed = await admin.query("UPDATE auth_accounts SET password=$1 WHERE provider_id='credential' AND user_id IN (SELECT id FROM auth_users WHERE email='owner@stride.invalid') RETURNING id", [changedPassword]);
  assert.equal(changed.rowCount, 1);
} finally { await admin.end(); }
// The fixture marker itself is never passed into the guarded developer command.
const environment = { ...process.env }; delete environment.STRIDE_LOCAL_FIXTURE;
const result = spawnSync(process.execPath, ["scripts/local.mjs", "setup"], { cwd: root, env: environment, encoding: "utf8", timeout: 300_000, maxBuffer: 1024 * 1024 });
assert.equal(result.status, 0, "Repeated local setup failed; child output withheld to protect credentials.");
assert.deepEqual(await loadLocalSettings(root), settings);
const runtimeUrl = new URL(adminUrl); runtimeUrl.username = "stride_app"; runtimeUrl.password = settings.runtimePassword;
const runtime = new Pool({ connectionString: runtimeUrl.href, max: 1 });
try {
  const role = await runtime.query("SELECT current_user AS name, usesuper FROM pg_user WHERE usename=current_user");
  assert.equal(role.rows[0].name, "stride_app"); assert.equal(role.rows[0].usesuper, false);
  const accounts = await runtime.query("SELECT a.password FROM auth_accounts a JOIN auth_users u ON u.id=a.user_id WHERE u.email='owner@stride.invalid' AND a.provider_id='credential'");
  assert.equal(accounts.rows.length, 1); assert.equal(accounts.rows[0].password, changedPassword);
  console.log("Local setup verified: real PostgreSQL 18 migrations, restricted runtime role, repeated setup and preservation of changed owner credentials.");
} finally { await runtime.end(); }

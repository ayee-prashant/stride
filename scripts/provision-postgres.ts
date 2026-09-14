import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { hashPassword } from "better-auth/crypto";
import { allowedEmails, postgresSettings } from "../lib/server/deployment-config.ts";

const environment = process.env;
const migrationUrl = environment.MIGRATION_DATABASE_URL;
const runtimePassword = environment.STRIDE_RUNTIME_PASSWORD ?? "";
const ownerEmail = (environment.STRIDE_BOOTSTRAP_EMAIL ?? "").trim().toLowerCase();
const ownerName = (environment.STRIDE_BOOTSTRAP_NAME ?? "").trim();
const ownerPassword = environment.STRIDE_BOOTSTRAP_PASSWORD ?? "";
let stage = "validate";
let pool: Pool | undefined;

try {
  if (!migrationUrl || !/^[a-f0-9]{64}$/.test(runtimePassword) || !allowedEmails(environment).has(ownerEmail) ||
      !ownerName || ownerName.length > 100 || ownerPassword.length < 12 || ownerPassword.length > 128) {
    throw new Error("Provisioning configuration is incomplete");
  }
  const sqlFiles = (await readdir("drizzle-postgres")).filter(file => file.endsWith(".sql"));
  if (!sqlFiles.length) throw new Error("Committed migrations are required");
  pool = new Pool({ ...postgresSettings({ ...environment, DATABASE_URL: migrationUrl }), max: 1 });
  stage = "migrate";
  await migrate(drizzle(pool), { migrationsFolder: "drizzle-postgres" });
  const client = await pool.connect();
  let ownerCreated = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('stride.provision'))");
    stage = "runtime-role";
    await client.query("SELECT set_config('stride.runtime_password', $1, true)", [runtimePassword]);
    await client.query(`DO $role$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='stride_app') THEN
          CREATE ROLE stride_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20;
        END IF;
        EXECUTE format('ALTER ROLE stride_app PASSWORD %L', current_setting('stride.runtime_password'));
        EXECUTE format('GRANT CONNECT ON DATABASE %I TO stride_app', current_database());
      END
    $role$`);
    await client.query("GRANT USAGE ON SCHEMA public TO stride_app");
    await client.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO stride_app");
    // Accepted requirements and delivered context evidence are append-only to the runtime.
    await client.query("REVOKE UPDATE, DELETE ON context_revisions, context_events, task_context_briefs FROM stride_app");
    await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO stride_app");
    stage = "owner";
    const existing = await client.query<{ id: string }>("SELECT id FROM auth_users WHERE email=$1 LIMIT 1", [ownerEmail]);
    if (existing.rows.length) {
      const credential = await client.query("SELECT id FROM auth_accounts WHERE user_id=$1 AND provider_id='credential' LIMIT 2", [existing.rows[0].id]);
      if (credential.rows.length !== 1) throw new Error("Existing account requires explicit recovery");
      // Existing credentials and password changes are preserved on every redeploy.
    } else {
      const id = randomUUID();
      const passwordHash = await hashPassword(ownerPassword);
      await client.query("INSERT INTO auth_users(id,name,email,email_verified) VALUES($1,$2,$3,false)", [id, ownerName, ownerEmail]);
      await client.query("INSERT INTO auth_accounts(id,account_id,provider_id,user_id,password) VALUES($1,$2,'credential',$2,$3)", [randomUUID(), id, passwordHash]);
      ownerCreated = true;
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ event: "database_provisioned", ownerCreated, runtimeRole: "stride_app" }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
} catch (error) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : undefined;
  console.error(JSON.stringify({ event: "database_provisioning_failed", stage, ...(code ? { code } : {}) }));
  process.exitCode = 1;
} finally { await pool?.end(); }

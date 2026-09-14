import { readdir } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { postgresSettings } from "../lib/server/deployment-config.ts";

// Run once as a controlled deployment job with a separate migration credential.
// Never call from an HTTP handler or Next.js build.
const migrationsFolder = new URL("../drizzle-postgres/", import.meta.url).pathname;
const files = await readdir(migrationsFolder);
if (!files.some(file => file.endsWith(".sql"))) throw new Error("No reviewed PostgreSQL migrations found");
if (!process.env.MIGRATION_DATABASE_URL) throw new Error("MIGRATION_DATABASE_URL is required");
const pool = new Pool({ ...postgresSettings({ ...process.env, DATABASE_URL: process.env.MIGRATION_DATABASE_URL }), max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder });
  console.log("PostgreSQL migrations applied.");
} catch {
  console.error("Migration failed. Inspect the database through the provider's authenticated console.");
  process.exitCode = 1;
} finally { await pool.end(); }

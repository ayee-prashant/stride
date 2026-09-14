import { Pool } from "pg";
import { authenticationSettings, postgresSettings } from "../lib/server/deployment-config.ts";
import { PostgresDatabase } from "../lib/server/postgres-adapter.ts";
import { Repository } from "../lib/server/repository.ts";
import { createMailProvider, emailConfigured } from "../lib/server/email.ts";
import { Attachments } from "../lib/server/attachments.ts";
import { createObjectStorage, storageConfigured } from "../lib/server/s3-storage.ts";
import { ScheduledWork } from "../lib/server/scheduled-work.ts";

const settings = authenticationSettings(process.env);
const pool = new Pool(postgresSettings(process.env));
pool.on("error", () => console.error(JSON.stringify({ event: "worker_database_error" })));
try {
  const repo = new Repository(new PostgresDatabase(pool));
  const work = new ScheduledWork(repo, settings.secret, settings.origin, settings.approvedEmails);
  const result = await work.run(emailConfigured(process.env) ? createMailProvider(process.env) : null);
  if (storageConfigured(process.env)) await new Attachments(repo, createObjectStorage(process.env)).cleanup();
  console.info(JSON.stringify({ event: "scheduled_work_completed", ...result }));
} catch {
  console.error(JSON.stringify({ event: "scheduled_work_failed" })); process.exitCode = 1;
} finally { await pool.end(); }

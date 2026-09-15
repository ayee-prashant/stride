import { Pool } from "pg";
import { Repository } from "../lib/server/repository.ts";
import { PostgresDatabase } from "../lib/server/postgres-adapter.ts";
import { postgresSettings } from "../lib/server/deployment-config.ts";
import { githubContextSettings, githubContextBindings } from "../lib/server/github-context-provider.ts";
import { DeliveryEvidenceStore, GitHubEvidenceProvider } from "../lib/server/delivery-evidence.ts";
import { DeliveryService } from "../lib/server/delivery-service.ts";
import { RepositorySources } from "../lib/server/repository-sources.ts";
import { reconcileSource } from "../lib/server/reconcile-source.ts";

import { deliverySessionCheck, deliveryDatabaseClock } from "../lib/server/delivery-session.ts";

const pool = new Pool(postgresSettings(process.env)); const repo = new Repository(new PostgresDatabase(pool));
const bindings = githubContextBindings(process.env); const settings = githubContextSettings(process.env);
const evidence = new DeliveryEvidenceStore(repo, bindings); const provider = settings ? new GitHubEvidenceProvider(settings) : null;
const sources = new RepositorySources(repo, bindings);
pool.on("error", () => console.error(JSON.stringify({ event: "agent_worker_database_error" })));
let running = true; process.once("SIGINT", () => { running = false; }); process.once("SIGTERM", () => { running = false; });
try {
  console.info(JSON.stringify({ event: "agent_worker_started", repository_configured: !!provider }));
  while (running) {
    let failed = false;
    try {
      const result = await new DeliveryService(repo, { bindings, databaseClock: deliveryDatabaseClock, sessionActive: deliverySessionCheck(repo) }).reconcile();
      if (result.examined) console.info(JSON.stringify({ event: "agent_attempts_reconciled", examined: result.examined }));
      if (provider) {
        // One source and one candidate observation at a time; both are bounded
        // by provider deadlines and persistent generation/lease fences.
        const outcomes = await Promise.allSettled([reconcileSource(sources, provider), evidence.process(provider)]);
        for (const outcome of outcomes) if (outcome.status === "rejected") { failed = true; console.error(JSON.stringify({ event: "agent_repository_retry" })); }
      }
    } catch { failed = true; console.error(JSON.stringify({ event: "agent_delivery_worker_retry" })); }
    if (process.argv.includes("--once")) { if (failed) process.exitCode = 1; break; }
    if (running) await new Promise(resolve => setTimeout(resolve, 10000));
  }
} finally { await pool.end(); }

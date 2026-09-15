import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { postgresSettings } from "../lib/server/deployment-config.ts";
import { PostgresDatabase } from "../lib/server/postgres-adapter.ts";
import { Repository } from "../lib/server/repository.ts";
import { GitHubContextProvider, githubContextSettings } from "../lib/server/github-context-provider.ts";
import { RepositorySources } from "../lib/server/repository-sources.ts";
import { reconcileSource } from "../lib/server/reconcile-source.ts";

// Dedicated persistent process. One bounded external observation at a time; no coding execution.
let pool: Pool | undefined;
const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
process.once("SIGINT", () => stop.abort());
try {
  const settings = githubContextSettings(process.env);
  if (!settings) throw new Error("setup_required");
  pool = new Pool(postgresSettings(process.env));
  pool.on("error", () => console.error(JSON.stringify({ event: "context_worker_database_error" })));
  const sources = new RepositorySources(new Repository(new PostgresDatabase(pool)), settings.bindings);
  const provider = new GitHubContextProvider(settings);
  while (!stop.signal.aborted) {
    try {
      const outcome = await reconcileSource(sources, provider);
      if (outcome !== "idle") console.info(JSON.stringify({ event: "context_reconciliation", outcome }));
      if (outcome === "idle") await delay(2000, undefined, { signal: stop.signal });
    } catch {
      if (stop.signal.aborted) break;
      console.error(JSON.stringify({ event: "context_reconciliation_failed" }));
      await delay(5000, undefined, { signal: stop.signal }).catch(() => {});
    }
  }
} catch {
  console.error(JSON.stringify({ event: "context_worker_setup_failed" })); process.exitCode = 1;
} finally { await pool?.end(); }

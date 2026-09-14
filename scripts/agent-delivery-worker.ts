import { Pool } from "pg";
import { Repository } from "../lib/server/repository.ts";
import { PostgresDatabase } from "../lib/server/postgres-adapter.ts";
import { postgresSettings } from "../lib/server/deployment-config.ts";
import { githubContextSettings, githubContextBindings } from "../lib/server/github-context-provider.ts";
import { DeliveryEvidenceStore, GitHubEvidenceProvider } from "../lib/server/delivery-evidence.ts";
import { DeliveryService } from "../lib/server/delivery-service.ts";

import { deliverySessionCheck, deliveryDatabaseClock } from "../lib/server/delivery-session.ts";

const pool = new Pool(postgresSettings(process.env)); const repo = new Repository(new PostgresDatabase(pool));
const bindings = githubContextBindings(process.env); const settings = githubContextSettings(process.env);
const evidence = new DeliveryEvidenceStore(repo, bindings); const provider = settings ? new GitHubEvidenceProvider(settings) : null;
let running = true; process.once("SIGINT", () => { running = false; }); process.once("SIGTERM", () => { running = false; });
try { while (running) { try { await new DeliveryService(repo, { bindings, databaseClock: deliveryDatabaseClock, sessionActive: deliverySessionCheck(repo) }).reconcile(); if (provider) for (let i = 0; i < 5 && running && await evidence.process(provider); i++) { /* bounded worker batch */ } } catch { console.error(JSON.stringify({ event: "agent_delivery_worker_retry" })); } if (process.argv.includes("--once")) break; if (running) await new Promise(resolve => setTimeout(resolve, 10000)); } } finally { await pool.end(); }

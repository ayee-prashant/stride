import "server-only";
import { Pool } from "pg";
import { postgresSettings } from "./deployment-config";
import { PostgresDatabase } from "./postgres-adapter";
import { Repository } from "./repository";

let pool: Pool | undefined;
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(postgresSettings(process.env));
    // Never log the driver error: it can contain hosts, SQL, or connection details.
    pool.on("error", () => console.error(JSON.stringify({ event: "database_pool_error" })));
  }
  return pool;
}
export function getRepository(): Repository {
  return new Repository(new PostgresDatabase(getPool()));
}

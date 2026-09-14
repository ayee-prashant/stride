import { AppError } from "../domain.ts";

type Environment = Record<string, string | undefined>;
const unavailable = () => new AppError(503, "SETUP_REQUIRED", "Workspace setup is not complete yet.");

export function applicationOrigin(environment: Environment): string {
  try {
    const url = new URL(environment.APP_URL ?? "");
    const local = environment.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) throw unavailable();
    return url.origin;
  } catch { throw unavailable(); }
}

export function allowedGitHubIds(environment: Environment): ReadonlySet<string> {
  const ids = (environment.STRIDE_ALLOWED_GITHUB_IDS ?? "").split(",").map(id => id.trim());
  if (!ids.length || ids.length > 50 || ids.some(id => !/^[1-9]\d{0,19}$/.test(id))) throw unavailable();
  return new Set(ids);
}

export function authenticationSettings(environment: Environment) {
  const origin = applicationOrigin(environment);
  const allowedIds = allowedGitHubIds(environment);
  const secret = environment.BETTER_AUTH_SECRET ?? "";
  const clientId = environment.GITHUB_CLIENT_ID ?? "";
  const clientSecret = environment.GITHUB_CLIENT_SECRET ?? "";
  if (secret.length < 32 || !clientId.trim() || !clientSecret.trim()) throw unavailable();
  return { origin, allowedIds, secret, clientId, clientSecret };
}

/** Parse explicitly so URL ssl parameters cannot override certificate verification. */
export function postgresSettings(environment: Environment) {
  try {
    const url = new URL(environment.DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password || !url.pathname.slice(1) || url.hash) throw unavailable();
    for (const key of url.searchParams.keys()) {
      if (key.toLowerCase().startsWith("ssl")) throw unavailable();
    }
    const local = environment.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const ca = environment.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
    if (ca && !ca.includes("-----BEGIN CERTIFICATE-----")) throw unavailable();
    return {
      connectionString: url.toString(),
      ssl: local ? false as const : { rejectUnauthorized: true as const, ...(ca ? { ca } : {}) },
      max: 3,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      statement_timeout: 10_000,
      idle_in_transaction_session_timeout: 15_000,
      maxLifetimeSeconds: 300,
      application_name: "stride",
    };
  } catch { throw unavailable(); }
}

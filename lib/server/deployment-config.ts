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

export function allowedEmails(environment: Environment): ReadonlySet<string> {
  const emails = (environment.STRIDE_ALLOWED_EMAILS ?? "").split(",").map(email => email.trim().toLowerCase());
  if (!emails.length || emails.length > 50 || emails.some(email => email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw unavailable();
  return new Set(emails);
}

export function authenticationSettings(environment: Environment) {
  const origin = applicationOrigin(environment);
  const approvedEmails = allowedEmails(environment);
  const secret = environment.BETTER_AUTH_SECRET ?? "";
  if (secret.length < 32) throw unavailable();
  return { origin, approvedEmails, secret };
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

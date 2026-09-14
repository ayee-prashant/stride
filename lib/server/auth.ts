import "server-only";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/node-postgres";
import { authSchema } from "../../db/auth-schema";
import type { Identity } from "../domain";
import { authenticationSettings } from "./deployment-config";
import { getPool } from "./database";

function createAuth() {
  const settings = authenticationSettings(process.env);
  return betterAuth({
    appName: "Stride",
    baseURL: settings.origin,
    secret: settings.secret,
    trustedOrigins: [settings.origin],
    database: drizzleAdapter(drizzle(getPool()), { provider: "pg", schema: authSchema }),
    emailAndPassword: { enabled: false },
    socialProviders: {
      github: {
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
        mapProfileToUser(profile) {
          if (!settings.allowedIds.has(String(profile.id))) {
            throw new APIError("FORBIDDEN", { message: "This account does not have access to Stride." });
          }
          return {};
        },
      },
    },
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60, customRules: { "/sign-in/social": { window: 60, max: 10 } } },
    advanced: {
      cookiePrefix: "stride",
      useSecureCookies: settings.origin.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    databaseHooks: {
      account: {
        create: {
          before(account) {
            if (account.providerId !== "github" || !settings.allowedIds.has(account.accountId)) {
              throw new APIError("FORBIDDEN", { message: "This account does not have access to Stride." });
            }
            return Promise.resolve({ data: account });
          },
        },
      },
    },
    logger: { disabled: true },
  });
}

let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() { return instance ??= createAuth(); }

export async function getSessionIdentity(requestHeaders: Headers): Promise<Identity | null> {
  // A cookie's presence and caller-supplied identity headers never establish identity.
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const accounts = await getPool().query<{ account_id: string }>(
    "SELECT account_id FROM auth_accounts WHERE user_id=$1 AND provider_id='github' LIMIT 2", [session.user.id],
  );
  const allowed = authenticationSettings(process.env).allowedIds;
  if (accounts.rows.length !== 1 || !allowed.has(accounts.rows[0].account_id)) return null;
  return { userId: session.user.id, email: session.user.email, displayName: session.user.name || session.user.email };
}

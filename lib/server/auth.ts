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
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    user: { changeEmail: { enabled: false }, deleteUser: { enabled: false } },
    account: { accountLinking: { enabled: false } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    rateLimit: {
      enabled: true, storage: "database", window: 60, max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/change-password": { window: 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: "stride",
      useSecureCookies: settings.origin.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    databaseHooks: {
      account: {
        create: {
          async before(account) {
            const users = await getPool().query<{ email: string }>("SELECT email FROM auth_users WHERE id=$1 LIMIT 1", [account.userId]);
            if (account.providerId !== "credential" || users.rows.length !== 1 || !settings.approvedEmails.has(users.rows[0].email.toLowerCase())) {
              throw new APIError("FORBIDDEN", { message: "This account does not have access to Stride." });
            }
            return { data: account };
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
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session || !authenticationSettings(process.env).approvedEmails.has(session.user.email.toLowerCase())) return null;
  const accounts = await getPool().query<{ id: string }>(
    "SELECT id FROM auth_accounts WHERE user_id=$1 AND provider_id='credential' LIMIT 2", [session.user.id],
  );
  if (accounts.rows.length !== 1) return null;
  return { userId: session.user.id, email: session.user.email, displayName: session.user.name || session.user.email };
}

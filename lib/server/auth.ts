import "server-only";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/node-postgres";
import { authSchema } from "../../db/auth-schema";
import type { Identity } from "../domain";
import { authenticationSettings } from "./deployment-config";
import { getPool, getRepository } from "./database";
import { createHash } from "node:crypto";
import { EmailOutbox, emailConfigured } from "./email";

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
      resetPasswordTokenExpiresIn: 1800,
      sendResetPassword: async ({ user, url, token }) => {
        if (!emailConfigured(process.env)) throw new APIError("SERVICE_UNAVAILABLE", { message: "Account recovery email is not connected yet." });
        if (!await admitted(user.id, user.email)) return;
        const address = new URL(url); if (address.origin !== settings.origin) throw new Error("Invalid recovery origin");
        const outbox = new EmailOutbox(getRepository(), settings.secret);
        await outbox.enqueue({ to: user.email, subject: "Reset your Stride password", text: `Use this link within 30 minutes to reset your password:\n\n${url}\n\nIf you did not request this, you can ignore this email.`, key: `reset:${createHash("sha256").update(token).digest("hex")}` }, "reset", new Date(Date.now() + 30 * 60000).toISOString(), null, user.id);
      },
    },
    user: { changeEmail: { enabled: false }, deleteUser: { enabled: false } },
    account: { accountLinking: { enabled: false } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    rateLimit: {
      enabled: true, storage: "database", window: 60, max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/change-password": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 5 },
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
            if (account.providerId !== "credential" || users.rows.length !== 1 || !await admitted(account.userId, users.rows[0].email)) {
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

async function admitted(userId: string, email: string): Promise<boolean> {
  if (authenticationSettings(process.env).approvedEmails.has(email.toLowerCase())) return true;
  const result = await getPool().query("SELECT user_id FROM account_admissions WHERE user_id=$1 AND email=$2 LIMIT 1", [userId, email.toLowerCase()]);
  return result.rows.length === 1;
}
export async function getInviteIdentity(requestHeaders: Headers): Promise<Identity | null> {
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const accounts = await getPool().query<{ id: string }>(
    "SELECT id FROM auth_accounts WHERE user_id=$1 AND provider_id='credential' LIMIT 2", [session.user.id],
  );
  if (accounts.rows.length !== 1) return null;
  return { userId: session.user.id, email: session.user.email, displayName: session.user.name || session.user.email };
}

export async function getSessionIdentity(requestHeaders: Headers): Promise<Identity | null> {
  const user = await getInviteIdentity(requestHeaders);
  return user && await admitted(user.userId, user.email) ? user : null;
}

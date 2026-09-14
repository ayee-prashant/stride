import { pgTable, text, timestamp, boolean, integer, bigint, index, uniqueIndex } from "drizzle-orm/pg-core";

// Auth tables have their own names; the domain's users table remains separate.
export const authUser = pgTable("auth_users", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false), image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const authSession = pgTable("auth_sessions", {
  id: text("id").primaryKey(), token: text("token").notNull().unique(),
  userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"), userAgent: text("user_agent"),
}, t => [index("idx_auth_sessions_user").on(t.userId)]);
export const authAccount = pgTable("auth_accounts", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
  accessToken: text("access_token"), refreshToken: text("refresh_token"), idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"), password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("idx_auth_accounts_user").on(t.userId), uniqueIndex("uq_auth_provider_account").on(t.providerId, t.accountId)]);
export const authVerification = pgTable("auth_verifications", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("idx_auth_verifications_identifier").on(t.identifier)]);
export const authRateLimit = pgTable("auth_rate_limits", {
  id: text("id").primaryKey(), key: text("key").notNull().unique(),
  count: integer("count").notNull(), lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const authSchema = {
  user: authUser, session: authSession, account: authAccount,
  verification: authVerification, rateLimit: authRateLimit,
};

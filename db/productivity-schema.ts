import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, primaryKey, text, unique } from "drizzle-orm/pg-core";
import { comments, memberships, tasks, users, workspaces } from "./postgres-schema";
import { authUser } from "./auth-schema";

export const checklistItems = pgTable("checklist_items", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), taskId: text("task_id").notNull(),
  title: text("title").notNull(), completed: integer("completed").notNull().default(0),
  position: integer("position").notNull(), version: integer("version").notNull().default(1), createdAt: text("created_at").notNull(),
}, t => [
  foreignKey({ columns: [t.workspaceId, t.taskId], foreignColumns: [tasks.workspaceId, tasks.id] }),
  index("idx_checklist_task").on(t.workspaceId, t.taskId, t.position),
  check("checklist_values", sql`length(${t.title}) BETWEEN 1 AND 200 AND ${t.completed} IN (0,1) AND ${t.version} > 0`),
]);
export const savedViews = pgTable("saved_views", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), userId: text("user_id").notNull(),
  name: text("name").notNull(), filters: text("filters").notNull(), version: integer("version").notNull().default(1), createdAt: text("created_at").notNull(),
}, t => [foreignKey({ columns: [t.workspaceId, t.userId], foreignColumns: [memberships.workspaceId, memberships.userId] }), index("idx_saved_views_owner").on(t.workspaceId, t.userId), check("saved_view_version", sql`${t.version}>0`)]);
export const taskTemplates = pgTable("task_templates", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id), createdBy: text("created_by").notNull().references(() => users.id),
  name: text("name").notNull(), task: text("task").notNull(), checklist: text("checklist").notNull(), version: integer("version").notNull().default(1), createdAt: text("created_at").notNull(),
}, t => [index("idx_templates_workspace").on(t.workspaceId), check("template_version", sql`${t.version}>0`)]);
export const notificationPreferences = pgTable("notification_preferences", {
  workspaceId: text("workspace_id").notNull(), userId: text("user_id").notNull(), assignments: integer("assignments").notNull().default(1),
  mentions: integer("mentions").notNull().default(1), dueReminders: integer("due_reminders").notNull().default(1), dailyDigest: integer("daily_digest").notNull().default(0),
  timezone: text("timezone").notNull().default("UTC"), reminderHour: integer("reminder_hour").notNull().default(9), version: integer("version").notNull().default(1),
}, t => [
  primaryKey({ columns: [t.workspaceId, t.userId] }),
  foreignKey({ columns: [t.workspaceId, t.userId], foreignColumns: [memberships.workspaceId, memberships.userId] }),
  check("preference_values", sql`${t.assignments} IN (0,1) AND ${t.mentions} IN (0,1) AND ${t.dueReminders} IN (0,1) AND ${t.dailyDigest} IN (0,1) AND ${t.reminderHour} BETWEEN 0 AND 23 AND ${t.version}>0`),
]);
export const taskNotificationSettings = pgTable("task_notification_settings", {
  workspaceId: text("workspace_id").notNull(), taskId: text("task_id").notNull(), userId: text("user_id").notNull(), muted: integer("muted").notNull().default(0),
}, t => [
  primaryKey({ columns: [t.workspaceId, t.taskId, t.userId] }),
  foreignKey({ columns: [t.workspaceId, t.taskId], foreignColumns: [tasks.workspaceId, tasks.id] }),
  foreignKey({ columns: [t.workspaceId, t.userId], foreignColumns: [memberships.workspaceId, memberships.userId] }),
  check("task_mute_value", sql`${t.muted} IN (0,1)`),
]);
export const invitations = pgTable("invitations", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  email: text("email").notNull(), role: text("role").notNull(), tokenHash: text("token_hash").notNull().unique(),
  createdBy: text("created_by").notNull().references(() => users.id), expiresAt: text("expires_at").notNull(),
  acceptedAt: text("accepted_at"), acceptedBy: text("accepted_by").references(() => authUser.id), revokedAt: text("revoked_at"), createdAt: text("created_at").notNull(),
}, t => [index("idx_invitations_workspace").on(t.workspaceId, t.createdAt), check("invitation_role", sql`${t.role} IN ('admin','member')`)]);
export const accountAdmissions = pgTable("account_admissions", {
  userId: text("user_id").primaryKey().references(() => authUser.id), invitationId: text("invitation_id").notNull().references(() => invitations.id),
  email: text("email").notNull(), createdAt: text("created_at").notNull(),
});
export const attachments = pgTable("attachments", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), taskId: text("task_id").notNull(), commentId: text("comment_id").references(() => comments.id),
  objectKey: text("object_key").notNull().unique(), filename: text("filename").notNull(), mediaType: text("media_type").notNull(), byteSize: integer("byte_size").notNull(),
  uploadedBy: text("uploaded_by").notNull().references(() => users.id), status: text("status").notNull(), createdAt: text("created_at").notNull(),
}, t => [
  foreignKey({ columns: [t.workspaceId, t.taskId], foreignColumns: [tasks.workspaceId, tasks.id] }),
  index("idx_attachments_task").on(t.workspaceId, t.taskId),
  index("idx_attachments_cleanup").on(t.status, t.createdAt),
  check("attachment_values", sql`${t.byteSize} BETWEEN 1 AND 5242880 AND ${t.status} IN ('pending','ready','removed')`),
]);
export const emailOutbox = pgTable("email_outbox", {
  id: text("id").primaryKey(), dedupeKey: text("dedupe_key").notNull(),
  recipient: text("recipient").notNull(), subject: text("subject").notNull(), body: text("body").notNull(),
  workspaceId: text("workspace_id"), userId: text("user_id"), kind: text("kind").notNull(),
  status: text("status").notNull().default("pending"), attempts: integer("attempts").notNull().default(0),
  availableAt: text("available_at").notNull(), expiresAt: text("expires_at").notNull(), leaseId: text("lease_id"),
  sentAt: text("sent_at"), createdAt: text("created_at").notNull(),
}, t => [unique("uq_email_dedupe").on(t.dedupeKey), index("idx_email_delivery").on(t.status, t.availableAt), check("email_values", sql`${t.kind} IN ('reset','digest') AND ${t.status} IN ('pending','sending','sent','failed') AND ${t.attempts} BETWEEN 0 AND 6`)]);

export const workerState = pgTable("worker_state", {
  name: text("name").primaryKey(), leaseUntil: text("lease_until").notNull(), leaseId: text("lease_id"),
  cursorWorkspace: text("cursor_workspace").notNull().default(""), cursorUser: text("cursor_user").notNull().default(""),
});

import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, primaryKey, uniqueIndex, index, foreignKey, check } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), email: text("email").notNull().unique(), name: text("name").notNull(), createdAt: text("created_at").notNull(),
});
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(), name: text("name").notNull(), ownerId: text("owner_id").notNull().unique().references(() => users.id), createdAt: text("created_at").notNull(),
});
export const memberships = sqliteTable("memberships", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  userId: text("user_id").notNull().references(() => users.id), role: text("role", { enum: ["admin", "member"] }).notNull(),
}, t => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("idx_memberships_user").on(t.userId), check("membership_role", sql`${t.role} IN ('admin','member')`)]);
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  name: text("name").notNull(), description: text("description").notNull().default(""),
  archivedAt: text("archived_at"), version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, t => [uniqueIndex("uq_project_workspace").on(t.workspaceId, t.id), index("idx_projects_workspace_archive").on(t.workspaceId, t.archivedAt), check("project_version", sql`${t.version} > 0`)]);
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(),
  title: text("title").notNull(), description: text("description").notNull().default(""),
  status: text("status", { enum: ["todo", "in_progress", "done"] }).notNull().default("todo"),
  priority: text("priority", { enum: ["low", "medium", "high"] }).notNull().default("medium"),
  assigneeId: text("assignee_id"), dueDate: text("due_date"), completedAt: text("completed_at"), archivedAt: text("archived_at"),
  version: integer("version").notNull().default(1), lastMutationId: text("last_mutation_id").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id), updatedBy: text("updated_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, t => [
  foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  foreignKey({ columns: [t.workspaceId, t.assigneeId], foreignColumns: [memberships.workspaceId, memberships.userId] }),
  uniqueIndex("uq_task_workspace").on(t.workspaceId, t.id),
  index("idx_tasks_workspace_project_archive").on(t.workspaceId, t.projectId, t.archivedAt),
  index("idx_tasks_workspace_assignee_archive").on(t.workspaceId, t.assigneeId, t.archivedAt),
  check("task_status", sql`${t.status} IN ('todo','in_progress','done')`),
  check("task_priority", sql`${t.priority} IN ('low','medium','high')`),
  check("task_version", sql`${t.version} > 0`),
  check("task_completion", sql`(${t.status} = 'done' AND ${t.completedAt} IS NOT NULL) OR (${t.status} != 'done' AND ${t.completedAt} IS NULL)`),
]);
export const activity = sqliteTable("activity", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), taskId: text("task_id").notNull(),
  actorId: text("actor_id").notNull().references(() => users.id), action: text("action").notNull(), createdAt: text("created_at").notNull(),
}, t => [foreignKey({ columns: [t.workspaceId, t.taskId], foreignColumns: [tasks.workspaceId, tasks.id] }), index("idx_activity_task").on(t.workspaceId, t.taskId, t.createdAt)]);
export const mutationLimits = sqliteTable("mutation_limits", {
  userId: text("user_id").primaryKey(), windowStart: integer("window_start").notNull(), hits: integer("hits").notNull(),
});

import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, primaryKey, text, unique } from "drizzle-orm/pg-core";
import { projects, tasks, users } from "./postgres-schema";

export const projectContextHeads = pgTable("project_context_heads", {
  projectId: text("project_id").primaryKey(), workspaceId: text("workspace_id").notNull(), sequence: integer("sequence").notNull().default(0),
}, t => [
  foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  check("context_sequence_nonnegative", sql`${t.sequence}>=0`),
]);
export const contextDocuments = pgTable("context_documents", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(),
  kind: text("kind").notNull(), currentVersion: integer("current_version").notNull(), createdAt: text("created_at").notNull(),
}, t => [
  foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  unique("uq_context_document_project").on(t.workspaceId, t.projectId, t.id),
  check("context_document_values", sql`${t.kind} IN ('requirement','decision','constraint') AND ${t.currentVersion} BETWEEN 1 AND 500`),
]);
export const contextRevisions = pgTable("context_revisions", {
  documentId: text("document_id").notNull(), workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(),
  version: integer("version").notNull(), title: text("title").notNull(), body: text("body").notNull(), state: text("state").notNull(),
  changeNote: text("change_note").notNull(), approvedBy: text("approved_by").notNull().references(() => users.id),
  approvedAt: text("approved_at").notNull(), requestId: text("request_id").notNull(), inputHash: text("input_hash").notNull(),
}, t => [
  primaryKey({ columns: [t.documentId, t.version] }),
  foreignKey({ columns: [t.workspaceId, t.projectId, t.documentId], foreignColumns: [contextDocuments.workspaceId, contextDocuments.projectId, contextDocuments.id] }),
  unique("uq_context_revision_project").on(t.workspaceId, t.projectId, t.documentId, t.version),
  unique("uq_context_revision_request").on(t.workspaceId, t.projectId, t.requestId),
  check("context_revision_values", sql`${t.version} BETWEEN 1 AND 500 AND length(${t.title}) BETWEEN 1 AND 200 AND length(${t.body}) BETWEEN 1 AND 6000 AND length(${t.changeNote}) BETWEEN 1 AND 500 AND ${t.state} IN ('active','retired') AND length(${t.inputHash})=64`),
]);
export const contextEvents = pgTable("context_events", {
  workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(), sequence: integer("sequence").notNull(),
  documentId: text("document_id").notNull(), documentVersion: integer("document_version").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id), createdAt: text("created_at").notNull(),
}, t => [
  primaryKey({ columns: [t.workspaceId, t.projectId, t.sequence] }),
  foreignKey({ columns: [t.workspaceId, t.projectId, t.documentId, t.documentVersion], foreignColumns: [contextRevisions.workspaceId, contextRevisions.projectId, contextRevisions.documentId, contextRevisions.version] }),
  check("context_event_sequence", sql`${t.sequence}>0`),
]);
export const taskContextBriefs = pgTable("task_context_briefs", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(), taskId: text("task_id").notNull(),
  contextSequence: integer("context_sequence").notNull(), taskVersion: integer("task_version").notNull(), fingerprint: text("fingerprint").notNull(),
  payload: text("payload").notNull(), taskHash: text("task_hash").notNull(), createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull(), requestId: text("request_id").notNull(), inputHash: text("input_hash").notNull(),
}, t => [
  foreignKey({ columns: [t.workspaceId, t.projectId, t.taskId], foreignColumns: [tasks.workspaceId, tasks.projectId, tasks.id] }),
  unique("uq_task_context_brief_scope").on(t.workspaceId, t.projectId, t.taskId, t.id),
  unique("uq_task_context_brief_request").on(t.workspaceId, t.taskId, t.requestId),
  index("idx_task_context_brief_history").on(t.workspaceId, t.taskId, t.createdAt, t.id),
  check("task_context_brief_values", sql`${t.contextSequence}>=0 AND ${t.taskVersion}>0 AND length(${t.fingerprint})=64 AND length(${t.taskHash})=64 AND length(${t.inputHash})=64 AND octet_length(${t.payload}) BETWEEN 1 AND 131072`),
]);
export const taskContextBindings = pgTable("task_context_bindings", {
  taskId: text("task_id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(), briefId: text("brief_id").notNull(),
}, t => [
  foreignKey({ columns: [t.workspaceId, t.projectId, t.taskId, t.briefId], foreignColumns: [taskContextBriefs.workspaceId, taskContextBriefs.projectId, taskContextBriefs.taskId, taskContextBriefs.id] }),
]);

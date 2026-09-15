import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, primaryKey, text, unique } from "drizzle-orm/pg-core";
import { projects, users } from "./postgres-schema";

export const repositorySources = pgTable("repository_sources", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(),
  bindingKey: text("binding_key").notNull(), policyHash: text("policy_hash").notNull(), repository: text("repository").notNull(), branch: text("branch").notNull(),
  state: text("state").notNull(), reason: text("reason"), version: integer("version").notNull().default(1), generation: integer("generation").notNull().default(0),
  lastVerifiedAt: text("last_verified_at"), nextRefreshAt: text("next_refresh_at").notNull(), lastStartedAt: text("last_started_at"),
  leaseId: text("lease_id"), leaseUntil: text("lease_until"), connectedBy: text("connected_by").notNull().references(() => users.id), createdAt: text("created_at").notNull(),
}, t => [
  foreignKey({ name: "fk_repository_source_project", columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  unique("uq_repository_source_project").on(t.workspaceId, t.projectId),
  unique("uq_repository_source_scope").on(t.workspaceId, t.projectId, t.id),
  index("idx_repository_source_refresh").on(t.state, t.nextRefreshAt, t.leaseUntil),
  check("repository_source_values", sql`${t.state} IN ('pending','syncing','current','unavailable','disconnected') AND ${t.version}>0 AND ${t.generation}>=0 AND length(${t.policyHash})=64 AND ((${t.leaseId} IS NULL AND ${t.leaseUntil} IS NULL) OR (${t.leaseId} IS NOT NULL AND ${t.leaseUntil} IS NOT NULL))`),
]);
export const repositoryObservations = pgTable("repository_observations", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(), sourceId: text("source_id").notNull(),
  generation: integer("generation").notNull(), policyHash: text("policy_hash").notNull(), manifestHash: text("manifest_hash").notNull(),
  payload: text("payload").notNull(), observedAt: text("observed_at").notNull(),
}, t => [
  foreignKey({ name: "fk_repository_observation_source", columns: [t.workspaceId, t.projectId, t.sourceId], foreignColumns: [repositorySources.workspaceId, repositorySources.projectId, repositorySources.id] }),
  unique("uq_repository_observation_scope").on(t.workspaceId, t.projectId, t.sourceId, t.id),
  unique("uq_repository_observation_manifest").on(t.sourceId, t.policyHash, t.manifestHash),
  check("repository_observation_values", sql`${t.generation}>0 AND length(${t.policyHash})=64 AND length(${t.manifestHash})=64 AND octet_length(${t.payload}) BETWEEN 1 AND 524288`),
]);
export const repositorySourceHeads = pgTable("repository_source_heads", {
  sourceId: text("source_id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(), observationId: text("observation_id").notNull(),
}, t => [foreignKey({ name: "fk_repository_head_observation", columns: [t.workspaceId, t.projectId, t.sourceId, t.observationId], foreignColumns: [repositoryObservations.workspaceId, repositoryObservations.projectId, repositoryObservations.sourceId, repositoryObservations.id] })]);
export const repositorySourceEvents = pgTable("repository_source_events", {
  workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(), sequence: integer("sequence").notNull(), sourceId: text("source_id").notNull(),
  kind: text("kind").notNull(), createdBy: text("created_by").references(() => users.id), createdAt: text("created_at").notNull(),
}, t => [
  primaryKey({ columns: [t.workspaceId, t.projectId, t.sequence] }),
  foreignKey({ name: "fk_repository_event_source", columns: [t.workspaceId, t.projectId, t.sourceId], foreignColumns: [repositorySources.workspaceId, repositorySources.projectId, repositorySources.id] }),
  check("repository_event_values", sql`${t.sequence}>0 AND ${t.kind} IN ('connected','observed','unavailable','disconnected')`),
]);

export const repositorySourceReceipts = pgTable("repository_source_receipts", {
  workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(), requestId: text("request_id").notNull(),
  sourceId: text("source_id").notNull(), operation: text("operation").notNull(), inputHash: text("input_hash").notNull(),
  sourceVersion: integer("source_version").notNull(), createdBy: text("created_by").notNull().references(() => users.id), createdAt: text("created_at").notNull(),
}, t => [
  primaryKey({ columns: [t.workspaceId, t.projectId, t.requestId] }),
  foreignKey({ name: "fk_repository_receipt_source", columns: [t.workspaceId, t.projectId, t.sourceId], foreignColumns: [repositorySources.workspaceId, repositorySources.projectId, repositorySources.id] }),
  check("repository_receipt_values", sql`${t.operation} IN ('connect','refresh','disconnect') AND length(${t.inputHash})=64 AND ${t.sourceVersion}>0`),
]);

import { sql } from "drizzle-orm";
import { pgTable, text, integer, foreignKey, unique, index, check } from "drizzle-orm/pg-core";
import { users, workspaces, projects } from "./postgres-schema";

export const agentProfiles = pgTable("agent_profiles", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  alias: text("alias").notNull(), aliasKey: text("alias_key").notNull(), operatorId: text("operator_id").notNull().references(() => users.id),
  toolLabel: text("tool_label").notNull(), createdBy: text("created_by").notNull().references(() => users.id), createdAt: text("created_at").notNull(),
}, t => [
  unique("uq_agent_profile_workspace").on(t.workspaceId, t.id), unique("uq_agent_alias_workspace").on(t.workspaceId, t.aliasKey),
  index("idx_agent_operator").on(t.workspaceId, t.operatorId),
  check("agent_profile_values", sql`length(${t.alias}) BETWEEN 1 AND 60 AND length(${t.aliasKey}) BETWEEN 1 AND 60 AND length(${t.toolLabel})<=80`),
]);
export const agentRoleBindings = pgTable("agent_role_bindings", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(), profileId: text("profile_id").notNull(),
  roleId: text("role_id").notNull(), version: integer("version").notNull(), state: text("state").notNull(),
  readPaths: text("read_paths").notNull(), writePaths: text("write_paths").notNull(), templateHash: text("template_hash").notNull(), templateBody: text("template_body").notNull(),
  approvedBy: text("approved_by").references(() => users.id), approvedAt: text("approved_at"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, t => [
  foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  foreignKey({ columns: [t.workspaceId, t.profileId], foreignColumns: [agentProfiles.workspaceId, agentProfiles.id] }),
  unique("uq_agent_role_scope").on(t.workspaceId, t.projectId, t.id), unique("uq_agent_project_role").on(t.workspaceId, t.projectId, t.profileId, t.roleId),
  index("idx_agent_project_page").on(t.workspaceId, t.projectId, t.createdAt, t.id),
  check("agent_role_values", sql`${t.version} BETWEEN 1 AND 1001 AND ${t.state} IN ('pending','initialized','revoked') AND ${t.roleId} IN ('business_analysis','solution_architecture','development','peer_review','quality_assurance','user_acceptance_testing','release_operations','security_review','ux_accessibility','performance_data','documentation') AND length(${t.templateHash})=64 AND octet_length(${t.templateBody}) BETWEEN 1 AND 24576 AND octet_length(${t.readPaths})<=16384 AND octet_length(${t.writePaths})<=16384`),
  check("agent_role_approval", sql`(${t.state}='initialized' AND ${t.approvedBy} IS NOT NULL AND ${t.approvedAt} IS NOT NULL) OR (${t.state}<>'initialized' AND ${t.approvedBy} IS NULL AND ${t.approvedAt} IS NULL)`),
]);
export const agentRoleEvents = pgTable("agent_role_events", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(), bindingId: text("binding_id").notNull(),
  version: integer("version").notNull(), action: text("action").notNull(), actorKind: text("actor_kind").notNull(),
  actorId: text("actor_id").notNull().references(() => users.id), createdAt: text("created_at").notNull(), reason: text("reason").notNull(),
  requestId: text("request_id").notNull(), inputHash: text("input_hash").notNull(), snapshot: text("snapshot").notNull(),
}, t => [
  foreignKey({ columns: [t.workspaceId, t.projectId, t.bindingId], foreignColumns: [agentRoleBindings.workspaceId, agentRoleBindings.projectId, agentRoleBindings.id] }),
  unique("uq_agent_role_event_version").on(t.bindingId, t.version), unique("uq_agent_role_request").on(t.workspaceId, t.projectId, t.requestId),
  check("agent_event_values", sql`${t.version} BETWEEN 1 AND 1001 AND ${t.action} IN ('registered','configured','initialized','revoked') AND ${t.actorKind}='human' AND length(${t.inputHash})=64 AND length(${t.reason}) BETWEEN 1 AND 500 AND octet_length(${t.snapshot}) BETWEEN 1 AND 65536`),
]);

import { sql } from "drizzle-orm";
import { pgTable, text, integer, foreignKey, unique, index, check } from "drizzle-orm/pg-core";
import { users, projects, tasks } from "./postgres-schema";
import { agentProfiles, agentRoleBindings } from "./agent-schema";

export const deliveryProjects = pgTable("delivery_projects", {
  projectId: text("project_id").primaryKey(), workspaceId: text("workspace_id").notNull(), version: integer("version").notNull(),
  reviewers: text("reviewers").notNull(), baseline: text("baseline"), planRevision: integer("plan_revision").notNull().default(0), updatedAt: text("updated_at").notNull(),
}, t => [foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id] }), unique("uq_delivery_project_scope").on(t.workspaceId, t.projectId), check("delivery_project_values", sql`${t.version}>0 AND ${t.planRevision}>=0 AND octet_length(${t.reviewers})<=4096 AND octet_length(${t.baseline})<=16384`)]);

export const deliveryTickets = pgTable("delivery_tickets", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(), taskId: text("task_id").notNull(),
  kind: text("kind").notNull(), title: text("title").notNull(), version: integer("version").notNull(), phase: text("phase").notNull(), roleId: text("role_id").notNull(),
  bindingId: text("binding_id"), packetId: text("packet_id"), attemptId: text("attempt_id"), planRevision: integer("plan_revision").notNull().default(0),
  payload: text("payload").notNull(), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, t => [
  foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [deliveryProjects.workspaceId, deliveryProjects.projectId] }),
  foreignKey({ columns: [t.workspaceId, t.taskId], foreignColumns: [tasks.workspaceId, tasks.id] }),
  foreignKey({ columns: [t.workspaceId, t.projectId, t.bindingId], foreignColumns: [agentRoleBindings.workspaceId, agentRoleBindings.projectId, agentRoleBindings.id] }),
  unique("uq_delivery_ticket_scope").on(t.workspaceId, t.projectId, t.id), unique("uq_delivery_task").on(t.workspaceId, t.taskId),
  index("idx_delivery_tickets_page").on(t.workspaceId, t.projectId, t.createdAt, t.id), index("idx_delivery_binding").on(t.workspaceId, t.bindingId, t.phase),
  check("delivery_ticket_values", sql`${t.version} BETWEEN 1 AND 10000 AND ${t.kind} IN ('requirements','architecture','delivery') AND ${t.phase} IN ('created','assigned','start_approved','in_progress','in_review','uat_authorization','release_authorization','accepted','cancelled','replan_required') AND length(${t.title}) BETWEEN 1 AND 200 AND octet_length(${t.payload})<=131072`),
]);

export const agentConnections = pgTable("agent_connections", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(), profileId: text("profile_id").notNull(), bindingId: text("binding_id").notNull(), bindingVersion: integer("binding_version").notNull(),
  operatorId: text("operator_id").notNull().references(() => users.id), membershipEpoch: text("membership_epoch").notNull(), name: text("name").notNull(),
  clientId: text("client_id").unique(), companionClientId: text("companion_client_id").unique(), state: text("state").notNull(), initializedAt: text("initialized_at"), leaseUntil: text("lease_until"), prepared: text("prepared"),
  version: integer("version").notNull(), createdAt: text("created_at").notNull(), revokedAt: text("revoked_at"),
}, t => [
  foreignKey({ columns: [t.workspaceId, t.profileId], foreignColumns: [agentProfiles.workspaceId, agentProfiles.id] }),
  foreignKey({ columns: [t.workspaceId, t.projectId, t.bindingId], foreignColumns: [agentRoleBindings.workspaceId, agentRoleBindings.projectId, agentRoleBindings.id] }),
  unique("uq_agent_connection_scope").on(t.workspaceId, t.projectId, t.id), index("idx_agent_connection_profile").on(t.workspaceId, t.profileId, t.state),
  check("agent_connection_values", sql`${t.version}>0 AND ${t.bindingVersion}>0 AND ${t.state} IN ('pending','active','revoked') AND length(${t.name}) BETWEEN 1 AND 80 AND octet_length(${t.prepared})<=4096`),
]);

export const deliveryPackets = pgTable("delivery_packets", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(), ticketId: text("ticket_id").notNull(), bindingId: text("binding_id").notNull(), hash: text("hash").notNull(), payload: text("payload").notNull(), createdBy: text("created_by").notNull().references(() => users.id), createdAt: text("created_at").notNull(),
}, t => [foreignKey({ columns: [t.workspaceId, t.projectId, t.ticketId], foreignColumns: [deliveryTickets.workspaceId, deliveryTickets.projectId, deliveryTickets.id] }), foreignKey({ columns: [t.workspaceId, t.projectId, t.bindingId], foreignColumns: [agentRoleBindings.workspaceId, agentRoleBindings.projectId, agentRoleBindings.id] }), unique("uq_delivery_packet_scope").on(t.workspaceId, t.projectId, t.id), index("idx_delivery_packet_ticket").on(t.workspaceId, t.ticketId), check("delivery_packet_values", sql`length(${t.hash})=64 AND octet_length(${t.payload})<=131072`)]);

export const deliveryAttempts = pgTable("delivery_attempts", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(), ticketId: text("ticket_id").notNull(), packetId: text("packet_id").notNull(), connectionId: text("connection_id").notNull(), profileId: text("profile_id").notNull(),
  state: text("state").notNull(), version: integer("version").notNull(), grantExpires: text("grant_expires").notNull(), leaseUntil: text("lease_until"), authorizedBy: text("authorized_by").notNull().references(() => users.id), authorizedAt: text("authorized_at").notNull(), startedAt: text("started_at"), endedAt: text("ended_at"), checkpoint: text("checkpoint"),
}, t => [
  foreignKey({ columns: [t.workspaceId, t.projectId, t.ticketId], foreignColumns: [deliveryTickets.workspaceId, deliveryTickets.projectId, deliveryTickets.id] }),
  foreignKey({ columns: [t.workspaceId, t.projectId, t.packetId], foreignColumns: [deliveryPackets.workspaceId, deliveryPackets.projectId, deliveryPackets.id] }),
  foreignKey({ columns: [t.workspaceId, t.projectId, t.connectionId], foreignColumns: [agentConnections.workspaceId, agentConnections.projectId, agentConnections.id] }),
  foreignKey({ columns: [t.workspaceId, t.profileId], foreignColumns: [agentProfiles.workspaceId, agentProfiles.id] }),
  unique("uq_delivery_attempt_scope").on(t.workspaceId, t.projectId, t.id), index("idx_delivery_active_attempts").on(t.workspaceId, t.profileId, t.state, t.leaseUntil),
  check("delivery_attempt_values", sql`${t.version}>0 AND ${t.state} IN ('authorized','running','submitted','cancelled','lease_lost','expired') AND octet_length(${t.checkpoint})<=16384`),
]);

export const deliveryEvents = pgTable("delivery_events", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(), sequence: integer("sequence").notNull(), ticketId: text("ticket_id"), actorKind: text("actor_kind").notNull(), actorId: text("actor_id").notNull(), operatorId: text("operator_id"), action: text("action").notNull(), reason: text("reason").notNull(), payload: text("payload").notNull(), requestId: text("request_id").notNull(), inputHash: text("input_hash").notNull(), createdAt: text("created_at").notNull(),
}, t => [foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [deliveryProjects.workspaceId, deliveryProjects.projectId] }), unique("uq_delivery_event_sequence").on(t.workspaceId, t.projectId, t.sequence), unique("uq_delivery_request").on(t.workspaceId, t.projectId, t.requestId), index("idx_delivery_ticket_events").on(t.workspaceId, t.ticketId, t.sequence), check("delivery_event_values", sql`${t.sequence}>0 AND ${t.actorKind} IN ('human','agent','system') AND length(${t.inputHash})=64 AND octet_length(${t.payload})<=131072 AND length(${t.reason})<=3000`)]);
export const deliveryNotices = pgTable("delivery_notices", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(), eventId: text("event_id").notNull().references(() => deliveryEvents.id), recipientId: text("recipient_id").notNull().references(() => users.id), ticketId: text("ticket_id"), sequence: integer("sequence").notNull(), title: text("title").notNull(), createdAt: text("created_at").notNull(), readAt: text("read_at"),
}, t => [foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [deliveryProjects.workspaceId, deliveryProjects.projectId] }), unique("uq_delivery_notice_recipient").on(t.eventId, t.recipientId), index("idx_delivery_notice_cursor").on(t.workspaceId, t.projectId, t.recipientId, t.sequence)]);

import { sql } from "drizzle-orm";
import { pgTable, text, integer, foreignKey, index, check } from "drizzle-orm/pg-core";
import { deliveryProjects } from "./delivery-schema";
export const deliveryEvidence = pgTable("delivery_evidence", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), projectId: text("project_id").notNull(), policyHash: text("policy_hash").notNull(), input: text("input").notNull(),
  state: text("state").notNull(), generation: integer("generation").notNull().default(1), leaseId: text("lease_id"), leaseUntil: text("lease_until"), requestedAt: text("requested_at").notNull(), nextRefresh: text("next_refresh").notNull(), observedAt: text("observed_at"), payload: text("payload"), reason: text("reason"),
}, t => [foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [deliveryProjects.workspaceId, deliveryProjects.projectId] }), index("idx_delivery_evidence_due").on(t.state, t.nextRefresh, t.leaseUntil), check("delivery_evidence_values", sql`${t.state} IN ('pending','syncing','current','unavailable') AND ${t.generation}>0 AND length(${t.policyHash})=64 AND octet_length(${t.input})<=4096 AND octet_length(${t.payload})<=65536`)]);

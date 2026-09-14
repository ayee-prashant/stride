import { createHash, randomUUID } from "node:crypto";
import { AppError, identifier } from "../domain.ts";
import type { AgentActor, AgentConnection, DeliveryActor, DeliveryProject, DeliveryTicket, WorkPacket, Candidate, VerifiedEvidence } from "../delivery.ts";
import type { GitHubBinding } from "../github-context.ts";
import { Repository } from "./repository.ts";
import { AGENT_TEMPLATES } from "./agent-templates.generated.ts";

export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const unavailable = () => new AppError(404, "DELIVERY_UNAVAILABLE", "This delivery item is unavailable.");
export const changed = (message = "This work changed. Refresh and review the current version.") => new AppError(409, "DELIVERY_CONFLICT", message);
export const forbidden = (message = "This action requires the assigned human reviewer.") => new AppError(403, "HUMAN_REVIEW_REQUIRED", message);
export const expires = (now: Date, seconds: number) => new Date(now.getTime() + seconds * 1000).toISOString();
export function encoded(value: unknown, max = 131072) { const result = JSON.stringify(value); if (Buffer.byteLength(result) > max) throw changed("This record is too large. Split the work into smaller tickets."); return result; }
export type EvidenceVerifier = (input: { workspace_id: string; project_id: string; candidate: Candidate; environment?: string; artifact?: string }) => Promise<VerifiedEvidence>;
export type DeliveryOptions = { bindings?: GitHubBinding[]; verifyEvidence?: EvidenceVerifier };
type StoredTicket = Omit<DeliveryTicket, "payload"> & { payload: string };
type StoredProject = Omit<DeliveryProject, "reviewers" | "baseline"> & { reviewers: string; baseline: string | null };
type StoredConnection = Omit<AgentConnection, "prepared"> & { prepared: string | null };
export type Attempt = { id: string; workspace_id: string; project_id: string; ticket_id: string; packet_id: string; connection_id: string; profile_id: string; state: "authorized" | "running" | "submitted" | "cancelled" | "lease_lost" | "expired"; version: number; grant_expires: string; lease_until: string | null; authorized_by: string; authorized_at: string; started_at: string | null; ended_at: string | null; checkpoint: string | null };

/** Shared transaction boundary. Actor identity is never inferred from a report. */
export class DeliveryStore {
  repo: Repository; options: DeliveryOptions;
  constructor(repo: Repository, options: DeliveryOptions = {}) { this.repo = repo; this.options = options; }
  async project(userId: string, workspaceId: string, projectId: string, admin = false) {
    await this.repo.membership(userId, workspaceId, admin);
    const row = await this.repo.statement("SELECT archived_at FROM projects WHERE workspace_id=? AND id=?", workspaceId, identifier(projectId)).first<{ archived_at: string | null }>();
    if (!row) throw unavailable(); return row;
  }
  async lock(userId: string, workspaceId: string, projectId: string, others: string[] = [], archived = false) {
    for (const id of [...new Set([userId, ...others])].sort()) {
      const m = await this.repo.statement("UPDATE memberships SET role=role WHERE workspace_id=? AND user_id=? RETURNING epoch", workspaceId, id).first();
      if (!m) throw changed("A human's membership changed. Review the assignment again.");
    }
    await this.repo.statement("UPDATE workspaces SET name=name WHERE id=?", workspaceId).run();
    const p = await this.repo.statement(`UPDATE projects SET version=version WHERE workspace_id=? AND id=? ${archived ? "" : "AND archived_at IS NULL"} RETURNING id`, workspaceId, projectId).first();
    if (!p) throw changed("The project is archived or unavailable.");
  }
  async configuration(workspaceId: string, projectId: string): Promise<DeliveryProject> {
    const row = await this.repo.statement("SELECT * FROM delivery_projects WHERE workspace_id=? AND project_id=?", workspaceId, projectId).first<StoredProject>();
    if (!row) throw changed("Initialize human delivery responsibilities first.");
    return { ...row, reviewers: JSON.parse(row.reviewers), baseline: row.baseline ? JSON.parse(row.baseline) : null };
  }
  async ticket(workspaceId: string, projectId: string, id: string): Promise<DeliveryTicket> {
    const row = await this.repo.statement("SELECT * FROM delivery_tickets WHERE workspace_id=? AND project_id=? AND id=?", workspaceId, projectId, identifier(id)).first<StoredTicket>();
    if (!row) throw unavailable(); return { ...row, payload: JSON.parse(row.payload) };
  }
  async connection(workspaceId: string, projectId: string, id: string): Promise<AgentConnection> {
    const row = await this.repo.statement("SELECT * FROM agent_connections WHERE workspace_id=? AND project_id=? AND id=?", workspaceId, projectId, identifier(id)).first<StoredConnection>();
    if (!row) throw unavailable(); return { ...row, prepared: row.prepared ? JSON.parse(row.prepared) : null };
  }
  async validateConnection(actor: AgentActor, active = true) {
    const c = await this.connection(actor.workspace_id, actor.project_id, actor.connection_id);
    if (c.operator_id !== actor.operator_id || c.profile_id !== actor.profile_id || c.state === "revoked" || active && c.state !== "active") throw forbidden("This agent connection is inactive or revoked.");
    const m = await this.repo.statement("SELECT epoch FROM memberships WHERE workspace_id=? AND user_id=?", c.workspace_id, c.operator_id).first<{ epoch: string }>();
    const b = await this.repo.statement("SELECT b.version,b.state,b.template_hash,p.operator_id,p.id AS profile_id FROM agent_role_bindings b JOIN agent_profiles p ON p.workspace_id=b.workspace_id AND p.id=b.profile_id JOIN projects j ON j.workspace_id=b.workspace_id AND j.id=b.project_id WHERE b.workspace_id=? AND b.project_id=? AND b.id=? AND j.archived_at IS NULL", c.workspace_id, c.project_id, c.binding_id).first<{ version: number; state: string; template_hash: string; operator_id: string; profile_id: string }>();
    if (!m || m.epoch !== c.membership_epoch || !b || b.state !== "initialized" || b.version !== c.binding_version || b.operator_id !== c.operator_id || b.profile_id !== c.profile_id || !AGENT_TEMPLATES.some(t => t.hash === b.template_hash)) throw forbidden("Membership, role or prompt changed. Re-enroll with a fresh human approval.");
    return c;
  }
  async packet(workspaceId: string, projectId: string, id: string) {
    const row = await this.repo.statement("SELECT id,hash,payload,created_at FROM delivery_packets WHERE workspace_id=? AND project_id=? AND id=?", workspaceId, projectId, identifier(id)).first<{ id: string; hash: string; payload: string; created_at: string }>();
    if (!row) throw unavailable(); return { ...row, payload: JSON.parse(row.payload) as WorkPacket };
  }
  async attempt(workspaceId: string, projectId: string, id: string) {
    const row = await this.repo.statement("SELECT * FROM delivery_attempts WHERE workspace_id=? AND project_id=? AND id=?", workspaceId, projectId, identifier(id)).first<Attempt>();
    if (!row) throw unavailable(); return row;
  }
  async saveTicket(t: DeliveryTicket) {
    const row = await this.repo.statement("UPDATE delivery_tickets SET version=version+1,phase=?,role_id=?,binding_id=?,packet_id=?,attempt_id=?,payload=?,updated_at=? WHERE workspace_id=? AND project_id=? AND id=? AND version=? RETURNING version", t.phase, t.role_id, t.binding_id, t.packet_id, t.attempt_id, encoded(t.payload), this.repo.now().toISOString(), t.workspace_id, t.project_id, t.id, t.version).first<{ version: number }>();
    if (!row) throw changed(); t.version = row.version; return t;
  }
  async replay(actor: DeliveryActor, workspaceId: string, projectId: string, requestId: string, inputHash: string) {
    const e = await this.repo.statement("SELECT * FROM delivery_events WHERE workspace_id=? AND project_id=? AND request_id=?", workspaceId, projectId, requestId).first<{ id: string; actor_kind: string; actor_id: string; input_hash: string; ticket_id: string | null; payload: string }>();
    if (!e) return null;
    if (e.actor_kind !== actor.kind || e.actor_id !== (actor.kind === "human" ? actor.id : actor.profile_id) || e.input_hash !== inputHash || actor.kind === "agent" && JSON.parse(e.payload).connection_id !== actor.connection_id) throw changed("This request identifier was already used for a different action.");
    return { event_id: e.id, ticket: e.ticket_id ? await this.ticket(workspaceId, projectId, e.ticket_id) : null, replayed: true };
  }
  async event(actor: DeliveryActor | { kind: "system"; id: string }, workspaceId: string, projectId: string, ticketId: string | null, action: string, reason: string, requestId: string, inputHash: string, payload: unknown, recipients: string[] = []) {
    // All writers hold the workspace/project locks, so sequence allocation follows commit order.
    const last = await this.repo.statement("SELECT COALESCE(MAX(sequence),0) AS n FROM delivery_events WHERE workspace_id=? AND project_id=?", workspaceId, projectId).first<{ n: number }>();
    const sequence = Number(last?.n ?? 0) + 1; const id = randomUUID(); const now = this.repo.now().toISOString();
    await this.repo.statement("INSERT INTO delivery_events(id,workspace_id,project_id,sequence,ticket_id,actor_kind,actor_id,operator_id,action,reason,payload,request_id,input_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", id, workspaceId, projectId, sequence, ticketId, actor.kind, actor.kind === "agent" ? actor.profile_id : actor.id, actor.kind === "agent" ? actor.operator_id : null, action, reason, encoded({ detail: payload, ...(actor.kind === "agent" ? { connection_id: actor.connection_id } : {}) }), requestId, inputHash, now).run();
    for (const recipient of [...new Set(recipients)]) await this.repo.statement("INSERT INTO delivery_notices(id,workspace_id,project_id,event_id,recipient_id,ticket_id,sequence,title,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?) ON CONFLICT DO NOTHING", randomUUID(), workspaceId, projectId, id, recipient, ticketId, sequence, action.replaceAll("_", " "), now, workspaceId, recipient).run();
    return { event_id: id, replayed: false };
  }
  async fence(t: DeliveryTicket, state: "cancelled" | "lease_lost" = "cancelled") {
    if (t.attempt_id) await this.repo.statement("UPDATE delivery_attempts SET state=?,version=version+1,ended_at=?,lease_until=NULL WHERE workspace_id=? AND project_id=? AND id=? AND state IN ('authorized','running')", state, this.repo.now().toISOString(), t.workspace_id, t.project_id, t.attempt_id).run();
    t.attempt_id = null;
  }
}

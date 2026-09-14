import { randomUUID } from "node:crypto";
import { AppError, object } from "../domain.ts";
import { parseContextCursor } from "../context.ts";
import type { AgentActor } from "../delivery.ts";
import type { Database } from "./repository.ts";
import { Repository } from "./repository.ts";
import { DeliveryReview } from "./delivery-review.ts";
import { digest } from "./delivery-store.ts";

export class DeliveryService extends DeliveryReview {
  override scoped(db: Database) { return new DeliveryService(new Repository(db, this.repo.now), this.options); }
  async overview(userId: string, workspaceId: string, projectId: string, offset = 0) {
    await this.project(userId, workspaceId, projectId);
    const configured = await this.repo.statement("SELECT project_id FROM delivery_projects WHERE workspace_id=? AND project_id=?", workspaceId, projectId).first();
    if (!configured) return { configuration: null, tickets: [], connections: [], has_more: false, next_offset: 0 };
    const rows = await this.repo.statement("SELECT id,task_id,title,kind,phase,role_id,version,updated_at FROM delivery_tickets WHERE workspace_id=? AND project_id=? ORDER BY created_at DESC,id LIMIT 51 OFFSET ?", workspaceId, projectId, offset).all<{ id: string }>();
    const connections = await this.repo.statement("SELECT id FROM agent_connections WHERE workspace_id=? AND project_id=? AND operator_id=? ORDER BY created_at DESC LIMIT 100", workspaceId, projectId, userId).all<{ id: string }>();
    return { configuration: await this.configuration(workspaceId, projectId), tickets: rows.results.slice(0, 50), connections: await Promise.all(connections.results.map(c => this.connection(workspaceId, projectId, c.id))), has_more: rows.results.length > 50, next_offset: offset + 50 };
  }
  async detail(userId: string, workspaceId: string, projectId: string, ticketId: string) {
    await this.project(userId, workspaceId, projectId); const t = await this.ticket(workspaceId, projectId, ticketId);
    let packet = null; let packetError: string | null = null;
    if (t.packet_id) { try { packet = await this.currentPacket(userId, t); } catch (e) { if (!(e instanceof AppError)) throw e; packetError = e.message; } }
    const attempt = t.attempt_id ? await this.attempt(workspaceId, projectId, t.attempt_id) : null;
    return { ticket: t, packet, packet_error: packetError, report_hash: t.payload.report ? digest(t.payload.report) : null, attempt: attempt ? { id: attempt.id, state: attempt.state, version: attempt.version, grant_expires: attempt.grant_expires, lease_until: attempt.lease_until, started_at: attempt.started_at, ended_at: attempt.ended_at } : null, configuration: await this.configuration(workspaceId, projectId) };
  }
  async history(userId: string, workspaceId: string, projectId: string, ticketId: string | null, after = 0) {
    await this.project(userId, workspaceId, projectId); if (ticketId) await this.ticket(workspaceId, projectId, ticketId);
    const rows = await this.repo.statement(`SELECT id,sequence,ticket_id,actor_kind,actor_id,operator_id,action,reason,payload,created_at FROM delivery_events WHERE workspace_id=? AND project_id=? AND sequence>? ${ticketId ? "AND ticket_id=?" : ""} ORDER BY sequence LIMIT 51`, workspaceId, projectId, after, ...(ticketId ? [ticketId] : [])).all<{ id: string; sequence: number; payload: string }>();
    const events = rows.results.slice(0, 50).map(e => ({ ...e, payload: JSON.parse(e.payload) }));
    return { events, next_cursor: events.at(-1)?.sequence ?? after, has_more: rows.results.length > 50 };
  }
  async notices(userId: string, workspaceId: string, projectId: string, after = 0, latest = false) {
    await this.project(userId, workspaceId, projectId);
    const rows = await this.repo.statement(`SELECT id,sequence,ticket_id,title,created_at,read_at FROM delivery_notices WHERE workspace_id=? AND project_id=? AND recipient_id=? ${latest && !after ? "" : `AND sequence${latest ? "<" : ">"}?`} ORDER BY sequence ${latest ? "DESC" : "ASC"} LIMIT 51`, workspaceId, projectId, userId, ...(latest && !after ? [] : [after])).all<{ sequence: number }>();
    const notices = rows.results.slice(0, 50); return { notices, next_cursor: notices.at(-1)?.sequence ?? after, has_more: rows.results.length > 50 };
  }
  async readNotices(userId: string, workspaceId: string, projectId: string, input: unknown) {
    const v = object(input, ["through"]); const cursor = parseContextCursor(String(v.through)); await this.project(userId, workspaceId, projectId);
    await this.repo.statement("UPDATE delivery_notices SET read_at=? WHERE workspace_id=? AND project_id=? AND recipient_id=? AND sequence<=? AND read_at IS NULL", this.repo.now().toISOString(), workspaceId, projectId, userId, cursor).run();
    return { read_through: cursor };
  }
  async companionNotices(actor: AgentActor, after: number) { await this.validateConnection(actor); return this.notices(actor.operator_id, actor.workspace_id, actor.project_id, after); }
  /** Durable reconciliation. Heartbeats themselves do not create productivity events. */
  async reconcile(limit = 50) {
    await this.refreshClock();
    const now = this.repo.now().toISOString();
    const candidates = await this.repo.statement("SELECT a.id,a.workspace_id,a.project_id,a.ticket_id FROM delivery_attempts a JOIN agent_connections c ON c.id=a.connection_id AND c.workspace_id=a.workspace_id LEFT JOIN memberships m ON m.workspace_id=c.workspace_id AND m.user_id=c.operator_id JOIN agent_role_bindings b ON b.id=c.binding_id AND b.workspace_id=c.workspace_id WHERE a.state IN ('authorized','running') AND ((a.state='authorized' AND a.grant_expires<=?) OR (a.state='running' AND a.lease_until<=?) OR c.state<>'active' OR m.epoch IS NULL OR m.epoch<>c.membership_epoch OR b.version<>c.binding_version OR b.state<>'initialized') ORDER BY a.authorized_at LIMIT ?", now, now, Math.min(limit, 50)).all<{ id: string; workspace_id: string; project_id: string; ticket_id: string }>();
    for (const item of candidates.results) await this.repo.db.transaction(async db => {
      const s = this.scoped(db);
      await s.repo.statement("UPDATE workspaces SET name=name WHERE id=?", item.workspace_id).run();
      await s.repo.statement("UPDATE projects SET version=version WHERE workspace_id=? AND id=?", item.workspace_id, item.project_id).run();
      await s.refreshClock();
      const a = await s.attempt(item.workspace_id, item.project_id, item.id); if (!["authorized", "running"].includes(a.state)) return;
      const c = await s.connection(item.workspace_id, item.project_id, a.connection_id); let invalid = false;
      try { await s.validateConnection({ kind: "agent", connection_id: c.id, profile_id: c.profile_id, operator_id: c.operator_id, workspace_id: c.workspace_id, project_id: c.project_id, session_id: "reconciliation" }); } catch (e) { if (!(e instanceof AppError)) throw e; invalid = true; }
      const ended = a.state === "authorized" ? a.grant_expires <= s.repo.now().toISOString() : !a.lease_until || a.lease_until <= s.repo.now().toISOString();
      if (!ended && !invalid) return;
      const t = await s.ticket(item.workspace_id, item.project_id, item.ticket_id); const state = a.state === "authorized" ? "expired" : "lease_lost";
      await s.repo.statement("UPDATE delivery_attempts SET state=?,version=version+1,ended_at=?,lease_until=NULL WHERE workspace_id=? AND project_id=? AND id=?", state, s.repo.now().toISOString(), item.workspace_id, item.project_id, a.id).run();
      if (t.attempt_id === a.id) { t.attempt_id = null; t.phase = "assigned"; await s.saveTicket(t); }
      await s.event({ kind: "system", id: "delivery-coordinator" }, item.workspace_id, item.project_id, t.id, state === "expired" ? "start_expired" : "attempt_lease_lost", "Execution authority ended. A fresh human start is required; physical process termination is unconfirmed.", randomUUID(), digest({ attempt_id: a.id, state }), { attempt_id: a.id, physical_stop: "unconfirmed", checkpoint_available: !!t.payload.last_checkpoint }, [c.operator_id]);
    });
    return { examined: candidates.results.length };
  }
}

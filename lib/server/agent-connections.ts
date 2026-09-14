import { randomUUID } from "node:crypto";
import { identifier, object, text } from "../domain.ts";
import { requestId } from "../context.ts";
import { decision, hashValue } from "../delivery.ts";
import type { AgentActor, AgentConnection } from "../delivery.ts";
import { Repository } from "./repository.ts";
import { AgentRegistryRepository } from "./agent-registry.ts";
import { DeliveryRepository } from "./delivery-repository.ts";
import { AppError } from "../domain.ts";
import { DeliveryStore, changed, digest, encoded, expires, forbidden } from "./delivery-store.ts";
import type { Database } from "./repository.ts";

export class AgentConnections extends DeliveryStore {
  scoped(db: Database) { return new AgentConnections(new Repository(db, this.repo.now), this.options); }
  async enroll(userId: string, workspaceId: string, projectId: string, input: unknown) {
    const v = object(input, ["request_id", "binding_id", "binding_version", "template_hash", "name", "accept_responsibility"]);
    const idempotency = requestId(v.request_id); const bindingId = identifier(v.binding_id); const name = text(v.name, "Machine name", 80); const template = hashValue(v.template_hash);
    if (v.accept_responsibility !== true) throw forbidden("The human operator must accept responsibility for this connection.");
    await this.project(userId, workspaceId, projectId);
    return this.repo.db.transaction(async db => {
      const s = this.scoped(db); await s.lock(userId, workspaceId, projectId);
      await s.configuration(workspaceId, projectId);
      const replay = await s.replay({ kind: "human", id: userId }, workspaceId, projectId, idempotency, digest(v));
      if (replay) {
        const row = await s.repo.statement("SELECT payload FROM delivery_events WHERE id=?", replay.event_id).first<{ payload: string }>();
        return s.connection(workspaceId, projectId, JSON.parse(row!.payload).detail.connection_id);
      }
      const b = await new AgentRegistryRepository(s.repo).binding(userId, workspaceId, projectId, bindingId);
      if (b.operator_id !== userId || b.state !== "initialized" || b.version !== v.binding_version || b.template_hash !== template || !b.template_current) throw forbidden("Only this role's human operator can enroll a machine after reviewing its current prompt.");
      const count = await s.repo.statement("SELECT COUNT(*) AS n FROM agent_connections WHERE workspace_id=? AND profile_id=? AND state<>'revoked'", workspaceId, b.profile_id).first<{ n: number | string }>();
      if (Number(count?.n ?? 0) >= 5) throw changed("Revoke an old connection before adding another. A profile supports five enrolled machines.");
      const m = await s.repo.statement("SELECT epoch FROM memberships WHERE workspace_id=? AND user_id=?", workspaceId, userId).first<{ epoch: string }>();
      const id = randomUUID(); const now = s.repo.now().toISOString();
      await s.repo.statement("INSERT INTO agent_connections(id,workspace_id,project_id,profile_id,binding_id,binding_version,operator_id,membership_epoch,name,state,version,created_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',1,?)", id, workspaceId, projectId, b.profile_id, bindingId, b.version, userId, m!.epoch, name, now).run();
      await s.event({ kind: "human", id: userId }, workspaceId, projectId, null, "connection_enrolled", "Human accepted the current role and enrolled an attended connection.", idempotency, digest(v), { connection_id: id, binding_version: b.version, template_hash: template, membership_epoch: m!.epoch });
      return s.connection(workspaceId, projectId, id);
    });
  }
  async attachClients(userId: string, workspaceId: string, projectId: string, connectionId: string, clients: { agent: string; companion: string }) {
    return this.repo.db.transaction(async db => {
      const s = this.scoped(db); await s.lock(userId, workspaceId, projectId); const c = await s.connection(workspaceId, projectId, connectionId);
      await s.validateConnection({ kind: "agent", connection_id: c.id, profile_id: c.profile_id, operator_id: userId, workspace_id: workspaceId, project_id: projectId, session_id: "enrollment" }, false);
      if (c.client_id || c.companion_client_id) return c;
      await s.repo.statement("UPDATE agent_connections SET client_id=?,companion_client_id=?,state='active',version=version+1 WHERE workspace_id=? AND project_id=? AND id=? AND state='pending'", clients.agent, clients.companion, workspaceId, projectId, connectionId).run();
      return s.connection(workspaceId, projectId, connectionId);
    });
  }
  async revoke(userId: string, workspaceId: string, projectId: string, connectionId: string, input: unknown) {
    const v = decision(input); const initial = await this.connection(workspaceId, projectId, connectionId);
    await this.project(userId, workspaceId, projectId, userId !== initial.operator_id);
    return this.repo.db.transaction(async db => {
      const s = this.scoped(db); await s.lock(userId, workspaceId, projectId, [], true);
      await s.project(userId, workspaceId, projectId, userId !== initial.operator_id);
      const replay = await s.replay({ kind: "human", id: userId }, workspaceId, projectId, v.request_id, digest({ connectionId, ...v })); if (replay) return s.connection(workspaceId, projectId, connectionId);
      const c = await s.connection(workspaceId, projectId, connectionId); if (c.version !== v.expected_version) throw changed();
      await s.repo.statement("UPDATE agent_connections SET state='revoked',version=version+1,revoked_at=?,lease_until=NULL,prepared=NULL WHERE workspace_id=? AND project_id=? AND id=?", s.repo.now().toISOString(), workspaceId, projectId, connectionId).run();
      await s.repo.statement("UPDATE delivery_attempts SET state='cancelled',version=version+1,ended_at=?,lease_until=NULL WHERE workspace_id=? AND project_id=? AND connection_id=? AND state IN ('authorized','running')", s.repo.now().toISOString(), workspaceId, projectId, connectionId).run();
      await s.event({ kind: "human", id: userId }, workspaceId, projectId, null, "connection_revoked", v.reason, v.request_id, digest({ connectionId, ...v }), { connection_id: connectionId, physical_stop: "unconfirmed" }, [c.operator_id]);
      return s.connection(workspaceId, projectId, connectionId);
    });
  }
  async initialize(actor: AgentActor, input: unknown) {
    const v = object(input, ["request_id", "template_hash", "accept_role", "accept_exclusions"]); const request = requestId(v.request_id);
    if (v.accept_role !== true || v.accept_exclusions !== true) throw forbidden("Read and acknowledge the role responsibilities and exclusions first.");
    return this.repo.db.transaction(async db => {
      const s = this.scoped(db); await s.lock(actor.operator_id, actor.workspace_id, actor.project_id); const c = await s.validateConnection(actor);
      const b = await new AgentRegistryRepository(s.repo).binding(actor.operator_id, actor.workspace_id, actor.project_id, c.binding_id);
      if (hashValue(v.template_hash) !== b.template_hash) throw changed("Read the current role prompt before initializing.");
      const replay = await s.replay(actor, actor.workspace_id, actor.project_id, request, digest(v)); if (replay) return { initialized: !!c.initialized_at, replayed: true };
      await s.repo.statement("UPDATE agent_connections SET initialized_at=?,version=version+1 WHERE workspace_id=? AND project_id=? AND id=?", s.repo.now().toISOString(), actor.workspace_id, actor.project_id, c.id).run();
      await s.event(actor, actor.workspace_id, actor.project_id, null, "agent_initialized", "Agent acknowledged its role and exclusions. Human start approval remains required.", request, digest(v), { binding_id: c.binding_id, template_hash: b.template_hash });
      return { initialized: true, execution_authorized: false };
    });
  }
  /** Called only through the companion resource audience, never exposed as an MCP tool. */
  async heartbeat(actor: AgentActor, input: unknown) {
    const v = object(input, ["preparation"]); let preparation: AgentConnection["prepared"] = null;
    if (v.preparation != null) {
      const p = object(v.preparation, ["packet_id", "packet_hash", "checkout", "repository_id", "clean"]);
      if (typeof p.clean !== "boolean" || p.checkout != null && (typeof p.checkout !== "string" || !/^[0-9a-f]{40}$/.test(p.checkout)) || p.repository_id != null && (!Number.isSafeInteger(p.repository_id) || Number(p.repository_id) < 1)) throw changed("Invalid reported checkout preparation.");
      preparation = { packet_id: identifier(p.packet_id), packet_hash: hashValue(p.packet_hash), checkout: p.checkout as string | null, repository_id: p.repository_id as number | null, clean: p.clean, prepared_at: this.repo.now().toISOString() };
    }
    return this.repo.db.transaction(async db => {
      const s = this.scoped(db); await s.lock(actor.operator_id, actor.workspace_id, actor.project_id); const c = await s.validateConnection(actor);
      if (preparation) {
        const packet = await s.packet(actor.workspace_id, actor.project_id, preparation.packet_id);
        if (packet.payload.binding_id !== c.binding_id || packet.payload.binding_version !== c.binding_version || packet.hash !== preparation.packet_hash) throw forbidden("This packet is not assigned to the connection's current role.");
      }
      const until = expires(s.repo.now(), 90);
      await s.repo.statement("UPDATE agent_connections SET lease_until=?,prepared=? WHERE workspace_id=? AND project_id=? AND id=?", until, preparation ? encoded(preparation, 4096) : null, actor.workspace_id, actor.project_id, c.id).run();
      const active = await s.repo.statement("SELECT id,ticket_id,agent_session_id FROM delivery_attempts WHERE workspace_id=? AND project_id=? AND connection_id=? AND state='running' AND lease_until>?", actor.workspace_id, actor.project_id, c.id, s.repo.now().toISOString()).all<{ id: string; ticket_id: string; agent_session_id: string | null }>();
      for (const attempt of active.results) {
        const ticket = await s.ticket(actor.workspace_id, actor.project_id, attempt.ticket_id);
        try { if (!await s.sessionActive(attempt.agent_session_id, actor.operator_id)) throw forbidden("The execution sign-in ended."); await new DeliveryRepository(s.repo, s.options).currentPacket(actor.operator_id, ticket); }
        catch (error) {
          if (!(error instanceof AppError)) throw error;
          await s.fence(ticket, "lease_lost"); ticket.phase = "assigned"; await s.saveTicket(ticket);
          await s.event({ kind: "system", id: "delivery-coordinator" }, actor.workspace_id, actor.project_id, ticket.id, "context_fenced", "The approved packet or execution sign-in is no longer current. Review the work and authorize a fresh start.", randomUUID(), digest({ attempt_id: attempt.id, action: "context_fenced" }), { attempt_id: attempt.id, physical_stop: "unconfirmed" }, [actor.operator_id]);
        }
      }
      await s.repo.statement("UPDATE delivery_attempts SET lease_until=? WHERE workspace_id=? AND project_id=? AND connection_id=? AND state='running' AND lease_until>?", until, actor.workspace_id, actor.project_id, c.id, s.repo.now().toISOString()).run();
      return { lease_until: until, physical_execution: "attended", checkout_provenance: "companion_reported" };
    });
  }
}

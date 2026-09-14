import { requestId } from "../context.ts";
import { identifier, object } from "../domain.ts";
import { covers, hashValue, parseCheckpoint, parseReport, roleGate, version } from "../delivery.ts";
import type { AgentActor } from "../delivery.ts";
import type { Database } from "./repository.ts";
import { Repository } from "./repository.ts";
import { DeliveryRepository } from "./delivery-repository.ts";
import { changed, digest, encoded, forbidden } from "./delivery-store.ts";

/** Agent-only operations. There is deliberately no acceptance, assignment or start tool. */
export class DeliveryExecution extends DeliveryRepository {
  override scoped(db: Database) { return new DeliveryExecution(new Repository(db, this.repo.now), this.options); }
  async claim(actor: AgentActor, input: unknown) {
    const v = object(input, ["request_id", "ticket_id", "attempt_id", "packet_hash"]); const request = requestId(v.request_id); const ticketId = identifier(v.ticket_id); const attemptId = identifier(v.attempt_id); const hash = hashValue(v.packet_hash);
    return this.repo.db.transaction(async db => {
      const s = this.scoped(db); await s.lock(actor.operator_id, actor.workspace_id, actor.project_id); const c = await s.validateConnection(actor);
      const replay = await s.replay(actor, actor.workspace_id, actor.project_id, request, digest(v));
      if (replay) { const a = await s.attempt(actor.workspace_id, actor.project_id, attemptId); if (a.state === "running" && replay.ticket) await s.currentPacket(actor.operator_id, replay.ticket); return { ...replay, attempt: { id: a.id, state: a.state, version: a.version, lease_until: a.lease_until }, execution_authorized: a.state === "running" && !!a.lease_until && a.lease_until > s.repo.now().toISOString() }; }
      const t = await s.ticket(actor.workspace_id, actor.project_id, ticketId); const a = await s.attempt(actor.workspace_id, actor.project_id, attemptId);
      const now = s.repo.now().toISOString();
      if (!c.initialized_at || !c.lease_until || c.lease_until <= now || t.binding_id !== c.binding_id || t.attempt_id !== a.id || a.connection_id !== c.id || a.profile_id !== c.profile_id || a.ticket_id !== t.id || a.state !== "authorized" || a.grant_expires <= now || t.phase !== "start_approved") throw forbidden("This exact attempt needs a current human start approval and an online companion.");
      const packet = await s.currentPacket(actor.operator_id, t); if (packet.hash !== hash || packet.id !== a.packet_id) throw changed("Claim the exact approved packet.");
      const competing = await s.repo.statement("SELECT id FROM delivery_attempts WHERE workspace_id=? AND profile_id=? AND state='running' AND lease_until>? AND id<>?", actor.workspace_id, c.profile_id, now, a.id).first();
      if (competing) throw changed("This profile is already running another attempt.");
      await s.repo.statement("UPDATE delivery_attempts SET state='running',version=version+1,started_at=?,lease_until=? WHERE workspace_id=? AND project_id=? AND id=? AND state='authorized'", now, c.lease_until, actor.workspace_id, actor.project_id, a.id).run();
      t.phase = "in_progress"; await s.saveTicket(t);
      const e = await s.event(actor, actor.workspace_id, actor.project_id, t.id, "attempt_started", "Agent claimed the exact human-authorized packet.", request, digest(v), { attempt_id: a.id, packet_id: packet.id, packet_hash: packet.hash }, [actor.operator_id]);
      return { ...e, ticket: t, attempt: { id: a.id, state: "running", version: a.version + 1, lease_until: c.lease_until }, packet, execution_authorized: true };
    });
  }
  async writeAttempt(actor: AgentActor, action: "checkpoint" | "submit", input: unknown) {
    const v = object(input, ["request_id", "attempt_id", "expected_version", action]); const request = requestId(v.request_id); const attemptId = identifier(v.attempt_id); const expected = version(v.expected_version);
    const checkpoint = action === "checkpoint" ? parseCheckpoint(v.checkpoint) : null; const report = action === "submit" ? parseReport(v.submit) : null;
    return this.repo.db.transaction(async db => {
      const s = this.scoped(db); await s.lock(actor.operator_id, actor.workspace_id, actor.project_id); const c = await s.validateConnection(actor);
      const h = digest({ action, ...v }); const replay = await s.replay(actor, actor.workspace_id, actor.project_id, request, h); if (replay) return replay;
      const a = await s.attempt(actor.workspace_id, actor.project_id, attemptId); const now = s.repo.now().toISOString(); const t = await s.ticket(actor.workspace_id, actor.project_id, a.ticket_id);
      if (a.connection_id !== c.id || a.profile_id !== c.profile_id || t.attempt_id !== a.id || t.phase !== "in_progress" || a.state !== "running" || !a.lease_until || a.lease_until <= now || !c.lease_until || c.lease_until <= now) throw forbidden("This attempt is no longer active. Ask your human operator for a fresh assignment and start.");
      if (a.version !== expected) throw changed("Reload the current attempt before submitting another checkpoint or report.");
      const packet = await s.currentPacket(actor.operator_id, t);
      if (checkpoint) {
        if (checkpoint.changed_paths.some(p => !covers(p, packet.payload.write_paths))) throw forbidden("A reported change is outside the approved write scope. Stop and ask the human to review the boundary.");
        await s.repo.statement("UPDATE delivery_attempts SET checkpoint=?,version=version+1 WHERE workspace_id=? AND project_id=? AND id=? AND version=?", encoded(checkpoint, 16384), actor.workspace_id, actor.project_id, a.id, expected).run();
        t.payload.last_checkpoint = checkpoint; await s.saveTicket(t);
      }
      if (report) {
        if (t.role_id !== "business_analysis" && t.role_id !== "solution_architecture" && (report.requirements.length || report.plan.length)) throw forbidden("Propose requirement or architecture changes through a human-routed finding. They are outside this role.");
        if (t.role_id === "business_analysis" && report.plan.length) throw forbidden("BA proposes requirements; the architect proposes the implementation plan.");
        if (t.kind === "delivery") {
          if (!report.evidence.candidate || report.evidence.candidate.repository_id !== packet.payload.repository?.repository_id) throw changed("Report the exact candidate in this packet's repository.");
          if (t.role_id !== "development" && digest(report.evidence.candidate) !== digest(t.payload.candidate)) throw changed("Review the exact approved candidate. A changed commit must return to development and repeat review.");
          if (["user_acceptance_testing", "release_operations"].includes(t.role_id) && (report.evidence.environment !== t.payload.environment || report.evidence.artifact !== t.payload.environment_artifact)) throw changed("The report must identify the authorized environment.");
          if (report.outcome === "pass" && !report.evidence.checks.length) throw changed("A passing implementation or review needs at least one explicit check.");
        }
        if (t.kind === "requirements" && report.outcome === "pass" && !report.requirements.length) throw changed("A successful BA report needs proposed requirements for human review.");
        if (t.kind === "architecture" && report.outcome === "pass" && (!report.plan.length || !report.requirements.length)) throw changed("An architecture report needs a proposed design document and a bounded ticket plan.");
        t.payload.report = report; t.phase = "in_review"; await s.saveTicket(t);
        await s.repo.statement("UPDATE delivery_attempts SET state='submitted',version=version+1,ended_at=?,lease_until=NULL WHERE workspace_id=? AND project_id=? AND id=? AND version=?", now, actor.workspace_id, actor.project_id, a.id, expected).run();
      }
      const config = await s.configuration(actor.workspace_id, actor.project_id);
      const e = await s.event(actor, actor.workspace_id, actor.project_id, t.id, action === "submit" ? "report_submitted" : "checkpoint_saved", report?.summary ?? checkpoint!.summary, request, h, { attempt_id: a.id, provenance: "agent_reported", ...(report ? { report } : { checkpoint }) }, report ? [actor.operator_id, config.reviewers[roleGate(t.role_id)]] : []);
      return { ...e, ticket: t, attempt_version: a.version + 1, execution_authorized: action === "checkpoint" };
    });
  }
  async agentInbox(actor: AgentActor) {
    const c = await this.validateConnection(actor);
    const rows = await this.repo.statement("SELECT id,title,phase,role_id,version,packet_id,attempt_id,updated_at FROM delivery_tickets WHERE workspace_id=? AND project_id=? AND binding_id=? AND phase NOT IN ('accepted','cancelled') ORDER BY updated_at DESC,id LIMIT 50", actor.workspace_id, actor.project_id, c.binding_id).all();
    return { profile_id: c.profile_id, connection_id: c.id, initialized: !!c.initialized_at, companion_online: !!c.lease_until && c.lease_until > this.repo.now().toISOString(), tickets: rows.results, next_action: "Read your role, initialize, and ask your human to authorize an assigned packet before claiming work." };
  }
  async agentPacket(actor: AgentActor, ticketId: string) {
    const c = await this.validateConnection(actor); const t = await this.ticket(actor.workspace_id, actor.project_id, ticketId);
    if (t.binding_id !== c.binding_id || ["accepted", "cancelled"].includes(t.phase)) throw forbidden("This work is not currently assigned to this role.");
    const packet = await this.currentPacket(actor.operator_id, t);
    const a = t.attempt_id ? await this.attempt(actor.workspace_id, actor.project_id, t.attempt_id) : null;
    return { ticket: t, packet, attempt: a && a.connection_id === c.id ? { id: a.id, state: a.state, version: a.version, grant_expires: a.grant_expires, lease_until: a.lease_until } : null, source_provenance: "human_approved_context_and_verified_repository", execution_authorized: a?.connection_id === c.id && a.state === "running" && !!a.lease_until && a.lease_until > this.repo.now().toISOString() };
  }
}

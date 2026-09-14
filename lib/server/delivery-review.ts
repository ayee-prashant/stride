import { randomUUID } from "node:crypto";
import { choice, text } from "../domain.ts";
import { decision, hashValue, roleGate, SPECIALIST_REVIEWS } from "../delivery.ts";
import type { AgentReport, DeliveryTicket, HumanActor, PlanItem } from "../delivery.ts";
import type { Database } from "./repository.ts";
import { Repository } from "./repository.ts";
import { ContextRepository } from "./context-repository.ts";
import { DeliveryExecution } from "./delivery-execution.ts";
import { changed, digest, encoded, expires, forbidden } from "./delivery-store.ts";

export class DeliveryReview extends DeliveryExecution {
  override scoped(db: Database) { return new DeliveryReview(new Repository(db, this.repo.now), this.options); }
  async verified(t: DeliveryTicket, environment?: string, artifact?: string) {
    const candidate = t.payload.report?.evidence.candidate ?? t.payload.candidate;
    artifact ??= environment ? t.payload.environment_artifact ?? undefined : undefined;
    if (environment && !artifact) throw changed("The authorized deployment artifact must be identified.");
    if (!candidate || !this.options.verifyEvidence) throw changed("Connect the repository evidence verifier before accepting this candidate.");
    const evidence = await this.options.verifyEvidence({ workspace_id: t.workspace_id, project_id: t.project_id, candidate, ...(environment ? { environment } : {}), ...(artifact ? { artifact } : {}) });
    if (evidence.provenance !== "github_verified" || evidence.commit !== candidate.commit || evidence.repository_id !== candidate.repository_id || evidence.pull_request !== candidate.pull_request || !evidence.checks.length || evidence.checks.some(c => c.conclusion !== "success") || evidence.observed_at < expires(this.repo.now(), -60) || evidence.observed_at > expires(this.repo.now(), 5)) throw changed("Fresh provider evidence for this exact candidate and successful checks is required.");
    if (environment && (evidence.deployment?.environment !== environment || evidence.deployment.state !== "success" || artifact && evidence.deployment.artifact !== artifact)) throw changed("Verify the exact deployment, environment and artifact before continuing.");
    return evidence;
  }
  async publishDocuments(userId: string, t: DeliveryTicket, report: AgentReport) {
    const context = new ContextRepository(this.repo, this.options.bindings); const docs = await context.currentDocuments(userId, t.workspace_id, t.project_id);
    for (const proposed of report.requirements) {
      const kind = t.kind === "requirements" ? "requirement" : "decision";
      const current = docs.find(d => d.kind === kind && d.title.toLocaleLowerCase("en-US") === proposed.title.toLocaleLowerCase("en-US"));
      await context.publish(userId, t.workspace_id, t.project_id, { request_id: randomUUID(), document_id: current?.document_id ?? null, expected_version: current?.version ?? 0, kind, title: proposed.title, body: proposed.body, state: "active", change_note: `Human accepted the ${t.role_id} proposal from delivery ticket ${t.id}.` });
    }
    return (await context.currentDocuments(userId, t.workspace_id, t.project_id)).filter(d => d.state === "active");
  }
  async adoptPlan(userId: string, t: DeliveryTicket, plan: PlanItem[]) {
    const baseline = await this.baselineCurrent(userId, t.workspace_id, t.project_id); const config = await this.configuration(t.workspace_id, t.project_id);
    if (!plan.length || plan.some(i => i.requirement_ids.some(id => !baseline.documents.some(d => d.id === id)))) throw changed("Every plan item must reference the approved baseline.");
    const revision = config.plan_revision + 1; const ids = new Map<string, string>(); const tickets: DeliveryTicket[] = [];
    for (const item of plan) {
      const ticket = await this.insertTicket(userId, t.workspace_id, t.project_id, "delivery", item.title, item.description, { review_roles: item.review_roles ?? [], acceptance: item.acceptance, todo: item.todo, requirement_ids: item.requirement_ids, read_paths: item.read_paths, write_paths: item.write_paths, depends_on: [], candidate: null, report: null, reviews: [], rework_cycles: 0, environment: null, environment_artifact: null, reviewed_context_hash: null, release: null, last_checkpoint: null }, revision);
      ids.set(item.key, ticket.id); tickets.push(ticket);
    }
    for (let i = 0; i < plan.length; i++) { tickets[i].payload.depends_on = plan[i].depends_on.map(d => ids.get(d)!); await this.saveTicket(tickets[i]); }
    await this.repo.statement("UPDATE delivery_projects SET plan_revision=?,version=version+1,updated_at=? WHERE workspace_id=? AND project_id=?", revision, this.repo.now().toISOString(), t.workspace_id, t.project_id).run();
    return tickets.map(ticket => ({ id: ticket.id, task_id: ticket.task_id, title: ticket.title }));
  }
  async review(userId: string, workspaceId: string, projectId: string, ticketId: string, input: unknown) {
    const v = decision(input, ["decision", "report_hash"]); const response = choice(v.decision, ["accept", "return"] as const, "Review decision"); const reportHash = hashValue(v.report_hash);
    await this.project(userId, workspaceId, projectId); const initial = await this.ticket(workspaceId, projectId, ticketId);
    const gate = roleGate(initial.role_id); const config = await this.configuration(workspaceId, projectId);
    if (config.reviewers[gate] !== userId) throw forbidden();
    if (!initial.payload.report || digest(initial.payload.report) !== reportHash) throw changed("Review the current exact report.");
    if (response === "accept" && initial.payload.report.outcome !== "pass") throw changed("A failed or blocked report cannot pass a gate. Return it with a human decision.");
    // Provider calls occur outside row locks. The transaction rechecks version/report/candidate afterward.
    const evidence = response === "accept" && initial.kind === "delivery" ? await this.verified(initial, ["user_acceptance_testing", "release_operations"].includes(initial.role_id) ? initial.payload.environment ?? undefined : undefined, initial.role_id === "release_operations" ? initial.payload.release?.artifact : undefined) : null;
    return this.repo.db.transaction(async db => {
      const s = this.scoped(db); await s.lock(userId, workspaceId, projectId); const currentConfig = await s.configuration(workspaceId, projectId); const t = await s.ticket(workspaceId, projectId, ticketId);
      if (currentConfig.reviewers[roleGate(t.role_id)] !== userId) throw forbidden();
      const actor: HumanActor = { kind: "human", id: userId }; const h = digest({ ticketId, action: "review", ...v }); const replay = await s.replay(actor, workspaceId, projectId, v.request_id, h); if (replay) return replay;
      if (t.version !== v.expected_version || t.phase !== "in_review" || !t.payload.report || digest(t.payload.report) !== reportHash) throw changed();
      const reviewedPacket = response === "accept" ? await s.currentPacket(userId, t) : null;
      const report = t.payload.report; const reviewedRole = t.role_id; let adopted: unknown = null;
      if (response === "return") {
        t.payload.rework_cycles += 1; t.payload.environment = null; t.payload.environment_artifact = null; t.payload.reviewed_context_hash = null; t.payload.release = null;
        const routes = report.findings.map(f => f.route);
        if (t.payload.rework_cycles > 2 || t.kind === "delivery" && routes.some(r => r === "requirements" || r === "architecture")) t.phase = "replan_required";
        else { t.phase = "created"; t.role_id = t.kind === "requirements" ? "business_analysis" : t.kind === "architecture" ? "solution_architecture" : "development"; }
        t.payload.todo = [`Resolve the human review: ${v.reason}`, ...report.findings.map(f => `${f.title}: reproduce ${f.reproduction}; expected ${f.expected}; actual ${f.actual}`), "Re-run the acceptance checks and submit new evidence."];
        if (t.kind === "delivery") { t.payload.candidate = null; t.payload.candidate_profile = null; }
      } else {
        if (report.outcome !== "pass") throw changed("Failed or blocked evidence cannot pass this review.");
        if (evidence && evidence.observed_at < expires(s.repo.now(), -60)) throw changed("Provider evidence expired during review. Verify again.");
        if (t.kind === "delivery") t.payload.reviewed_context_hash = reviewedPacket!.payload.context_hash;
        t.payload.reviews.push({ gate: roleGate(t.role_id), role: t.role_id, by: userId, at: s.repo.now().toISOString(), report_hash: reportHash, candidate: report.evidence.candidate, reason: v.reason });
        if (t.payload.reviews.length > 60) throw changed("This ticket reached its review limit. Replan into a new ticket.");
        if (t.kind === "requirements") {
          const docs = await s.publishDocuments(userId, t, report); const requirements = docs.filter(d => d.kind === "requirement");
          if (!requirements.length || requirements.length > 20) throw changed("A baseline needs between one and twenty active requirements. Split or retire obsolete requirements first.");
          const baseline = { documents: requirements.map(d => ({ id: d.document_id, version: d.version })), approved_by: userId, approved_at: s.repo.now().toISOString() };
          await s.repo.statement("UPDATE delivery_projects SET baseline=?,version=version+1,updated_at=? WHERE workspace_id=? AND project_id=?", encoded(baseline, 16384), s.repo.now().toISOString(), workspaceId, projectId).run();
          t.phase = "accepted"; adopted = { baseline, next_action: "The architecture human can create and assign a design task." };
        } else if (t.kind === "architecture") {
          await s.publishDocuments(userId, t, report); adopted = await s.adoptPlan(userId, t, report.plan); t.phase = "accepted";
        } else if (t.role_id === "development") {
          t.payload.candidate = report.evidence.candidate; t.payload.candidate_profile = t.attempt_id ? (await s.attempt(workspaceId, projectId, t.attempt_id)).profile_id : null; t.payload.remaining_reviews = [...t.payload.review_roles]; t.role_id = t.payload.remaining_reviews.shift() ?? "peer_review"; t.phase = "created"; t.payload.todo = ["Independently inspect the exact proposed commit and linked acceptance criteria.", "Check correctness, security, performance and maintainability.", "Submit findings or evidence for engineering acceptance."];
        } else if (SPECIALIST_REVIEWS.includes(t.role_id as typeof SPECIALIST_REVIEWS[number])) {
          t.role_id = t.payload.remaining_reviews?.shift() ?? "peer_review"; t.phase = "created";
          t.payload.todo = ["Independently review the exact candidate within this specialist role.", "Report actionable findings or passing evidence for the engineering human."];
        } else if (t.role_id === "peer_review") {
          t.role_id = "quality_assurance"; t.phase = "created"; t.payload.todo = ["Test the exact candidate against every acceptance criterion.", "Include regressions, negative cases and relevant security/access checks.", "Report reproducible issues or passing QA evidence."];
        } else if (t.role_id === "quality_assurance") { t.phase = "uat_authorization"; }
        else if (t.role_id === "user_acceptance_testing") { t.phase = "release_authorization"; }
        else if (t.role_id === "release_operations") { t.phase = "accepted"; }
        else throw changed("This role is not a completion gate for this delivery ticket.");
      }
      await s.fence(t); t.binding_id = null; t.packet_id = null; await s.saveTicket(t);
      if (t.phase === "accepted") {
        const task = await s.repo.task(userId, workspaceId, t.task_id);
        await s.repo.updateTask(userId, workspaceId, t.task_id, { version: task.version, status: "done" });
      }
      const e = await s.event(actor, workspaceId, projectId, t.id, response === "accept" ? "report_accepted" : "work_returned", v.reason, v.request_id, h, { role: reviewedRole, report_hash: reportHash, report, review_mode: reviewedPacket?.payload.review_mode ?? null, verified: evidence, resulting_phase: t.phase, adopted }, [currentConfig.reviewers.architecture, currentConfig.reviewers[roleGate(t.role_id)], ...(t.phase === "uat_authorization" ? [currentConfig.reviewers.uat] : []), ...(t.phase === "release_authorization" ? [currentConfig.reviewers.release] : [])]);
      return { ...e, ticket: t, adopted };
    });
  }
  async authorizeEnvironment(userId: string, workspaceId: string, projectId: string, ticketId: string, stage: "uat" | "release", input: unknown) {
    const v = decision(input, ["environment", "artifact", ...(stage === "release" ? ["configuration", "migration", "recovery"] : []), "accept_authorization"]);
    if (v.accept_authorization !== true) throw forbidden("Explicit human environment authorization is required.");
    const environment = text(v.environment, "Environment", 100); const artifact = text(v.artifact, "Artifact", 300);
    const releaseDetails = stage === "release" ? { configuration: text(v.configuration, "Configuration version", 300), migration: text(v.migration, "Migration plan", 2000), recovery: text(v.recovery, "Recovery plan", 2000) } : null;
    await this.project(userId, workspaceId, projectId); const initial = await this.ticket(workspaceId, projectId, ticketId); const config = await this.configuration(workspaceId, projectId);
    if (config.reviewers[stage] !== userId) throw forbidden();
    // UAT requires an observed deployed candidate. Production authorization validates
    // successful CI for the candidate; production deployment is verified at closure.
    if (stage === "release" && initial.payload.environment_artifact !== artifact) throw changed("Release the artifact that passed UAT. A different artifact must repeat UAT.");
    const evidence = await this.verified(initial, stage === "uat" ? environment : undefined, stage === "uat" ? artifact : undefined);
    return this.repo.db.transaction(async db => {
      const s = this.scoped(db); await s.lock(userId, workspaceId, projectId); const cfg = await s.configuration(workspaceId, projectId); const t = await s.ticket(workspaceId, projectId, ticketId);
      if (cfg.reviewers[stage] !== userId) throw forbidden();
      const h = digest({ ticketId, action: stage, ...v }); const replay = await s.replay({ kind: "human", id: userId }, workspaceId, projectId, v.request_id, h); if (replay) return replay;
      if (t.version !== v.expected_version || t.phase !== `${stage}_authorization` || digest(t.payload.candidate) !== digest(initial.payload.candidate) || evidence.observed_at < expires(s.repo.now(), -60)) throw changed();
      await s.baselineCurrent(userId, workspaceId, projectId);
      t.payload.environment = environment; t.payload.environment_artifact = artifact;
      if (releaseDetails) t.payload.release = { artifact, environment, ...releaseDetails, approved_by: userId, approved_at: s.repo.now().toISOString() };
      t.role_id = stage === "uat" ? "user_acceptance_testing" : "release_operations"; t.phase = "created";
      t.payload.todo = stage === "uat" ? ["Exercise the authorized UAT deployment against business acceptance criteria.", "Record the environment, exact candidate and reproducible results."] : ["Review the exact release authorization, configuration, migration and recovery plan.", "Coordinate the human-authorized production operation.", "Submit the deployed candidate, artifact and post-deployment verification for human closure."];
      await s.saveTicket(t);
      const e = await s.event({ kind: "human", id: userId }, workspaceId, projectId, t.id, `${stage}_authorized`, v.reason, v.request_id, h, { candidate: t.payload.candidate, environment, artifact, release: t.payload.release, verified: evidence }, [cfg.reviewers.architecture]);
      return { ...e, ticket: t };
    });
  }
  async rework(userId: string, workspaceId: string, projectId: string, ticketId: string, input: unknown) {
    const v = decision(input, ["accept_rework"]);
    if (v.accept_rework !== true) throw forbidden("Confirm that the candidate must repeat development and every review.");
    await this.project(userId, workspaceId, projectId);
    return this.repo.db.transaction(async db => {
      const s = this.scoped(db); await s.lock(userId, workspaceId, projectId);
      const cfg = await s.configuration(workspaceId, projectId);
      if (cfg.reviewers.architecture !== userId) throw forbidden();
      const h = digest({ ticketId, action: "rework", ...v });
      const replay = await s.replay({ kind: "human", id: userId }, workspaceId, projectId, v.request_id, h); if (replay) return replay;
      const t = await s.ticket(workspaceId, projectId, ticketId);
      if (t.version !== v.expected_version || t.kind !== "delivery" || ["accepted", "cancelled", "in_review", "replan_required"].includes(t.phase)) throw changed("Return a submitted report through its human review gate; completed outcomes remain immutable.");
      const previous = { phase: t.phase, role: t.role_id, candidate: t.payload.candidate };
      await s.fence(t); t.binding_id = null; t.packet_id = null;
      t.payload.rework_cycles += 1; t.phase = t.payload.rework_cycles > 2 ? "replan_required" : "created"; t.role_id = "development";
      t.payload.candidate = null; t.payload.candidate_profile = null; t.payload.report = null; t.payload.reviewed_context_hash = null;
      t.payload.environment = null; t.payload.environment_artifact = null; t.payload.release = null;
      t.payload.remaining_reviews = [...t.payload.review_roles];
      t.payload.todo = [`Resolve the human decision: ${v.reason}`, "Recheck the current approved requirements and file scope.", "Submit a new candidate and repeat every review gate."];
      await s.saveTicket(t);
      const e = await s.event({ kind: "human", id: userId }, workspaceId, projectId, t.id, "candidate_withdrawn", v.reason, v.request_id, h, { previous, physical_stop: "unconfirmed" }, [cfg.reviewers.engineering]);
      return { ...e, ticket: t };
    });
  }
  async stop(userId: string, workspaceId: string, projectId: string, ticketId: string, input: unknown) {
    const v = decision(input, ["cancel_ticket"]); if (typeof v.cancel_ticket !== "boolean") throw changed("Choose whether to pause work or cancel the ticket.");
    await this.project(userId, workspaceId, projectId);
    return this.repo.db.transaction(async db => {
      const s = this.scoped(db); await s.lock(userId, workspaceId, projectId, [], true); const t = await s.ticket(workspaceId, projectId, ticketId); const cfg = await s.configuration(workspaceId, projectId);
      const binding = t.binding_id ? await s.repo.statement("SELECT p.operator_id FROM agent_role_bindings b JOIN agent_profiles p ON p.id=b.profile_id AND p.workspace_id=b.workspace_id WHERE b.workspace_id=? AND b.project_id=? AND b.id=?", workspaceId, projectId, t.binding_id).first<{ operator_id: string }>() : null;
      if (userId !== binding?.operator_id && !Object.values(cfg.reviewers).includes(userId)) throw forbidden();
      const h = digest({ ticketId, action: "stop", ...v }); const replay = await s.replay({ kind: "human", id: userId }, workspaceId, projectId, v.request_id, h); if (replay) return replay;
      if (t.version !== v.expected_version || ["accepted", "cancelled"].includes(t.phase)) throw changed();
      if (!v.cancel_ticket && !["assigned", "start_approved", "in_progress"].includes(t.phase)) throw changed("Only active or assigned work can be paused. Review submitted work at its current gate.");
      await s.fence(t); t.phase = v.cancel_ticket ? "cancelled" : "assigned"; await s.saveTicket(t);
      const e = await s.event({ kind: "human", id: userId }, workspaceId, projectId, t.id, v.cancel_ticket ? "ticket_cancelled" : "attempt_paused", v.reason, v.request_id, h, { physical_stop: "unconfirmed", fresh_human_start_required: true }, binding ? [binding.operator_id] : []);
      return { ...e, ticket: t, physical_stop: "unconfirmed" };
    });
  }
}

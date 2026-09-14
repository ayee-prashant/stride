import { choice, identifier, invalid, object, text } from "./domain.ts";
import { requestId } from "./context.ts";
import { sourcePath } from "./github-context.ts";
import type { ContextRevision } from "./context.ts";
import type { AgentRole } from "./agents.ts";

export const DELIVERY_ROLES = ["business_analysis", "solution_architecture", "development", "peer_review", "quality_assurance", "user_acceptance_testing", "release_operations"] as const;
export const REVIEW_GATES = ["requirements", "architecture", "engineering", "qa", "uat", "release"] as const;
export type ReviewGate = typeof REVIEW_GATES[number];
export type Reviewers = Record<ReviewGate, string>;
export type DeliveryKind = "requirements" | "architecture" | "delivery";
export type DeliveryPhase = "created" | "assigned" | "start_approved" | "in_progress" | "in_review" | "uat_authorization" | "release_authorization" | "accepted" | "cancelled" | "replan_required";
export type Candidate = { repository_id: number; commit: string; pull_request: number };
export type Evidence = { summary: string; checks: { name: string; result: "pass" | "fail" | "not_run"; details: string }[]; candidate: Candidate | null; environment: string | null; artifact: string | null };
export const SPECIALIST_REVIEWS = ["security_review", "ux_accessibility", "performance_data", "documentation"] as const;
export type PlanItem = { review_roles?: AgentRole[]; key: string; title: string; description: string; acceptance: string[]; todo: string[]; requirement_ids: string[]; read_paths: string[]; write_paths: string[]; depends_on: string[] };
export type AgentReport = { outcome: "pass" | "issues" | "blocked"; summary: string; evidence: Evidence; findings: { title: string; reproduction: string; expected: string; actual: string; route: "development" | "requirements" | "architecture" | "operations" }[]; requirements: { title: string; body: string }[]; plan: PlanItem[]; next_action: string };
export type DeliveryProject = { workspace_id: string; project_id: string; version: number; reviewers: Reviewers; baseline: { documents: { id: string; version: number }[]; approved_by: string; approved_at: string } | null; plan_revision: number; updated_at: string };
export type DeliveryTicket = { id: string; workspace_id: string; project_id: string; task_id: string; kind: DeliveryKind; title: string; version: number; phase: DeliveryPhase; role_id: AgentRole; binding_id: string | null; packet_id: string | null; attempt_id: string | null; plan_revision: number; payload: TicketPayload; created_at: string; updated_at: string };
export type TicketPayload = { candidate_profile?: string | null; review_roles: AgentRole[]; remaining_reviews?: AgentRole[]; acceptance: string[]; todo: string[]; requirement_ids: string[]; read_paths: string[]; write_paths: string[]; depends_on: string[]; candidate: Candidate | null; report: AgentReport | null; reviews: { gate: string; role: AgentRole; by: string; at: string; report_hash: string; candidate: Candidate | null; reason: string }[]; rework_cycles: number; environment: string | null; environment_artifact: string | null; reviewed_context_hash: string | null; release: { artifact: string; environment: string; configuration: string; migration: string; recovery: string; approved_by: string; approved_at: string } | null; last_checkpoint: Checkpoint | null };
export type Checkpoint = { summary: string; next_steps: string[]; changed_paths: string[]; blockers: string[] };
export type WorkPacket = { review_mode?: "self_review" | "separate_profile" | "not_applicable"; format: "stride-work-packet/1"; ticket_id: string; ticket_version: number; kind: DeliveryKind; title: string; role_id: AgentRole; binding_id: string; binding_version: number; template_hash: string; prompt: string; operator_id: string; membership_epoch: string; context: ContextRevision[]; context_hash: string; repository: { repository_id: number; full_name: string; commit: string; policy_hash: string; files: { path: string; body: string; blob_sha: string }[] } | null; acceptance: string[]; todo: string[]; read_paths: string[]; write_paths: string[]; candidate: Candidate | null; environment: string | null; artifact: string | null; release: TicketPayload["release"]; checkpoint: Checkpoint | null; prior_reviews: TicketPayload["reviews"]; exclusions: string[] };
export type AgentConnection = { id: string; workspace_id: string; project_id: string; profile_id: string; binding_id: string; binding_version: number; operator_id: string; membership_epoch: string; name: string; client_id: string | null; companion_client_id: string | null; state: "pending" | "active" | "revoked"; initialized_at: string | null; lease_until: string | null; prepared: { packet_id: string; packet_hash: string; checkout: string | null; repository_id: number | null; clean: boolean; prepared_at: string } | null; version: number; created_at: string; revoked_at: string | null };
export type AgentActor = { kind: "agent"; connection_id: string; profile_id: string; operator_id: string; workspace_id: string; project_id: string; session_id: string };
export type HumanActor = { kind: "human"; id: string };
export type DeliveryActor = AgentActor | HumanActor;
export type VerifiedEvidence = { provenance: "github_verified"; repository_id: number; commit: string; pull_request: number; checks: { name: string; conclusion: string }[]; deployment: { id: string; environment: string; artifact: string; state: "success" } | null; observed_at: string };

export function version(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 10000) return invalid("Use the current positive version."); return Number(value); }
export function hashValue(value: unknown) { const result = text(value, "Fingerprint", 64); if (!/^[0-9a-f]{64}$/.test(result)) return invalid("Use an exact SHA-256 fingerprint."); return result; }
export function listOfText(value: unknown, label: string, max = 20, length = 600): string[] {
  if (!Array.isArray(value) || value.length > max) return invalid(`${label} supports at most ${max} entries.`);
  return value.map(v => text(v, label, length));
}
export function paths(value: unknown) { return listOfText(value, "Repository paths", 20, 160).map(sourcePath); }
export function covers(path: string, allowed: string[]) { return allowed.some(value => { const p = value.replace(/\/$/, ""); return path === p || path.startsWith(p + "/"); }); }
export function parseCandidate(input: unknown): Candidate | null {
  if (input == null) return null;
  const v = object(input, ["repository_id", "commit", "pull_request"]); const commit = text(v.commit, "Commit", 40);
  if (!/^[0-9a-f]{40}$/.test(commit) || !Number.isSafeInteger(v.repository_id) || Number(v.repository_id) < 1 || !Number.isSafeInteger(v.pull_request) || Number(v.pull_request) < 1) return invalid("Use the exact GitHub repository ID, commit SHA and pull request number.");
  return { repository_id: Number(v.repository_id), commit, pull_request: Number(v.pull_request) };
}
export function parseCheckpoint(input: unknown): Checkpoint {
  const v = object(input, ["summary", "next_steps", "changed_paths", "blockers"]);
  return { summary: text(v.summary, "Checkpoint", 3000), next_steps: listOfText(v.next_steps, "Next steps"), changed_paths: paths(v.changed_paths), blockers: listOfText(v.blockers, "Blockers", 10) };
}
export function parseReport(input: unknown): AgentReport {
  const v = object(input, ["outcome", "summary", "evidence", "findings", "requirements", "plan", "next_action"]);
  const e = object(v.evidence, ["summary", "checks", "candidate", "environment", "artifact"]);
  if (!Array.isArray(e.checks) || e.checks.length > 20 || !Array.isArray(v.findings) || v.findings.length > 20 || !Array.isArray(v.requirements) || v.requirements.length > 10 || !Array.isArray(v.plan) || v.plan.length > 25) return invalid("Report limits exceeded.");
  const checks = e.checks.map(input => { const c = object(input, ["name", "result", "details"]); return { name: text(c.name, "Check", 160), result: choice(c.result, ["pass", "fail", "not_run"] as const, "Check result"), details: text(c.details, "Check details", 1500) }; });
  const outcome = choice(v.outcome, ["pass", "issues", "blocked"] as const, "Outcome");
  if (outcome === "pass" && checks.some(c => c.result !== "pass")) return invalid("A passing report cannot contain failed or unrun required checks.");
  const findings = v.findings.map(input => { const f = object(input, ["title", "reproduction", "expected", "actual", "route"]); return { title: text(f.title, "Finding", 200), reproduction: text(f.reproduction, "Reproduction", 1500), expected: text(f.expected, "Expected behavior", 1000), actual: text(f.actual, "Actual behavior", 1000), route: choice(f.route, ["development", "requirements", "architecture", "operations"] as const, "Finding owner") }; });
  if (outcome === "pass" && findings.length || outcome === "issues" && !findings.length) return invalid("The outcome must agree with its unresolved findings.");
  const plan = v.plan.map(parsePlanItem); validatePlan(plan);
  return { outcome, summary: text(v.summary, "Summary", 3000), evidence: { summary: text(e.summary, "Evidence summary", 3000), checks, candidate: parseCandidate(e.candidate), environment: e.environment == null ? null : text(e.environment, "Environment", 100), artifact: e.artifact == null ? null : text(e.artifact, "Artifact", 300) }, findings, requirements: v.requirements.map(input => { const d = object(input, ["title", "body"]); return { title: text(d.title, "Requirement title", 200), body: text(d.body, "Requirement", 6000) }; }), plan, next_action: text(v.next_action, "Next action", 1000) };
}
export function parsePlanItem(input: unknown): PlanItem {
  const v = object(input, ["key", "title", "description", "acceptance", "todo", "requirement_ids", "read_paths", "write_paths", "depends_on", "review_roles"]);
  const reads = paths(v.read_paths); const writes = paths(v.write_paths);
  if (writes.some(p => !covers(p, reads))) return invalid("Write paths must be inside the read scope.");
  const acceptance = listOfText(v.acceptance, "Acceptance criteria"); const todo = listOfText(v.todo, "To do");
  const requirements = listOfText(v.requirement_ids, "Requirements", 20, 160).map(identifier);
  if (!acceptance.length || !todo.length || !requirements.length || !reads.length) return invalid("Each ticket needs acceptance criteria, a to-do list, linked requirements and file scope.");
  const reviews = v.review_roles === undefined ? [] : listOfText(v.review_roles, "Specialist review roles", 4, 100).map(r => choice(r, SPECIALIST_REVIEWS, "Specialist review"));
  if (new Set(reviews).size !== reviews.length) return invalid("Select each specialist review once.");
  return { review_roles: reviews, key: identifier(v.key), title: text(v.title, "Title", 200), description: text(v.description, "Description", 6000), acceptance, todo, requirement_ids: requirements, read_paths: reads, write_paths: writes, depends_on: listOfText(v.depends_on, "Dependencies", 25, 160).map(identifier) };
}
export function validatePlan(items: PlanItem[]) {
  const all = new Map(items.map(i => [i.key, i])); if (all.size !== items.length) return invalid("Each plan item needs a unique key.");
  function walk(key: string, seen: Set<string>) { if (seen.has(key) || seen.size > 8) return invalid("Dependencies must be acyclic and no more than eight levels deep."); const item = all.get(key); if (!item) return invalid("A dependency does not belong to this plan."); for (const dep of item.depends_on) walk(dep, new Set([...seen, key])); }
  for (const item of items) walk(item.key, new Set());
}
export function decision(input: unknown, extra: string[] = []): Record<string, unknown> & { request_id: string; expected_version: number; reason: string } { const v = object(input, ["request_id", "expected_version", "reason", ...extra]); return { ...v, request_id: requestId(v.request_id), expected_version: version(v.expected_version), reason: text(v.reason, "Decision reason", 1000) }; }
export function roleGate(role: AgentRole): ReviewGate { return role === "business_analysis" ? "requirements" : role === "solution_architecture" ? "architecture" : role === "quality_assurance" ? "qa" : role === "user_acceptance_testing" ? "uat" : role === "release_operations" ? "release" : "engineering"; }

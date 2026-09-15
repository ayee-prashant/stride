import { choice, identifier, invalid, object, text } from "./domain.ts";
import { requestId } from "./context.ts";

export const AGENT_ROLES = ["business_analysis", "solution_architecture", "development", "peer_review", "quality_assurance", "user_acceptance_testing", "release_operations", "security_review", "ux_accessibility", "performance_data", "documentation"] as const;
export type AgentRole = typeof AGENT_ROLES[number];
export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  business_analysis: "Business analyst", solution_architecture: "Solutions architect", development: "Developer",
  peer_review: "Peer reviewer", quality_assurance: "QA", user_acceptance_testing: "UAT",
  release_operations: "Release / operations", security_review: "Security reviewer", ux_accessibility: "UX / accessibility",
  performance_data: "Performance / data", documentation: "Documentation",
};
export type AgentTemplate = { role_id: AgentRole; label: string; version: 1; hash: string; body: string };
export type AgentProfile = { id: string; workspace_id: string; alias: string; operator_id: string; operator_name: string; tool_label: string; created_by: string; created_at: string; operator_available: boolean };
export type AgentRoleState = "pending" | "initialized" | "revoked";
export type AgentBindingSummary = {
  id: string; workspace_id: string; project_id: string; profile_id: string; role_id: AgentRole;
  alias: string; operator_id: string; operator_name: string; tool_label: string;
  version: number; state: AgentRoleState; template_hash: string; updated_at: string;
  approved_by: string | null; approved_at: string | null; operator_available: boolean;
  template_current: boolean; connection_state: "not_connected" | "enrolled"; execution_ready: false;
  can_initialize: boolean; can_configure: boolean; can_revoke: boolean;
};
export type AgentBinding = AgentBindingSummary & { read_paths: string[]; write_paths: string[]; template_body: string };
export type AgentRegistry = { profiles: AgentProfile[]; bindings: AgentBindingSummary[]; can_register: boolean; has_more: boolean; next_offset: number; project_archived: boolean };
export type AgentRoleEvent = { id: string; binding_id: string; version: number; action: "registered" | "configured" | "initialized" | "revoked"; actor_kind: "human"; actor_id: string; created_at: string; reason: string; snapshot: { role_id: AgentRole; state: AgentRoleState; template_hash: string; template_body: string; read_paths: string[]; write_paths: string[]; approved_by: string | null; approved_at: string | null } };
export type AgentMutationResult = { binding: AgentBinding; event_id: string; replayed: boolean };

export function parseAgentCursor(value: string | null, maximum = 1001) {
  if (value === null) return 0;
  if (!/^\d{1,4}$/.test(value) || Number(value) > maximum) return invalid("Invalid agent page cursor.");
  return Number(value);
}
function templateHash(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) return invalid("Review the current role template before continuing.");
  return value;
}
function version(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1001) return invalid("Use the current role configuration version.");
  return value as number;
}
function paths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) return invalid("List at most 20 repository-relative paths.");
  const result = value.map(item => {
    const path = text(item, "Path", 160);
    const segments = path.replace(/\/$/, "").split("/");
    if (/[:\\*?\[\]{}\x00-\x1f\x7f]/.test(path) || segments.some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) return invalid("Use repository-relative paths without wildcards, parent traversal or Git internals.");
    return path;
  });
  if (new Set(result).size !== result.length) return invalid("Remove duplicate paths.");
  return result.sort();
}
function scope(v: Record<string, unknown>) {
  const read = paths(v.read_paths); const write = paths(v.write_paths);
  if (write.some(path => !read.some(allowed => allowed === path || (allowed.endsWith("/") && path.startsWith(allowed))))) return invalid("Every writable path must also be within the readable scope.");
  return { read_paths: read, write_paths: write, template_hash: templateHash(v.template_hash), reason: text(v.reason, "Reason", 500) };
}
export function parseAgentRegistration(input: unknown) {
  const v = object(input, ["request_id", "profile", "role_id", "template_hash", "read_paths", "write_paths", "reason"]);
  const p = object(v.profile, ["id", "alias", "operator_id", "tool_label"]);
  let profile: { id: string } | { alias: string; operator_id: string; tool_label: string };
  if (p.id !== undefined) { object(p, ["id"]); profile = { id: identifier(p.id) }; }
  else {
    const alias = text(p.alias, "Agent alias", 60);
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(alias)) return invalid("Use letters, numbers, spaces, dots, underscores or hyphens for the alias.");
    profile = { alias, operator_id: identifier(p.operator_id), tool_label: text(p.tool_label, "Tool or model label", 80, true) };
  }
  return { request_id: requestId(v.request_id), profile, role_id: choice(v.role_id, AGENT_ROLES, "Agent role"), ...scope(v) };
}
export function parseAgentConfiguration(input: unknown) {
  const v = object(input, ["request_id", "expected_version", "template_hash", "read_paths", "write_paths", "reason"]);
  return { request_id: requestId(v.request_id), expected_version: version(v.expected_version), ...scope(v) };
}
export function parseAgentDecision(input: unknown, initialize: boolean) {
  const v = object(input, ["request_id", "expected_version", "reason", ...(initialize ? ["template_hash"] : [])]);
  return { request_id: requestId(v.request_id), expected_version: version(v.expected_version), reason: text(v.reason, "Reason", 500), ...(initialize ? { template_hash: templateHash(v.template_hash) } : {}) };
}

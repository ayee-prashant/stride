import type { GitHubBinding, RepositoryBriefSnapshot, RepositorySource } from "../github-context.ts";
import { bindingHash } from "./github-context-provider.ts";
import type { Repository } from "./repository.ts";

export const sourceDeadline = (now: Date, seconds: number) => new Date(now.getTime() + seconds * 1000).toISOString();
export function approvedSource(bindings: GitHubBinding[], source: RepositorySource) {
  return bindings.find(b => b.workspace_id === source.workspace_id && b.project_id === source.project_id && b.key === source.binding_key && bindingHash(b) === source.policy_hash);
}
type SourceContext = {
  state: "not_connected" | "unavailable" | "current";
  source: RepositorySource | null; snapshot: RepositoryBriefSnapshot | null; reason: string | null;
};

/** A single database snapshot, scoped to a current member. Never fall back to a stale cached file. */
export async function readSourceContext(repo: Repository, bindings: GitHubBinding[], userId: string, workspaceId: string, projectId: string): Promise<SourceContext> {
  const source = await repo.statement(`SELECT s.*,o.id AS observation_id,o.policy_hash AS observation_policy,o.payload
    FROM repository_sources s
    LEFT JOIN repository_source_heads h ON h.source_id=s.id AND h.workspace_id=s.workspace_id AND h.project_id=s.project_id
    LEFT JOIN repository_observations o ON o.id=h.observation_id AND o.source_id=s.id AND o.workspace_id=s.workspace_id AND o.project_id=s.project_id
    WHERE s.workspace_id=? AND s.project_id=? AND EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=s.workspace_id AND m.user_id=?)`, workspaceId, projectId, userId)
    .first<RepositorySource & { observation_id: string | null; observation_policy: string | null; payload: string | null }>();
  if (!source || source.state === "disconnected") return { state: "not_connected", source, snapshot: null, reason: null };
  if (!approvedSource(bindings, source)) return { state: "unavailable", source, snapshot: null, reason: "access_changed" };
  const fresh = source.state === "current" && source.last_verified_at !== null && source.last_verified_at >= sourceDeadline(repo.now(), -180);
  if (!fresh || !source.payload || source.observation_policy !== source.policy_hash || !source.observation_id) {
    return { state: "unavailable", source, snapshot: null, reason: source.reason ?? (source.state === "current" ? "refresh_required" : source.state) };
  }
  return { state: "current", source, reason: null, snapshot: { source_id: source.id, observation_id: source.observation_id, policy_hash: source.policy_hash, observation: JSON.parse(source.payload) } };
}

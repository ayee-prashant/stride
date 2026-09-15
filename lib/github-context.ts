import { identifier, invalid, object, text } from "./domain.ts";

export type GitHubBinding = {
  key: string; workspace_id: string; project_id: string; repository_id: number;
  installation_id: number; owner: string; repository: string; branch: string; paths: string[];
};
export type GitHubContextFile = { path: string; blob_sha: string; sha256: string; size: number; body: string };
export type GitHubObservation = {
  repository_id: number; full_name: string; branch: string; head_sha: string; tree_sha: string;
  files: GitHubContextFile[]; manifest_hash: string; observed_at: string;
  coverage: "configured_files"; repository_mode: "observed";
};
export type GitHubSourceState = "pending" | "syncing" | "current" | "unavailable" | "disconnected";
export type GitHubSourceView = {
  id: string; version: number; repository: string; branch: string; state: GitHubSourceState;
  last_verified_at: string | null; next_refresh_at: string; reason: string | null;
  observation: GitHubObservation | null;
};
export type GitHubSourceResult = {
  configured: boolean; can_manage: boolean;
  choices: { key: string; repository: string; branch: string; paths: string[] }[];
  source: GitHubSourceView | null;
};
export type RepositoryBriefSnapshot = {
  source_id: string; observation_id: string; policy_hash: string; observation: GitHubObservation;
};
export type RepositorySource = {
  id: string; workspace_id: string; project_id: string; binding_key: string; policy_hash: string;
  repository: string; branch: string; state: GitHubSourceState; reason: string | null;
  version: number; generation: number; last_verified_at: string | null; next_refresh_at: string;
  last_started_at: string | null; lease_id: string | null; lease_until: string | null; connected_by: string; created_at: string;
};
export function positiveId(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) return invalid(`${label} must be a positive integer.`);
  return value as number;
}
export function repositoryPart(value: unknown, label: string): string {
  const name = text(value, label, 100);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name) || name === "." || name === "..") return invalid(`Invalid ${label.toLowerCase()}.`);
  return name;
}
export function sourcePath(value: unknown): string {
  const path = text(value, "Source path", 256);
  if (path.startsWith("/") || path.includes("\\") || path.split("/").some(p => !p || p === "." || p === ".." || p.toLowerCase() === ".git") || /[\u0000-\u001f\u007f]/.test(path)) return invalid("Use an exact relative repository file path.");
  // Never enroll credentials, environment files, private keys, or local agent state.
  if (/(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|credentials(?:\..*)?|id_rsa|id_ed25519|\.aws|\.ssh|\.codex|\.claude)(?:\/|$)/i.test(path) || /\.(?:pem|key|p12|pfx)$/i.test(path)) return invalid("Credential files and private agent state cannot be project context sources.");
  return path;
}
export function parseBinding(input: unknown): GitHubBinding {
  const v = object(input, ["key", "workspace_id", "project_id", "repository_id", "installation_id", "owner", "repository", "branch", "paths"]);
  const key = text(v.key, "Binding key", 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) return invalid("Invalid binding key.");
  const branch = text(v.branch, "Branch", 200);
  if (branch === "@" || branch.startsWith("/") || branch.endsWith("/") || branch.endsWith(".") || branch.includes("..") || branch.includes("@{") || /[ ~^:?*\[\\\u0000-\u001f\u007f]/.test(branch) || branch.split("/").some(p => !p || p.startsWith(".") || p.endsWith(".lock"))) return invalid("Invalid Git branch name.");
  if (!Array.isArray(v.paths) || !v.paths.length || v.paths.length > 12) return invalid("Configure between 1 and 12 required source files.");
  const paths = v.paths.map(sourcePath).sort();
  if (new Set(paths).size !== paths.length) return invalid("Source paths must be unique.");
  return { key, workspace_id: identifier(v.workspace_id), project_id: identifier(v.project_id), repository_id: positiveId(v.repository_id, "Repository ID"), installation_id: positiveId(v.installation_id, "Installation ID"), owner: repositoryPart(v.owner, "Owner"), repository: repositoryPart(v.repository, "Repository"), branch, paths };
}

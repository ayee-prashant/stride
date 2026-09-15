import type { GitHubBinding, GitHubObservation } from "../github-context.ts";
import { GitHubContextError } from "./github-context-provider.ts";
import type { RepositorySources } from "./repository-sources.ts";

export async function reconcileSource(sources: RepositorySources, provider: { inspect(binding: GitHubBinding): Promise<GitHubObservation> }) {
  const claim = await sources.claim();
  if (!claim) return "idle" as const;
  let result: GitHubObservation | GitHubContextError;
  try { result = await provider.inspect(claim.binding); }
  catch (error) { result = error instanceof GitHubContextError ? error : new GitHubContextError("upstream_unavailable"); }
  if (!await sources.finish(claim, result)) return "discarded" as const;
  return result instanceof GitHubContextError ? "unavailable" as const : "observed" as const;
}

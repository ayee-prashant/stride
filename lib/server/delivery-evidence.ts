import { randomUUID } from "node:crypto";
import type { Candidate, VerifiedEvidence } from "../delivery.ts";
import type { GitHubBinding } from "../github-context.ts";
import { bindingHash, GitHubContextError, GitHubContextProvider } from "./github-context-provider.ts";
import { changed, digest, encoded, expires } from "./delivery-store.ts";
import type { Repository } from "./repository.ts";
import { Repository as ScopedRepository } from "./repository.ts";

type Input = { workspace_id: string; project_id: string; candidate: Candidate; environment?: string; artifact?: string };
type EvidenceRow = { id: string; workspace_id: string; project_id: string; policy_hash: string; input: string; state: string; generation: number; lease_id: string | null; lease_until: string | null; requested_at: string; next_refresh: string; observed_at: string | null; payload: string | null; reason: string | null };
const record = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new GitHubContextError("incomplete"); return v as Record<string, unknown>; };
const list = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new GitHubContextError("incomplete"); return v; };

/** Called by the web process. It has grant metadata but never the GitHub signing key. */
export class DeliveryEvidenceStore {
  repo: Repository; bindings: GitHubBinding[];
  constructor(repo: Repository, bindings: GitHubBinding[]) { this.repo = repo; this.bindings = bindings; }
  binding(input: Input) { const b = this.bindings.find(b => b.workspace_id === input.workspace_id && b.project_id === input.project_id && b.repository_id === input.candidate.repository_id); if (!b) throw changed("The candidate is outside this project's approved GitHub connection."); return b; }
  async verified(input: Input): Promise<VerifiedEvidence> {
    const b = this.binding(input); const policy = bindingHash(b); const id = digest({ ...input, policy }); const now = this.repo.now().toISOString();
    const row = await this.repo.statement("SELECT * FROM delivery_evidence WHERE workspace_id=? AND project_id=? AND id=?", input.workspace_id, input.project_id, id).first<EvidenceRow>();
    if (row?.state === "current" && row.policy_hash === policy && row.observed_at && row.observed_at >= expires(this.repo.now(), -60) && row.payload) return JSON.parse(row.payload) as VerifiedEvidence;
    await this.repo.db.transaction(async db => {
      const r = new ScopedRepository(db, this.repo.now); await r.statement("UPDATE workspaces SET name=name WHERE id=?", input.workspace_id).run();
      await r.statement("UPDATE projects SET version=version WHERE workspace_id=? AND id=?", input.workspace_id, input.project_id).run();
      await r.statement("INSERT INTO delivery_evidence(id,workspace_id,project_id,policy_hash,input,state,requested_at,next_refresh) SELECT ?,?,?,?,?,'pending',?,? WHERE (SELECT COUNT(*) FROM delivery_evidence WHERE workspace_id=? AND project_id=?)<1000 ON CONFLICT(id) DO UPDATE SET requested_at=excluded.requested_at", id, input.workspace_id, input.project_id, policy, encoded(input, 4096), now, now, input.workspace_id, input.project_id).run();
    });
    throw changed(row?.reason === "checks_pending" ? "GitHub checks are not all successful yet. Review again after CI completes." : "GitHub evidence verification is queued. Keep this report open and retry after the repository worker checks it.");
  }
  async claim() {
    return this.repo.db.transaction(async db => {
      const r = new ScopedRepository(db, this.repo.now); const now = r.now().toISOString();
      const row = await r.statement("SELECT * FROM delivery_evidence WHERE requested_at>? AND next_refresh<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_refresh,id LIMIT 1", expires(r.now(), -600), now, now).first<EvidenceRow>();
      if (!row) return null; const lease = randomUUID();
      const claim = await r.statement("UPDATE delivery_evidence SET state='syncing',generation=generation+1,lease_id=?,lease_until=? WHERE id=? AND generation=? AND (lease_until IS NULL OR lease_until<=?) RETURNING *", lease, expires(r.now(), 50), row.id, row.generation, now).first<EvidenceRow>();
      return claim;
    });
  }
  async process(provider: GitHubEvidenceProvider) {
    const claim = await this.claim(); if (!claim) return false;
    let result: VerifiedEvidence | null = null; let reason: string | null = null;
    try { const input = JSON.parse(claim.input) as Input; const binding = this.binding(input); if (bindingHash(binding) !== claim.policy_hash) throw new GitHubContextError("access_unavailable"); result = await provider.inspectEvidence(binding, input); }
    catch (e) { reason = e instanceof GitHubContextError ? e.code : "upstream_unavailable"; }
    const now = this.repo.now().toISOString();
    await this.repo.statement("UPDATE delivery_evidence SET state=?,payload=?,observed_at=?,reason=?,next_refresh=?,lease_id=NULL,lease_until=NULL WHERE id=? AND generation=? AND lease_id=? AND lease_until>?", result ? "current" : "unavailable", result ? encoded(result, 65536) : null, result?.observed_at ?? null, reason, expires(this.repo.now(), result ? 45 : 60), claim.id, claim.generation, claim.lease_id, now).run();
    return true;
  }
}

/** Worker-only provider. All outbound URLs are constructed from enrolled IDs. */
export class GitHubEvidenceProvider extends GitHubContextProvider {
  async inspectEvidence(binding: GitHubBinding, input: Input): Promise<VerifiedEvidence> {
    if (!this.settings.bindings.some(b => bindingHash(b) === bindingHash(binding)) || input.candidate.repository_id !== binding.repository_id || !/^[0-9a-f]{40}$/.test(input.candidate.commit) || !Number.isSafeInteger(input.candidate.pull_request)) throw new GitHubContextError("access_unavailable");
    const signal = AbortSignal.timeout(30000); const prefix = `/repos/${encodeURIComponent(binding.owner)}/${encodeURIComponent(binding.repository)}`;
    const grant = record(await this.request(`/app/installations/${binding.installation_id}/access_tokens`, this.jwt(), signal, { repository_ids: [binding.repository_id], permissions: { contents: "read", metadata: "read", pull_requests: "read", checks: "read", statuses: "read", deployments: "read" } }));
    if (typeof grant.token !== "string" || !grant.token || grant.token.length > 4096) throw new GitHubContextError("access_unavailable"); const token = grant.token;
    const [repo, pr, checkData, statusData] = await Promise.all([
      this.request(prefix, token, signal).then(record), this.request(`${prefix}/pulls/${input.candidate.pull_request}`, token, signal).then(record),
      this.request(`${prefix}/commits/${input.candidate.commit}/check-runs?per_page=100`, token, signal, undefined, 524288).then(record),
      this.request(`${prefix}/commits/${input.candidate.commit}/status?per_page=100`, token, signal, undefined, 524288).then(record),
    ]);
    const head = record(pr.head); const base = record(pr.base);
    if (repo.id !== binding.repository_id || repo.full_name !== `${binding.owner}/${binding.repository}` || record(head.repo).id !== binding.repository_id || record(base.repo).id !== binding.repository_id || base.ref !== binding.branch || head.sha !== input.candidate.commit || pr.number !== input.candidate.pull_request || statusData.sha !== input.candidate.commit) throw new GitHubContextError("source_changed");
    const checks = list(checkData.check_runs).map(record); const statuses = list(statusData.statuses).map(record);
    if (Number(checkData.total_count) !== checks.length || Number(statusData.total_count) > 100 || !checks.length && !statuses.length) throw new GitHubContextError("incomplete");
    if (checks.some(c => c.head_sha !== input.candidate.commit || c.status !== "completed" || c.conclusion !== "success") || statuses.some(s => s.state !== "success")) throw new GitHubContextError("incomplete");
    let deployment: VerifiedEvidence["deployment"] = null;
    if (input.environment) {
      const deployments = list(await this.request(`${prefix}/deployments?sha=${input.candidate.commit}&environment=${encodeURIComponent(input.environment)}&per_page=10`, token, signal, undefined, 262144)).map(record);
      const d = deployments.find(d => d.sha === input.candidate.commit && d.environment === input.environment && typeof d.id === "number" && record(d.payload).artifact === input.artifact);
      if (!d) throw new GitHubContextError("incomplete");
      const state = list(await this.request(`${prefix}/deployments/${d.id}/statuses?per_page=1`, token, signal)).map(record)[0];
      if (state?.state !== "success" || !input.artifact) throw new GitHubContextError("incomplete");
      deployment = { id: String(d.id), environment: input.environment, artifact: input.artifact, state: "success" };
    }
    return { provenance: "github_verified", repository_id: binding.repository_id, commit: input.candidate.commit, pull_request: input.candidate.pull_request, checks: [...checks.map(c => ({ name: String(c.name).slice(0, 200), conclusion: "success" })), ...statuses.map(s => ({ name: String(s.context).slice(0, 200), conclusion: "success" }))], deployment, observed_at: this.now().toISOString() };
  }
}

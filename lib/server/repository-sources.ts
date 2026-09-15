import { createHash, randomUUID } from "node:crypto";
import { AppError, object, text, version } from "../domain.ts";
import { requestId } from "../context.ts";
import type { GitHubBinding, GitHubObservation, GitHubSourceResult, RepositorySource } from "../github-context.ts";
import { bindingHash, GitHubContextError } from "./github-context-provider.ts";
import { approvedSource, readSourceContext, sourceDeadline as plus } from "./repository-source-context.ts";
import { ContextRepository } from "./context-repository.ts";
import { Repository } from "./repository.ts";
import type { Database } from "./repository.ts";

type ObservationRow = { id: string; policy_hash: string; manifest_hash: string; payload: string };
type Operation = "connect" | "refresh" | "disconnect";
type Receipt = { request_id: string; operation: Operation; source_id: string; source_version: number; created_by: string; created_at: string; input_hash: string };
export type SourceClaim = { source: RepositorySource; binding: GitHubBinding };
const missing = () => new AppError(404, "SOURCE_UNAVAILABLE", "The repository source is unavailable.");
const conflict = () => new AppError(409, "SOURCE_CONFLICT", "The repository connection changed. Refresh before continuing.");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Human enrollment and durable read-only reconciliation. External calls happen outside transactions. */
export class RepositorySources {
  repo: Repository; bindings: GitHubBinding[];
  constructor(repo: Repository, bindings: GitHubBinding[] = []) { this.repo = repo; this.bindings = bindings; }
  scoped(db: Database) { return new RepositorySources(new Repository(db, this.repo.now), this.bindings); }
  binding(source: RepositorySource) { return approvedSource(this.bindings, source); }
  async row(workspaceId: string, projectId: string) {
    return this.repo.statement("SELECT * FROM repository_sources WHERE workspace_id=? AND project_id=?", workspaceId, projectId).first<RepositorySource>();
  }
  async currentObservation(source: RepositorySource) {
    return this.repo.statement("SELECT o.id,o.policy_hash,o.manifest_hash,o.payload FROM repository_observations o JOIN repository_source_heads h ON h.source_id=o.source_id AND h.observation_id=o.id AND h.workspace_id=o.workspace_id AND h.project_id=o.project_id WHERE o.workspace_id=? AND o.project_id=? AND o.source_id=?", source.workspace_id, source.project_id, source.id).first<ObservationRow>();
  }
  async view(userId: string, workspaceId: string, projectId: string): Promise<GitHubSourceResult> {
    const { role, project } = await new ContextRepository(this.repo).project(userId, workspaceId, projectId);
    const approved = this.bindings.filter(b => b.workspace_id === workspaceId && b.project_id === projectId);
    const current = await readSourceContext(this.repo, this.bindings, userId, workspaceId, projectId);
    const choices = approved.map(b => ({ key: b.key, repository: `${b.owner}/${b.repository}`, branch: b.branch, paths: b.paths }));
    const base = { configured: approved.length > 0, can_manage: role === "admin" && !project.archived_at, choices };
    const source = current.source;
    if (!source) return { ...base, source: null };
    if (!this.binding(source)) return { ...base, source: { id: source.id, version: source.version, state: source.state === "disconnected" ? "disconnected" : "unavailable", repository: "Restricted repository", branch: "", last_verified_at: null, next_refresh_at: source.next_refresh_at, reason: "access_changed", observation: null } };
    return { ...base, source: {
      id: source.id, version: source.version, repository: source.repository, branch: source.branch,
      state: source.state === "current" && current.state !== "current" ? "pending" : source.state,
      last_verified_at: source.last_verified_at, next_refresh_at: source.next_refresh_at, reason: current.reason,
      observation: current.snapshot?.observation ?? null,
    } };
  }
  async event(source: RepositorySource, kind: "connected" | "observed" | "unavailable" | "disconnected", userId: string | null) {
    const head = await this.repo.statement("UPDATE project_context_heads SET sequence=sequence+1 WHERE workspace_id=? AND project_id=? RETURNING sequence", source.workspace_id, source.project_id).first<{ sequence: number }>();
    if (!head) throw conflict();
    await this.repo.statement("INSERT INTO repository_source_events(workspace_id,project_id,sequence,source_id,kind,created_by,created_at) VALUES(?,?,?,?,?,?,?)", source.workspace_id, source.project_id, head.sequence, source.id, kind, userId, this.repo.now().toISOString()).run();
  }
  /** Immutable acknowledgement; retries may return a newer view, but never repeat the mutation. */
  async mutation(userId: string, workspaceId: string, projectId: string, operation: Operation, input: unknown) {
    const value = object(input, operation === "connect" ? ["binding_key", "version", "request_id"] : ["version", "request_id"]);
    const id = requestId(value.request_id);
    const expected = operation === "connect" && value.version === 0 ? 0 : version(value.version);
    const key = operation === "connect" ? text(value.binding_key, "Binding key", 64) : null;
    const digest = hash({ operation, version: expected, binding_key: key });
    const receipt = await this.repo.db.transaction(async db => {
      const service = this.scoped(db); const repo = service.repo; const context = new ContextRepository(repo);
      await context.project(userId, workspaceId, projectId, operation !== "refresh");
      await context.lock(userId, workspaceId, projectId, operation !== "refresh", false);
      const replay = await repo.statement("SELECT * FROM repository_source_receipts WHERE workspace_id=? AND project_id=? AND request_id=?", workspaceId, projectId, id).first<Receipt>();
      if (replay) {
        if (replay.input_hash !== digest || replay.created_by !== userId || replay.operation !== operation) throw conflict();
        return replay;
      }
      const count = await repo.statement("SELECT COUNT(*) AS n FROM repository_source_receipts WHERE workspace_id=? AND project_id=?", workspaceId, projectId).first<{ n: number | string }>();
      if (Number(count?.n ?? 0) >= 2000) throw new AppError(409, "SOURCE_LIMIT", "The repository request history limit has been reached.");
      const current = await service.row(workspaceId, projectId); const now = repo.now().toISOString();
      if ((current?.version ?? 0) !== expected) throw conflict();
      if (operation === "connect") {
        const binding = service.bindings.find(b => b.workspace_id === workspaceId && b.project_id === projectId && b.key === key);
        if (!binding) throw new AppError(403, "SOURCE_NOT_APPROVED", "A repository grant must be configured for this project before connecting.");
        if (current && current.state !== "disconnected") {
          if (current.policy_hash !== bindingHash(binding)) throw conflict();
        } else {
          if (current) await repo.statement("UPDATE repository_sources SET binding_key=?,policy_hash=?,repository=?,branch=?,state='pending',reason=NULL,version=version+1,generation=generation+1,last_verified_at=NULL,next_refresh_at=?,last_started_at=NULL,lease_id=NULL,lease_until=NULL,connected_by=? WHERE id=?", binding.key, bindingHash(binding), `${binding.owner}/${binding.repository}`, binding.branch, now, userId, current.id).run();
          else await repo.statement("INSERT INTO repository_sources(id,workspace_id,project_id,binding_key,policy_hash,repository,branch,state,next_refresh_at,connected_by,created_at) VALUES(?,?,?,?,?,?,?,'pending',?,?,?)", randomUUID(), workspaceId, projectId, binding.key, bindingHash(binding), `${binding.owner}/${binding.repository}`, binding.branch, now, userId, now).run();
          const source = await service.row(workspaceId, projectId); if (!source) throw conflict();
          await service.event(source, "connected", userId);
        }
      } else if (operation === "disconnect") {
        if (!current) throw missing();
        if (current.state !== "disconnected") {
          await repo.statement("UPDATE repository_sources SET state='disconnected',reason=NULL,version=version+1,generation=generation+1,last_verified_at=NULL,lease_id=NULL,lease_until=NULL WHERE id=?", current.id).run();
          await service.event(current, "disconnected", userId);
        }
      } else {
        if (!current || !service.binding(current)) throw missing();
        if (current.state === "disconnected") throw conflict();
        if (current.state !== "syncing" && current.state !== "pending") {
          if (current.last_started_at && current.last_started_at > plus(repo.now(), -60)) throw new AppError(429, "SOURCE_REFRESH_LIMIT", "The repository was checked recently. Wait a minute before requesting another sync.");
          // A person cannot bypass GitHub's rate-limit cooldown.
          const next = current.reason === "rate_limited" && current.next_refresh_at > now ? current.next_refresh_at : now;
          await repo.statement("UPDATE repository_sources SET state='pending',next_refresh_at=? WHERE id=?", next, current.id).run();
        }
      }
      const source = await service.row(workspaceId, projectId); if (!source) throw conflict();
      const saved: Receipt = { request_id: id, operation, source_id: source.id, source_version: source.version, created_by: userId, created_at: now, input_hash: digest };
      await repo.statement("INSERT INTO repository_source_receipts(workspace_id,project_id,request_id,source_id,operation,input_hash,source_version,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)", workspaceId, projectId, id, source.id, operation, digest, source.version, userId, now).run();
      return saved;
    });
    return { ...await this.view(userId, workspaceId, projectId), receipt: { request_id: receipt.request_id, operation: receipt.operation, source_id: receipt.source_id, source_version: receipt.source_version, created_at: receipt.created_at } };
  }
  connect(userId: string, workspaceId: string, projectId: string, input: unknown) { return this.mutation(userId, workspaceId, projectId, "connect", input); }
  refresh(userId: string, workspaceId: string, projectId: string, input: unknown) { return this.mutation(userId, workspaceId, projectId, "refresh", input); }
  disconnect(userId: string, workspaceId: string, projectId: string, input: unknown) { return this.mutation(userId, workspaceId, projectId, "disconnect", input); }

  /** System authority comes from an active persisted source and the server-owned project grant. */
  async lockSystem(source: RepositorySource) {
    if (!this.binding(source)) return false;
    const project = await this.repo.statement("UPDATE projects SET version=version WHERE workspace_id=? AND id=? AND archived_at IS NULL RETURNING id", source.workspace_id, source.project_id).first();
    if (!project) return false;
    const head = await this.repo.statement("UPDATE project_context_heads SET sequence=sequence WHERE workspace_id=? AND project_id=? RETURNING sequence", source.workspace_id, source.project_id).first();
    return !!head;
  }
  async claim(): Promise<SourceClaim | null> {
    if (!this.bindings.length) return null;
    const now = this.repo.now();
    // The configured project set is bounded. Removed grants/archived projects cannot starve the queue.
    const grants = this.bindings.map(() => "(s.workspace_id=? AND s.project_id=? AND s.policy_hash=?)").join(" OR ");
    const args = this.bindings.flatMap(b => [b.workspace_id, b.project_id, bindingHash(b)]);
    const candidates = await this.repo.statement(`SELECT s.* FROM repository_sources s JOIN projects p ON p.id=s.project_id AND p.workspace_id=s.workspace_id WHERE (${grants}) AND p.archived_at IS NULL AND s.state!='disconnected' AND s.next_refresh_at<=? AND (s.lease_until IS NULL OR s.lease_until<=?) ORDER BY s.next_refresh_at,s.id LIMIT 5`, ...args, now.toISOString(), now.toISOString()).all<RepositorySource>();
    for (const candidate of candidates.results) {
      const binding = this.binding(candidate); if (!binding) continue;
      const source = await this.repo.db.transaction(async db => {
        const service = this.scoped(db); if (!await service.lockSystem(candidate)) return null;
        const started = service.repo.now();
        return service.repo.statement("UPDATE repository_sources SET state='syncing',lease_id=?,lease_until=?,last_started_at=?,generation=generation+1 WHERE id=? AND policy_hash=? AND state!='disconnected' AND next_refresh_at<=? AND (lease_until IS NULL OR lease_until<=?) RETURNING *", randomUUID(), plus(started, 60), started.toISOString(), candidate.id, candidate.policy_hash, started.toISOString(), started.toISOString()).first<RepositorySource>();
      });
      if (source) return { source, binding };
    }
    return null;
  }
  async finish(claim: SourceClaim, result: GitHubObservation | GitHubContextError): Promise<boolean> {
    const source = claim.source;
    if (!this.binding(source) || bindingHash(claim.binding) !== source.policy_hash) return false;
    return this.repo.db.transaction(async db => {
      const service = this.scoped(db); const repo = service.repo;
      if (!await service.lockSystem(source)) return false;
      const now = repo.now();
      const current = await repo.statement("SELECT * FROM repository_sources WHERE id=? AND generation=? AND lease_id=? AND lease_until>? AND state='syncing' AND policy_hash=?", source.id, source.generation, source.lease_id, now.toISOString(), source.policy_hash).first<RepositorySource>();
      if (!current) return false;
      const unavailable = async (reason: string, retryAfter: number) => {
        await repo.statement("UPDATE repository_sources SET state='unavailable',reason=?,lease_id=NULL,lease_until=NULL,next_refresh_at=? WHERE id=?", reason, plus(now, retryAfter), source.id).run();
        if (current.reason !== reason) await service.event(source, "unavailable", null);
        return true;
      };
      if (result instanceof GitHubContextError) return unavailable(result.code, result.retryAfter);
      if (result.repository_id !== claim.binding.repository_id || result.full_name.toLowerCase() !== `${claim.binding.owner}/${claim.binding.repository}`.toLowerCase() || result.branch !== claim.binding.branch || result.coverage !== "configured_files" || result.repository_mode !== "observed" || result.files.length !== claim.binding.paths.length || new Set(result.files.map(f => f.path)).size !== result.files.length || result.files.some(f => !claim.binding.paths.includes(f.path))) return unavailable("incomplete", 60);
      const encoded = JSON.stringify(result);
      if (Buffer.byteLength(encoded) > 524288) return unavailable("incomplete", 60);
      const previous = await service.currentObservation(source);
      let observation = await repo.statement("SELECT id FROM repository_observations WHERE source_id=? AND policy_hash=? AND manifest_hash=?", source.id, source.policy_hash, result.manifest_hash).first<{ id: string }>();
      if (!observation) {
        const count = await repo.statement("SELECT COUNT(*) AS n FROM repository_observations WHERE source_id=?", source.id).first<{ n: number | string }>();
        if (Number(count?.n ?? 0) >= 1000) return unavailable("history_limit", 3600);
        observation = { id: randomUUID() };
        await repo.statement("INSERT INTO repository_observations(id,workspace_id,project_id,source_id,generation,policy_hash,manifest_hash,payload,observed_at) VALUES(?,?,?,?,?,?,?,?,?)", observation.id, source.workspace_id, source.project_id, source.id, source.generation, source.policy_hash, result.manifest_hash, encoded, result.observed_at).run();
      }
      await repo.statement("INSERT INTO repository_source_heads(source_id,workspace_id,project_id,observation_id) VALUES(?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET observation_id=excluded.observation_id", source.id, source.workspace_id, source.project_id, observation.id).run();
      await repo.statement("UPDATE repository_sources SET state='current',reason=NULL,last_verified_at=?,next_refresh_at=?,lease_id=NULL,lease_until=NULL WHERE id=?", now.toISOString(), plus(now, 120), source.id).run();
      if (previous?.id !== observation.id || current.reason !== null) await service.event(source, "observed", null);
      return true;
    });
  }
}

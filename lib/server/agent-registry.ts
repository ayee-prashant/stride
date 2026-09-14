import { createHash, randomUUID } from "node:crypto";
import { AppError, identifier } from "../domain.ts";
import { AGENT_ROLES, parseAgentConfiguration, parseAgentDecision, parseAgentRegistration } from "../agents.ts";
import type { AgentBinding, AgentBindingSummary, AgentMutationResult, AgentProfile, AgentRegistry, AgentRole, AgentRoleEvent, AgentTemplate } from "../agents.ts";
import type { Database } from "./repository.ts";
import { Repository } from "./repository.ts";
import { AGENT_TEMPLATES } from "./agent-templates.generated.ts";

const missing = () => new AppError(404, "NOT_FOUND", "This agent role is unavailable.");
const conflict = (message = "This role changed. Refresh and review its current configuration.") => new AppError(409, "AGENT_CONFLICT", message);
const memberGuard = "EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=? AND m.user_id=?)";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
type StoredBinding = Omit<AgentBinding, "read_paths" | "write_paths" | "operator_available"> & { read_paths: string; write_paths: string; operator_available: number };
const bindingSelect = "SELECT b.*,p.alias,p.operator_id,p.tool_label,u.name AS operator_name,CASE WHEN m.user_id IS NULL THEN 0 ELSE 1 END AS operator_available FROM agent_role_bindings b JOIN agent_profiles p ON p.workspace_id=b.workspace_id AND p.id=b.profile_id JOIN users u ON u.id=p.operator_id LEFT JOIN memberships m ON m.workspace_id=p.workspace_id AND m.user_id=p.operator_id";

/** Human-only registration/role decisions. This service issues no agent credentials or run grants. */
export class AgentRegistryRepository {
  repo: Repository; templates: readonly AgentTemplate[];
  constructor(repo: Repository, templates: readonly AgentTemplate[] = AGENT_TEMPLATES) { this.repo = repo; this.templates = templates; }
  scoped(db: Database) { return new AgentRegistryRepository(new Repository(db, this.repo.now), this.templates); }
  template(role: string) {
    const template = this.templates.find(t => t.role_id === role);
    if (!template || !AGENT_ROLES.includes(role as AgentRole)) throw missing();
    return template;
  }
  async project(userId: string, workspaceId: string, projectId: string, admin = false) {
    const role = await this.repo.membership(userId, workspaceId, admin);
    const p = await this.repo.statement(`SELECT archived_at FROM projects WHERE workspace_id=? AND id=? AND ${memberGuard}`, workspaceId, identifier(projectId), workspaceId, userId).first<{ archived_at: string | null }>();
    if (!p) throw missing();
    return { role, archived: !!p.archived_at };
  }
  async lock(userId: string, workspaceId: string, projectId: string, operatorId: string, admin: boolean, revoke = false) {
    // Sorted membership locks serialize with demotion/removal. A workspace lock
    // protects the profile quota and aliases across concurrent project requests.
    for (const id of [...new Set([userId, operatorId])].sort()) {
      const row = await this.repo.statement(`UPDATE memberships SET role=role WHERE workspace_id=? AND user_id=? ${id === userId && admin ? "AND role='admin'" : ""} RETURNING role`, workspaceId, id).first();
      if (!row && (id === userId || !revoke)) throw conflict("The human's membership or approval authority changed.");
    }
    await this.repo.statement("UPDATE workspaces SET name=name WHERE id=?", workspaceId).run();
    const project = await this.repo.statement(`UPDATE projects SET version=version WHERE workspace_id=? AND id=? ${revoke ? "" : "AND archived_at IS NULL"} RETURNING id`, workspaceId, projectId).first();
    if (!project) throw conflict("Restore the project before changing its agent roles.");
  }
  decode(row: StoredBinding, userId: string, admin: boolean, archived: boolean): AgentBinding {
    const current = this.templates.some(t => t.role_id === row.role_id && t.hash === row.template_hash);
    const available = Number(row.operator_available) === 1;
    return {
      id: row.id, workspace_id: row.workspace_id, project_id: row.project_id, profile_id: row.profile_id,
      role_id: row.role_id, alias: row.alias, operator_id: row.operator_id, operator_name: row.operator_name,
      tool_label: row.tool_label, version: row.version, state: row.state, template_hash: row.template_hash,
      updated_at: row.updated_at, approved_by: row.approved_by, approved_at: row.approved_at,
      operator_available: available, template_current: current, connection_state: "not_connected", execution_ready: false,
      can_initialize: !archived && available && current && row.state === "pending" && row.operator_id === userId && row.version < 1000,
      can_configure: !archived && available && admin && row.version < 1000,
      can_revoke: row.state !== "revoked" && (admin || row.operator_id === userId),
      read_paths: JSON.parse(row.read_paths) as string[], write_paths: JSON.parse(row.write_paths) as string[], template_body: row.template_body,
    };
  }
  async binding(userId: string, workspaceId: string, projectId: string, bindingId: string): Promise<AgentBinding> {
    const p = await this.project(userId, workspaceId, projectId);
    const row = await this.repo.statement(`${bindingSelect} WHERE b.workspace_id=? AND b.project_id=? AND b.id=? AND ${memberGuard}`, workspaceId, projectId, identifier(bindingId), workspaceId, userId).first<StoredBinding>();
    if (!row) throw missing();
    return this.decode(row, userId, p.role === "admin", p.archived);
  }
  async list(userId: string, workspaceId: string, projectId: string, offset = 0): Promise<AgentRegistry> {
    const p = await this.project(userId, workspaceId, projectId);
    const [bindings, profiles] = await Promise.all([
      this.repo.statement(`${bindingSelect} WHERE b.workspace_id=? AND b.project_id=? AND ${memberGuard} ORDER BY b.created_at,b.id LIMIT 51 OFFSET ?`, workspaceId, projectId, workspaceId, userId, offset).all<StoredBinding>(),
      this.repo.statement(`SELECT p.*,u.name AS operator_name,CASE WHEN m.user_id IS NULL THEN 0 ELSE 1 END AS operator_available FROM agent_profiles p JOIN users u ON u.id=p.operator_id LEFT JOIN memberships m ON m.workspace_id=p.workspace_id AND m.user_id=p.operator_id WHERE p.workspace_id=? AND ${memberGuard} ORDER BY p.alias_key LIMIT 21`, workspaceId, workspaceId, userId).all<Omit<AgentProfile, "operator_available"> & { operator_available: number }>(),
    ]);
    if (profiles.results.length > 20) throw conflict("This workspace exceeds its 20-profile limit.");
    return { profiles: profiles.results.map(row => ({ id: row.id, workspace_id: row.workspace_id, alias: row.alias, operator_id: row.operator_id, operator_name: row.operator_name, tool_label: row.tool_label, created_by: row.created_by, created_at: row.created_at, operator_available: Number(row.operator_available) === 1 })),
      bindings: bindings.results.slice(0, 50).map(row => { const full = this.decode(row, userId, p.role === "admin", p.archived); const summary: Partial<AgentBinding> = { ...full }; delete summary.read_paths; delete summary.write_paths; delete summary.template_body; return summary as AgentBindingSummary; }),
      can_register: p.role === "admin" && !p.archived, has_more: bindings.results.length > 50, next_offset: offset + 50, project_archived: p.archived };
  }
  async replay(userId: string, workspaceId: string, projectId: string, requestId: string, digest: string): Promise<AgentMutationResult | null> {
    const row = await this.repo.statement("SELECT id,binding_id,actor_id,input_hash FROM agent_role_events WHERE workspace_id=? AND project_id=? AND request_id=?", workspaceId, projectId, requestId).first<{ id: string; binding_id: string; actor_id: string; input_hash: string }>();
    if (!row) return null;
    if (row.actor_id !== userId || row.input_hash !== digest) throw conflict("This request identifier was used for a different decision.");
    // Return current state, never revive an earlier initialized state after revocation.
    return { binding: await this.binding(userId, workspaceId, projectId, row.binding_id), event_id: row.id, replayed: true };
  }
  async event(userId: string, binding: AgentBinding, action: AgentRoleEvent["action"], reason: string, requestId: string, digest: string) {
    const id = randomUUID();
    const snapshot: AgentRoleEvent["snapshot"] = { role_id: binding.role_id, state: binding.state, template_hash: binding.template_hash, template_body: binding.template_body, read_paths: binding.read_paths, write_paths: binding.write_paths, approved_by: binding.approved_by, approved_at: binding.approved_at };
    const payload = JSON.stringify(snapshot);
    if (Buffer.byteLength(payload) > 65_536) throw conflict("This role snapshot is too large.");
    await this.repo.statement("INSERT INTO agent_role_events(id,workspace_id,project_id,binding_id,version,action,actor_kind,actor_id,created_at,reason,request_id,input_hash,snapshot) VALUES(?,?,?,?,?,?,'human',?,?,?,?,?,?)", id, binding.workspace_id, binding.project_id, binding.id, binding.version, action, userId, binding.updated_at, reason, requestId, digest, payload).run();
    return { binding, event_id: id, replayed: false };
  }
  async register(userId: string, workspaceId: string, projectId: string, input: unknown): Promise<AgentMutationResult> {
    const v = parseAgentRegistration(input); const digest = hash({ action: "register", value: v });
    await this.project(userId, workspaceId, projectId, true);
    const existing = "id" in v.profile ? await this.repo.statement("SELECT id,operator_id FROM agent_profiles WHERE workspace_id=? AND id=?", workspaceId, v.profile.id).first<{ id: string; operator_id: string }>() : null;
    if ("id" in v.profile && !existing) throw missing();
    const operatorId = existing?.operator_id ?? ("operator_id" in v.profile ? v.profile.operator_id : "");
    return this.repo.db.transaction(async db => {
      const s = this.scoped(db); const repo = s.repo;
      await s.lock(userId, workspaceId, projectId, operatorId, true);
      const replay = await s.replay(userId, workspaceId, projectId, v.request_id, digest); if (replay) return replay;
      const template = s.template(v.role_id);
      if (template.hash !== v.template_hash) throw conflict("The role template changed. Review the current prompt.");
      const count = await repo.statement("SELECT COUNT(*) AS n FROM agent_role_bindings WHERE workspace_id=? AND project_id=?", workspaceId, projectId).first<{ n: number | string }>();
      if (Number(count?.n ?? 0) >= 200) throw conflict("A project supports up to 200 role bindings.");
      const now = repo.now().toISOString(); const profileId = existing?.id ?? randomUUID();
      if ("alias" in v.profile) {
        const aliasKey = v.profile.alias.normalize("NFKC").toLocaleLowerCase("en-US");
        if (aliasKey.length > 60) throw conflict("Use a shorter agent alias.");
        const profiles = await repo.statement("SELECT id,alias_key FROM agent_profiles WHERE workspace_id=? LIMIT 21", workspaceId).all<{ id: string; alias_key: string }>();
        if (profiles.results.some(p => p.alias_key === aliasKey)) throw conflict("This alias already identifies a profile. Select that existing profile.");
        if (profiles.results.length >= 20) throw conflict("This workspace has reached its 20-profile limit. Reuse an existing profile.");
        await repo.statement("INSERT INTO agent_profiles(id,workspace_id,alias,alias_key,operator_id,tool_label,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)", profileId, workspaceId, v.profile.alias, aliasKey, operatorId, v.profile.tool_label, userId, now).run();
      }
      const duplicate = await repo.statement("SELECT id FROM agent_role_bindings WHERE workspace_id=? AND project_id=? AND profile_id=? AND role_id=?", workspaceId, projectId, profileId, v.role_id).first();
      if (duplicate) throw conflict("This profile already has that role in the project. Review or revise its existing configuration.");
      const id = randomUUID();
      await repo.statement("INSERT INTO agent_role_bindings(id,workspace_id,project_id,profile_id,role_id,version,state,read_paths,write_paths,template_hash,template_body,created_at,updated_at) VALUES(?,?,?,?,?,1,'pending',?,?,?,?,?,?)", id, workspaceId, projectId, profileId, v.role_id, JSON.stringify(v.read_paths), JSON.stringify(v.write_paths), template.hash, template.body, now, now).run();
      return s.event(userId, await s.binding(userId, workspaceId, projectId, id), "registered", v.reason, v.request_id, digest);
    });
  }
  async mutate(userId: string, workspaceId: string, projectId: string, bindingId: string, action: "configure" | "initialize" | "revoke", input: unknown): Promise<AgentMutationResult> {
    const configuration = action === "configure" ? parseAgentConfiguration(input) : null;
    const v = configuration ?? parseAgentDecision(input, action === "initialize");
    const digest = hash({ action, binding_id: bindingId, value: v });
    const initial = await this.binding(userId, workspaceId, projectId, bindingId);
    if (action === "configure") await this.project(userId, workspaceId, projectId, true);
    if (action === "initialize" && initial.operator_id !== userId) throw new AppError(403, "OPERATOR_REQUIRED", "Only the named human operator can accept this role.");
    if (action === "revoke" && initial.operator_id !== userId) await this.project(userId, workspaceId, projectId, true);
    return this.repo.db.transaction(async db => {
      const s = this.scoped(db); const repo = s.repo;
      await s.lock(userId, workspaceId, projectId, initial.operator_id, action === "configure" || (action === "revoke" && initial.operator_id !== userId), action === "revoke");
      const replay = await s.replay(userId, workspaceId, projectId, v.request_id, digest); if (replay) return replay;
      const current = await s.binding(userId, workspaceId, projectId, bindingId);
      if (current.version !== v.expected_version) throw conflict();
      if (current.version >= 1000 && action !== "revoke") throw conflict("This role has reached its revision limit. Revocation remains available.");
      const template = s.template(current.role_id);
      let state = current.state; let reads = current.read_paths; let writes = current.write_paths; let prompt = current.template_body; let promptHash = current.template_hash;
      let approver: string | null = null; let approvedAt: string | null = null; const now = repo.now().toISOString();
      if (action === "configure" && configuration) {
        if (configuration.template_hash !== template.hash) throw conflict("Review the current role template before configuring it.");
        state = "pending"; reads = configuration.read_paths; writes = configuration.write_paths; prompt = template.body; promptHash = template.hash;
      } else if (action === "initialize") {
        if (current.state !== "pending" || !current.template_current || v.template_hash !== current.template_hash) throw conflict("Review a current pending role before accepting it.");
        state = "initialized"; approver = userId; approvedAt = now;
      } else if (action === "revoke") {
        if (current.state === "revoked") throw conflict("This role is already revoked.");
        state = "revoked";
      }
      const row = await repo.statement("UPDATE agent_role_bindings SET version=version+1,state=?,read_paths=?,write_paths=?,template_hash=?,template_body=?,approved_by=?,approved_at=?,updated_at=? WHERE workspace_id=? AND project_id=? AND id=? AND version=? RETURNING id", state, JSON.stringify(reads), JSON.stringify(writes), promptHash, prompt, approver, approvedAt, now, workspaceId, projectId, bindingId, current.version).first();
      if (!row) throw conflict();
      return s.event(userId, await s.binding(userId, workspaceId, projectId, bindingId), action === "configure" ? "configured" : action === "initialize" ? "initialized" : "revoked", v.reason, v.request_id, digest);
    });
  }
  async history(userId: string, workspaceId: string, projectId: string, bindingId: string, before = 0) {
    await this.binding(userId, workspaceId, projectId, bindingId);
    const rows = await this.repo.statement(`SELECT id,binding_id,version,action,actor_kind,actor_id,created_at,reason,snapshot FROM agent_role_events WHERE workspace_id=? AND project_id=? AND binding_id=? AND (?=0 OR version<?) AND ${memberGuard} ORDER BY version DESC LIMIT 21`, workspaceId, projectId, bindingId, before, before, workspaceId, userId).all<Omit<AgentRoleEvent, "snapshot"> & { snapshot: string }>();
    return { events: rows.results.slice(0, 20).map(row => ({ ...row, snapshot: JSON.parse(row.snapshot) as AgentRoleEvent["snapshot"] })), next_before: rows.results.length > 20 ? rows.results[19].version : null };
  }
}

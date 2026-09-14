import { createHash, randomUUID } from "node:crypto";
import { AppError, identifier } from "../domain.ts";
import type { Task } from "../domain.ts";
import { parseContextPublish, parseTaskBrief } from "../context.ts";
import type { BriefCheck, ContextRevision, ProjectBrief, TaskBrief, TaskBriefPayload, TaskBriefResult } from "../context.ts";
import { Repository } from "./repository.ts";
import type { Database } from "./repository.ts";
import type { GitHubBinding } from "../github-context.ts";
import { readSourceContext } from "./repository-source-context.ts";

const missing = () => new AppError(404, "NOT_FOUND", "This project context is unavailable.");
const conflict = (message = "The context changed. Reload the latest version before publishing.") => new AppError(409, "CONTEXT_CONFLICT", message);
const memberGuard = "EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=? AND m.user_id=?)";
const adminGuard = "EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=? AND m.user_id=? AND m.role='admin')";
const revisionColumns = "r.document_id,r.workspace_id,r.project_id,r.version,d.kind,r.title,r.body,r.state,r.change_note,r.approved_by,r.approved_at";
const revisionSelect = `SELECT ${revisionColumns} FROM context_revisions r JOIN context_documents d ON d.id=r.document_id AND d.workspace_id=r.workspace_id AND d.project_id=r.project_id`;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function revisionValue(r: ContextRevision): ContextRevision {
  return { document_id: r.document_id, workspace_id: r.workspace_id, project_id: r.project_id, version: r.version,
    kind: r.kind, title: r.title, body: r.body, state: r.state, change_note: r.change_note,
    approved_by: r.approved_by, approved_at: r.approved_at };
}
const taskContent = (task: Task) => ({ id: task.id, project_id: task.project_id, title: task.title, description: task.description });
const manifest = (docs: ContextRevision[]) => docs.map(d => ({ id: d.document_id, version: d.version })).sort((a, b) => a.id.localeCompare(b.id));
type StoredBrief = Omit<TaskBrief, "payload"> & { payload: string; input_hash: string; task_hash: string };
function decodeBrief(row: StoredBrief): TaskBrief {
  return { id: row.id, workspace_id: row.workspace_id, project_id: row.project_id, task_id: row.task_id,
    context_sequence: row.context_sequence, task_version: row.task_version, fingerprint: row.fingerprint,
    payload: JSON.parse(row.payload) as TaskBriefPayload, created_by: row.created_by, created_at: row.created_at };
}

/** Human-authenticated context authority. Agent proposals must use a separate actor boundary. */
export class ContextRepository {
  repo: Repository; bindings: GitHubBinding[];
  constructor(repo: Repository, bindings: GitHubBinding[] = []) { this.repo = repo; this.bindings = bindings; }
  scoped(db: Database) { return new ContextRepository(new Repository(db, this.repo.now), this.bindings); }

  async project(userId: string, workspaceId: string, projectId: string, write = false) {
    const role = await this.repo.membership(userId, workspaceId, write);
    const project = await this.repo.statement(`SELECT id,archived_at FROM projects WHERE workspace_id=? AND id=? AND ${memberGuard}`, workspaceId, identifier(projectId), workspaceId, userId).first<{ id: string; archived_at: string | null }>();
    if (!project) throw missing();
    if (write && project.archived_at) throw conflict("Restore the project before publishing context.");
    return { project, role };
  }

  /** Every context mutation for a project takes this row lock, including packet creation.
   * The persisted sequence is allocated in commit order, so cursors cannot skip late commits.
   */
  async lock(userId: string, workspaceId: string, projectId: string, admin: boolean, advance: boolean) {
    const guard = admin ? adminGuard : memberGuard;
    // Serialize permission revocation and project archival against the publication.
    // Keep this lock order: membership, project, context head, then task.
    const membership = await this.repo.statement(`UPDATE memberships SET role=role WHERE workspace_id=? AND user_id=? ${admin ? "AND role='admin'" : ""} RETURNING role`, workspaceId, userId).first();
    if (!membership) throw conflict("Your project access changed. Refresh before continuing.");
    const project = await this.repo.statement("UPDATE projects SET version=version WHERE workspace_id=? AND id=? AND archived_at IS NULL RETURNING id", workspaceId, projectId).first();
    if (!project) throw conflict("The project is unavailable for changes.");
    await this.repo.statement(`INSERT INTO project_context_heads(project_id,workspace_id,sequence) SELECT ?,?,0 WHERE ${guard} AND EXISTS(SELECT 1 FROM projects WHERE workspace_id=? AND id=? AND archived_at IS NULL) ON CONFLICT(project_id) DO NOTHING`, projectId, workspaceId, workspaceId, userId, workspaceId, projectId).run();
    const row = await this.repo.statement(`UPDATE project_context_heads SET sequence=sequence+? WHERE workspace_id=? AND project_id=? AND ${guard} AND EXISTS(SELECT 1 FROM projects WHERE workspace_id=? AND id=? AND archived_at IS NULL) RETURNING sequence`, advance ? 1 : 0, workspaceId, projectId, workspaceId, userId, workspaceId, projectId).first<{ sequence: number }>();
    if (!row) throw conflict("Your access or the project changed. Refresh before continuing.");
    return row.sequence;
  }

  async currentDocuments(userId: string, workspaceId: string, projectId: string) {
    const result = await this.repo.statement(`${revisionSelect} WHERE r.workspace_id=? AND r.project_id=? AND r.version=d.current_version AND ${memberGuard} ORDER BY d.id LIMIT 201`, workspaceId, projectId, workspaceId, userId).all<ContextRevision>();
    if (result.results.length > 200) throw new AppError(409, "CONTEXT_LIMIT", "This project exceeds the context document limit.");
    return result.results.map(revisionValue);
  }

  async brief(userId: string, workspaceId: string, projectId: string): Promise<ProjectBrief> {
    const { role, project } = await this.project(userId, workspaceId, projectId);
    // One SQL statement keeps the document list and its watermark in the same DB snapshot.
    const rows = await this.repo.statement(`SELECT ${revisionColumns},h.sequence FROM project_context_heads h LEFT JOIN context_documents d ON d.project_id=h.project_id AND d.workspace_id=h.workspace_id LEFT JOIN context_revisions r ON r.document_id=d.id AND r.workspace_id=d.workspace_id AND r.project_id=d.project_id AND r.version=d.current_version WHERE h.workspace_id=? AND h.project_id=? AND ${memberGuard} ORDER BY d.id LIMIT 201`, workspaceId, projectId, workspaceId, userId).all<ContextRevision & { sequence: number }>();
    if (rows.results.length > 200) throw new AppError(409, "CONTEXT_LIMIT", "This project exceeds the context document limit.");
    const documents = rows.results.filter(r => r.document_id).map(revisionValue);
    return { sequence: rows.results[0]?.sequence ?? 0, documents, can_publish: role === "admin" && !project.archived_at };
  }

  async publish(userId: string, workspaceId: string, projectId: string, input: unknown): Promise<ContextRevision> {
    const value = parseContextPublish(input); const digest = hash(value);
    await this.project(userId, workspaceId, projectId, true);
    return this.repo.db.transaction(async db => {
      const service = this.scoped(db); const repo = service.repo;
      await service.lock(userId, workspaceId, projectId, true, false);
      const replay = await repo.statement(`${revisionSelect} WHERE r.workspace_id=? AND r.project_id=? AND r.request_id=?`, workspaceId, projectId, value.request_id).first<ContextRevision & { input_hash: string }>();
      if (replay) {
        const saved = await repo.statement("SELECT input_hash FROM context_revisions WHERE document_id=? AND version=?", replay.document_id, replay.version).first<{ input_hash: string }>();
        if (saved?.input_hash !== digest || replay.approved_by !== userId) throw conflict("This request identifier was already used for another publication.");
        return revisionValue(replay);
      }
      const documents = await service.currentDocuments(userId, workspaceId, projectId);
      const current = value.document_id ? documents.find(d => d.document_id === value.document_id) : null;
      if (value.document_id && !current) throw missing();
      if (current && (current.version !== value.expected_version || current.kind !== value.kind)) throw conflict();
      if (!current && documents.length >= 200) throw new AppError(409, "CONTEXT_LIMIT", "A project supports up to 200 context documents. Update an existing document.");
      if (current && current.version >= 500) throw new AppError(409, "CONTEXT_LIMIT", "This document reached its revision limit.");
      if (value.state === "active" && documents.some(d => d.document_id !== value.document_id && d.kind === value.kind && d.state === "active" && d.title.toLocaleLowerCase("en-US") === value.title.toLocaleLowerCase("en-US"))) throw conflict("An active document already has this title. Review it before creating overlapping requirements.");
      const sequence = await service.lock(userId, workspaceId, projectId, true, true);
      const id = current?.document_id ?? randomUUID(); const version = value.expected_version + 1; const now = repo.now().toISOString();
      if (!current) await repo.statement("INSERT INTO context_documents(id,workspace_id,project_id,kind,current_version,created_at) VALUES(?,?,?,?,?,?)", id, workspaceId, projectId, value.kind, version, now).run();
      else {
        const updated = await repo.statement("UPDATE context_documents SET current_version=? WHERE workspace_id=? AND project_id=? AND id=? AND current_version=? RETURNING id", version, workspaceId, projectId, id, value.expected_version).first();
        if (!updated) throw conflict();
      }
      await repo.statement("INSERT INTO context_revisions(document_id,workspace_id,project_id,version,title,body,state,change_note,approved_by,approved_at,request_id,input_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", id, workspaceId, projectId, version, value.title, value.body, value.state, value.change_note, userId, now, value.request_id, digest).run();
      await repo.statement("INSERT INTO context_events(workspace_id,project_id,sequence,document_id,document_version,created_by,created_at) VALUES(?,?,?,?,?,?,?)", workspaceId, projectId, sequence, id, version, userId, now).run();
      return { document_id: id, workspace_id: workspaceId, project_id: projectId, version, kind: value.kind, title: value.title, body: value.body, state: value.state, change_note: value.change_note, approved_by: userId, approved_at: now };
    });
  }

  async history(userId: string, workspaceId: string, projectId: string, documentId: string, before = 0) {
    await this.project(userId, workspaceId, projectId);
    const rows = await this.repo.statement(`${revisionSelect} WHERE r.workspace_id=? AND r.project_id=? AND r.document_id=? AND (?=0 OR r.version<?) AND ${memberGuard} ORDER BY r.version DESC LIMIT 21`, workspaceId, projectId, identifier(documentId), before, before, workspaceId, userId).all<ContextRevision>();
    return { revisions: rows.results.slice(0, 20).map(revisionValue), next_before: rows.results.length > 20 ? rows.results[19].version : null };
  }

  async changes(userId: string, workspaceId: string, projectId: string, after: number) {
    await this.project(userId, workspaceId, projectId);
    const head = await this.repo.statement(`SELECT sequence FROM project_context_heads WHERE workspace_id=? AND project_id=? AND ${memberGuard}`, workspaceId, projectId, workspaceId, userId).first<{ sequence: number }>();
    if (after > (head?.sequence ?? 0)) throw new AppError(409, "CONTEXT_RESYNC_REQUIRED", "This cursor is ahead of the project. Reload its current brief before resuming changes.");
    const rows = await this.repo.statement(`SELECT * FROM (
      SELECT sequence,'document_published' AS kind,document_id,document_version,NULL AS source_id,created_by,created_at FROM context_events WHERE workspace_id=? AND project_id=? AND sequence>? AND ${memberGuard}
      UNION ALL
      SELECT sequence,kind,NULL AS document_id,NULL AS document_version,source_id,created_by,created_at FROM repository_source_events WHERE workspace_id=? AND project_id=? AND sequence>? AND ${memberGuard}
    ) events ORDER BY sequence LIMIT 101`, workspaceId, projectId, after, workspaceId, userId, workspaceId, projectId, after, workspaceId, userId)
      .all<{ sequence: number; kind: string; document_id: string | null; document_version: number | null; source_id: string | null; created_by: string | null; created_at: string }>();
    const events = rows.results.slice(0, 100);
    return { events, next_cursor: events.at(-1)?.sequence ?? after, has_more: rows.results.length > 100 };
  }

  async createTaskBrief(userId: string, workspaceId: string, taskId: string, input: unknown): Promise<TaskBriefResult> {
    const value = parseTaskBrief(input); const digest = hash(value);
    const initial = await this.repo.task(userId, workspaceId, taskId);
    return this.repo.db.transaction(async db => {
      const service = this.scoped(db); const repo = service.repo;
      const sequence = await service.lock(userId, workspaceId, initial.project_id, false, false);
      // Locking the task also serializes against ordinary edits. This does not change its version.
      const locked = await repo.statement(`UPDATE tasks SET version=version WHERE workspace_id=? AND id=? AND archived_at IS NULL AND ${memberGuard} RETURNING id`, workspaceId, taskId, workspaceId, userId).first();
      if (!locked) throw missing();
      const task = await repo.task(userId, workspaceId, taskId);
      const replay = await repo.statement("SELECT * FROM task_context_briefs WHERE workspace_id=? AND task_id=? AND request_id=?", workspaceId, taskId, value.request_id).first<StoredBrief>();
      if (replay) {
        if (replay.input_hash !== digest || replay.created_by !== userId) throw conflict("This request identifier was already used for a different brief.");
        return service.result(userId, workspaceId, task, decodeBrief(replay));
      }
      if (task.version !== value.task_version || sequence !== value.context_sequence) throw conflict("The task or project context changed. Refresh and review before preparing the brief.");
      if (task.status === "done") throw conflict("Reopen the task before preparing a new brief.");
      const documents = (await service.currentDocuments(userId, workspaceId, task.project_id)).filter(d => d.state === "active");
      for (const id of value.requirement_ids) if (!documents.some(d => d.document_id === id && d.kind === "requirement")) throw new AppError(400, "REQUIREMENT_UNAVAILABLE", "Select active requirements from this project.");
      const selected = documents.filter(d => d.kind !== "requirement" || value.requirement_ids.includes(d.document_id));
      const source = await readSourceContext(repo, service.bindings, userId, workspaceId, task.project_id);
      if (source.state === "unavailable") throw new AppError(409, "SOURCE_NOT_CURRENT", "Repository context is not verified and current. Wait for a successful sync before preparing the brief.");
      const payload: TaskBriefPayload = { format: "stride-task-brief/1", task: taskContent(task), documents: selected,
        source_coverage: { github: source.snapshot ? "verified" : "not_connected" }, ...(source.snapshot ? { repository: source.snapshot } : {}) };
      // Bound both the number of snapshots and their UTF-8 size before storing or returning one.
      const encoded = JSON.stringify(payload);
      if (Buffer.byteLength(encoded, "utf8") > 131_072) throw new AppError(409, "BRIEF_TOO_LARGE", "The brief exceeds 128 KiB. Shorten project decisions or split the task requirements.");
      const count = await repo.statement("SELECT COUNT(*) AS n FROM task_context_briefs WHERE workspace_id=? AND task_id=?", workspaceId, taskId).first<{ n: number | string }>();
      if (Number(count?.n ?? 0) >= 200) throw new AppError(409, "CONTEXT_LIMIT", "This task reached its brief history limit.");
      const id = randomUUID(); const now = repo.now().toISOString();
      const fingerprint = hash({ format: payload.format, workspace_id: workspaceId, task: payload.task, documents: manifest(selected), repository: source.snapshot ? { source_id: source.snapshot.source_id, policy_hash: source.snapshot.policy_hash, manifest_hash: source.snapshot.observation.manifest_hash } : null });
      await repo.statement("INSERT INTO task_context_briefs(id,workspace_id,project_id,task_id,context_sequence,task_version,fingerprint,payload,task_hash,created_by,created_at,request_id,input_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", id, workspaceId, task.project_id, taskId, sequence, task.version, fingerprint, encoded, hash(payload.task), userId, now, value.request_id, digest).run();
      await repo.statement("INSERT INTO task_context_bindings(task_id,workspace_id,project_id,brief_id) VALUES(?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET brief_id=excluded.brief_id", taskId, workspaceId, task.project_id, id).run();
      return { brief: { id, workspace_id: workspaceId, project_id: task.project_id, task_id: taskId, context_sequence: sequence, task_version: task.version, fingerprint, payload, created_by: userId, created_at: now }, check: { state: "current", reasons: [], execution_ready: false } };
    });
  }

  async check(userId: string, workspaceId: string, task: Task, brief: TaskBrief, source?: Awaited<ReturnType<typeof readSourceContext>>): Promise<BriefCheck> {
    const { project } = await this.project(userId, workspaceId, task.project_id);
    if (project.archived_at || task.archived_at || task.status === "done") return { state: "unavailable", reasons: ["The task or project is archived, or the task is complete."], execution_ready: false };
    const documents = await this.currentDocuments(userId, workspaceId, task.project_id);
    const required = new Set(brief.payload.documents.filter(d => d.kind === "requirement").map(d => d.document_id));
    const selected = documents.filter(d => d.state === "active" && (d.kind !== "requirement" || required.has(d.document_id)));
    const reasons: string[] = [];
    if (hash(taskContent(task)) !== hash(brief.payload.task)) reasons.push("The task title or description changed.");
    if (hash(manifest(selected)) !== hash(manifest(brief.payload.documents))) reasons.push("A linked requirement or project-wide decision or constraint changed.");
    const repository = source ?? await readSourceContext(this.repo, this.bindings, userId, workspaceId, task.project_id);
    if (repository.state === "unavailable") return { state: "unavailable", reasons: [...reasons, "Repository context is not verified and current. Wait for a successful sync."], execution_ready: false };
    if (brief.payload.repository?.observation.manifest_hash !== repository.snapshot?.observation.manifest_hash || brief.payload.repository?.policy_hash !== repository.snapshot?.policy_hash) reasons.push("The repository connection or commit changed. Review a new brief.");
    return { state: reasons.length ? "stale" : "current", reasons, execution_ready: false };
  }

  async result(userId: string, workspaceId: string, task: Task, brief: TaskBrief): Promise<TaskBriefResult> {
    const source = await readSourceContext(this.repo, this.bindings, userId, workspaceId, task.project_id);
    const bound = brief.payload.repository;
    // Never disclose historical private files while their current grant or access is unavailable.
    // Preserve the immutable stored packet; withholding it does not rewrite its fingerprint.
    if (bound && (!source.snapshot || bound.source_id !== source.snapshot.source_id || bound.policy_hash !== source.snapshot.policy_hash)) {
      return { brief: null, check: { state: "unavailable", reasons: ["This brief contains repository files whose current access cannot be verified. Restore the source connection and sync before reading it."], execution_ready: false } };
    }
    return { brief, check: await this.check(userId, workspaceId, task, brief, source) };
  }

  async taskBrief(userId: string, workspaceId: string, taskId: string, briefId?: string): Promise<TaskBriefResult> {
    const task = await this.repo.task(userId, workspaceId, taskId);
    const row = briefId
      ? await this.repo.statement(`SELECT b.* FROM task_context_briefs b WHERE b.workspace_id=? AND b.task_id=? AND b.id=? AND ${memberGuard}`, workspaceId, taskId, identifier(briefId), workspaceId, userId).first<StoredBrief>()
      : await this.repo.statement(`SELECT b.* FROM task_context_briefs b JOIN task_context_bindings t ON t.brief_id=b.id AND t.workspace_id=b.workspace_id AND t.task_id=b.task_id AND t.project_id=b.project_id WHERE b.workspace_id=? AND b.task_id=? AND ${memberGuard}`, workspaceId, taskId, workspaceId, userId).first<StoredBrief>();
    if (!row) { if (briefId) throw missing(); return { brief: null, check: null }; }
    const brief = decodeBrief(row);
    return this.result(userId, workspaceId, task, brief);
  }
}

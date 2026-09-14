import { AppError, identifier, parseMember, parseProject, parseProjectPatch, parseTaskCreate, parseTaskPatch } from "../domain.ts";
import type { Activity, Identity, Member, Project, Role, Task, TaskQuery, Workspace } from "../domain.ts";

export type SqlValue = string | number | null;
export interface SqlResult<T = Record<string, unknown>> { results: T[]; meta: { changes: number } }
export interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface Database { prepare(query: string): Statement; batch<T = Record<string, unknown>>(statements: Statement[]): Promise<SqlResult<T>[]> }

const missing = () => new AppError(404, "NOT_FOUND", "The item is unavailable or you do not have access.");
const conflict = () => new AppError(409, "CONFLICT", "This item changed. Refresh it before saving again.");
const memberGuard = "EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = ? AND m.user_id = ?)";
const adminGuard = "EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = ? AND m.user_id = ? AND m.role = 'admin')";
const taskSelect = "SELECT t.*, p.name AS project_name, u.name AS assignee_name FROM tasks t JOIN projects p ON p.id=t.project_id AND p.workspace_id=t.workspace_id LEFT JOIN users u ON u.id=t.assignee_id";

/** SQL and application operations are isolated from HTTP and the host runtime. */
export class Repository {
  db: Database;
  constructor(db: Database) { this.db = db; }
  statement(query: string, ...values: SqlValue[]) { return this.db.prepare(query).bind(...values); }
  async membership(userId: string, workspaceId: string, admin = false): Promise<Role> {
    const row = await this.statement("SELECT role FROM memberships WHERE workspace_id=? AND user_id=?", identifier(workspaceId), userId).first<{ role: Role }>();
    if (!row) throw missing();
    if (admin && row.role !== "admin") throw new AppError(403, "FORBIDDEN", "Only a workspace admin can do this.");
    return row.role;
  }
  async bootstrap(user: Identity) {
    const now = new Date().toISOString(); const workspaceId = `ws_${user.userId}`;
    await this.db.batch([
      this.statement("INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name", user.userId, user.email.toLowerCase(), user.displayName, now),
      this.statement("INSERT INTO workspaces(id,name,owner_id,created_at) VALUES(?,?,?,?) ON CONFLICT(owner_id) DO NOTHING", workspaceId, `${user.displayName.split("@")[0].slice(0, 40)}’s workspace`, user.userId, now),
      this.statement("INSERT INTO memberships(workspace_id,user_id,role) SELECT id,?,'admin' FROM workspaces WHERE owner_id=? ON CONFLICT(workspace_id,user_id) DO NOTHING", user.userId, user.userId),
      this.statement("INSERT INTO projects(id,workspace_id,name,description,created_at,updated_at) SELECT ?,id,'First sprint','',?,? FROM workspaces WHERE owner_id=? ON CONFLICT(id) DO NOTHING", `project_${user.userId}`, now, now, user.userId),
    ]);
    const result = await this.statement("SELECT w.*,m.role FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY (w.owner_id=?) DESC,w.created_at LIMIT 50", user.userId, user.userId).all<Workspace>();
    return { user, workspaces: result.results };
  }
  async metadata(userId: string, workspaceId: string) {
    const role = await this.membership(userId, workspaceId);
    const [projects, members] = await Promise.all([
      this.statement(`SELECT * FROM projects WHERE workspace_id=? AND ${memberGuard} ORDER BY (archived_at IS NOT NULL),created_at LIMIT 101`, workspaceId, workspaceId, userId).all<Project>(),
      this.statement(`SELECT m.user_id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND ${memberGuard} ORDER BY u.name LIMIT 201`, workspaceId, workspaceId, userId).all<Member>(),
    ]);
    return { role, projects: projects.results, members: members.results };
  }
  async createProject(userId: string, workspaceId: string, input: unknown): Promise<Project> {
    await this.membership(userId, workspaceId, true); const value = parseProject(input); const now = new Date().toISOString();
    const row = await this.statement(`INSERT INTO projects(id,workspace_id,name,description,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE ${adminGuard} AND (SELECT COUNT(*) FROM projects WHERE workspace_id=?) < 100 RETURNING *`, crypto.randomUUID(), workspaceId, value.name, value.description, now, now, workspaceId, userId, workspaceId).first<Project>();
    if (!row) throw new AppError(409, "PROJECT_LIMIT", "The workspace is unavailable or has reached its 100-project limit.");
    return row;
  }
  async updateProject(userId: string, workspaceId: string, projectId: string, input: unknown): Promise<Project> {
    await this.membership(userId, workspaceId, true); const patch = parseProjectPatch(input);
    const current = await this.statement("SELECT * FROM projects WHERE workspace_id=? AND id=?", workspaceId, identifier(projectId)).first<Project>();
    if (!current) throw missing(); if (current.version !== patch.version) throw conflict();
    const now = new Date().toISOString();
    const row = await this.statement(`UPDATE projects SET name=?,description=?,archived_at=?,version=version+1,updated_at=? WHERE workspace_id=? AND id=? AND version=? AND ${adminGuard} RETURNING *`, patch.name ?? current.name, patch.description ?? current.description, patch.archived === undefined ? current.archived_at : patch.archived ? now : null, now, workspaceId, projectId, patch.version, workspaceId, userId).first<Project>();
    if (!row) throw conflict(); return row;
  }
  async addMember(userId: string, workspaceId: string, input: unknown) {
    await this.membership(userId, workspaceId, true); const value = parseMember(input);
    const target = await this.statement("SELECT id FROM users WHERE email=?", value.email).first<{ id: string }>();
    if (!target) throw new AppError(400, "MEMBER_UNAVAILABLE", "That person must have Site access and sign in once before being added.");
    const owner = await this.statement("SELECT owner_id FROM workspaces WHERE id=?", workspaceId).first<{ owner_id: string }>();
    if (owner?.owner_id === target.id) throw new AppError(400, "OWNER_PROTECTED", "The workspace owner's role cannot be changed.");
    const result = await this.statement(`INSERT INTO memberships(workspace_id,user_id,role) SELECT ?,?,? WHERE ${adminGuard} AND (EXISTS(SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?) OR ((SELECT COUNT(*) FROM memberships WHERE workspace_id=?) < 200 AND (SELECT COUNT(*) FROM memberships WHERE user_id=?) < 50)) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role`, workspaceId, target.id, value.role, workspaceId, userId, workspaceId, target.id, workspaceId, target.id).run();
    if (!result.meta.changes) throw new AppError(409, "MEMBER_LIMIT", "A membership limit was reached or your access changed.");
    return { user_id: target.id, role: value.role };
  }
  async task(userId: string, workspaceId: string, taskId: string): Promise<Task> {
    await this.membership(userId, workspaceId);
    const row = await this.statement(`${taskSelect} WHERE t.workspace_id=? AND t.id=? AND ${memberGuard}`, workspaceId, identifier(taskId), workspaceId, userId).first<Task>();
    if (!row) throw missing(); return row;
  }
  async listTasks(userId: string, workspaceId: string, query: TaskQuery) {
    await this.membership(userId, workspaceId);
    const conditions = ["t.workspace_id=?", "p.archived_at IS NULL", query.archived ? "t.archived_at IS NOT NULL" : "t.archived_at IS NULL", memberGuard];
    const values: SqlValue[] = [workspaceId, workspaceId, userId];
    if (query.project_id) { conditions.push("t.project_id=?"); values.push(query.project_id); }
    if (query.assignee_id === "unassigned") conditions.push("t.assignee_id IS NULL");
    else if (query.assignee_id) { conditions.push("t.assignee_id=?"); values.push(query.assignee_id); }
    if (query.priority) { conditions.push("t.priority=?"); values.push(query.priority); }
    if (query.status) { conditions.push("t.status=?"); values.push(query.status); }
    else if (!query.include_done) conditions.push("t.status!='done'");
    if (query.query) { conditions.push("instr(lower(t.title),lower(?))>0"); values.push(query.query); }
    const result = await this.statement(`${taskSelect} WHERE ${conditions.join(" AND ")} ORDER BY (t.status='done'),(t.due_date IS NULL),t.due_date,CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,t.id LIMIT ? OFFSET ?`, ...values, query.limit + 1, query.offset).all<Task>();
    return { tasks: result.results.slice(0, query.limit), hasMore: result.results.length > query.limit, nextOffset: query.offset + query.limit };
  }
  event(id: string, workspaceId: string, taskId: string, actor: string, action: string, time: string) {
    // The mutation token prevents a failed/stale edit from emitting an audit event.
    return this.statement("INSERT INTO activity(id,workspace_id,task_id,actor_id,action,created_at) SELECT ?,workspace_id,id,?,?,? FROM tasks WHERE workspace_id=? AND id=? AND last_mutation_id=?", id, actor, action, time, workspaceId, taskId, id);
  }
  async createTask(userId: string, workspaceId: string, input: unknown): Promise<Task> {
    await this.membership(userId, workspaceId); const value = parseTaskCreate(input);
    const now = new Date().toISOString(); const id = crypto.randomUUID(); const mutation = crypto.randomUUID();
    const result = await this.db.batch([
      this.statement(`INSERT INTO tasks(id,workspace_id,project_id,title,description,status,priority,assignee_id,due_date,completed_at,last_mutation_id,created_by,updated_by,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${memberGuard} AND EXISTS (SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL) AND (? IS NULL OR EXISTS(SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?)) RETURNING *`, id, workspaceId, value.project_id, value.title, value.description, value.status, value.priority, value.assignee_id, value.due_date, value.status === "done" ? now : null, mutation, userId, userId, now, now, workspaceId, userId, value.project_id, workspaceId, value.assignee_id, workspaceId, value.assignee_id),
      this.event(mutation, workspaceId, id, userId, "created", now),
    ]);
    if (!result[0].results.length) throw new AppError(400, "INVALID_REFERENCE", "Choose an active project and an assignee from this workspace.");
    return this.task(userId, workspaceId, id);
  }
  async updateTask(userId: string, workspaceId: string, taskId: string, input: unknown): Promise<Task> {
    const patch = parseTaskPatch(input); const current = await this.task(userId, workspaceId, taskId);
    if (current.version !== patch.version) throw conflict();
    if (current.archived_at && (patch.archived !== false || Object.keys(patch).length !== 2)) throw new AppError(409, "ARCHIVED", "Restore this task before editing it.");
    const now = new Date().toISOString(); const mutation = crypto.randomUUID(); const status = patch.status ?? current.status;
    const assignee = patch.assignee_id === undefined ? current.assignee_id : patch.assignee_id;
    const action = patch.archived === true ? "archived" : patch.archived === false ? "restored" : status !== current.status ? `status:${status}` : "updated";
    const completed = status === "done" ? current.completed_at ?? now : null;
    const result = await this.db.batch([
      this.statement(`UPDATE tasks SET title=?,description=?,status=?,priority=?,assignee_id=?,due_date=?,completed_at=?,archived_at=?,version=version+1,last_mutation_id=?,updated_by=?,updated_at=? WHERE id=? AND workspace_id=? AND version=? AND ${memberGuard} AND EXISTS(SELECT 1 FROM projects WHERE id=tasks.project_id AND workspace_id=? AND archived_at IS NULL) AND (? IS NULL OR EXISTS(SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?)) RETURNING *`, patch.title ?? current.title, patch.description ?? current.description, status, patch.priority ?? current.priority, assignee, patch.due_date === undefined ? current.due_date : patch.due_date, completed, patch.archived === undefined ? current.archived_at : patch.archived ? now : null, mutation, userId, now, taskId, workspaceId, patch.version, workspaceId, userId, workspaceId, assignee, workspaceId, assignee),
      this.event(mutation, workspaceId, taskId, userId, action, now),
    ]);
    if (!result[0].results.length) throw new AppError(409, "CONFLICT", "The item, project, assignee, or your access changed. Refresh before retrying.");
    return this.task(userId, workspaceId, taskId);
  }
  async activity(userId: string, workspaceId: string, taskId: string) {
    await this.task(userId, workspaceId, taskId);
    const result = await this.statement(`SELECT a.id,a.action,a.created_at,u.name AS actor_name FROM activity a JOIN users u ON u.id=a.actor_id WHERE a.workspace_id=? AND a.task_id=? AND ${memberGuard} ORDER BY a.created_at DESC,a.id DESC LIMIT 50`, workspaceId, taskId, workspaceId, userId).all<Activity>();
    return result.results;
  }
  async rateLimit(userId: string, now = Date.now()) {
    const window = Math.floor(now / 60000);
    const row = await this.statement("INSERT INTO mutation_limits(user_id,window_start,hits) VALUES(?,?,1) ON CONFLICT(user_id) DO UPDATE SET hits=CASE WHEN window_start=excluded.window_start THEN hits+1 ELSE 1 END,window_start=excluded.window_start RETURNING hits", userId, window).first<{ hits: number }>();
    if (!row || row.hits > 120) throw new AppError(429, "RATE_LIMITED", "Too many changes. Wait a minute before trying again.");
  }
}

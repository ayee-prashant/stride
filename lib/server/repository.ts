import { AppError, dateAtOffset, identifier, object, parseComment, parseMember, parseNotificationQuery, parseProject, parseProjectPatch, parseTaskCreate, parseTaskPatch, text } from "../domain.ts";
import { notificationAllowed } from "./notification-rules.ts";
import { localClock, nextOccurrence } from "../productivity.ts";
import type { Activity, CommentPage, Identity, Member, NotificationPage, PageQuery, Project, Role, Task, TaskComment, TaskNotification, TaskQuery, Workspace } from "../domain.ts";

export type SqlValue = string | number | null;
export interface SqlResult<T = Record<string, unknown>> { results: T[]; meta: { changes: number } }
export interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface Database {
  prepare(query: string): Statement;
  batch<T = Record<string, unknown>>(statements: Statement[]): Promise<SqlResult<T>[]>;
  transaction<T>(operation: (database: Database) => Promise<T>): Promise<T>;
}

const missing = () => new AppError(404, "NOT_FOUND", "The item is unavailable or you do not have access.");
const conflict = () => new AppError(409, "CONFLICT", "This item changed. Refresh it before saving again.");
const memberGuard = "EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = ? AND m.user_id = ?)";
const adminGuard = "EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = ? AND m.user_id = ? AND m.role = 'admin')";
const taskSelect = "SELECT t.*, (SELECT CAST(COUNT(*) AS INTEGER) FROM checklist_items c WHERE c.workspace_id=t.workspace_id AND c.task_id=t.id) AS checklist_total, (SELECT CAST(COUNT(*) AS INTEGER) FROM checklist_items c WHERE c.workspace_id=t.workspace_id AND c.task_id=t.id AND c.completed=1) AS checklist_done, p.name AS project_name, u.name AS assignee_name, COALESCE(t.assignee_id,t.created_by) AS responsible_id, COALESCE(u.name,creator.name) AS responsible_name FROM tasks t JOIN projects p ON p.id=t.project_id AND p.workspace_id=t.workspace_id LEFT JOIN users u ON u.id=t.assignee_id JOIN users creator ON creator.id=t.created_by";
type StoredComment = Omit<TaskComment, "mentioned_user_ids"> & { mentioned_user_ids: string };
const commentValue = (row: StoredComment): TaskComment => ({ ...row, mentioned_user_ids: JSON.parse(row.mentioned_user_ids) as string[] });

/** SQL and application operations are isolated from HTTP and the host runtime. */
export class Repository {
  db: Database;
  now: () => Date;
  constructor(db: Database, now = () => new Date()) { this.db = db; this.now = now; }
  statement(query: string, ...values: SqlValue[]) { return this.db.prepare(query).bind(...values); }
  async membership(userId: string, workspaceId: string, admin = false): Promise<Role> {
    const row = await this.statement("SELECT role FROM memberships WHERE workspace_id=? AND user_id=?", identifier(workspaceId), userId).first<{ role: Role }>();
    if (!row) throw missing();
    if (admin && row.role !== "admin") throw new AppError(403, "FORBIDDEN", "Only a workspace admin can do this.");
    return row.role;
  }
  async bootstrap(user: Identity) {
    const now = this.now().toISOString(); const workspaceId = `ws_${user.userId}`;
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
    await this.membership(userId, workspaceId, true); const value = parseProject(input); const now = this.now().toISOString();
    const row = await this.statement(`INSERT INTO projects(id,workspace_id,name,description,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE ${adminGuard} AND (SELECT COUNT(*) FROM projects WHERE workspace_id=?) < 100 RETURNING *`, crypto.randomUUID(), workspaceId, value.name, value.description, now, now, workspaceId, userId, workspaceId).first<Project>();
    if (!row) throw new AppError(409, "PROJECT_LIMIT", "The workspace is unavailable or has reached its 100-project limit.");
    return row;
  }
  async updateProject(userId: string, workspaceId: string, projectId: string, input: unknown): Promise<Project> {
    await this.membership(userId, workspaceId, true); const patch = parseProjectPatch(input);
    const current = await this.statement("SELECT * FROM projects WHERE workspace_id=? AND id=?", workspaceId, identifier(projectId)).first<Project>();
    if (!current) throw missing(); if (current.version !== patch.version) throw conflict();
    const now = this.now().toISOString();
    const row = await this.statement(`UPDATE projects SET name=?,description=?,archived_at=?,version=version+1,updated_at=? WHERE workspace_id=? AND id=? AND version=? AND ${adminGuard} RETURNING *`, patch.name ?? current.name, patch.description ?? current.description, patch.archived === undefined ? current.archived_at : patch.archived ? now : null, now, workspaceId, projectId, patch.version, workspaceId, userId).first<Project>();
    if (!row) throw conflict(); return row;
  }
  async addMember(userId: string, workspaceId: string, input: unknown) {
    await this.membership(userId, workspaceId, true); const value = parseMember(input);
    const target = await this.statement("SELECT id FROM users WHERE email=?", value.email).first<{ id: string }>();
    if (!target) throw new AppError(400, "MEMBER_UNAVAILABLE", "That person must have approved access and sign in once before being added.");
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
    else if (query.assignee_id) { conditions.push("(t.assignee_id=? OR (t.assignee_id IS NULL AND t.created_by=?))"); values.push(query.assignee_id, query.assignee_id); }
    if (query.priority) { conditions.push("t.priority=?"); values.push(query.priority); }
    if (query.status) { conditions.push("t.status=?"); values.push(query.status); }
    else if (!query.include_done) conditions.push("t.status!='done'");
    if (query.query) { conditions.push("lower(t.title) LIKE lower(?) ESCAPE '!'"); values.push(`%${query.query.replace(/[!%_]/g, character => `!${character}`)}%`); }
    const today = dateAtOffset(this.now(), query.tz_offset);
    if (query.due === "none") conditions.push("t.due_date IS NULL");
    else if (query.due !== "all") {
      const operator = query.due === "overdue" ? "<" : query.due === "today" ? "=" : ">";
      conditions.push(`t.due_date${operator}?`); values.push(today);
      if (query.due === "overdue") conditions.push("t.status!='done'");
    }
    // Only fixed enum branches select ordering; user strings never become SQL.
    const priorityOrder = "CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END";
    const ordering = query.sort === "priority" ? `${priorityOrder},(t.due_date IS NULL),t.due_date` : `(t.due_date IS NULL),t.due_date,${priorityOrder}`;
    const result = await this.statement(`${taskSelect} WHERE ${conditions.join(" AND ")} ORDER BY (t.status='done'),${ordering},t.id LIMIT ? OFFSET ?`, ...values, query.limit + 1, query.offset).all<Task>();
    return { tasks: result.results.slice(0, query.limit), hasMore: result.results.length > query.limit, nextOffset: query.offset + query.limit };
  }
  event(id: string, workspaceId: string, taskId: string, actor: string, action: string, time: string) {
    // The mutation token prevents a failed/stale edit from emitting an audit event.
    return this.statement("INSERT INTO activity(id,workspace_id,task_id,actor_id,action,created_at) SELECT ?,workspace_id,id,?,?,? FROM tasks WHERE workspace_id=? AND id=? AND last_mutation_id=?", id, actor, action, time, workspaceId, taskId, id);
  }
  assignmentEvent(mutation: string, workspaceId: string, taskId: string, actor: string, time: string) {
    return this.statement(`INSERT INTO notifications(id,workspace_id,task_id,recipient_id,actor_id,kind,event_key,created_at)
      SELECT ?,t.workspace_id,t.id,r.user_id,?,'assignment',?,? FROM tasks t
      JOIN memberships r ON r.workspace_id=t.workspace_id AND r.user_id=COALESCE(t.assignee_id,t.created_by)
      WHERE t.workspace_id=? AND t.id=? AND t.last_mutation_id=? AND r.user_id<>? AND ${memberGuard} AND ${notificationAllowed("t.workspace_id", "t.id", "r.user_id", "assignment")}
      ON CONFLICT(recipient_id,event_key) DO NOTHING`, `assignment:${mutation}`, actor, `assignment:${mutation}`, time, workspaceId, taskId, mutation, actor, workspaceId, actor);
  }
  async createTask(userId: string, workspaceId: string, input: unknown): Promise<Task> {
    await this.membership(userId, workspaceId); const value = parseTaskCreate(input);
    value.assignee_id ??= userId;
    const now = this.now().toISOString(); const id = crypto.randomUUID(); const mutation = crypto.randomUUID();
    const result = await this.db.batch([
      this.statement(`INSERT INTO tasks(id,workspace_id,project_id,title,description,status,priority,assignee_id,due_date,completed_at,last_mutation_id,created_by,updated_by,created_at,updated_at,recurrence) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${memberGuard} AND EXISTS (SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL) AND (CAST(? AS TEXT) IS NULL OR EXISTS(SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?)) RETURNING *`, id, workspaceId, value.project_id, value.title, value.description, value.status, value.priority, value.assignee_id, value.due_date, value.status === "done" ? now : null, mutation, userId, userId, now, now, value.recurrence ?? "none", workspaceId, userId, value.project_id, workspaceId, value.assignee_id, workspaceId, value.assignee_id),
      this.event(mutation, workspaceId, id, userId, "created", now),
      this.assignmentEvent(mutation, workspaceId, id, userId, now),
    ]);
    if (!result[0].results.length) throw new AppError(400, "INVALID_REFERENCE", "Choose an active project and an assignee from this workspace.");
    return this.task(userId, workspaceId, id);
  }
  async updateTask(userId: string, workspaceId: string, taskId: string, input: unknown): Promise<Task> {
    // A successor, copied checklist, task edit and notifications commit together.
    const before = await this.task(userId, workspaceId, taskId);
    return this.db.transaction(async database => {
      const scoped = new Repository(database, this.now);
      const updated = await scoped.updateTaskRecord(userId, workspaceId, taskId, input);
      if (before.status !== "done" && updated.status === "done" && !updated.archived_at && updated.recurrence !== "none") {
        const existing = await scoped.statement("SELECT id FROM tasks WHERE workspace_id=? AND recurrence_parent_id=?", workspaceId, taskId).first();
        if (!existing) {
          const settings = await scoped.statement("SELECT timezone FROM notification_preferences WHERE workspace_id=? AND user_id=?", workspaceId, userId).first<{ timezone: string }>();
          const due = nextOccurrence(updated.recurrence, updated.due_date, localClock(scoped.now(), settings?.timezone ?? "UTC").day);
          const next = await scoped.createTask(userId, workspaceId, { project_id: updated.project_id, title: updated.title, description: updated.description, priority: updated.priority, assignee_id: updated.assignee_id ?? updated.created_by, due_date: due, recurrence: updated.recurrence });
          await scoped.statement("UPDATE tasks SET recurrence_parent_id=? WHERE id=? AND workspace_id=?", taskId, next.id, workspaceId).run();
          const checklist = await scoped.statement("SELECT title,position FROM checklist_items WHERE workspace_id=? AND task_id=? ORDER BY position,id LIMIT 50", workspaceId, taskId).all<{ title: string; position: number }>();
          for (const item of checklist.results) await scoped.statement("INSERT INTO checklist_items(id,workspace_id,task_id,title,position,created_at) VALUES(?,?,?,?,?,?)", crypto.randomUUID(), workspaceId, next.id, item.title, item.position, scoped.now().toISOString()).run();
        }
      }
      return updated;
    });
  }
  private async updateTaskRecord(userId: string, workspaceId: string, taskId: string, input: unknown): Promise<Task> {
    const patch = parseTaskPatch(input); const current = await this.task(userId, workspaceId, taskId);
    if (current.version !== patch.version) throw conflict();
    if (current.archived_at && (patch.archived !== false || Object.keys(patch).length !== 2)) throw new AppError(409, "ARCHIVED", "Restore this task before editing it.");
    const now = this.now().toISOString(); const mutation = crypto.randomUUID(); const status = patch.status ?? current.status;
    const assignee = patch.assignee_id === undefined ? current.assignee_id : patch.assignee_id;
    const blocked = patch.blocked_reason ?? current.blocked_reason;
    const waiting = !blocked ? null : patch.waiting_on_id === undefined ? current.waiting_on_id : patch.waiting_on_id;
    if (patch.waiting_on_id && !blocked) throw new AppError(400, "INVALID_BLOCKER", "Add a blocker reason before selecting a teammate.");
    const action = patch.archived === true ? "archived" : patch.archived === false ? "restored" : status !== current.status ? `status:${status}` : "updated";
    const completed = status === "done" ? current.completed_at ?? now : null;
    const result = await this.db.batch([
      this.statement(`UPDATE tasks SET title=?,description=?,status=?,priority=?,assignee_id=?,due_date=?,completed_at=?,archived_at=?,version=version+1,last_mutation_id=?,updated_by=?,updated_at=?,blocked_reason=?,waiting_on_id=?,recurrence=? WHERE id=? AND workspace_id=? AND version=? AND ${memberGuard} AND EXISTS(SELECT 1 FROM projects WHERE id=tasks.project_id AND workspace_id=? AND archived_at IS NULL) AND (CAST(? AS TEXT) IS NULL OR EXISTS(SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?)) AND (CAST(? AS TEXT) IS NULL OR EXISTS(SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?)) RETURNING *`, patch.title ?? current.title, patch.description ?? current.description, status, patch.priority ?? current.priority, assignee, patch.due_date === undefined ? current.due_date : patch.due_date, completed, patch.archived === undefined ? current.archived_at : patch.archived ? now : null, mutation, userId, now, blocked, waiting, patch.recurrence ?? current.recurrence, taskId, workspaceId, patch.version, workspaceId, userId, workspaceId, assignee, workspaceId, assignee, waiting, workspaceId, waiting),
      this.event(mutation, workspaceId, taskId, userId, action, now),
      ...((assignee ?? current.created_by) !== (current.assignee_id ?? current.created_by) ? [this.assignmentEvent(mutation, workspaceId, taskId, userId, now)] : []),
    ]);
    if (!result[0].results.length) throw new AppError(409, "CONFLICT", "The item, project, assignee, or your access changed. Refresh before retrying.");
    return this.task(userId, workspaceId, taskId);
  }
  async activity(userId: string, workspaceId: string, taskId: string) {
    await this.task(userId, workspaceId, taskId);
    const result = await this.statement(`SELECT a.id,a.action,a.created_at,u.name AS actor_name FROM activity a JOIN users u ON u.id=a.actor_id WHERE a.workspace_id=? AND a.task_id=? AND ${memberGuard} ORDER BY a.created_at DESC,a.id DESC LIMIT 50`, workspaceId, taskId, workspaceId, userId).all<Activity>();
    return result.results;
  }
  async comments(userId: string, workspaceId: string, taskId: string, query: PageQuery): Promise<CommentPage> {
    await this.task(userId, workspaceId, taskId);
    const result = await this.statement(`SELECT c.*,u.name AS author_name FROM comments c JOIN users u ON u.id=c.author_id
      WHERE c.workspace_id=? AND c.task_id=? AND ${memberGuard} ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?`, workspaceId, taskId, workspaceId, userId, query.limit + 1, query.offset).all<StoredComment>();
    return { comments: result.results.slice(0, query.limit).map(commentValue), hasMore: result.results.length > query.limit, nextOffset: query.offset + query.limit };
  }
  async createComment(userId: string, workspaceId: string, taskId: string, input: unknown): Promise<TaskComment> {
    const current = await this.task(userId, workspaceId, taskId); const value = parseComment(input);
    if (current.archived_at) throw new AppError(409, "ARCHIVED", "Restore this task before commenting.");
    const mentions = value.mentioned_user_ids; const marks = mentions.map(() => "?").join(",");
    if (mentions.length) {
      const recipients = await this.statement(`SELECT user_id FROM memberships WHERE workspace_id=? AND user_id IN (${marks})`, workspaceId, ...mentions).all();
      if (recipients.results.length !== mentions.length) throw new AppError(400, "INVALID_MENTION", "Mention only current members of this workspace.");
    }
    const id = crypto.randomUUID(); const now = this.now().toISOString();
    const mentionGuard = mentions.length ? `AND (SELECT COUNT(*) FROM memberships WHERE workspace_id=? AND user_id IN (${marks}))=?` : "";
    const result = await this.db.batch([
      this.statement(`INSERT INTO comments(id,workspace_id,task_id,author_id,body,mentioned_user_ids,created_at)
        SELECT ?,t.workspace_id,t.id,?,?,?,? FROM tasks t JOIN projects p ON p.workspace_id=t.workspace_id AND p.id=t.project_id
        WHERE t.workspace_id=? AND t.id=? AND t.archived_at IS NULL AND p.archived_at IS NULL AND ${memberGuard} ${mentionGuard} RETURNING *`,
      id, userId, value.body, JSON.stringify(mentions), now, workspaceId, taskId, workspaceId, userId, ...(mentions.length ? [workspaceId, ...mentions, mentions.length] : [])),
      this.statement("INSERT INTO activity(id,workspace_id,task_id,actor_id,action,created_at) SELECT id,workspace_id,task_id,author_id,'commented',created_at FROM comments WHERE id=? AND workspace_id=? AND author_id=?", id, workspaceId, userId),
      ...(mentions.length ? [this.statement(`INSERT INTO notifications(id,workspace_id,task_id,recipient_id,actor_id,kind,event_key,created_at)
        SELECT 'mention:'||c.id||':'||m.user_id,c.workspace_id,c.task_id,m.user_id,c.author_id,'mention','mention:'||c.id,c.created_at
        FROM comments c JOIN memberships m ON m.workspace_id=c.workspace_id
        WHERE c.id=? AND c.workspace_id=? AND c.author_id=? AND m.user_id<>c.author_id AND m.user_id IN (${marks}) AND ${notificationAllowed("c.workspace_id", "c.task_id", "m.user_id", "mention")}
        ON CONFLICT(recipient_id,event_key) DO NOTHING`, id, workspaceId, userId, ...mentions)] : []),
    ]);
    if (!result[0].results.length) throw new AppError(409, "COMMENT_UNAVAILABLE", "The task, project, or membership changed. Refresh before commenting.");
    const row = await this.statement(`SELECT c.*,u.name AS author_name FROM comments c JOIN users u ON u.id=c.author_id WHERE c.id=? AND c.workspace_id=? AND ${memberGuard}`, id, workspaceId, workspaceId, userId).first<StoredComment>();
    if (!row) throw missing(); return commentValue(row);
  }
  async notifications(userId: string, workspaceId: string, input: unknown, sync = false): Promise<NotificationPage> {
    await this.membership(userId, workspaceId); const query = parseNotificationQuery(input);
    const now = this.now(); const today = dateAtOffset(now, query.tz_offset);
    if (sync) {
      // Bounded catch-up and a unique key make focus/refresh and concurrent tabs safe.
      await this.statement(`INSERT INTO notifications(id,workspace_id,task_id,recipient_id,actor_id,kind,event_key,created_at)
        SELECT 'overdue:'||t.id||':'||t.due_date||':'||?,t.workspace_id,t.id,?,NULL,'overdue','overdue:'||t.id||':'||t.due_date||':'||?,?
        FROM tasks t JOIN projects p ON p.workspace_id=t.workspace_id AND p.id=t.project_id
        WHERE t.workspace_id=? AND ${memberGuard} AND (t.assignee_id=? OR (t.assignee_id IS NULL AND t.created_by=?))
        AND t.archived_at IS NULL AND p.archived_at IS NULL AND t.status<>'done' AND t.due_date<? AND ${notificationAllowed('t.workspace_id', 't.id', 'COALESCE(t.assignee_id,t.created_by)', 'overdue')}
        AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.id='overdue:'||t.id||':'||t.due_date||':'||?)
        ORDER BY t.due_date,t.id LIMIT 100 ON CONFLICT(recipient_id,event_key) DO NOTHING`,
      userId, userId, userId, now.toISOString(), workspaceId, workspaceId, userId, userId, userId, today, userId).run();
    }
    const join = "FROM notifications n JOIN tasks t ON t.workspace_id=n.workspace_id AND t.id=n.task_id JOIN projects p ON p.workspace_id=t.workspace_id AND p.id=t.project_id LEFT JOIN users a ON a.id=n.actor_id";
    const visible = `n.workspace_id=? AND n.recipient_id=? AND ${memberGuard} AND t.archived_at IS NULL AND p.archived_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM task_notification_settings nm WHERE nm.workspace_id=n.workspace_id AND nm.task_id=n.task_id AND nm.user_id=n.recipient_id AND nm.muted=1)
      AND NOT EXISTS(SELECT 1 FROM notification_preferences np WHERE np.workspace_id=n.workspace_id AND np.user_id=n.recipient_id AND ((n.kind='assignment' AND np.assignments=0) OR (n.kind='mention' AND np.mentions=0) OR (n.kind IN ('overdue','reminder') AND np.due_reminders=0)))
      AND (n.kind<>'reminder' OR (t.status<>'done' AND COALESCE(t.assignee_id,t.created_by)=n.recipient_id AND n.event_key='reminder:'||t.id||':'||t.due_date||':'||n.recipient_id))
      AND (n.kind<>'overdue' OR (t.status<>'done' AND t.due_date<? AND COALESCE(t.assignee_id,t.created_by)=n.recipient_id AND n.event_key='overdue:'||t.id||':'||t.due_date||':'||n.recipient_id))`;
    const values: SqlValue[] = [workspaceId, userId, workspaceId, userId, today];
    const [rows, count] = await Promise.all([
      this.statement(`SELECT n.id,n.task_id,n.kind,n.created_at,n.read_at,t.title AS task_title,p.name AS project_name,a.name AS actor_name ${join} WHERE ${visible} ORDER BY n.created_at DESC,n.id DESC LIMIT ? OFFSET ?`, ...values, query.limit + 1, query.offset).all<TaskNotification>(),
      this.statement(`SELECT COUNT(*) AS n ${join} WHERE ${visible} AND n.read_at IS NULL`, ...values).first<{ n: number | string }>(),
    ]);
    return { notifications: rows.results.slice(0, query.limit), unreadCount: Number(count?.n ?? 0), hasMore: rows.results.length > query.limit, nextOffset: query.offset + query.limit };
  }
  async readNotification(userId: string, workspaceId: string, notificationId: string | null, input: unknown) {
    object(input, []); await this.membership(userId, workspaceId);
    const now = this.now().toISOString();
    if (notificationId === null) {
      await this.statement(`UPDATE notifications SET read_at=? WHERE workspace_id=? AND recipient_id=? AND read_at IS NULL AND ${memberGuard}`, now, workspaceId, userId, workspaceId, userId).run();
      return { read: true };
    }
    const id = text(notificationId, "Notification identifier", 1024);
    const row = await this.statement(`UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND workspace_id=? AND recipient_id=? AND ${memberGuard}
      AND EXISTS(SELECT 1 FROM tasks t JOIN projects p ON p.id=t.project_id AND p.workspace_id=t.workspace_id WHERE t.id=notifications.task_id AND t.workspace_id=notifications.workspace_id AND t.archived_at IS NULL AND p.archived_at IS NULL) RETURNING id,read_at`, now, id, workspaceId, userId, workspaceId, userId).first();
    if (!row) throw missing(); return row;
  }
  async rateLimit(userId: string, now = Date.now(), maximum = 120) {
    const window = Math.floor(now / 60000);
    const row = await this.statement("INSERT INTO mutation_limits(user_id,window_start,hits) VALUES(?,?,1) ON CONFLICT(user_id) DO UPDATE SET hits=CASE WHEN mutation_limits.window_start=excluded.window_start THEN mutation_limits.hits+1 ELSE 1 END,window_start=excluded.window_start RETURNING hits", userId, window).first<{ hits: number }>();
    if (!row || row.hits > maximum) throw new AppError(429, "RATE_LIMITED", "Too many changes. Wait a minute before trying again.");
  }
}

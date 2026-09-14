import { AppError, identifier, object, text, version } from "../domain.ts";
import type { Task } from "../domain.ts";
import { DEFAULT_PREFERENCES, localClock, parseBulk, parseChecklist, parseMute, parsePreferences, parseSavedView, parseTemplate } from "../productivity.ts";
import type { ChecklistItem, Preferences, SavedView, TaskTemplate, Workload } from "../productivity.ts";
import { Repository } from "./repository.ts";

const conflict = () => new AppError(409, "CONFLICT", "This item changed. Refresh it before saving again.");
const missing = () => new AppError(404, "NOT_FOUND", "The item is unavailable or you do not have access.");
const memberGuard = "EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=? AND m.user_id=?)";
type ViewRow = Omit<SavedView, "filters"> & { filters: string };
type TemplateRow = Omit<TaskTemplate, "task" | "checklist"> & { task: string; checklist: string; created_by: string };
type PreferenceRow = Omit<Preferences, "assignments" | "mentions" | "due_reminders" | "daily_digest"> & { assignments: number; mentions: number; due_reminders: number; daily_digest: number };
const viewValue = (row: ViewRow): SavedView => ({ id: row.id, name: row.name, version: row.version, filters: JSON.parse(row.filters) });
const templateValue = (row: TemplateRow): TaskTemplate => ({ created_by: row.created_by, id: row.id, name: row.name, version: row.version, task: JSON.parse(row.task), checklist: JSON.parse(row.checklist) });

/** Application operations composed with the existing task repository. */
export class ProductivityRepository {
  repo: Repository;
  constructor(repo: Repository) { this.repo = repo; }

  /** Call inside a transaction: serialize checklist counts and mutations on the parent. */
  async lockTask(userId: string, workspaceId: string, taskId: string): Promise<Task> {
    await this.repo.membership(userId, workspaceId);
    const task = await this.repo.statement(`UPDATE tasks SET version=version WHERE id=? AND workspace_id=? AND archived_at IS NULL AND ${memberGuard}
      AND EXISTS(SELECT 1 FROM projects p WHERE p.id=tasks.project_id AND p.workspace_id=tasks.workspace_id AND p.archived_at IS NULL) RETURNING *`,
    identifier(taskId), workspaceId, workspaceId, userId).first<Task>();
    if (!task) throw new AppError(409, "TASK_UNAVAILABLE", "The task or project is archived, or your access changed.");
    return task;
  }
  async checklist(userId: string, workspaceId: string, taskId: string): Promise<ChecklistItem[]> {
    await this.repo.task(userId, workspaceId, taskId);
    return (await this.repo.statement(`SELECT * FROM checklist_items WHERE workspace_id=? AND task_id=? AND ${memberGuard} ORDER BY position,id LIMIT 50`, workspaceId, taskId, workspaceId, userId).all<ChecklistItem>()).results;
  }
  async changeChecklist(userId: string, workspaceId: string, taskId: string, itemId: string | null, input: unknown) {
    const value = parseChecklist(input, !!itemId);
    return this.repo.db.transaction(async database => {
      const repo = new Repository(database, this.repo.now); const service = new ProductivityRepository(repo);
      await service.lockTask(userId, workspaceId, taskId);
      let result: ChecklistItem | null;
      if (!itemId) {
        const count = await repo.statement("SELECT COUNT(*) AS n,COALESCE(MAX(position),0) AS position FROM checklist_items WHERE workspace_id=? AND task_id=?", workspaceId, taskId).first<{ n: number | string; position: number }>();
        if (Number(count?.n ?? 0) >= 50) throw new AppError(409, "CHECKLIST_LIMIT", "A task can have up to 50 checklist items.");
        result = await repo.statement("INSERT INTO checklist_items(id,workspace_id,task_id,title,position,created_at) VALUES(?,?,?,?,?,?) RETURNING *", crypto.randomUUID(), workspaceId, taskId, value.title!, Number(count?.position ?? 0) + 1, repo.now().toISOString()).first<ChecklistItem>();
      } else {
        if ("remove" in value && value.remove) result = await repo.statement("DELETE FROM checklist_items WHERE id=? AND workspace_id=? AND task_id=? AND version=? RETURNING *", identifier(itemId), workspaceId, taskId, value.version!).first<ChecklistItem>();
        else result = await repo.statement("UPDATE checklist_items SET title=COALESCE(?,title),completed=COALESCE(?,completed),version=version+1 WHERE id=? AND workspace_id=? AND task_id=? AND version=? RETURNING *", value.title ?? null, "completed" in value ? Number(value.completed) : null, identifier(itemId), workspaceId, taskId, value.version!).first<ChecklistItem>();
        if (!result) throw conflict();
      }
      await repo.statement("INSERT INTO activity(id,workspace_id,task_id,actor_id,action,created_at) VALUES(?,?,?,?,'checklist updated',?)", crypto.randomUUID(), workspaceId, taskId, userId, repo.now().toISOString()).run();
      return { item: result, removed: "remove" in value && !!value.remove };
    });
  }
  async bulk(userId: string, workspaceId: string, input: unknown): Promise<{ tasks: Task[] }> {
    const value = parseBulk(input);
    return this.repo.db.transaction(async database => {
      const repo = new Repository(database, this.repo.now); await repo.membership(userId, workspaceId);
      const tasks: Task[] = [];
      // Stable lock order prevents two overlapping bulk operations from deadlocking.
      for (const selected of value.tasks) tasks.push(await repo.updateTask(userId, workspaceId, selected.id, { ...value.changes, version: selected.version }));
      return { tasks };
    });
  }
  async views(userId: string, workspaceId: string): Promise<SavedView[]> {
    await this.repo.membership(userId, workspaceId);
    const rows = await this.repo.statement(`SELECT id,name,filters,version FROM saved_views WHERE workspace_id=? AND user_id=? AND ${memberGuard} ORDER BY created_at,id LIMIT 20`, workspaceId, userId, workspaceId, userId).all<ViewRow>();
    return rows.results.map(viewValue);
  }
  async saveView(userId: string, workspaceId: string, id: string | null, input: unknown): Promise<SavedView> {
    const value = parseSavedView(input, !!id);
    return this.repo.db.transaction(async database => {
      const repo = new Repository(database, this.repo.now); await repo.membership(userId, workspaceId);
      // A member-row lock serializes the per-person 20-view quota.
      await repo.statement("UPDATE memberships SET role=role WHERE workspace_id=? AND user_id=?", workspaceId, userId).run();
      let row: ViewRow | null;
      if (id) row = await repo.statement("UPDATE saved_views SET name=?,filters=?,version=version+1 WHERE id=? AND workspace_id=? AND user_id=? AND version=? RETURNING *", value.name, JSON.stringify(value.filters), identifier(id), workspaceId, userId, value.version!).first<ViewRow>();
      else row = await repo.statement("INSERT INTO saved_views(id,workspace_id,user_id,name,filters,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM saved_views WHERE workspace_id=? AND user_id=?)<20 RETURNING *", crypto.randomUUID(), workspaceId, userId, value.name, JSON.stringify(value.filters), repo.now().toISOString(), workspaceId, userId).first<ViewRow>();
      if (!row) throw new AppError(409, "VIEW_UNAVAILABLE", "This view changed or you reached the 20-view limit.");
      return viewValue(row);
    });
  }
  async removeView(userId: string, workspaceId: string, id: string, input: unknown) {
    const v = version(object(input, ["version"]).version); await this.repo.membership(userId, workspaceId);
    const row = await this.repo.statement(`DELETE FROM saved_views WHERE id=? AND workspace_id=? AND user_id=? AND version=? AND ${memberGuard} RETURNING id`, identifier(id), workspaceId, userId, v, workspaceId, userId).first();
    if (!row) throw conflict(); return { removed: true };
  }
  async templates(userId: string, workspaceId: string): Promise<TaskTemplate[]> {
    await this.repo.membership(userId, workspaceId);
    const rows = await this.repo.statement(`SELECT * FROM task_templates WHERE workspace_id=? AND ${memberGuard} ORDER BY name,id LIMIT 50`, workspaceId, workspaceId, userId).all<TemplateRow>();
    return rows.results.map(templateValue);
  }
  async saveTemplate(userId: string, workspaceId: string, id: string | null, input: unknown): Promise<TaskTemplate> {
    const value = parseTemplate(input, !!id);
    return this.repo.db.transaction(async database => {
      const repo = new Repository(database, this.repo.now); const role = await repo.membership(userId, workspaceId);
      await repo.statement("UPDATE workspaces SET name=name WHERE id=?", workspaceId).run();
      if (value.task.assignee_id) await repo.membership(value.task.assignee_id, workspaceId);
      let row: TemplateRow | null;
      if (id) row = await repo.statement("UPDATE task_templates SET name=?,task=?,checklist=?,version=version+1 WHERE id=? AND workspace_id=? AND version=? AND (created_by=? OR ?='admin') RETURNING *", value.name, JSON.stringify(value.task), JSON.stringify(value.checklist), identifier(id), workspaceId, value.version!, userId, role).first<TemplateRow>();
      else row = await repo.statement("INSERT INTO task_templates(id,workspace_id,created_by,name,task,checklist,created_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM task_templates WHERE workspace_id=?)<50 RETURNING *", crypto.randomUUID(), workspaceId, userId, value.name, JSON.stringify(value.task), JSON.stringify(value.checklist), repo.now().toISOString(), workspaceId).first<TemplateRow>();
      if (!row) throw new AppError(409, "TEMPLATE_UNAVAILABLE", "This template changed, is managed by another teammate, or the 50-template limit was reached.");
      return templateValue(row);
    });
  }
  async removeTemplate(userId: string, workspaceId: string, id: string, input: unknown) {
    const v = version(object(input, ["version"]).version); const role = await this.repo.membership(userId, workspaceId);
    const row = await this.repo.statement(`DELETE FROM task_templates WHERE id=? AND workspace_id=? AND version=? AND (created_by=? OR ?='admin') AND ${memberGuard} RETURNING id`, identifier(id), workspaceId, v, userId, role, workspaceId, userId).first();
    if (!row) throw conflict(); return { removed: true };
  }
  async useTemplate(userId: string, workspaceId: string, id: string, input: unknown): Promise<Task> {
    const value = object(input, ["project_id", "title"]);
    const projectId = identifier(value.project_id); const title = value.title === undefined ? undefined : text(value.title, "Title", 200);
    return this.repo.db.transaction(async database => {
      const repo = new Repository(database, this.repo.now); await repo.membership(userId, workspaceId);
      const row = await repo.statement(`SELECT * FROM task_templates WHERE workspace_id=? AND id=? AND ${memberGuard}`, workspaceId, identifier(id), workspaceId, userId).first<TemplateRow>();
      if (!row) throw missing();
      const template = templateValue(row);
      const task = await repo.createTask(userId, workspaceId, { ...template.task, project_id: projectId, title: title ?? template.task.title });
      for (const [position, label] of template.checklist.entries()) await repo.statement("INSERT INTO checklist_items(id,workspace_id,task_id,title,position,created_at) VALUES(?,?,?,?,?,?)", crypto.randomUUID(), workspaceId, task.id, label, position, repo.now().toISOString()).run();
      return repo.task(userId, workspaceId, task.id);
    });
  }
  async preferences(userId: string, workspaceId: string): Promise<Preferences> {
    await this.repo.membership(userId, workspaceId);
    const row = await this.repo.statement(`SELECT * FROM notification_preferences WHERE workspace_id=? AND user_id=? AND ${memberGuard}`, workspaceId, userId, workspaceId, userId).first<PreferenceRow>();
    if (!row) return { ...DEFAULT_PREFERENCES };
    return { assignments: !!row.assignments, mentions: !!row.mentions, due_reminders: !!row.due_reminders, daily_digest: !!row.daily_digest, timezone: row.timezone, reminder_hour: row.reminder_hour, version: row.version };
  }
  async savePreferences(userId: string, workspaceId: string, input: unknown): Promise<Preferences> {
    const value = parsePreferences(input);
    return this.repo.db.transaction(async database => {
      const repo = new Repository(database, this.repo.now); await repo.membership(userId, workspaceId);
      await repo.statement("UPDATE memberships SET role=role WHERE workspace_id=? AND user_id=?", workspaceId, userId).run();
      const service = new ProductivityRepository(repo); const existing = await service.preferences(userId, workspaceId);
      if (existing.version !== value.version) throw conflict();
      await repo.statement(`INSERT INTO notification_preferences(workspace_id,user_id,assignments,mentions,due_reminders,daily_digest,timezone,reminder_hour,version)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET assignments=excluded.assignments,mentions=excluded.mentions,due_reminders=excluded.due_reminders,daily_digest=excluded.daily_digest,timezone=excluded.timezone,reminder_hour=excluded.reminder_hour,version=excluded.version`, workspaceId, userId, Number(value.assignments), Number(value.mentions), Number(value.due_reminders), Number(value.daily_digest), value.timezone, value.reminder_hour, value.version + 1).run();
      return service.preferences(userId, workspaceId);
    });
  }
  async taskMute(userId: string, workspaceId: string, taskId: string) {
    await this.repo.task(userId, workspaceId, taskId);
    const row = await this.repo.statement(`SELECT muted FROM task_notification_settings WHERE workspace_id=? AND task_id=? AND user_id=? AND ${memberGuard}`, workspaceId, taskId, userId, workspaceId, userId).first<{ muted: number }>();
    return { muted: !!row?.muted };
  }
  async muteTask(userId: string, workspaceId: string, taskId: string, input: unknown) {
    const muted = parseMute(input); await this.repo.task(userId, workspaceId, taskId);
    await this.repo.statement(`INSERT INTO task_notification_settings(workspace_id,task_id,user_id,muted) SELECT ?,?,?,? WHERE ${memberGuard} ON CONFLICT(workspace_id,task_id,user_id) DO UPDATE SET muted=excluded.muted`, workspaceId, taskId, userId, Number(muted), workspaceId, userId).run();
    return { muted };
  }
  async workload(userId: string, workspaceId: string): Promise<Workload[]> {
    const preferences = await this.preferences(userId, workspaceId); const today = localClock(this.repo.now(), preferences.timezone).day;
    const rows = await this.repo.statement(`SELECT m.user_id,u.name,CAST(COUNT(t.id) AS INTEGER) AS open,
      CAST(COALESCE(SUM(CASE WHEN t.blocked_reason<>'' THEN 1 ELSE 0 END),0) AS INTEGER) AS blocked,
      CAST(COALESCE(SUM(CASE WHEN t.due_date<? THEN 1 ELSE 0 END),0) AS INTEGER) AS overdue
      FROM memberships m JOIN users u ON u.id=m.user_id
      LEFT JOIN tasks t ON t.workspace_id=m.workspace_id AND COALESCE(t.assignee_id,t.created_by)=m.user_id
        AND t.archived_at IS NULL AND t.status<>'done' AND EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND p.workspace_id=t.workspace_id AND p.archived_at IS NULL)
      WHERE m.workspace_id=? AND ${memberGuard} GROUP BY m.user_id,u.name ORDER BY open DESC,u.name LIMIT 200`, today, workspaceId, workspaceId, userId).all<Workload>();
    return rows.results;
  }
}

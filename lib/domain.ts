/** Framework-independent contracts and validation. No IO or runtime bindings. */
export const STATUSES = ["todo", "in_progress", "done"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;
export const DUE_FILTERS = ["all", "overdue", "today", "upcoming", "none"] as const;
export const TASK_SORTS = ["due_date", "priority"] as const;
export const RECURRENCES = ["none", "daily", "weekly", "monthly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Role = "admin" | "member";
export type Identity = { userId: string; email: string; displayName: string };
export type Workspace = { id: string; name: string; owner_id: string; role: Role };
export type Member = { user_id: string; name: string; email: string; role: Role };
export type Project = { id: string; workspace_id: string; name: string; description: string; archived_at: string | null; version: number; created_at: string; updated_at: string };
export type Task = {
  id: string; workspace_id: string; project_id: string; title: string; description: string;
  status: Status; priority: Priority; assignee_id: string | null; due_date: string | null;
  completed_at: string | null; archived_at: string | null; version: number;
  created_by: string; updated_by: string; created_at: string; updated_at: string;
  blocked_reason: string; waiting_on_id: string | null; recurrence: Recurrence; recurrence_parent_id: string | null;
  checklist_total?: number; checklist_done?: number;
  project_name?: string; assignee_name?: string | null; responsible_id?: string; responsible_name?: string;
};
export type Activity = { id: string; action: string; actor_name: string; created_at: string };
export type CommentDraft = { body: string; mentioned_user_ids: string[] };
export type TaskComment = CommentDraft & { id: string; workspace_id: string; task_id: string; author_id: string; author_name: string; created_at: string };
export type TaskNotification = { id: string; task_id: string; task_title: string; project_name: string; kind: "assignment" | "mention" | "overdue" | "reminder"; actor_name: string | null; created_at: string; read_at: string | null };
export type PageQuery = { limit: number; offset: number };
export type NotificationQuery = PageQuery & { tz_offset: number };
export type CommentPage = { comments: TaskComment[]; hasMore: boolean; nextOffset: number };
export type NotificationPage = { notifications: TaskNotification[]; unreadCount: number; hasMore: boolean; nextOffset: number };
export type TaskCreate = Pick<Task, "project_id" | "title" | "description" | "status" | "priority" | "assignee_id" | "due_date"> & { recurrence?: Recurrence };
export type TaskPatch = Partial<Omit<TaskCreate, "project_id">> & { version: number; archived?: boolean; blocked_reason?: string; waiting_on_id?: string | null };
export type ProjectInput = { name: string; description: string };
export type ProjectPatch = Partial<ProjectInput> & { version: number; archived?: boolean };
export type TaskQuery = PageQuery & { project_id?: string; assignee_id?: string; priority?: Priority; status?: Status; query: string; archived: boolean; include_done: boolean; due: (typeof DUE_FILTERS)[number]; sort: (typeof TASK_SORTS)[number]; tz_offset: number };

export class AppError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message); this.name = "AppError"; this.status = status; this.code = code;
  }
}
export function invalid(message: string): never { throw new AppError(400, "INVALID_INPUT", message); }
export function object(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("Expected a JSON object.");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid("Unexpected field in request.");
  return value;
}
export function text(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string") invalid(`${label} must be text.`);
  const result = value.trim();
  if ((!allowEmpty && !result) || result.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(result)) invalid(`${label} must be ${allowEmpty ? "0" : "1"}–${max} characters.`);
  return result;
}
export function identifier(value: unknown): string { return text(value, "Identifier", 256); }
export function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) invalid(`Invalid ${label}.`);
  return value as T;
}
export function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid("Expected true or false."); return value;
}
export function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid("A valid record version is required."); return value as number;
}
export function calendarDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid("Use a date in YYYY-MM-DD format.");
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < "1900-01-01") invalid("Enter a real calendar date from 1900 onward.");
  return value;
}
export function parseTaskCreate(input: unknown): TaskCreate {
  const v = object(input, ["project_id", "title", "description", "status", "priority", "assignee_id", "due_date", "recurrence"]);
  return {
    project_id: identifier(v.project_id), title: text(v.title, "Title", 200),
    description: text(v.description ?? "", "Description", 8000, true),
    status: choice(v.status ?? "todo", STATUSES, "status"), priority: choice(v.priority ?? "medium", PRIORITIES, "priority"),
    assignee_id: v.assignee_id == null ? null : identifier(v.assignee_id), due_date: calendarDate(v.due_date ?? null),
    ...("recurrence" in v ? { recurrence: choice(v.recurrence, RECURRENCES, "repeat schedule") } : {}),
  };
}
export function parseTaskPatch(input: unknown): TaskPatch {
  const v = object(input, ["version", "title", "description", "status", "priority", "assignee_id", "due_date", "archived", "blocked_reason", "waiting_on_id", "recurrence"]);
  if (Object.keys(v).length < 2) invalid("No task changes supplied.");
  const result: TaskPatch = { version: version(v.version) };
  if ("title" in v) result.title = text(v.title, "Title", 200);
  if ("description" in v) result.description = text(v.description, "Description", 8000, true);
  if ("status" in v) result.status = choice(v.status, STATUSES, "status");
  if ("priority" in v) result.priority = choice(v.priority, PRIORITIES, "priority");
  if ("assignee_id" in v) result.assignee_id = v.assignee_id === null ? null : identifier(v.assignee_id);
  if ("due_date" in v) result.due_date = calendarDate(v.due_date);
  if ("archived" in v) result.archived = boolean(v.archived);
  if ("blocked_reason" in v) result.blocked_reason = text(v.blocked_reason, "Blocker reason", 500, true);
  if ("waiting_on_id" in v) result.waiting_on_id = v.waiting_on_id === null ? null : identifier(v.waiting_on_id);
  if ("recurrence" in v) result.recurrence = choice(v.recurrence, RECURRENCES, "repeat schedule");
  return result;
}
export function parseProject(input: unknown): ProjectInput {
  const v = object(input, ["name", "description"]);
  return { name: text(v.name, "Project name", 80), description: text(v.description ?? "", "Description", 500, true) };
}
export function parseProjectPatch(input: unknown): ProjectPatch {
  const v = object(input, ["version", "name", "description", "archived"]);
  if (Object.keys(v).length < 2) invalid("No project changes supplied.");
  const result: ProjectPatch = { version: version(v.version) };
  if ("name" in v) result.name = text(v.name, "Project name", 80);
  if ("description" in v) result.description = text(v.description, "Description", 500, true);
  if ("archived" in v) result.archived = boolean(v.archived);
  return result;
}
export function parseMember(input: unknown): { email: string; role: Role } {
  const v = object(input, ["email", "role"]); const email = text(v.email, "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid("Enter a valid email address.");
  return { email, role: choice(v.role ?? "member", ["admin", "member"], "role") };
}
export function parseTaskQuery(params: URLSearchParams): TaskQuery {
  const allowed = ["workspace_id", "project_id", "assignee_id", "priority", "status", "query", "archived", "include_done", "limit", "offset", "due", "sort", "tz_offset"];
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length > 1) invalid("Invalid query parameter.");
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = params.get(key); const n = raw === null ? fallback : Number(raw);
    if (raw === "" || !Number.isSafeInteger(n) || n < min || n > max) invalid(`Invalid ${key}.`); return n;
  };
  const flag = (key: string, fallback: boolean) => params.has(key) ? choice(params.get(key), ["true", "false"], key) === "true" : fallback;
  return {
    project_id: params.has("project_id") ? identifier(params.get("project_id")) : undefined,
    assignee_id: params.has("assignee_id") ? identifier(params.get("assignee_id")) : undefined,
    priority: params.has("priority") ? choice(params.get("priority"), PRIORITIES, "priority") : undefined,
    status: params.has("status") ? choice(params.get("status"), STATUSES, "status") : undefined,
    due: choice(params.get("due") ?? "all", DUE_FILTERS, "due-date filter"),
    sort: choice(params.get("sort") ?? "due_date", TASK_SORTS, "sort order"),
    tz_offset: integer("tz_offset", 0, -840, 840),
    query: text(params.get("query") ?? "", "Search", 100, true), archived: flag("archived", false), include_done: flag("include_done", false),
    limit: integer("limit", 50, 1, 100), offset: integer("offset", 0, 0, 100000),
  };
}
export function parseComment(input: unknown): CommentDraft {
  const value = object(input, ["body", "mentioned_user_ids"]);
  const mentions = value.mentioned_user_ids ?? [];
  if (!Array.isArray(mentions) || mentions.length > 10) invalid("Mention at most 10 teammates in one comment.");
  const ids = mentions.map(identifier);
  if (new Set(ids).size !== ids.length) invalid("Each teammate can be mentioned once per comment.");
  return { body: text(value.body, "Comment", 4000), mentioned_user_ids: ids };
}
export function parsePageQuery(params: URLSearchParams): PageQuery {
  for (const key of params.keys()) if (!["workspace_id", "limit", "offset"].includes(key) || params.getAll(key).length > 1) invalid("Invalid query parameter.");
  const limit = Number(params.get("limit") ?? 30); const offset = Number(params.get("offset") ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000 || params.get("offset") === "") invalid("Invalid comment page.");
  return { limit, offset };
}
export function parseNotificationQuery(input: unknown): NotificationQuery {
  const value = object(input, ["limit", "offset", "tz_offset"]);
  const limit = value.limit ?? 20; const offset = value.offset ?? 0; const tz = value.tz_offset ?? 0;
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 50 || !Number.isSafeInteger(offset) || (offset as number) < 0 || (offset as number) > 100000 || !Number.isSafeInteger(tz) || Math.abs(tz as number) > 840) invalid("Invalid inbox page or time zone.");
  return { limit: limit as number, offset: offset as number, tz_offset: tz as number };
}
export function dateAtOffset(now: Date, offsetMinutes: number): string {
  return new Date(now.getTime() - offsetMinutes * 60_000).toISOString().slice(0, 10);
}
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function taskGroup(task: Pick<Task, "status" | "due_date">, today: string): string {
  if (task.status === "done") return "Completed";
  if (!task.due_date) return "No due date";
  return task.due_date < today ? "Overdue" : task.due_date === today ? "Today" : "Upcoming";
}
export const STATUS_LABEL: Record<Status, string> = { todo: "To do", in_progress: "In progress", done: "Done" };

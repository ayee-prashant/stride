/** Framework-independent contracts and validation. No IO or runtime bindings. */
export const STATUSES = ["todo", "in_progress", "done"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;
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
  project_name?: string; assignee_name?: string | null;
};
export type Activity = { id: string; action: string; actor_name: string; created_at: string };
export type TaskCreate = Pick<Task, "project_id" | "title" | "description" | "status" | "priority" | "assignee_id" | "due_date">;
export type TaskPatch = Partial<Omit<TaskCreate, "project_id">> & { version: number; archived?: boolean };
export type ProjectInput = { name: string; description: string };
export type ProjectPatch = Partial<ProjectInput> & { version: number; archived?: boolean };
export type TaskQuery = { project_id?: string; assignee_id?: string; priority?: Priority; status?: Status; query: string; archived: boolean; include_done: boolean; limit: number; offset: number };

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
function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) invalid(`Invalid ${label}.`);
  return value as T;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid("Expected true or false."); return value;
}
function version(value: unknown): number {
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
  const v = object(input, ["project_id", "title", "description", "status", "priority", "assignee_id", "due_date"]);
  return {
    project_id: identifier(v.project_id), title: text(v.title, "Title", 200),
    description: text(v.description ?? "", "Description", 8000, true),
    status: choice(v.status ?? "todo", STATUSES, "status"), priority: choice(v.priority ?? "medium", PRIORITIES, "priority"),
    assignee_id: v.assignee_id == null ? null : identifier(v.assignee_id), due_date: calendarDate(v.due_date ?? null),
  };
}
export function parseTaskPatch(input: unknown): TaskPatch {
  const v = object(input, ["version", "title", "description", "status", "priority", "assignee_id", "due_date", "archived"]);
  if (Object.keys(v).length < 2) invalid("No task changes supplied.");
  const result: TaskPatch = { version: version(v.version) };
  if ("title" in v) result.title = text(v.title, "Title", 200);
  if ("description" in v) result.description = text(v.description, "Description", 8000, true);
  if ("status" in v) result.status = choice(v.status, STATUSES, "status");
  if ("priority" in v) result.priority = choice(v.priority, PRIORITIES, "priority");
  if ("assignee_id" in v) result.assignee_id = v.assignee_id === null ? null : identifier(v.assignee_id);
  if ("due_date" in v) result.due_date = calendarDate(v.due_date);
  if ("archived" in v) result.archived = boolean(v.archived);
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
  const allowed = ["workspace_id", "project_id", "assignee_id", "priority", "status", "query", "archived", "include_done", "limit", "offset"];
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
    query: text(params.get("query") ?? "", "Search", 100, true), archived: flag("archived", false), include_done: flag("include_done", false),
    limit: integer("limit", 50, 1, 100), offset: integer("offset", 0, 0, 100000),
  };
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

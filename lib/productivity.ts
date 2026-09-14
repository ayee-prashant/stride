/** Pure contracts for the approved productivity release. */
import { boolean, choice, identifier, invalid, object, parseTaskCreate, parseTaskPatch, parseTaskQuery, text, version } from "./domain.ts";
import type { Recurrence, TaskCreate, TaskPatch } from "./domain.ts";

export type ChecklistItem = { id: string; workspace_id: string; task_id: string; title: string; completed: number; position: number; version: number; created_at: string };
export type SavedFilters = Record<string, string>;
export type SavedView = { id: string; name: string; filters: SavedFilters; version: number };
export type TaskTemplate = { created_by: string; id: string; name: string; task: Omit<TaskCreate, "project_id">; checklist: string[]; version: number };
export type Preferences = { assignments: boolean; mentions: boolean; due_reminders: boolean; daily_digest: boolean; timezone: string; reminder_hour: number; version: number };
export type Workload = { user_id: string; name: string; open: number; blocked: number; overdue: number };
export type Invitation = { id: string; email: string; role: "admin" | "member"; expires_at: string; revoked_at: string | null; accepted_at: string | null; created_at: string };
export type Attachment = { id: string; task_id: string; comment_id: string | null; filename: string; media_type: string; byte_size: number; uploaded_by: string; created_at: string };
export const DEFAULT_PREFERENCES: Preferences = { assignments: true, mentions: true, due_reminders: true, daily_digest: false, timezone: "UTC", reminder_hour: 9, version: 0 };

export function parseChecklist(input: unknown, updating = false): { title?: string; version?: number; completed?: boolean; remove?: boolean } {
  const value = object(input, updating ? ["title", "completed", "version", "remove"] : ["title"]);
  if (!updating) return { title: text(value.title, "Checklist item", 200) };
  if (Object.keys(value).length < 2) invalid("No checklist changes supplied.");
  return { version: version(value.version),
    ...("title" in value ? { title: text(value.title, "Checklist item", 200) } : {}),
    ...("completed" in value ? { completed: boolean(value.completed) } : {}),
    ...("remove" in value ? { remove: boolean(value.remove) } : {}),
  };
}
export function parseBulk(input: unknown): { tasks: { id: string; version: number }[]; changes: Omit<TaskPatch, "version"> } {
  const value = object(input, ["tasks", "changes"]);
  if (!Array.isArray(value.tasks) || !value.tasks.length || value.tasks.length > 50) invalid("Select between 1 and 50 tasks.");
  const tasks = value.tasks.map(item => { const row = object(item, ["id", "version"]); return { id: identifier(row.id), version: version(row.version) }; });
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) invalid("Select each task once.");
  const fields = object(value.changes, ["assignee_id", "priority", "due_date", "status", "archived"]);
  const parsed = parseTaskPatch({ ...fields, version: 1 });
  if (parsed.archived === false) invalid("Restore tasks individually from Trash.");
  const { version: _version, ...changes } = parsed;
  void _version;
  return { tasks: tasks.sort((a, b) => a.id.localeCompare(b.id)), changes };
}
export function parseSavedView(input: unknown, updating = false) {
  const value = object(input, ["name", "filters", ...(updating ? ["version"] : [])]);
  const filters = object(value.filters, ["project_id", "assignee_id", "priority", "status", "query", "archived", "include_done", "due", "sort"]);
  for (const field of Object.values(filters)) if (typeof field !== "string") invalid("Saved filters must contain text values.");
  parseTaskQuery(new URLSearchParams(filters as SavedFilters));
  return { name: text(value.name, "View name", 60), filters: filters as SavedFilters, ...(updating ? { version: version(value.version) } : {}) };
}
export function parseTemplate(input: unknown, updating = false) {
  const value = object(input, ["name", "task", "checklist", ...(updating ? ["version"] : [])]);
  const fields = object(value.task, ["title", "description", "priority", "assignee_id", "recurrence"]);
  const { project_id: _project, ...task } = parseTaskCreate({ ...fields, project_id: "template", status: "todo", due_date: null });
  void _project;
  if (!Array.isArray(value.checklist) || value.checklist.length > 50) invalid("Use at most 50 checklist items.");
  return { name: text(value.name, "Template name", 60), task, checklist: value.checklist.map(item => text(item, "Checklist item", 200)), ...(updating ? { version: version(value.version) } : {}) };
}
export function parsePreferences(input: unknown): Preferences {
  const value = object(input, ["assignments", "mentions", "due_reminders", "daily_digest", "timezone", "reminder_hour", "version"]);
  const timezone = text(value.timezone, "Time zone", 100);
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date()); } catch { invalid("Choose a valid time zone."); }
  const hour = value.reminder_hour;
  if (!Number.isInteger(hour) || Number(hour) < 0 || Number(hour) > 23) invalid("Choose an hour from 0 to 23.");
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 0) invalid("A valid preferences version is required.");
  return { assignments: boolean(value.assignments), mentions: boolean(value.mentions), due_reminders: boolean(value.due_reminders), daily_digest: boolean(value.daily_digest), timezone, reminder_hour: hour as number, version: value.version as number };
}
/** A future calendar due date, based on the later of completion and previous due. */
export function nextOccurrence(recurrence: Recurrence, due: string | null, today: string): string | null {
  if (recurrence === "none") return null;
  const base = due && due > today ? due : today;
  const date = new Date(`${base}T12:00:00Z`);
  if (recurrence === "monthly") {
    const day = date.getUTCDate(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + 1);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
  } else date.setUTCDate(date.getUTCDate() + (recurrence === "weekly" ? 7 : 1));
  const result = date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) invalid("The repeat schedule is outside the supported date range.");
  return result;
}
export function taskLink(workspaceId: string, taskId: string): string {
  return `/?${new URLSearchParams({ workspace: workspaceId, task: taskId })}`;
}
/** Only local app routes can be resumed; never accept protocol-relative URLs. */
export function safeReturnTo(input: unknown): string {
  if (typeof input !== "string" || input.length > 2000 || !input.startsWith("/") || input.startsWith("//") || /[\\\u0000-\u0020]/.test(input)) return "/";
  try {
    const url = new URL(input, "https://stride.invalid");
    if (url.origin !== "https://stride.invalid" || !["/", "/join"].includes(url.pathname)) return "/";
    return url.pathname + url.search;
  } catch { return "/"; }
}
export function localClock(now: Date, timezone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return { day: `${part("year")}-${part("month")}-${part("day")}`, hour: Number(part("hour")) };
}
export function parseMute(input: unknown): boolean { return boolean(object(input, ["muted"]).muted); }
export function parseRecurrence(input: unknown): Recurrence { return choice(input, ["none", "daily", "weekly", "monthly"], "repeat schedule"); }

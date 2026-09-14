import { choice, identifier, invalid, object, text } from "./domain.ts";

export const CONTEXT_KINDS = ["requirement", "decision", "constraint"] as const;
export type ContextKind = typeof CONTEXT_KINDS[number];
export type ContextState = "active" | "retired";
export type ContextRevision = {
  document_id: string; workspace_id: string; project_id: string; version: number;
  kind: ContextKind; title: string; body: string; state: ContextState; change_note: string;
  approved_by: string; approved_at: string;
};
export type ProjectBrief = { sequence: number; documents: ContextRevision[]; can_publish: boolean };
export type ContextPublish = {
  request_id: string; document_id: string | null; expected_version: number;
  kind: ContextKind; title: string; body: string; state: ContextState; change_note: string;
};
export type TaskBriefPayload = {
  format: "stride-task-brief/1";
  task: { id: string; project_id: string; title: string; description: string };
  documents: ContextRevision[];
  source_coverage: { github: "not_connected" };
};
export type TaskBrief = {
  id: string; workspace_id: string; project_id: string; task_id: string;
  context_sequence: number; task_version: number; fingerprint: string;
  payload: TaskBriefPayload; created_by: string; created_at: string;
};
export type BriefCheck = {
  state: "current" | "stale" | "unavailable"; reasons: string[];
  execution_ready: false;
};
export type TaskBriefResult = { brief: TaskBrief | null; check: BriefCheck | null };

function nonnegative(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return invalid(`${label} must be a nonnegative integer.`);
  return value as number;
}
export function requestId(value: unknown): string {
  const id = identifier(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return invalid("Use a UUID v4 request identifier.");
  return id.toLowerCase();
}
export function parseContextPublish(input: unknown): ContextPublish {
  const v = object(input, ["request_id", "document_id", "expected_version", "kind", "title", "body", "state", "change_note"]);
  const expected = nonnegative(v.expected_version, "Expected version");
  const id = v.document_id == null ? null : identifier(v.document_id);
  if ((id === null) !== (expected === 0)) return invalid("A new document uses version 0; an existing document requires its current version.");
  const state = choice(v.state ?? "active", ["active", "retired"] as const, "State");
  if (id === null && state === "retired") return invalid("A new document must be active.");
  return {
    request_id: requestId(v.request_id), document_id: id, expected_version: expected,
    kind: choice(v.kind, CONTEXT_KINDS, "Context kind"), title: text(v.title, "Title", 200),
    body: text(v.body, "Content", 6000), state, change_note: text(v.change_note, "Reason for change", 500),
  };
}
export function parseTaskBrief(input: unknown) {
  const v = object(input, ["request_id", "task_version", "requirement_ids", "context_sequence"]);
  const taskVersion = nonnegative(v.task_version, "Task version");
  if (!taskVersion) return invalid("Task version must be positive.");
  if (!Array.isArray(v.requirement_ids) || !v.requirement_ids.length || v.requirement_ids.length > 20) return invalid("Select between 1 and 20 approved requirements.");
  const ids = v.requirement_ids.map(identifier);
  if (new Set(ids).size !== ids.length) return invalid("Select each requirement only once.");
  return { request_id: requestId(v.request_id), task_version: taskVersion, requirement_ids: ids.sort(), context_sequence: nonnegative(v.context_sequence, "Context sequence") };
}
export function parseContextCursor(value: string | null) {
  if (value === null) return 0;
  if (!/^(0|[1-9]\d{0,9})$/.test(value)) return invalid("Invalid context cursor.");
  return nonnegative(Number(value), "Context cursor");
}

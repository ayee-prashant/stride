"use client";
import { useState } from "react";
import { AlertCircle, ListChecks, Pencil, Repeat2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { PRIORITIES } from "@/lib/domain";
import type { Member, Task, TaskPatch } from "@/lib/domain";
import { Choice } from "./controls";

export function TaskSignals({ task }: { task: Task }) {
  return <span className="task-signals">
    {!!task.blocked_reason && <span className="blocked-badge" title={task.blocked_reason}><AlertCircle size={13} />Blocked</span>}
    {!!task.checklist_total && <span aria-label={`${task.checklist_done} of ${task.checklist_total} checklist items complete`}><ListChecks size={13} />{task.checklist_done}/{task.checklist_total}</span>}
    {task.recurrence !== "none" && <span title={`Repeats ${task.recurrence} after completion`}><Repeat2 size={13} />{task.recurrence}</span>}
  </span>;
}
export function InlineTaskFields({ task, members, disabled, onUpdate }: { task: Task; members: Member[]; disabled: boolean; onUpdate: (task: Task, patch: Omit<TaskPatch, "version">) => Promise<Task> }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [draft, setDraft] = useState({ assignee_id: task.assignee_id, priority: task.priority, due_date: task.due_date });
  return <Popover open={open} onOpenChange={next => {
    if (busy) return;
    if (!next && JSON.stringify(draft) !== JSON.stringify({ assignee_id: task.assignee_id, priority: task.priority, due_date: task.due_date })) { setError("Save your changes or select Cancel."); return; }
    if (next) { setDraft({ assignee_id: task.assignee_id, priority: task.priority, due_date: task.due_date }); setError(""); }
    setOpen(next);
  }}><PopoverTrigger asChild><Button size="sm" variant="ghost" disabled={disabled || !!task.archived_at} aria-label={`Quick edit ${task.title}`} className="inline-task-trigger"><span className={`priority priority-${task.priority}`}>{task.priority}</span><Pencil size={13} /></Button></PopoverTrigger>
    <PopoverContent className="space-y-3" align="end"><h3 className="font-medium">Quick edit</h3><form className="space-y-3" onSubmit={async event => { event.preventDefault(); if (busy) return; setBusy(true); setError(""); try { await onUpdate(task, draft); setOpen(false); } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); } }}>
      <Choice label={`Assignee for ${task.title}`} value={draft.assignee_id ?? "unassigned"} onChange={value => setDraft({ ...draft, assignee_id: value === "unassigned" ? null : value })} disabled={busy} options={[{ value: "unassigned", label: "Task creator" }, ...members.map(member => ({ value: member.user_id, label: member.name }))]} />
      <Choice label={`Priority for ${task.title}`} value={draft.priority} onChange={value => setDraft({ ...draft, priority: value as Task["priority"] })} disabled={busy} options={PRIORITIES.map(value => ({ value, label: `${value} priority` }))} />
      <Label htmlFor={`inline-due-${task.id}`}>Due date</Label><Input id={`inline-due-${task.id}`} type="date" min="1900-01-01" max="9999-12-31" value={draft.due_date ?? ""} disabled={busy} onChange={event => setDraft({ ...draft, due_date: event.target.value || null })} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex gap-2"><Button size="sm" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button><Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button></div>
    </form></PopoverContent>
  </Popover>;
}

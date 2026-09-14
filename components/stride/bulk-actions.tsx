"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Choice } from "./controls";
import type { Member, Task, TaskPatch } from "@/lib/domain";

export function BulkActions({ tasks, members, disabled, onApply, onClear }: { tasks: Task[]; members: Member[]; disabled: boolean; onApply: (changes: Omit<TaskPatch, "version">) => Promise<void>; onClear: () => void }) {
  const [action, setAction] = useState("done"); const [assignee, setAssignee] = useState("creator"); const [date, setDate] = useState(""); const [error, setError] = useState("");
  return <form className="bulk-toolbar" aria-label="Bulk task actions" onSubmit={async event => {
    event.preventDefault(); if (disabled) return; setError("");
    const changes = action === "assign" ? { assignee_id: assignee === "creator" ? null : assignee } : action === "date" ? { due_date: date || null } : action === "trash" ? { archived: true } : { status: "done" as const };
    try { await onApply(changes); } catch (e) { setError(e instanceof Error ? e.message : "Could not update selected tasks."); }
  }}><strong>{tasks.length} selected</strong><Choice label="Bulk action" value={action} onChange={setAction} disabled={disabled} options={[{ value: "done", label: "Mark complete" }, { value: "assign", label: "Assign" }, { value: "date", label: "Change due date" }, { value: "trash", label: "Move to trash" }]} />
    {action === "assign" && <Choice label="Bulk assignee" value={assignee} onChange={setAssignee} disabled={disabled} options={[{ value: "creator", label: "Task creator" }, ...members.map(m => ({ value: m.user_id, label: m.name }))]} />}
    {action === "date" && <Input aria-label="Bulk due date, leave empty to clear" type="date" min="1900-01-01" max="9999-12-31" value={date} disabled={disabled} onChange={e => setDate(e.target.value)} />}
    <Button type="submit" disabled={disabled}>{disabled ? "Applying…" : `Apply to ${tasks.length}`}</Button><Button type="button" variant="ghost" disabled={disabled} onClick={onClear}>Clear</Button>
    {action === "trash" && <p className="text-sm muted">Selected tasks can be restored from Trash.</p>}{action === "done" && tasks.some(t => t.recurrence !== "none") && <p className="text-sm muted">Repeating tasks will create their next occurrence.</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </form>;
}

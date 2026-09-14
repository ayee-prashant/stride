"use client";
import { useEffect, useState } from "react";
import { Copy, Files, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, workspacePath } from "@/lib/client-api";
import type { Task, Member } from "@/lib/domain";
import { RECURRENCES, PRIORITIES } from "@/lib/domain";
import type { ChecklistItem, TaskTemplate } from "@/lib/productivity";
import { Choice } from "./controls";

function taskFields(task: Task | TaskTemplate["task"]) { return { title: task.title, description: task.description, priority: task.priority, assignee_id: task.assignee_id, recurrence: task.recurrence ?? "none" }; }
export function SaveTaskTemplate({ task, disabled }: { task: Task; disabled: boolean }) {
  const [name, setName] = useState(""); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <Popover open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><PopoverTrigger asChild><Button type="button" size="sm" variant="ghost" disabled={disabled}><Copy size={14} />Save as template</Button></PopoverTrigger><PopoverContent><form className="space-y-3" onSubmit={async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { const items = await api<ChecklistItem[]>(workspacePath(`tasks/${encodeURIComponent(task.id)}/checklist`, task.workspace_id)); await api(workspacePath("templates", task.workspace_id), { method: "POST", body: { name, task: taskFields(task), checklist: items.map(item => item.title) } }); setName(""); setOpen(false); } catch (e) { setError(e instanceof Error ? e.message : "Could not save template."); } finally { setBusy(false); }
  }}><p className="text-sm">Share a reusable task and checklist with this workspace.</p><Input aria-label="Template name" required maxLength={60} value={name} placeholder="e.g. Release review" disabled={busy} onChange={e => setName(e.target.value)} /><Button type="submit" disabled={busy || !name.trim()}>Save template</Button>{error && <p className="text-destructive text-sm" role="alert">{error}</p>}</form></PopoverContent></Popover>;
}

export function TemplateLibrary({ workspaceId, projectId, userId, admin, members, onCreated }: { workspaceId: string; projectId: string; userId: string; admin: boolean; members: Member[]; onCreated: (task: Task) => void }) {
  const [open, setOpen] = useState(false); const [items, setItems] = useState<TaskTemplate[]>([]); const [revision, setRevision] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [editing, setEditing] = useState<TaskTemplate | "new" | null>(null);
  const [form, setForm] = useState({ name: "", title: "", description: "", priority: "medium", assignee_id: "creator", recurrence: "none", checklist: "" });
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!open) return; const c = new AbortController(); api<TaskTemplate[]>(workspacePath("templates", workspaceId), { signal: c.signal }).then(setItems).catch(e => { if (!c.signal.aborted) setError(e.message); }); return () => c.abort(); }, [open, workspaceId, revision]);
  function edit(template: TaskTemplate | "new") {
    setEditing(template); setDirty(false); setError("");
    setForm(template === "new" ? { name: "", title: "", description: "", priority: "medium", assignee_id: "creator", recurrence: "none", checklist: "" } : { name: template.name, title: template.task.title, description: template.task.description, priority: template.task.priority, assignee_id: template.task.assignee_id ?? "creator", recurrence: template.task.recurrence ?? "none", checklist: template.checklist.join("\n") });
  }
  const change = (key: keyof typeof form, value: string) => { setForm(current => ({ ...current, [key]: value })); setDirty(true); };
  return <><Button variant="outline" size="sm" onClick={() => setOpen(true)}><Files size={14} />Templates</Button><Dialog open={open} onOpenChange={value => { if (busy) return; if (!value && dirty) { setError("Save your template or select Discard edits before closing."); return; } setOpen(value); }}><DialogContent className="template-dialog"><DialogHeader><DialogTitle>Task templates</DialogTitle><DialogDescription>Start routine work with the right details and checklist.</DialogDescription></DialogHeader>
    {error && <p className="error-box" role="alert">{error}</p>}
    {editing ? <form className="space-y-3" onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError("");
      const body = { name: form.name, task: { title: form.title, description: form.description, priority: form.priority, assignee_id: form.assignee_id === "creator" ? null : form.assignee_id, recurrence: form.recurrence }, checklist: form.checklist.split("\n").map(x => x.trim()).filter(Boolean), ...(editing !== "new" ? { version: editing.version } : {}) };
      try { await api(workspacePath(editing === "new" ? "templates" : `templates/${encodeURIComponent(editing.id)}`, workspaceId), { method: editing === "new" ? "POST" : "PATCH", body }); setDirty(false); setEditing(null); setRevision(n => n + 1); } catch (e) { setError(e instanceof Error ? e.message : "Could not save template."); } finally { setBusy(false); }
    }}><Input aria-label="Template name" placeholder="Template name" required maxLength={60} disabled={busy} value={form.name} onChange={e => change("name", e.target.value)} /><Input aria-label="Template task title" placeholder="Default task title" required maxLength={200} disabled={busy} value={form.title} onChange={e => change("title", e.target.value)} /><Textarea aria-label="Template description" placeholder="Task description" maxLength={8000} disabled={busy} value={form.description} onChange={e => change("description", e.target.value)} />
      <div className="field-grid"><Choice label="Template priority" value={form.priority} onChange={value => change("priority", value)} disabled={busy} options={PRIORITIES.map(value => ({ value, label: `${value} priority` }))} /><Choice label="Template assignee" value={form.assignee_id} onChange={value => change("assignee_id", value)} disabled={busy} options={[{ value: "creator", label: "Person using template" }, ...members.map(m => ({ value: m.user_id, label: m.name }))]} /><Choice label="Template repeat" value={form.recurrence} onChange={value => change("recurrence", value)} disabled={busy} options={RECURRENCES.map(value => ({ value, label: value === "none" ? "Does not repeat" : `Repeat ${value}` }))} /></div>
      <Textarea aria-label="Template checklist, one item per line" placeholder="Checklist: one step per line" maxLength={10050} rows={5} value={form.checklist} disabled={busy} onChange={e => change("checklist", e.target.value)} /><div className="flex gap-2"><Button type="submit" disabled={busy}>Save template</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => { setEditing(null); setDirty(false); setError(""); }}>Discard edits</Button></div>
    </form> : <><Button variant="outline" onClick={() => edit("new")} disabled={busy}><Plus size={14} />New template</Button><div className="template-list">{!items.length && <p className="muted">Create a template here, or save an existing task as a template.</p>}{items.map(item => <article key={item.id}><h3>{item.name}</h3><p>{item.task.title} · {item.checklist.length} steps</p><div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || !projectId} onClick={async () => { if (busy) return; setBusy(true); setError(""); try { const task = await api<Task>(workspacePath(`templates/${encodeURIComponent(item.id)}/use`, workspaceId), { method: "POST", body: { project_id: projectId } }); setOpen(false); onCreated(task); } catch (e) { setError(e instanceof Error ? e.message : "Could not create task."); } finally { setBusy(false); } }}>Use template</Button>{(admin || item.created_by === userId) && <><Button size="sm" variant="outline" disabled={busy} onClick={() => edit(item)}>Edit</Button><Button variant="ghost" size="icon" aria-label={`Delete template ${item.name}`} disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await api(workspacePath(`templates/${encodeURIComponent(item.id)}`, workspaceId), { method: "DELETE", body: { version: item.version } }); setRevision(n => n + 1); } catch (e) { setError(e instanceof Error ? e.message : "Could not remove template."); } finally { setBusy(false); } }}><Trash2 size={14} /></Button></>}</div></article>)}</div></>}
  </DialogContent></Dialog></>;
}

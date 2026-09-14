"use client";
import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api, workspacePath } from "@/lib/client-api";
import type { Task } from "@/lib/domain";
import type { ChecklistItem } from "@/lib/productivity";

export function TaskChecklist({ task, disabled, title, onTitleChange, onBusyChange, onChange }: { task: Task; disabled: boolean; title: string; onTitleChange: (value: string) => void; onBusyChange: (value: boolean) => void; onChange: () => void }) {
  const [items, setItems] = useState<ChecklistItem[] | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [revision, setRevision] = useState(0);
  const path = workspacePath(`tasks/${encodeURIComponent(task.id)}/checklist`, task.workspace_id);
  useEffect(() => { const controller = new AbortController(); api<ChecklistItem[]>(path, { signal: controller.signal }).then(setItems).catch(e => { if (!controller.signal.aborted) setError(e.message); }); return () => controller.abort(); }, [path, revision]);
  async function change(item: ChecklistItem | null, body: Record<string, unknown>) {
    if (busy || disabled) return; setBusy(true); onBusyChange(true); setError("");
    try {
      await api(workspacePath(`tasks/${encodeURIComponent(task.id)}/checklist${item ? `/${encodeURIComponent(item.id)}` : ""}`, task.workspace_id), { method: item ? "PATCH" : "POST", body: item ? { ...body, version: item.version } : body });
      if (!item) onTitleChange(""); setRevision(value => value + 1); onChange();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save checklist."); }
    finally { setBusy(false); onBusyChange(false); }
  }
  const locked = busy || disabled || !!task.archived_at;
  return <section className="task-checklist"><div className="section-heading"><h3>Checklist</h3><span className="muted">{items ? `${items.filter(item => item.completed).length} of ${items.length}` : "Loading…"}</span></div>
    {!!items?.length && <progress className="checklist-progress" aria-label="Checklist progress" value={items.filter(item => item.completed).length} max={items.length} />}
    <ul>{items?.map(item => <li className="checklist-row" key={item.id}><Checkbox aria-label={`Complete checklist item ${item.title}`} checked={!!item.completed} disabled={locked} onCheckedChange={value => void change(item, { completed: value === true })} /><span className={item.completed ? "completed-title" : ""}>{item.title}</span><Button size="icon" variant="ghost" aria-label={`Remove checklist item ${item.title}`} disabled={locked} onClick={() => void change(item, { remove: true })}><X size={14} /></Button></li>)}</ul>
    {!task.archived_at && <form className="checklist-add" onSubmit={event => { event.preventDefault(); void change(null, { title }); }}><Input aria-label="New checklist item" placeholder="Add a small step" value={title} maxLength={200} onChange={event => onTitleChange(event.target.value)} disabled={locked || (items?.length ?? 0) >= 50} /><Button type="submit" size="icon" variant="outline" aria-label="Add checklist item" disabled={locked || !title.trim() || (items?.length ?? 0) >= 50}><Plus size={16} /></Button></form>}
    {error && <div role="alert" className="error-box"><p>{error}</p><Button size="sm" type="button" disabled={busy} variant="outline" onClick={() => { setError(""); setRevision(n => n + 1); }}>Reload checklist</Button></div>}
  </section>;
}

"use client";
import { useEffect, useState } from "react";
import { Trash2, RotateCcw } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { api, workspacePath } from "@/lib/client-api";
import { PRIORITIES, STATUSES, STATUS_LABEL } from "@/lib/domain";
import type { Activity, CommentDraft, Member, Task, TaskPatch } from "@/lib/domain";
import { Choice } from "./controls";
import { TaskDiscussion } from "./task-discussion";

function editable(task: Task) { return { title: task.title, description: task.description, status: task.status, priority: task.priority, assignee_id: task.assignee_id, due_date: task.due_date }; }
export function TaskEditor({ task, members, onClose, onUpdate }: { task: Task; members: Member[]; onClose: () => void; onUpdate: (task: Task, patch: Omit<TaskPatch, "version">) => Promise<Task> }) {
  const [source, setSource] = useState(task); const [draft, setDraft] = useState(editable(task));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [discard, setDiscard] = useState(false);
  const [history, setHistory] = useState<Activity[]>([]); const [historyError, setHistoryError] = useState(false);
  const [commentDraft, setCommentDraft] = useState<CommentDraft>({ body: "", mentioned_user_ids: [] });
  const [commentBusy, setCommentBusy] = useState(false); const [historyRevision, setHistoryRevision] = useState(0);
  const formDirty = JSON.stringify(draft) !== JSON.stringify(editable(source));
  const dirty = formDirty || !!commentDraft.body || commentDraft.mentioned_user_ids.length > 0;
  useEffect(() => {
    const controller = new AbortController();
    api<Activity[]>(workspacePath(`tasks/${encodeURIComponent(source.id)}/activity`, source.workspace_id), { signal: controller.signal }).then(rows => { setHistory(rows); setHistoryError(false); }).catch(() => { if (!controller.signal.aborted) setHistoryError(true); });
    return () => controller.abort();
  }, [source.id, source.workspace_id, source.version, historyRevision]);
  const close = () => { if (busy || commentBusy) return; if (dirty) setDiscard(true); else onClose(); };
  async function save(patch: Omit<TaskPatch, "version">, closeAfter = false) {
    setBusy(true); setError("");
    try { const updated = await onUpdate(source, patch); setSource(updated); setDraft(editable(updated)); if (closeAfter) onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "The change could not be saved."); }
    finally { setBusy(false); }
  }
  async function reload() {
    setBusy(true);
    try { const latest = await api<Task>(workspacePath(`tasks/${encodeURIComponent(source.id)}`, source.workspace_id)); setSource(latest); setDraft(editable(latest)); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not reload."); }
    finally { setBusy(false); }
  }
  return <>
    <Sheet open onOpenChange={open => { if (!open) close(); }}><SheetContent className="task-sheet">
      <SheetHeader><p className="eyebrow">{task.project_name ?? "Task"}</p><SheetTitle>Task details</SheetTitle><SheetDescription>Edit the details. Changes are saved when you select Save.</SheetDescription></SheetHeader>
      <form className="editor-form" onSubmit={event => { event.preventDefault(); void save(draft); }}>
        <fieldset disabled={busy || !!source.archived_at} className="editor-fields">
          <div className="field"><Label htmlFor="task-title">Title</Label><Input id="task-title" value={draft.title} maxLength={200} required onChange={e => setDraft({ ...draft, title: e.target.value })} /></div>
          <div className="field"><Label htmlFor="task-description">Description</Label><Textarea id="task-description" value={draft.description} maxLength={8000} rows={6} placeholder="What needs to happen?" onChange={e => setDraft({ ...draft, description: e.target.value })} /></div>
          <div className="field-grid">
            <div className="field"><span className="field-label">Status</span><Choice label="Task status" value={draft.status} onChange={value => setDraft({ ...draft, status: value as Task["status"] })} options={STATUSES.map(value => ({ value, label: STATUS_LABEL[value] }))} /></div>
            <div className="field"><span className="field-label">Priority</span><Choice label="Task priority" value={draft.priority} onChange={value => setDraft({ ...draft, priority: value as Task["priority"] })} options={PRIORITIES.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} /></div>
            <div className="field"><span className="field-label">Assignee</span><Choice label="Task assignee" value={draft.assignee_id ?? "unassigned"} onChange={value => setDraft({ ...draft, assignee_id: value === "unassigned" ? null : value })} options={[{ value: "unassigned", label: "Task creator (default)" }, ...members.map(m => ({ value: m.user_id, label: m.name }))]} /></div>
            <div className="field"><Label htmlFor="task-due">Due date</Label><Input type="date" id="task-due" min="1900-01-01" value={draft.due_date ?? ""} onChange={e => setDraft({ ...draft, due_date: e.target.value || null })} /></div>
          </div>
        </fieldset>
        {error && <div className="error-box" role="alert"><p>{error}</p><Button type="button" variant="outline" disabled={busy} onClick={() => void reload()}>Reload latest and discard draft</Button></div>}
        <div className="editor-actions">{source.archived_at ? <Button type="button" disabled={busy || commentBusy} onClick={() => void save({ archived: false }, true)}><RotateCcw size={16} />Restore task</Button> : <><Button type="submit" disabled={busy || commentBusy || !formDirty}>{busy ? "Saving…" : "Save changes"}</Button><Button type="button" variant="ghost" disabled={busy || commentBusy || dirty} onClick={() => void save({ archived: true }, true)}><Trash2 size={16} />Move to trash</Button></>}</div>
        {dirty && <p className="muted text-sm">You have unsaved changes.</p>}
      </form>
      <TaskDiscussion task={source} members={members} draft={commentDraft} onDraftChange={setCommentDraft} onBusyChange={setCommentBusy} onPosted={() => setHistoryRevision(value => value + 1)} />
      <section className="activity-section"><h3>Activity</h3>{historyError ? <p className="muted">Activity could not be loaded.</p> : <ol>{history.map(item => <li key={item.id}><p><strong>{item.actor_name}</strong> {item.action.startsWith("status:") ? `moved this task to ${STATUS_LABEL[item.action.slice(7) as Task["status"]] ?? "another status"}` : item.action === "commented" ? "added a comment" : `${item.action} this task`}</p><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></li>)}</ol>}<p className="muted text-sm">Created {new Date(source.created_at).toLocaleDateString()} · Version {source.version}</p></section>
    </SheetContent></Sheet>
    <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle><AlertDialogDescription>Your saved task will remain unchanged.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={onClose}>Discard changes</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}

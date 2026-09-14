"use client";
import { useEffect, useState } from "react";
import { Trash2, RotateCcw, Link, BellOff } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { api, workspacePath } from "@/lib/client-api";
import { PRIORITIES, STATUSES, STATUS_LABEL, RECURRENCES } from "@/lib/domain";
import { taskLink } from "@/lib/productivity";
import type { Activity, CommentDraft, Member, Task, TaskPatch } from "@/lib/domain";
import { Choice } from "./controls";
import { TaskDiscussion } from "./task-discussion";
import { TaskChecklist } from "./task-checklist";
import { TaskFiles } from "./task-files";
import type { Attachment } from "@/lib/productivity";
import { SaveTaskTemplate } from "./templates";

function editable(task: Task) { return { title: task.title, description: task.description, status: task.status, priority: task.priority, assignee_id: task.assignee_id, due_date: task.due_date, blocked_reason: task.blocked_reason, waiting_on_id: task.waiting_on_id, recurrence: task.recurrence }; }
export function TaskEditor({ task, members, userId, admin, onClose, onUpdate, onChanged }: { task: Task; members: Member[]; userId: string; admin: boolean; onClose: () => void; onUpdate: (task: Task, patch: Omit<TaskPatch, "version">) => Promise<Task>; onChanged: () => void }) {
  const [source, setSource] = useState(task); const [draft, setDraft] = useState(editable(task));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [discard, setDiscard] = useState(false);
  const [history, setHistory] = useState<Activity[]>([]); const [historyError, setHistoryError] = useState(false);
  const [commentDraft, setCommentDraft] = useState<CommentDraft>({ body: "", mentioned_user_ids: [] });
  const [commentBusy, setCommentBusy] = useState(false); const [historyRevision, setHistoryRevision] = useState(0);
  const [file, setFile] = useState<File | null>(null); const [fileBusy, setFileBusy] = useState(false); const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [checklistDraft, setChecklistDraft] = useState(""); const [checklistBusy, setChecklistBusy] = useState(false);
  const [muted, setMuted] = useState<boolean | null>(null); const [linkCopied, setLinkCopied] = useState(false);
  const formDirty = JSON.stringify(draft) !== JSON.stringify(editable(source));
  const dirty = formDirty || !!commentDraft.body || commentDraft.mentioned_user_ids.length > 0 || !!checklistDraft || !!file;
  const collaborating = commentBusy || checklistBusy || fileBusy;
  useEffect(() => {
    if (!dirty && !busy && !collaborating) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, busy, collaborating]);
  useEffect(() => { const c = new AbortController(); api<{ muted: boolean }>(workspacePath(`tasks/${encodeURIComponent(task.id)}/mute`, task.workspace_id), { signal: c.signal }).then(value => setMuted(value.muted)).catch(() => { /* Keep the control disabled until its state is known. */ }); return () => c.abort(); }, [task.id, task.workspace_id]);
  useEffect(() => {
    const controller = new AbortController();
    api<Activity[]>(workspacePath(`tasks/${encodeURIComponent(source.id)}/activity`, source.workspace_id), { signal: controller.signal }).then(rows => { setHistory(rows); setHistoryError(false); }).catch(() => { if (!controller.signal.aborted) setHistoryError(true); });
    return () => controller.abort();
  }, [source.id, source.workspace_id, source.version, historyRevision]);
  const close = () => { if (busy || collaborating) return; if (dirty) setDiscard(true); else onClose(); };
  async function save(patch: Omit<TaskPatch, "version">, closeAfter = false) {
    if (busy || collaborating) return;
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
      <div className="task-utility-actions"><Button type="button" size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(new URL(taskLink(task.workspace_id, task.id), window.location.origin).href); setLinkCopied(true); } catch { setError("Copy the task link from your browser address bar."); } }}><Link size={14} />{linkCopied ? "Link copied" : "Copy link"}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy || muted === null} onClick={async () => { setBusy(true); try { const result = await api<{ muted: boolean }>(workspacePath(`tasks/${encodeURIComponent(task.id)}/mute`, task.workspace_id), { method: "PATCH", body: { muted: !muted } }); setMuted(result.muted); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : "Could not change notifications."); } finally { setBusy(false); } }}><BellOff size={14} />{muted ? "Unmute task" : "Mute task"}</Button>
        <SaveTaskTemplate task={source} disabled={busy || collaborating || dirty || !!source.archived_at} />
      </div>
      <form className="editor-form" onSubmit={event => { event.preventDefault(); void save(draft); }}>
        <fieldset disabled={busy || !!source.archived_at} className="editor-fields">
          <div className="field"><Label htmlFor="task-title">Title</Label><Input id="task-title" value={draft.title} maxLength={200} required onChange={e => setDraft({ ...draft, title: e.target.value })} /></div>
          <div className="field"><Label htmlFor="task-description">Description</Label><Textarea id="task-description" value={draft.description} maxLength={8000} rows={6} placeholder="What needs to happen?" onChange={e => setDraft({ ...draft, description: e.target.value })} /></div>
          <div className="field-grid">
            <div className="field"><span className="field-label">Status</span><Choice label="Task status" value={draft.status} onChange={value => setDraft({ ...draft, status: value as Task["status"] })} options={STATUSES.map(value => ({ value, label: STATUS_LABEL[value] }))} /></div>
            <div className="field"><span className="field-label">Priority</span><Choice label="Task priority" value={draft.priority} onChange={value => setDraft({ ...draft, priority: value as Task["priority"] })} options={PRIORITIES.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} /></div>
            <div className="field"><span className="field-label">Assignee</span><Choice label="Task assignee" value={draft.assignee_id ?? "unassigned"} onChange={value => setDraft({ ...draft, assignee_id: value === "unassigned" ? null : value })} options={[{ value: "unassigned", label: "Task creator (default)" }, ...members.map(m => ({ value: m.user_id, label: m.name }))]} /></div>
            <div className="field"><Label htmlFor="task-due">Due date</Label><Input type="date" id="task-due" min="1900-01-01" value={draft.due_date ?? ""} onChange={e => setDraft({ ...draft, due_date: e.target.value || null })} /></div>
            <div className="field"><span className="field-label">Repeat after completion</span><Choice label="Repeat task" value={draft.recurrence} onChange={value => setDraft({ ...draft, recurrence: value as Task["recurrence"] })} options={RECURRENCES.map(value => ({ value, label: value === "none" ? "Does not repeat" : value[0].toUpperCase() + value.slice(1) }))} /></div>
          </div>
          <div className="field"><Label htmlFor="task-blocked">Blocker reason</Label><Input id="task-blocked" value={draft.blocked_reason} maxLength={500} placeholder="What is preventing progress? Leave empty if unblocked." onChange={e => setDraft({ ...draft, blocked_reason: e.target.value, waiting_on_id: e.target.value ? draft.waiting_on_id : null })} /></div>
          {!!draft.blocked_reason && <div className="field"><span className="field-label">Waiting for</span><Choice label="Waiting for teammate" value={draft.waiting_on_id ?? "none"} onChange={value => setDraft({ ...draft, waiting_on_id: value === "none" ? null : value })} options={[{ value: "none", label: "No specific teammate" }, ...members.map(member => ({ value: member.user_id, label: member.name }))]} /></div>}
          {draft.recurrence !== "none" && <p className="text-sm muted">Completing this task creates one new task with an unchecked checklist. Its due date follows the later of today or this task’s due date. Reopening this task keeps the next occurrence.</p>}
        </fieldset>
        {error && <div className="error-box" role="alert"><p>{error}</p><Button type="button" variant="outline" disabled={busy} onClick={() => void reload()}>Reload latest and discard draft</Button></div>}
        <div className="editor-actions">{source.archived_at ? <Button type="button" disabled={busy || collaborating} onClick={() => void save({ archived: false }, true)}><RotateCcw size={16} />Restore task</Button> : <><Button type="submit" disabled={busy || collaborating || !formDirty}>{busy ? "Saving…" : "Save changes"}</Button><Button type="button" variant="ghost" disabled={busy || collaborating || dirty} onClick={() => void save({ archived: true }, true)}><Trash2 size={16} />Move to trash</Button></>}</div>
        {dirty && <p className="muted text-sm">You have unsaved changes.</p>}
      </form>
      <TaskChecklist task={source} disabled={busy || collaborating} title={checklistDraft} onTitleChange={setChecklistDraft} onBusyChange={setChecklistBusy} onChange={() => { setHistoryRevision(n => n + 1); onChanged(); }} />
      <TaskFiles task={source} userId={userId} admin={admin} disabled={busy || commentBusy || checklistBusy} file={file} onFileChange={setFile} onBusyChange={setFileBusy} onChanged={setAttachments} revision={historyRevision} />
      <TaskDiscussion task={source} attachments={attachments} disabled={busy || checklistBusy || fileBusy} members={members} draft={commentDraft} onDraftChange={setCommentDraft} onBusyChange={setCommentBusy} onPosted={() => { setHistoryRevision(value => value + 1); onChanged(); }} />
      <section className="activity-section"><h3>Activity</h3>{historyError ? <p className="muted">Activity could not be loaded.</p> : <ol>{history.map(item => <li key={item.id}><p><strong>{item.actor_name}</strong> {item.action.startsWith("status:") ? `moved this task to ${STATUS_LABEL[item.action.slice(7) as Task["status"]] ?? "another status"}` : item.action === "commented" ? "added a comment" : `${item.action} this task`}</p><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></li>)}</ol>}<p className="muted text-sm">Created {new Date(source.created_at).toLocaleDateString()} · Version {source.version}</p></section>
    </SheetContent></Sheet>
    <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle><AlertDialogDescription>Your saved task will remain unchanged.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={onClose}>Discard changes</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}

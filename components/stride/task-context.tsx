"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api, workspacePath } from "@/lib/client-api";
import type { ProjectBrief, TaskBriefResult } from "@/lib/context";
import type { Task } from "@/lib/domain";

export function TaskContext({ task, disabled, onBusyChange, onDirtyChange }: { task: Task; disabled: boolean; onBusyChange: (busy: boolean) => void; onDirtyChange: (dirty: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ project: ProjectBrief; result: TaskBriefResult } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null);
  const receipt = useRef({ input: "", id: "" }); const selectionEdited = useRef(false);
  const taskPath = workspacePath(`tasks/${encodeURIComponent(task.id)}/context`, task.workspace_id);
  const projectPath = workspacePath(`projects/${encodeURIComponent(task.project_id)}/context`, task.workspace_id);
  const refresh = useCallback(async () => {
    controller.current?.abort(); const c = new AbortController(); controller.current = c;
    try {
      const [project, result] = await Promise.all([api<ProjectBrief>(projectPath, { signal: c.signal }), api<TaskBriefResult>(taskPath, { signal: c.signal })]);
      if (!c.signal.aborted) {
        setData({ project, result }); setError("");
        if (!selectionEdited.current) setSelected(result.brief?.payload.documents.filter(d => d.kind === "requirement").map(d => d.document_id) ?? []);
      }
    } catch (e) { if (!c.signal.aborted) { setData(null); setError(e instanceof Error ? e.message : "The task brief could not be loaded."); } }
  }, [projectPath, taskPath]);
  useEffect(() => { if (!open) return; void refresh(); const focus = () => { if (!lock.current) void refresh(); }; window.addEventListener("focus", focus); return () => { controller.current?.abort(); window.removeEventListener("focus", focus); }; }, [open, refresh, task.version]);
  async function prepare() {
    if (disabled || lock.current || !data) return; lock.current = true; setBusy(true); onBusyChange(true); setError(""); setNotice("");
    controller.current?.abort();
    const input = { task_version: task.version, requirement_ids: [...selected].sort(), context_sequence: data.project.sequence };
    const signature = JSON.stringify(input); if (signature !== receipt.current.input) receipt.current = { input: signature, id: crypto.randomUUID() };
    try {
      const result = await api<TaskBriefResult>(taskPath, { method: "POST", body: { ...input, request_id: receipt.current.id } });
      setData({ ...data, result }); selectionEdited.current = false; onDirtyChange(false); setNotice("Task brief prepared. Review the saved context below.");
    } catch (e) { setError(e instanceof Error ? e.message : "The task brief could not be prepared."); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  }
  const requirements = data?.project.documents.filter(d => d.kind === "requirement" && d.state === "active") ?? [];
  const unavailable = selected.some(id => !requirements.some(d => d.document_id === id));
  return <section className="task-context-section"><button type="button" className="task-context-toggle" aria-expanded={open} onClick={() => setOpen(!open)}><BookOpen size={17} /><span>Task brief</span><span>{open ? "Hide" : "Review context"}</span></button>{open && <div className="task-context-content">
    <p className="muted text-sm">Link this task to approved requirements. Project decisions and constraints are included automatically.</p>
    {error && <p className="error-box" role="alert">{error} Your selection is preserved. Refresh to review the current context.</p>}
    <Button type="button" size="sm" variant="ghost" disabled={busy || disabled} onClick={() => void refresh()}><RefreshCw size={14} />Refresh context</Button>
    {!data && !error ? <p role="status">Loading task context…</p> : data && <>
      {data.result.brief && <div className={`task-brief-status brief-${data.result.check?.state}`}><strong>{data.result.check?.state === "current" ? "Brief is current" : data.result.check?.state === "stale" ? "Brief needs a review" : "Brief is unavailable for work"}</strong>{data.result.check?.reasons.map(reason => <p key={reason}>{reason}</p>)}</div>}
      {!requirements.length ? <p className="muted">Publish a requirement in Project brief first.</p> : <fieldset className="brief-requirement-picker" disabled={disabled || busy || !!task.archived_at || task.status === "done"}><legend>Relevant requirements <span className="muted">({selected.length}/20)</span></legend>{requirements.map(doc => <label key={doc.document_id}><Checkbox checked={selected.includes(doc.document_id)} disabled={!selected.includes(doc.document_id) && selected.length >= 20} onCheckedChange={checked => { setSelected(current => checked === true ? [...current, doc.document_id] : current.filter(id => id !== doc.document_id)); selectionEdited.current = true; onDirtyChange(true); setNotice(""); }} /><span>{doc.title}<small>Version {doc.version}</small></span></label>)}</fieldset>}
      {unavailable && <div className="error-box"><p>A previously linked requirement was retired. Review the remaining selection.</p><Button type="button" variant="outline" size="sm" disabled={busy || disabled} onClick={() => { setSelected(selected.filter(id => requirements.some(d => d.document_id === id))); selectionEdited.current = true; onDirtyChange(true); }}>Remove retired selections</Button></div>}
      {disabled && <p className="muted text-sm">Save task changes and finish other updates before preparing the brief.</p>}
      <Button type="button" disabled={busy || disabled || unavailable || !selected.length || !!task.archived_at || task.status === "done"} onClick={() => void prepare()}>{busy ? "Preparing…" : data.result.brief ? "Prepare updated brief" : "Prepare task brief"}</Button>
      {notice && <p role="status">{notice}</p>}
      {data.result.brief && <details className="saved-task-brief"><summary>Read the saved brief</summary><h4>{data.result.brief.payload.task.title}</h4><p className="brief-body">{data.result.brief.payload.task.description || "No additional task description."}</p>{data.result.brief.payload.documents.map(doc => <section key={doc.document_id}><h4>{doc.title} <span className="muted">v{doc.version} · {doc.kind}</span></h4><p className="brief-body">{doc.body}</p></section>)}<p className="muted text-sm">Prepared {new Date(data.result.brief.created_at).toLocaleString()}. This saved copy is preserved when requirements change.</p></details>}
    </>}
    <p className="brief-integration-note">GitHub verification and agent start approvals are not connected yet. This brief does not authorize execution.</p>
  </div>}</section>;
}

"use client";
import { useEffect, useState } from "react";
import { Download, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, workspacePath } from "@/lib/client-api";
import type { CommentPage, Task } from "@/lib/domain";
import type { Attachment } from "@/lib/productivity";
import { Choice } from "./controls";

export function TaskFiles({ task, userId, admin, disabled, file, onFileChange, onBusyChange, onChanged, revision }: { task: Task; userId: string; admin: boolean; disabled: boolean; file: File | null; onFileChange: (file: File | null) => void; onBusyChange: (busy: boolean) => void; onChanged: (files: Attachment[]) => void; revision: number }) {
  const [enabled, setEnabled] = useState<boolean | null>(null); const [files, setFiles] = useState<Attachment[]>([]); const [comments, setComments] = useState<CommentPage["comments"]>([]); const [commentId, setCommentId] = useState("task"); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [reload, setReload] = useState(0); const [inputKey, setInputKey] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    api<{ attachments: boolean }>(workspacePath("capabilities", task.workspace_id), { signal: c.signal }).then(async capability => {
      if (c.signal.aborted) return; setEnabled(capability.attachments); if (!capability.attachments) return;
      const [items, discussion] = await Promise.all([api<Attachment[]>(workspacePath(`tasks/${encodeURIComponent(task.id)}/files`, task.workspace_id), { signal: c.signal }), api<CommentPage>(workspacePath(`tasks/${encodeURIComponent(task.id)}/comments`, task.workspace_id), { signal: c.signal })]);
      if (!c.signal.aborted) { setFiles(items); onChanged(items); setComments(discussion.comments); }
    }).catch(e => { if (!c.signal.aborted) setError(e.message); }); return () => c.abort();
  }, [task.id, task.workspace_id, reload, revision, onChanged]);
  async function upload() {
    if (!file || busy || disabled) return; if (file.size > 5 * 1024 * 1024 || !file.size) { setError("Choose a file between 1 byte and 5 MB."); return; }
    setBusy(true); onBusyChange(true); setError("");
    try {
      const params = new URLSearchParams({ workspace_id: task.workspace_id, task_id: task.id, ...(commentId !== "task" ? { comment_id: commentId } : {}) });
      const response = await fetch(`/api/files?${params}`, { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(45000), headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) }, body: file });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? "Upload failed.");
      onFileChange(null); setInputKey(n => n + 1); setReload(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "We could not confirm the upload. Refresh the file list before retrying."); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <section className="task-files"><div className="section-heading"><h3>Attachments</h3><Paperclip size={16} /></div>
    {enabled === false ? <p className="muted text-sm">File uploads become available when the workspace’s file storage is connected.</p> : enabled === null && !error ? <p role="status" className="muted">Loading attachments…</p> : <>
      <ul>{files.map(item => <li key={item.id}><a href={`/api/files?${new URLSearchParams({ workspace_id: task.workspace_id, id: item.id })}`} download rel="noreferrer"><Download size={14} /><span>{item.filename}<small>{Math.ceil(item.byte_size / 1024)} KB{item.comment_id ? " · comment attachment" : ""}</small></span></a>{(admin || item.uploaded_by === userId) && <Button type="button" variant="ghost" size="icon" aria-label={`Remove attachment ${item.filename}`} disabled={busy || disabled} onClick={async () => { setBusy(true); onBusyChange(true); setError(""); try { await api(workspacePath(`files/${encodeURIComponent(item.id)}`, task.workspace_id), { method: "DELETE", body: {} }); setReload(n => n + 1); } catch (e) { setError(e instanceof Error ? e.message : "Could not remove file."); } finally { setBusy(false); onBusyChange(false); } }}><Trash2 size={14} /></Button>}</li>)}</ul>
      {!task.archived_at && enabled && <div className="space-y-3"><Input key={inputKey} aria-label="Choose task attachment" type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.csv" disabled={busy || disabled || files.length >= 20} onChange={e => onFileChange(e.target.files?.[0] ?? null)} />{file && <><Choice label="Attach file to" value={commentId} onChange={setCommentId} disabled={busy || disabled} options={[{ value: "task", label: "This task" }, ...comments.map(comment => ({ value: comment.id, label: `${comment.author_name}: ${comment.body.slice(0, 50)}` }))]} /><div className="flex gap-2"><Button type="button" size="sm" disabled={busy || disabled} onClick={() => void upload()}>{busy ? "Uploading…" : "Upload file"}</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { onFileChange(null); setInputKey(n => n + 1); }}>Clear file</Button></div></>}<p className="muted text-xs">PNG, JPEG, WebP, PDF, TXT or CSV · 5 MB per file · 20 files per task</p></div>}
    </>}{error && <div className="error-box" role="alert"><p>{error}</p><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setError(""); setReload(n => n + 1); }}>Refresh files</Button></div>}
  </section>;
}

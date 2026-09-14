"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, History, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { api, workspacePath } from "@/lib/client-api";
import { CONTEXT_KINDS } from "@/lib/context";
import type { ContextKind, ContextPublish, ContextRevision, ProjectBrief } from "@/lib/context";
import type { Member } from "@/lib/domain";
import { Choice } from "./controls";

const kindLabels: Record<ContextKind, string> = { requirement: "Requirements", decision: "Decisions", constraint: "Constraints" };
const kindHelp: Record<ContextKind, string> = {
  requirement: "What the product must do, with clear acceptance criteria. Select the relevant requirements for each task.",
  decision: "Approved architecture and design choices. Active decisions accompany every task brief in this project.",
  constraint: "Rules every contribution must follow. Active constraints accompany every task brief in this project.",
};
const errorMessage = (e: unknown) => e instanceof Error ? e.message : "Project context could not be loaded.";
const person = (id: string, members: Member[]) => members.find(m => m.user_id === id)?.name ?? "Former workspace member";

export function ProjectContext({ workspaceId, projectId, members }: { workspaceId: string; projectId: string; members: Member[] }) {
  const [data, setData] = useState<ProjectBrief | null>(null);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(""); const [retired, setRetired] = useState(false);
  const [editing, setEditing] = useState<ContextRevision | "new" | null>(null);
  const [history, setHistory] = useState<ContextRevision | null>(null);
  const controller = useRef<AbortController | null>(null);
  const path = workspacePath(`projects/${encodeURIComponent(projectId)}/context`, workspaceId);
  const refresh = useCallback(async () => {
    controller.current?.abort(); const c = new AbortController(); controller.current = c;
    setLoading(true);
    try { const latest = await api<ProjectBrief>(path, { signal: c.signal }); if (!c.signal.aborted) { setData(latest); setError(""); } }
    catch (e) { if (!c.signal.aborted) { setError(errorMessage(e)); setData(null); } }
    finally { if (!c.signal.aborted) setLoading(false); }
  }, [path]);
  useEffect(() => { void refresh(); const focus = () => { void refresh(); }; window.addEventListener("focus", focus); return () => { controller.current?.abort(); window.removeEventListener("focus", focus); }; }, [refresh]);
  const needle = query.trim().toLowerCase();
  const visible = data?.documents.filter(d => (retired || d.state === "active") && (!needle || `${d.title} ${d.body}`.toLowerCase().includes(needle))) ?? [];
  return <section className="project-brief" aria-label="Project brief">
    <div className="brief-intro"><div className="brief-intro-icon"><BookOpen size={23} /></div><div><h2>One shared project brief</h2><p>Humans publish the requirements and decisions. Each task keeps the exact version it was prepared from.</p></div></div>
    <div className="brief-toolbar"><Input aria-label="Search project context" placeholder="Find a requirement or decision…" value={query} onChange={e => setQuery(e.target.value)} maxLength={200} /><label className="brief-retired"><input type="checkbox" checked={retired} onChange={e => setRetired(e.target.checked)} />Show retired</label><Button variant="outline" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} />Refresh</Button>{data?.can_publish && <Button onClick={() => setEditing("new")}><Plus size={16} />Publish context</Button>}</div>
    {error && <p role="alert" className="error-box">{error}</p>}
    {loading && !data ? <p role="status" className="muted">Loading the project brief…</p> : data && <>
      <p className="brief-authority"><ShieldCheck size={15} />Published by workspace admins · {data.documents.filter(d => d.state === "active").length} active documents</p>
      {!data.documents.length && <div className="brief-empty"><h3>Give your team a shared starting point</h3><p>{data.can_publish ? "Publish one requirement describing the next useful outcome. Then open a task and link it to that requirement." : "A workspace admin can publish the first requirement. You can then use it to prepare a task brief."}</p></div>}
      {!!data.documents.length && !visible.length && <p className="muted">No context matches these filters.</p>}
      {CONTEXT_KINDS.map(kind => { const documents = visible.filter(d => d.kind === kind); return documents.length ? <section className="brief-group" key={kind}><div><h3>{kindLabels[kind]} <span>{documents.length}</span></h3><p className="muted">{kindHelp[kind]}</p></div><div className="brief-document-list">{documents.map(doc => <article className={`brief-document ${doc.state === "retired" ? "brief-retired-document" : ""}`} key={doc.document_id}><div className="brief-document-heading"><h4>{doc.title}</h4><span className="brief-version">v{doc.version}{doc.state === "retired" ? " · Retired" : ""}</span></div><p className="brief-body">{doc.body}</p><div className="brief-document-footer"><span>Published by {person(doc.approved_by, members)} · <time dateTime={doc.approved_at}>{new Date(doc.approved_at).toLocaleDateString()}</time></span><div><Button size="sm" variant="ghost" onClick={() => setHistory(doc)} aria-label={`History of ${doc.title}`}><History size={14} />History</Button>{data.can_publish && <Button size="sm" variant="outline" onClick={() => setEditing(doc)} aria-label={`Revise ${doc.title}`}>Revise</Button>}</div></div></article>)}</div></section> : null; })}
    </>}
    <p className="brief-integration-note">GitHub verification and agent connections are being built. Preparing a brief does not start an agent.</p>
    {editing && <ContextDocumentEditor key={editing === "new" ? "new" : editing.document_id} workspaceId={workspaceId} projectId={projectId} document={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onPublished={() => { setEditing(null); void refresh(); }} />}
    {history && <ContextHistory document={history} members={members} onClose={() => setHistory(null)} />}
  </section>;
}

function ContextDocumentEditor({ workspaceId, projectId, document, onClose, onPublished }: { workspaceId: string; projectId: string; document?: ContextRevision; onClose: () => void; onPublished: () => void }) {
  const [source, setSource] = useState(document);
  const [draft, setDraft] = useState({ kind: document?.kind ?? "requirement", title: document?.title ?? "", body: document?.body ?? "", state: document?.state ?? "active", change_note: "" });
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [error, setError] = useState(""); const [discard, setDiscard] = useState(false);
  const [latest, setLatest] = useState<ContextRevision | null>(null);
  const receipt = useRef({ input: "", id: "" });
  const dirty = draft.title !== (document?.title ?? "") || draft.body !== (document?.body ?? "") || draft.state !== (document?.state ?? "active") || !!draft.change_note;
  useEffect(() => { if (!dirty && !busy) return; const guard = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty, busy]);
  const close = () => { if (busy) return; if (dirty) setDiscard(true); else onClose(); };
  async function publish() {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    const input = { ...draft, document_id: source?.document_id ?? null, expected_version: source?.version ?? 0 };
    const signature = JSON.stringify(input);
    if (receipt.current.input !== signature) receipt.current = { input: signature, id: crypto.randomUUID() };
    try { await api<ContextRevision>(workspacePath(`projects/${encodeURIComponent(projectId)}/context/documents`, workspaceId), { method: "POST", body: { ...input, request_id: receipt.current.id } satisfies ContextPublish }); onPublished(); }
    catch (e) { setError(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function compareLatest() {
    if (lock.current || !source) return; lock.current = true; setBusy(true);
    try { const data = await api<ProjectBrief>(workspacePath(`projects/${encodeURIComponent(projectId)}/context`, workspaceId)); const current = data.documents.find(d => d.document_id === source.document_id); if (!current) throw new Error("This document is no longer available."); setLatest(current); }
    catch (e) { setError(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <><Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="context-editor-dialog"><DialogHeader><DialogTitle>{source ? "Publish a revision" : "Publish project context"}</DialogTitle><DialogDescription>{source ? `Your changes create a new version. Version ${source.version} remains in the history.` : "Publish the agreed scope so everyone can work from the same requirements."}</DialogDescription></DialogHeader>
    <form className="editor-fields" onSubmit={e => { e.preventDefault(); void publish(); }}>
      <div className="field"><Label>Type</Label><Choice label="Context type" value={draft.kind} onChange={value => setDraft({ ...draft, kind: value as ContextKind })} disabled={busy || !!source} options={CONTEXT_KINDS.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} /><p className="muted text-sm">{kindHelp[draft.kind]}</p></div>
      <div className="field"><Label htmlFor="context-title">Title</Label><Input id="context-title" autoFocus value={draft.title} required maxLength={200} disabled={busy} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Users can reset their password" /></div>
      <div className="field"><Label htmlFor="context-body">{draft.kind === "requirement" ? "Requirement and acceptance criteria" : "Approved decision or rule"}</Label><Textarea id="context-body" value={draft.body} required maxLength={6000} rows={8} disabled={busy} onChange={e => setDraft({ ...draft, body: e.target.value })} placeholder="Describe the expected behavior, scope limits, and how to verify it." /></div>
      <div className="field"><Label htmlFor="context-reason">Why are you publishing this?</Label><Textarea id="context-reason" value={draft.change_note} required maxLength={500} rows={2} disabled={busy} onChange={e => setDraft({ ...draft, change_note: e.target.value })} placeholder="Briefly record the reason for this decision." /></div>
      {source && <div className="field"><Label>Availability</Label><Choice label="Document availability" value={draft.state} onChange={value => setDraft({ ...draft, state: value as "active" | "retired" })} disabled={busy} options={[{ value: "active", label: "Active" }, { value: "retired", label: "Retired — keep the history" }]} /></div>}
      {error && <div role="alert" className="error-box"><p>{error}</p><p>Your draft is preserved.</p>{source && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void compareLatest()}>Compare with latest version</Button>}</div>}
      {latest && <section className="brief-comparison"><h3>Current published version: v{latest.version}</h3><strong>{latest.title}</strong><p className="brief-body">{latest.body}</p><p>State: {latest.state}. Your draft remains in the form above.</p><Button type="button" variant="outline" disabled={busy} onClick={() => { setSource(latest); setLatest(null); setError(""); }}>Use v{latest.version} as my base</Button></section>}
      <p className="muted text-sm">Publishing changes makes affected task briefs stale. Teammates must review the new version before preparing an updated brief.</p>
      <Button type="submit" disabled={busy || !draft.title.trim() || !draft.body.trim() || !draft.change_note.trim()}>{busy ? "Publishing…" : "Publish approved context"}</Button>
    </form></DialogContent></Dialog>
    <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard your context draft?</AlertDialogTitle><AlertDialogDescription>The published project context will keep its current version.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={onClose}>Discard draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}

function ContextHistory({ document, members, onClose }: { document: ContextRevision; members: Member[]; onClose: () => void }) {
  const [page, setPage] = useState<{ revisions: ContextRevision[]; next_before: number | null } | null>(null);
  const [before, setBefore] = useState(0); const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  useEffect(() => { const c = new AbortController(); const path = `${workspacePath(`projects/${encodeURIComponent(document.project_id)}/context/documents/${encodeURIComponent(document.document_id)}`, document.workspace_id)}&before=${before}`; api<{ revisions: ContextRevision[]; next_before: number | null }>(path, { signal: c.signal }).then(result => { if (!c.signal.aborted) { setPage(result); setError(""); } }).catch(e => { if (!c.signal.aborted) { setPage(null); setError(errorMessage(e)); } }); return () => c.abort(); }, [document, before, retry]);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="context-editor-dialog"><DialogHeader><DialogTitle>Publication history</DialogTitle><DialogDescription>{document.title}. Each published version keeps its original content and approver.</DialogDescription></DialogHeader>{error ? <div role="alert" className="error-box">{error}<Button variant="outline" onClick={() => setRetry(n => n + 1)}>Retry</Button></div> : !page ? <p role="status">Loading history…</p> : <><ol className="brief-history">{page.revisions.map(row => <li key={row.version}><strong>Version {row.version} · {row.state}</strong><p>{person(row.approved_by, members)} · {new Date(row.approved_at).toLocaleString()}</p><p>{row.change_note}</p><details><summary>Read this version</summary><h3>{row.title}</h3><p className="brief-body">{row.body}</p></details></li>)}</ol><div className="inline-actions"><Button variant="outline" disabled={before === 0} onClick={() => { setPage(null); setBefore(0); }}>Latest versions</Button><Button variant="outline" disabled={page.next_before === null} onClick={() => { setBefore(page.next_before ?? 0); setPage(null); }}>Older versions</Button></div></>}</DialogContent></Dialog>;
}

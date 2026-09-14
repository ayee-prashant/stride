"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { api, workspacePath } from "@/lib/client-api";
import { AGENT_ROLES, AGENT_ROLE_LABELS } from "@/lib/agents";
import type { AgentBinding, AgentMutationResult, AgentProfile, AgentRole, AgentRoleEvent, AgentTemplate } from "@/lib/agents";
import type { Member } from "@/lib/domain";
import { Choice } from "./controls";

type Props = { mode: "new" | "review" | "configure" | "history"; bindingId?: string; workspaceId: string; projectId: string; profiles: AgentProfile[]; members: Member[]; userId: string; onClose: () => void; onSaved: (result: AgentMutationResult) => void };
const errorMessage = (e: unknown) => e instanceof Error ? e.message : "This role could not be saved.";
const section = (body: string, title: string) => body.split(`## ${title}\n`)[1]?.split("\n## ")[0].trim() ?? "";
const splitPaths = (value: string) => value.split("\n").map(s => s.trim()).filter(Boolean);

export function AgentRoleDialog(props: Props) {
  return props.mode === "history" && props.bindingId ? <AgentRoleHistory {...props} bindingId={props.bindingId} /> : <RoleEditor {...props} />;
}
function RoleEditor({ mode, bindingId, workspaceId, projectId, profiles, members, userId, onClose, onSaved }: Props) {
  const [source, setSource] = useState<AgentBinding | null>(null);
  const [templateResult, setTemplateResult] = useState<{ key: string; data: AgentTemplate | null; error: string } | null>(null);
  const [draft, setDraft] = useState({ profile: "new", alias: "", operator: userId, tool: "", role: "development" as AgentRole, read: "", write: "", reason: "" });
  const [error, setError] = useState(""); const [sourceError, setSourceError] = useState(""); const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false); const [discard, setDiscard] = useState(false); const [reviewed, setReviewed] = useState(false);
  const lock = useRef(false); const receipt = useRef({ signature: "", id: "" }); const loaded = useRef(false);
  const editable = mode === "new" || mode === "configure";
  const sourceVersion = source?.version ?? 0;
  const templateKey = `${workspaceId}:${projectId}:${draft.role}:${sourceVersion}:${retry}`;
  const template = templateResult?.key === templateKey ? templateResult.data : null;
  const loadError = sourceError || (templateResult?.key === templateKey ? templateResult.error : "");
  const endpoint = (suffix = "") => workspacePath(`projects/${encodeURIComponent(projectId)}/agents${suffix}`, workspaceId);
  const basePath = workspacePath(`projects/${encodeURIComponent(projectId)}/agents`, workspaceId);
  const dirty = !!draft.reason || reviewed || (editable && (draft.read !== (source?.read_paths.join("\n") ?? "") || draft.write !== (source?.write_paths.join("\n") ?? ""))) || (mode === "new" && (!!draft.alias || !!draft.tool || draft.profile !== "new" || draft.operator !== userId || draft.role !== "development"));
  useEffect(() => {
    if (!bindingId) return;
    const c = new AbortController();
    api<AgentBinding>(workspacePath(`projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(bindingId)}`, workspaceId), { signal: c.signal }).then(result => {
      if (c.signal.aborted) return; setSource(result); setSourceError(""); setReviewed(false);
      if (!loaded.current) { setDraft(d => ({ ...d, role: result.role_id, read: result.read_paths.join("\n"), write: result.write_paths.join("\n") })); loaded.current = true; }
    }).catch(e => { if (!c.signal.aborted) { setSource(null); setSourceError(errorMessage(e)); } });
    return () => c.abort();
  }, [bindingId, workspaceId, projectId, retry]);
  useEffect(() => {
    if (!editable || (bindingId && !sourceVersion)) return;
    const c = new AbortController();
    api<AgentTemplate>(workspacePath(`projects/${encodeURIComponent(projectId)}/agents/roles/${draft.role}`, workspaceId), { signal: c.signal })
      .then(result => { if (!c.signal.aborted) setTemplateResult({ key: templateKey, data: result, error: "" }); })
      .catch(e => { if (!c.signal.aborted) setTemplateResult({ key: templateKey, data: null, error: errorMessage(e) }); });
    return () => c.abort();
  }, [draft.role, editable, bindingId, sourceVersion, workspaceId, projectId, templateKey]);
  useEffect(() => { if (!dirty && !busy) return; const guard = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty, busy]);
  const close = () => { if (busy) return; if (dirty) setDiscard(true); else onClose(); };
  const prompt = editable ? template?.body ?? "" : source?.template_body ?? "";
  async function submit(action: "save" | "initialize" | "revoke") {
    if (lock.current || !draft.reason.trim() || loadError || (action !== "revoke" && !reviewed)) return;
    lock.current = true; setBusy(true); setError("");
    try {
      let path = basePath; let method = "POST"; let input: Record<string, unknown>;
      if (action === "save") {
        if (!template || (mode === "configure" && !source)) return;
        input = { template_hash: template.hash, read_paths: splitPaths(draft.read), write_paths: splitPaths(draft.write), reason: draft.reason };
        if (mode === "new") input = { ...input, profile: draft.profile === "new" ? { alias: draft.alias, operator_id: draft.operator, tool_label: draft.tool } : { id: draft.profile }, role_id: draft.role };
        else { path = endpoint(`/${encodeURIComponent(bindingId!)}`); method = "PATCH"; input.expected_version = source!.version; }
      } else {
        if (!source) return;
        path = endpoint(`/${encodeURIComponent(source.id)}/${action}`);
        input = { expected_version: source.version, reason: draft.reason, ...(action === "initialize" ? { template_hash: source.template_hash } : {}) };
      }
      const signature = JSON.stringify({ path, method, input });
      if (receipt.current.signature !== signature) receipt.current = { signature, id: crypto.randomUUID() };
      onSaved(await api<AgentMutationResult>(path, { method, body: { ...input, request_id: receipt.current.id } }));
    } catch (e) { setError(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  const canDecide = editable || source?.can_initialize || source?.can_revoke;
  const ready = !busy && !loadError && !!prompt && (!bindingId || !!source);
  return <><Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="context-editor-dialog context-three-pane-dialog agent-role-dialog"><DialogHeader><DialogTitle>{mode === "new" ? "Propose an agent role" : mode === "configure" ? "Revise agent role scope" : "Review agent role"}</DialogTitle><DialogDescription>A human owns this profile. Review responsibilities, exclusions and file scope before recording a decision.</DialogDescription></DialogHeader>
    {loadError && <p role="alert" className="error-box">{loadError} <Button variant="outline" disabled={busy} onClick={() => setRetry(n => n + 1)}>Reload role</Button></p>}
    {bindingId && !source && !loadError ? <p role="status">Loading the role configuration…</p> : <form className="context-three-pane" onSubmit={e => { e.preventDefault(); if (editable || source?.can_initialize) void submit(editable ? "save" : "initialize"); }}>
      <section className="context-pane editor-fields"><div className="context-pane-heading"><span>01</span><h3>Profile and responsibility</h3></div>
        {mode === "new" ? <><div className="field"><Label>Profile</Label><Choice label="Agent profile" value={draft.profile} onChange={value => { setDraft({ ...draft, profile: value }); setReviewed(false); }} disabled={busy} options={[{ value: "new", label: "Create a new profile" }, ...profiles.filter(p => p.operator_available).map(p => ({ value: p.id, label: `${p.alias} · ${p.operator_name}` }))]} /></div>{draft.profile === "new" && <><div className="field"><Label htmlFor="agent-alias">Agent alias</Label><Input id="agent-alias" autoFocus required maxLength={60} value={draft.alias} disabled={busy} onChange={e => { setDraft({ ...draft, alias: e.target.value }); setReviewed(false); }} placeholder="DEV-1" /></div><div className="field"><Label>Human operator</Label><Choice label="Human operator" value={draft.operator} disabled={busy} onChange={value => { setDraft({ ...draft, operator: value }); setReviewed(false); }} options={members.map(m => ({ value: m.user_id, label: m.name }))} /></div><div className="field"><Label htmlFor="agent-tool">Tool / model label (optional)</Label><Input id="agent-tool" maxLength={80} value={draft.tool} disabled={busy} onChange={e => { setDraft({ ...draft, tool: e.target.value }); setReviewed(false); }} placeholder="e.g. Codex in VS Code" /><p className="muted text-sm">A reported label; it does not verify a connection.</p></div></>}<div className="field"><Label>Role</Label><Choice label="Agent role" value={draft.role} disabled={busy} onChange={value => { setDraft({ ...draft, role: value as AgentRole }); setReviewed(false); }} options={AGENT_ROLES.map(role => ({ value: role, label: AGENT_ROLE_LABELS[role] }))} /></div></> : source && <><h4>{source.alias} · {AGENT_ROLE_LABELS[source.role_id]}</h4><p>Human operator: <strong>{source.operator_name}</strong></p><p className="agent-identity">Profile ID <code>{source.profile_id}</code></p><p>Configuration v{source.version} · {source.state}</p>{source.approved_at && <p className="muted">Operator accepted {new Date(source.approved_at).toLocaleString()}</p>}<p className="muted">Not connected · no execution authorization</p></>}
        <div className="agent-role-section"><h4>Responsible for</h4><p>{section(prompt, "Responsibilities") || "Loading the role prompt…"}</p></div>
        {mode === "configure" && source && <details className="agent-previous"><summary>Read the previous configuration</summary><p>Read: {source.read_paths.join(", ") || "No repository files"}</p><p>Write: {source.write_paths.join(", ") || "None"}</p><pre className="agent-prompt">{source.template_body}</pre></details>}
      </section>
      <section className="context-pane editor-fields"><div className="context-pane-heading"><span>02</span><h3>Role and file scope</h3></div><p className="muted text-sm">Repository-relative paths, one per line. A trailing / includes a folder. No wildcards or parent traversal. Empty means no file access.</p>
        {editable ? <><div className="field"><Label htmlFor="agent-read-paths">Readable files / folders</Label><Textarea id="agent-read-paths" rows={4} maxLength={3300} value={draft.read} disabled={busy} onChange={e => { setDraft({ ...draft, read: e.target.value }); setReviewed(false); }} placeholder={"docs/\nlib/\ntests/"} /></div><div className="field"><Label htmlFor="agent-write-paths">Writable files / folders</Label><Textarea id="agent-write-paths" rows={4} maxLength={3300} value={draft.write} disabled={busy} onChange={e => { setDraft({ ...draft, write: e.target.value }); setReviewed(false); }} placeholder="A subset of the readable scope" /></div></> : source && <><h4>Readable scope</h4><p className="brief-body">{source.read_paths.join("\n") || "No repository files"}</p><h4>Writable scope</h4><p className="brief-body">{source.write_paths.join("\n") || "None"}</p></>}
        <p className="muted text-sm">Task packets will narrow this proposed scope further. Commands, network access, credentials and execution are not granted here.</p>
        <details className="agent-full-prompt"><summary>Read the complete role prompt</summary><pre className="agent-prompt">{prompt || "Loading…"}</pre></details>
        <p className="agent-template-id">Prompt SHA-256 <code>{editable ? template?.hash : source?.template_hash}</code></p>
      </section>
      <section className="context-pane context-review editor-fields"><div className="context-pane-heading"><span>03</span><h3>Human review</h3></div><div className="agent-role-section"><h4>Outside my role</h4><p>{section(prompt, "Outside my role")}</p></div><details><summary>Boundaries shared by every agent</summary><p className="brief-body">{section(prompt, "Outside every agent role")}</p></details>
        {editable && <p>Saving proposes this configuration to the named operator. {mode === "configure" && "Any previous operator approval will be cleared."}</p>}
        {!editable && source?.state === "pending" && !source.can_initialize && <p>Only the named operator can accept a current role. An admin can revise outdated configuration.</p>}
        {canDecide && <><div className="field"><Label htmlFor="agent-reason">Reason for this decision</Label><Textarea id="agent-reason" rows={3} required maxLength={500} value={draft.reason} disabled={busy} onChange={e => setDraft({ ...draft, reason: e.target.value })} /></div>{(editable || source?.can_initialize) && <label className="agent-review-check"><input type="checkbox" checked={reviewed} disabled={!ready} onChange={e => setReviewed(e.target.checked)} />I reviewed responsibilities, exclusions and file scope.</label>}
        {editable && <Button type="submit" disabled={!ready || !reviewed || !draft.reason.trim() || (mode === "configure" && !source?.can_configure)}>{busy ? "Saving…" : "Propose role configuration"}</Button>}
        {!editable && source?.can_initialize && <Button type="submit" disabled={!ready || !reviewed || !draft.reason.trim()}>{busy ? "Saving…" : "Accept operator responsibility"}</Button>}
        {!editable && source?.can_revoke && <Button type="button" variant="outline" disabled={busy || !!loadError || !draft.reason.trim()} onClick={() => void submit("revoke")}>Revoke role</Button>}</>}
        {error && <p role="alert" className="error-box">{error} Your draft is preserved.</p>}
        {(error || loadError) && <Button type="button" variant="outline" disabled={busy} onClick={() => { setReviewed(false); setRetry(n => n + 1); }}>Review latest version{editable ? " and keep my draft" : ""}</Button>}
        <p className="muted text-sm">This records a human decision. It does not start an agent or approve a task result.</p>
      </section>
    </form>}
    </DialogContent></Dialog><AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard your role draft?</AlertDialogTitle><AlertDialogDescription>Your unsaved role configuration and decision reason will be discarded.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={onClose}>Discard draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
function AgentRoleHistory({ workspaceId, projectId, bindingId, members, onClose }: Props & { bindingId: string }) {
  const [page, setPage] = useState<{ events: AgentRoleEvent[]; next_before: number | null } | null>(null);
  const [before, setBefore] = useState(0); const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  useEffect(() => { const c = new AbortController(); api<{ events: AgentRoleEvent[]; next_before: number | null }>(`${workspacePath(`projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(bindingId)}/history`, workspaceId)}&before=${before}`, { signal: c.signal })
    .then(result => { if (!c.signal.aborted) { setPage(result); setError(""); } }).catch(e => { if (!c.signal.aborted) { setPage(null); setError(errorMessage(e)); } }); return () => c.abort(); }, [workspaceId, projectId, bindingId, before, retry]);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="context-editor-dialog agent-history-dialog"><DialogHeader><DialogTitle>Role decision history</DialogTitle><DialogDescription>Each decision retains its human author, time, prompt and file scope.</DialogDescription></DialogHeader>{error ? <p role="alert" className="error-box">{error}<Button variant="outline" onClick={() => setRetry(n => n + 1)}>Retry history</Button></p> : !page ? <p role="status">Loading role history…</p> : <><ol className="brief-history">{page.events.map(event => <li key={event.id}><strong>Version {event.version} · {event.action}</strong><p>{members.find(m => m.user_id === event.actor_id)?.name ?? "Former workspace member"} · <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time></p><p>{event.reason}</p><details><summary>Read this decision snapshot</summary><p>State: {event.snapshot.state}</p><p>Read: {event.snapshot.read_paths.join(", ") || "None"}</p><p>Write: {event.snapshot.write_paths.join(", ") || "None"}</p><pre className="agent-prompt">{event.snapshot.template_body}</pre></details></li>)}</ol><div className="inline-actions"><Button variant="outline" disabled={!before} onClick={() => { setBefore(0); setPage(null); }}>Latest decisions</Button><Button variant="outline" disabled={page.next_before === null} onClick={() => { setBefore(page.next_before ?? 0); setPage(null); }}>Older decisions</Button></div></>}</DialogContent></Dialog>;
}

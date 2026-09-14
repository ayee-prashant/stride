"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { GitBranch, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { api, workspacePath } from "@/lib/client-api";
import type { GitHubObservation, GitHubSourceResult, GitHubSourceState } from "@/lib/github-context";

const labels: Record<GitHubSourceState, string> = { pending: "Waiting for sync", syncing: "Checking GitHub", current: "Verified snapshot", unavailable: "Needs attention", disconnected: "Disconnected" };
const reasons: Record<string, string> = {
  access_changed: "The repository grant changed. An administrator must review the connection before any saved files can be shown.",
  access_unavailable: "GitHub access could not be verified. Check the app installation and repository permissions.",
  rate_limited: "GitHub requested a pause. Synchronization will resume after its cooldown.",
  incomplete: "Required files could not be read completely. Check the configured paths, file sizes and repository size.",
  source_changed: "The branch changed during the read. A fresh sync has been scheduled.",
  upstream_unavailable: "GitHub could not be reached. A fresh sync has been scheduled.",
  refresh_required: "The last verification expired. Task briefs wait for a successful sync.",
  history_limit: "The snapshot history limit has been reached. An administrator must review retention before synchronization can continue.",
};

export function RepositoryObservation({ observation }: { observation: GitHubObservation }) {
  const base = `https://github.com/${observation.full_name.split("/").map(encodeURIComponent).join("/")}`;
  return <div className="repository-observation">
    <div className="repository-commit"><GitBranch size={15} aria-hidden="true" /><span>{observation.branch}</span><a href={`${base}/commit/${observation.head_sha}`} target="_blank" rel="noopener noreferrer" title={observation.head_sha}>Commit {observation.head_sha.slice(0, 12)}</a></div>
    <p className="muted text-sm">{observation.files.length} configured {observation.files.length === 1 ? "file" : "files"} at this commit. These are repository facts; adopting a requirement or decision needs a human publication.</p>
    <details className="repository-files"><summary>Read verified repository files</summary>{observation.files.map(file => <details key={file.path}><summary>{file.path}</summary><pre>{file.body}</pre><p className="muted text-sm">Git blob <code>{file.blob_sha}</code></p></details>)}</details>
  </div>;
}

export function RepositoryContext({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const [data, setData] = useState<GitHubSourceResult | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false); const [disconnecting, setDisconnecting] = useState(false);
  const lock = useRef(false); const controller = useRef<AbortController | null>(null);
  const receipt = useRef({ input: "", id: "" });
  const path = workspacePath(`projects/${encodeURIComponent(projectId)}/repository`, workspaceId);
  const refresh = useCallback(() => {
    controller.current?.abort(); const c = new AbortController(); controller.current = c;
    return api<GitHubSourceResult>(path, { signal: c.signal }).then(result => {
      if (!c.signal.aborted) { setData(result); setError(""); }
    }).catch(e => { if (!c.signal.aborted) { setData(null); setError(e instanceof Error ? e.message : "Repository status is unavailable."); } });
  }, [path]);
  useEffect(() => {
    void refresh();
    const update = () => { if (!lock.current && document.visibilityState === "visible") void refresh(); };
    const interval = window.setInterval(update, 20000);
    window.addEventListener("focus", update); document.addEventListener("visibilitychange", update);
    return () => { controller.current?.abort(); window.clearInterval(interval); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, [refresh]);
  async function mutate(operation: "connect" | "refresh" | "disconnect", key?: string) {
    if (!data || lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice(""); controller.current?.abort();
    const input = { version: data.source?.version ?? 0, ...(operation === "connect" ? { binding_key: key } : {}) };
    const signature = JSON.stringify({ operation, ...input });
    if (signature !== receipt.current.input) receipt.current = { input: signature, id: crypto.randomUUID() };
    try {
      const endpoint = workspacePath(`projects/${encodeURIComponent(projectId)}/repository${operation === "connect" ? "" : `/${operation}`}`, workspaceId);
      const result = await api<GitHubSourceResult>(endpoint, { method: "POST", body: { ...input, request_id: receipt.current.id } });
      setData(result); setDisconnecting(false); receipt.current = { input: "", id: "" };
      setNotice(operation === "disconnect" ? "Repository disconnected. Source files in saved briefs are withheld." : "Sync requested. Status will update here when verification completes.");
    } catch (e) { setError(e instanceof Error ? e.message : "The repository change could not be confirmed."); }
    finally { lock.current = false; setBusy(false); }
  }
  const source = data?.source;
  return <section className="repository-context" aria-label="GitHub project context">
    <div className="repository-context-heading"><div><h3><GitBranch size={18} aria-hidden="true" />GitHub context</h3><p className="muted text-sm">A shared repository snapshot for every machine.</p></div>{source && <span className={`repository-state source-${source.state}`}>{labels[source.state]}</span>}</div>
    {error && <p className="error-box" role="alert">{error} Refresh the status before trying again.</p>}
    {!data && !error && <p role="status">Loading repository status…</p>}
    {data && (!source || source.state === "disconnected") && <div className="repository-setup">
      <p>{data.configured ? "Connect the approved repository to include verified code context in task briefs." : "No repository grant is configured for this project. A server administrator can add its GitHub App connection."}</p>
      {data.can_manage && data.choices.map(choice => <div key={choice.key}><strong>{choice.repository}</strong><p className="muted text-sm">{choice.branch} · {choice.paths.length} required source files</p><details><summary>Review included paths</summary><ul>{choice.paths.map(path => <li key={path}><code>{path}</code></li>)}</ul></details><Button type="button" size="sm" disabled={busy} onClick={() => void mutate("connect", choice.key)}>Connect repository</Button></div>)}
    </div>}
    {source && source.state !== "disconnected" && <>
      <p className="repository-name">{source.repository}</p>
      {source.reason && reasons[source.reason] && <p className="repository-warning" role="status">{reasons[source.reason]}</p>}
      {source.state === "pending" || source.state === "syncing" ? <p className="muted text-sm">The context worker must finish a complete read before repository files enter a task brief.</p> : null}
      {source.last_verified_at && <p className="muted text-sm">Last verified <time dateTime={source.last_verified_at}>{new Date(source.last_verified_at).toLocaleString()}</time>. Checks run about every two minutes while the worker is online.</p>}
      {source.observation && <RepositoryObservation observation={source.observation} />}
    </>}
    <div className="inline-actions repository-actions"><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} />Refresh status</Button>
      {source && source.state !== "disconnected" && source.reason !== "access_changed" && <Button type="button" size="sm" variant="outline" disabled={busy || source.state === "pending" || source.state === "syncing"} onClick={() => void mutate("refresh")}>Request GitHub sync</Button>}
      {data?.can_manage && source && source.state !== "disconnected" && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setDisconnecting(true)}>Disconnect repository</Button>}
    </div>
    {notice && <p className="muted text-sm" role="status">{notice}</p>}
    <p className="repository-boundary">Repository text is reference material. It cannot approve work, change permissions, or start an agent.</p>
    <AlertDialog open={disconnecting} onOpenChange={open => { if (!busy) setDisconnecting(open); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Disconnect repository context?</AlertDialogTitle><AlertDialogDescription>Synchronization will stop. Saved briefs containing its files will be unavailable until an approved connection is restored and verified. Published human context stays available.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Keep connected</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={e => { e.preventDefault(); void mutate("disconnect"); }}>{busy ? "Disconnecting…" : "Disconnect source"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}

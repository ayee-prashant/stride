"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, workspacePath } from "@/lib/client-api";
import { AGENT_ROLE_LABELS } from "@/lib/agents";
import type { AgentRegistry as Registry, AgentBindingSummary } from "@/lib/agents";
import type { Member } from "@/lib/domain";
import { AgentRoleDialog } from "./agent-role-dialog";

const stateLabel = { pending: "Awaiting operator review", initialized: "Operator approved", revoked: "Revoked" };
export function AgentRegistry({ workspaceId, projectId, members, userId }: { workspaceId: string; projectId: string; members: Member[]; userId: string }) {
  const [data, setData] = useState<Registry | null>(null); const [offset, setOffset] = useState(0);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ mode: "new" | "review" | "configure" | "history"; binding?: AgentBindingSummary } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const path = workspacePath(`projects/${encodeURIComponent(projectId)}/agents`, workspaceId);
  const refresh = useCallback(() => {
    controller.current?.abort(); const c = new AbortController(); controller.current = c;
    return api<Registry>(`${path}&offset=${offset}`, { signal: c.signal }).then(result => { if (!c.signal.aborted) { setData(result); setError(""); } })
      .catch(e => { if (!c.signal.aborted) { setData(null); setNotice(""); setError(e instanceof Error ? e.message : "Agent roles could not be loaded."); } })
      .finally(() => { if (!c.signal.aborted) setLoading(false); });
  }, [path, offset]);
  useEffect(() => { void refresh(); const focus = () => { void refresh(); }; window.addEventListener("focus", focus); return () => { controller.current?.abort(); window.removeEventListener("focus", focus); }; }, [refresh]);
  return <section className="agent-registry" aria-label="Project agent roles" aria-busy={loading}>
    <div className="brief-intro"><div className="brief-intro-icon"><Bot size={23} /></div><div><h2>Every agent has a human owner</h2><p>Propose a role and its file scope. The named operator reviews the prompt and accepts responsibility.</p></div></div>
    <div className="agent-toolbar"><p className="muted">Role approval prepares the team. Connecting and starting an agent are separate steps.</p><div className="inline-actions"><Button variant="outline" onClick={() => { setLoading(true); void refresh(); }} disabled={loading}><RefreshCw size={15} />Refresh agents</Button>{data?.can_register && <Button onClick={() => setDialog({ mode: "new" })}><Plus size={16} />Add agent role</Button>}</div></div>
    {error && <p className="error-box" role="alert">{error}</p>}{notice && <p role="status" className="agent-notice">{notice}</p>}
    {loading && !data && <p role="status">Loading agent roles…</p>}
    {data && <>{!data.bindings.length ? <div className="brief-empty"><h3>{offset ? "No more roles on this page" : "Set up your first agent role"}</h3><p>{data.can_register ? "Choose an existing teammate as operator, select a role, and review its responsibilities and exclusions." : "A workspace admin can propose agent roles. Roles assigned to you will appear here for review."}</p></div> : <div className="agent-grid">{data.bindings.map(binding => <article className="agent-card" key={binding.id}>
      <div className="agent-card-heading"><div><h3>{binding.alias}</h3><p>{AGENT_ROLE_LABELS[binding.role_id]}</p></div><span className={`agent-state agent-state-${binding.state}`}>{stateLabel[binding.state]}</span></div>
      <p>Human operator: <strong>{binding.operator_name}</strong></p><p className="muted">{binding.tool_label ? `${binding.tool_label} · reported tool label` : "Tool not specified"}</p>
      <p className="agent-identity">Profile ID <code>{binding.profile_id}</code></p>
      {!binding.operator_available && <p className="error-box">The operator is no longer a workspace member. This role is unavailable.</p>}
      {!binding.template_current && <p className="error-box">The role template changed. An admin must propose an updated configuration before operator review.</p>}
      <div className="agent-card-status"><ShieldCheck size={15} /><span>Configuration v{binding.version} · Manage connections in Agent delivery</span></div>
      <div className="agent-card-actions"><Button variant={binding.can_initialize ? "default" : "outline"} size="sm" onClick={() => setDialog({ mode: "review", binding })}>{binding.can_initialize ? "Review and accept role" : "View role"}</Button>{binding.can_configure && <Button variant="outline" size="sm" onClick={() => setDialog({ mode: "configure", binding })}>Revise scope</Button>}<Button variant="ghost" size="sm" onClick={() => setDialog({ mode: "history", binding })}>History</Button></div>
    </article>)}</div>}
      {(offset > 0 || data.has_more) && <div className="inline-actions agent-pagination"><Button variant="outline" disabled={loading || offset === 0} onClick={() => { setLoading(true); setOffset(n => Math.max(0, n - 50)); }}>Previous roles</Button><Button variant="outline" disabled={loading || !data.has_more} onClick={() => { setLoading(true); setOffset(data.next_offset); }}>More roles</Button></div>}
    </>}
    <p className="brief-integration-note">Open Agent delivery to enroll a connection, review work packets and authorize starts. Role acceptance alone grants no execution permission. The companion supports attended IDE and CLI work.</p>
    {dialog && <AgentRoleDialog key={`${dialog.mode}:${dialog.binding?.id ?? "new"}`} mode={dialog.mode} bindingId={dialog.binding?.id} workspaceId={workspaceId} projectId={projectId} profiles={data?.profiles ?? []} members={members} userId={userId} onClose={() => setDialog(null)} onSaved={result => { setDialog(null); setNotice(`Role saved: ${stateLabel[result.binding.state].toLowerCase()}.`); setLoading(true); void refresh(); }} />}
  </section>;
}

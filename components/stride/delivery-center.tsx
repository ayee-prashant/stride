"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Bell, ClipboardCheck, Link2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, workspacePath } from "@/lib/client-api";
import { AGENT_ROLE_LABELS } from "@/lib/agents";
import type { AgentRegistry, AgentBindingSummary } from "@/lib/agents";
import type { AgentConnection, DeliveryProject, DeliveryTicket } from "@/lib/delivery";
import type { Member } from "@/lib/domain";
import { DeliveryConnections, DeliveryResponsibilities, DiscoveryForm } from "./delivery-setup";
import { DeliveryDialog } from "./delivery-dialog";

export const PHASE_LABELS = { created: "Needs assignment", assigned: "Waiting for operator", start_approved: "Start approved", in_progress: "Agent working", in_review: "Human review", uat_authorization: "Authorize UAT", release_authorization: "Authorize release", accepted: "Accepted", cancelled: "Cancelled", replan_required: "Needs replanning" };
type TicketSummary = Pick<DeliveryTicket, "id" | "task_id" | "title" | "kind" | "phase" | "role_id" | "version" | "updated_at">;
type Overview = { configuration: DeliveryProject | null; tickets: TicketSummary[]; connections: AgentConnection[]; has_more: boolean; next_offset: number };
type NoticePage = { notices: Notice[]; next_cursor: number; has_more: boolean };
type Notice = { id: string; sequence: number; ticket_id: string | null; title: string; created_at: string; read_at: string | null };
export function DeliveryCenter({ workspaceId, projectId, members, userId, admin, initialTicketId = "", onDismissInitial }: { initialTicketId?: string; onDismissInitial?: () => void; workspaceId: string; projectId: string; members: Member[]; userId: string; admin: boolean }) {
  const [page, setPage] = useState<Overview | null>(null); const [bindings, setBindings] = useState<AgentBindingSummary[]>([]); const [notices, setNotices] = useState<Notice[]>([]);
  const [noticeBefore, setNoticeBefore] = useState(0); const [moreNotices, setMoreNotices] = useState(false);
  const [tab, setTab] = useState<"work" | "connections" | "responsibilities" | "notices">("work"); const [offset, setOffset] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [selected, setSelected] = useState<string | null>(initialTicketId || null); const [discovery, setDiscovery] = useState(false);
  const abort = useRef<AbortController | null>(null); const path = workspacePath(`projects/${encodeURIComponent(projectId)}/delivery`, workspaceId);
  const refresh = useCallback(async () => {
    abort.current?.abort(); const c = new AbortController(); abort.current = c;
    try {
      const [overview, registry, notificationPage] = await Promise.all([api<Overview>(`${path}&offset=${offset}`, { signal: c.signal }), api<AgentRegistry>(workspacePath(`projects/${encodeURIComponent(projectId)}/agents`, workspaceId), { signal: c.signal }), api<NoticePage>(`${workspacePath(`projects/${encodeURIComponent(projectId)}/delivery/notices`, workspaceId)}&latest=1&after=${noticeBefore}`, { signal: c.signal })]);
      const roles = [...registry.bindings]; let next = registry.has_more ? registry.next_offset : null;
      while (next !== null && next < 200) { const p: AgentRegistry = await api(`${workspacePath(`projects/${encodeURIComponent(projectId)}/agents`, workspaceId)}&offset=${next}`, { signal: c.signal }); roles.push(...p.bindings); next = p.has_more ? p.next_offset : null; }
      if (!c.signal.aborted) { setPage(overview); setBindings(roles); setNotices(notificationPage.notices); setMoreNotices(notificationPage.has_more); setError(""); }
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : "Delivery could not be loaded."); } finally { if (!c.signal.aborted) setBusy(false); }
  }, [path, offset, projectId, workspaceId, noticeBefore]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void refresh(); }); const focus = () => { void refresh(); }; window.addEventListener("focus", focus); const timer = window.setInterval(() => { if (!document.hidden && !selected) void refresh(); }, 30000); return () => { active = false; abort.current?.abort(); clearInterval(timer); window.removeEventListener("focus", focus); }; }, [refresh, selected]);
  const pending = page?.tickets.filter(t => ["in_review", "uat_authorization", "release_authorization", "replan_required"].includes(t.phase)).length ?? 0;
  return <section className="delivery-center" aria-label="Human-approved agent delivery" aria-busy={busy}>
    <div className="brief-intro"><div className="brief-intro-icon"><ClipboardCheck size={24} /></div><div><h2>Agents do the work. Humans own the decisions.</h2><p>One shared brief, clear assignments and a review at every delivery gate.</p></div></div>
    <div className="delivery-tabs" aria-label="Delivery views">{([{ id: "work", title: "Work", icon: ClipboardCheck }, { id: "connections", title: "Connections", icon: Link2 }, { id: "responsibilities", title: "Human responsibilities", icon: ShieldCheck }, { id: "notices", title: "My notifications", icon: Bell }] as const).map(item => <Button key={item.id} variant={tab === item.id ? "default" : "outline"} onClick={() => setTab(item.id)} aria-pressed={tab === item.id}><item.icon size={15} />{item.title}</Button>)}<Button variant="ghost" disabled={busy} onClick={() => { setBusy(true); void refresh(); }} aria-label="Refresh delivery"><RefreshCw size={16} /></Button></div>
    {error && <p role="alert" className="error-box">{error}</p>}
    {!page && !error && <p role="status">Loading delivery…</p>}
    {page && <>
      {!page.configuration || tab === "responsibilities" ? <DeliveryResponsibilities key={`responsibilities-${page.configuration?.version ?? 0}`} workspaceId={workspaceId} projectId={projectId} configuration={page.configuration} members={members} userId={userId} admin={admin} onSaved={() => void refresh()} /> : null}
      {page.configuration && tab === "work" && <><div className="agent-toolbar"><p>{pending ? `${pending} ticket${pending === 1 ? "" : "s"} on this page need human attention.` : "Assign the next step, review its packet and let the operator authorize a start."}</p>{[page.configuration.reviewers.requirements, page.configuration.reviewers.architecture].includes(userId) && <Button onClick={() => setDiscovery(v => !v)}>{discovery ? "Close form" : "Create discovery task"}</Button>}</div>{discovery && <DiscoveryForm workspaceId={workspaceId} projectId={projectId} configuration={page.configuration} userId={userId} onSaved={() => { setDiscovery(false); void refresh(); }} />}
        {!page.tickets.length ? <div className="brief-empty"><h3>Start with the requirements</h3><p>Create a BA discovery task, choose a role from Team and agents, and let its human operator review the work packet. An accepted architecture plan creates the implementation tickets.</p></div> : <div className="delivery-ticket-list">{page.tickets.map(ticket => <button className="delivery-ticket" type="button" key={ticket.id} onClick={() => setSelected(ticket.id)}><div><span className="eyebrow">{AGENT_ROLE_LABELS[ticket.role_id]}</span><h3>{ticket.title}</h3><p>Updated <time dateTime={ticket.updated_at}>{new Date(ticket.updated_at).toLocaleString()}</time></p></div><div className="delivery-ticket-next"><span className={`delivery-phase delivery-phase-${ticket.phase}`}>{PHASE_LABELS[ticket.phase]}</span><ArrowRight size={17} /></div></button>)}</div>}
        {(offset > 0 || page.has_more) && <div className="inline-actions"><Button variant="outline" disabled={!offset || busy} onClick={() => { setBusy(true); setOffset(n => Math.max(0, n - 50)); }}>Previous tickets</Button><Button variant="outline" disabled={!page.has_more || busy} onClick={() => { setBusy(true); setOffset(page.next_offset); }}>More tickets</Button></div>}
      </>}
      {page.configuration && tab === "connections" && <DeliveryConnections workspaceId={workspaceId} projectId={projectId} userId={userId} bindings={bindings} connections={page.connections} onSaved={() => void refresh()} />}
      {page.configuration && tab === "notices" && <div className="delivery-notices"><h3>Your delivery notifications</h3><p className="muted">The companion shows these same private notices in your terminal. An idle IDE agent starts when you ask it to.</p>{notices.length ? notices.map(n => <article key={n.id}><strong>{n.title}</strong><time dateTime={n.created_at}>{new Date(n.created_at).toLocaleString()}</time>{n.ticket_id && <Button variant="outline" size="sm" onClick={() => setSelected(n.ticket_id)}>Review task</Button>}</article>) : <p>No delivery notifications yet.</p>}<div className="inline-actions"><Button variant="outline" disabled={!noticeBefore || busy} onClick={() => setNoticeBefore(0)}>Newest notifications</Button><Button variant="outline" disabled={!moreNotices || busy} onClick={() => setNoticeBefore(notices.at(-1)?.sequence ?? 0)}>Older notifications</Button></div></div>}
    </>}
    {selected && page?.configuration && <DeliveryDialog key={selected} workspaceId={workspaceId} projectId={projectId} ticketId={selected} userId={userId} members={members} bindings={bindings} connections={page.connections} onClose={() => { setSelected(null); onDismissInitial?.(); window.history.replaceState(window.history.state, "", "/"); }} onSaved={() => void refresh()} />}
  </section>;
}

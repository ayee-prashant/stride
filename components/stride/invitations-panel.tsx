"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, workspacePath } from "@/lib/client-api";
import type { Invitation } from "@/lib/productivity";
import { Choice } from "./controls";

export function InvitationsPanel({ workspaceId }: { workspaceId: string }) {
  const [email, setEmail] = useState(""); const [role, setRole] = useState("member"); const [items, setItems] = useState<Invitation[]>([]); const [link, setLink] = useState(""); const [copied, setCopied] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [revision, setRevision] = useState(0);
  useEffect(() => { const c = new AbortController(); api<Invitation[]>(workspacePath("invitations", workspaceId), { signal: c.signal }).then(setItems).catch(e => { if (!c.signal.aborted) setError(e.message); }); return () => c.abort(); }, [workspaceId, revision]);
  return <section className="invitation-panel"><h2>Invite a teammate</h2><p className="muted text-sm">Create a private link for their email address. It expires in seven days and can be used once.</p>
    <form className="member-form-fields" onSubmit={async event => { event.preventDefault(); if (busy) return; setBusy(true); setError(""); try { const result = await api<{ path: string }>(workspacePath("invitations", workspaceId), { method: "POST", body: { email, role } }); setLink(new URL(result.path, window.location.origin).href); setCopied(false); setEmail(""); setRevision(n => n + 1); } catch (e) { setError(e instanceof Error ? e.message : "Could not create invitation."); } finally { setBusy(false); } }}>
      <Input aria-label="Invite email" type="email" required maxLength={254} value={email} placeholder="teammate@example.com" disabled={busy} onChange={e => setEmail(e.target.value)} /><Choice label="Invite role" value={role} onChange={setRole} disabled={busy} options={[{ value: "member", label: "Member" }, { value: "admin", label: "Admin" }]} /><Button type="submit" disabled={busy || !email}>Create invite link</Button>
    </form>{link && <div className="invite-result"><Input aria-label="New invitation link" value={link} readOnly onFocus={e => e.target.select()} /><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setError("Select and copy the invitation link above."); } }}>{copied ? "Copied" : "Copy link"}</Button><p className="text-sm muted">Share this link only with the invited teammate. It is shown only now.</p></div>}
    {error && <p role="alert" className="error-box">{error}</p>}
    {!!items.length && <details className="invite-history"><summary>Recent invitations</summary><ul>{items.map(item => { const active = !item.accepted_at && !item.revoked_at && item.expires_at > new Date().toISOString(); return <li key={item.id}><div><strong>{item.email}</strong><p>{item.role} · {item.accepted_at ? "Accepted" : item.revoked_at ? "Revoked" : active ? `Expires ${new Date(item.expires_at).toLocaleDateString()}` : "Expired"}</p></div>{active && <Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await api(workspacePath(`invitations/${encodeURIComponent(item.id)}`, workspaceId), { method: "DELETE", body: {} }); setRevision(n => n + 1); setLink(""); } catch (e) { setError(e instanceof Error ? e.message : "Could not revoke invitation."); } finally { setBusy(false); } }}>Revoke</Button>}</li>; })}</ul></details>}
  </section>;
}

"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client-api";

type Preview = { email: string; workspace_name: string; expires_at: string; existing_account: boolean };
export function JoinWorkspace({ signedInEmail }: { signedInEmail: string | null }) {
  const router = useRouter(); const [token, setToken] = useState(""); const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [joined, setJoined] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    Promise.resolve().then(async () => {
      if (c.signal.aborted) return;
      const incoming = new URLSearchParams(window.location.hash.slice(1)).get("token");
      const saved = incoming || sessionStorage.getItem("stride.pending-invite") || "";
      if (!/^[A-Za-z0-9_-]{43}$/.test(saved)) throw new Error("Open the complete invitation link shared by your workspace admin.");
      sessionStorage.setItem("stride.pending-invite", saved); window.history.replaceState(window.history.state, "", "/join");
      const result = await api<Preview>("invitations/preview", { method: "POST", body: { token: saved }, signal: c.signal });
      if (!c.signal.aborted) { setToken(saved); setPreview(result); }
    }).catch(e => { if (!c.signal.aborted) setError(e instanceof Error ? e.message : "Reopen the invitation link."); });
    return () => c.abort();
  }, []);
  const wrongAccount = !!signedInEmail && signedInEmail.toLowerCase() !== preview?.email.toLowerCase();
  return <main id="main-content" className="auth-page"><section className="auth-card"><p className="font-semibold text-primary">Stride</p><h1>{joined ? "You’re ready to join" : "Join your team"}</h1>
    {joined ? <><p>Your account and membership are ready. Sign in with your password to open the workspace.</p><a className="auth-link" href="/sign-in">Continue to sign in</a></> : preview ? <><p>You’ve been invited to <strong>{preview.workspace_name}</strong> as <strong>{preview.email}</strong>.</p>
      {wrongAccount || (preview.existing_account && !signedInEmail) ? <><p>Sign in with the invited email to accept this link.</p><a className="auth-link" href="/sign-in?next=%2Fjoin">Sign in to accept</a></> : <form className="space-y-4" onSubmit={async event => {
        event.preventDefault(); if (busy) return; setBusy(true); setError("");
        try { const result = await api<{ workspace_id: string; requires_sign_in: boolean }>("invitations/accept", { method: "POST", body: { token, ...(!preview.existing_account ? { name, password } : {}) } }); setPassword(""); sessionStorage.removeItem("stride.pending-invite"); if (result.requires_sign_in) setJoined(true); else { router.replace(`/?${new URLSearchParams({ workspace: result.workspace_id })}`); router.refresh(); } } catch (e) { setError(e instanceof Error ? e.message : "Could not accept invitation."); } finally { setBusy(false); }
      }}>{!preview.existing_account && <><div className="field"><Label htmlFor="join-name">Your name</Label><Input id="join-name" autoComplete="name" required maxLength={80} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></div><div className="field"><Label htmlFor="join-password">Create a password</Label><Input id="join-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /><p className="muted text-sm">Use at least 12 characters.</p></div></>}<Button type="submit" disabled={busy}>{busy ? "Joining…" : preview.existing_account ? "Accept invitation" : "Create account and join"}</Button></form>}
    </> : !error && <p role="status">Checking invitation…</p>}{error && <p className="error-box" role="alert">{error}</p>}
  </section></main>;
}

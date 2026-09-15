"use client";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function navigateOAuth(value: unknown) {
  if (!value || typeof value !== "object" || !("url" in value) || typeof value.url !== "string") throw new Error("The authorization response was incomplete. Restart connection sign-in.");
  const url = new URL(value.url, window.location.origin);
  if (url.origin !== window.location.origin && !(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port === "43871" && url.pathname === "/callback" && !url.username && !url.password)) throw new Error("This authorization destination is not allowed.");
  window.location.assign(url.href);
}
export function AgentOAuthLogin({ query }: { query: string }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const lock = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/sign-in/email", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ email, password, oauth_query: query }) });
      const data = await response.json(); setPassword(""); if (!response.ok) throw new Error("Sign-in failed. Check your approved account and restart if this request expired."); navigateOAuth(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Sign-in failed."); } finally { setBusy(false); lock.current = false; }
  }
  return <main className="flex min-h-svh items-center justify-center p-6"><section className="w-full max-w-md space-y-5 rounded-2xl border bg-card p-8"><p className="font-semibold text-primary">Stride</p><h1 className="text-2xl font-semibold">Connect your agent</h1><p className="text-sm text-muted-foreground">Sign in as the profile’s human operator. You will review the connection before granting access.</p><form className="space-y-4" onSubmit={submit}><Label htmlFor="oauth-email">Email<Input id="oauth-email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={busy} /></Label><Label htmlFor="oauth-password">Password<Input id="oauth-password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></Label><Button disabled={busy} type="submit">{busy ? "Signing in…" : "Continue to connection review"}</Button></form>{error && <p role="alert" className="error-box">{error}</p>}<a href="/sign-in" className="text-sm underline">Return to Stride sign-in</a></section></main>;
}
export function AgentOAuthConsent({ query, profile, connection, role, purpose, profileId }: { query: string; profile: string; connection: string; role: string; purpose: "agent" | "companion"; profileId: string }) {
  const [accepted, setAccepted] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const lock = useRef(false);
  async function decide(accept: boolean) {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try { const response = await fetch("/api/connect/consent", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accept, oauth_query: query }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Connection approval failed."); navigateOAuth(data); }
    catch (e) { setError(e instanceof Error ? e.message : "Connection approval failed."); } finally { setBusy(false); lock.current = false; }
  }
  return <main className="flex min-h-svh items-center justify-center p-6"><section className="w-full max-w-xl space-y-5 rounded-2xl border bg-card p-8"><p className="font-semibold text-primary">Stride · Human connection review</p><h1 className="text-2xl font-semibold">Allow {profile} to connect?</h1><dl className="space-y-2 text-sm"><div><dt className="text-muted-foreground">Role</dt><dd>{role}</dd></div><div><dt className="text-muted-foreground">Connection</dt><dd>{connection}</dd></div><div><dt className="text-muted-foreground">Profile ID</dt><dd className="break-all font-mono text-xs">{profileId}</dd></div></dl><p>{purpose === "agent" ? "This agent can read its assigned work, acknowledge its role, claim work you authorize, and submit checkpoints and reports." : "The local companion can maintain this connection’s lease, report checkout preparation and show your private delivery notifications."}</p><p className="text-sm text-muted-foreground">Task assignment, permission to start, report acceptance and release approval remain separate human decisions. You can revoke this connection in Delivery.</p><Label className="flex items-start gap-3"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} disabled={busy} />I recognize this machine and accept responsibility for this connection.</Label><div className="flex gap-3"><Button disabled={!accepted || busy} onClick={() => void decide(true)}>{busy ? "Saving…" : "Allow connection"}</Button><Button variant="outline" disabled={busy} onClick={() => void decide(false)}>Deny</Button></div>{error && <p role="alert" className="error-box">{error}</p>}</section></main>;
}

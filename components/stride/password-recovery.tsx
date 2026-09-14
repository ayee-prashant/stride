"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function PasswordRecovery({ enabled, resetToken }: { enabled: boolean; resetToken?: string }) {
  const resetting = resetToken !== undefined; const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [error, setError] = useState("");
  return <main id="main-content" className="auth-page"><section className="auth-card"><p className="font-semibold text-primary">Stride</p><h1>{resetting ? "Choose a new password" : "Reset your password"}</h1>
    {!enabled ? <p>Email recovery is not connected yet. Contact your workspace owner for account recovery.</p> : resetting && !resetToken ? <p>This reset link is invalid or has expired. <a className="auth-link" href="/forgot-password">Request a new link.</a></p> : done ? <p role="status">{resetting ? "Your password was changed and existing sessions were signed out. Sign in with your new password." : "If this email has an approved account, a reset link will arrive shortly. Check your spam folder too."}</p> : <form className="space-y-4" onSubmit={async event => {
      event.preventDefault(); if (busy) return; if (resetting && password !== confirm) { setError("The passwords do not match."); return; } setBusy(true); setError("");
      try {
        const result = resetting ? await authClient.resetPassword({ token: resetToken, newPassword: password }) : await authClient.requestPasswordReset({ email, redirectTo: new URL("/reset-password", window.location.origin).href });
        if (result.error) throw new Error("Recovery failed"); setPassword(""); setConfirm(""); setDone(true);
        if (resetting) window.history.replaceState(window.history.state, "", "/reset-password");
      } catch { setError(resetting ? "The reset link may be expired or already used. Request a new link and try again." : "Recovery is temporarily unavailable. Wait a minute and try again."); } finally { setBusy(false); }
    }}>{resetting ? <><div className="field"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></div><div className="field"><Label htmlFor="confirm-password">Confirm password</Label><Input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={confirm} onChange={e => setConfirm(e.target.value)} /></div></> : <div className="field"><Label htmlFor="recovery-email">Account email</Label><Input id="recovery-email" type="email" autoComplete="email" required maxLength={254} disabled={busy} value={email} onChange={e => setEmail(e.target.value)} /></div>}<Button type="submit" disabled={busy}>{busy ? "Please wait…" : resetting ? "Reset password" : "Send reset link"}</Button></form>}
    {error && <p role="alert" className="error-box">{error}</p>}<a className="auth-link" href="/sign-in">Back to sign in</a>
  </section></main>;
}

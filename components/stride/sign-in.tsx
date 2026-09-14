"use client";
import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function SignIn({ available }: { available: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await authClient.signIn.email({ email, password, rememberMe: true });
      if (result.error) throw new Error("Sign-in failed");
      setPassword(""); router.replace("/"); router.refresh();
    } catch {
      setError("Sign-in failed. Check your email and password, then try again.");
      setBusy(false);
    }
  }
  return <main id="main-content" className="flex min-h-svh items-center justify-center bg-background p-6">
    <section className="w-full max-w-sm space-y-6 rounded-2xl border bg-card p-8 shadow-sm">
      <div className="space-y-2"><p className="font-semibold text-primary">Stride</p><h1 className="text-2xl font-semibold tracking-tight">Make room for your best work.</h1><p className="text-sm text-muted-foreground">Sign in to your private task workspace.</p></div>
      {available ? <form onSubmit={signIn} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="sign-in-email">Email</Label><Input id="sign-in-email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} /></div>
        <div className="space-y-2"><Label htmlFor="sign-in-password">Password</Label><Input id="sign-in-password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></div>
        <Button type="submit" className="w-full" disabled={busy}><LogIn aria-hidden="true" />{busy ? "Signing in…" : "Sign in"}</Button>
      </form> : <p className="text-sm text-muted-foreground" role="status">Your workspace is being prepared. Sign-in will be available when setup is complete.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">Access is limited to approved accounts. Contact your workspace owner if you need access or account recovery.</p>
    </section>
  </main>;
}

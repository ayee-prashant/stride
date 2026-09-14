"use client";
import { useState } from "react";
import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignIn({ available }: { available: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn() {
    setBusy(true); setError("");
    try {
      const result = await authClient.signIn.social({ provider: "github", callbackURL: "/", errorCallbackURL: "/sign-in" });
      if (result.error) throw new Error("Sign-in failed");
    } catch {
      setError("Sign-in could not start. Please try again.");
      setBusy(false);
    }
  }
  return <main className="flex min-h-svh items-center justify-center bg-background p-6">
    <section className="w-full max-w-sm space-y-6 rounded-2xl border bg-card p-8 shadow-sm">
      <div className="space-y-2"><p className="font-semibold text-primary">Stride</p><h1 className="text-2xl font-semibold tracking-tight">Make room for your best work.</h1><p className="text-sm text-muted-foreground">Sign in to your private task workspace.</p></div>
      {available ? <Button className="w-full" disabled={busy} onClick={signIn}><Github aria-hidden="true" />{busy ? "Opening GitHub…" : "Continue with GitHub"}</Button> : <p className="text-sm text-muted-foreground" role="status">Your workspace is being prepared. Sign-in will be available when setup is complete.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">Access is limited to approved accounts.</p>
    </section>
  </main>;
}

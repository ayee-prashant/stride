"use client";
import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { api, workspacePath } from "@/lib/client-api";
import type { Preferences } from "@/lib/productivity";

export function NotificationPreferences({ workspaceId, onChanged }: { workspaceId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false); const [draft, setDraft] = useState<Preferences | null>(null); const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [emailEnabled, setEmailEnabled] = useState(false);
  useEffect(() => {
    if (!open) return; const c = new AbortController();
    Promise.all([api<Preferences>(workspacePath("preferences", workspaceId), { signal: c.signal }), api<{ email: boolean }>(workspacePath("capabilities", workspaceId), { signal: c.signal })]).then(([prefs, capabilities]) => {
      if (c.signal.aborted) return; setDraft(prefs.version ? prefs : { ...prefs, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }); setEmailEnabled(capabilities.email); setDirty(false); setError("");
    }).catch(e => { if (!c.signal.aborted) setError(e.message); }); return () => c.abort();
  }, [open, workspaceId]);
  function change(patch: Partial<Preferences>) { if (draft) { setDraft({ ...draft, ...patch }); setDirty(true); } }
  return <><Button size="icon" variant="ghost" aria-label="Notification preferences" onClick={() => setOpen(true)}><Settings2 size={17} /></Button><Dialog open={open} onOpenChange={value => { if (busy) return; if (!value && dirty) { setError("Save preferences or select Discard changes."); return; } setOpen(value); }}><DialogContent><DialogHeader><DialogTitle>Notification preferences</DialogTitle><DialogDescription>Choose which updates need your attention in this workspace.</DialogDescription></DialogHeader>
    {draft && <form className="space-y-4" onSubmit={async event => { event.preventDefault(); if (busy) return; setBusy(true); setError(""); try { await api(workspacePath("preferences", workspaceId), { method: "PATCH", body: draft }); setDirty(false); setOpen(false); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save preferences."); } finally { setBusy(false); } }}>
      {([['assignments', 'Task assignments'], ['mentions', 'Mentions in comments'], ['due_reminders', 'Due and overdue reminders'], ['daily_digest', 'Daily email summary']] as const).map(([key, label]) => <div className="check-filter" key={key}><Checkbox id={`pref-${key}`} checked={draft[key]} disabled={busy || (key === "daily_digest" && !emailEnabled)} onCheckedChange={value => change({ [key]: value === true })} /><Label htmlFor={`pref-${key}`}>{label}</Label></div>)}
      {!emailEnabled && <p className="muted text-sm">Email summaries become available when the workspace’s email service is connected.</p>}
      <div className="field"><Label htmlFor="pref-timezone">Time zone</Label><Input id="pref-timezone" required value={draft.timezone} maxLength={100} disabled={busy} onChange={e => change({ timezone: e.target.value })} /><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => change({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}>Use my device time zone</Button></div>
      <div className="field"><Label htmlFor="pref-hour">Daily reminder hour (0–23)</Label><Input id="pref-hour" type="number" min={0} max={23} required disabled={busy} value={draft.reminder_hour} onChange={e => change({ reminder_hour: Number(e.target.value) })} /></div>
      <p className="muted text-sm">Mute individual tasks from their details. Updates already marked as read stay read.</p><div className="flex gap-2"><Button type="submit" disabled={busy || !dirty}>Save preferences</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => { setDirty(false); setOpen(false); }}>Discard changes</Button></div>
    </form>}{error && <p role="alert" className="error-box">{error}</p>}
  </DialogContent></Dialog></>;
}

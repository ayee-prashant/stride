"use client";
import { useEffect, useState } from "react";
import { Bookmark, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, workspacePath } from "@/lib/client-api";
import type { SavedFilters, SavedView } from "@/lib/productivity";

export function SavedViews({ workspaceId, filters, onApply }: { workspaceId: string; filters: SavedFilters; onApply: (filters: SavedFilters) => void }) {
  const [views, setViews] = useState<SavedView[]>([]); const [name, setName] = useState(""); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [revision, setRevision] = useState(0);
  useEffect(() => { const c = new AbortController(); api<SavedView[]>(workspacePath("views", workspaceId), { signal: c.signal }).then(setViews).catch(e => { if (!c.signal.aborted) setError(e.message); }); return () => c.abort(); }, [workspaceId, revision]);
  async function remove(view: SavedView) { setBusy(true); setError(""); try { await api(workspacePath(`views/${encodeURIComponent(view.id)}`, workspaceId), { method: "DELETE", body: { version: view.version } }); setRevision(n => n + 1); } catch (e) { setError(e instanceof Error ? e.message : "Could not remove view."); } finally { setBusy(false); } }
  return <div className="custom-views"><Popover open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><PopoverTrigger asChild><Button variant="outline" size="sm"><Bookmark size={14} />Save view</Button></PopoverTrigger><PopoverContent><form className="space-y-3" onSubmit={async event => { event.preventDefault(); if (busy) return; setBusy(true); setError(""); try { await api(workspacePath("views", workspaceId), { method: "POST", body: { name, filters } }); setName(""); setOpen(false); setRevision(n => n + 1); } catch (e) { setError(e instanceof Error ? e.message : "Could not save view."); } finally { setBusy(false); } }}><p className="text-sm">Save these filters for yourself.</p><Input aria-label="Saved view name" placeholder="e.g. My urgent work" required maxLength={60} value={name} disabled={busy} onChange={e => setName(e.target.value)} /><Button type="submit" disabled={busy || !name.trim()}>Save filters</Button>{error && <p role="alert" className="text-destructive text-sm">{error}</p>}</form></PopoverContent></Popover>
    {views.map(view => <span className="saved-view-chip" key={view.id}><Button size="sm" variant="ghost" disabled={busy} onClick={() => onApply(view.filters)}>{view.name}</Button><Button size="icon" variant="ghost" disabled={busy} aria-label={`Remove saved view ${view.name}`} onClick={() => void remove(view)}><X size={12} /></Button></span>)}
    {!open && error && <p role="alert" className="text-destructive text-sm">{error}</p>}
  </div>;
}

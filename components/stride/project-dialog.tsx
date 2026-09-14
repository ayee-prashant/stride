"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Project, ProjectInput } from "@/lib/domain";

export function ProjectDialog({ project, onClose, onSave }: { project?: Project; onClose: () => void; onSave: (input: ProjectInput, project?: Project) => Promise<void> }) {
  const [name, setName] = useState(project?.name ?? ""); const [description, setDescription] = useState(project?.description ?? "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent><DialogHeader><DialogTitle>{project ? "Edit project" : "New project"}</DialogTitle><DialogDescription>A shared place for related work.</DialogDescription></DialogHeader>
    <form className="editor-fields" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(""); try { await onSave({ name, description }, project); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save the project."); } finally { setBusy(false); } }}>
      <div className="field"><Label htmlFor="project-name">Project name</Label><Input id="project-name" autoFocus required maxLength={80} value={name} onChange={e => setName(e.target.value)} disabled={busy} placeholder="e.g. Customer portal" /></div>
      <div className="field"><Label htmlFor="project-description">Description <span className="muted">(optional)</span></Label><Textarea id="project-description" maxLength={500} value={description} onChange={e => setDescription(e.target.value)} disabled={busy} /></div>
      {error && <p role="alert" className="error-box">{error}</p>}<Button disabled={busy || !name.trim()} type="submit">{busy ? "Saving…" : project ? "Save project" : "Create project"}</Button>
    </form>
  </DialogContent></Dialog>;
}

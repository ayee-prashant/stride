"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, workspacePath } from "@/lib/client-api";
import type { Member, WorkspaceActivity, WorkspaceActivityPage } from "@/lib/domain";
import { Avatar } from "./controls";

/** Plain-language names for the stored action codes. */
const ACTIONS: Record<string, string> = {
  created: "created this task",
  updated: "edited this task",
  commented: "commented",
  "status:todo": "moved this back to to do",
  "status:in_progress": "started this",
  "status:done": "marked this done",
  archived: "archived this task",
  restored: "restored this task",
};
const label = (action: string) => ACTIONS[action] ?? action.replace(/[:_]/g, " ");

function when(iso: string) {
  const at = new Date(iso); const minutes = Math.round((Date.now() - at.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type Props = { workspaceId: string; members: Member[]; revision: number; onOpenTask?: (taskId: string) => void };

/** Workspace-wide attribution: every recorded action, and who took it. */
export function ActivityFeed({ workspaceId, members, revision, onOpenTask }: Props) {
  const [rows, setRows] = useState<WorkspaceActivity[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [person, setPerson] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async (append: boolean, from: number) => {
    controller.current?.abort(); const c = new AbortController(); controller.current = c;
    setBusy(true);
    try {
      const page = await api<WorkspaceActivityPage>(`${workspacePath("activity", workspaceId)}&limit=50&offset=${from}`, { signal: c.signal });
      if (c.signal.aborted) return;
      setRows(v => append ? [...v, ...page.activity] : page.activity);
      setHasMore(page.hasMore); setOffset(page.nextOffset); setError("");
    } catch (e) {
      if (!c.signal.aborted) setError(e instanceof Error ? e.message : "Activity could not be loaded.");
    } finally { if (!c.signal.aborted) setBusy(false); }
  }, [workspaceId]);

  // Deferred so the first fetch does not set state synchronously inside the effect.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void load(false, 0); });
    return () => { active = false; controller.current?.abort(); };
  }, [load, revision]);

  const shown = person ? rows.filter(r => r.actor_name === person) : rows;
  const people = Array.from(new Set(rows.map(r => r.actor_name)));

  return <section className="activity-section">
    <div className="activity-filters">
      <Button variant={person ? "outline" : "default"} size="sm" onClick={() => setPerson("")}>Everyone</Button>
      {people.map(name => <Button key={name} variant={person === name ? "default" : "outline"} size="sm" onClick={() => setPerson(name)}>{name}</Button>)}
      <span className="muted activity-count">{shown.length} of {rows.length} loaded</span>
    </div>

    {error && <p role="alert" className="error-box">{error}</p>}
    {!rows.length && !busy && !error && <p className="muted">No recorded activity yet. Actions appear here as people work.</p>}

    <ol className="activity-list">
      {shown.map(row => {
        const member = members.find(m => m.name === row.actor_name);
        return <li key={row.id} className="activity-row">
          <Avatar name={row.actor_name} />
          <div className="activity-body">
            <p><strong>{row.actor_name}</strong> {label(row.action)}</p>
            {onOpenTask
              ? <button type="button" className="activity-task" onClick={() => onOpenTask(row.task_id)}>{row.task_title}</button>
              : <span className="activity-task">{row.task_title}</span>}
            <span className="muted activity-project">{row.project_name}{member ? ` · ${member.role}` : ""}</span>
          </div>
          <time className="muted activity-when" dateTime={row.created_at}>{when(row.created_at)}</time>
        </li>;
      })}
    </ol>

    {hasMore && !person && <Button variant="outline" disabled={busy} onClick={() => void load(true, offset)}>Load more activity</Button>}
    {person && hasMore && <p className="muted">Filtered to loaded activity only. Clear the filter to load more.</p>}
  </section>;
}

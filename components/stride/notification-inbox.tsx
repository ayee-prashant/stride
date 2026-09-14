"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { api, workspacePath } from "@/lib/client-api";
import type { NotificationPage, TaskNotification } from "@/lib/domain";

export function NotificationInbox({ workspaceId, revision, onOpenTask }: { workspaceId: string; revision: number; onOpenTask: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; page?: NotificationPage; error?: string }>({ key: "" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const lock = useRef(false);
  const key = `${workspaceId}:${offset}`;
  const page = result.key === key ? result.page : undefined;
  const error = result.key === key ? result.error : undefined;

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function sync() {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const data = await api<NotificationPage>(workspacePath("notifications/sync", workspaceId), {
          method: "POST", body: { limit: 20, offset, tz_offset: new Date().getTimezoneOffset() }, signal: controller.signal,
        });
        if (!controller.signal.aborted) setResult({ key, page: data });
      } catch (error) {
        if (!controller.signal.aborted) setResult(current => ({ key, page: current.key === key ? current.page : undefined, error: error instanceof Error ? error.message : "Could not load notifications." }));
      } finally { pending = false; }
    }
    void sync();
    const refresh = () => { void sync(); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [workspaceId, offset, key, revision, retry]);

  async function markRead(notification?: TaskNotification) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setActionError("");
    try {
      await api(workspacePath(notification ? `notifications/${encodeURIComponent(notification.id)}` : "notifications/read", workspaceId), { method: notification ? "PATCH" : "POST", body: {} });
      setRetry(value => value + 1);
      if (notification) { await onOpenTask(notification.task_id); setOpen(false); }
    } catch (error) { setActionError(error instanceof Error ? error.message : "Could not open this notification."); }
    finally { lock.current = false; setBusy(false); }
  }

  return <Sheet open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
    <SheetTrigger asChild><Button variant="ghost" className="notification-trigger" aria-label={`Notifications${page?.unreadCount ? `, ${page.unreadCount} unread` : ""}`}><Bell size={18} />{Boolean(page?.unreadCount) && <span className="notification-count">{page!.unreadCount > 99 ? "99+" : page!.unreadCount}</span>}{error && <span className="sr-only">Notifications could not refresh</span>}</Button></SheetTrigger>
    <SheetContent className="notification-sheet"><SheetHeader><SheetTitle>Inbox</SheetTitle><SheetDescription>Assignments, mentions, and tasks that need your attention.</SheetDescription></SheetHeader>
      <div className="inbox-content">
        <div className="inbox-heading"><span className="muted">{page ? `${page.unreadCount} unread` : "Your notifications"}</span><Button size="sm" variant="ghost" disabled={busy || !page?.unreadCount} onClick={() => void markRead()}><CheckCheck size={15} />Mark all read</Button></div>
        {(error || actionError) && <div role="alert" className="error-box"><p>{actionError || error}</p><Button variant="outline" disabled={busy} onClick={() => { setActionError(""); setRetry(value => value + 1); }}>Refresh inbox</Button></div>}
        {!page && !error ? <p role="status" className="muted">Loading notifications…</p> : page && <>
          {page.notifications.length ? <ol className="notification-list">{page.notifications.map(notification => <li key={notification.id}><button type="button" className={`notification-item ${notification.read_at ? "" : "is-unread"}`} disabled={busy} onClick={() => void markRead(notification)}><span className="notification-action">{notification.kind === "reminder" ? "Task is due today" : notification.kind === "overdue" ? "Task is overdue" : notification.kind === "mention" ? `${notification.actor_name ?? "A teammate"} mentioned you` : `${notification.actor_name ?? "A teammate"} assigned you a task`}{!notification.read_at && <span className="unread-dot" aria-label="Unread" />}</span><strong>{notification.task_title}</strong><span className="muted">{notification.project_name}</span><time dateTime={notification.created_at}>{new Date(notification.created_at).toLocaleString()}</time></button></li>)}</ol> : <p className="inbox-empty">{offset ? "No more notifications on this page." : "You’re all caught up. New updates will appear here."}</p>}
          {(offset > 0 || page.hasMore) && <div className="comment-pagination"><Button variant="outline" size="sm" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Newer</Button><Button variant="outline" size="sm" disabled={busy || !page.hasMore} onClick={() => setOffset(page.nextOffset)}>Older</Button></div>}
        </>}
      </div>
    </SheetContent>
  </Sheet>;
}

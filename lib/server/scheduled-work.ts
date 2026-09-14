import { localClock } from "../productivity.ts";
import { ProductivityRepository } from "./productivity-repository.ts";
import { notificationAllowed } from "./notification-rules.ts";
import { Repository } from "./repository.ts";
import { EmailOutbox } from "./email.ts";
import type { MailProvider } from "./email.ts";

export class ScheduledWork {
  repo: Repository; secret: string; origin: string; approved: ReadonlySet<string>;
  constructor(repo: Repository, secret: string, origin: string, approved: ReadonlySet<string>) { this.repo = repo; this.secret = secret; this.origin = origin; this.approved = approved; }
  async run(provider: MailProvider | null) {
    const now = this.repo.now(); const lease = crypto.randomUUID();
    await this.repo.statement("INSERT INTO worker_state(name,lease_until) VALUES('daily-work','1970-01-01T00:00:00.000Z') ON CONFLICT(name) DO NOTHING").run();
    const state = await this.repo.statement("UPDATE worker_state SET lease_id=?,lease_until=? WHERE name='daily-work' AND lease_until<=? RETURNING cursor_workspace,cursor_user", lease, new Date(now.getTime() + 10 * 60000).toISOString(), now.toISOString()).first<{ cursor_workspace: string; cursor_user: string }>();
    if (!state) return { skipped: true };
    const outbox = new EmailOutbox(this.repo, this.secret); let recipients = 0;
    let cursorWorkspace = state.cursor_workspace; let cursorUser = state.cursor_user;
    try {
      const members = await this.repo.statement(`SELECT m.workspace_id,m.user_id,u.email,w.name AS workspace_name FROM memberships m JOIN users u ON u.id=m.user_id JOIN workspaces w ON w.id=m.workspace_id
        WHERE m.workspace_id>? OR (m.workspace_id=? AND m.user_id>?) ORDER BY m.workspace_id,m.user_id LIMIT 100`, cursorWorkspace, cursorWorkspace, cursorUser).all<{ workspace_id: string; user_id: string; email: string; workspace_name: string }>();
      for (const member of members.results) {
        cursorWorkspace = member.workspace_id; cursorUser = member.user_id;
        if (!this.approved.has(member.email.toLowerCase()) && !await this.repo.statement("SELECT user_id FROM account_admissions WHERE user_id=? AND email=?", member.user_id, member.email.toLowerCase()).first()) continue;
        const service = new ProductivityRepository(this.repo); const preferences = await service.preferences(member.user_id, member.workspace_id);
        const clock = localClock(now, preferences.timezone); if (clock.hour < preferences.reminder_hour) continue;
        if (preferences.due_reminders) {
          // Catch up on overdue work, with the same persisted per-recipient preferences.
          const offset = Math.round((now.getTime() - new Date(`${clock.day}T${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}:00Z`).getTime()) / 60000);
          await this.repo.notifications(member.user_id, member.workspace_id, { tz_offset: Math.max(-840, Math.min(840, offset)) }, true);
          await this.repo.statement(`INSERT INTO notifications(id,workspace_id,task_id,recipient_id,kind,event_key,created_at)
            SELECT 'reminder:'||t.id||':'||t.due_date||':'||?,t.workspace_id,t.id,?,'reminder','reminder:'||t.id||':'||t.due_date||':'||?,?
            FROM tasks t JOIN projects p ON p.id=t.project_id AND p.workspace_id=t.workspace_id
            WHERE t.workspace_id=? AND COALESCE(t.assignee_id,t.created_by)=? AND t.status<>'done' AND t.archived_at IS NULL AND p.archived_at IS NULL AND t.due_date=?
            AND ${notificationAllowed("t.workspace_id", "t.id", "COALESCE(t.assignee_id,t.created_by)", "reminder")}
            AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.id='reminder:'||t.id||':'||t.due_date||':'||?)
            ORDER BY t.id LIMIT 100 ON CONFLICT(recipient_id,event_key) DO NOTHING`, member.user_id, member.user_id, member.user_id, now.toISOString(), member.workspace_id, member.user_id, clock.day, member.user_id).run();
        }
        if (provider && preferences.daily_digest) {
          const summary = await this.repo.statement(`SELECT CAST(COUNT(*) AS INTEGER) AS open,CAST(COALESCE(SUM(CASE WHEN t.due_date<=? THEN 1 ELSE 0 END),0) AS INTEGER) AS due,
            CAST(COALESCE(SUM(CASE WHEN t.blocked_reason<>'' THEN 1 ELSE 0 END),0) AS INTEGER) AS blocked
            FROM tasks t JOIN projects p ON p.id=t.project_id AND p.workspace_id=t.workspace_id WHERE t.workspace_id=? AND COALESCE(t.assignee_id,t.created_by)=?
            AND t.archived_at IS NULL AND p.archived_at IS NULL AND t.status<>'done' AND NOT EXISTS(SELECT 1 FROM task_notification_settings nm WHERE nm.workspace_id=t.workspace_id AND nm.task_id=t.id AND nm.user_id=COALESCE(t.assignee_id,t.created_by) AND nm.muted=1)`, clock.day, member.workspace_id, member.user_id).first<{ open: number; due: number; blocked: number }>();
          const link = new URL(`/?${new URLSearchParams({ workspace: member.workspace_id })}`, this.origin).href;
          await outbox.enqueue({ to: member.email, subject: "Your daily Stride summary", text: `${member.workspace_name}\n\n${summary?.open ?? 0} open tasks\n${summary?.due ?? 0} due today or overdue\n${summary?.blocked ?? 0} blocked\n\nOpen your workspace: ${link}\n\nYou can turn off daily summaries in notification preferences.`, key: `digest:${member.workspace_id}:${member.user_id}:${clock.day}` }, "digest", new Date(now.getTime() + 12 * 3600000).toISOString(), member.workspace_id, member.user_id);
        }
        recipients++;
      }
      if (members.results.length < 100) { cursorWorkspace = ""; cursorUser = ""; }
      const delivery = provider ? await outbox.deliver(provider) : { sent: 0, failed: 0 };
      // Prune old quota keys and delivery receipts in bounded batches.
      await this.repo.statement("DELETE FROM mutation_limits WHERE user_id IN(SELECT user_id FROM mutation_limits WHERE window_start<? LIMIT 500)", Math.floor(now.getTime() / 60000) - 1440).run();
      await this.repo.statement("DELETE FROM email_outbox WHERE id IN(SELECT id FROM email_outbox WHERE status IN ('sent','failed') AND created_at<? LIMIT 100)", new Date(now.getTime() - 30 * 86400000).toISOString()).run();
      return { recipients, ...delivery };
    } finally {
      await this.repo.statement("UPDATE worker_state SET lease_until=?,lease_id=NULL,cursor_workspace=?,cursor_user=? WHERE name='daily-work' AND lease_id=?", this.repo.now().toISOString(), cursorWorkspace, cursorUser, lease).run();
    }
  }
}

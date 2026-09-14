import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AppError } from "../domain.ts";
import { Repository } from "./repository.ts";

export type Mail = { to: string; subject: string; text: string; key: string };
export interface MailProvider { send(mail: Mail): Promise<void> }
export function emailConfigured(env: Record<string, string | undefined>): boolean { return !!env.RESEND_API_KEY?.trim() && !!env.STRIDE_EMAIL_FROM?.trim(); }
export function createMailProvider(env: Record<string, string | undefined>, transport: typeof fetch = fetch): MailProvider {
  const apiKey = env.RESEND_API_KEY; const from = env.STRIDE_EMAIL_FROM;
  if (!apiKey || !from || /[\r\n]/.test(from)) throw new AppError(503, "EMAIL_UNAVAILABLE", "The workspace email service is not connected yet.");
  return { async send(mail) {
    const response = await transport("https://api.resend.com/emails", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": mail.key },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Email delivery was not confirmed"); }
    await response.body?.cancel();
  } };
}
function key(secret: string) {
  if (secret.length < 32) throw new Error("A strong application secret is required");
  return createHash("sha256").update(`stride-outbox-v1:${secret}`).digest();
}
export function sealEmail(body: string, secret: string): string {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const encrypted = Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString("base64url")).join(".");
}
export function openEmail(body: string, secret: string): string {
  const parts = body.split("."); if (parts.length !== 3) throw new Error("Invalid outbox record");
  const [iv, tag, content] = parts.map(value => Buffer.from(value, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(secret), iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(content), decipher.final()]).toString("utf8");
}
type OutboxRow = { id: string; recipient: string; subject: string; body: string; kind: string; attempts: number; workspace_id: string | null; user_id: string | null; expires_at: string; dedupe_key: string };
export class EmailOutbox {
  repo: Repository; secret: string;
  constructor(repo: Repository, secret: string) { this.repo = repo; this.secret = secret; }
  async enqueue(mail: Mail, kind: "reset" | "digest", expiresAt: string, workspaceId: string | null = null, userId: string | null = null) {
    const now = this.repo.now().toISOString();
    await this.repo.statement(`INSERT INTO email_outbox(id,dedupe_key,recipient,subject,body,workspace_id,user_id,kind,available_at,expires_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`, crypto.randomUUID(), mail.key, mail.to, mail.subject, sealEmail(mail.text, this.secret), workspaceId, userId, kind, now, expiresAt, now).run();
  }
  async deliver(provider: MailProvider, limit = 20): Promise<{ sent: number; failed: number }> {
    const now = this.repo.now(); const lease = crypto.randomUUID(); const leaseUntil = new Date(now.getTime() + 5 * 60000).toISOString();
    // Compare-and-swap claiming also handles a process that died during delivery.
    const candidates = await this.repo.statement(`SELECT id FROM email_outbox WHERE status IN ('pending','sending') AND available_at<=? AND expires_at>? AND attempts<6 ORDER BY available_at,id LIMIT ?`, now.toISOString(), now.toISOString(), Math.min(20, Math.max(1, limit))).all<{ id: string }>();
    let sent = 0; let failed = 0;
    for (const candidate of candidates.results) {
      const row = await this.repo.statement(`UPDATE email_outbox SET status='sending',lease_id=?,available_at=?,attempts=attempts+1 WHERE id=? AND status IN ('pending','sending') AND available_at<=? AND expires_at>? AND attempts<6 RETURNING *`, lease, leaseUntil, candidate.id, now.toISOString(), now.toISOString()).first<OutboxRow>();
      if (!row) continue;
      try {
        if (row.kind === "digest") {
          const allowed = await this.repo.statement(`SELECT 1 AS allowed FROM notification_preferences np JOIN memberships m ON m.workspace_id=np.workspace_id AND m.user_id=np.user_id JOIN users u ON u.id=m.user_id WHERE np.workspace_id=? AND np.user_id=? AND np.daily_digest=1 AND u.email=?`, row.workspace_id, row.user_id, row.recipient).first();
          if (!allowed) { await this.repo.statement("UPDATE email_outbox SET status='failed',body='',recipient='',lease_id=NULL WHERE id=? AND lease_id=?", row.id, lease).run(); continue; }
        }
        await provider.send({ to: row.recipient, subject: row.subject, text: openEmail(row.body, this.secret), key: row.dedupe_key });
        await this.repo.statement("UPDATE email_outbox SET status='sent',sent_at=?,body='',recipient='',lease_id=NULL WHERE id=? AND lease_id=?", this.repo.now().toISOString(), row.id, lease).run(); sent++;
      } catch {
        failed++;
        const final = row.attempts >= 6;
        const next = new Date(this.repo.now().getTime() + Math.min(60, 2 ** row.attempts) * 60000).toISOString();
        await this.repo.statement("UPDATE email_outbox SET status=?,available_at=?,lease_id=NULL WHERE id=? AND lease_id=?", final ? "failed" : "pending", next, row.id, lease).run();
      }
    }
    // Reset URLs and task excerpts do not remain in expired or exhausted records.
    await this.repo.statement("UPDATE email_outbox SET body='',recipient='',status='failed' WHERE status<>'sent' AND (expires_at<=? OR (status='failed' AND body<>''))", this.repo.now().toISOString()).run();
    return { sent, failed };
  }
}

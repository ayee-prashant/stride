import { AppError, identifier } from "../domain.ts";
import type { Attachment } from "../productivity.ts";
import { MAX_TASK_FILES, MAX_WORKSPACE_BYTES, verifyFile } from "../files.ts";
import type { ObjectStorage } from "../files.ts";
import { Repository } from "./repository.ts";
import { ProductivityRepository } from "./productivity-repository.ts";

type StoredAttachment = Attachment & { workspace_id: string; object_key: string; status: string };
const missing = () => new AppError(404, "FILE_UNAVAILABLE", "This file is unavailable or you do not have access.");
const publicColumns = "id,task_id,comment_id,filename,media_type,byte_size,uploaded_by,created_at";
export class Attachments {
  repo: Repository; storage: ObjectStorage;
  constructor(repo: Repository, storage: ObjectStorage) { this.repo = repo; this.storage = storage; }
  async list(userId: string, workspaceId: string, taskId: string): Promise<Attachment[]> {
    await this.repo.task(userId, workspaceId, taskId);
    return (await this.repo.statement(`SELECT ${publicColumns} FROM attachments WHERE workspace_id=? AND task_id=? AND status='ready' AND EXISTS(SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?) ORDER BY created_at,id LIMIT 20`, workspaceId, taskId, workspaceId, userId).all<Attachment>()).results;
  }
  async upload(userId: string, workspaceId: string, taskId: string, commentId: string | null, filename: string, bytes: Uint8Array): Promise<Attachment> {
    const file = verifyFile(filename, bytes); const id = crypto.randomUUID(); const objectKey = `tasks/${workspaceId}/${id}`;
    await this.repo.rateLimit(`upload:${userId}`, Date.now(), 10);
    await this.repo.db.transaction(async database => {
      const repo = new Repository(database, this.repo.now);
      await new ProductivityRepository(repo).lockTask(userId, workspaceId, taskId);
      // Serialize workspace byte reservations so parallel uploads cannot bypass the quota.
      await repo.statement("UPDATE workspaces SET name=name WHERE id=?", workspaceId).run();
      if (commentId && !await repo.statement("SELECT id FROM comments WHERE id=? AND workspace_id=? AND task_id=?", identifier(commentId), workspaceId, taskId).first()) throw missing();
      const totals = await repo.statement("SELECT COALESCE(SUM(byte_size),0) AS bytes FROM attachments WHERE workspace_id=? AND status IN ('pending','ready')", workspaceId).first<{ bytes: number | string }>();
      const count = await repo.statement("SELECT COUNT(*) AS n FROM attachments WHERE workspace_id=? AND task_id=? AND status IN ('pending','ready')", workspaceId, taskId).first<{ n: number | string }>();
      if (Number(totals?.bytes ?? 0) + bytes.length > MAX_WORKSPACE_BYTES || Number(count?.n ?? 0) >= MAX_TASK_FILES) throw new AppError(409, "FILE_LIMIT", "The limit is 20 files per task and 200 MB per workspace. Remove an unused attachment first.");
      await repo.statement("INSERT INTO attachments(id,workspace_id,task_id,comment_id,object_key,filename,media_type,byte_size,uploaded_by,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?)", id, workspaceId, taskId, commentId, objectKey, file.filename, file.mediaType, bytes.length, userId, repo.now().toISOString()).run();
    });
    try {
      await this.storage.put(objectKey, bytes, file.mediaType);
      return await this.repo.db.transaction(async database => {
        const repo = new Repository(database, this.repo.now); await new ProductivityRepository(repo).lockTask(userId, workspaceId, taskId);
        const row = await repo.statement(`UPDATE attachments SET status='ready' WHERE id=? AND workspace_id=? AND uploaded_by=? AND status='pending' RETURNING ${publicColumns}`, id, workspaceId, userId).first<Attachment>();
        if (!row) throw missing();
        await repo.statement("INSERT INTO activity(id,workspace_id,task_id,actor_id,action,created_at) VALUES(?,?,?,?,'attached a file to',?)", crypto.randomUUID(), workspaceId, taskId, userId, repo.now().toISOString()).run();
        return row;
      });
    } catch (error) {
      // The row records a cleanup obligation even when object deletion fails.
      await this.repo.statement("UPDATE attachments SET status='removed' WHERE id=? AND workspace_id=?", id, workspaceId).run();
      try { await this.storage.remove(objectKey); await this.repo.statement("DELETE FROM attachments WHERE id=? AND status='removed'", id).run(); } catch { /* Scheduled cleanup retries using the persisted object key. */ }
      throw error;
    }
  }
  async download(userId: string, workspaceId: string, id: string) {
    await this.repo.membership(userId, workspaceId);
    const row = await this.repo.statement(`SELECT a.* FROM attachments a JOIN tasks t ON t.id=a.task_id AND t.workspace_id=a.workspace_id JOIN projects p ON p.id=t.project_id AND p.workspace_id=t.workspace_id
      WHERE a.id=? AND a.workspace_id=? AND a.status='ready' AND t.archived_at IS NULL AND p.archived_at IS NULL AND EXISTS(SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?)`, identifier(id), workspaceId, workspaceId, userId).first<StoredAttachment>();
    if (!row) throw missing();
    return { metadata: row, stream: await this.storage.get(row.object_key) };
  }
  async remove(userId: string, workspaceId: string, id: string) {
    const role = await this.repo.membership(userId, workspaceId);
    const row = await this.repo.statement(`UPDATE attachments SET status='removed' WHERE id=? AND workspace_id=? AND status='ready' AND (uploaded_by=? OR ?='admin')
      AND EXISTS(SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?) RETURNING *`, identifier(id), workspaceId, userId, role, workspaceId, userId).first<StoredAttachment>();
    if (!row) throw missing();
    try { await this.storage.remove(row.object_key); await this.repo.statement("DELETE FROM attachments WHERE id=? AND status='removed'", row.id).run(); } catch { /* Hide immediately; the worker retries storage cleanup. */ }
    return { removed: true };
  }
  async cleanup(): Promise<number> {
    const cutoff = new Date(this.repo.now().getTime() - 3600000).toISOString();
    const rows = await this.repo.statement("UPDATE attachments SET status='removed' WHERE id IN(SELECT id FROM attachments WHERE status='removed' OR (status='pending' AND created_at<?) ORDER BY created_at LIMIT 20) RETURNING id,object_key", cutoff).all<{ id: string; object_key: string }>();
    let cleaned = 0;
    for (const row of rows.results) { try { await this.storage.remove(row.object_key); await this.repo.statement("DELETE FROM attachments WHERE id=? AND status='removed'", row.id).run(); cleaned++; } catch { /* Retain the key for a later job. */ } }
    return cleaned;
  }
}

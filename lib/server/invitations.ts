import { createHash, randomBytes } from "node:crypto";
import { AppError, identifier, object, parseMember, text } from "../domain.ts";
import type { Identity } from "../domain.ts";
import type { Invitation } from "../productivity.ts";
import { Repository } from "./repository.ts";

type StoredInvite = Invitation & { workspace_id: string; created_by: string; workspace_name: string };
const unavailable = () => new AppError(404, "INVITATION_UNAVAILABLE", "This invitation is invalid, expired, revoked, or already used.");
export function invitationHash(token: unknown): string {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable();
  return createHash("sha256").update(token).digest("hex");
}
const validInvite = `i.token_hash=? AND i.expires_at>? AND i.revoked_at IS NULL AND i.accepted_at IS NULL
  AND EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=i.workspace_id AND m.user_id=i.created_by AND m.role='admin')`;

export class Invitations {
  repo: Repository;
  hashPassword: (password: string) => Promise<string>;
  constructor(repo: Repository, hashPassword: (password: string) => Promise<string>) { this.repo = repo; this.hashPassword = hashPassword; }

  async list(userId: string, workspaceId: string): Promise<Invitation[]> {
    await this.repo.membership(userId, workspaceId, true);
    return (await this.repo.statement(`SELECT id,email,role,expires_at,revoked_at,accepted_at,created_at FROM invitations
      WHERE workspace_id=? AND EXISTS(SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=? AND role='admin') ORDER BY created_at DESC,id DESC LIMIT 50`, workspaceId, workspaceId, userId).all<Invitation>()).results;
  }
  async create(userId: string, workspaceId: string, input: unknown) {
    const value = parseMember(input); await this.repo.membership(userId, workspaceId, true);
    const token = randomBytes(32).toString("base64url"); const hash = invitationHash(token); const now = this.repo.now();
    return this.repo.db.transaction(async database => {
      const repo = new Repository(database, this.repo.now); await repo.membership(userId, workspaceId, true);
      await repo.statement("UPDATE workspaces SET name=name WHERE id=?", workspaceId).run();
      const member = await repo.statement("SELECT 1 AS found FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.email=?", workspaceId, value.email).first();
      if (member) throw new AppError(409, "ALREADY_MEMBER", "This person is already a workspace member.");
      const row = await repo.statement(`INSERT INTO invitations(id,workspace_id,email,role,token_hash,created_by,expires_at,created_at)
        SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM invitations WHERE workspace_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?)<50
        RETURNING id,email,role,expires_at,revoked_at,accepted_at,created_at`, crypto.randomUUID(), workspaceId, value.email, value.role, hash, userId, new Date(now.getTime() + 7 * 86400_000).toISOString(), now.toISOString(), workspaceId, now.toISOString()).first<Invitation>();
      if (!row) throw new AppError(409, "INVITATION_LIMIT", "Revoke an unused invitation before creating more. The limit is 50 active links.");
      // Tokens are returned once. Only the hash persists; the fragment never reaches access logs.
      return { invitation: row, path: `/join#token=${token}` };
    });
  }
  async revoke(userId: string, workspaceId: string, id: string, input: unknown) {
    object(input, []); await this.repo.membership(userId, workspaceId, true);
    const row = await this.repo.statement(`UPDATE invitations SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND workspace_id=? AND accepted_at IS NULL
      AND EXISTS(SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=? AND role='admin') RETURNING id`, this.repo.now().toISOString(), identifier(id), workspaceId, workspaceId, userId).first();
    if (!row) throw unavailable(); return { revoked: true };
  }
  async preview(input: unknown) {
    const { token } = object(input, ["token"]); const hash = invitationHash(token);
    await this.repo.rateLimit(`invite:${hash}`, Date.now(), 30);
    const row = await this.repo.statement(`SELECT i.id,i.email,i.role,i.expires_at,w.name AS workspace_name FROM invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE ${validInvite}`, hash, this.repo.now().toISOString()).first<StoredInvite>();
    if (!row) throw unavailable();
    const existing = await this.repo.statement("SELECT id FROM auth_users WHERE email=?", row.email).first();
    return { email: row.email, workspace_name: row.workspace_name, expires_at: row.expires_at, existing_account: !!existing };
  }
  async accept(identity: Identity | null, input: unknown) {
    const value = object(input, ["token", "name", "password"]); const hash = invitationHash(value.token);
    const preview = await this.preview({ token: value.token });
    if (identity && identity.email.toLowerCase() !== preview.email) throw new AppError(403, "WRONG_ACCOUNT", "Sign in with the email address on this invitation.");
    if (preview.existing_account && !identity) throw new AppError(401, "SIGN_IN_REQUIRED", "Sign in to your existing account before accepting this invitation.");
    let name = identity?.displayName ?? ""; let passwordHash: string | null = null;
    if (!preview.existing_account) {
      name = text(value.name, "Name", 80);
      if (typeof value.password !== "string" || value.password.length < 12 || value.password.length > 128) throw new AppError(400, "INVALID_PASSWORD", "Use a password between 12 and 128 characters.");
      passwordHash = await this.hashPassword(value.password);
    }
    return this.repo.db.transaction(async database => {
      const repo = new Repository(database, this.repo.now); const now = repo.now().toISOString();
      // Lock the one-use capability before checking and assigning admission.
      const locked = await repo.statement(`UPDATE invitations SET token_hash=token_hash WHERE id IN(SELECT i.id FROM invitations i WHERE ${validInvite}) RETURNING *`, hash, now).first<StoredInvite>();
      if (!locked) throw unavailable();
      await repo.membership(locked.created_by, locked.workspace_id, true);
      await repo.statement("UPDATE workspaces SET name=name WHERE id=?", locked.workspace_id).run();
      const existing = await repo.statement("SELECT id,email,name FROM auth_users WHERE email=?", locked.email).first<{ id: string; email: string; name: string }>();
      let user: Identity;
      if (existing) {
        if (!identity || existing.id !== identity.userId || existing.email.toLowerCase() !== identity.email.toLowerCase()) throw new AppError(401, "SIGN_IN_REQUIRED", "Sign in to the invited account before accepting.");
        user = { userId: existing.id, email: existing.email, displayName: existing.name };
      } else {
        if (!passwordHash) throw conflict();
        user = { userId: crypto.randomUUID(), email: locked.email, displayName: name };
        await repo.statement("INSERT INTO auth_users(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,FALSE,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", user.userId, name, user.email).run();
        await repo.statement("INSERT INTO auth_accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", crypto.randomUUID(), user.userId, user.userId, passwordHash).run();
      }
      const counts = await repo.statement("SELECT COUNT(*) AS n FROM memberships WHERE workspace_id=?", locked.workspace_id).first<{ n: number | string }>();
      const userCount = await repo.statement("SELECT COUNT(*) AS n FROM memberships WHERE user_id=?", user.userId).first<{ n: number | string }>();
      if (Number(counts?.n ?? 0) >= 200 || Number(userCount?.n ?? 0) >= 49) throw new AppError(409, "MEMBER_LIMIT", "The workspace or account membership limit was reached.");
      await repo.bootstrap(user);
      await repo.statement("INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?,?) ON CONFLICT(workspace_id,user_id) DO NOTHING", locked.workspace_id, user.userId, locked.role).run();
      await repo.statement("INSERT INTO account_admissions(user_id,invitation_id,email,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO NOTHING", user.userId, locked.id, user.email, now).run();
      await repo.statement("UPDATE invitations SET accepted_at=?,accepted_by=? WHERE id=?", now, user.userId, locked.id).run();
      return { accepted: true, workspace_id: locked.workspace_id, requires_sign_in: !identity };
    });
  }
}
function conflict() { return new AppError(409, "ACCOUNT_CHANGED", "The account changed. Refresh this invitation before trying again."); }

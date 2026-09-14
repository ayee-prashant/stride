import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./sqlite.ts";
import { Repository } from "../lib/server/repository.ts";
import { Invitations, invitationHash } from "../lib/server/invitations.ts";
import { Attachments } from "../lib/server/attachments.ts";
import { createMailProvider, EmailOutbox, openEmail, sealEmail } from "../lib/server/email.ts";
import { verifyFile, MAX_FILE_BYTES } from "../lib/files.ts";
import type { ObjectStorage } from "../lib/files.ts";
import { handleFile } from "../lib/server/file-http.ts";
import { ScheduledWork } from "../lib/server/scheduled-work.ts";
import { ProductivityRepository } from "../lib/server/productivity-repository.ts";
import { DEFAULT_PREFERENCES } from "../lib/productivity.ts";

function fakeStorage() {
  const files = new Map<string, Uint8Array>();
  const storage: ObjectStorage = {
    async put(key, bytes) { files.set(key, bytes.slice()); },
    async get(key) { const bytes = files.get(key); if (!bytes) throw new Error("Missing"); return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }); },
    async remove(key) { files.delete(key); },
  }; return { storage, files };
}
test("invitations are admin-only, hashed, expiring and single-use; existing passwords cannot be replaced", async () => {
  const f = await fixture();
  f.db.raw.exec(`CREATE TABLE auth_users(id TEXT PRIMARY KEY,name TEXT,email TEXT UNIQUE,email_verified INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE auth_accounts(id TEXT PRIMARY KEY,account_id TEXT,provider_id TEXT,user_id TEXT,password TEXT,created_at TEXT,updated_at TEXT);`);
  f.db.raw.prepare("INSERT INTO auth_users(id,name,email) VALUES('other','Other','other@example.test')").run();
  const repo = new Repository(f.db, () => new Date("2026-09-14T12:00:00Z")); let hashes = 0;
  const service = new Invitations(repo, async () => { hashes++; return "fake-unit-test-hash"; });
  await assert.rejects(service.create("other", f.workspace, { email: "new@example.test" }), { status: 404 });
  const invite = await service.create("owner", f.workspace, { email: "new@example.test" });
  const token = invite.path.split("token=")[1]; const stored = f.db.raw.prepare("SELECT token_hash FROM invitations WHERE id=?").get(invite.invitation.id)!;
  assert.equal(stored.token_hash, invitationHash(token)); assert.notEqual(stored.token_hash, token);
  const joined = await service.accept(null, { token, name: "New teammate", password: "safe-test-password" });
  assert.equal(joined.accepted, true); assert.equal(hashes, 1);
  await assert.rejects(service.accept(null, { token, name: "Again", password: "safe-test-password" }), { status: 404 });
  const existing = await service.create("owner", f.workspace, { email: "other@example.test" }); const existingToken = existing.path.split("token=")[1];
  await assert.rejects(service.accept(null, { token: existingToken, password: "take-over-password" }), { status: 401 });
  assert.equal(hashes, 1);
  await service.accept(f.other, { token: existingToken }); assert.equal((await repo.metadata("other", f.workspace)).role, "member");
  const revoked = await service.create("owner", f.workspace, { email: "revoked@example.test" });
  await service.revoke("owner", f.workspace, revoked.invitation.id, {});
  await assert.rejects(service.preview({ token: revoked.path.split("token=")[1] }), { status: 404 });
  const expired = await service.create("owner", f.workspace, { email: "expired@example.test" });
  const later = new Invitations(new Repository(f.db, () => new Date("2026-09-22T00:00:00Z")), async () => "unused");
  await assert.rejects(later.preview({ token: expired.path.split("token=")[1] }), { status: 404 });
  f.db.raw.close();
});
test("invitation acceptance rolls back a new credential and admission when admission persistence fails", async () => {
  const f = await fixture();
  f.db.raw.exec(`CREATE TABLE auth_users(id TEXT PRIMARY KEY,name TEXT,email TEXT UNIQUE,email_verified INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE auth_accounts(id TEXT PRIMARY KEY,account_id TEXT,provider_id TEXT,user_id TEXT,password TEXT,created_at TEXT,updated_at TEXT);`);
  const service = new Invitations(f.repo, async () => "fake-unit-test-hash"); const invite = await service.create("owner", f.workspace, { email: "rollback@example.test" });
  f.db.raw.exec("CREATE TRIGGER reject_join BEFORE INSERT ON account_admissions BEGIN SELECT RAISE(ABORT,'fixture rejection'); END");
  await assert.rejects(service.accept(null, { token: invite.path.split("token=")[1], name: "Rollback", password: "safe-test-password" }));
  assert.equal(f.db.raw.prepare("SELECT COUNT(*) AS n FROM auth_users").get()!.n, 0);
  assert.equal(f.db.raw.prepare("SELECT COUNT(*) AS n FROM auth_accounts").get()!.n, 0);
  assert.equal(f.db.raw.prepare("SELECT accepted_at FROM invitations").get()!.accepted_at, null); f.db.raw.close();
});
test("uploads reject disguised binaries, traversal filenames, invalid encoding and excess size", () => {
  const bytes = new TextEncoder().encode("A plain document");
  assert.equal(verifyFile("plan.txt", bytes).mediaType, "text/plain");
  for (const name of ["bad.png", "../private.txt", "x.html", "x.svg", "file.exe"]) assert.throws(() => verifyFile(name, bytes));
  assert.throws(() => verifyFile("bad.txt", new Uint8Array([0, 255])));
  assert.throws(() => verifyFile("huge.txt", new Uint8Array(MAX_FILE_BYTES + 1)), { status: 413 });
});
test("files enforce task/comment tenant boundaries, download auth and uploader/admin deletion", async () => {
  const f = await fixture(); const { storage, files } = fakeStorage(); const service = new Attachments(f.repo, storage);
  const task = await f.repo.createTask("owner", f.workspace, { title: "Files", project_id: f.project });
  const otherTask = await f.repo.createTask("other", "ws_other", { title: "Other", project_id: "project_other" });
  const comment = await f.repo.createComment("other", "ws_other", otherTask.id, { body: "Private" });
  const bytes = new TextEncoder().encode("Notes");
  await assert.rejects(service.upload("owner", f.workspace, task.id, comment.id, "notes.txt", bytes), { status: 404 });
  assert.equal(files.size, 0);
  const file = await service.upload("owner", f.workspace, task.id, null, "notes.txt", bytes);
  await assert.rejects(service.download("other", f.workspace, file.id), { status: 404 });
  await f.repo.addMember("owner", f.workspace, { email: "other@example.test" });
  assert.equal(await new Response((await service.download("other", f.workspace, file.id)).stream).text(), "Notes");
  await assert.rejects(service.remove("other", f.workspace, file.id), { status: 404 });
  const response = await handleFile(new Request(`https://stride.test/api/files?workspace_id=${f.workspace}&id=${file.id}`), { identity: async () => f.owner, origin: "https://stride.test", attachments: () => service });
  assert.equal(response.headers.get("Content-Type"), "application/octet-stream"); assert.match(response.headers.get("Content-Disposition")!, /^attachment;/);
  await service.remove("owner", f.workspace, file.id); assert.equal(files.size, 0); f.db.raw.close();
});
test("failed uploads release reservations; file HTTP rejects cross-origin and anonymous writes", async () => {
  const f = await fixture(); const { storage } = fakeStorage(); storage.put = async () => { throw new Error("Object store unavailable"); };
  const service = new Attachments(f.repo, storage); const task = await f.repo.createTask("owner", f.workspace, { title: "Files", project_id: f.project });
  await assert.rejects(service.upload("owner", f.workspace, task.id, null, "plan.txt", new TextEncoder().encode("Plan")));
  assert.equal(f.db.raw.prepare("SELECT COUNT(*) AS n FROM attachments").get()!.n, 0);
  const makeRequest = () => new Request(`https://stride.test/api/files?workspace_id=${f.workspace}&task_id=${task.id}`, { method: "POST", headers: { Origin: "https://evil.test", "Content-Type": "application/octet-stream", "X-File-Name": "plan.txt" }, body: "Plan" });
  assert.equal((await handleFile(makeRequest(), { identity: async () => f.owner, origin: "https://stride.test", attachments: () => service })).status, 403);
  assert.equal((await handleFile(makeRequest(), { identity: async () => null, origin: "https://stride.test", attachments: () => service })).status, 401); f.db.raw.close();
});
test("outbox encrypts recovery links, deduplicates sends, retries safely and erases delivered secrets", async () => {
  const f = await fixture(); let time = new Date("2026-09-14T12:00:00Z"); const repo = new Repository(f.db, () => time);
  const secret = "isolated-unit-test-secret-at-least-32-characters"; const outbox = new EmailOutbox(repo, secret);
  const sealed = sealEmail("sensitive reset URL", secret); assert.ok(!sealed.includes("sensitive")); assert.equal(openEmail(sealed, secret), "sensitive reset URL"); assert.throws(() => openEmail(sealed, secret + "wrong"));
  const mail = { to: "fictional@example.test", subject: "Reset", text: "sensitive reset URL", key: "test-reset-key" };
  await outbox.enqueue(mail, "reset", "2026-09-14T12:30:00Z"); await outbox.enqueue(mail, "reset", "2026-09-14T12:30:00Z");
  assert.equal(f.db.raw.prepare("SELECT COUNT(*) AS n FROM email_outbox").get()!.n, 1);
  assert.equal((await outbox.deliver({ send: async () => { throw new Error("Temporary outage"); } })).failed, 1);
  time = new Date("2026-09-14T12:05:00Z"); let sends = 0;
  const provider = { async send(value: typeof mail) { sends++; assert.equal(value.key, mail.key); assert.equal(value.text, mail.text); } };
  assert.equal((await outbox.deliver(provider)).sent, 1); await outbox.deliver(provider); assert.equal(sends, 1);
  assert.equal(f.db.raw.prepare("SELECT body FROM email_outbox").get()!.body, "");
  const transport: typeof fetch = async (_url, init) => { assert.equal(new Headers(init?.headers).get("Idempotency-Key"), mail.key); return Response.json({ id: "test" }); };
  await createMailProvider({ RESEND_API_KEY: "fake-not-a-production-key", STRIDE_EMAIL_FROM: "no-reply@example.test" }, transport).send(mail); f.db.raw.close();
});
test("scheduled reminders and daily summaries are opt-in, deduplicated and respect task mute", async () => {
  const f = await fixture(); const repo = new Repository(f.db, () => new Date("2026-09-14T10:00:00Z")); const s = new ProductivityRepository(repo);
  await s.savePreferences("owner", f.workspace, { ...DEFAULT_PREFERENCES, daily_digest: true });
  const task = await repo.createTask("owner", f.workspace, { title: "Due today", project_id: f.project, due_date: "2026-09-14" });
  const worker = new ScheduledWork(repo, "isolated-test-secret-at-least-32-characters", "https://stride.test", new Set(["owner@example.test", "other@example.test"]));
  let sends = 0; const provider = { async send() { sends++; } };
  await worker.run(provider); await worker.run(provider);
  assert.equal(sends, 1);
  assert.equal((await repo.notifications("owner", f.workspace, {})).notifications.filter(n => n.kind === "reminder").length, 1);
  await s.muteTask("owner", f.workspace, task.id, { muted: true });
  assert.equal((await repo.notifications("owner", f.workspace, {})).notifications.length, 0); f.db.raw.close();
});

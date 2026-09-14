import { Pool } from "pg";
import { openEmail } from "../lib/server/email.ts";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { verifyBrowser } from "./test-browser-runtime.mjs";

const fixtureUrl = new URL(process.env.TEST_DATABASE_URL ?? "");
if (process.env.CI !== "true" || !["127.0.0.1", "localhost"].includes(fixtureUrl.hostname) || fixtureUrl.pathname !== "/stride_test") {
  throw new Error("This test requires the isolated CI database");
}
fixtureUrl.username = "stride_app";
fixtureUrl.password = process.env.STRIDE_RUNTIME_PASSWORD;
const origin = "http://127.0.0.1:3107";
const ownerEmail = process.env.STRIDE_BOOTSTRAP_EMAIL;
const ownerPassword = process.env.STRIDE_BOOTSTRAP_PASSWORD;
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3107"], {
  env: { ...process.env, NODE_ENV: "test", APP_URL: origin, DATABASE_URL: fixtureUrl.toString(),
    BETTER_AUTH_SECRET: "isolated-ci-session-secret-do-not-use-in-production",
    STRIDE_ALLOWED_EMAILS: ownerEmail,
    RESEND_API_KEY: "ci-fixture-no-network-delivery", STRIDE_EMAIL_FROM: "test@stride.invalid",
  },
  stdio: "ignore",
});
let stage = "startup";
let cookie = "";
async function request(path, method = "GET", body, extraHeaders = {}) {
  const response = await fetch(origin + path, { method, redirect: "manual",
    headers: { origin, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
  });
  const newCookies = response.headers.getSetCookie();
  if (newCookies.length) cookie = newCookies.map(value => value.split(";")[0]).join("; ");
  return response;
}
async function json(response, expected = 200) {
  assert.equal(response.status, expected);
  return response.json();
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 35; attempt++) {
    try { if ((await request("/api/health")).status === 200) { ready = true; break; } } catch {}
    if (child.exitCode !== null) break;
    await delay(500);
  }
  assert.equal(ready, true);
  stage = "closed-enrollment";
  assert.equal((await request("/api/tasks?workspace_id=unavailable")).status, 401);
  assert.equal((await request("/api/bootstrap", "POST", {}, { "oai-authenticated-user-id": "forged", cookie: "stride.session_token=forged" })).status, 401);
  const signup = await request("/api/auth/sign-up/email", "POST", { name: "Unapproved", email: "unapproved@example.test", password: "isolated-fixture-password" });
  assert.equal([400, 403, 404].includes(signup.status), true);
  stage = "sign-in";
  await json(await request("/api/auth/sign-in/email", "POST", { email: ownerEmail, password: ownerPassword }));
  assert.equal(cookie.includes("session_token="), true);
  const signedInCookie = cookie;
  stage = "workspace";
  const bootstrap = await json(await request("/api/bootstrap", "POST", {}));
  const workspaceId = bootstrap.workspaces[0].id;
  const metadata = await json(await request("/api/workspace?workspace_id=" + workspaceId));
  const html = await (await request("/")).text();
  assert.equal(html.includes("My Tasks"), true);
  assert.equal((await request("/favicon.svg")).status, 200);
  stage = "tasks";
  const created = await json(await request("/api/tasks?workspace_id=" + workspaceId, "POST", { title: "Isolated runtime verification", project_id: metadata.projects[0].id, assignee_id: bootstrap.user.userId }), 201);
  let task = await json(await request("/api/tasks/" + created.id + "?workspace_id=" + workspaceId, "PATCH", { version: created.version, status: "done" }));
  assert.equal(task.status, "done");
  const reloaded = await json(await request("/api/tasks/" + task.id + "?workspace_id=" + workspaceId));
  assert.equal(reloaded.completed_at !== null, true);
  task = await json(await request("/api/tasks/" + task.id + "?workspace_id=" + workspaceId, "PATCH", { version: task.version, status: "todo" }));
  assert.equal(task.completed_at, null);
  assert.equal((await request("/api/tasks/" + task.id + "?workspace_id=" + workspaceId, "PATCH", { version: created.version, title: "stale" })).status, 409);
  task = await json(await request("/api/tasks/" + task.id + "?workspace_id=" + workspaceId, "PATCH", { version: task.version, archived: true }));
  assert.equal(task.archived_at !== null, true);
  task = await json(await request("/api/tasks/" + task.id + "?workspace_id=" + workspaceId, "PATCH", { version: task.version, archived: false }));
  assert.equal(task.archived_at, null);
  stage = "project-context";
  const contextPath = `/api/projects/${metadata.projects[0].id}/context?workspace_id=${workspaceId}`;
  const contextInput = { request_id: crypto.randomUUID(), expected_version: 0, kind: "requirement", title: "Runtime context requirement", body: "Every task brief preserves the approved requirement version.", change_note: "Runtime contract verification" };
  const documentPath = `/api/projects/${metadata.projects[0].id}/context/documents?workspace_id=${workspaceId}`;
  const document = await json(await request(documentPath, "POST", contextInput), 201);
  assert.equal((await json(await request(documentPath, "POST", contextInput), 201)).document_id, document.document_id);
  const projectBrief = await json(await request(contextPath));
  const taskBriefPath = `/api/tasks/${task.id}/context?workspace_id=${workspaceId}`;
  const taskBrief = await json(await request(taskBriefPath, "POST", { request_id: crypto.randomUUID(), task_version: task.version, context_sequence: projectBrief.sequence, requirement_ids: [document.document_id] }), 201);
  assert.equal(taskBrief.check.state, "current");
  assert.equal(taskBrief.check.execution_ready, false);
  await json(await request(documentPath, "POST", { ...contextInput, request_id: crypto.randomUUID(), document_id: document.document_id, expected_version: document.version, body: "Changed approved requirement." }), 201);
  const staleBrief = await json(await request(taskBriefPath));
  assert.equal(staleBrief.check.state, "stale");
  assert.equal(staleBrief.brief.payload.documents[0].body, contextInput.body);
  const restricted = new Pool({ connectionString: fixtureUrl.toString(), max: 1 });
  try {
    for (const table of ["context_revisions", "context_events", "task_context_briefs"]) {
      const privileges = await restricted.query("SELECT has_table_privilege(current_user,$1,'UPDATE') AS can_update, has_table_privilege(current_user,$1,'DELETE') AS can_delete", [table]);
      assert.deepEqual(privileges.rows[0], { can_update: false, can_delete: false });
    }
  } finally { await restricted.end(); }
  stage = "collaboration";
  assert.equal(created.responsible_id, bootstrap.user.userId);
  const commentsPath = "/api/tasks/" + task.id + "/comments?workspace_id=" + workspaceId;
  const comment = await json(await request(commentsPath, "POST", { body: "Runtime comment <b>plain text</b>", mentioned_user_ids: [bootstrap.user.userId] }), 201);
  assert.equal((await json(await request(commentsPath))).comments[0].id, comment.id);
  task = await json(await request("/api/tasks/" + task.id + "?workspace_id=" + workspaceId, "PATCH", { version: task.version, due_date: "2000-01-01" }));
  const inboxPath = "/api/notifications/sync?workspace_id=" + workspaceId;
  const inbox = await json(await request(inboxPath, "POST", { tz_offset: 0 }));
  const overdue = inbox.notifications.find(item => item.task_id === task.id && item.kind === "overdue");
  assert.ok(overdue);
  await json(await request("/api/notifications/" + encodeURIComponent(overdue.id) + "?workspace_id=" + workspaceId, "PATCH", {}));
  assert.equal((await json(await request(inboxPath, "POST", {}))).notifications.find(item => item.id === overdue.id).read_at !== null, true);
  const filtered = await json(await request("/api/tasks?workspace_id=" + workspaceId + "&due=overdue&sort=priority&assignee_id=" + bootstrap.user.userId));
  assert.equal(filtered.tasks.some(item => item.id === task.id), true);
  stage = "origin-and-tenant";
  assert.equal((await request("/api/bootstrap", "POST", {}, { origin: "https://untrusted.example" })).status, 403);
  assert.equal((await request("/api/workspace?workspace_id=unavailable")).status, 404);
  stage = "invitation-session-flow";
  const ownerCookie = cookie;
  const invitedEmail = `runtime-invite-${crypto.randomUUID()}@example.test`;
  const invitation = await json(await request("/api/invitations?workspace_id=" + workspaceId, "POST", { email: invitedEmail, role: "member" }));
  const inviteToken = invitation.path.split("token=")[1]; cookie = "";
  assert.equal((await json(await request("/api/invitations/preview", "POST", { token: inviteToken }))).existing_account, false);
  await json(await request("/api/invitations/accept", "POST", { token: inviteToken, name: "Invited runtime fixture", password: "isolated-invitation-password" }));
  assert.equal((await request("/api/invitations/accept", "POST", { token: inviteToken, name: "Again", password: "isolated-invitation-password" })).status, 404);
  await json(await request("/api/auth/sign-in/email", "POST", { email: invitedEmail, password: "isolated-invitation-password" }));
  assert.equal((await json(await request("/api/workspace?workspace_id=" + workspaceId))).role, "member");
  assert.equal((await request("/api/invitations?workspace_id=" + workspaceId, "POST", { email: "denied@example.test" })).status, 403);
  await json(await request("/api/auth/sign-out", "POST", {})); cookie = ownerCookie;
  stage = "browser";
  await verifyBrowser(origin, cookie);
  stage = "password-change";
  const changedPassword = ownerPassword + "-changed";
  await json(await request("/api/auth/change-password", "POST", { currentPassword: ownerPassword, newPassword: changedPassword, revokeOtherSessions: true }));
  cookie = "";
  assert.equal((await request("/api/auth/sign-in/email", "POST", { email: ownerEmail, password: ownerPassword })).status, 401);
  await json(await request("/api/auth/sign-in/email", "POST", { email: ownerEmail, password: changedPassword }));
  await json(await request("/api/auth/change-password", "POST", { currentPassword: changedPassword, newPassword: ownerPassword, revokeOtherSessions: true }));
  cookie = "";
  await json(await request("/api/auth/sign-in/email", "POST", { email: ownerEmail, password: ownerPassword }));
  stage = "password-recovery";
  const beforeResetCookie = cookie;
  await json(await request("/api/auth/request-password-reset", "POST", { email: ownerEmail, redirectTo: origin + "/reset-password" }));
  const database = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  let resetUrl;
  try {
    const rows = await database.query("SELECT body FROM email_outbox WHERE kind='reset' AND recipient=$1 ORDER BY created_at DESC LIMIT 1", [ownerEmail]);
    assert.equal(rows.rowCount, 1);
    const body = openEmail(rows.rows[0].body, "isolated-ci-session-secret-do-not-use-in-production");
    resetUrl = new URL(body.split("\n").find(line => line.startsWith(origin + "/api/auth/")));
  } finally { await database.end(); }
  cookie = "";
  const redirect = await request(resetUrl.pathname + resetUrl.search);
  assert.equal([302, 303].includes(redirect.status), true);
  const resetToken = new URL(redirect.headers.get("location"), origin).searchParams.get("token"); assert.ok(resetToken);
  const recoveredPassword = ownerPassword + "-recovered";
  await json(await request("/api/auth/reset-password", "POST", { token: resetToken, newPassword: recoveredPassword }));
  assert.equal((await request("/api/workspace?workspace_id=" + workspaceId, "GET", undefined, { cookie: beforeResetCookie })).status, 401);
  assert.equal((await request("/api/auth/reset-password", "POST", { token: resetToken, newPassword: ownerPassword })).status >= 400, true);
  await json(await request("/api/auth/sign-in/email", "POST", { email: ownerEmail, password: recoveredPassword }));
  await json(await request("/api/auth/change-password", "POST", { currentPassword: recoveredPassword, newPassword: ownerPassword, revokeOtherSessions: true }));
  stage = "sign-out";
  const cookieBeforeSignOut = cookie;
  await json(await request("/api/auth/sign-out", "POST", {}));
  cookie = "";
  assert.equal((await request("/api/workspace?workspace_id=" + workspaceId, "GET", undefined, { cookie: cookieBeforeSignOut })).status, 401);
  assert.equal((await request("/api/workspace?workspace_id=" + workspaceId, "GET", undefined, { cookie: signedInCookie })).status, 401);
  console.log("Authenticated Next.js/PostgreSQL runtime flow passed.");
} catch {
  console.error(JSON.stringify({ event: "auth_runtime_check_failed", stage }));
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  const forceKill = setTimeout(() => child.kill("SIGKILL"), 3000);
  forceKill.unref();
  await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once("exit", resolve); });
  clearTimeout(forceKill);
}

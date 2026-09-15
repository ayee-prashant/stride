import { Pool } from "pg";
import { openEmail } from "../lib/server/email.ts";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { verifyAgentRuntime } from "./test-agent-runtime.mjs";
import { verifyBrowser } from "./test-browser-runtime.mjs";
import { Repository } from "../lib/server/repository.ts";
import { PostgresDatabase } from "../lib/server/postgres-adapter.ts";
import { RepositorySources } from "../lib/server/repository-sources.ts";
import { GitHubContextError } from "../lib/server/github-context-provider.ts";
import { parseBinding } from "../lib/github-context.ts";
import { observation } from "../tests/repository-source-contract.ts";

const fixtureUrl = new URL(process.env.TEST_DATABASE_URL ?? "");
if (process.env.CI !== "true" || !["127.0.0.1", "localhost"].includes(fixtureUrl.hostname) || fixtureUrl.pathname !== "/stride_test") {
  throw new Error("This test requires the isolated CI database");
}
fixtureUrl.username = "stride_app";
fixtureUrl.password = process.env.STRIDE_RUNTIME_PASSWORD;
const origin = "http://127.0.0.1:3107";
const ownerEmail = process.env.STRIDE_BOOTSTRAP_EMAIL;
const ownerPassword = process.env.STRIDE_BOOTSTRAP_PASSWORD;
// Seed only an isolated test project grant. The application still uses genuine human sessions.
const setupPool = new Pool({ connectionString: fixtureUrl.toString(), max: 1 });
let repositoryBinding;
try {
  const user = (await setupPool.query("SELECT id,name,email FROM auth_users WHERE email=$1", [ownerEmail])).rows[0];
  assert.ok(user);
  const repository = new Repository(new PostgresDatabase(setupPool));
  const workspace = (await repository.bootstrap({ userId: user.id, email: user.email, displayName: user.name })).workspaces[0].id;
  const project = (await repository.metadata(user.id, workspace)).projects[0].id;
  repositoryBinding = parseBinding({ key: "browser_repository", workspace_id: workspace, project_id: project, repository_id: 1234, installation_id: 5678, owner: "fixture", repository: "project", branch: "main", paths: ["docs/ARCHITECTURE.md"] });
} finally { await setupPool.end(); }
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3107"], {
  env: { ...process.env, NODE_ENV: "test", APP_URL: origin, DATABASE_URL: fixtureUrl.toString(),
    BETTER_AUTH_SECRET: "isolated-ci-session-secret-do-not-use-in-production",
    STRIDE_ALLOWED_EMAILS: ownerEmail,
    STRIDE_GITHUB_CONTEXT_BINDINGS: JSON.stringify([repositoryBinding]),
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
  if (newCookies.length) {
    const jar = new Map(cookie.split("; ").filter(Boolean).map(pair => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]));
    for (const value of newCookies) { const pair = value.split(";")[0]; const at = pair.indexOf("="); if (at > 0) { const name = pair.slice(0, at); const content = pair.slice(at + 1); if (content) jar.set(name, content); else jar.delete(name); } }
    cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  }
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
  stage = "human-agent-role";
  const agentPath = `/api/projects/${metadata.projects[0].id}/agents`;
  const agentSuffix = `?workspace_id=${workspaceId}`;
  const roleTemplate = await json(await request(`${agentPath}/roles/development${agentSuffix}`));
  const roleRequest = { request_id: crypto.randomUUID(), profile: { alias: "RUNTIME-DEV", operator_id: bootstrap.user.userId, tool_label: "Isolated fixture" }, role_id: "development", template_hash: roleTemplate.hash, read_paths: ["tests/"], write_paths: ["tests/"], reason: "Runtime role registration" };
  const registeredRole = await json(await request(agentPath + agentSuffix, "POST", roleRequest), 201);
  assert.equal(registeredRole.binding.state, "pending");
  assert.equal((await json(await request(agentPath + agentSuffix, "POST", roleRequest), 201)).event_id, registeredRole.event_id);
  const roleDecision = { request_id: crypto.randomUUID(), expected_version: registeredRole.binding.version, template_hash: roleTemplate.hash, reason: "Runtime operator accepts scoped responsibility" };
  const initializedRole = await json(await request(`${agentPath}/${registeredRole.binding.id}/initialize${agentSuffix}`, "POST", roleDecision));
  assert.equal(initializedRole.binding.state, "initialized");
  assert.equal(initializedRole.binding.execution_ready, false);
  assert.equal(initializedRole.binding.connection_state, "not_connected");
  assert.equal((await request(`${agentPath}/${registeredRole.binding.id}/start${agentSuffix}`, "POST", {})).status, 404);
  const revokedRole = await json(await request(`${agentPath}/${registeredRole.binding.id}/revoke${agentSuffix}`, "POST", { request_id: crypto.randomUUID(), expected_version: initializedRole.binding.version, reason: "Runtime role withdrawal" }));
  assert.equal(revokedRole.binding.state, "revoked");
  assert.equal((await json(await request(`${agentPath}/${registeredRole.binding.id}/initialize${agentSuffix}`, "POST", roleDecision))).binding.state, "revoked");
  const roleHistory = await json(await request(`${agentPath}/${registeredRole.binding.id}/history${agentSuffix}`));
  assert.deepEqual(roleHistory.events.map(e => e.action), ["revoked", "initialized", "registered"]);
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
    for (const table of ["context_revisions", "context_events", "task_context_briefs", "repository_observations", "repository_source_events", "repository_source_receipts", "agent_profiles", "agent_role_events", "delivery_packets", "delivery_events"]) {
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
  stage = "agent-runtime";
  const deliveryReview = await verifyAgentRuntime({ origin, request, json, userId: bootstrap.user.userId, workspaceId, projectId: metadata.projects[0].id });
  stage = "browser";
  const sourcePool = new Pool({ connectionString: fixtureUrl.toString(), max: 1 });
  try {
    const repository = new Repository(new PostgresDatabase(sourcePool));
    const sources = new RepositorySources(repository, [repositoryBinding]);
    await verifyBrowser(origin, cookie, async (head = "a") => {
      // Make this test job due immediately; no application endpoint bypasses the normal cooldown.
      await repository.statement("UPDATE repository_sources SET next_refresh_at=? WHERE workspace_id=? AND project_id=?", new Date().toISOString(), repositoryBinding.workspace_id, repositoryBinding.project_id).run();
      const claim = await sources.claim(); assert.ok(claim);
      const result = head === "unavailable" ? new GitHubContextError("access_unavailable") : { ...observation(repositoryBinding, head, "CI repository fact <script>window.__repositoryXss=true</script>"), observed_at: new Date().toISOString() };
      assert.equal(await sources.finish(claim, result), true);
    }, deliveryReview);
  } finally { await sourcePool.end(); }
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
} catch (error) {
  console.error(JSON.stringify({ event: "auth_runtime_check_failed", stage, kind: error?.name, expected: typeof error?.expected === "number" ? error.expected : undefined, actual: typeof error?.actual === "number" ? error.actual : undefined, frames: error instanceof Error ? error.stack?.split("\n").filter(line => line.trim().startsWith("at ")).slice(0, 3) : [] }));
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  const forceKill = setTimeout(() => child.kill("SIGKILL"), 3000);
  forceKill.unref();
  await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once("exit", resolve); });
  clearTimeout(forceKill);
}

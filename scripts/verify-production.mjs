import assert from "node:assert/strict";

// Run only as a controlled job in the dedicated Stride production environment.
// This checks the private application service, not public DNS, CDN, or browser UX.
const expectedProject = "ccf1a908-637a-49c5-9e87-6b70e2ff1f87";
const expectedEnvironment = "36f9def0-14ef-4b84-b789-ecb893dd37a1";
const expectedOrigin = "https://stride-app-production-d72b.up.railway.app";
let stage = "configuration";
let status;
let target;
const cookie = new Map();
let workspaceId;
let verificationTaskId;
let archived = false;
const checks = [];

async function request(path, method = "GET", body, extraHeaders = {}) {
  const response = await fetch(new URL(path, target), {
    method,
    redirect: "manual",
    headers: {
      origin: expectedOrigin,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie.size ? { cookie: [...cookie].map(([key, value]) => key + "=" + value).join("; ") } : {}),
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  status = response.status;
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";")[0];
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const key = pair.slice(0, separator);
    const token = pair.slice(separator + 1);
    if (!token || /;\s*max-age=0(?:;|$)/i.test(value)) cookie.delete(key);
    else cookie.set(key, token);
  }
  return response;
}
async function json(response, expected = 200) {
  assert.equal(response.status, expected);
  return response.json();
}
function taskPath() {
  return "/api/tasks/" + encodeURIComponent(verificationTaskId) + "?workspace_id=" + encodeURIComponent(workspaceId);
}
try {
  assert.equal(process.env.RAILWAY_PROJECT_ID, expectedProject);
  assert.equal(process.env.RAILWAY_ENVIRONMENT_ID, expectedEnvironment);
  assert.equal(process.env.STRIDE_VERIFY_ORIGIN, expectedOrigin);
  target = new URL(process.env.STRIDE_INTERNAL_URL);
  assert.equal(target.protocol, "http:");
  assert.equal(target.hostname, "stride-app.railway.internal");
  assert.equal(target.port, "8080");
  assert.equal(target.pathname, "/");
  assert.equal(target.username + target.password + target.search + target.hash, "");
  assert.equal(typeof process.env.STRIDE_BOOTSTRAP_EMAIL, "string");
  assert.ok(process.env.STRIDE_BOOTSTRAP_PASSWORD?.length >= 12);

  stage = "readiness";
  const health = await json(await request("/api/health"));
  assert.equal(health.status, "ready");
  checks.push(stage);

  stage = "closed-enrollment";
  assert.equal((await request("/api/tasks?workspace_id=unavailable")).status, 401);
  assert.equal((await request("/api/bootstrap", "POST", {}, {
    "oai-authenticated-user-id": "forged",
    cookie: "__Secure-stride.session_token=forged",
  })).status, 401);
  const signup = await request("/api/auth/sign-up/email", "POST", {
    name: "Unapproved verification", email: "unapproved@stride.invalid",
    password: "unused-production-check-password",
  });
  assert.ok([400, 403, 404].includes(signup.status));
  checks.push(stage);

  stage = "sign-in";
  const login = await request("/api/auth/sign-in/email", "POST", {
    email: process.env.STRIDE_BOOTSTRAP_EMAIL,
    password: process.env.STRIDE_BOOTSTRAP_PASSWORD,
  });
  await json(login);
  const sessionCookie = login.headers.getSetCookie().find(value => value.split(";")[0].includes("session_token="));
  assert.ok(sessionCookie?.startsWith("__Secure-"));
  assert.match(sessionCookie, /;\s*HttpOnly(?:;|$)/i);
  assert.match(sessionCookie, /;\s*Secure(?:;|$)/i);
  assert.match(sessionCookie, /;\s*SameSite=Lax(?:;|$)/i);
  checks.push(stage);

  stage = "workspace";
  const bootstrap = await json(await request("/api/bootstrap", "POST", {}));
  workspaceId = bootstrap.workspaces[0].id;
  const metadata = await json(await request("/api/workspace?workspace_id=" + encodeURIComponent(workspaceId)));
  const page = await request("/");
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes("My Tasks"));
  assert.equal((await request("/favicon.svg")).status, 200);
  checks.push(stage);

  stage = "task-persistence";
  const created = await json(await request("/api/tasks?workspace_id=" + encodeURIComponent(workspaceId), "POST", {
    title: "Deployment verification (automatically archived)",
    description: "Created by the release verification job to check persistence and task transitions.",
    project_id: metadata.projects[0].id,
    assignee_id: bootstrap.user.userId,
  }), 201);
  verificationTaskId = created.id;
  let task = await json(await request(taskPath(), "PATCH", { version: created.version, status: "done" }));
  assert.equal(task.status, "done");
  task = await json(await request(taskPath()));
  assert.ok(task.completed_at);
  task = await json(await request(taskPath(), "PATCH", { version: task.version, status: "todo" }));
  assert.equal(task.completed_at, null);
  assert.equal((await request(taskPath(), "PATCH", { version: created.version, title: "stale" })).status, 409);
  task = await json(await request(taskPath(), "PATCH", { version: task.version, archived: true }));
  assert.ok(task.archived_at);
  task = await json(await request(taskPath(), "PATCH", { version: task.version, archived: false }));
  assert.equal(task.archived_at, null);
  checks.push("task-persistence");
  stage = "comments-and-inbox";
  assert.equal(created.responsible_id, bootstrap.user.userId);
  const commentsPath = "/api/tasks/" + encodeURIComponent(verificationTaskId) + "/comments?workspace_id=" + encodeURIComponent(workspaceId);
  const comment = await json(await request(commentsPath, "POST", { body: "Release verification comment (automatically archived with this task).", mentioned_user_ids: [bootstrap.user.userId] }), 201);
  assert.equal((await json(await request(commentsPath))).comments[0].id, comment.id);
  task = await json(await request(taskPath(), "PATCH", { version: task.version, due_date: "2000-01-01" }));
  const inbox = await json(await request("/api/notifications/sync?workspace_id=" + encodeURIComponent(workspaceId), "POST", { tz_offset: 0 }));
  const overdue = inbox.notifications.find(item => item.task_id === verificationTaskId && item.kind === "overdue");
  assert.ok(overdue);
  await json(await request("/api/notifications/" + encodeURIComponent(overdue.id) + "?workspace_id=" + encodeURIComponent(workspaceId), "PATCH", {}));
  const filtered = await json(await request("/api/tasks?workspace_id=" + encodeURIComponent(workspaceId) + "&due=overdue&sort=priority&assignee_id=" + encodeURIComponent(bootstrap.user.userId)));
  assert.ok(filtered.tasks.some(item => item.id === verificationTaskId));
  task = await json(await request(taskPath(), "PATCH", { version: task.version, archived: true }));
  assert.ok(task.archived_at);
  archived = true;
  checks.push(stage);

  stage = "origin-and-tenant";
  assert.equal((await request("/api/bootstrap", "POST", {}, { origin: "https://untrusted.example" })).status, 403);
  assert.equal((await request("/api/workspace?workspace_id=unavailable")).status, 404);
  checks.push(stage);

  stage = "sign-out";
  const oldCookies = [...cookie].map(([key, value]) => key + "=" + value).join("; ");
  await json(await request("/api/auth/sign-out", "POST", {}));
  cookie.clear();
  assert.equal((await request("/api/workspace?workspace_id=" + encodeURIComponent(workspaceId), "GET", undefined, { cookie: oldCookies })).status, 401);
  checks.push(stage);

  console.log(JSON.stringify({ event: "production_verified", checks, createdTaskArchived: archived, transport: "railway-private" }));
} catch {
  console.error(JSON.stringify({ event: "production_verification_failed", stage, ...(status ? { status } : {}) }));
  process.exitCode = 1;
} finally {
  // Recover only this job's new record; never enumerate, delete, or reset user data.
  if (verificationTaskId && !archived && cookie.size) {
    try {
      const task = await json(await request(taskPath()));
      if (!task.archived_at) await json(await request(taskPath(), "PATCH", { version: task.version, archived: true }));
    } catch {
      console.error(JSON.stringify({ event: "verification_cleanup_failed", operation: "archive-own-task" }));
      process.exitCode = 1;
    }
  }
  if (cookie.size && target) {
    try { await json(await request("/api/auth/sign-out", "POST", {})); }
    catch {
      console.error(JSON.stringify({ event: "verification_cleanup_failed", operation: "sign-out" }));
      process.exitCode = 1;
    }
    cookie.clear();
  }
}

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

// Controlled human API check inside the existing private provisioning service.
// No GitHub key is used here. Only the coordinator may hold that key.
const origin = "https://stride-app-production-d72b.up.railway.app";
const workspace = "ws_7b89c2fa-48d3-4b41-aa01-6e98679e5c05";
const project = "project_7b89c2fa-48d3-4b41-aa01-6e98679e5c05";
const paths = ["README.md", "AGENTS.md", "docs/ARCHITECTURE.md", "docs/PRODUCT.md", "docs/SECURITY.md", "docs/TESTING.md", "docs/agent-workforce/PROJECT_CONTEXT.md", "docs/agent-workforce/ATTENDED_SETUP.md"].sort();
const sourcePath = `/api/projects/${project}/repository?workspace_id=${workspace}`;
const cookies = new Map();
let target;
let stage = "configuration";
let status;

async function request(path, method = "GET", input) {
  const response = await fetch(new URL(path, target), {
    method, redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { origin, ...(input === undefined ? {} : { "content-type": "application/json" }),
      ...(cookies.size ? { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  status = response.status;
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";")[0]; const split = pair.indexOf("=");
    if (split < 1) continue;
    const name = pair.slice(0, split); const token = pair.slice(split + 1);
    if (!token || /;\s*max-age=0(?:;|$)/i.test(value)) cookies.delete(name);
    else cookies.set(name, token);
  }
  assert.ok([200, 202].includes(status));
  assert.ok(response.body);
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 262144) { await reader.cancel(); throw new Error("Response limit"); }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}

try {
  assert.equal(process.env.RAILWAY_PROJECT_ID, "ccf1a908-637a-49c5-9e87-6b70e2ff1f87");
  assert.equal(process.env.RAILWAY_ENVIRONMENT_ID, "36f9def0-14ef-4b84-b789-ecb893dd37a1");
  assert.equal(process.env.RAILWAY_SERVICE_ID, "1b76c2b4-d393-4984-a2e6-43393fe1b269");
  assert.equal(process.env.STRIDE_VERIFY_ORIGIN, origin);
  assert.equal(process.env.STRIDE_GITHUB_APP_PRIVATE_KEY, undefined);
  target = new URL(process.env.STRIDE_INTERNAL_URL);
  assert.equal(target.href, "http://stride-app.railway.internal:8080/");
  const mode = process.env.STRIDE_GITHUB_VERIFY_MODE ?? "observe";
  assert.ok(["connect", "observe"].includes(mode));
  const expectedHead = process.env.STRIDE_GITHUB_VERIFY_HEAD;
  assert.match(expectedHead ?? "", /^[0-9a-f]{40}$/);
  assert.ok(process.env.STRIDE_BOOTSTRAP_EMAIL);
  assert.ok(process.env.STRIDE_BOOTSTRAP_PASSWORD?.length >= 12);

  stage = "sign-in";
  await request("/api/auth/sign-in/email", "POST", {
    email: process.env.STRIDE_BOOTSTRAP_EMAIL, password: process.env.STRIDE_BOOTSTRAP_PASSWORD,
  });
  stage = "audience";
  const metadata = await request(`/api/workspace?workspace_id=${workspace}`);
  assert.equal(metadata.role, "admin");
  assert.equal(metadata.members.length, 1); // Audience reviewed at installation.
  assert.ok(metadata.projects.some(p => p.id === project && !p.archived_at));

  stage = "grant";
  let view = await request(sourcePath);
  assert.equal(view.configured, true); assert.equal(view.can_manage, true);
  assert.equal(view.choices.length, 1);
  assert.equal(view.choices[0].key, "product_repository");
  assert.equal(view.choices[0].repository, "ayee-prashant/stride");
  assert.equal(view.choices[0].branch, "deploy/vercel-railway");
  assert.deepEqual([...view.choices[0].paths].sort(), paths);
  if (mode === "connect" && (!view.source || view.source.state === "disconnected")) {
    stage = "connect";
    view = await request(sourcePath, "POST", {
      binding_key: "product_repository", version: view.source?.version ?? 0, request_id: randomUUID(),
    });
    assert.equal(view.receipt.operation, "connect");
  }

  stage = "observation";
  const deadline = Date.now() + 160000;
  let previousState;
  while (Date.now() < deadline) {
    view = await request(sourcePath);
    if (view.source?.state !== previousState) {
      previousState = view.source?.state;
      console.info(JSON.stringify({ event: "github_source_progress", state: previousState ?? "absent", reason: view.source?.reason ?? null }));
    }
    const source = view.source;
    if (source?.state === "current" && source.observation?.head_sha === expectedHead) {
      const observation = source.observation;
      assert.equal(observation.repository_id, 1369489277);
      assert.equal(observation.coverage, "configured_files");
      assert.deepEqual(observation.files.map(f => f.path).sort(), paths);
      let bytes = 0;
      for (const file of observation.files) {
        const body = Buffer.from(file.body, "utf8"); bytes += body.length;
        assert.equal(body.length, file.size);
        assert.equal(createHash("sha256").update(body).digest("hex"), file.sha256);
        assert.equal(createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex"), file.blob_sha);
      }
      assert.ok(bytes <= 65536);
      assert.ok(Date.now() - Date.parse(source.last_verified_at) < 180000);
      console.info(JSON.stringify({ event: "github_source_verified", source_id: source.id,
        head_sha: observation.head_sha, manifest_hash: observation.manifest_hash,
        files: observation.files.length, bytes, last_verified_at: source.last_verified_at }));
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  assert.equal(view.source?.state, "current");
  assert.equal(view.source.observation?.head_sha, expectedHead);
} catch {
  console.error(JSON.stringify({ event: "github_source_verification_failed", stage, status }));
  process.exitCode = 1;
} finally {
  if (cookies.size && target) {
    try { await request("/api/auth/sign-out", "POST", {}); console.info(JSON.stringify({ event: "github_verification_signed_out" })); }
    catch { console.error(JSON.stringify({ event: "github_verification_signout_failed" })); process.exitCode = 1; }
    cookies.clear();
  }
}

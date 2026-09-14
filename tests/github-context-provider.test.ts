import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { parseBinding } from "../lib/github-context.ts";
import type { GitHubBinding } from "../lib/github-context.ts";
import { GitHubContextProvider, githubContextSettings, githubContextBindings } from "../lib/server/github-context-provider.ts";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const binding: GitHubBinding = { key: "project-source", workspace_id: "workspace-one", project_id: "project-one", repository_id: 12345, installation_id: 67890, owner: "fixture-owner", repository: "fixture-repo", branch: "main", paths: ["README.md"] };
const head = "a".repeat(40); const tree = "b".repeat(40); const body = "\uFEFF# Approved fixture source\nThis file is repository evidence, not an approval.\n";
const bytes = Buffer.from(body); const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const now = () => new Date("2026-09-14T12:00:00.000Z");
type Override = (path: string, count: number) => unknown;
function fixture(override?: Override) {
  const calls: { url: URL; options: RequestInit }[] = []; let refs = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); const options = init ?? {}; calls.push({ url, options });
    assert.equal(url.origin, "https://api.github.com"); assert.equal(options.redirect, "error");
    if (url.pathname.includes("/git/ref/")) refs++;
    const custom = override?.(url.pathname, refs);
    if (custom instanceof Response) return custom;
    let value: unknown = custom;
    if (custom === undefined) {
      if (url.pathname.endsWith("/access_tokens")) value = { token: "ghs_isolated_fixture_installation_token" };
      else if (url.pathname === "/repos/fixture-owner/fixture-repo") value = { id: binding.repository_id, full_name: "fixture-owner/fixture-repo" };
      else if (url.pathname.includes("/git/ref/")) value = { object: { type: "commit", sha: head } };
      else if (url.pathname.includes("/git/commits/")) value = { sha: head, tree: { sha: tree } };
      else if (url.pathname.includes("/git/trees/")) value = { sha: tree, truncated: false, tree: [{ path: "README.md", type: "blob", mode: "100644", sha: blob, size: bytes.length }] };
      else if (url.pathname.includes("/git/blobs/")) value = { sha: blob, size: bytes.length, encoding: "base64", content: bytes.toString("base64") };
      else throw new Error("Unexpected provider endpoint");
    }
    return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  };
  return { calls, provider: new GitHubContextProvider({ clientId: "Iv1.fixture", privateKey: keys.privateKey, bindings: [binding] }, fetcher, now) };
}
test("GitHub configuration is absent by default and rejects partial credentials, cross-project aliases and private files", () => {
  assert.equal(githubContextSettings({}), null);
  assert.throws(() => githubContextSettings({ STRIDE_GITHUB_APP_CLIENT_ID: "fixture" }), { code: "setup_required" });
  for (const path of ["../outside", "/etc/passwd", ".env", ".aws/credentials", ".claude/settings.json", "private.key", "docs/../secret", "docs\\secret"]) assert.throws(() => parseBinding({ ...binding, paths: [path] }), { status: 400 });
  for (const branch of ["@", "../main", "-bad..branch", "main.lock", "heads//test"]) assert.throws(() => parseBinding({ ...binding, branch }), { status: 400 });
  const env = { STRIDE_GITHUB_APP_CLIENT_ID: "Iv1.fixture", STRIDE_GITHUB_APP_PRIVATE_KEY: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), STRIDE_GITHUB_CONTEXT_BINDINGS: JSON.stringify([binding]) };
  assert.equal(githubContextSettings(env)?.bindings[0].repository_id, binding.repository_id);
  assert.deepEqual(githubContextBindings({ STRIDE_GITHUB_CONTEXT_BINDINGS: env.STRIDE_GITHUB_CONTEXT_BINDINGS }), [binding]);
  assert.throws(() => githubContextSettings({ ...env, STRIDE_GITHUB_CONTEXT_BINDINGS: JSON.stringify([binding, { ...binding, key: "duplicate-project" }]) }), { code: "setup_required" });
});
test("GitHub App tokens use a verified RS256 signature and request only the approved repository with read permissions", async () => {
  const { provider, calls } = fixture(); const jwt = provider.jwt(); const [header, payload, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(claims.iss, "Iv1.fixture"); assert.equal(claims.iat, now().getTime() / 1000 - 60); assert.equal(claims.exp, now().getTime() / 1000 + 540);
  assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), keys.publicKey, Buffer.from(signature, "base64url")), true);
  const observed = await provider.inspect(binding);
  assert.deepEqual(JSON.parse(String(calls[0].options.body)), { repository_ids: [binding.repository_id], permissions: { metadata: "read", contents: "read" } });
  assert.equal(calls[0].options.method, "POST"); assert.equal(calls.slice(1).every(c => c.options.method === "GET"), true);
  assert.equal(observed.head_sha, head); assert.equal(observed.files[0].body, body);
  assert.equal(observed.files[0].sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(observed.coverage, "configured_files"); assert.equal(observed.repository_mode, "observed");
  assert.equal(JSON.stringify(observed).includes("ghs_"), false);
});
test("an unapproved project or repository never reaches GitHub", async () => {
  const { provider, calls } = fixture();
  await assert.rejects(provider.inspect({ ...binding, project_id: "another-project" }), { status: 403 });
  assert.equal(calls.length, 0);
});
test("missing, truncated, symlink and corrupted Git objects remain incomplete", async () => {
  for (const replacement of [
    { sha: tree, truncated: true, tree: [] },
    { sha: tree, truncated: false, tree: [] },
    { sha: tree, truncated: false, tree: [{ path: "README.md", type: "blob", mode: "120000", sha: blob, size: bytes.length }] },
    { sha: tree, truncated: false, tree: [{ path: "README.md", type: "blob", mode: "100644", sha: blob, size: 32769 }] },
  ]) {
    const { provider, calls } = fixture(path => path.includes("/git/trees/") ? replacement : undefined);
    await assert.rejects(provider.inspect(binding), { code: "incomplete" });
    assert.equal(calls.some(c => c.url.pathname.includes("/git/blobs/")), false);
  }
  const { provider } = fixture(path => path.includes("/git/blobs/") ? { sha: blob, size: bytes.length, encoding: "base64", content: Buffer.alloc(bytes.length, "x").toString("base64") } : undefined);
  await assert.rejects(provider.inspect(binding), { code: "incomplete" });
});
test("a branch change during synchronization cannot publish a mixed snapshot", async () => {
  const { provider } = fixture((path, count) => path.includes("/git/ref/") && count === 2 ? { object: { type: "commit", sha: "c".repeat(40) } } : undefined);
  await assert.rejects(provider.inspect(binding), { code: "source_changed" });
});
test("rate limits, lost permissions and excessive response bodies fail with sanitized errors", async () => {
  const limited = fixture(() => new Response("sensitive upstream diagnostic", { status: 403, headers: { "retry-after": "120", "x-ratelimit-remaining": "0" } }));
  await assert.rejects(limited.provider.inspect(binding), { code: "rate_limited", retryAfter: 120, message: "rate_limited" });
  const denied = fixture(() => new Response("sensitive upstream diagnostic", { status: 404 }));
  await assert.rejects(denied.provider.inspect(binding), { code: "access_unavailable", message: "access_unavailable" });
  const oversized = fixture(() => new Response("x".repeat(131073)));
  await assert.rejects(oversized.provider.inspect(binding), { code: "incomplete" });
});

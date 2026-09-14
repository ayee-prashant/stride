import { test } from "node:test";
import assert from "node:assert/strict";
import { handleApi, MAX_BODY_BYTES } from "../lib/server/http.ts";
import { fixture } from "./sqlite.ts";

function request(path: string, body?: unknown, headers: Record<string, string> = {}, method = "POST") {
  return new Request(`https://stride.example.test/api/${path}`, { method: body === undefined ? "GET" : method, headers: { Origin: "https://stride.example.test", "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
test("anonymous requests are rejected before database access", async () => {
  const response = await handleApi(request("workspace?workspace_id=w"), { identity: async () => null, repository: () => { throw new Error("must not run"); } });
  assert.equal(response.status, 401); assert.equal(response.headers.get("cache-control"), "private, no-store");
});
test("cross-origin and non-JSON mutations are rejected", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close()); const deps = { identity: async () => f.owner, repository: () => f.repo };
  assert.equal((await handleApi(request("bootstrap", {}, { Origin: "https://evil.example.test" }), deps)).status, 403);
  assert.equal((await handleApi(request("bootstrap", {}, { "Content-Type": "text/plain" }), deps)).status, 415);
  assert.equal((await handleApi(request("bootstrap", {}, { "Sec-Fetch-Site": "cross-site" }), deps)).status, 403);
});
test("configured public origin governs mutations behind a proxy", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  const deps = { identity: async () => f.owner, repository: () => f.repo, origin: () => "https://stride.example.test" };
  const proxied = new Request("http://internal-worker/api/bootstrap", { method: "POST", body: "{}", headers: { Origin: "https://stride.example.test", "Content-Type": "application/json" } });
  assert.equal((await handleApi(proxied, deps)).status, 200);
  const forged = new Request("https://attacker.example/api/bootstrap", { method: "POST", body: "{}", headers: { Origin: "https://attacker.example", "X-Forwarded-Host": "attacker.example", "Content-Type": "application/json" } });
  assert.equal((await handleApi(forged, deps)).status, 403);
});
test("bounded streaming body handling rejects oversized requests", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  const response = await handleApi(request("bootstrap", { value: "x".repeat(MAX_BODY_BYTES + 1) }), { identity: async () => f.owner, repository: () => f.repo });
  assert.equal(response.status, 413);
});
test("malformed JSON is a safe 400 response", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  const req = new Request("https://stride.example.test/api/bootstrap", { method: "POST", headers: { Origin: "https://stride.example.test", "Content-Type": "application/json" }, body: "{" });
  assert.equal((await handleApi(req, { identity: async () => f.owner, repository: () => f.repo })).status, 400);
});
test("HTTP task creation, update and reload use persistent repository state", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close()); const deps = { identity: async () => f.owner, repository: () => f.repo };
  const response = await handleApi(request(`tasks?workspace_id=${f.workspace}`, { title: "HTTP task", project_id: f.project }), deps);
  assert.equal(response.status, 201); const task = await response.json();
  const update = await handleApi(request(`tasks/${task.id}?workspace_id=${f.workspace}`, { version: 1, status: "done" }, {}, "PATCH"), deps);
  assert.equal(update.status, 200);
  const reload = await handleApi(request(`tasks/${task.id}?workspace_id=${f.workspace}`), deps);
  assert.equal((await reload.json()).status, "done"); assert.ok(reload.headers.get("x-request-id"));
});

test("a valid long Unicode description fits within the bounded request", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  const response = await handleApi(request(`tasks?workspace_id=${f.workspace}`, { title: "Unicode", project_id: f.project, description: "अ".repeat(8000) }), { identity: async () => f.owner, repository: () => f.repo });
  assert.equal(response.status, 201); assert.equal((await response.json()).description.length, 8000);
});
test("invalid percent encoding yields a validation error, not server failure", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  const response = await handleApi(request(`tasks/%GG?workspace_id=${f.workspace}`), { identity: async () => f.owner, repository: () => f.repo });
  assert.equal(response.status, 400);
});
test("missing Origin and forged cross-tenant API updates are rejected", async t => {
  const f = await fixture(); t.after(() => f.db.raw.close());
  const req = request("bootstrap", {}); req.headers.delete("origin");
  assert.equal((await handleApi(req, { identity: async () => f.owner, repository: () => f.repo })).status, 403);
  const task = await f.repo.createTask("owner", f.workspace, { title: "Private", project_id: f.project });
  const response = await handleApi(request(`tasks/${task.id}?workspace_id=${f.workspace}`, { version: 1, status: "done" }, {}, "PATCH"), { identity: async () => f.other, repository: () => f.repo });
  assert.equal(response.status, 404); assert.equal((await f.repo.task("owner", f.workspace, task.id)).status, "todo");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { api, RequestError, workspacePath } from "../lib/client-api.ts";

test("client sends same-origin credentials and JSON through the shared API", async t => {
  let supplied: RequestInit | undefined;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { supplied = init; return Response.json({ id: "task" }); });
  assert.deepEqual(await api("tasks?workspace_id=w", { method: "POST", body: { title: "Task" } }), { id: "task" });
  assert.equal(supplied?.credentials, "same-origin"); assert.equal(supplied?.body, '{"title":"Task"}');
  assert.equal(workspacePath("tasks", "w & another"), "tasks?workspace_id=w+%26+another");
});
test("typed server errors remain actionable", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "This task changed." } }, { status: 409 }));
  await assert.rejects(api("tasks/t", { method: "PATCH", body: { version: 1 } }), (error: unknown) => error instanceof RequestError && error.status === 409 && error.message === "This task changed.");
});
test("ambiguous mutation network failures are not retried", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new TypeError("Network lost"); });
  await assert.rejects(api("tasks", { method: "POST", body: { title: "Keep draft" } }), /could not confirm whether the change was saved/);
  assert.equal(requests, 1);
});
test("explicit cancellation is propagated for stale reads", async t => {
  const controller = new AbortController(); controller.abort();
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { assert.equal(init.signal?.aborted, true); throw new DOMException("Aborted", "AbortError"); });
  await assert.rejects(api("workspace", { signal: controller.signal }), { name: "AbortError" });
});

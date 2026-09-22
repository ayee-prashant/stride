import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { fixture } from "./sqlite.ts";
import { setupDelivery } from "./delivery-contract.ts";
import { handleAgentMcp } from "../lib/server/agent-mcp.ts";

for (const modern of [true, false]) test(`${modern ? "2026-07-28" : "legacy"} maintained MCP client can use the scoped server`, async t => {
  const f = await setupDelivery(fixture); let captured: { body: string; headers: Headers } | null = null;
  const transport = new StreamableHTTPClientTransport(new URL("https://stride.example/mcp"), { fetch: async (input, init) => {
    const request = new Request(input, init); if (request.method === "POST") captured = { body: await request.clone().text(), headers: new Headers(request.headers) };
    return handleAgentMcp(request, f.actor, f.repo);
  } });
  const client = new Client({ name: "isolated-protocol-test", version: "1" }, modern ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {});
  t.after(() => client.close()); await client.connect(transport);
  const tools = await client.listTools(); assert.equal(tools.tools.length, 11);
  assert.ok(tools.tools.every(tool => !/approve|authorize|assign|deploy/.test(tool.name)));
  // Shared context is readable but never writable from here. An agent proposes through
  // stride_submit, which routes to a human; nothing on this surface lets it approve the
  // context it will later be handed.
  const contextTools = tools.tools.filter(tool => /context/.test(tool.name));
  assert.equal(contextTools.length, 3, "project context, its changes and its history");
  assert.ok(contextTools.every(tool => tool.annotations?.readOnlyHint === true), "context tools must be read-only");
  assert.ok(!tools.tools.some(tool => /publish|propose_context|context_write/.test(tool.name)));
  const role = await client.callTool({ name: "stride_get_role", arguments: {} }); assert.equal(role.isError, undefined); assert.ok(JSON.stringify(role).includes(f.b.profile_id));
  const wrong = await client.callTool({ name: "stride_work_packet", arguments: { ticket_id: "other_project_ticket" } }); assert.equal(wrong.isError, true);

  // Shared context reads are scoped to the connection's human operator, so they
  // succeed for this connection and carry the sequence an agent needs to tell that
  // its view has gone stale.
  const shared = await client.callTool({ name: "stride_project_context", arguments: {} });
  assert.equal(shared.isError, undefined);
  const brief = (shared.structuredContent as { result: { sequence: number; documents: unknown[] } }).result;
  assert.equal(typeof brief.sequence, "number"); assert.ok(Array.isArray(brief.documents));

  // Peers are discovered by reading the shared log, not by being messaged.
  const peers = await client.callTool({ name: "stride_peer_activity", arguments: { after: 0 } });
  assert.equal(peers.isError, undefined);
  assert.ok(Array.isArray((peers.structuredContent as { result: { events: unknown[] } }).result.events));

  // A cursor ahead of the project must be refused rather than silently returning
  // nothing, or an agent could believe stale context is current.
  const ahead = await client.callTool({ name: "stride_context_changes", arguments: { after: 999999 } });
  assert.equal(ahead.isError, true);
  await client.listTools();
  if (modern) {
    assert.ok(captured); const saved = captured as { body: string; headers: Headers }; assert.ok(saved.body.includes("2026-07-28"));
    const headers = new Headers(saved.headers); headers.set("mcp-protocol-version", "2025-11-25");
    const mismatch = await handleAgentMcp(new Request("https://stride.example/mcp", { method: "POST", headers, body: saved.body }), f.actor, f.repo);
    assert.ok(mismatch.status >= 400, "Recognized modern metadata must not downgrade after a header mismatch");
  }
  const resource = await client.readResource({ uri: "stride://report-schema" }); assert.equal(resource.contents.length, 1);
});
test("MCP applies a body limit before dispatch", async () => {
  const f = await setupDelivery(fixture);
  await assert.rejects(handleAgentMcp(new Request("https://stride.example/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ padding: "x".repeat(32769) }) }), f.actor, f.repo), { status: 413 });
});

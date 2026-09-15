import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { REVIEW_GATES } from "../lib/delivery.ts";
import { verifyAgentCli } from "./test-agent-cli.mjs";

/** Real OAuth, real sessions and the published MCP client against the isolated built app. */
export async function verifyAgentRuntime({ origin, request, json, userId, workspaceId, projectId }) {
  if (process.env.CI !== "true" || origin !== "http://127.0.0.1:3107") throw new Error("Agent verification requires the isolated CI server");
  let stage = "enrollment"; let client;
  const suffix = `?workspace_id=${workspaceId}`; const base = `/api/projects/${projectId}/delivery`;
  const human = async (path, body) => {
    stage = `human_${path.split("/").at(-1)}`;
    const response = await request(path + suffix, "POST", body);
    if (response.status !== 200) { const data = await response.clone().json(); const code = data.error?.code; console.error(JSON.stringify({ event: "agent_human_request_failed", stage, status: response.status, code: typeof code === "string" && /^[A-Z_]{1,60}$/.test(code) ? code : "unknown" })); }
    return json(response);
  };
  const decision = version => ({ request_id: randomUUID(), expected_version: version, reason: "Isolated human review of exact agent work" });
  try {
    await human(base, { ...decision(0), reviewers: Object.fromEntries(REVIEW_GATES.map(g => [g, userId])) });
    const rolePath = `/api/projects/${projectId}/agents`;
    const template = await json(await request(`${rolePath}/roles/business_analysis${suffix}`));
    const registered = await json(await request(rolePath + suffix, "POST", { request_id: randomUUID(), role_id: "business_analysis", template_hash: template.hash, profile: { alias: "RUNTIME-BA", operator_id: userId, tool_label: "Real MCP test client" }, read_paths: ["docs/"], write_paths: [], reason: "Prepare bounded requirements" }), 201);
    const binding = (await human(`${rolePath}/${registered.binding.id}/initialize`, { ...decision(registered.binding.version), template_hash: template.hash })).binding;
    const title = "Review runtime agent requirements";
    let ticket = (await human(`${base}/discovery`, { request_id: randomUUID(), kind: "requirements", title, description: "Humans remain accountable for every agent outcome.", acceptance: ["Role and human approval boundaries are explicit"] })).ticket;
    ticket = (await human(`${base}/tickets/${ticket.id}/assign`, { ...decision(ticket.version), binding_id: binding.id })).ticket;
    const connection = await human(`${base}/connections`, { request_id: randomUUID(), binding_id: binding.id, binding_version: binding.version, template_hash: template.hash, name: "Isolated MCP laptop", accept_responsibility: true });
    assert.equal(connection.state, "active"); assert.ok(connection.client_id); assert.notEqual(connection.client_id, connection.companion_client_id);
    const raw = (path, init = {}) => fetch(new URL(path, origin), { ...init, redirect: "manual", signal: AbortSignal.timeout(10000) });
    stage = "oauth-discovery";
    const challenge = await raw("/mcp", { method: "POST" }); assert.equal(challenge.status, 401); assert.ok(challenge.headers.get("www-authenticate").includes("oauth-protected-resource/mcp"));
    const discovery = await (await raw("/.well-known/oauth-authorization-server")).json();
    assert.equal(discovery.issuer, origin);
    assert.equal(new URL(discovery.authorization_endpoint).origin, origin); assert.equal(new URL(discovery.token_endpoint).origin, origin);
    assert.equal((await (await raw("/.well-known/oauth-protected-resource/mcp")).json()).resource, `${origin}/mcp`);
    assert.ok([400, 401, 403, 404].includes((await raw("/api/auth/oauth2/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["https://untrusted.invalid/callback"] }) })).status));
    async function authorize(purpose, verifier = randomBytes(48).toString("base64url")) {
      const state = randomBytes(24).toString("base64url");
      const endpoint = new URL(discovery.authorization_endpoint);
      endpoint.search = new URLSearchParams({ client_id: purpose === "agent" ? connection.client_id : connection.companion_client_id, response_type: "code", redirect_uri: "http://127.0.0.1:43871/callback", scope: `stride:${purpose} offline_access`, resource: `${origin}${purpose === "agent" ? "/mcp" : "/api/agent-companion"}`, state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", prompt: "consent" }).toString();
      // This is a fetch request, so the provider returns a JSON navigation
      // result. Browser navigation uses the same checked destination via 302.
      const response = await request(endpoint.pathname + endpoint.search, "GET", undefined, { accept: "application/json" });
      const navigation = await json(response); assert.equal(navigation.redirect, true);
      const consent = new URL(navigation.url, origin); assert.equal(consent.origin, origin); assert.equal(consent.pathname, "/connect/consent");
      const approved = await json(await request("/api/connect/consent", "POST", { accept: true, oauth_query: consent.search.slice(1) }));
      const callback = new URL(approved.url); assert.equal(callback.origin, "http://127.0.0.1:43871"); assert.equal(callback.searchParams.get("state"), state); assert.equal(callback.searchParams.get("iss"), origin); assert.ok(callback.searchParams.get("code"));
      return { code: callback.searchParams.get("code"), verifier, purpose };
    }
    async function exchange(code, verifier = code.verifier) {
      return raw(discovery.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: code.purpose === "agent" ? connection.client_id : connection.companion_client_id, code: code.code, code_verifier: verifier, redirect_uri: "http://127.0.0.1:43871/callback", resource: `${origin}${code.purpose === "agent" ? "/mcp" : "/api/agent-companion"}` }) });
    }
    const refresh = token => raw(discovery.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token, client_id: connection.client_id, resource: `${origin}/mcp` }) });
    stage = "pkce";
    const badVerifier = await json(await exchange(await authorize("agent"), randomBytes(48).toString("base64url")), 401);
    assert.equal(badVerifier.error, "invalid_request"); assert.equal(badVerifier.access_token, undefined);
    const replayCode = await authorize("agent"); const replayTokens = await json(await exchange(replayCode));
    assert.equal((await exchange(replayCode)).status, 400);
    // RFC 6749 code replay also revokes grants issued for that code. Exercise
    // refresh rotation with a newly authorized grant, not the revoked fixture.
    assert.equal((await refresh(replayTokens.refresh_token)).status, 400);
    const agentTokens = await json(await exchange(await authorize("agent"))); assert.ok(agentTokens.refresh_token);
    const companionTokens = await json(await exchange(await authorize("companion")));
    const bearer = tokens => ({ authorization: `Bearer ${tokens.access_token}` });
    stage = "audience-and-origin";
    assert.equal((await raw("/mcp", { method: "POST", headers: bearer(companionTokens) })).status, 401);
    assert.equal((await raw("/api/agent-companion", { headers: bearer(agentTokens) })).status, 401);
    assert.equal((await request("/mcp", "POST", {}, bearer(agentTokens))).status, 401);
    assert.equal((await raw("/mcp", { method: "POST", headers: { ...bearer(agentTokens), origin: "https://untrusted.invalid" } })).status, 403);
    stage = "modern-mcp";
    client = new Client({ name: "stride-isolated-verifier", version: "1.0.0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", origin), { requestInit: { headers: bearer(agentTokens) } }));
    const tools = await client.listTools(); assert.equal(tools.tools.length, 7); assert.ok(!tools.tools.some(t => /approve|deploy|assign/.test(t.name)));
    async function tool(name, args = {}, error = false) { const r = await client.callTool({ name, arguments: args }); assert.equal(!!r.isError, error, `MCP operation ${name}`); return error ? r : r.structuredContent?.result ?? JSON.parse(r.content[0].text); }
    const role = await tool("stride_get_role"); assert.equal(role.profile_id, binding.profile_id);
    await tool("stride_initialize", { request_id: randomUUID(), template_hash: role.template_hash, accept_role: true, accept_exclusions: true });
    const packet = (await tool("stride_work_packet", { ticket_id: ticket.id })).packet;
    await tool("stride_claim", { request_id: randomUUID(), ticket_id: ticket.id, attempt_id: randomUUID(), packet_hash: packet.hash }, true);
    stage = "shipped-cli";
    await verifyAgentCli({ origin, connection, request, json, profileId: binding.profile_id, ticketId: ticket.id, overviewPath: base + suffix, packetHash: packet.hash });
    stage = "human-start-and-report";
    await json(await raw("/api/agent-companion", { method: "POST", headers: { ...bearer(companionTokens), "content-type": "application/json" }, body: JSON.stringify({ preparation: { packet_id: packet.id, packet_hash: packet.hash, checkout: packet.payload.repository?.commit ?? null, repository_id: packet.payload.repository?.repository_id ?? null, clean: true } }) }));
    ticket = (await human(`${base}/tickets/${ticket.id}/start`, { ...decision(ticket.version), connection_id: connection.id, packet_hash: packet.hash, accept_start: true })).ticket;
    const claim = await tool("stride_claim", { request_id: randomUUID(), ticket_id: ticket.id, attempt_id: ticket.attempt_id, packet_hash: packet.hash }); assert.equal(claim.execution_authorized, true);
    const checkpoint = await tool("stride_checkpoint", { request_id: randomUUID(), attempt_id: ticket.attempt_id, expected_version: claim.attempt.version, checkpoint: { summary: "Requirements drafted", next_steps: ["Submit for human acceptance"], changed_paths: [], blockers: [] } });
    const report = { outcome: "pass", summary: "Requirements ready for human review", evidence: { summary: "Reviewed the human brief", checks: [{ name: "Approval boundaries", result: "pass", details: "Every role has an accountable human" }], candidate: null, environment: null, artifact: null }, findings: [], requirements: [{ title: "Human approval boundaries", body: "Agents propose work; accountable humans approve scope, starts and outcomes. <script>window.__deliveryXss=true</script>" }], plan: [], next_action: "Human BA reviewer accepts or returns the proposal" };
    ticket = (await tool("stride_submit", { request_id: randomUUID(), attempt_id: ticket.attempt_id, expected_version: checkpoint.attempt_version, submit: report })).ticket;
    assert.equal(ticket.phase, "in_review");
    assert.equal((await json(await request(base + suffix))).configuration.baseline, null);
    stage = "refresh-rotation";
    const rotated = await json(await refresh(agentTokens.refresh_token)); assert.ok(rotated.refresh_token); assert.notEqual(rotated.refresh_token, agentTokens.refresh_token);
    assert.equal((await refresh(agentTokens.refresh_token)).status, 400);
    stage = "connection-revocation";
    const current = (await json(await request(base + suffix))).connections.find(c => c.id === connection.id);
    await human(`${base}/connections/${connection.id}/revoke`, decision(current.version));
    assert.equal((await raw("/api/agent-companion", { headers: bearer(companionTokens) })).status, 401);
    assert.equal((await raw("/mcp", { method: "POST", headers: bearer(rotated) })).status, 401);
    console.log(JSON.stringify({ event: "agent_runtime_passed", checks: ["real_oauth_pkce", "code_single_use", "resource_isolation", "modern_mcp", "human_start", "report_requires_human_review", "refresh_rotation", "connection_revocation"] }));
    return { title, ticketId: ticket.id, workspaceId, projectId };
  } catch (error) { console.error(JSON.stringify({ event: "agent_runtime_failed", stage, kind: error?.name, code: typeof error?.code === "string" && /^[A-Z_]{1,40}$/.test(error.code) ? error.code : undefined, expected: typeof error?.expected === "number" ? error.expected : undefined, actual: typeof error?.actual === "number" ? error.actual : undefined, frames: error instanceof Error ? error.stack?.split("\n").filter(line => line.trim().startsWith("at ")).slice(0, 3) : [] })); throw error; }
  finally { await client?.close(); }
}

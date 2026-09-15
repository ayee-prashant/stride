import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstat, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

/** Exercise the shipped CLI and SDK OAuth helper, not a replacement transport. */
export async function verifyAgentCli({ origin, connection, request, json, profileId, ticketId, overviewPath, packetHash }) {
  assert.equal(process.env.CI, "true"); assert.equal(origin, "http://127.0.0.1:3107");
  const directory = join(homedir(), ".stride", "connections", connection.id);
  await assert.rejects(lstat(directory), { code: "ENOENT" });
  let stage = "login"; let login; let watcher; let client; let transport;
  try {
    login = spawn(process.execPath, ["scripts/stride-agent.mjs", "login", "--connection", connection.id, "--site", origin, "--client-id", connection.client_id, "--companion-client-id", connection.companion_client_id], { stdio: ["ignore", "ignore", "pipe"] });
    let pending = ""; let size = 0; let approvals = 0; let approvalError; let diagnostic = "unclassified";
    let queue = Promise.resolve();
    login.stderr.setEncoding("utf8");
    login.stderr.on("data", chunk => {
      size += Buffer.byteLength(chunk); if (size > 32768) { login.kill(); return; }
      const missingExport = /does not provide an export named '([A-Za-z]+)'/.exec(chunk);
      if (missingExport) diagnostic = "missing_export_" + missingExport[1];
      for (const [needle, code] of [["Authorization server mismatch", "issuer_mismatch"], ["safe size limit", "response_size"], ["registered client IDs", "client_id_format"], ["SEP-2352", "issuer_stamp"], ["Unsafe credential", "credential_permissions"], ["Invalid URL", "invalid_url"], ["fetch failed", "connection_failed"], ["EADDRINUSE", "callback_in_use"]]) if (chunk.includes(needle)) diagnostic = code;
      pending += chunk;
      const lines = pending.split("\n"); pending = lines.pop();
      for (const line of lines) if (line.startsWith(origin + "/")) {
        queue = queue.then(async () => {
          const url = new URL(line); assert.equal(url.origin, origin); assert.equal(url.pathname, "/api/auth/oauth2/authorize");
          const navigation = await json(await request(url.pathname + url.search, "GET", undefined, { accept: "application/json" }));
          const consent = new URL(navigation.url, origin); assert.equal(consent.origin, origin); assert.equal(consent.pathname, "/connect/consent");
          const approved = await json(await request("/api/connect/consent", "POST", { accept: true, oauth_query: consent.search.slice(1) }));
          const callback = new URL(approved.url); assert.equal(callback.origin, "http://127.0.0.1:43871"); assert.equal(callback.pathname, "/callback");
          assert.equal(callback.searchParams.get("state"), url.searchParams.get("state")); assert.equal(callback.searchParams.get("iss"), origin);
          assert.equal((await fetch(callback, { redirect: "error", signal: AbortSignal.timeout(10000) })).status, 200);
          approvals++;
        }).catch(error => { approvalError = error; login.kill(); });
      }
    });
    const exit = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { login.kill(); reject(new Error("CLI login timed out")); }, 60000);
      login.once("error", error => { clearTimeout(timeout); reject(error); });
      login.once("exit", code => { clearTimeout(timeout); resolve(code); });
    });
    await queue; if (approvalError) throw approvalError;
    if (exit !== 0) console.error(JSON.stringify({ event: "agent_cli_login_diagnostic", diagnostic, approvals }));
    assert.equal(exit, 0); assert.equal(approvals, 2);
    assert.equal((await lstat(directory)).mode & 0o077, 0);
    for (const purpose of ["agent", "companion"]) {
      const path = join(directory, purpose + ".json"); assert.equal((await lstat(path)).mode & 0o077, 0);
      const data = JSON.parse(await readFile(path, "utf8")); assert.ok(data.tokens.access_token); assert.ok(data.tokens.refresh_token); assert.equal(data.verifier, undefined); assert.equal(data.state, undefined);
    }
    stage = "stdio-bridge";
    transport = new StdioClientTransport({ command: process.execPath, args: ["scripts/stride-agent.mjs", "mcp", "--connection", connection.id], stderr: "pipe" });
    client = new Client({ name: "stride-cli-verifier", version: "1.0.0" });
    await client.connect(transport); assert.equal((await client.listTools()).tools.length, 7);
    const role = await client.callTool({ name: "stride_get_role", arguments: {} }); assert.equal(!!role.isError, false);
    assert.equal((role.structuredContent?.result ?? JSON.parse(role.content[0].text)).profile_id, profileId);
    await client.close(); client = undefined;
    stage = "attended-watcher";
    watcher = spawn(process.execPath, ["scripts/stride-agent.mjs", "watch", "--connection", connection.id, "--ticket", ticketId], { stdio: ["ignore", "ignore", "ignore"] });
    let prepared = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const view = await json(await request(overviewPath));
      if (view.connections.some(c => c.id === connection.id && c.prepared?.packet_hash === packetHash && c.prepared.clean && new Date(c.lease_until).getTime() > Date.now())) { prepared = true; break; }
      if (watcher.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(prepared, true);
    console.log(JSON.stringify({ event: "agent_cli_passed", checks: ["sdk_oauth_login", "private_token_files", "stdio_bridge", "real_companion_preparation"] }));
  } catch (error) {
    console.error(JSON.stringify({ event: "agent_cli_failed", stage, kind: error?.name, expected: typeof error?.expected === "number" ? error.expected : undefined, actual: typeof error?.actual === "number" ? error.actual : undefined }));
    throw error;
  } finally {
    login?.kill(); watcher?.kill(); await client?.close(); await transport?.close();
    // This directory was proven absent and belongs to this random CI enrollment.
    await rm(directory, { recursive: true, force: true });
  }
}

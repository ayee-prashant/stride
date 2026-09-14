#!/usr/bin/env node
import { mkdir, readFile, writeFile, rename, lstat, unlink, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client, StreamableHTTPClientTransport, auth } from "@modelcontextprotocol/client";
import { Server, ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

const run = promisify(execFile);
const args = process.argv.slice(2); const command = args.shift(); const options = {};
for (let i = 0; i < args.length; i += 2) { if (!/^--[a-z-]+$/.test(args[i]) || !args[i + 1] || options[args[i].slice(2)] !== undefined) throw new Error("Use named options with one value each."); options[args[i].slice(2)] = args[i + 1]; }
const connectionId = options.connection;
if (!connectionId || !/^[0-9a-f-]{36}$/.test(connectionId)) throw new Error("Provide the connection ID from Stride.");
if (process.platform === "win32") throw new Error("Run this companion in WSL so its credential file has enforced Unix permissions.");
const root = join(homedir(), ".stride"); const parent = join(root, "connections"); const directory = join(parent, connectionId);
for (const path of [root, parent, directory]) {
  await mkdir(path, { recursive: true, mode: 0o700 }); const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error("The Stride credential directory must be owned by you, private (0700), and not a symlink.");
}
async function readPrivate(path) {
  try { const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > 131072) throw new Error("Unsafe credential file permissions or size."); return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function savePrivate(path, value) {
  const temp = path + "." + randomBytes(8).toString("hex") + ".tmp";
  await writeFile(temp, JSON.stringify(value) + "\n", { mode: 0o600, flag: "wx" }); await rename(temp, path);
}
async function processLock(purpose) {
  const path = join(directory, `${purpose}.lock`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const file = await open(path, "wx", 0o600); await file.writeFile(JSON.stringify({ pid: process.pid })); await file.close(); return () => unlink(path).catch(() => {}); }
    catch (error) {
      if (error.code !== "EEXIST") throw error; const existing = await readPrivate(path);
      try { if (!Number.isSafeInteger(existing?.pid) || existing.pid < 1) throw new Error("Invalid owner"); process.kill(existing.pid, 0); throw new Error("This connection is already in use. Close that IDE/companion or enroll a separate connection."); }
      catch (e) { if (e.code !== "ESRCH") throw e; await unlink(path); }
    }
  }
  throw new Error("Could not lock the connection.");
}
const configPath = join(directory, "connection.json");
let config = await readPrivate(configPath);
if (command === "login") {
  const site = new URL(options.site); if ((site.protocol !== "https:" && !(site.protocol === "http:" && ["127.0.0.1", "localhost"].includes(site.hostname))) || site.username || site.password || site.pathname !== "/" || site.search || site.hash) throw new Error("Use the exact HTTPS origin of your Stride site.");
  if (![options["client-id"], options["companion-client-id"]].every(id => typeof id === "string" && /^[a-zA-Z0-9_-]{8,200}$/.test(id))) throw new Error("Use the two registered client IDs from Stride.");
  config = { version: 1, site: site.origin, connection_id: connectionId, agent_client_id: options["client-id"], companion_client_id: options["companion-client-id"] };
  const previous = await readPrivate(configPath); if (previous && (previous.site !== config.site || previous.agent_client_id !== config.agent_client_id || previous.companion_client_id !== config.companion_client_id)) throw new Error("An existing connection cannot change issuer or clients. Enroll a new connection.");
  await savePrivate(configPath, config);
}
if (!config || config.version !== 1 || config.connection_id !== connectionId) throw new Error("Complete the login command from Stride first.");
const site = new URL(config.site); const callback = "http://127.0.0.1:43871/callback";
async function boundedFetch(input, init = {}) {
  const target = new URL(input instanceof Request ? input.url : String(input));
  if (target.origin !== site.origin || target.username || target.password) throw new Error("Discovery or credentials attempted to leave the configured Stride origin.");
  const response = await fetch(input, { ...init, redirect: "error", signal: init.signal ?? AbortSignal.timeout(30000) });
  if (!response.body) return response;
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1048576) { await reader.cancel(); throw new Error("Stride response exceeds its safe size limit."); } chunks.push(value); } } finally { reader.releaseLock(); }
  return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
}
class ConnectionProvider {
  constructor(purpose, interactive = false) { this.purpose = purpose; this.interactive = interactive; this.path = join(directory, `${purpose}.json`); this.data = {}; }
  async load() { this.data = await readPrivate(this.path) ?? {}; return this; }
  async persist() { await savePrivate(this.path, this.data); }
  get redirectUrl() { return callback; }
  get clientMetadata() { return { redirect_uris: [callback], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: `stride:${this.purpose} offline_access`, application_type: "native" }; }
  clientInformation() { return { client_id: this.purpose === "agent" ? config.agent_client_id : config.companion_client_id, issuer: site.origin }; }
  tokens() { return this.data.tokens; }
  async saveTokens(tokens) { if (tokens.issuer && tokens.issuer !== site.origin) throw new Error("Token issuer mismatch."); this.data.tokens = tokens; this.data.saved_at = Date.now(); await this.persist(); }
  async state() { this.data.state = randomBytes(32).toString("hex"); await this.persist(); return this.data.state; }
  async saveCodeVerifier(value) { this.data.verifier = value; await this.persist(); }
  codeVerifier() { if (!this.data.verifier) throw new Error("Missing PKCE verifier. Restart login."); return this.data.verifier; }
  discoveryState() { return this.data.discovery; }
  async saveDiscoveryState(value) { if (value.authorizationServerUrl !== site.origin || value.authorizationServerMetadata?.issuer !== site.origin) throw new Error("Authorization server mismatch."); this.data.discovery = value; await this.persist(); }
  async invalidateCredentials(scope) { if (scope === "client") throw new Error("The enrolled client is unavailable. Re-enroll in Stride."); if (["all", "tokens"].includes(scope)) delete this.data.tokens; if (["all", "verifier"].includes(scope)) delete this.data.verifier; if (["all", "discovery"].includes(scope)) delete this.data.discovery; await this.persist(); }
  resourceUrl() { return site.origin + (this.purpose === "agent" ? "/mcp" : "/api/agent-companion"); }
  async redirectToAuthorization(url) { if (!this.interactive) throw new Error("Connection sign-in expired. Run the login command again."); if (url.origin !== site.origin) throw new Error("Unexpected authorization origin."); process.stderr.write(`\nOpen this URL as the profile's human operator (${this.purpose} access):\n${url.href}\n`); }
  authOptions(extra = {}) { return { serverUrl: this.resourceUrl(), scope: `stride:${this.purpose} offline_access`, resourceMetadataUrl: new URL(`/.well-known/oauth-protected-resource/${this.purpose === "agent" ? "mcp" : "companion"}`, site), fetchFn: boundedFetch, ...extra }; }
  async freshToken() { if (!this.data.tokens || !this.data.saved_at || Date.now() >= this.data.saved_at + ((this.data.tokens.expires_in ?? 300) - 30) * 1000) { const result = await auth(this, this.authOptions()); if (result !== "AUTHORIZED") throw new Error("Human connection sign-in is required."); } return this.data.tokens.access_token; }
}
async function login(purpose) {
  const release = await processLock(purpose); const provider = await new ConnectionProvider(purpose, true).load(); let server;
  try {
    const received = new Promise((resolve, reject) => {
      server = createServer((request, response) => {
        const url = new URL(request.url, callback); const provided = url.searchParams.get("state") ?? ""; const expected = provider.data.state ?? "";
        if (request.method !== "GET" || request.headers.host !== "127.0.0.1:43871" || url.pathname !== "/callback" || url.search.length > 16000 || provided.length !== expected.length || !expected || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) { response.writeHead(400); response.end("Invalid authorization callback."); return; }
        if (!url.searchParams.get("code") || url.searchParams.get("iss") !== site.origin) { response.writeHead(400); response.end("Authorization was denied or the issuer did not match."); reject(new Error("Authorization denied or issuer mismatch.")); return; }
        response.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" }); response.end("Connection approval received. Return to your terminal."); resolve({ authorizationCode: url.searchParams.get("code"), iss: url.searchParams.get("iss") });
      }); server.on("error", reject); server.listen(43871, "127.0.0.1");
    });
    // Avoid an unhandled callback rejection while discovery is still running.
    void received.catch(() => {});
    const first = await auth(provider, provider.authOptions());
    if (first === "REDIRECT") { let timeout; try { const params = await Promise.race([received, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Connection approval timed out. Restart login.")), 180000); })]); await auth(provider, provider.authOptions(params)); } finally { clearTimeout(timeout); } }
    delete provider.data.verifier; delete provider.data.state; await provider.persist(); process.stderr.write(`${purpose} connection authorized. Tokens were saved privately.\n`);
  } finally { server?.close(); await release(); }
}
async function bridge() {
  const release = await processLock("agent"); const provider = await new ConnectionProvider("agent").load(); await provider.freshToken();
  const remote = new Client({ name: "stride-companion", version: "1.0.0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  await remote.connect(new StreamableHTTPClientTransport(new URL("/mcp", site), { authProvider: provider, fetch: boundedFetch }));
  const local = new Server({ name: "stride", version: "1.0.0" }, { capabilities: { tools: {}, resources: {} } });
  local.setRequestHandler(ListToolsRequestSchema, () => remote.listTools());
  local.setRequestHandler(CallToolRequestSchema, request => remote.callTool({ name: request.params.name, arguments: request.params.arguments }));
  local.setRequestHandler(ListResourcesRequestSchema, () => remote.listResources());
  local.setRequestHandler(ReadResourceRequestSchema, request => remote.readResource({ uri: request.params.uri }));
  const transport = new StdioServerTransport(); await local.connect(transport);
  const close = async () => { await remote.close(); await local.close(); await release(); };
  process.once("SIGINT", () => void close()); process.once("SIGTERM", () => void close()); process.stdin.once("end", () => void close());
}
async function watch() {
  if (!options.ticket || !/^[a-zA-Z0-9_-]{1,160}$/.test(options.ticket)) throw new Error("Choose an assigned ticket ID with --ticket.");
  const release = await processLock("companion"); const provider = await new ConnectionProvider("companion").load(); let stopped = false; let cursor = (await readPrivate(join(directory, "notices.json")))?.cursor ?? 0;
  process.once("SIGINT", () => { stopped = true; }); process.once("SIGTERM", () => { stopped = true; });
  async function call(query = "", body) { const token = await provider.freshToken(); const response = await boundedFetch(`${provider.resourceUrl()}${query}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Companion request failed."); return data; }
  try {
    process.stdout.write(`Watching assigned ticket ${options.ticket}. Review and authorize its start in Stride, then ask your IDE agent to claim it.\n`);
    while (!stopped) {
      try {
        const work = await call(`?ticket_id=${encodeURIComponent(options.ticket)}`); const packet = work.packet;
        let checkout = null; let repositoryId = null; let clean = true;
        if (packet.payload.repository) {
          const [head, status, remote] = await Promise.all([run("git", ["rev-parse", "HEAD"], { maxBuffer: 8192 }), run("git", ["status", "--porcelain"], { maxBuffer: 65536 }), run("git", ["remote", "get-url", "origin"], { maxBuffer: 8192 })]);
          const url = remote.stdout.trim().replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
          const parsed = new URL(url); if (parsed.hostname !== "github.com" || parsed.username || parsed.password || parsed.pathname !== `/${packet.payload.repository.full_name}`) throw new Error("The local origin does not match this packet's verified repository.");
          checkout = head.stdout.trim(); repositoryId = packet.payload.repository.repository_id; clean = !status.stdout.trim();
        }
        await call("", { preparation: { packet_id: packet.id, packet_hash: packet.hash, checkout, repository_id: repositoryId, clean } });
      } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "Companion unavailable."} No new start is authorized.\n`); try { await call("", { preparation: null }); } catch { /* Revoked or offline connections cannot renew. */ } }
      try {
        const page = await call(`?after=${cursor}`);
        for (const item of page.notices) process.stdout.write(`${process.stdout.isTTY ? "\u0007" : ""}[${item.created_at}] ${item.title}${item.ticket_id ? ` · ticket ${item.ticket_id}` : ""}\n`);
        cursor = page.next_cursor; await savePrivate(join(directory, "notices.json"), { cursor });
      } catch { process.stderr.write("Delivery notifications are temporarily unavailable. The saved cursor will resume on reconnection.\n"); }
      if (!stopped) await new Promise(resolve => setTimeout(resolve, 15000));
    }
  } finally { await release(); process.stdout.write("Companion stopped. Its lease expires within 90 seconds.\n"); }
}
try {
  if (command === "login") { await login("agent"); await login("companion"); }
  else if (command === "mcp") await bridge();
  else if (command === "watch") await watch();
  else throw new Error("Use login, mcp or watch with the options shown in Stride.");
} catch (error) { process.stderr.write(`Stride: ${error instanceof Error ? error.message : "Connection failed."}\n`); process.exitCode = 1; }

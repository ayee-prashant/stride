import { createHash, createPrivateKey, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { AppError } from "../domain.ts";
import { parseBinding } from "../github-context.ts";
import type { GitHubBinding, GitHubContextFile, GitHubObservation } from "../github-context.ts";

export class GitHubContextError extends Error {
  code: "setup_required" | "access_unavailable" | "rate_limited" | "incomplete" | "source_changed" | "upstream_unavailable";
  retryAfter: number;
  constructor(code: GitHubContextError["code"], retryAfter = 60) { super(code); this.name = "GitHubContextError"; this.code = code; this.retryAfter = retryAfter; }
}
type Environment = Record<string, string | undefined>;
export type GitHubContextSettings = { clientId: string; privateKey: KeyObject; bindings: GitHubBinding[] };
/** The web process needs only these grants; the private signing key stays in the worker. */
export function githubContextBindings(env: Environment): GitHubBinding[] {
  const encoded = env.STRIDE_GITHUB_CONTEXT_BINDINGS;
  if (!encoded) return [];
  try {
    if (Buffer.byteLength(encoded) > 32768) throw new Error();
    const raw: unknown = JSON.parse(encoded);
    if (!Array.isArray(raw) || !raw.length || raw.length > 5) throw new Error();
    const bindings = raw.map(parseBinding);
    if (new Set(bindings.map(b => b.key)).size !== bindings.length || new Set(bindings.map(b => `${b.workspace_id}:${b.project_id}`)).size !== bindings.length) throw new Error();
    return bindings;
  } catch { throw new GitHubContextError("setup_required"); }
}
export function githubContextSettings(env: Environment): GitHubContextSettings | null {
  const values = [env.STRIDE_GITHUB_APP_CLIENT_ID, env.STRIDE_GITHUB_APP_PRIVATE_KEY, env.STRIDE_GITHUB_CONTEXT_BINDINGS];
  if (values.every(v => !v)) return null;
  try {
    if (values.some(v => !v) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(values[0]!)) throw new Error();
    const key = createPrivateKey(values[1]!.replace(/\\n/g, "\n"));
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
    return { clientId: values[0]!, privateKey: key, bindings: githubContextBindings(env) };
  } catch { throw new GitHubContextError("setup_required"); }
}
export const bindingHash = (binding: GitHubBinding) => createHash("sha256").update(JSON.stringify(binding)).digest("hex");
const sha = (value: unknown) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GitHubContextError("incomplete");
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new GitHubContextError("incomplete"); return value; }
async function boundedJson(response: Response, limit: number): Promise<unknown> {
  if (!response.body || Number(response.headers.get("content-length") ?? 0) > limit) { await response.body?.cancel(); throw new GitHubContextError("incomplete"); }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const r = await reader.read(); if (r.done) break; length += r.value.byteLength; if (length > limit) { await reader.cancel(); throw new GitHubContextError("incomplete"); } chunks.push(r.value); }
    const bytes = Buffer.concat(chunks);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (e) { if (e instanceof GitHubContextError) throw e; throw new GitHubContextError("incomplete"); }
  finally { reader.releaseLock(); }
}

/** Read-only, repository-scoped GitHub App integration. Returned URLs are never fetched. */
export class GitHubContextProvider {
  settings: GitHubContextSettings; fetcher: typeof fetch; now: () => Date;
  constructor(settings: GitHubContextSettings, fetcher: typeof fetch = fetch, now = () => new Date()) { this.settings = settings; this.fetcher = fetcher; this.now = now; }
  jwt() {
    const now = Math.floor(this.now().getTime() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: this.settings.clientId })).toString("base64url");
    const input = `${header}.${payload}`;
    return `${input}.${sign("RSA-SHA256", Buffer.from(input), this.settings.privateKey).toString("base64url")}`;
  }
  async request(path: string, token: string, signal: AbortSignal, body?: unknown, limit = 131072) {
    // All paths are constructed below from validated bindings and verified Git object IDs.
    const url = new URL(path, "https://api.github.com");
    if (url.origin !== "https://api.github.com" || url.username || url.password || url.hash) throw new GitHubContextError("incomplete");
    let response: Response;
    try { response = await this.fetcher(url, { method: body === undefined ? "GET" : "POST", redirect: "error", signal, headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "Stride-Project-Context", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch { throw new GitHubContextError("upstream_unavailable"); }
    if (response.status === 429 || (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")))) {
      await response.body?.cancel(); const seconds = Number(response.headers.get("retry-after")); const reset = Number(response.headers.get("x-ratelimit-reset")) - Math.floor(this.now().getTime() / 1000);
      throw new GitHubContextError("rate_limited", Math.min(3600, Math.max(60, Number.isFinite(seconds) ? seconds : 60, Number.isFinite(reset) ? reset : 60)));
    }
    if ([401, 403, 404].includes(response.status)) { await response.body?.cancel(); throw new GitHubContextError("access_unavailable", 300); }
    if (!response.ok) { await response.body?.cancel(); throw new GitHubContextError("upstream_unavailable"); }
    return boundedJson(response, limit);
  }
  async inspect(bindingInput: GitHubBinding): Promise<GitHubObservation> {
    const binding = parseBinding(bindingInput);
    if (!this.settings.bindings.some(b => bindingHash(b) === bindingHash(binding))) throw new AppError(403, "SOURCE_NOT_APPROVED", "This repository is not approved for this project.");
    const signal = AbortSignal.timeout(35000);
    const grant = record(await this.request(`/app/installations/${binding.installation_id}/access_tokens`, this.jwt(), signal, { repository_ids: [binding.repository_id], permissions: { metadata: "read", contents: "read" } }));
    if (typeof grant.token !== "string" || grant.token.length < 10 || grant.token.length > 2048 || /\s/.test(grant.token)) throw new GitHubContextError("access_unavailable");
    const token = grant.token;
    const base = `/repos/${encodeURIComponent(binding.owner)}/${encodeURIComponent(binding.repository)}`;
    const repository = record(await this.request(base, token, signal));
    if (repository.id !== binding.repository_id || typeof repository.full_name !== "string" || repository.full_name.toLowerCase() !== `${binding.owner}/${binding.repository}`.toLowerCase()) throw new GitHubContextError("access_unavailable");
    const refPath = `${base}/git/ref/heads/${encodeURIComponent(binding.branch)}`;
    const head = record(record(await this.request(refPath, token, signal)).object);
    if (head.type !== "commit" || !sha(head.sha)) throw new GitHubContextError("incomplete");
    const commit = record(await this.request(`${base}/git/commits/${head.sha}`, token, signal));
    const treeSha = record(commit.tree).sha;
    if (commit.sha !== head.sha || !sha(treeSha)) throw new GitHubContextError("incomplete");
    const tree = record(await this.request(`${base}/git/trees/${treeSha}?recursive=1`, token, signal, undefined, 2_097_152));
    if (tree.sha !== treeSha || tree.truncated !== false) throw new GitHubContextError("incomplete");
    const entries = array(tree.tree).map(record);
    if (entries.length > 5000) throw new GitHubContextError("incomplete");
    const required = binding.paths.map(path => {
      const matches = entries.filter(entry => entry.path === path);
      if (matches.length !== 1 || matches[0].type !== "blob" || !["100644", "100755"].includes(String(matches[0].mode)) || !sha(matches[0].sha) || !Number.isSafeInteger(matches[0].size) || (matches[0].size as number) > 32768 || (matches[0].size as number) < 0) throw new GitHubContextError("incomplete");
      return { path, sha: matches[0].sha as string, size: matches[0].size as number };
    });
    if (required.reduce((sum, file) => sum + file.size, 0) > 65536) throw new GitHubContextError("incomplete");
    const files: GitHubContextFile[] = [];
    // A small concurrency limit avoids a burst of 12 blob requests per connection.
    for (let start = 0; start < required.length; start += 3) {
      const chunk = await Promise.all(required.slice(start, start + 3).map(async entry => {
        const blob = record(await this.request(`${base}/git/blobs/${entry.sha}`, token, signal));
        if (blob.sha !== entry.sha || blob.size !== entry.size || blob.encoding !== "base64" || typeof blob.content !== "string") throw new GitHubContextError("incomplete");
        const encoded = blob.content.replace(/\n/g, "");
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new GitHubContextError("incomplete");
        const bytes = Buffer.from(encoded, "base64");
        if (bytes.length !== entry.size || createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== entry.sha) throw new GitHubContextError("incomplete");
        let body: string;
        try { body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new GitHubContextError("incomplete"); }
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) throw new GitHubContextError("incomplete");
        return { path: entry.path, blob_sha: entry.sha, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, body };
      }));
      files.push(...chunk);
    }
    const confirmed = record(record(await this.request(refPath, token, signal)).object);
    if (confirmed.type !== "commit" || confirmed.sha !== head.sha) throw new GitHubContextError("source_changed", 10);
    const manifest = { repository_id: binding.repository_id, branch: binding.branch, head_sha: head.sha, tree_sha: treeSha, files: files.map(({ path, blob_sha, sha256, size }) => ({ path, blob_sha, sha256, size })) };
    return { ...manifest, full_name: repository.full_name, files, head_sha: head.sha as string, tree_sha: treeSha as string, manifest_hash: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"), observed_at: this.now().toISOString(), coverage: "configured_files", repository_mode: "observed" };
  }
}

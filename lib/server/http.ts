import { AppError, identifier, parseTaskQuery } from "../domain.ts";
import type { Identity } from "../domain.ts";
import type { Repository } from "./repository.ts";

// Enough for 8,000 Unicode description characters plus metadata, still bounded.
export const MAX_BODY_BYTES = 32_768;
export function assertMutationOrigin(request: Request, expectedOrigin = new URL(request.url).origin) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== expectedOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AppError(403, "ORIGIN_REJECTED", "This change must come from the application itself.");
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new AppError(415, "JSON_REQUIRED", "Send application/json.");
  }
}
export async function readJson(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_BODY_BYTES) throw new AppError(413, "BODY_TOO_LARGE", "The request is too large.");
  if (!request.body) throw new AppError(400, "INVALID_JSON", "A JSON request body is required.");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new AppError(413, "BODY_TOO_LARGE", "The request is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)); }
  catch { throw new AppError(400, "INVALID_JSON", "Enter a valid JSON request."); }
}
export type Dependencies = { identity: () => Promise<Identity | null>; repository: () => Repository; origin?: () => string };
function routeIdentifier(value: string): string {
  try { return identifier(decodeURIComponent(value)); }
  catch { throw new AppError(400, "INVALID_INPUT", "Invalid record identifier."); }
}
export async function handleApi(request: Request, dependencies: Dependencies): Promise<Response> {
  const requestId = crypto.randomUUID(); const started = Date.now();
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId, "Vary": "Cookie" });
  try {
    const user = await dependencies.identity();
    if (!user) throw new AppError(401, "SIGN_IN_REQUIRED", "Sign in to access your workspace.");
    const mutation = !["GET", "HEAD"].includes(request.method);
    if (mutation) assertMutationOrigin(request, dependencies.origin?.());
    const repository = dependencies.repository();
    let input: unknown;
    if (mutation) { await repository.rateLimit(user.userId); input = await readJson(request); }
    const url = new URL(request.url); const route = url.pathname.replace(/\/$/, "");
    let result: unknown; let status = 200;
    if (route === "/api/bootstrap" && request.method === "POST") {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) throw new AppError(400, "INVALID_INPUT", "Bootstrap accepts an empty object.");
      result = await repository.bootstrap(user);
    } else {
      const workspaceId = identifier(url.searchParams.get("workspace_id"));
      if (route === "/api/workspace" && request.method === "GET") result = await repository.metadata(user.userId, workspaceId);
      else if (route === "/api/projects" && request.method === "POST") { result = await repository.createProject(user.userId, workspaceId, input); status = 201; }
      else if (/^\/api\/projects\/[^/]+$/.test(route) && request.method === "PATCH") result = await repository.updateProject(user.userId, workspaceId, routeIdentifier(route.split("/")[3]), input);
      else if (route === "/api/members" && request.method === "POST") { result = await repository.addMember(user.userId, workspaceId, input); status = 201; }
      else if (route === "/api/tasks" && request.method === "GET") result = await repository.listTasks(user.userId, workspaceId, parseTaskQuery(url.searchParams));
      else if (route === "/api/tasks" && request.method === "POST") { result = await repository.createTask(user.userId, workspaceId, input); status = 201; }
      else if (/^\/api\/tasks\/[^/]+\/activity$/.test(route) && request.method === "GET") result = await repository.activity(user.userId, workspaceId, routeIdentifier(route.split("/")[3]));
      else if (/^\/api\/tasks\/[^/]+$/.test(route) && ["GET", "PATCH"].includes(request.method)) {
        const id = routeIdentifier(route.split("/")[3]);
        result = request.method === "GET" ? await repository.task(user.userId, workspaceId, id) : await repository.updateTask(user.userId, workspaceId, id, input);
      } else throw new AppError(404, "NOT_FOUND", "This endpoint is unavailable.");
    }
    headers.set("Server-Timing", `app;dur=${Date.now() - started}`);
    return new Response(JSON.stringify(result), { status, headers });
  } catch (error) {
    const known = error instanceof AppError;
    const status = known ? error.status : 503;
    if (!known) console.error(JSON.stringify({ event: "request_failed", requestId, kind: error instanceof Error ? error.name : "unknown" }));
    if (status === 429) headers.set("Retry-After", "60");
    return new Response(JSON.stringify({ error: { code: known ? error.code : "UNAVAILABLE", message: known ? error.message : "Your workspace is temporarily unavailable. Your draft has not been saved; try again shortly.", requestId } }), { status, headers });
  }
}

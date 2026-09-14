import { AppError, identifier, object, parsePageQuery, parseTaskQuery, text } from "../domain.ts";
import type { Identity } from "../domain.ts";
import type { Repository } from "./repository.ts";
import type { Invitations } from "./invitations.ts";
import type { Attachments } from "./attachments.ts";
import { ProductivityRepository } from "./productivity-repository.ts";

// Enough for 8,000 Unicode description characters plus metadata, still bounded.
export const MAX_BODY_BYTES = 32_768;
export function assertSameOrigin(request: Request, expectedOrigin = new URL(request.url).origin) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== expectedOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AppError(403, "ORIGIN_REJECTED", "This change must come from the application itself.");
  }
}
export function assertMutationOrigin(request: Request, expectedOrigin = new URL(request.url).origin) {
  assertSameOrigin(request, expectedOrigin);
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
export type Dependencies = { identity: () => Promise<Identity | null>; repository: () => Repository; origin?: () => string; invitations?: () => Invitations; attachments?: () => Attachments; inviteIdentity?: () => Promise<Identity | null>; capabilities?: () => { email: boolean; attachments: boolean } };
function routeIdentifier(value: string): string {
  try { return identifier(decodeURIComponent(value)); }
  catch { throw new AppError(400, "INVALID_INPUT", "Invalid record identifier."); }
}
export async function handleApi(request: Request, dependencies: Dependencies): Promise<Response> {
  const requestId = crypto.randomUUID(); const started = Date.now();
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId, "Vary": "Cookie" });
  try {
    const publicRoute = new URL(request.url).pathname.replace(/\/$/, "");
    if (["/api/invitations/preview", "/api/invitations/accept"].includes(publicRoute) && request.method === "POST" && dependencies.invitations) {
      assertMutationOrigin(request, dependencies.origin?.());
      const input = await readJson(request); const service = dependencies.invitations();
      const result = publicRoute.endsWith("/preview") ? await service.preview(input) : await service.accept(await (dependencies.inviteIdentity ?? dependencies.identity)(), input);
      headers.set("Referrer-Policy", "no-referrer");
      return new Response(JSON.stringify(result), { status: 200, headers });
    }
    const user = await dependencies.identity();
    if (!user) throw new AppError(401, "SIGN_IN_REQUIRED", "Sign in to access your workspace.");
    const mutation = !["GET", "HEAD"].includes(request.method);
    if (mutation) assertMutationOrigin(request, dependencies.origin?.());
    const repository = dependencies.repository();
    const productivity = new ProductivityRepository(repository);
    let input: unknown;
    if (mutation) { await repository.rateLimit(user.userId); input = await readJson(request); }
    const url = new URL(request.url); const route = url.pathname.replace(/\/$/, "");
    let result: unknown; let status = 200;
    if (route === "/api/bootstrap" && request.method === "POST") {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) throw new AppError(400, "INVALID_INPUT", "Bootstrap accepts an empty object.");
      result = await repository.bootstrap(user);
    } else {
      const workspaceId = identifier(url.searchParams.get("workspace_id"));
      if (route === "/api/capabilities" && request.method === "GET") { await repository.membership(user.userId, workspaceId); result = dependencies.capabilities?.() ?? { email: false, attachments: false }; }
      else if (route === "/api/invitations" && ["GET", "POST"].includes(request.method) && dependencies.invitations) result = request.method === "GET" ? await dependencies.invitations().list(user.userId, workspaceId) : await dependencies.invitations().create(user.userId, workspaceId, input);
      else if (/^\/api\/invitations\/[^/]+$/.test(route) && request.method === "DELETE" && dependencies.invitations) result = await dependencies.invitations().revoke(user.userId, workspaceId, routeIdentifier(route.split("/")[3]), input);
      else if (route === "/api/tasks/bulk" && request.method === "POST") result = await productivity.bulk(user.userId, workspaceId, input);
      else if (/^\/api\/tasks\/[^/]+\/files$/.test(route) && request.method === "GET" && dependencies.attachments) result = await dependencies.attachments().list(user.userId, workspaceId, routeIdentifier(route.split("/")[3]));
      else if (/^\/api\/files\/[^/]+$/.test(route) && request.method === "DELETE" && dependencies.attachments) { object(input, []); result = await dependencies.attachments().remove(user.userId, workspaceId, routeIdentifier(route.split("/")[3])); }
      else if (route === "/api/workload" && request.method === "GET") result = await productivity.workload(user.userId, workspaceId);
      else if (route === "/api/preferences" && ["GET", "PATCH"].includes(request.method)) result = request.method === "GET" ? await productivity.preferences(user.userId, workspaceId) : await productivity.savePreferences(user.userId, workspaceId, input);
      else if (route === "/api/views" && ["GET", "POST"].includes(request.method)) result = request.method === "GET" ? await productivity.views(user.userId, workspaceId) : await productivity.saveView(user.userId, workspaceId, null, input);
      else if (/^\/api\/views\/[^/]+$/.test(route) && ["PATCH", "DELETE"].includes(request.method)) result = request.method === "PATCH" ? await productivity.saveView(user.userId, workspaceId, routeIdentifier(route.split("/")[3]), input) : await productivity.removeView(user.userId, workspaceId, routeIdentifier(route.split("/")[3]), input);
      else if (route === "/api/templates" && ["GET", "POST"].includes(request.method)) result = request.method === "GET" ? await productivity.templates(user.userId, workspaceId) : await productivity.saveTemplate(user.userId, workspaceId, null, input);
      else if (/^\/api\/templates\/[^/]+\/use$/.test(route) && request.method === "POST") { result = await productivity.useTemplate(user.userId, workspaceId, routeIdentifier(route.split("/")[3]), input); status = 201; }
      else if (/^\/api\/templates\/[^/]+$/.test(route) && ["PATCH", "DELETE"].includes(request.method)) result = request.method === "PATCH" ? await productivity.saveTemplate(user.userId, workspaceId, routeIdentifier(route.split("/")[3]), input) : await productivity.removeTemplate(user.userId, workspaceId, routeIdentifier(route.split("/")[3]), input);
      else if (/^\/api\/tasks\/[^/]+\/checklist$/.test(route) && ["GET", "POST"].includes(request.method)) result = request.method === "GET" ? await productivity.checklist(user.userId, workspaceId, routeIdentifier(route.split("/")[3])) : await productivity.changeChecklist(user.userId, workspaceId, routeIdentifier(route.split("/")[3]), null, input);
      else if (/^\/api\/tasks\/[^/]+\/checklist\/[^/]+$/.test(route) && request.method === "PATCH") result = await productivity.changeChecklist(user.userId, workspaceId, routeIdentifier(route.split("/")[3]), routeIdentifier(route.split("/")[5]), input);
      else if (/^\/api\/tasks\/[^/]+\/mute$/.test(route) && ["GET", "PATCH"].includes(request.method)) result = request.method === "GET" ? await productivity.taskMute(user.userId, workspaceId, routeIdentifier(route.split("/")[3])) : await productivity.muteTask(user.userId, workspaceId, routeIdentifier(route.split("/")[3]), input);
      else if (route === "/api/workspace" && request.method === "GET") result = await repository.metadata(user.userId, workspaceId);
      else if (route === "/api/projects" && request.method === "POST") { result = await repository.createProject(user.userId, workspaceId, input); status = 201; }
      else if (/^\/api\/projects\/[^/]+$/.test(route) && request.method === "PATCH") result = await repository.updateProject(user.userId, workspaceId, routeIdentifier(route.split("/")[3]), input);
      else if (route === "/api/members" && request.method === "POST") { result = await repository.addMember(user.userId, workspaceId, input); status = 201; }
      else if (route === "/api/tasks" && request.method === "GET") result = await repository.listTasks(user.userId, workspaceId, parseTaskQuery(url.searchParams));
      else if (route === "/api/tasks" && request.method === "POST") { result = await repository.createTask(user.userId, workspaceId, input); status = 201; }
      else if (/^\/api\/tasks\/[^/]+\/comments$/.test(route) && ["GET", "POST"].includes(request.method)) {
        const taskId = routeIdentifier(route.split("/")[3]);
        if (request.method === "POST") { result = await repository.createComment(user.userId, workspaceId, taskId, input); status = 201; }
        else result = await repository.comments(user.userId, workspaceId, taskId, parsePageQuery(url.searchParams));
      }
      else if (route === "/api/notifications/sync" && request.method === "POST") result = await repository.notifications(user.userId, workspaceId, input, true);
      else if (route === "/api/notifications/read" && request.method === "POST") result = await repository.readNotification(user.userId, workspaceId, null, input);
      else if (/^\/api\/notifications\/[^/]+$/.test(route) && request.method === "PATCH") {
        let id: string;
        try { id = text(decodeURIComponent(route.split("/")[3]), "Notification identifier", 1024); }
        catch { throw new AppError(400, "INVALID_INPUT", "Invalid notification identifier."); }
        result = await repository.readNotification(user.userId, workspaceId, id, input);
      }
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
    return new Response(JSON.stringify({ error: { code: known ? error.code : "UNAVAILABLE", message: known ? error.message : "Your workspace is temporarily unavailable. Refresh and check whether your change was saved before retrying.", requestId } }), { status, headers });
  }
}

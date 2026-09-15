import { AppError, identifier } from "../domain.ts";
import { parseContextCursor } from "../context.ts";
import { DeliveryService } from "./delivery-service.ts";
import { AgentConnections } from "./agent-connections.ts";
import type { Repository } from "./repository.ts";
import type { DeliveryOptions } from "./delivery-store.ts";

export type ConnectionProvisioner = (workspaceId: string, projectId: string, input: unknown) => Promise<unknown>;
export async function deliveryRoute(repo: Repository, userId: string, workspaceId: string, url: URL, method: string, input: unknown, options: DeliveryOptions = {}, provision?: ConnectionProvisioner) {
  const m = /^\/api\/projects\/([^/]+)\/delivery(?:\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?)?$/.exec(url.pathname.replace(/\/$/, ""));
  if (!m) return null;
  for (const key of url.searchParams.keys()) if (!["workspace_id", "offset", "after", "latest"].includes(key) || url.searchParams.getAll(key).length !== 1) throw new AppError(400, "INVALID_INPUT", "Unknown or repeated delivery query parameter.");
  let projectId: string; let id: string | null;
  try { projectId = identifier(decodeURIComponent(m[1])); id = m[3] ? identifier(decodeURIComponent(m[3])) : null; } catch { throw new AppError(400, "INVALID_INPUT", "Invalid delivery identifier."); }
  const s = new DeliveryService(repo, options); const c = new AgentConnections(repo, options); const section = m[2]; const action = m[4]; let body: unknown;
  if (!section && method === "GET") body = await s.overview(userId, workspaceId, projectId, Math.min(parseContextCursor(url.searchParams.get("offset")), 500));
  else if (!section && method === "POST") body = await s.initialize(userId, workspaceId, projectId, input);
  else if (section === "discovery" && !id && method === "POST") body = await s.createDiscovery(userId, workspaceId, projectId, input);
  else if (section === "events" && !id && method === "GET") body = await s.history(userId, workspaceId, projectId, null, parseContextCursor(url.searchParams.get("after")));
  else if (section === "notices" && !id && method === "GET") body = await s.notices(userId, workspaceId, projectId, parseContextCursor(url.searchParams.get("after")), url.searchParams.get("latest") === "1");
  else if (section === "notices" && !id && method === "PATCH") body = await s.readNotices(userId, workspaceId, projectId, input);
  else if (section === "connections" && !id && method === "POST" && provision) body = await provision(workspaceId, projectId, input);
  else if (section === "connections" && id && action === "revoke" && method === "POST") body = await c.revoke(userId, workspaceId, projectId, id, input);
  else if (section === "tickets" && id && !action && method === "GET") body = await s.detail(userId, workspaceId, projectId, id);
  else if (section === "tickets" && id && action === "events" && method === "GET") body = await s.history(userId, workspaceId, projectId, id, parseContextCursor(url.searchParams.get("after")));
  else if (section === "tickets" && id && method === "POST" && action === "assign") body = await s.assign(userId, workspaceId, projectId, id, input);
  else if (section === "tickets" && id && method === "POST" && action === "start") body = await s.authorizeStart(userId, workspaceId, projectId, id, input);
  else if (section === "tickets" && id && method === "POST" && action === "review") body = await s.review(userId, workspaceId, projectId, id, input);
  else if (section === "tickets" && id && method === "POST" && action === "rework") body = await s.rework(userId, workspaceId, projectId, id, input);
  else if (section === "tickets" && id && method === "POST" && action === "stop") body = await s.stop(userId, workspaceId, projectId, id, input);
  else if (section === "tickets" && id && method === "POST" && (action === "uat" || action === "release")) body = await s.authorizeEnvironment(userId, workspaceId, projectId, id, action, input);
  else throw new AppError(404, "NOT_FOUND", "This delivery endpoint is unavailable.");
  return { status: 200, body };
}

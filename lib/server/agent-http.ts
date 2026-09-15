import { AppError, identifier } from "../domain.ts";
import { parseAgentCursor } from "../agents.ts";
import { AgentRegistryRepository } from "./agent-registry.ts";
import type { Repository } from "./repository.ts";

/** These routes accept only the existing verified human session boundary. */
export async function agentRoute(repository: Repository, userId: string, workspaceId: string, url: URL, method: string, input: unknown) {
  const match = /^\/api\/projects\/([^/]+)\/agents(?:\/([^/]+)(?:\/([^/]+))?)?$/.exec(url.pathname.replace(/\/$/, ""));
  if (!match) return null;
  const allowed = ["workspace_id", ...(!match[2] && method === "GET" ? ["offset"] : match[3] === "history" ? ["before"] : [])];
  for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw new AppError(400, "INVALID_INPUT", "Unknown or repeated agent query parameter.");
  let projectId: string; let record: string | undefined;
  try { projectId = identifier(decodeURIComponent(match[1])); record = match[2] ? identifier(decodeURIComponent(match[2])) : undefined; }
  catch { throw new AppError(400, "INVALID_INPUT", "Invalid agent identifier."); }
  const service = new AgentRegistryRepository(repository);
  if (record === "roles" && match[3] && method === "GET") { await service.project(userId, workspaceId, projectId); return { status: 200, body: service.template(match[3]) }; }
  if (!record && method === "GET") return { status: 200, body: await service.list(userId, workspaceId, projectId, parseAgentCursor(url.searchParams.get("offset"), 200)) };
  if (!record && method === "POST") return { status: 201, body: await service.register(userId, workspaceId, projectId, input) };
  if (record && !match[3] && method === "GET") return { status: 200, body: await service.binding(userId, workspaceId, projectId, record) };
  if (record && !match[3] && method === "PATCH") return { status: 200, body: await service.mutate(userId, workspaceId, projectId, record, "configure", input) };
  if (record && match[3] === "history" && method === "GET") return { status: 200, body: await service.history(userId, workspaceId, projectId, record, parseAgentCursor(url.searchParams.get("before"))) };
  if (record && ["initialize", "revoke"].includes(match[3]) && method === "POST") return { status: 200, body: await service.mutate(userId, workspaceId, projectId, record, match[3] as "initialize" | "revoke", input) };
  throw new AppError(404, "NOT_FOUND", "This agent endpoint is unavailable.");
}

import { AppError } from "../domain.ts";
import { parseContextCursor } from "../context.ts";
import { ContextRepository } from "./context-repository.ts";
import type { Repository } from "./repository.ts";
import type { GitHubBinding } from "../github-context.ts";
import { RepositorySources } from "./repository-sources.ts";

function segment(value: string) {
  try { return decodeURIComponent(value); }
  catch { throw new AppError(400, "INVALID_INPUT", "Invalid context identifier."); }
}
/** Called after the common authenticated human, origin, quota and JSON boundaries. */
export async function contextRoute(repository: Repository, userId: string, workspaceId: string, url: URL, method: string, input: unknown, bindings: () => GitHubBinding[] = () => []) {
  const route = url.pathname.replace(/\/$/, "");
  const project = /^\/api\/projects\/([^/]+)\/context(?:\/(changes|documents)(?:\/([^/]+))?)?$/.exec(route);
  const task = /^\/api\/tasks\/([^/]+)\/context(?:\/([^/]+))?$/.exec(route);
  const repositorySource = /^\/api\/projects\/([^/]+)\/repository(?:\/(refresh|disconnect))?$/.exec(route);
  if (!project && !task && !repositorySource) return null;
  const allowed = new Set(["workspace_id", ...(project?.[2] === "changes" ? ["after"] : project?.[3] ? ["before"] : [])]);
  for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new AppError(400, "INVALID_INPUT", "Unknown or repeated context query parameter.");
  const grants = bindings();
  const service = new ContextRepository(repository, grants);
  if (repositorySource) {
    const sources = new RepositorySources(repository, grants); const projectId = segment(repositorySource[1]);
    if (!repositorySource[2] && method === "GET") return { status: 200, body: await sources.view(userId, workspaceId, projectId) };
    if (method === "POST") {
      if (!repositorySource[2]) return { status: 202, body: await sources.connect(userId, workspaceId, projectId, input) };
      if (repositorySource[2] === "refresh") return { status: 202, body: await sources.refresh(userId, workspaceId, projectId, input) };
      return { status: 200, body: await sources.disconnect(userId, workspaceId, projectId, input) };
    }
  }
  if (project) {
    const projectId = segment(project[1]);
    if (!project[2] && method === "GET") return { status: 200, body: await service.brief(userId, workspaceId, projectId) };
    if (project[2] === "documents" && !project[3] && method === "POST") return { status: 201, body: await service.publish(userId, workspaceId, projectId, input) };
    if (project[2] === "documents" && project[3] && method === "GET") return { status: 200, body: await service.history(userId, workspaceId, projectId, segment(project[3]), parseContextCursor(url.searchParams.get("before"))) };
    if (project[2] === "changes" && !project[3] && method === "GET") return { status: 200, body: await service.changes(userId, workspaceId, projectId, parseContextCursor(url.searchParams.get("after"))) };
  }
  if (task) {
    const taskId = segment(task[1]);
    if (method === "GET") return { status: 200, body: await service.taskBrief(userId, workspaceId, taskId, task[2] ? segment(task[2]) : undefined) };
    if (method === "POST" && !task[2]) return { status: 201, body: await service.createTaskBrief(userId, workspaceId, taskId, input) };
  }
  throw new AppError(404, "NOT_FOUND", "This context endpoint is unavailable.");
}

import { authenticateAgent, agentAuthError } from "@/lib/server/agent-authorization";
import { handleAgentMcp } from "@/lib/server/agent-mcp";
import { getRepository } from "@/lib/server/database";
import { deliveryOptions } from "@/lib/server/delivery-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(request: Request) {
  try {
    const actor = await authenticateAgent(request, "agent"); const repo = getRepository();
    await repo.rateLimit(`agent:${actor.connection_id}`);
    const response = await handleAgentMcp(request, actor, repo, deliveryOptions());
    response.headers.set("Cache-Control", "private, no-store"); response.headers.set("X-Content-Type-Options", "nosniff"); return response;
  } catch (e) { return agentAuthError(e, "agent"); }
}
export const POST = handle;
export const GET = handle;
export const DELETE = handle;

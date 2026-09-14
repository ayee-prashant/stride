import { authenticateAgent, agentAuthError } from "@/lib/server/agent-authorization";
import { AgentConnections } from "@/lib/server/agent-connections";
import { DeliveryService } from "@/lib/server/delivery-service";
import { getRepository } from "@/lib/server/database";
import { readJson } from "@/lib/server/http";
import { parseContextCursor } from "@/lib/context";
import { deliveryOptions } from "@/lib/server/delivery-runtime";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(request: Request) {
  try {
    const actor = await authenticateAgent(request, "companion"); const repo = getRepository(); await repo.rateLimit(`companion:${actor.connection_id}`);
    const options = deliveryOptions(); const url = new URL(request.url);
    const result = request.method === "POST" ? await new AgentConnections(repo, options).heartbeat(actor, await readJson(request)) : url.searchParams.has("ticket_id") ? await new DeliveryService(repo, options).agentPacket(actor, url.searchParams.get("ticket_id")!) : await new DeliveryService(repo, options).companionNotices(actor, parseContextCursor(url.searchParams.get("after")));
    return Response.json(result, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) { return agentAuthError(e, "companion"); }
}
export const GET = handle;
export const POST = handle;

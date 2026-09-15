import { applicationOrigin } from "@/lib/server/deployment-config";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params; if (!["mcp", "companion"].includes(resource)) return new Response(null, { status: 404 });
  const origin = applicationOrigin(process.env); const agent = resource === "mcp";
  return Response.json({ resource: `${origin}${agent ? "/mcp" : "/api/agent-companion"}`, authorization_servers: [origin], scopes_supported: [agent ? "stride:agent" : "stride:companion"], bearer_methods_supported: ["header"] }, { headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}

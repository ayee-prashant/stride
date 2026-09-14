import { getAuth } from "@/lib/server/auth";
export const dynamic = "force-dynamic";
export async function GET() { return Response.json(await getAuth().api.getOAuthServerConfig(), { headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } }); }

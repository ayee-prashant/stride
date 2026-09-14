import { authenticationSettings } from "@/lib/server/deployment-config";
import { getPool } from "@/lib/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    authenticationSettings(process.env);
    await getPool().query("SELECT 1 FROM auth_users LIMIT 1");
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

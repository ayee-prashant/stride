import { getAuth } from "@/lib/server/auth";
import { emailConfigured } from "@/lib/server/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
    if (new URL(request.url).pathname.endsWith("/request-password-reset") && !emailConfigured(process.env)) return Response.json({ error: "Account recovery email is not connected yet." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    const response = await getAuth().handler(request);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  } catch {
    return Response.json({ error: "Sign-in is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
export const GET = handle;
export const POST = handle;

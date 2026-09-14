import { getAuth } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
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

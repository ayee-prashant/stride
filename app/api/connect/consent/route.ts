import { getAuth } from "@/lib/server/auth";
import { connectionConsent } from "@/lib/server/agent-consent";
import { assertMutationOrigin, readJson } from "@/lib/server/http";
import { applicationOrigin } from "@/lib/server/deployment-config";
import { AppError, object, text } from "@/lib/domain";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const origin = applicationOrigin(process.env);
    assertMutationOrigin(request, origin);
    const v = object(await readJson(request), ["accept", "oauth_query"]);
    const query = text(v.oauth_query, "Authorization query", 12000);
    if (typeof v.accept !== "boolean") throw new AppError(400, "INVALID_INPUT", "Choose allow or deny.");
    await connectionConsent(request.headers, query);
    // Resuming authorization needs a real Request in the provider's context.
    // Dispatch through its handler in-process, retaining signature, session and
    // CSRF validation. No network request or alternate authorization path is used.
    const headers = new Headers(request.headers);
    headers.set("accept", "application/json"); headers.set("content-type", "application/json"); headers.delete("content-length");
    const response = await getAuth().handler(new Request(new URL("/api/auth/oauth2/consent", origin), { method: "POST", headers, body: JSON.stringify({ accept: v.accept, oauth_query: query }) }));
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  }
  catch (e) { return Response.json({ error: e instanceof AppError ? e.message : "Authorization expired or could not be completed. Restart connection sign-in." }, { status: e instanceof AppError ? e.status : 400, headers: { "Cache-Control": "private, no-store" } }); }
}

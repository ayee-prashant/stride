import { getAuth } from "@/lib/server/auth";
import { connectionConsent } from "@/lib/server/agent-consent";
import { assertMutationOrigin, readJson } from "@/lib/server/http";
import { applicationOrigin } from "@/lib/server/deployment-config";
import { AppError, object, text } from "@/lib/domain";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { assertMutationOrigin(request, applicationOrigin(process.env)); const v = object(await readJson(request), ["accept", "oauth_query"]); const query = text(v.oauth_query, "Authorization query", 12000); if (typeof v.accept !== "boolean") throw new AppError(400, "INVALID_INPUT", "Choose allow or deny."); await connectionConsent(request.headers, query); const result = await getAuth().api.oauth2Consent({ headers: request.headers, body: { accept: v.accept, oauth_query: query } }); return Response.json(result, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (e) { return Response.json({ error: e instanceof AppError ? e.message : "Authorization expired or could not be completed. Restart connection sign-in." }, { status: e instanceof AppError ? e.status : 400, headers: { "Cache-Control": "private, no-store" } }); }
}

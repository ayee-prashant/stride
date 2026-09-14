import "server-only";
import { createAuthClient } from "better-auth/client";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { AppError } from "../domain";
import type { AgentActor } from "../delivery";
import { getAuth, admitted, getSessionIdentity } from "./auth";
import { getPool, getRepository } from "./database";
import { applicationOrigin } from "./deployment-config";
import { AgentConnections } from "./agent-connections";
import { oauthEnrollment } from "./agent-oauth-options";
import { randomUUID } from "node:crypto";

export const AGENT_CALLBACK = "http://127.0.0.1:43871/callback";
export async function provisionConnection(request: Request, workspaceId: string, projectId: string, input: unknown) {
  const human = await getSessionIdentity(request.headers); if (!human) throw new AppError(401, "SIGN_IN_REQUIRED", "Sign in before enrolling an agent.");
  const service = new AgentConnections(getRepository()); const c = await service.enroll(human.userId, workspaceId, projectId, input);
  if (c.client_id && c.companion_client_id || c.state === "revoked") return c;
  // Enrollment metadata and native redirects are server-owned. The client management
  // API cannot enter this async-local authorization context from an HTTP request.
  return oauthEnrollment.run({ userId: human.userId, connectionId: c.id }, async () => {
    const origin = applicationOrigin(process.env); const ids: string[] = [];
    try {
      for (const purpose of ["agent", "companion"] as const) {
        const scope = purpose === "agent" ? "stride:agent" : "stride:companion";
        const created = await getAuth().api.adminCreateOAuthClient({ headers: request.headers, body: { redirect_uris: [AGENT_CALLBACK], scope: `${scope} offline_access`, client_name: `Stride ${c.name} (${purpose})`, token_endpoint_auth_method: "none", application_type: "native", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], require_pkce: true, skip_consent: false, metadata: { connection_id: c.id, purpose } } });
        const clientId = created.client_id; ids.push(clientId);
        const resource = purpose === "agent" ? `${origin}/mcp` : `${origin}/api/agent-companion`;
        await getPool().query("INSERT INTO auth_oauth_client_resource(id,client_id,resource_id,created_at) VALUES($1,$2,$3,NOW())", [randomUUID(), clientId, resource]);
      }
      const current = await service.attachClients(human.userId, workspaceId, projectId, c.id, { agent: ids[0], companion: ids[1] });
      // Concurrent enrollment retries can create unused public clients. Revoke them;
      // the persisted connection owns the only two accepted client IDs.
      for (const id of ids) if (![current.client_id, current.companion_client_id].includes(id)) await getPool().query("UPDATE auth_oauth_client SET disabled=true WHERE client_id=$1", [id]);
      return current;
    } catch (error) { for (const id of ids) await getPool().query("UPDATE auth_oauth_client SET disabled=true WHERE client_id=$1", [id]); throw error; }
  });
}

export async function authenticateAgent(request: Request, purpose: "agent" | "companion"): Promise<AgentActor> {
  const origin = applicationOrigin(process.env); const resource = purpose === "agent" ? `${origin}/mcp` : `${origin}/api/agent-companion`;
  const suppliedOrigin = request.headers.get("origin");
  if (suppliedOrigin && suppliedOrigin !== origin || request.headers.get("sec-fetch-site") === "cross-site" || new URL(request.url).host !== new URL(origin).host) throw new AppError(403, "ORIGIN_REJECTED", "This agent origin or host is not allowed.");
  if (!request.headers.get("authorization") || request.headers.has("cookie")) throw new AppError(401, "AGENT_AUTH_REQUIRED", "Use the enrolled agent's OAuth token.");
  try {
    const client = createAuthClient({ plugins: [oauthProviderResourceClient(getAuth())] });
    const token = await client.verifyAccessTokenRequest(request, { verifyOptions: { issuer: origin, audience: resource }, jwksUrl: `${origin}/api/auth/jwks`, requiredScopes: [purpose === "agent" ? "stride:agent" : "stride:companion"] });
    if (typeof token.sub !== "string" || typeof token.sid !== "string" || typeof token.client_id !== "string" || typeof token.stride_connection !== "string" || typeof token.stride_profile !== "string" || token.stride_purpose !== purpose || token.aud !== resource) throw new Error("Invalid connection claims");
    const repo = getRepository(); const row = await repo.statement("SELECT workspace_id,project_id,profile_id,operator_id,client_id,companion_client_id FROM agent_connections WHERE id=?", token.stride_connection).first<{ workspace_id: string; project_id: string; profile_id: string; operator_id: string; client_id: string; companion_client_id: string }>();
    if (!row || row.operator_id !== token.sub || row.profile_id !== token.stride_profile || token.client_id !== (purpose === "agent" ? row.client_id : row.companion_client_id)) throw new Error("Invalid enrolled client");
    const sessions = await getPool().query<{ email: string }>("SELECT u.email FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.expires_at>NOW() AND EXISTS(SELECT 1 FROM auth_accounts a WHERE a.user_id=u.id AND a.provider_id='credential')", [token.sid, token.sub]);
    if (sessions.rows.length !== 1 || !await admitted(token.sub, sessions.rows[0].email)) throw new Error("Session revoked");
    const actor: AgentActor = { kind: "agent", connection_id: token.stride_connection, profile_id: row.profile_id, operator_id: row.operator_id, workspace_id: row.workspace_id, project_id: row.project_id, session_id: token.sid };
    await new AgentConnections(repo).validateConnection(actor); return actor;
  } catch { throw new AppError(401, "AGENT_AUTH_REQUIRED", "This connection is unavailable. Renew enrollment or sign in again."); }
}
export function agentAuthError(error: unknown, purpose: "agent" | "companion") {
  const status = error instanceof AppError ? error.status : 503;
  const origin = applicationOrigin(process.env);
  return Response.json({ error: error instanceof AppError ? error.message : "Agent access is temporarily unavailable." }, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...(status === 401 ? { "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/${purpose === "agent" ? "mcp" : "companion"}", scope="stride:${purpose}"` } : {}) } });
}

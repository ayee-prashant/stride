import "server-only";
import { AppError } from "../domain";
import { getSessionIdentity } from "./auth";
import { getRepository } from "./database";
import { AgentConnections } from "./agent-connections";
import { applicationOrigin } from "./deployment-config";

export function oauthQuery(params: Record<string, string | string[] | undefined>) { const query = new URLSearchParams(); for (const [k, value] of Object.entries(params)) for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(k, v); if (query.toString().length > 12000) throw new AppError(400, "INVALID_INPUT", "This authorization request is too large."); return query.toString(); }
export async function connectionConsent(headers: Headers, query: string) {
  const user = await getSessionIdentity(headers); if (!user) throw new AppError(401, "SIGN_IN_REQUIRED", "Sign in as this profile's human operator.");
  const params = new URLSearchParams(query); const clientId = params.get("client_id"); const resource = params.getAll("resource");
  const row = await getRepository().statement("SELECT c.*,p.alias,b.role_id FROM agent_connections c JOIN agent_profiles p ON p.workspace_id=c.workspace_id AND p.id=c.profile_id JOIN agent_role_bindings b ON b.workspace_id=c.workspace_id AND b.id=c.binding_id WHERE c.operator_id=? AND (c.client_id=? OR c.companion_client_id=?)", user.userId, clientId, clientId).first<{ id: string; workspace_id: string; project_id: string; profile_id: string; operator_id: string; client_id: string; companion_client_id: string; name: string; alias: string; role_id: string }>();
  if (!row) throw new AppError(403, "CONNECTION_UNAVAILABLE", "This connection does not belong to your profile.");
  const purpose = row.client_id === clientId ? "agent" as const : "companion" as const;
  const expectedScope = `stride:${purpose}`; const scopes = (params.get("scope") ?? "").split(" "); const origin = applicationOrigin(process.env);
  if (resource.length !== 1 || resource[0] !== `${origin}${purpose === "agent" ? "/mcp" : "/api/agent-companion"}` || !scopes.includes(expectedScope) || scopes.some(s => ![expectedScope, "offline_access"].includes(s))) throw new AppError(403, "SCOPE_UNAVAILABLE", "This connection requested an unexpected resource or permission.");
  await new AgentConnections(getRepository()).validateConnection({ kind: "agent", connection_id: row.id, profile_id: row.profile_id, operator_id: user.userId, workspace_id: row.workspace_id, project_id: row.project_id, session_id: "consent-review" });
  return { ...row, purpose };
}

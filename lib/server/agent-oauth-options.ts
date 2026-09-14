import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { APIError } from "better-auth/api";
import { oauthProvider } from "@better-auth/oauth-provider";
import { getRepository } from "./database";
import { AgentConnections } from "./agent-connections";

export const oauthEnrollment = new AsyncLocalStorage<{ userId: string; connectionId: string }>();
export function agentOAuthOptions(origin: string, admitted: (id: string, email: string) => Promise<boolean>) {
  return oauthProvider({
    loginPage: "/connect/login", consentPage: "/connect/consent",
    scopes: ["stride:agent", "stride:companion", "offline_access"],
    grantTypes: ["authorization_code", "refresh_token"],
    accessTokenExpiresIn: 300, refreshTokenExpiresIn: 604800, refreshTokenReuseInterval: 0, codeExpiresIn: 120,
    allowDynamicClientRegistration: false, allowUnauthenticatedClientRegistration: false,
    resources: [
      { identifier: `${origin}/mcp`, name: "Stride agent work", accessTokenTtl: 300, allowedScopes: ["stride:agent", "offline_access"] },
      { identifier: `${origin}/api/agent-companion`, name: "Stride human companion", accessTokenTtl: 300, allowedScopes: ["stride:companion", "offline_access"] },
    ],
    resourceSeedMode: "overwrite", enforcePerClientResources: true,
    clientPrivileges: async ({ action, user }) => action === "create" && !!user && oauthEnrollment.getStore()?.userId === user.id,
    resourcePrivileges: async () => false,
    customAccessTokenClaims: async ({ user, resources, scopes, metadata }) => {
      if (!user || !await admitted(user.id, user.email) || !metadata || typeof metadata.connection_id !== "string" || !["agent", "companion"].includes(metadata.purpose)) throw new APIError("FORBIDDEN", { message: "This connection is not authorized." });
      const repo = getRepository();
      const row = await repo.statement("SELECT workspace_id,project_id,profile_id,operator_id FROM agent_connections WHERE id=?", metadata.connection_id).first<{ workspace_id: string; project_id: string; profile_id: string; operator_id: string }>();
      const expected = metadata.purpose === "agent" ? `${origin}/mcp` : `${origin}/api/agent-companion`;
      const expectedScope = metadata.purpose === "agent" ? "stride:agent" : "stride:companion";
      if (!row || row.operator_id !== user.id || resources?.length !== 1 || resources[0] !== expected || !scopes.includes(expectedScope) || scopes.some(s => ![expectedScope, "offline_access"].includes(s))) throw new APIError("FORBIDDEN", { message: "This resource is not authorized for this operator and connection." });
      try { await new AgentConnections(repo).validateConnection({ kind: "agent", connection_id: metadata.connection_id, ...row, session_id: "token-issuance" }); }
      catch { throw new APIError("FORBIDDEN", { message: "This connection requires renewed human enrollment." }); }
      return { stride_connection: metadata.connection_id, stride_profile: row.profile_id, stride_purpose: metadata.purpose };
    },
  });
}

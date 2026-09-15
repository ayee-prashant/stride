import { mkdir, writeFile } from "node:fs/promises";
import { oauthProvider } from "@better-auth/oauth-provider";
import { jwt } from "better-auth/plugins";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";

if (typeof createMcpHandler !== "function" || typeof McpServer !== "function" || typeof Client !== "function") throw new Error("Required protocol SDK exports are unavailable");
const oauth = oauthProvider({ loginPage: "/sign-in", consentPage: "/connect/consent", scopes: ["stride:agent", "stride:companion", "offline_access"], grantTypes: ["authorization_code", "refresh_token"] });
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/agent-dependency-schema.json", JSON.stringify({ oauth: oauth.schema, jwt: jwt().schema }, null, 2) + "\n");
console.log("Maintained MCP v2 and OAuth provider exports verified; schema exported for review.");

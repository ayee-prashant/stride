import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { AppError } from "../domain";
import type { AgentActor } from "../delivery";
import { AgentRegistryRepository } from "./agent-registry";
import { AgentConnections } from "./agent-connections";
import { DeliveryService } from "./delivery-service";
import type { Repository } from "./repository";
import type { DeliveryOptions } from "./delivery-store";

export function createAgentServer(actor: AgentActor, repo: Repository, options: DeliveryOptions = {}) {
  const server = new McpServer({ name: "stride", version: "1.0.0" });
  const service = new DeliveryService(repo, options); const connections = new AgentConnections(repo, options);
  async function run(operation: () => Promise<unknown>) {
    try { await connections.validateConnection(actor); const value = await operation(); return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: { result: value } }; }
    catch (error) { return { isError: true, content: [{ type: "text" as const, text: error instanceof AppError ? `${error.code}: ${error.message}` : "Agent work is temporarily unavailable. Retry after reviewing your connection." }] }; }
  }
  server.registerTool("stride_get_role", { description: "Read this connection's approved responsibilities, exclusions and file scope. This does not authorize execution.", inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true } }, () => run(async () => {
    const c = await connections.validateConnection(actor); const b = await new AgentRegistryRepository(repo).binding(actor.operator_id, actor.workspace_id, actor.project_id, c.binding_id);
    return { profile_id: c.profile_id, connection_id: c.id, role_id: b.role_id, template_hash: b.template_hash, prompt: b.template_body, read_paths: b.read_paths, write_paths: b.write_paths, human_operator: b.operator_name, execution_authorized: false };
  }));
  server.registerTool("stride_initialize", { description: "Acknowledge the approved role and its explicit exclusions. Human start approval is still required.", inputSchema: z.object({ request_id: z.string().uuid(), template_hash: z.string(), accept_role: z.literal(true), accept_exclusions: z.literal(true) }).strict() }, input => run(() => connections.initialize(actor, input)));
  server.registerTool("stride_inbox", { description: "List work manually assigned to this profile and role. Ask the human operator to review a new task; do not start it automatically.", inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true } }, () => run(() => service.agentInbox(actor)));
  server.registerTool("stride_work_packet", { description: "Read an assigned work packet with approved requirements, repository facts, exact candidate, role prompt, acceptance criteria and last checkpoint.", inputSchema: z.object({ ticket_id: z.string() }).strict(), annotations: { readOnlyHint: true } }, input => run(() => service.agentPacket(actor, input.ticket_id)));
  server.registerTool("stride_claim", { description: "Claim the exact attempt already authorized by this connection's human operator. Rejects expired, stale or unapproved work. Does not return credentials.", inputSchema: z.object({ request_id: z.string().uuid(), ticket_id: z.string(), attempt_id: z.string(), packet_hash: z.string() }).strict() }, input => run(() => service.claim(actor, input)));
  server.registerTool("stride_checkpoint", { description: "Persist only the current task's progress, blockers and next steps for cross-machine recovery. Repository changes must remain within the approved scope.", inputSchema: z.object({ request_id: z.string().uuid(), attempt_id: z.string(), expected_version: z.number().int(), checkpoint: z.object({ summary: z.string(), next_steps: z.array(z.string()), changed_paths: z.array(z.string()), blockers: z.array(z.string()) }).strict() }).strict() }, input => run(() => service.writeAttempt(actor, "checkpoint", input)));
  server.registerTool("stride_submit", { description: "Submit role-specific evidence and proposals for human review. Reports are agent-reported until independently verified. Never grants QA, UAT, release or completion approval. See stride://report-schema for the required report format.", inputSchema: z.object({ request_id: z.string().uuid(), attempt_id: z.string(), expected_version: z.number().int(), submit: z.record(z.string(), z.unknown()) }).strict() }, input => run(() => service.writeAttempt(actor, "submit", input)));
  server.registerResource("report-schema", "stride://report-schema", { description: "Bounded report format and role-specific proposal rules", mimeType: "application/json" }, async uri => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ outcome: "pass | issues | blocked", summary: "What changed and why", evidence: { summary: "Reproducible evidence; distinguish reported and verified", checks: [{ name: "Acceptance check", result: "pass | fail | not_run", details: "Command or steps and actual result" }], candidate: "null for BA/SA; otherwise { repository_id: positive integer, commit: exact 40-character SHA, pull_request: positive integer }", environment: "null or exact authorized environment", artifact: "null or exact deployment artifact" }, findings: [{ title: "Issue", reproduction: "Steps", expected: "Expected result", actual: "Observed result", route: "development | requirements | architecture | operations" }], requirements: "BA: proposed requirement documents; SA: proposed design documents; otherwise []. Each {title, body}.", plan: "Only SA: up to 25 {key,title,description,acceptance:[],todo:[],requirement_ids:[],read_paths:[],write_paths:[],depends_on:[]} items. Others [].", next_action: "What the human should review next", rules: ["A pass has no open findings and no failed or unrun required checks.", "An issues report requires reproducible findings.", "A proposed plan cannot create or assign executable work without human architecture approval."] }) }] }));
  return server;
}
export async function handleAgentMcp(request: Request, actor: AgentActor, repo: Repository, options: DeliveryOptions = {}) {
  // The SDK implements 2026-07-28 body metadata and its explicit legacy adapter.
  // We expose request/response tools; no process-local subscription bus is advertised.
  const handler = createMcpHandler(() => createAgentServer(actor, repo, options), { legacy: "stateless", responseMode: "json", maxRequestBodySize: 32768 });
  try { return await handler.fetch(request); } finally { await handler.close(); }
}

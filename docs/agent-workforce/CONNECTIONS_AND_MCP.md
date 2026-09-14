# Connections, clients and MCP contracts

Status: proposed contracts. Primary documentation checked on 2026-09-14. “Documented” is not “tested with Stride.” Pin client versions and record conformance before advertising an integration.

## Connection modes

| Mode | Human interaction | Automation boundary |
| --- | --- | --- |
| Connected, attended | Receive a notice, review the packet, authorize it and ask the current agent to start | MCP reads and scoped writes; no promise of waking an idle agent |
| Assisted launch | Review and authorize; companion starts a supported fresh session | Versioned adapter and native permission handling required |
| Managed execution, later | Explicitly opt into a bounded plan/policy | Isolated runner, enforceable budgets and credentials; human result/release decisions remain |

Use remote HTTPS Streamable HTTP as the preferred MCP transport. Supply a trusted local stdio bridge for clients that cannot complete the remote auth flow. The bridge uses separately enrolled credentials from protected local storage and never emits diagnostics on its protocol stdout. [MCP defines both transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

Use a separate authenticated Stride event stream for a CLI companion and IDE extension. MCP server notifications can be an optimization for capable hosts. Do not depend on sampling, an open chat, keyboard injection or undocumented extension APIs to start arbitrary idle agents. Server notification support alone does not establish that user experience.

Negotiate MCP versions through the maintained protocol SDK and publish the tested version set. The 2025-11-25 specification is the research reference here, not a claim that every client uses it. Version Stride tool payloads and work packets separately; reject unsupported contracts with a useful reconnect/upgrade path. Apply strict input schemas, per-operation content limits and connection/project rate limits at the server.

All laptop connections are outbound. An IDE does not need a public listener. Unsupported integrations can use the browser decision queue, terminal companion and manual packet start without pretending to support automatic IDE launch.

The terminal companion supplies reliable lease renewal while an attended agent works, even when that IDE has no launch integration. A verified host adapter can supply the same function. Without either watcher, a bare MCP connection supports browse/propose operations; it does not qualify as a monitored executing agent. This distinction must be visible during setup.

## Compatibility evidence

| Client | Documented capability | Initial integration decision |
| --- | --- | --- |
| Codex CLI / IDE | Local stdio and remote Streamable HTTP MCP with OAuth; App Server has thread/turn control and approval requests | Attended MCP first; App Server adapter for launches and explicit permission responses after conformance |
| Claude Code | MCP connections; programmatic CLI/Agent SDK, structured output and SDK permission callbacks | Attended MCP first; SDK/CLI adapter must preserve permissions and user questions |
| Gemini CLI | MCP server configuration; headless text/JSON and event output | Attended MCP first; test approved launch, denials, structured progress and stop behavior |
| Google Antigravity | Official MCP documentation covers IDE, CLI and SDK surfaces | Attended MCP first; separately validate its current CLI/SDK launch and permission contracts |
| VS Code | MCP configuration, server trust and tool invocation confirmation | Build a Stride extension for notices and decision links; do not assume control of every agent extension |
| Other MCP clients | Client-specific tools/resources, transports and auth | Capability test and manual fallback; publish only verified combinations |

Primary evidence: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Claude programmatic execution](https://code.claude.com/docs/en/headless), [Gemini MCP](https://geminicli.com/docs/tools/mcp-server/), [Gemini headless mode](https://geminicli.com/docs/cli/headless/), [Antigravity MCP](https://antigravity.google/docs/mcp/), and [VS Code MCP](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

These sources justify feasible adapter paths, not identical capabilities. Do not interpret a CLI's noninteractive mode as permission to disable its approvals. If a required permission/input cannot be presented, pause or deny that operation and return a human decision request.

## Enrollment and authentication

1. A human signs in to Stride, creates a profile and chooses its operator, projects and roles. The operator must accept enrollment when another admin created it.
2. The client completes a browser authorization flow and the human confirms the exact profile/connection being enrolled. A shared OAuth client ID identifies software, not an agent profile.
3. The server stores the connection-to-profile delegation grant. Incoming tokens resolve to that persisted grant; role names or an `agent_id` argument never select identity.
4. A connection self-check verifies protocol version, tool schemas, access boundaries and claimed host capabilities. Unverified launch/stop capabilities remain disabled.
5. The companion subscribes to authorized notices. Starting work requires a separate human decision and a run claim.

Use OAuth authorization code with PKCE for compatible remote MCP clients, protected-resource metadata and audience-bound access tokens. Pre-register the initial client set; enable metadata-based registration only with validated redirects, fetch restrictions and abuse controls. Native app clients cannot keep a confidential client secret. Never forward the Stride token as a GitHub or model-provider token. [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

Preferred implementation candidate: reuse Better Auth human identity through its maintained OAuth/MCP provider integration. Its current documentation describes resource-bound tokens and MCP metadata helpers. Verify compatibility with Stride's pinned Better Auth version, database adapter, PKCE, registration model and revocation needs in Phase 0; do not hand-roll an OAuth server. The current provider docs distinguish an MCP provider configuration from separately registering a second OAuth provider. [Better Auth OAuth provider](https://better-auth.com/docs/plugins/oauth-provider).

MCP discovery/resource URLs must identify the actual backend endpoint, not a Vercel marketing redirect. Keep the existing browser session and same-origin mutation guards intact. The MCP bearer-token handler is a distinct boundary with its own origin validation, content limits and resource checks.

Multiple profiles on one laptop need distinct credentials/configuration contexts, or a trusted local broker that selects a run-bound credential outside the model's control. A globally shared MCP token cannot establish distinct agent identities merely because prompts say “DEV-1” and “QA-1.” A connection may reconnect as the same profile, but concurrent attempts still obey capacity and claim rules.

## Proposed tool surface

Names below are proposed Stride MCP tools, not commands that exist today. Every result is bounded and tenant-scoped. Prefer task-specific resources to full project downloads.

| Tool | Allowed effect |
| --- | --- |
| `stride_identity_get` | Read the credential's profile, grants and verified capabilities |
| `stride_work_list`, `stride_work_get` | Read authorized assigned work and its packet/evidence |
| `stride_ticket_propose` | Create an attributed ticket proposal with suggested role |
| `stride_plan_propose` | Propose bounded work items, dependencies and scope changes |
| `stride_work_claim` | Consume an existing human start authorization for this profile/connection |
| `stride_run_heartbeat` | Renew a current execution lease within policy |
| `stride_run_progress` | Append a concise structured progress/checkpoint report |
| `stride_run_request_decision` | Ask a human a question or request a scope/permission change |
| `stride_artifact_submit` | Register validated immutable evidence for the active attempt |
| `stride_run_submit` | Submit the contribution for review and relinquish execution capacity |
| `stride_run_block`, `stride_run_release` | Record a blocker or relinquish an attempt without success |
| `stride_handoff_propose` | Propose next work for another role within the plan boundary |
| `stride_review_submit` | Submit findings and recommendations against a candidate revision |

Human-only operations are not agent tools: enroll/grant roles, accept a plan, authorize a start, accept a result, waive an eligible gate, expand a budget, approve a release or change policy. Agents cannot sign decisions on behalf of their operators.

Every mutation carries an idempotency key and expected record version. Active-run writes also require the current attempt, packet revision and fencing epoch; the server derives identity from authentication. Request body authority fields are checked against persisted records, never trusted as grants. Bind idempotency keys to actor/tenant/operation plus a request hash.

Typed errors distinguish unauthenticated, forbidden, conflict, authorization required, superseded packet, capacity unavailable, expired lease, stale attempt, invalid evidence and rate limit. Return a permitted next action without leaking another tenant's existence. Conflict and lost lease are not blind-retry instructions.

Illustrative progress event payload, excluding credentials:

```json
{
  "event_id": "server-issued-id",
  "type": "run.progress_reported",
  "work_item_id": "server-issued-id",
  "attempt_id": "server-issued-id",
  "aggregate_version": 12,
  "packet_revision": 3,
  "summary": "Implementation submitted; regression validation remains.",
  "evidence_origin": "agent_reported",
  "artifact_ids": ["server-issued-artifact-id"]
}
```

## Adapter contract

The companion owns authorization retrieval and launch receipts. An execution adapter implements capability discovery, workspace preparation, approved start, structured event mapping, human-input requests, status and best-effort stop. Resume and usage reporting are optional capabilities, disabled until tested. Unsupported resume creates a fresh authorized attempt with prior artifacts as context.

Adapters must not manufacture progress from elapsed time, expose raw transcripts as a default, pass human browser credentials to an agent process or silently grant native tool approvals. Permission responses carry the exact native request and permitted action; a denied escalation remains denied.

Conformance cases: connect/revoke, profile isolation, manual start, duplicate launch request, stale authorization, task context loading, successful submission, tool denial, human clarification, process failure, disconnect/reconnect, cancellation and usage marked unavailable. Also test incompatible client versions and required MCP server initialization failure. Record exact binary/SDK version and evidence before enabling assisted launch for that combination.

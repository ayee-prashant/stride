# Security, authority and recovery

Status: proposed controls and verification requirements. An IDE agent with its operator's full machine access is outside the isolation boundary of Stride's server. Product claims must reflect that limitation.

## Approval model

| Decision | Authorized human | Bound to | Does not authorize |
| --- | --- | --- | --- |
| Enroll and grant access | Operator and applicable project administrator | Profile, connection, roles, projects and data permissions | Starting arbitrary work |
| Publish context / accept plan | Context steward and applicable ticket/project authority | Requirement/decision revisions, outcome, context/packet manifests, dependencies and scope | Execution by another person's agent |
| Start work | Agent operator, or explicitly delegated human operator | Profile, connection by default, work/context revisions, repository/base SHA, policy, actions, limits and expiration | Extra work, native permission escalation, acceptance, merge or release |
| Answer/change scope | Appropriate operator and outcome authority | The exact question or revised packet | Silent reuse of earlier authorization |
| Accept result | Designated human reviewer with project authority | Current work revision, artifacts, required gate results and candidate SHA | Publishing or deploying |
| Release | Designated human release authority | Exact candidate or release artifact, target environment and release evidence | Future commits or unrelated environments |

Default: every attempt needs human start authorization. A specifically enumerated bundle can authorize several frozen packets; it cannot authorize agent-created future work. Changes to material scope, repository, capability, operator, profile, policy or candidate invalidate affected decisions. Edits to display labels alone need not invalidate approval. Define material fields centrally and hash the canonical packet, not arbitrary JSON serialization.

Decision endpoints require the authenticated human channel, live membership/authority, CSRF/origin checks and expected versions. A bearer agent token cannot call them, including through alternate routes. Human OAuth consent to connect an agent is not a work approval. Neither an MCP elicitation response nor text saying “the user approved” is sufficient evidence of a Stride decision.

Initially, IDE buttons open the authenticated browser decision page. A later embedded approval surface must preserve the same human authentication and binding. Store operator credentials in the trusted companion/OS credential store; never include them in a work packet, agent environment or model-visible tool result. Require a user-presence check for high-risk decisions when that identity capability is implemented; until then, block workflows that require stronger assurance than the authenticated human session provides.

An authenticated session proves account authority, not physical human presence against a compromised computer. Attended mode cannot prevent an agent with unrestricted access from using unrelated credentials or browser sessions on that machine. Managed execution must isolate agent processes from the operator's browser profile and credential store. Do not market attended operation as an enforceable universal sandbox.

Operator removal or transfer revokes affected connections and unused approvals, fences current attempts and requires the new operator to accept enrollment. Do not silently move another person's agent credentials or decisions to a replacement owner.

## Least privilege and provenance

Effective authority is the intersection of current human delegation, project grants, profile capabilities, approved work packet and runtime constraints. Role labels and tool descriptions are never the enforcement mechanism. Revalidate persisted access and revocation on consequential operations; a valid but stale signed token alone is insufficient.

Use short-lived resource-specific access tokens, rotated refresh credentials, validated issuer/audience, restricted redirect URIs and revocable connection grants. Initial target token lifetime is five minutes, subject to the selected provider's supported contract. Revocation invalidates server access immediately through persisted state; do not wait for token expiry. Keep MCP and companion audiences distinct. Never log tokens or put them in URLs, command arguments, Git files or work artifacts.

Enrollment credentials authorize bounded discovery/proposals and consumption of an existing start grant. Run authority is additionally constrained to one active attempt. For a native MCP host, the server resolves the active attempt from its enrolled connection and validates the submitted nonsecret attempt ID/epoch. For assisted launch, deliver any narrowed credential to the trusted adapter outside the model transcript. `stride_work_claim` must not return a bearer secret as model-visible content.

Audit each write with the true actor type/ID, delegating grant, relevant human decision, record version and attempt. Display “DEV-1, operated by Prashant” instead of attributing its implementation to Prashant. System routing is a system action with a causal event; it is not an agent impersonating an administrator.

New tables and APIs must preserve workspace/project isolation. The current restricted application database role still has broad application-table privileges; it is not proof of row-level tenant isolation. Enforce scoped repositories and relational constraints, and separately constrain migration, runtime and future runner credentials. An API-append-only audit log is not tamper-proof against a database administrator.

## Untrusted content and execution

Tickets, comments, repository content, returned tool text and attachments are untrusted input. They may contain instructions to leak secrets, alter roles, skip review or execute unrelated commands. They cannot change trusted policy, role grants, the approved packet or connector configuration.

Use trusted, versioned role briefs and instruction manifests selected by humans. Pin the accepted instructions with the packet. Proposed changes to `AGENTS.md`, MCP configuration, hooks, CI or permission files require explicit policy review before adoption. A model-readable Markdown rule is useful guidance; server authorization and runtime restrictions enforce security.

Keep secrets in the relevant provider/credential broker. An agent receives only the minimum scoped credential necessary for the approved operation. No production database access or production environment secrets for general development or QA. Use disposable test data, controlled repositories and separate test credentials. Provider billing and authentication must follow supported account/API mechanisms; a user's IDE subscription is not assumed to be a reusable server API credential.

The enrollment/start review identifies the intended provider and data destination. Share only the approved packet and relevant artifacts between roles, not entire private conversations. A bare MCP credential proves connection identity, not which model receives its data. Policies requiring verified provider routing must use an adapter or managed gateway that enforces it; reported model metadata cannot satisfy that gate.

For managed execution, require an ephemeral nonprivileged runner, filesystem and egress limits, protected credential injection, resource quotas and cleanup. A Git worktree separates files but is not a security sandbox. Installing dependencies, running tests and Git hooks can execute repository code; keep that execution away from coordinator/web secrets. Reused caches must not expose another tenant's code or credentials.

Artifact uploads need size/type quotas, safe content disposition, private access and explicit provenance. Reject active HTML/executable payloads in rendered reports; display text safely. Fetch repository/CI evidence only through validated provider identities and allowlisted endpoints; reject arbitrary URL redirects, local/private-address fetches and unsafe client-metadata URLs. Verify provider webhook signatures and deduplicate deliveries.

## Quality and release gates

Context is subject to the same authorization boundary as execution. Filter retrieved material before ranking and again before delivery, apply source restrictions to summaries, and invalidate cached access on revocation. Local downloaded context cannot be remotely erased from an operator's machine; do not promise otherwise. Source pointers or manifest hashes are not access tokens.

Context publication and affected binding invalidation share a Stride transaction. A lost change notice cannot permit a stale authoritative write. GitHub changes use verified observations with explicit freshness and scope; webhook ingestion and GitHub merge are outside that transaction. Required repository protections must be verified before describing a repository as protected. A shared GitHub credential does not establish distinct agent authorship.

Retrieved notes, model summaries and copied instructions cannot publish requirements, alter scope or grant privileges. Preserve provenance, authority labels, mandatory exact criteria and uncertainty. Never promote an external code change into an accepted product requirement automatically. See [Project context](PROJECT_CONTEXT.md) for direct-GitHub and cross-machine boundaries.

Use evidence tied to the precise candidate SHA and acceptance-criteria revision. A peer agent contributes review findings; it cannot issue a human approval or override required checks. CI results must be independently retrieved/verified to receive a CI-verified label. Preserve failed and superseded reports in the timeline.

Projects may choose an independent agent review or human-only review. One profile performing both development and review must be labeled self-review. Several profiles owned by one human provide role separation, not independent human accountability. High-risk projects can require a second authorized human. If one is unavailable, the gate remains blocked; the system does not invent an approver.

A scoped policy can permit human overrides of selected advisory gates with a recorded reason. Integrity, membership, required independent authorization and exact-version binding are not waivable by a normal result reviewer. A risk downgrade is itself a policy/scope decision; an agent cannot downgrade its own work.

Merge and deployment use separate GitHub/provider authority, protected checks and a human decision. The initial product may track a manually executed authorized release. A later execution broker must check approval against the exact merge/release artifact. Rebase, squash or any changed release artifact requires validation of that actual candidate; do not treat a reviewed branch name as immutable evidence. Attended agents using their own external credentials can act outside this broker; Stride cannot enforce protections those systems have not configured.

## Failure and recovery contract

| Failure | Required behavior |
| --- | --- |
| Two agents claim the same work | Transaction and unique constraints select one attempt; other receives conflict/capacity status |
| Human approval response is retried | Idempotency returns the same decision; no duplicate run |
| Start response is lost | Companion reconciles its durable attempt receipt; no second process is launched speculatively |
| Agent/IDE is offline | Queue persists; owner sees waiting state; no transfer of the old authorization |
| Lease expires | Fence future writes and quarantine late outputs; require an authorized recovery attempt |
| Human revokes, archives or cancels | Immediately revoke server authority; request physical stop and show requested/stopped/unknown accurately |
| Agent asks a question | Persist a decision request; pause affected work; never infer approval from silence |
| Scope or policy changes during work | Revoke affected authority, request a checkpoint/stop, and require revised authorization |
| Review rejects the contribution | Preserve evidence and findings; create revised work with bounded retry budget |
| New commit arrives after QA | Invalidate candidate approvals and rerun affected gates |
| Parallel branches conflict | Integration owner resolves in a new candidate; earlier branch evidence is insufficient |
| Event delivery repeats or arrives late | Deduplicate and apply monotonic versions; reconcile snapshot on replay gaps |
| Coordinator crashes after an external effect | Recover using the operation receipt/provider status; do not promise exactly-once external execution |
| Provider quota/cost limit is reached | Pause and inform the operator; no automatic switch of provider or unapproved spend |
| Agent proposes recursive work | Enforce accepted-plan scope, depth, count, concurrency and handoff limits |

Logical revocation can be immediate while stopping an attended process is best effort. A lost lease cannot erase files already changed locally. Preserve suspect outputs in an isolated branch and reconcile before another attempt. Brokered repository credentials must reject stale runs; locally retained personal credentials remain outside Stride's control.

Initial plan limits: at most 25 work items, dependency depth 8, two rework cycles before human replanning, five active attempts per workspace and one per profile. Time limits apply even when monetary usage is unavailable. Report unknown subscription billing as unknown. A hard spend cap is a managed-gateway capability, not a promise based on a client estimate.

Store structured progress and decisions, not full hidden reasoning. Proposed retention defaults: 90 days for detailed operational events and one year for accepted result/release evidence, configurable by workspace policy. Minimize personal data, define deletion/export behavior, and preserve necessary parent-child references without retaining raw logs indefinitely. Confirm production backup schedule, retention and a recovery drill before expanding the pilot; a one-off restore test is not a backup policy.

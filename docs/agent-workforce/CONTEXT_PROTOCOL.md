# Context protocol and MCP revision

Status: proposed application contracts. Research baseline corrected to MCP **2026-07-28** on 2026-09-14 after the user supplied the current transport specification. Client/SDK compatibility with this revision is still an implementation gate.

## MCP transport corrections

The current transport model separates protocol messages from persistent application state. Each request carries protocol metadata, and clients initiate RPC requests. Stride's profile, connection enrollment, attempt, context snapshot and permission records remain durable application identities. They must not depend on an MCP protocol session. [Transport overview](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports).

The revised Streamable HTTP binding uses POST with JSON or request-scoped SSE responses. It removes the standalone GET stream, protocol session IDs and `Last-Event-ID` stream resumption. Validate mirrored method/name/version headers against the body using the maintained implementation. [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http).

Modern requests carry their version independently; there is no initialization handshake. A compatibility adapter can explicitly support the older handshake-based era. Recognized modern validation errors must not be treated as a reason to downgrade. Record client protocol support separately from its model/vendor identity. [Versioning and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning).

For modern change notices, use `subscriptions/listen` and supported resource-update filters. Check the acknowledged filter, re-establish subscriptions after reconnect and correlate notifications with the subscription ID. A subscription provides an update hint; Stride still reads its durable event cursor or a current snapshot after disconnection. [Subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions).

Sampling, elicitation and roots requests use the multi round-trip pattern rather than independent server-initiated RPC requests. This does not authorize agent work or certify a human decision. Native vendor interfaces such as Codex App Server are separate protocols and retain their own documented permission contracts. [Multi round-trip requests](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr).

HTTP response-stream closure cancels that MCP request. Cancelling a context read or subscription does not cancel a durable Stride attempt. Attempt stop/release is an explicit application command; if a mutation already committed before disconnection, reconcile its idempotency receipt instead of assuming rollback. Apply the correct cancellation behavior for the negotiated protocol and transport. [Cancellation](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation).

OAuth remains separate from per-request client metadata. Verify the issued token and persisted enrollment grant. Update conformance for current resource metadata, issuer validation and client-registration rules; support legacy dynamic registration only where required by a tested client. Client-provided capabilities or identity metadata do not grant roles. [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

## Notification and execution boundaries

Prefer standard modern subscriptions for work/context resource changes where a client supports them. The companion can be such a subscriber; it still supplies OS/IDE notices, run monitoring and supported launch/stop handling. A subscription cannot guarantee that a particular idle model session will act on a notice.

Keep a recipient-scoped application catch-up API, with optional application SSE/polling fallback for older clients and the human UI. Application cursors are not MCP `Last-Event-ID` semantics. All transports project the same durable outbox; do not build independent authorities for MCP notices and browser notifications. Agent credentials receive only agent-visible notices; the human decision queue uses separate human/companion grants.

Expose an authorized stable context resource URI using opaque project IDs. Reading it resolves the current immutable manifest; changes notify subscribers that they should refetch. A snapshot URI identifies an immutable version but still requires current access. Avoid putting ticket text, secrets or personal data in resource URIs or mirrored headers.

## Proposed context tools

These names are application proposals, not implemented tools. Read operations do not grant execution. All responses obey current tenant/project/source permissions and content limits.

| Tool | Contract |
| --- | --- |
| `stride_context_get` | Return the authorized project brief or selected work packet, manifest, required inputs and freshness state |
| `stride_context_search` | Search permitted facts/documents/work; include exact sources, branch/revision and provisional/accepted labels |
| `stride_context_validate` | Check a manifest/binding against current material versions and required repository observations; return changes and allowed next action |
| `stride_context_changes` | Read bounded durable changes after an application cursor, or request a snapshot resync |
| `stride_context_acknowledge` | Record this connection's declared adoption of a manifest; does not approve scope or prove comprehension |
| `stride_context_propose` | Suggest a new/corrected requirement, decision or discovered fact with evidence and affected scope |
| `stride_checkpoint_submit` | Persist a bounded handoff linked to an attempt and immutable code/artifact references |

Existing `stride_ticket_propose`, `stride_plan_propose` and `stride_handoff_propose` include the context receipt, source references and duplicate candidates considered. Human acceptance revalidates these against current state. A context proposal can also link an existing ticket instead of producing another one.

Claims and active-run mutations bind to the current material context version. Treat a manifest ID/hash as a reference, never a bearer capability. Construct authority from the enrolled connection, run grant, live permissions, packet revision and current fencing state.

## Manifest contract

Store the full internal project snapshot separately from the least-privilege task manifest delivered to an agent. The manifest contains:

- Schema version, project snapshot ID and work/plan/packet revisions.
- Requirement and acceptance-criterion IDs with exact revisions.
- Adopted decision/policy and consumed interface versions.
- Repository identities and exact commit pins, candidate SHA if reviewing, and source observation generations/times.
- Included resource IDs, hashes, provenance, authority type and mandatory/optional status.
- Relevant active-work/conflict references and declared unknowns.
- Required input completeness, content budget and permitted deferred references.
- Material context binding version, policy/permission epoch and validity result.
- Canonical manifest digest and server-created issuance time.

The canonical digest uses a versioned serialization contract with explicit ordering and hash algorithm. It detects a changed manifest; it does not prove facts correct or authenticate its author. Authenticated transport and server records establish provenance. Do not expose inaccessible source IDs, snippets or result counts through filtered manifests.

Use separate state axes rather than a misleading universal “synced” flag:

| Axis | Values |
| --- | --- |
| Input completeness | `complete`, `incomplete` |
| Material alignment | `aligned`, `advisory_change`, `revalidation_required`, `revoked` |
| Source observation | `verified`, `refreshing`, `unavailable`, `conflicted` |
| Adoption | `not_prepared`, `prepared_by_adapter`, `delivered`, `acknowledged_by_agent` |

An ordinary new claim requires complete inputs, aligned material context, verified mandatory sources, a context preparation/adoption receipt and a live human start grant. For attended work the agent acknowledges the packet; for a fresh assisted session the trusted adapter records the exact packet prepared for injection into that session. These receipts retain their distinct actors and meanings. An advisory change can retain alignment only through a recorded no-material-impact determination. Important uncertainty fails the readiness gate. `verified` means verified at the stated observation generation/time, not knowledge of every instantaneous external change. Existing runs during a source-only outage follow the bounded rule in [Project context](PROJECT_CONTEXT.md).

## Start, change and resume sequence

1. Resolve the enrolled profile and allowed project/work. Reconcile the relevant repository refs and indexed source coverage.
2. Assemble immutable context and show the human the objective, scope, source freshness and conflicts.
3. The operator authorizes the packet. The companion verifies its isolated checkout and reports the selected revision; unexpected dirty work or a different base prevents launch without destroying local files.
4. The attended agent acknowledges mandatory context, or the trusted adapter records the packet prepared for a new session. Atomically validate current material bindings, authorization and lease capacity before creating the attempt. A change between steps 2 and 4 produces a conflict and revised decision, not execution against a silent substitute. A new assisted session receives that exact packet as initial task context after the claim.
5. Subscribe to context/work hints. Use durable catch-up plus validation on reconnect and consequential writes; renewal of a run lease is not acknowledgement of new context.
6. An accepted material change increments affected binding versions and fences old authority in the same Stride transaction as publication. Emit notices after commit. Uncertain impact sets affected work to revalidation; it cannot be silently declared irrelevant.
7. Checkpoint local work without promoting it as current evidence. Show the operator the change and create the necessary revised packet/authorization.
8. On a different machine, retrieve the published checkpoint and current packet. Authenticate/enroll that connection and obtain a new attempt authorization; never reuse the old connection's credential or lease.
9. Submission validates context, observed code and the evidence candidate again. If code was pushed directly, associate it only after verification and retain external-change attribution where appropriate.

Packet preparation is deterministic and does not require launching an LLM before claim. The adapter records actual delivery separately after launch, and stops or blocks submission if it cannot deliver required context. The agent can then record its own acknowledgement. None of these receipts proves comprehension. Never auto-launch a shell-enabled coding session merely to obtain a pre-start acknowledgement; the host's local execution limitations remain visible.

## Admission and proposal races

Inside a transaction, verify expected work revision, current material binding, live permission epoch, required-source observation version, operator grant and available capacity. The accepted proposal/attempt event uses the same committed versions. External GitHub reads cannot join that transaction; the observation generation and repository-mode guarantee must be explicit.

If a required source changes during packet assembly, return a retryable version conflict without creating a partial grant. If two proposed requirements conflict, retain both pending proposals and require a human resolution. If two proposals describe the same exact gap, return the existing candidate according to the defined fingerprint rule; semantic similarity alone cannot collapse distinct requirements.

## Verification contract

Required scenarios: cold start with no chat history; stale local instruction; relevant versus unrelated context updates; mixed source generations; two concurrent requirement approvals; duplicate ticket proposals; source denial after caching; poisoned retrieval; mandatory-context overflow; external PR or direct push; delayed/missed/repeated webhooks; offline handoff with unshared edits; lost subscription with catch-up; and source-only outage during valid work.

For modern MCP, test per-request metadata/header consistency, no session dependence, subscription acknowledgement/filter behavior, reconnection without MCP stream replay, multi round-trip handling where used, and transport cancellation distinct from attempt stop. Test supported legacy clients through their explicit compatibility adapter. A failed protocol conformance test disables that combination; it does not relax context or human approval gates.

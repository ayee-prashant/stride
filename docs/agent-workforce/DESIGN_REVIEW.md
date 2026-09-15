# Design review and decision record

Reviewed: 2026-09-14. Method: inspect existing source boundaries, check primary protocol/client documentation, walk the human and agent flows, then review adversarial and failure cases. This is a design review by the author, not an independent security audit or an executed integration test.

Revision 2 incorporates the user's cross-machine context requirement and correction to the MCP 2026-07-28 transport baseline. Shared context/source reconciliation now precedes execution features in delivery. The original design did not sufficiently specify project-wide authority and context publication; PROJECT_CONTEXT.md and CONTEXT_PROTOCOL.md supply those missing contracts.

Revision 3 incorporates the human BA-to-production loop, manual profile assignment for this release, explicit role initialization/exclusions, deterministic role prompts, QA/UAT rework and evidence-based process metrics. The previous deterministic automatic profile-selection proposal is superseded by human selection. This revision is a documentation/design change; it does not enable those runtime features.

## Requirement coverage

| User intent | Chosen design |
| --- | --- |
| One or many connected agents | Stable profiles, separate connections/attempts and default capacity of one per profile |
| Unique ID/profile per agent | Server-issued identity bound to enrollment credentials; model names are descriptive metadata |
| Codex, Claude, Gemini, IDE/CLI/Antigravity | MCP connection contract, portable companion, tested vendor adapters and explicit compatibility labels |
| Architect, developers, testers and peer reviewers | Configurable role presets with independent permissions and scoped work packets |
| Agents propose tickets and profile recommendations | Attributed proposals and bounded accepted plan work; humans manually select profiles; no self-authorized scope expansion |
| Automatic trigger when assigned | Automatically deliver an offer to the operator; execute only after the separate required start decision |
| A human behind each agent | Mandatory operator, enrollment acceptance, revocation/transfer rules and attributable decisions |
| Human review in the IDE | Concise IDE/terminal notice, authenticated review link, supported launch or explicit manual start |
| Professional development hierarchy | Accepted BA/solution baseline; manual assignment/start; candidate-bound engineering/QA/UAT gates; separate release and production closure |
| Explicit responsibilities and outside-role scope | Eleven specialized prompts, common base, initialization record and intersected read/write/execute grants |
| Next-ticket prompts and future process analysis | Deterministic reviewed handoff drafts; attributed events, wait/rework/quality metrics and human-adopted improvement proposals |
| Human-readable progress and responsibility | Outcome board, contribution panel, decision queue, evidence labels and a named next action |
| Ease of doing tasks | Keep title/project creation, avoid per-tool notices, allow explicit approval bundles and human-only review fallback |
| Entire project context across machines | Versioned requirement/decision authority, verified repository observations, relevant immutable work manifests and structured checkpoints |
| Agents already have GitHub access | Independent GitHub ingestion and reconciliation, external-change attribution and explicit observed/protected repository guarantees |
| Work only on what is needed | Requirement/evidence links, current scope and related-work lookup, duplicate intake and human acceptance of new requirements |
| Private context belongs to each agent | Local context stays local; share deliberate findings and handoffs; no assumption of shared chat or model comprehension |
| Optional OpenRouter/API access | Core context functions are deterministic; existing agents can assist; optional model suggestions cannot publish authority |
| Current MCP transport revision | Modern per-request metadata/subscriptions/MRTR/cancellation with explicit legacy compatibility and durable application recovery |

## Corrections made during review

1. **A connection is not a launcher.** Kept MCP tools/context separate from companion notifications and vendor session control. Documented manual fallback and the difference between documented and tested support.
2. **An LLM is not a heartbeat scheduler.** Required a companion or verified host watcher for monitored attempts; a bare MCP connection can browse/propose. Long-running tests cannot depend on a model remembering lease renewal.
3. **Agent work must not impersonate a human.** Existing task/activity foreign keys reference human users. Added actor-aware work items and ticket proposals instead of calling old mutations with an operator ID.
4. **UI-only approvals are bypassable.** Required the task-completion guard on direct, bulk, recurrence and alternate server paths for tickets with agent work.
5. **Review dependencies could deadlock.** Distinguished submitted candidate, verified CI and human acceptance dependencies so QA/review can run before the acceptance that needs their evidence.
6. **An approved branch can change.** Bound QA, review and release to revisions/artifact hashes; new commits, rebases and changed release artifacts need fresh applicable evidence.
7. **Duplicate delivery can launch duplicate work.** Added transactional claims, active-attempt uniqueness, fenced writes, request-hash idempotency and durable local launch receipts. External effects remain at least once unless their own receipt contract proves otherwise.
8. **A Stop button cannot guarantee an offline process stopped.** Separated immediate server revocation from best-effort attended termination, with explicit unknown status and late-output quarantine.
9. **Multiple profiles do not prove independence.** Kept operator ownership visible and made same-agent review explicit. Higher-risk second-human requirements stay blocked when no approver exists.
10. **MCP identity cannot attest a model or secure an entire laptop.** Documented provider-reporting and attended-execution limits. Strong routing, isolation, spend and release controls require verified adapters or managed infrastructure.
11. **A universal hierarchy adds unnecessary work.** Made architecture/specialist stages conditional and started with one end-to-end human/agent contribution before the multi-role workflow.
12. **Local credentials cannot enter the model transcript.** Narrowed claim responses to nonsecret attempt metadata and routed any runtime credentials through trusted transport/adapter code.

## Context and protocol review

1. **Code and accepted intent have different authorities.** GitHub changes are verified facts, while a human publishes accepted requirement/decision revisions. A merged implementation cannot silently rewrite product intent. Generated requirement exports are not a second writable source of truth.
2. **Global context is not a giant shared chat.** Relevant task manifests reference exact source versions, required context and related work. Local conversations remain private and disposable; a fresh machine resumes from structured evidence.
3. **Context refresh cannot silently change approved work.** Material binding checks run at claims, submissions, handoffs and acceptance. Publishing an accepted material change invalidates affected bindings transactionally; unknown impact requires revalidation, and unrelated changes do not restart every agent.
4. **Direct GitHub access creates gaps in observation and attribution.** Webhooks need reconciliation and refresh generations. A shared GitHub credential cannot identify distinct agents. Repository protection, context checking and a future merge broker have different guarantees; a green check does not make GitHub and Stride atomic.
5. **Semantic search cannot decide truth or completeness.** Mandatory criteria/policy come from explicit links, inaccessible sources are filtered before retrieval, summaries inherit source restrictions, and incomplete indexes stay labeled incomplete. No mandatory input is silently truncated.
6. **A claim-before-context or context-before-launch loop would be unsafe.** Deterministic adapter packet preparation can precede claim without launching a model. Agent acknowledgement and adapter delivery are separate receipts; neither proves comprehension. Assisted code execution still follows authorization and claim.
7. **Missing local work cannot be invented on another machine.** Handoffs distinguish published commits/patches from unavailable unshared edits. Resume preserves dirty checkouts and uses a new connection/attempt authorization.
8. **New work needs justification and race handling.** Proposals cite requirements or declare new scope, carry evidence and check existing work/PRs. Exact duplicates can be linked deterministically; ambiguous matches and conflicting requirement updates remain human decisions.
9. **The older MCP reference affected behavior, not just citations.** Adopted modern request metadata, subscriptions and multi round-trip semantics; removed assumptions of protocol sessions or MCP stream replay. Cancelling a subscription is distinct from stopping a durable attempt. Current protocol support is still untested for each vendor/SDK combination.
10. **A mandatory coordinator LLM would not solve consistency.** Keep publication, permission, packet assembly and invalidation deterministic. Optional API generation must cite sources, retain provenance, respect provider/data limits and fail without blocking core work.

## Human-approved delivery review

1. **Submission is not completion.** Developer submission enters review. Report acceptance, quality-gate outcome and release authority are different records; a valid report recording failure cannot pass the gate.
2. **QA failure cannot advance to UAT.** Human triage routes implementation defects to dev, intent gaps to BA, design gaps to SA and environment failures to ops. Repaired candidates repeat required review/QA/UAT; repeated rework reaches human replanning.
3. **UAT belongs to the business human.** Agents provide scenario evidence. UAT acceptance prepares a separate release decision; verified deployment plus human closure satisfies software-delivery Done.
4. **Manual selection is explicit.** An architect recommends; a human selects; the profile's operator authorizes. Busy/offline/declined work remains queued until human action. Assignment automation is deferred.
5. **A role file is not an access grant.** Base and role templates are human-adopted versions; each packet lists read/write/execute limits and exclusions. One active role per attempt prevents silent changes of responsibility.
6. **Generated handoffs cannot authorize themselves.** Deterministic assembly pins accepted scope and reviewed source evidence. Unresolved required inputs block readiness; untrusted upstream instructions cannot rewrite policy.
7. **Keep human tickets legible.** One outcome ticket contains role work items, attempts and findings. Delivery stage and waiting reason are additive; preserve the existing global task enum and simple legacy flow.
8. **Activity is not productivity.** Audit distinguishes reported, observed, verified and human-decided events. Metrics expose waits, quality, rework and evidence limitations; process changes remain human proposals.

See [delivery contract](HUMAN_APPROVED_DELIVERY.md), [role catalog](ROLE_CATALOG.md), [handoffs](PROMPT_HANDOFFS.md) and [audit/metrics](AUDIT_AND_METRICS.md).

## Architecture decisions

| ID | Decision | Reason and consequence |
| --- | --- | --- |
| AW-ADR-01 | Human-owned outcome plus agent work items | Keeps the board readable and preserves existing task identity/history; requires a guarded completion seam |
| AW-ADR-02 | Attended execution first | Fits existing IDE subscriptions and human review expectations; does not promise unattended control of every client |
| AW-ADR-03 | MCP plus a notification/lifecycle companion | Portable tool access with reliable contact and notices; one small local component is required for monitored runs |
| AW-ADR-04 | Explicit start/result/release decisions | Prevents assignment or handoff preparation from becoming execution authority; creates a human decision queue |
| AW-ADR-05 | Modular monolith, PostgreSQL outbox, continuous coordinator | Reuses deployed foundations without using the reminder cron as a realtime scheduler |
| AW-ADR-06 | Isolated attempts and exact-candidate evidence | Makes concurrent contribution and rework understandable; requires integration ownership and invalidation rules |
| AW-ADR-07 | Extend maintained authentication | Avoids a custom OAuth implementation; pinned integration compatibility remains a Phase 0 gate |
| AW-ADR-08 | Authority by information type and immutable context manifests | Separates accepted intent, observed code and local hypotheses; supports precise invalidation and cold starts |
| AW-ADR-09 | GitHub ingestion independent of agent reporting | Handles direct changes; requires explicit freshness, coverage and credential/agent attribution limits |
| AW-ADR-10 | Current MCP plus application-owned recovery | Supports modern subscriptions while keeping project state, cursors and run identity independent of transport |
| AW-ADR-11 | No mandatory context LLM | PostgreSQL records, indexed links and deterministic assembly suffice for correctness; model assistance remains optional and evaluated |
| AW-ADR-12 | Manual profile assignment with scoped operator start | Human selection matches the first-release requirement; recommendations do not execute work |
| AW-ADR-13 | Versioned software-delivery policy alongside role work items | Adds QA/UAT/release evidence and closure guards without multiplying global task statuses |
| AW-ADR-14 | Adopted role templates and deterministic handoff drafts | Makes responsibilities, exclusions and required inputs reviewable; prompts do not grant permissions |
| AW-ADR-15 | Attributed audit and evidence-based process proposals | Supports later analysis without treating model activity or self-reports as proven productivity |

## Implementation uncertainties with an owner and next action

| Uncertainty | Resolving work | Safe default |
| --- | --- | --- |
| OAuth/MCP provider compatibility with the pinned app | AW-001, authentication implementer | No agent writes until conformance passes |
| Each client version's auth, launch, question and stop semantics | AW-002, adapter implementer | Attended MCP plus watcher; no unsupported assisted-launch claim |
| Approved human input under a particular IDE security model | AW-003/AW-202, client/security implementer | Browser decision surface; preserve native permission denial |
| Persistence and notification schema integration | AW-004, data/application implementer | Additive actor-aware records; no human impersonation |
| Pool and stream capacity on the chosen deployment | AW-402, platform implementer | Conservative pilot limits and bounded event replay |
| Production backup/retention policy | AW-401, platform operator | Confirm before broader operational rollout |
| Provider usage reporting and enforceable cost controls | AW-404/AW-405, runner implementer | Show unavailable estimates honestly; enforce time limits |
| Modern MCP SDK/client behavior and auth compatibility | AW-001/AW-002, protocol implementer | Test each revision explicitly; disable unsupported combinations without weakening guards |
| Source authority and material-change classification | AW-005/AW-107, context implementer | Required links plus conservative revalidation for unknown impact |
| GitHub protection availability and direct-write detection | AW-006/AW-106, integration implementer | Observed mode until actual settings/checks are verified |
| Cold-start recovery, mandatory context size and proposal races | AW-007/AW-108, application implementer | Block incomplete packets; preserve explicit missing-work state and uncertain duplicates |

These are implementation gates with chosen fallbacks, not unresolved product questions requiring another planning meeting. Default decisions are specified so work can proceed in the delivery order.

## Review outcome and validation limits

The revised architecture is sufficiently specified to begin Phase 0 and the first vertical slice. It establishes identity, project-context authority, source observation, state transitions, integration boundaries, delivery order and observable acceptance. It does not establish that integrations are already working, that a security certification exists or that performance targets have been measured.

The earlier revision-2 change contained Markdown only. Its local checks passed for document links, code-fence balance and trailing whitespace across 13 design/template documents and the two repository entry documents. That revision's delivery plan had 33 distinct proposed ticket IDs. The entry-document diff was reviewed for scope and preservation of authority rules, and current MCP references were checked. No application build, provider run, load test or deployment is claimed for this design change. Product implementation must pass the repository's actual test/build/release gates for its own immutable source version.

Revision 3 adds the delivery/role/prompt/audit contracts and updates existing routing, plan and template references. Its validation record is documented in the associated design pull request. No new application tests, build, provider execution, deployment or independent security audit are claimed for this documentation refinement.

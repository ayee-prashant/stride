# Prompt assembly and role handoffs

Status: proposed contract. The Markdown templates are authored; packet generation, claims, notifications and transition enforcement still require implementation.

## Deterministic assembly first

A prompt is a presentation of approved work, not an authorization token. No new model API is necessary to generate it.

Assemble in this order:

1. Human-adopted [base prompt](templates/roles/BASE.md), exact version/hash.
2. Exactly one human-adopted [role template](ROLE_CATALOG.md), exact version/hash.
3. Approved ticket and role work-item revision: outcome, criteria, exclusions, TODOs and required output.
4. Relevant immutable context manifest: requirement/decision revisions, source identity/freshness, repository/base or candidate SHA, applicable policy and dependencies.
5. Reviewed upstream artifacts, findings and structured checkpoints, labelled by origin and acceptance state.
6. Current access constraints and execution limits from server policy.
7. Human review surface, followed by a separately recorded start authorization bound to the complete packet.

Required inputs cannot be silently truncated to fit a prompt. Missing sources, unresolved placeholders or access failures make the packet blocked. Use links with exact authorized versions plus the required scoped excerpts; a live branch URL alone is insufficient. Keep unrelated project history and full private chats out of the packet.

Template instructions and retrieved content have distinct trust. Text in a requirement description, repository file, test report or upstream agent response cannot override role boundaries, permission checks or human gates. An LLM-proposed TODO, scope change or policy instruction is provisional until the appropriate human adopts it.

Render a draft for human inspection before execution. Pin template hashes, input manifest, expected record versions and approved actions. Changing any material component invalidates the unused start decision. Preserve old packets for audit. See [work packet](templates/WORK_PACKET.md) and [initialization](templates/ROLE_INITIALIZATION.md).

## Which event prepares the next packet?

| Recorded event | Draft produced | Human gate before work |
| --- | --- | --- |
| Accepted BA baseline published | Architect packet using accepted intent | Technical human selects profile; operator authorizes |
| Accepted solution and bounded plan | Developer packets for approved, unblocked contributions | Human selects each profile; operator authorizes |
| Developer submits candidate | Peer/engineering-review packet | Human assigns any review agent and authorizes its use |
| Engineering human admits candidate to QA | QA packet with required criteria and exact candidate | Human selects QA profile; operator authorizes |
| QA human accepts evidence | UAT environment-preparation packet | Environment human authorizes exact promotion; operator authorizes any ops agent |
| UAT candidate deployment verified | UAT packet with business scenarios and manifest | Human selects UAT profile; operator authorizes |
| QA/UAT finding receives human disposition | Rework draft for developer, BA, architect or operations | Responsible human accepts scope; operator authorizes |
| Business human accepts UAT | Release-preparation packet and release-decision request | Release preparer is manually assigned; execution has separate release authority |
| Release verified and human closes outcome | Documentation/closure draft only if included in accepted plan | Human reviews any remaining contribution; no scope expansion |

Preparing a packet does not assign a profile, start an agent, accept a result or deploy. For downstream work already included in an approved plan, Stride can materialize that work item idempotently after its dependency becomes available. New work outside the plan is a proposal.

Key generation by project, workflow version, originating event, target work-item revision and template/input digest. A retried event must not create another ticket, packet or notification. Supersede stale drafts explicitly. Limit fan-out and rework according to the accepted plan; use the existing pilot bounds in the delivery plan.

## Agent submission contract

All role templates return this human-readable structure, with machine fields using the same meaning:

| Field | Required content |
| --- | --- |
| Identity | Server-bound project/ticket/work/attempt/profile/active-role references; claimed values are checked, never trusted as authority |
| Packet | Packet and template versions; relevant requirement/criterion revisions; candidate or artifact identity |
| Submission state | submitted, blocked or failed; never human_approved, accepted or done |
| Recommendation | ready_for_review, pass, fail or inconclusive; role-specific explanation |
| Summary | What was actually produced, changed or observed |
| Criterion evidence | One row per required criterion: demonstrated, failed or not_checked; exact evidence reference and origin |
| Checks | Commands/scenarios actually executed, target/revision, result, timestamps and report links; explicitly list tests not run |
| Findings | Stable finding IDs, expected/observed behavior, affected criterion, reproduction, severity recommendation and scope impact |
| Artifacts | Remotely available immutable output references; distinguish local/unshared work |
| Boundary declaration | Any request outside the role, scope or access; what was left untouched and which role should handle it |
| Human decision requested | A precise accept/change/clarify/risk-disposition request addressed to the configured human role |
| Proposed next step | Receiving role and bounded suggested TODOs; explicitly unassigned and unauthorized |
| Checkpoint | Completed work, remaining work, source pins and safe recovery notes without private reasoning or secrets |

Test outcomes reported by an agent remain agent-reported until verified through the appropriate evidence integration. PASS does not hide not_checked required criteria: required missing evidence yields inconclusive. A human may reject a factually complete report or accept a report recording failure as valid evidence; accepting that report does not make the delivery quality gate pass. Store report acceptance, gate outcome and release permission separately.

The server validates the actor, live grant/lease/fencing epoch, schema, artifact limits and current revisions before recording submission. A late or revoked attempt cannot promote its output. Humans see the rejected/stale evidence status without granting renewed access to its author.

## Finding-to-rework example

Illustrative only; this does not request implementation or claim a test was run.

A ticket requires AC-042.2: "A reader cannot edit a project description." QA reports FIND-042-01 against the actual recorded candidate: a reader update unexpectedly succeeds. The report includes permitted test evidence and expected/observed behavior. The engineering human classifies it as an implementation defect.

The generated developer draft says:

> Active role: Developer. Implement only the accepted permission behavior for AC-042.2. Investigate FIND-042-01 using its approved reproduction. Add the smallest meaningful regression check for the reported failure. Preserve the other accepted criteria. Submit the exact new candidate, commands actually run, result links and remaining risks. Do not change the role policy or acceptance criterion, close the finding yourself, merge, deploy or claim QA approval. Missing candidate, evidence, access or authorization means blocked.

The complete packet must resolve the exact ticket, requirement revision, finding, allowed files, candidate/base, human owner, limits and start decision before execution. It is then manually assigned and authorized. A new candidate triggers required engineering review and QA again. QA tests the fix and affected regression; the responsible human closes the finding. UAT follows only after the QA gate passes.

## Optional model assistance

Existing connected BA/architect agents can propose clearer descriptions, test scenarios, duplicate matches or handoff summaries. An optional OpenRouter/other API may later assist under a separate data-access and spending policy.

Model output never selects authoritative context, permissions, human approvers, ticket acceptance or gate outcomes. Preserve source links, mark uncertain inference and require human review for adopted scope/template changes. Deterministic operation remains available when a model is unavailable.

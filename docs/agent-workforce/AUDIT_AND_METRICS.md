# Delivery audit and process metrics

Status: proposed application contract. Existing task activity is not yet this complete agent audit ledger.

## Events are evidence of distinct actions

Record proposal, baseline publication, plan acceptance, assignment/decline/reassignment, authorization/expiry/revocation, attempt claim/start/pause/resume/stop/lease loss, checkpoint, artifact submission, finding/disposition, human report review, gate decision, candidate change, context invalidation, environment promotion, deployment verification and closure/reopening.

Keep an agent's reported action separate from a server-observed transition, CI-verified check and human decision. A connected IDE, heartbeat or confident message cannot establish that coding or testing happened.

| Event field | Meaning |
| --- | --- |
| event_id, schema_version | Stable identity for replay/deduplication and versioned interpretation |
| workspace_id, project_id | Authenticated tenant scope; include composite references where relevant |
| ticket_id, work_item_id, attempt_id | Outcome and contribution being changed; null only where legitimately not applicable |
| aggregate_version, sequence | Compare-and-swap ordering for this aggregate, not a fictitious global ordering across all systems |
| event_type, from_state, to_state | What happened; a report event need not change workflow stage |
| actor_kind and actor references | human, agent or system; profile, connection, active role and responsible operator where applicable |
| recorded_at | Trusted server/database UTC time for audit and application duration calculations |
| reported_occurred_at, source | Optional client/provider time with provenance; never trusted to reorder approvals or extend leases |
| request_id, idempotency_key, correlation_id, causation_id | Operation retry identity, linked delivery flow and causal predecessor |
| packet/template/context/policy revisions | Exact approved inputs, including material context manifest and permission epoch |
| requirement/criterion references | Why the work exists and which accepted versions it demonstrates |
| candidate/artifact/environment references | Exact immutable software and observed target, when relevant |
| decision/recommendation and reason | Separate human decision, agent recommendation, policy evaluation and finding disposition |
| evidence references and origin | Bounded private reports, verified CI/GitHub evidence, human evidence or explicitly agent-reported facts |

Persist a consequential transition, its event and outbox entry in the same transaction. Reject stale expected versions and record safe denial metadata separately without exposing inaccessible resources. External operations have a requested record, an operation receipt and observed result; a "requested" event is not deployment success. Network uncertainty remains unknown until reconciled.

Use application receipts and at-least-once delivery with idempotent consumers. Duplicate notifications do not mean duplicate starts or releases. Server transitions use database time; client clock changes cannot alter authoritative durations. The full lease/recovery rules remain in [architecture](ARCHITECTURE.md).

## Human timeline and investigation

The default ticket timeline shows a concise sequence such as "Requirement approved by product owner", "DEV-1 submitted candidate", "QA reported two findings", "Engineering human requested rework", and "UAT accepted by business owner". Each row expands to exact evidence, inputs, actor and duration. Show who must act next, why the item is waiting and whether a result is current, stale or unverified.

Do not dump every tool call into the main timeline. Store approved, bounded execution logs as separate private evidence with retention limits; reference them from relevant events. Log starts, stops and outcomes without hidden reasoning, full private conversations, credentials, bearer tokens or unfiltered environment dumps.

An audit table being append-only in application code is not cryptographic tamper proof. Restrict write/update permissions, audit administrative corrections as new events and back up evidence under existing recovery rules. Corrections supersede records instead of rewriting decisions. If stronger tamper evidence is later required, design and verify it explicitly.

## Useful first metrics

| Metric | Calculation and interpretation |
| --- | --- |
| Assignment wait | Eligible contribution to human selection; separate no-capable-profile from busy/offline and human queue time |
| Operator wait | Assignment offer to approved start or decline; expired offers stay visible |
| Execution elapsed | Server-observed running intervals per attempt, excluding recorded pauses; measures occupancy, not thinking time or productive computation |
| Review wait | Submission to human decision; distinguish time gathering missing evidence |
| External wait | Recorded dependency, CI, environment or clarification intervals; report unknown when not instrumented |
| First-pass QA / UAT | Eligible first tested candidates that satisfy the gate without rework; show counts, exclusions and sample period |
| Rework | Finding dispositions, repeated cycles and stage returns by cause; do not count a duplicate delivery as another cycle |
| Delivery lead/cycle time | Accepted scope to closure, and first execution to closure, under the selected workflow |
| Accepted throughput | Human-accepted outcomes and verified releases, segmented by change type and size; never raw messages or ticket splitting |
| Escaped defects | Verified production findings linked to an earlier accepted candidate; human-confirmed attribution |
| Cost, when observed | Provider-verified usage/cost with source and currency; show unknown for unobserved IDE/subscription usage |

Use server event intervals and workflow versions. Parallel activities overlap: do not sum all agent hours to claim end-to-end delivery time, and do not treat elapsed time as billable labor. Distinguish business-hours reporting from stored UTC durations. Display stalled/unknown periods honestly when clients disconnect.

Segment analysis by role, task class, risk, complexity proxy, model/runtime as reported or verified, template version and review policy. Show sample sizes and changes in mix. Do not rank agents by lines of code, message count, self-reported completion or speed alone. Small samples and different task difficulty do not support causal claims about which model is better.

## Improvement proposals

Start with transparent rules: repeated requirement ambiguity suggests a BA checklist update; recurring permission regressions suggest a targeted test requirement; long operator wait suggests a scheduling conversation; repeated context invalidation suggests smaller work packets.

Each suggestion links the underlying events, sample window, alternative explanations, proposed change, accountable human and a measurable follow-up. Suggestions remain proposals. They cannot edit accepted role templates, weaken gates, raise budgets, change access or turn on automatic routing.

A human can adopt a versioned process change for future work, run a bounded pilot and compare subsequent outcomes. An optional model may summarize evidence and uncertainties; it is not required for collection or enforcement.

## Privacy, retention and access

Audit visibility follows tenant, project and evidence access; operator ownership alone is not permission to read every project artifact. Notifications and aggregate dashboards omit sensitive content by default. Apply redaction and bounded payload validation before storage, preserving a redaction event where needed.

Reuse the proposed retention defaults in the security contract: 90 days for detailed operational events, one year for accepted/release evidence, subject to an explicitly configured project policy and applicable requirements. These are design defaults, not a claim that retention jobs exist. Long-term aggregates must identify their time range and source retention limits; they cannot imply raw evidence remains available forever.

Never collect hidden chain-of-thought, private chats, keystrokes or credentials for productivity scoring. Approved summaries, action evidence and human decisions provide the useful project record.

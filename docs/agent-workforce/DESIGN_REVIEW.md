# Design review and decision record

Reviewed: 2026-09-14. Method: inspect existing source boundaries, check primary protocol/client documentation, walk the human and agent flows, then review adversarial and failure cases. This is a design review by the author, not an independent security audit or an executed integration test.

## Requirement coverage

| User intent | Chosen design |
| --- | --- |
| One or many connected agents | Stable profiles, separate connections/attempts and default capacity of one per profile |
| Unique ID/profile per agent | Server-issued identity bound to enrollment credentials; model names are descriptive metadata |
| Codex, Claude, Gemini, IDE/CLI/Antigravity | MCP connection contract, portable companion, tested vendor adapters and explicit compatibility labels |
| Architect, developers, testers and peer reviewers | Configurable role presets with independent permissions and scoped work packets |
| Agents create and assign tickets | Attributed proposals and bounded plan work; deterministic role routing; no self-authorized scope expansion |
| Automatic trigger when assigned | Automatically deliver an offer to the operator; execute only after the separate required start decision |
| A human behind each agent | Mandatory operator, enrollment acceptance, revocation/transfer rules and attributable decisions |
| Human review in the IDE | Concise IDE/terminal notice, authenticated review link, supported launch or explicit manual start |
| Professional development hierarchy | Small-fix and feature templates, optional architecture, parallel development, candidate review/QA and separate release |
| Human-readable progress and responsibility | Outcome board, contribution panel, decision queue, evidence labels and a named next action |
| Ease of doing tasks | Keep title/project creation, avoid per-tool notices, allow explicit approval bundles and human-only review fallback |

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

## Architecture decisions

| ID | Decision | Reason and consequence |
| --- | --- | --- |
| AW-ADR-01 | Human-owned outcome plus agent work items | Keeps the board readable and preserves existing task identity/history; requires a guarded completion seam |
| AW-ADR-02 | Attended execution first | Fits existing IDE subscriptions and human review expectations; does not promise unattended control of every client |
| AW-ADR-03 | MCP plus a notification/lifecycle companion | Portable tool access with reliable contact and notices; one small local component is required for monitored runs |
| AW-ADR-04 | Explicit start/result/release decisions | Prevents automatic routing from becoming accidental authority; creates a human decision queue |
| AW-ADR-05 | Modular monolith, PostgreSQL outbox, continuous coordinator | Reuses deployed foundations without using the reminder cron as a realtime scheduler |
| AW-ADR-06 | Isolated attempts and exact-candidate evidence | Makes concurrent contribution and rework understandable; requires integration ownership and invalidation rules |
| AW-ADR-07 | Extend maintained authentication | Avoids a custom OAuth implementation; pinned integration compatibility remains a Phase 0 gate |

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

These are implementation gates with chosen fallbacks, not unresolved product questions requiring another planning meeting. Default decisions are specified so work can proceed in the delivery order.

## Review outcome and validation limits

The architecture is sufficiently specified to begin Phase 0 and the first vertical slice. It establishes identity, authority, state transitions, integration boundaries, delivery order and measurable acceptance. It does not establish that integrations are already working, that a security certification exists or that performance targets have been measured.

This change contains Markdown only. Local checks passed for document links, code-fence balance and trailing whitespace across nine design/template documents and the two repository entry documents. The entry-document diff was reviewed for scope and preservation of authority rules. No application build, provider run, load test or deployment is claimed for this design change. Product implementation must pass the repository's actual test/build/release gates for its own immutable source version.

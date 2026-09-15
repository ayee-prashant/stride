# Ordered delivery plan

Status: design approved; the human context foundation and configured GitHub
source increment are implemented, with verification evidence recorded. [Implementation status](IMPLEMENTATION_STATUS.md) tracks evidence
and incomplete contracts. The complete delivery slices below remain pending
until all their acceptance gates pass. Existing task-management deployment
evidence remains in [the current release review](../RELEASE_REVIEW.md).

## Delivery rule

Ship complete human-to-agent-to-human flows in small increments. Keep agent features disabled for workspaces that have not enrolled them. Each slice needs its own reviewed migration, meaningful failure tests, build and browser evidence before release. Do not infer that approving this architecture authorizes agent tasks or external release actions inside the future product.

Use the existing repository development instructions and security/validation gates. The roles described in this product are runtime concepts; creating these docs does not start a development-agent swarm.

Human-selected profiles are mandatory in this release. Agents may recommend roles/profiles and prepare drafts; assignment, operator start, evidence acceptance and release remain distinct decisions. [Human-approved delivery](HUMAN_APPROVED_DELIVERY.md), the [role catalog](ROLE_CATALOG.md), [prompt handoffs](PROMPT_HANDOFFS.md) and [audit/metrics](AUDIT_AND_METRICS.md) refine these contracts. The files are design deliverables, not completed orchestration features.

Shared project context and GitHub reconciliation are foundational. Follow PROJECT_CONTEXT.md and CONTEXT_PROTOCOL.md before adding execution/role automation. The protocol research baseline is MCP 2026-07-28; tested older clients use explicit compatibility adapters. A task queue without versioned intent, source freshness and cold-start recovery does not meet the first-release gate.

## Phase 0: prove the boundaries

| Ticket | Work | Observable exit criterion |
| --- | --- | --- |
| AW-001 | Prototype remote MCP/OAuth with existing human identity in an isolated environment | Connect one Codex client, deny cross-profile/project reads, revoke access, reject a wrong audience and agent approval attempt |
| AW-002 | Test client transport and permission capabilities | Versioned matrix for Codex, Claude, Gemini and Antigravity against modern per-request MCP and explicit legacy compatibility; include subscription, metadata and cancellation failures |
| AW-003 | Prototype notification and approved-launch contracts | A fake runner proves one authorized launch, duplicate-start recovery and cancel/unknown status without production access |
| AW-004 | Specify schema and compatibility migration | Review additive actor-aware records, task Done guard, proposal conversion, identity bindings and rollback behavior |
| AW-005 | Prove context authority, snapshots and task manifests | Accepted requirements differ from observed code and provisional notes; mixed source revisions, missing required inputs and stale material bindings prevent readiness |
| AW-006 | Prove GitHub observation and reconciliation | An external push/PR is detected without agent reporting; missed/repeated events, shared GitHub identity and incomplete source reads are handled honestly |
| AW-007 | Simulate two machines with conflicting context | Relevant contract change invalidates an old packet; unrelated work continues; a cold-start agent recovers from published evidence without chat history |

Choose the maintained OAuth/MCP integration only after AW-001 passes with pinned versions. Publish the attended fallback for any client whose launch/permission path fails. Do not spend this phase building four complete adapters.

## Phase 1: one human, one agent, one contribution

Depends on Phase 0. This is the first useful release.

| Ticket | Work | Observable exit criterion |
| --- | --- | --- |
| AW-101 | Agent registry, operator acceptance, adopted role templates and project grants | Create/revoke a stable profile; initialize one active role with explicit exclusions/access; reject forged identity/role fields and prompt-based permission escalation |
| AW-102 | Work items, packet revisions, proposals and actor-aware timeline | Agent proposes a ticket; human accepts it; historical human authorship stays accurate |
| AW-106 | Project brief, versioned requirements/decisions and GitHub ingestion | Human adopts a baseline; direct GitHub changes remain observed facts; incomplete indexing and conflicting intent are visible |
| AW-107 | Context assembly, search, validation and change notices | Complete least-privilege packet includes requirement/code versions and related work; stale packets and poisoned/restricted retrieval fail appropriate gates |
| AW-108 | Requirement-aware proposal intake and checkpoints | Scope/duplicates are checked before ticket acceptance; two proposals cannot silently create the same work; another machine can resume from a safe published checkpoint |
| AW-103 | Manual profile selection, human decisions, scoped start grants and atomic claims | Only an authorized human selects/reassigns; operator start is separate; no work runs before authorization; one claim wins; changed scope invalidates the grant |
| AW-104 | Narrow MCP reads/writes and simple CLI companion | Human receives a terminal/in-app notice and starts an attended client with the accepted packet; companion renews its lease independently of model tool calls |
| AW-105 | Progress, artifacts, review and human completion | Agent submits evidence; human requests changes or accepts; direct/bulk Done cannot bypass gates |

Implement Phase 1 in the table's dependency order: identity/work records, context/source foundations, then claims and execution. Demo: adopt project context, create a justified ticket, give DEV-1 one contribution, receive a notice, approve the packet, ask the agent to work, inspect its linked change/report and accept it. Repeat with a relevant requirement change, external GitHub PR, disconnect, duplicate proposal, rejected permission and requested revision. Keep a human reviewer fallback; a second executing agent is not required, but cold-start recovery on a separate test machine is.

Phase 1 includes the minimal outbox, coordinator, lease, deduplication and revocation needed for this flow. These are correctness requirements, not optional later hardening. The companion need not automatically launch a vendor process yet.

## Phase 2: a smooth IDE experience

Depends on Phase 1.

| Ticket | Work | Observable exit criterion |
| --- | --- | --- |
| AW-201 | VS Code decision queue, notices and trusted approval links | Operator can move from notice to scope review to Start with clear failure/offline states |
| AW-202 | First assisted-launch adapter, preferably Codex App Server after conformance | Native permission requests reach the human; a denied request is never auto-accepted; start is not duplicated |
| AW-203 | Claude and Gemini adapters, one at a time | Each independently passes the same connection, permission, progress, failure and stop suite |
| AW-204 | Antigravity/client compatibility packaging | Publish tested MCP setup and attended flow; enable additional launch features only after their own conformance evidence |
| AW-205 | Human review usability | Keyboard/mobile decision flow, preserved drafts, superseded requests, grouped notifications and meaningful evidence labels |
| AW-206 | Context and handoff experience in clients | Show packet freshness, required context changes and unshared local work; prepare/deliver exact context without starting an unapproved coding run |

Treat extension installation, signed releases, supported OS versions and client configuration as product deliverables. The initial supported development OS and client versions must be explicitly recorded. Do not advertise “all IDEs” on the strength of a common MCP configuration format.

## Phase 3: coordinated roles

Depends on stable identity, approvals and attempts from Phases 1–2; it can reuse attended clients.

| Ticket | Work | Observable exit criterion |
| --- | --- | --- |
| AW-307 | BA baseline and human-adopted solution | Product human accepts intent; technical human adopts solution; requirement exports cannot become a second writable authority |
| AW-301 | Accepted plan, dependency DAG and manual role assignment | SA proposes bounded tickets and profile recommendations; human accepts/selects; only dependency-ready work is offered; cycles and excessive fan-out are rejected transactionally |
| AW-302 | Developer, reviewer and QA handoffs | Three profiles complete a feature with each operator notified and each required human decision recorded |
| AW-303 | Parallel developer branches and integration ownership | DEV-1 and DEV-2 contribute without a shared checkout; conflicts return to a named integration owner |
| AW-304 | GitHub/CI evidence and exact-candidate gates | A new commit invalidates prior review/QA; verified CI and agent-reported tests are distinguished |
| AW-305 | Solo and small-team policy | One agent in multiple roles works without deadlock and is labeled self-review; required second-human policies still block when unmet |
| AW-306 | Role-specific context, deterministic prompts and conflict review | Pin adopted base/role templates and relevant accepted inputs; missing placeholders block; upstream instructions cannot expand authority; next-work drafts never auto-assign/start |
| AW-308 | QA/UAT findings, human decisions and bounded rework | Failed QA cannot advance to UAT; verified UAT candidate and business-human acceptance are required; defects return to dev and repeat affected gates; two cycles trigger replanning |
| AW-309 | Shared release candidate, separate release decision and manual deployment evidence | Bind exact artifact/environment/config; UAT PASS alone cannot release; unknown/failed deployment cannot close a ticket; verified production plus human closure satisfies the selected policy |

Implement AW-307/301/306 before multi-role handoffs; AW-304 supplies candidate evidence for AW-308/309. Demonstrate both a small fix using an explicitly selected simplified policy and a software feature with accepted BA/architecture baseline, developer contributions, engineering review, QA, UAT, separate release and human closure. Include QA and UAT failure paths. Reuse accepted baselines and add specialists by risk; do not attach every role to every task.

## Phase 4: operational readiness and optional managed runs

First validate unattended recovery, sustained event load, backup policy and access controls for attended coordination. Then add managed runners as a separately enabled capability, with human-approved limits and independent execution isolation.

| Ticket | Work | Observable exit criterion |
| --- | --- | --- |
| AW-401 | Recovery, monitoring and retention | Worker restart, stale lease, replay gap, revocation and restore drills preserve authority and work state |
| AW-402 | Pilot load and database budget | Measure dispatch/API targets at the documented profile/connection limit; record p95, pool use, backlog age and error rates |
| AW-403 | Scoped repository/release broker | Enforce protected candidate identity, stale-run rejection and separate human release authority |
| AW-404 | Optional isolated managed runners | No operator/browser/production secrets exposed; resource and egress restrictions, termination and cleanup verified |
| AW-405 | Bounded automation and governance | Only explicitly approved plan packets run; limits and unknown costs are visible; no self-authorizing recursive work |
| AW-406 | Optional model-assisted context suggestions | Compare source-linked summaries/gap/duplicate suggestions with deterministic baseline; rejected suggestions cannot affect authority; API outage leaves core workflows available |
| AW-407 | Audit-based delivery metrics and improvement proposals | Separate server/CI/human/agent evidence and wait intervals; preserve sample/coverage limits; proposals cannot change roles, gates, permissions or routing |

Managed runs are not a prerequisite for a useful agent team working in existing IDEs.

## Required verification by boundary

| Boundary | Meaningful tests |
| --- | --- |
| Identity/auth | Cross-tenant references, stolen/revoked grant, wrong audience, profile spoofing, duplicate enrollment and unavailable operator |
| Approval | Agent calling human endpoints, stale packet/role/policy, replayed approval, alternate/bulk completion bypass and missing reviewer authority |
| Concurrency | 100 simultaneous claims yield one active attempt; competing capacity reservations respect limits; retries return the same result |
| Execution | Lost launch response, native denial, pause/question, killed process, late heartbeat/artifact and unavailable resume |
| Workflow | Cycles, concurrent plan expansion, recursive proposals, manual assignment, offline role, rework limit, QA/UAT failures, accepted failure report versus passing gate, changed candidate and production-closure guard |
| Evidence | Forged CI success, webhook replay, new commit after QA, self-review labels, stale release artifact and unsafe report upload |
| Context | Mixed versions, unpublished/poisoned facts, stale local memory, mandatory input overflow, relevant/unrelated changes and a source outage |
| Proposal intake | Existing completed feature, external PR overlap, same-gap race, distinct bugs under one requirement and conflicting human publications |
| Cross-machine recovery | Missing chat history, unpublished edits, dirty checkout preservation, checkpoint evidence and current authorization on a new connection |
| Human UI | Notice/approve/start/submit/review flow, accessible controls, conflict/draft preservation and honest stop/progress labels |
| Operations | Outbox crash recovery, dead letters, event resync, connection pressure, restore and emergency revocation |

Use a deterministic fake agent for most contracts and real PostgreSQL for concurrency. Then run a small provider-specific conformance suite and browser flow against isolated fixtures. Do not make everyday tests depend on paid model calls or production credentials. Existing application tests must remain green after each product slice.

## Deferred scope and success measures

Defer automatic profile selection/reassignment, an agent marketplace, universal IDE remote control, arbitrary automation builder, model-based performance rankings, full transcript collection, autonomous budget expansion, self-spawning agent trees and a new orchestration infrastructure stack.

Measure human effort and delivery quality: time from assignment to a reviewed start, time waiting for a named human, accepted outcomes, rework and escaped defects, duplicate proposals/launches, stale-context incidents, unnecessary context invalidations and cold-start recovery. Measure cached context assembly separately from external GitHub reconciliation. Compare with the team's baseline before setting improvement claims. More agent activity alone is not product success.

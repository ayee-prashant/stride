# Human-approved software delivery

Status: design contract, not implemented orchestration. This refinement makes human assignment explicit for the first release. It extends the [operating model](OPERATING_MODEL.md), [project context](PROJECT_CONTEXT.md) and [security contract](SECURITY_AND_RELIABILITY.md).

## Product rules

1. A human owns every outcome. An agent produces a scoped contribution in one active role.
2. Humans approve requirements, solution/plan, execution, evidence and release at the appropriate gates. An agent's recommendation is never a human decision.
3. Humans select profiles manually in this release. Stride lists eligible profiles and explains availability; an architect may recommend. Automatic assignment, reassignment and autonomous starts are deferred.
4. Assignment does not start work. The selected agent's operator authorizes the exact packet, role, scope, candidate/base revision and limits.
5. Maintain one delivery ticket per outcome. Role work items, attempts and findings sit underneath it. Generate a new ticket only for a separately accepted outcome.
6. State changes, evidence and human decisions have an attributed audit trail. An LLM does not compute permissions or decide whether a gate is satisfied.
7. Human-approved, versioned project context is shared. Local chats and agent memory are working notes, not accepted project truth.

## Establish the project before assigning implementation

| Baseline | Agent prepares | Accountable human decision |
| --- | --- | --- |
| Product definition | Problem, actors, outcomes, priorities, scope, exclusions and open questions | Product owner / BA human accepts the intended product |
| Requirements | Stable requirement and acceptance-criterion IDs, examples, nonfunctional constraints and dependencies | Authorized context steward publishes exact accepted revisions with the product owner's decision |
| Solution | Boundaries, interfaces, data changes, security, performance, failure/recovery and delivery options | Technical lead accepts the exact solution and adopted decisions |
| Delivery plan | Bounded tickets, dependencies, role contributions, tests, QA/UAT scenarios and release approach | Technical lead approves the plan; product owner decides new scope or priority |
| Role/access configuration | Proposed roles, required inputs and capabilities | Authorized project human grants access; each operator enrolls their profile and connection |

Use one product definition document, not separate PDD/PRD copies with competing truth. Requirements are records in the accepted Stride registry; REQUIREMENTS.md is a generated, version-labelled export. Engineering documents can live in Git, but a human must adopt their exact revision into project context. A merged document alone does not change accepted intent. See the [baseline template](templates/PROJECT_BASELINE.md).

BA and architect outputs are proposals until their human gate passes. Implementation tickets remain proposed while mandatory questions or dependencies are unresolved. Do not run this whole baseline process again for every small fix: an approved, current baseline can cover many tickets. A material change requires approval only for affected requirements, decisions, packets and dependent evidence.

## Normal delivery loop

The default software-delivery workflow is:

Created → Development → Engineering review → QA → UAT → Release → Done.

The next stage becomes available only when its transition guard passes. It may immediately be waiting for a human assignment or start decision.

| Current stage / event | Required evidence and human action | Result |
| --- | --- | --- |
| BA submits baseline | Product owner reviews scope and criteria; context steward publishes exact accepted revisions | Architect contribution can be prepared |
| Architect submits solution and ticket proposals | Technical lead accepts design, dependencies, ticket scope and workflow policy; product owner resolves scope changes | Approved tickets enter Created; developer packets are drafts |
| Created | Human selects an eligible developer; operator approves the complete packet; server validates and atomically claims work | Development begins |
| Developer submits | Exact remotely available candidate, changes, criterion coverage, tests actually run, failures and limitations | Engineering review; development is submitted, not accepted or Done |
| Engineering review passes | Required peer/specialist evidence, verified required CI and engineering human's acceptance of this candidate | QA becomes ready for manual assignment and authorization |
| QA submits PASS recommendation | Report covers required criteria and regression on the exact candidate/environment; QA human accepts evidence | UAT preparation becomes ready |
| QA submits FAIL or INCONCLUSIVE | Findings or missing evidence; human triages and approves the next bounded action | Remain blocked or return to the appropriate rework stage |
| UAT environment preparation | Human authorizes promotion of the accepted QA artifact; operations records environment and deployed identity | UAT testing can start after manual assignment and operator authorization |
| UAT submits recommendation | Business scenarios, evidence, limitations and exact candidate; business owner accepts the outcome | Release preparation becomes ready |
| UAT requests changes | Human classifies defect, requirement gap, design gap or environment failure | Rework at the responsible role; affected gates repeat |
| Release ready | Release human approves exact artifact, target, configuration/migration revisions, checks and recovery plan | Authorized release execution, initially a recorded manual operation |
| Deployment verified | Deployment identity, required smoke/health checks and human production acceptance | Delivery ticket becomes Done |

A peer agent supplies engineering-review evidence when the selected policy requires it. A technical human still owns the engineering gate. A QA agent's PASS is distinct from QA human approval. A UAT agent assists evaluation; only the business owner can accept business fitness. One human may occupy several positions where the approved policy permits this.

For a small, low-risk ticket, the human can select a simplified workflow before execution. This can omit optional peer/specialist steps or combine compatible human reviews, with the omission visible. Mandatory security, integrity, current-permission, required-check and release gates cannot be silently skipped. Do not apply a shortcut after a required test fails.

## Rework without ticket multiplication

Attach a finding to the existing delivery ticket with: finding ID, source attempt, criterion ID, candidate/environment, reproducible observation, expected behavior, severity recommendation, evidence and proposed owner role. Humans confirm disposition and severity.

| Finding classification | Proposed next contribution | Required decision |
| --- | --- | --- |
| Implementation defect | Developer fixes approved behavior, adds focused regression evidence | Engineering human approves revised packet; operator authorizes a new attempt |
| Requirement ambiguity or new scope | BA proposes clarification or a separate scoped outcome | Product owner/context steward accept any intent change before affected execution |
| Design or interface gap | Architect proposes a revised decision and impact analysis | Technical lead adopts the change; affected packets become stale |
| Environment or deployment failure | Operations diagnoses the allowed environment | Responsible environment human authorizes the operation |
| Unsupported or incomplete test result | QA/UAT gathers missing evidence | Reviewer accepts the revised test scope; operator authorizes further execution |

QA failure does not advance to UAT. After a development fix, repeat required engineering review, QA and UAT on the new candidate. A nonblocking observation may remain open only when the selected policy allows it and the accountable human records the rationale. An unmet mandatory criterion, failed required check or security prohibition cannot become a pass through an ordinary waiver.

Preserve previous reports and decisions as history. Mark evidence stale when its material inputs change; never edit a failed report into a pass. After two rework cycles by default, stop automatic preparation of more rework and request human replanning. This is a proposed configurable pilot limit. New tickets for independent defects require human acceptance and a blocking/related link; do not recursively create tickets for every finding.

## State model and human board

Do not replace the existing global To do / In progress / Done task enum. Opted-in software-delivery tickets get a versioned workflow instance alongside actor-aware work items.

- Delivery stage: created, development, engineering_review, qa, uat, release, done; cancellation is a recorded terminal outcome.
- Role work-item state remains proposed, ready, in_progress, in_review, accepted or cancelled.
- Attempt state records actual execution and recovery.
- Waiting reason records assignment, operator decision, capacity, offline runner, dependency, clarification, environment, evidence or reviewer decision.
- Role verdict records a recommendation: ready_for_review, pass, fail or inconclusive. It cannot set an acceptance field.

Derive readable labels from these facts: "QA · awaiting assignment", "QA · waiting for Priya to start QA-1", "QA · running", "QA · report awaiting review", or "Development · changes requested". "Dev assigned" and "QA assignment" are substates, not separate global statuses.

A ticket remains To do before execution and In progress until the selected completion policy is satisfied. For this software-delivery workflow, Done requires production verification and human closure. A documentation/BA/architecture contribution can be accepted when its own artifact is accepted; it need not wait for the entire release. Legacy tickets keep their normal completion rules.

A release candidate may contain several tickets. Store one candidate manifest and shared release decision referencing their exact accepted evidence; each ticket closes only if its inclusion and completion guards still hold. Do not duplicate deployments per ticket. Different candidate commits or rebuilt artifacts require new validation under the policy; a mutable branch/tag is not an approval target.

## Assignment, initialization and start

1. The accepted plan makes a role contribution eligible after its dependencies pass.
2. Stride prepares a draft packet and lists profiles with the role, access, capability, availability and remaining capacity. The architect may recommend a profile, but cannot select on the human's behalf.
3. An authorized human selects one profile. An offer notifies its operator and states why it was assigned.
4. The operator reviews objective, constraints, source versions, allowed files/actions, outputs and limits, then starts or declines. If the assigner is also the operator, one clearly labelled "Assign and authorize" action can record both decisions.
5. Server validation binds and consumes the authorization for one attempt. A trusted adapter performs permitted preparation and launch; the agent declares its role and boundaries in its first authorized response.
6. The agent works only within the packet, checkpoints shared facts, and submits evidence. The receiving human reviews before the next guarded transition.

A lead cannot authorize another person's agent merely by assigning it. Delegation must be explicit and current. Different profile, role, scope, material context or expired authorization requires a new decision. No profile available means a visible queue, not automatic substitution. A profile can hold several roles but each attempt has exactly one; changing roles requires another scoped attempt.

MCP notices do not universally wake an idle model. Supported companions/IDE adapters notify the human and launch only after authorization; other clients show a packet and an attended start instruction. Lost/repeated notifications use durable receipts and must not create duplicate attempts. Initialization and prompt contracts are in [role catalog](ROLE_CATALOG.md) and [prompt handoffs](PROMPT_HANDOFFS.md).

## Approval validity and source boundaries

Bind every decision to its purpose, authorized human, project, work revision, relevant requirement/criterion and policy versions, artifact/candidate/environment where applicable, and expected aggregate version. Recheck live permissions at consequential actions. An approval for a report is not deployment authority.

Candidate changes invalidate dependent engineering, QA, UAT and release approvals. Material requirement, role or access changes invalidate affected packets; an unrelated project update need not restart all agents. Ordinary review cannot waive tenant isolation, revocation, mandatory independent review or exact-candidate matching.

Existing GitHub access is external authority: in observed mode Stride detects and attributes direct changes but cannot prevent a person or agent from bypassing its workflow using outside credentials. Protected merge/deploy enforcement requires verified GitHub checks and separately scoped release credentials. This distinction must be visible to humans.

## Implementation order and acceptance gates

These steps extend the existing [delivery plan](DELIVERY_PLAN.md); none is complete merely because these documents exist.

| Order | Increment | Observable acceptance gate |
| --- | --- | --- |
| 1 | Profile/operator/role bindings, immutable role-template versions, permission checks | Role initialization fails for missing scope; a role name or prompt cannot grant access |
| 2 | Actor-aware proposals, work items, manual assignment, start decisions and audit/outbox | Agent cannot approve/assign/start itself; duplicate claims have one winner; old decisions reject revised work |
| 3 | One developer contribution with human review, durable checkpoint and task-completion guard | Submitted is not Done; another machine resumes with fresh authority and exact shared inputs |
| 4 | Approved BA/SA baseline, bounded plan/ticket proposals and deterministic handoff packets | Humans accept scope and select profiles; generated packets are unassigned drafts until reviewed |
| 5 | Candidate-bound engineering/QA/UAT gates, findings and rework | Failed QA cannot reach UAT; UAT defect returns to dev; changed candidate invalidates dependent decisions |
| 6 | Release-candidate manifest, separate release decision, manual deployment evidence and closure | UAT PASS alone cannot deploy or complete a ticket; wrong artifact/environment is rejected |
| 7 | IDE/CLI decision notices and supported attended launch adapters | Offline/reconnect/repeated delivery preserves decisions and does not start duplicate work |
| 8 | Audit-based flow metrics and evidence-linked improvement proposals | Agent-reported activity remains distinguishable from observed work; suggestions cannot change policy |

Implement domain transitions and authority guards before expanding UI automation. Exercise stale approval, failed gates, role switching, revocation, concurrent decisions, recovery, candidate changes, incomplete evidence and every legacy completion entry point. Real runtime and client verification remain required when implementation begins.

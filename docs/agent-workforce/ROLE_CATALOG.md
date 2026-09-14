# Role catalog and access contract

Status: design and prompt templates. Publishing these files does not enroll profiles, grant permissions or start agents.

Read [human-approved delivery](HUMAN_APPROVED_DELIVERY.md) first. Every prompt consists of the [base prompt](templates/roles/BASE.md), one versioned role template, and an approved [work packet](templates/WORK_PACKET.md). Role prompts cannot override server policy or repository instructions.

## Human responsibility and role boundaries

| Role template | Agent responsibility | Accountable human | Explicitly outside the role |
| --- | --- | --- | --- |
| [BA](templates/roles/BA.md) | Clarify intent, propose product definition, requirements, criteria, exclusions and gaps | Product owner / BA human; authorized steward publishes context | Approving requirements, deciding priority, designing implementation, coding or assigning agents |
| [Solutions architect](templates/roles/SOLUTION_ARCHITECT.md) | Review accepted intent, design boundaries and interfaces, propose tickets, dependencies and role prompts | Technical lead; product owner for scope changes | Publishing unapproved scope, final profile assignment, starting agents, coding or release approval |
| [Developer](templates/roles/DEVELOPER.md) | Implement approved scope, focused tests, migration notes and exact candidate handoff | Engineering reviewer | Changing acceptance criteria, self-accepting, QA/UAT sign-off or deploying |
| [Peer reviewer](templates/roles/PEER_REVIEWER.md) | Review exact diff, correctness, maintainability and risks; report findings | Engineering reviewer | Editing implementation, rubber-stamping self-review, merging or approving business acceptance |
| [QA](templates/roles/QA.md) | Acceptance and regression validation, reproducible findings, test evidence | QA lead / designated engineering human | Weakening criteria, fixing product code, accepting business fitness or promoting environments |
| [UAT](templates/roles/UAT.md) | Run business scenarios on the verified UAT candidate, organize human feedback | Business owner / authorized product representative | Final business acceptance, production tests by default, deployment or requirement changes |
| [Release / operations](templates/roles/RELEASE_OPERATIONS.md) | Prepare candidate manifest, rollout/recovery instructions and observed deployment evidence | Environment owner; separate release approver for production | Deploying because tests passed, broad infrastructure access, modifying app logic or authorizing release |
| [Security reviewer](templates/roles/SECURITY_REVIEWER.md) | Threat and permission review, bounded authorized checks, risk findings | Designated security human | Exploitation beyond scope, obtaining secrets, waiving findings or changing policy |
| [UX / accessibility](templates/roles/UX_ACCESSIBILITY.md) | Interaction and accessibility review, user-flow evidence and proposed improvements | Product/design human; engineering lead for implementation | Reprioritizing features, declaring universal compliance or editing product code without another role |
| [Performance / data](templates/roles/PERFORMANCE_DATA.md) | Bounded measurement, bottleneck analysis and evidence-backed proposals | Engineering/performance human; data owner for access | Production load tests, widening data access, speculative rewrites or increasing spend |
| [Documentation](templates/roles/DOCUMENTATION.md) | Update scoped user/developer documentation and trace it to accepted behavior | Document owner / relevant product or engineering human | Inventing features, rewriting trusted policy, changing accepted requirements or claiming release approval |

Core sequence: BA → architect → developer → QA → UAT → release. Peer review is recommended and policy controlled. Security, UX/accessibility, performance/data and documentation contributions are added for relevant risk or deliverables, not as mandatory bureaucracy on every ticket. A human reviewer remains accountable where a specialist agent is absent. Custom roles must use the [role brief](templates/ROLE_BRIEF.md), explicit exclusions and a human-adopted template version.

## Access is an explicit intersection

Effective access is the intersection of current project membership, human-granted role permissions, connection capabilities, approved packet allowlists and attempt authority. A role label, template, directory name or model response cannot widen it.

| Role family | Minimum relevant read access | Default proposed write area | Execution boundary |
| --- | --- | --- | --- |
| BA | Accepted brief/requirements, approved customer evidence, related tickets | Assigned requirement/product proposals only | No repository commands needed by default |
| Architect | Accepted requirements, adopted architecture, relevant interfaces/code inventory | Assigned design/ADR and plan proposals | Inspection only; commands require explicit approved scope |
| Developer | Exact scoped requirements, contracts, relevant source/tests and policies | Packet-listed source, tests and migration paths in an isolated checkout | Approved build/test commands and bounded nonproduction fixtures |
| Peer / security | Candidate diff, relevant surrounding code, policies and evidence | Assigned review reports; no source edits | Only authorized checks on the approved target |
| QA / UAT | Required criteria/scenarios, candidate/environment manifest and fixtures | Assigned test cases/reports; QA automation files only if explicitly granted | Approved nonproduction target, fixture and reset scope; no deployment rights |
| UX / accessibility | Accepted flows, approved assets and relevant UI | Assigned review/prototype documents | Approved UI inspection; no live user data by default |
| Release / operations | Accepted candidate/gates, deployment configuration and runbooks | Assigned release manifests/runbooks | Preparation by default; exact external operation requires separate authority |
| Performance / data | Relevant code, sanitized measurements, schemas and accepted budgets | Assigned benchmarks/reports when permitted | Bounded approved dataset, environment, duration and load |
| Documentation | Accepted behavior, source references, APIs and release evidence | Packet-listed user/developer docs | Verify snippets only with approved commands/environment |

Paths above describe artifact classes, not blanket grants such as all of docs/ or the whole repository. Every actual packet supplies explicit read/write paths, commands, network targets, environment and budget; unspecified access is denied by default. Even documentation directories can contain trusted policy or sensitive material. Secrets are delivered through approved runtime mechanisms, never placed in prompts, tickets or reports. Shared GitHub credentials must not be treated as role enforcement.

## Initialize before work

Use [ROLE_INITIALIZATION.md](templates/ROLE_INITIALIZATION.md) to record:

1. Stable profile UUID and display alias, operator identity, enrolled connection and supported runtime capabilities.
2. Project role binding and immutable base/role-template versions with current policy epoch.
3. Human ticket owner, output reviewer and required independent-review constraints.
4. Complete relevant context, accepted requirement revisions, repository/candidate identity, read/write/execute limits and expected outputs.
5. Manual assignment and a valid operator start decision for exactly this attempt.

Trusted preparation is deterministic and limited to authorized adapter operations. Do not start an LLM or run project scripts merely to obtain a pre-start acknowledgement. After authorization, the agent's first response declares its role, objective, "I am responsible for", "Outside my role", inputs, allowed actions and blockers. This is a declaration, not proof of comprehension or a new approval.

## Role changes and independence

One profile may have several approved roles; one work item and attempt have one active role. End the attempt and prepare another packet to change role. If DEV-1 later acts as QA, show that the same profile tested its own work. Using a new alias, model or session does not make review independent.

Human independence is a separate policy: different profiles with the same operator are not two independent humans. A small-team policy may allow one person to hold several positions when declared before execution. Required independence cannot be bypassed with profile changes.

## Role/template lifecycle

A designated human reviews and adopts new versions, including exclusions and input/output contracts. Draft edits remain proposals. Packet assembly pins base and role-template hashes; a role-template change cannot silently alter an active attempt. Material instruction changes invalidate affected pending approvals and require an updated packet.

Model/provider choice is metadata and a compatibility/cost decision, not a role permission. Do not assume Codex, Claude or Gemini has a fixed specialty. Use tested capabilities, accepted evidence and human selection. Later routing suggestions may consider those signals; automatic assignment remains out of scope for this release.

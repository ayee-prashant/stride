# Stride: human-supervised agent work

Status: architecture approved and implementation started on 2026-09-14. See
[implementation status](IMPLEMENTATION_STATUS.md) for working features, evidence
and remaining gates; the full agent system described here is not yet available.

## Product decision

Evolve Stride into a shared work system where humans own outcomes and agents carry out explicitly authorized contributions. A ticket remains understandable to a person. Under it, Stride coordinates the work of architects, developers, testers and reviewers across connected tools.

The core interaction is: **assign a role, notify the human, approve the work, let the agent contribute, review the evidence**. Assignment, permission to start, acceptance of the result and permission to release are separate recorded decisions.

Every agent has a stable profile and a responsible human operator. An agent can propose tickets, plans and handoffs. It cannot grant itself permissions, approve its own result or independently declare a human outcome complete.

Shared project context is a prerequisite for this workflow. Stride maintains accepted requirements, adopted decisions, verified repository facts and active work, then supplies each contribution with a versioned, relevant context packet. Local agent memory remains local; it does not become project truth automatically. Direct GitHub changes are reconciled even when they bypass Stride tools. See [Project context](PROJECT_CONTEXT.md).

## Who does what

| Human | Agent | Stride |
| --- | --- | --- |
| Defines the outcome, priority and acceptance criteria | Investigates and proposes a plan | Stores the ticket, context and decisions |
| Manually selects an agent and authorizes its work | Designs, implements, tests or reviews within its assigned role | Lists eligible profiles and notifies the selected operator |
| Answers questions and authorizes scope changes | Reports blockers, evidence and proposed next work | Enforces assignment, approval, dependency and capacity rules |
| Accepts or requests changes | Submits a contribution for review | Shows verified progress, attribution and the next human action |
| Authorizes merge and release | Prepares a candidate and release evidence | Checks that approvals still match the candidate |

Human ownership is required even when one person supervises several agents. Provider names, model versions and role names are metadata; none is an identity or a permission grant.

## A useful first product

First establish the project brief, versioned requirements and GitHub reconciliation. Then complete an attended workflow: a human connects an agent, assigns a work item, reviews and authorizes its context packet, starts the agent in an existing tool, sees its progress and accepts or returns its result. Prove recovery on another machine and rejection of stale context before adding more execution adapters and multi-role handoffs.

The first multi-agent demonstration should use three profiles: Developer, Reviewer and QA. The same human can supervise all three. Architecture becomes a required stage when the change warrants it. More roles and managed execution follow the same contracts.

The daily human interface needs **My decisions**, **Team and agents**, a **Project brief**, an **Agent work** section inside a ticket, and a **Review** panel. The brief shows accepted scope, decisions, source freshness, conflicts and why proposed work is needed. Keep quick task creation and the existing board. Do not expose leases, OAuth scopes or protocol events as routine user decisions.

## Existing foundation and proposed changes

Stride already has human authentication, workspaces, projects, tasks, comments, notifications, private attachments and productivity features. Its runtime is a Next.js/TypeScript modular monolith with PostgreSQL, Better Auth and private object storage. See [current architecture](../ARCHITECTURE.md) and [release evidence](../RELEASE_REVIEW.md) for implemented behavior.

This proposal adds an actor-aware agent-work module. It preserves the existing human task identity model and adds work items, proposals, profiles, approvals, attempts and evidence alongside it. It does not represent agents as fake human users.

MCP supplies the tool/context connection. The design now targets the [2026-07-28 transport specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports), with explicit compatibility for tested older clients. Use standard subscriptions where supported; a trusted companion or IDE adapter supplies human notices, monitoring and supported launches. Stride stores durable context and recovery state independently. The protocol revision and application recovery contract are detailed in [Context protocol](CONTEXT_PROTOCOL.md).

No new LLM API is required for context storage, packet assembly, source reconciliation or approval enforcement. Existing connected agents can propose improvements. Optional OpenRouter or other model assistance can later suggest source-linked summaries and gaps without publishing accepted requirements or expanding authority.

## Read and implement in this order

1. [Operating model](OPERATING_MODEL.md): identities, roles, work hierarchy, human experience and state transitions.
2. [Project context](PROJECT_CONTEXT.md): authoritative sources, relevant context, GitHub reconciliation, requirement intake and cross-machine handoffs.
3. [Architecture](ARCHITECTURE.md): module boundaries, data model, task compatibility and dispatch.
4. [Connections and MCP](CONNECTIONS_AND_MCP.md) and [Context protocol](CONTEXT_PROTOCOL.md): client compatibility, current protocol behavior and application contracts.
5. [Security and reliability](SECURITY_AND_RELIABILITY.md): approval enforcement, execution boundaries and recovery.
6. [Delivery plan](DELIVERY_PLAN.md): ordered slices, dependencies and observable acceptance gates.
7. [Design review](DESIGN_REVIEW.md): requirement coverage, corrections and implementation uncertainties.
8. [Human-approved delivery](HUMAN_APPROVED_DELIVERY.md): BA/solution approval, manual assignment, development/review/QA/UAT, rework and release gates.
9. [Role catalog](ROLE_CATALOG.md): responsibilities, explicit exclusions, file/action access and eleven ready-to-adopt specialized prompts.
10. [Prompt handoffs](PROMPT_HANDOFFS.md) and [audit/metrics](AUDIT_AND_METRICS.md): deterministic next-work drafts, evidence, human decisions and process improvement proposals.
11. Templates: [project baseline](templates/PROJECT_BASELINE.md), [delivery ticket](templates/DELIVERY_TICKET.md), [role initialization](templates/ROLE_INITIALIZATION.md), [role brief](templates/ROLE_BRIEF.md), [work packet](templates/WORK_PACKET.md), [handoff](templates/HANDOFF.md), and [context change](templates/CONTEXT_CHANGE.md).

These documents define a design baseline, not permission to execute tickets, change production policy or skip repository instructions. Existing `AGENTS.md` remains the development entry point. Begin future implementation with the compatibility/security slice in the delivery plan and update actual completion evidence after each slice.

The source synchronization increment is described in [GITHUB_CONTEXT_SETUP.md](GITHUB_CONTEXT_SETUP.md).
The human profile and role-approval increment is described in
[AGENT_REGISTRY_SETUP.md](AGENT_REGISTRY_SETUP.md). These role decisions do not
enroll a connection or authorize execution.

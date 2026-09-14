# Stride: human-supervised agent work

Status: proposed architecture, reviewed on 2026-09-14. These capabilities are not implemented by this documentation change.

## Product decision

Evolve Stride into a shared work system where humans own outcomes and agents carry out explicitly authorized contributions. A ticket remains understandable to a person. Under it, Stride coordinates the work of architects, developers, testers and reviewers across connected tools.

The core interaction is: **assign a role, notify the human, approve the work, let the agent contribute, review the evidence**. Assignment, permission to start, acceptance of the result and permission to release are separate recorded decisions.

Every agent has a stable profile and a responsible human operator. An agent can propose tickets, plans and handoffs. It cannot grant itself permissions, approve its own result or independently declare a human outcome complete.

## Who does what

| Human | Agent | Stride |
| --- | --- | --- |
| Defines the outcome, priority and acceptance criteria | Investigates and proposes a plan | Stores the ticket, context and decisions |
| Owns an agent and authorizes its work | Designs, implements, tests or reviews within its assigned role | Routes work to eligible profiles and notifies their operators |
| Answers questions and authorizes scope changes | Reports blockers, evidence and proposed next work | Enforces assignment, approval, dependency and capacity rules |
| Accepts or requests changes | Submits a contribution for review | Shows verified progress, attribution and the next human action |
| Authorizes merge and release | Prepares a candidate and release evidence | Checks that approvals still match the candidate |

Human ownership is required even when one person supervises several agents. Provider names, model versions and role names are metadata; none is an identity or a permission grant.

## A useful first product

Start with one complete, attended workflow: a human connects an agent, assigns a work item, reviews and authorizes the packet, starts the agent in an existing tool, sees its progress and accepts or returns its result. Add a CLI notification companion and a VS Code extension, then additional execution adapters and multi-role handoffs.

The first multi-agent demonstration should use three profiles: Developer, Reviewer and QA. The same human can supervise all three. Architecture becomes a required stage when the change warrants it. More roles and managed execution follow the same contracts.

The daily human interface needs four additions: **My decisions**, **Team and agents**, an **Agent work** section inside a ticket, and a **Review** panel. Keep quick task creation and the existing board. Do not expose leases, OAuth scopes or protocol events as routine user decisions.

## Existing foundation and proposed changes

Stride already has human authentication, workspaces, projects, tasks, comments, notifications, private attachments and productivity features. Its runtime is a Next.js/TypeScript modular monolith with PostgreSQL, Better Auth and private object storage. See [current architecture](../ARCHITECTURE.md) and [release evidence](../RELEASE_REVIEW.md) for implemented behavior.

This proposal adds an actor-aware agent-work module. It preserves the existing human task identity model and adds work items, proposals, profiles, approvals, attempts and evidence alongside it. It does not represent agents as fake human users.

MCP supplies the tool/context connection. A separate trusted companion or IDE adapter handles notifications and, where documented and tested, launching an approved session. MCP transport can carry server notifications, but that does not establish a universal contract for waking an idle coding agent. The manual-start path remains available. This is an architecture inference from the [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) and the client interfaces listed in [Connections and MCP](CONNECTIONS_AND_MCP.md).

## Read and implement in this order

1. [Operating model](OPERATING_MODEL.md): identities, roles, work hierarchy, human experience and state transitions.
2. [Architecture](ARCHITECTURE.md): module boundaries, data model, task compatibility and dispatch.
3. [Connections and MCP](CONNECTIONS_AND_MCP.md): compatibility evidence, connection modes and proposed contracts.
4. [Security and reliability](SECURITY_AND_RELIABILITY.md): approval enforcement, execution boundaries and recovery.
5. [Delivery plan](DELIVERY_PLAN.md): ordered slices, dependencies and observable acceptance gates.
6. [Design review](DESIGN_REVIEW.md): requirement coverage, corrections and implementation uncertainties.
7. [Role brief template](templates/ROLE_BRIEF.md) and [work packet template](templates/WORK_PACKET.md): proposed content contracts for future runtime use.

These documents define a design baseline, not permission to execute tickets, change production policy or skip repository instructions. Existing `AGENTS.md` remains the development entry point. Begin future implementation with the compatibility/security slice in the delivery plan and update actual completion evidence after each slice.

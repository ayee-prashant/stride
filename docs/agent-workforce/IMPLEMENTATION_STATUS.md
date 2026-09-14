# Agent workforce implementation

Implementation approved on 2026-09-14. Work is on
`feature/agent-context-foundation` and the next stacked branch
`feature/github-project-context`, based on the reviewed design. This record
distinguishes working application behavior from remaining delivery gates.

## Context foundation implemented

- Human admins publish requirements, decisions and constraints with an explicit
  reason. Each revision retains its original content, human approver and date.
  Members can read the project brief and prepare task briefs.
- A task brief includes selected active requirements and all active project
  decisions and constraints. It retains the original task scope and document
  versions; publishing an update never rewrites a previously delivered brief.
- Relevant requirement, decision, constraint or task-scope changes mark a brief
  stale. An unrelated requirement or ordinary task status transition does not.
  Archived projects/tasks and completed tasks cannot prepare new briefs.
- Publication uses expected versions, request receipts, a serialized project
  sequence and an atomic audit event. A retry of the same accepted request
  returns its original result. Reusing its key for different content fails.
- Composite tenant/project/task foreign keys constrain stored references.
  The runtime role cannot update or delete accepted revisions, context events
  or task brief snapshots after provisioning.
- The human interface adds Project brief, publication history, revision
  comparison after conflicts, and a Task brief panel. Drafts survive failed
  saves; a person must explicitly discard them when closing.

These are human-prepared **task briefs**, not authorized agent work packets.
The response always has `execution_ready: false`. Projects without an enrolled
GitHub source report source coverage as `not_connected`. No credential or execution authority is
created by publishing context or preparing a brief.

## Verification

Local native tests: 84 passing (73 existing and 11 context tests).
The first context-service CI run passed type checking, lint and the production
build. It stopped at the expected migration-parity gate before the generated
migration was committed. The generated snapshot and migration were retrieved
and reviewed; the new task unique constraint was moved before its referencing
foreign key in migration 0003. Existing migrations and the lockfile are unchanged.

The final context-foundation checks passed in
[CI run 34884573544](https://github.com/ayee-prashant/stride/actions/runs/34884573544)
for source `f81dda634c410c6f8319084aca5cde46c4d2b0e9` (tree
`516e5c195105431cb74a3df78088cd56992a1c9b`). This includes PostgreSQL,
concurrent publication and permission revocation, migrations, runtime grants,
audit, performance/restore, type checking, lint, build and browser acceptance.
The three-pane document dialog is **Published context → Your draft → Review &
publish**. Its desktop, mobile, revision history, preserved drafts and stale brief
flows were verified. This code remains on the feature branch; it is not deployed.

## GitHub source slice implemented; integration verification in progress

- Admin enrollment uses a server-owned project-to-repository grant, with a
  separate read-only GitHub App key confined to the context worker.
- Durable, fenced source jobs pin all configured files to one verified commit,
  verify blob hashes, handle incomplete reads and provider cooldowns, and recover
  from expired workers without accepting late results.
- Source observations and human publications share a commit-ordered change
  cursor. Human decisions and observed code remain separate records.
- Task briefs include immutable source manifests and exact file contents. A
  changed commit invalidates the brief; an expired check, outage or removed grant
  blocks preparation and withholds cached private source files.
- Project brief includes enrollment, source status, commit/file review, refresh
  and disconnect controls. Task briefs show their saved repository versions.

Local native suite: **100 tests passed**. Source migration generation, real
PostgreSQL concurrency, type/lint/build and the extended browser flow still need
the complete next-branch CI gate before this increment is described as verified.
Setup, coverage and limits are in [GITHUB_CONTEXT_SETUP.md](GITHUB_CONTEXT_SETUP.md).
No GitHub App credentials have been provisioned for the deployed application.

## Remaining gates

1. Complete GitHub source CI and installed-App validation, then PR/CI
   reconciliation, indexed traceability and webhook handling (AW-006).
2. MCP 2026-07-28 and maintained OAuth integration/client compatibility
   evidence (AW-001/002), fake-launch safety proof (AW-003).
3. Context proposals, typed source links, decision adoption, indexed traceability,
   source-aware immutable manifests, checkpoints and cold-start recovery.
4. Agent profiles, enrolled connections and actor-aware work items; human start
   grants, atomic claims, fenced attempts and human result acceptance.
5. CLI/IDE notices and supported execution adapters, multi-role plans and
   handoffs, operational load/recovery gates and a verified release.

The context foundation contributes to AW-004/005/106/107. Those tickets are not
marked complete because their full source and agent contracts remain pending.
Follow DELIVERY_PLAN.md for the remaining dependencies. No mandatory LLM API
has been added.

## Review notes and limits

- Workspace admins act as context stewards for this first slice. Delegated
  project authority and agent proposals must use the future actor boundary;
  never supply an agent ID through a human-authenticated publication request.
- Decisions and constraints currently apply to the whole project. Requirement
  relevance is selected explicitly per task. Component-level impact links are
  a later extension; do not claim they exist.
- Freshness in this slice is an advisory check on a saved human brief. The
  future execution service must recheck its material binding within its claim
  or submission transaction, including verified GitHub sources and policy.
- Limits: 200 documents/project, 500 revisions/document, 20 selected
  requirements/brief, 128 KiB/brief and 200 briefs/task. History and change
  reads are paginated. Content stays private and is rendered as plain text.
- Apply migrations through the privileged provisioning job before switching
  the app; run provisioning to establish the append-only runtime grants.
  Rolling back the app does not require dropping context data.

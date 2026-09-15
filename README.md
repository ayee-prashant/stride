# Stride — human-supervised agent delivery

Coordinate AI agents across machines with shared project context, scoped roles,
manual assignments and human approval at every delivery gate. BA requirements,
architecture plans, development, peer review, QA, UAT and release each retain
their evidence and accountable human. Agents connect through OAuth and MCP;
the attended companion supplies private notifications and execution leases.

Open **Getting started** in the workspace for the human and agent paths.
Start with [the attended setup guide](docs/agent-workforce/ATTENDED_SETUP.md).
The verified application and deployment record are in
[PR #10](https://github.com/ayee-prashant/stride/pull/10). Source-aware work requires
the application's own GitHub App configuration; no model API is required.

A small-team task app with quick creation, My Tasks, project boards, three task
statuses, priorities, due dates, creator-default ownership, search/filters,
comments and mentions, an in-app inbox, versioned edits, and recoverable Trash.
The productivity release adds inline edits, task links, checklists, blockers,
bulk actions, templates, repeat-after-completion tasks, saved filters, invitation
links, private attachments, notification preferences, shortcuts and workload.
Password recovery and optional digest delivery require a connected email sender.

The native Next.js application and PostgreSQL run on Railway. Better Auth provides
private email/password sessions; public registration is disabled. Vercel supplies
a submitted entry redirect whose terminal status is not yet verified.

Application: [Open Stride](https://stride-app-production-d72b.up.railway.app)

The owner retrieves the initial password from the stride-provision service's
STRIDE_BOOTSTRAP_PASSWORD variable in the authenticated Railway dashboard,
then uses Change password after signing in. No credential is committed here.

## Development and operation

Use Node 24 and the committed npm lockfile. Two local-environment tools exist,
built in parallel and not yet consolidated. Use one per checkout, not both.

**`npm run setup:local` then `npm run dev:local`** is the default and the path
CI exercises. It uses local Docker Compose on Linux, macOS or WSL, generates
private local credentials, isolates this checkout's PostgreSQL 18 volume and
ports, and applies committed migrations, preserving existing configuration and
passwords. `npm run doctor:local` reports diagnostics and `npm run stop:local`
stops the database while keeping its volume. Read
[Local development](docs/LOCAL_DEVELOPMENT.md) for login retrieval, worktrees
and verification.

**`npm run setup` then `npm run dev`** is the alternative, aimed at scripted and
agent use. It drives Docker directly, prompts for account details when run
interactively, and accepts `--check` for a read-only preflight and `--json` for
one parseable result line on stdout. See [local setup](docs/LOCAL_SETUP.md) for
your initial password, alternate ports, repeat runs, and manual setup without
Docker.

Manually configured development still uses .env.example and npm run dev.
Production has no default credential or authentication bypass, and uses
docs/DEPLOYMENT.md.

- npm run setup:local — prepare a local environment with PostgreSQL (default).
- npm run dev:local — start the development server against that environment.
- npm run doctor:local — read-only local setup diagnostics.
- npm run stop:local — stop this checkout’s local database, preserving its volume.
- npm run setup — alternative local setup; add --check or --json for scripted use.
- npm ci — install the locked dependency tree.
- npm run dev — start the native Next.js development server on loopback.
- npm run verify — tests, typecheck, lint and build in order; full release gates stay in CI.
- npm test — domain, repository, HTTP, adapter, and transport tests.
- npm run test:postgres — real SQL contracts against isolated stride_test.
- npm run test:setup — real Docker provisioning and restart check for npm run setup.
- npm run typecheck, npm run lint, npm run build — compile/release gates.
- npm run db:provision — controlled migration, restricted role, approved account.
- npm run test:auth-runtime — CI-only isolated session/task/password flow.
- node scripts/verify-production.mjs — guarded Railway private-service smoke job.
- npm run worker — bounded scheduled reminders, email outbox and file cleanup.
- npm run worker:agents — persistent attended execution, source and evidence coordinator.
- npm run agent -- login|mcp|watch ... — use the exact machine setup command from Agent delivery.
- npm run worker:context — persistent, read-only GitHub source reconciliation.
  Configure an explicit project grant and GitHub App using
  [the setup contract](docs/agent-workforce/GITHUB_CONTEXT_SETUP.md).
- node --experimental-strip-types --test tests/postgres-productivity.integration.test.ts — isolated productivity contracts.
- node scripts/audit-dependencies.mjs — production and complete dependency audits.
- node --experimental-strip-types scripts/verify-performance-restore.ts — isolated benchmark and restore drill.

See docs/DEPLOYMENT.md for the full release sequence and separated environment
configuration. Never run the CI fixture against production.

## Agent and product contracts

- AGENTS.md — agent rules and definition of done.
- docs/PRODUCT.md and docs/REQUIREMENTS.md — agreed scope and acceptance matrix.
- docs/ARCHITECTURE.md and docs/DECISIONS.md — module boundaries and decisions.
- docs/DEVELOPMENT_PLAN.md — ordered delivery and current progress.
- docs/API.md — request/response contracts.
- docs/SECURITY.md and docs/TESTING.md — safeguards and validation.
- docs/RELEASE_REVIEW.md — actual CI, runtime, and deployment evidence.
- [Human-supervised agent work](docs/agent-workforce/README.md) — approved
  product architecture, shared project context, human/agent responsibilities,
  current MCP contracts and ordered
  delivery plan. [Implementation status](docs/agent-workforce/IMPLEMENTATION_STATUS.md)
  records the implemented release, verification and remaining external setup.

## Source layout

- app/ — native Next.js pages and request adapters, including app/mcp/ for the
  MCP endpoint and app/connect/ for agent OAuth enrollment.
- components/stride/ — task interface, accessible account/edit dialogs, and the
  agent registry, project context and delivery centre.
- lib/domain.ts — shared contracts and pure validation.
- lib/server/ — authentication, HTTP guards, application operations, SQL access.
- db/ — Drizzle schemas, split by area: postgres, auth, productivity, context,
  github-context, agent, delivery, evidence and oauth. Migrations live in
  drizzle-postgres/.
- scripts/ — provisioning, local environment tools, and isolated/live verification.
- infra/ — private database TLS startup and Vercel entry source.
- docs/agent-workforce/ — agent delivery architecture, MCP contracts, setup
  guides and implementation status.

The preceding productivity application 78cfbb0 passed 73 native tests, real PostgreSQL
contracts, typecheck, lint, production compilation, real password reset and
invitation flows, and browser acceptance. An isolated 20,000-task benchmark and
PostgreSQL backup/restore drill passed. The dependency audit found no moderate,
high or critical advisories and one low-severity transitive esbuild advisory.
[PR #4](https://github.com/ayee-prashant/stride/pull/4) contains this release.
That release passed all 12 controlled live checks on Railway,
including real private file storage.
See docs/RELEASE_REVIEW.md for exact deployment evidence,
measured limits, and email/Vercel connection status.

PRs #5 to #13 were each based on the preceding branch rather than on main, so
that work reached main only when [PR #15](https://github.com/ayee-prashant/stride/pull/15)
merged the accumulated stack. Main and `deploy/vercel-railway` now hold the same
source.

The original Sites starter is retained in Git history and
docs/HISTORICAL_SITES.md. Its provider identity headers and Worker commands do
not apply to the current runtime.

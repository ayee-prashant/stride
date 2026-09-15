# Stride — focused task management

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

Application: https://stride-app-production-d72b.up.railway.app

The owner retrieves the initial password from the stride-provision service's
STRIDE_BOOTSTRAP_PASSWORD variable in the authenticated Railway dashboard,
then uses Change password after signing in. No credential is committed here.

## Development and operation

Use Node 24 and the committed npm lockfile. For a fresh checkout, start Docker
Desktop and run `npm run setup`, then `npm run dev`. Setup asks for your local
account details, generates private credentials, starts PostgreSQL, and provisions
the database. See [local setup](docs/LOCAL_SETUP.md) for your initial password,
alternate ports, repeat runs, and manual setup without Docker. There is no
default user or authentication bypass. Production uses docs/DEPLOYMENT.md.

- npm run setup — prepare a local development environment with PostgreSQL.
- npm ci — install the locked dependency tree.
- npm run dev — start the native Next.js development server on loopback.
- npm test — domain, repository, HTTP, adapter, and transport tests.
- npm run test:postgres — real SQL contracts against isolated stride_test.
- npm run typecheck, npm run lint, npm run build — compile/release gates.
- npm run db:provision — controlled migration, restricted role, approved account.
- npm run test:auth-runtime — CI-only isolated session/task/password flow.
- node scripts/verify-production.mjs — guarded Railway private-service smoke job.
- npm run worker — bounded scheduled reminders, email outbox and file cleanup.
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

## Source layout

- app/ — native Next.js pages and request adapters.
- components/stride/ — task interface and accessible account/edit dialogs.
- lib/domain.ts — shared contracts and pure validation.
- lib/server/ — authentication, HTTP guards, application operations, SQL access.
- db/postgres-schema.ts and drizzle-postgres/ — PostgreSQL schema/migrations.
- scripts/ — provisioning and isolated/live verification.
- infra/ — private database TLS startup and Vercel entry source.

The productivity application 78cfbb0 passed 73 native tests, real PostgreSQL
contracts, typecheck, lint, production compilation, real password reset and
invitation flows, and browser acceptance. An isolated 20,000-task benchmark and
PostgreSQL backup/restore drill passed. The dependency audit found no moderate,
high or critical advisories and one low-severity transitive esbuild advisory.
[PR #4](https://github.com/ayee-prashant/stride/pull/4) contains this release.
The 919d0d8 release is deployed on Railway; all 12 controlled live checks passed,
including real private file storage. Main remains unchanged.
See docs/RELEASE_REVIEW.md for exact deployment evidence,
measured limits, and email/Vercel connection status.

The original Sites starter is retained in Git history and
docs/HISTORICAL_SITES.md. Its provider identity headers and Worker commands do
not apply to the current runtime.

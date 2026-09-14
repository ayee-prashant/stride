# Stride — focused task management

A small-team task app with quick creation, My Tasks, project boards, three task
statuses, priorities, due dates, creator-default ownership, search/filters,
comments and mentions, an in-app inbox, versioned edits, and recoverable Trash.

The native Next.js application and PostgreSQL run on Railway. Better Auth provides
private email/password sessions; public registration is disabled. Vercel supplies
a submitted entry redirect whose terminal status is not yet verified.

Application: https://stride-app-production-d72b.up.railway.app

The owner retrieves the initial password from the stride-provision service's
STRIDE_BOOTSTRAP_PASSWORD variable in the authenticated Railway dashboard,
then uses Change password after signing in. No credential is committed here.

## Development and operation

Use Node 24 and the committed npm lockfile. Copy .env.example into an untracked
local environment file and configure explicit credentials; there is no default
user or authentication bypass.

- npm ci — install the locked dependency tree.
- npm run dev — start the native Next.js development server on loopback.
- npm test — domain, repository, HTTP, adapter, and transport tests.
- npm run test:postgres — real SQL contracts against isolated stride_test.
- npm run typecheck, npm run lint, npm run build — compile/release gates.
- npm run db:provision — controlled migration, restricted role, approved account.
- npm run test:auth-runtime — CI-only isolated session/task/password flow.
- node scripts/verify-production.mjs — guarded Railway private-service smoke job.

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

The first-sprint release d2e6c48 passed 58 native tests, real PostgreSQL and
session tests, browser task/comment/inbox checks, typecheck, lint, and production
compilation. Railway deployed that exact source; all eight controlled live checks
passed, including comments, overdue notifications, filters and persistence.
[PR #3](https://github.com/ayee-prashant/stride/pull/3) contains the complete scope
and release evidence. Main remains unchanged. The Vercel entry status, public-edge
routing, load measurements, backup restore and dependency audit remain separately
recorded limits. See docs/RELEASE_REVIEW.md for evidence and operating details.

The original Sites starter is retained in Git history and
docs/HISTORICAL_SITES.md. Its provider identity headers and Worker commands do
not apply to the current runtime.

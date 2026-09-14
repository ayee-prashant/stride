# Quality strategy

## Gates

1. TypeScript no-emit type checking.
2. Node test runner: pure domain tests, client transport tests, and repository /
   HTTP integration tests against a fresh SQLite database. The SQLite adapter
   uses its isolated contract schema; real PostgreSQL tests use the committed
   generated production migrations, whose parity is checked in CI.
3. Lint application, tests, and configuration.
4. Native Next.js production build for Railway.
5. Review generated migrations and inspect query plans for common list queries.
6. Post-build security/architecture review, corrections, and gate rerun.
7. Verify terminal deployment status for the exact saved source version.

Tests must cover permissions, malformed inputs, dates, task lifecycle,
idempotent onboarding, version conflicts, archives, pagination, and rate limits.
Fixtures use fictional local identities and isolated in-memory databases only.

## Browser acceptance checklist

Sign in; create a project; title-only create; assign to self; start; complete;
undo; edit in the detail sheet; filter; drag or use status controls; archive;
restore; refresh and confirm persistence. Check keyboard focus, screen-reader
names, 360px layouts, 200% zoom, draft retention on error, and conflicting tabs.
Browser QA is a separate, explicitly requested environment capability; do not
claim that this checklist was executed without evidence.

## Performance budgets (unverified until measured)

Task list API p95 below 500 ms under representative deployment load; primary
quick action feedback within 100 ms, with a visible saving state. Task pages
never exceed 100 records. Test query plans against representative larger fixtures.
Track create/start/complete usability with real users before asserting 10 seconds.

## Available command

Run `node scripts/test.mjs` on Node 24. No package download is required for this
suite. Native TypeScript stripping executes TS but does not perform TypeScript
type checking or compile JSX. Do not confuse the passing suite with a full build.

## PostgreSQL migration checks

The test command also runs postgres-adapter.test.ts against a scripted client.
It verifies driver contract behavior: parameter separation, same-connection
transactions, rollback, resource cleanup, and no automatic write retries. This
does not prove PostgreSQL accepts the SQL or enforces the intended constraints.
Before releasing the new host target, run the existing repository/HTTP contracts
against a fresh PostgreSQL database created from generated target migrations,
including concurrent writes and quota checks. Record that evidence separately.

`npm run test:postgres` requires an isolated loopback PostgreSQL database named
stride_test, supplied as TEST_DATABASE_URL. It applies generated target migrations
and checks onboarding, tenant/role denial, task lifecycle, literal search, real
concurrent compare-and-swap, rollback on a failed audit FK, archive/restore, and
rate-limit SQL. It does not use production credentials or reset a database.
The GitHub workflow provisions that temporary service. An authored test is not
a passing test; see RELEASE_REVIEW.md for what actually ran.

## Native runtime release gates

The verified native baseline uses npm ci and committed PostgreSQL migrations.
Run npm test, npm run test:postgres, npm run typecheck, npm run lint, and npm run
build. The CI-only test:auth-runtime gate starts the built Next.js server against
an isolated PostgreSQL database with a restricted role and generated fixture
account. It covers closed signup, forged identity, real login, task transitions,
reload persistence, stale versions, origin/tenant rejection, password change,
and invalidation of old sessions. The fixture script rejects non-loopback or
non-stride_test databases and must never target production.

The test server allows HTTP only under the existing nonproduction loopback rule.
The production application origin still requires HTTPS, and its PostgreSQL
connections require verified TLS.
Production verification must separately confirm the provider's actual certificate,
canonical origin, health response, authenticated behavior, and persistence.

## Controlled live verification

node scripts/verify-production.mjs rejects other Railway projects/environments
and any destination except the private Stride app on port 8080. It uses an actual
approved account and tests secure cookie attributes, session enforcement,
workspace SSR, task persistence and transitions, conflicts, tenant/origin denial,
and sign-out. It archives its own new QA task and never resets a database or
changes the owner password. It emits only stages/status/check names, not account,
cookie, password, or task contents. This job requires no direct database access.

Do not use this private service check as evidence of public routing or browser
interaction. Keep the CI-only test:auth-runtime fixture guarded and isolated.

## Collaboration release checks

The native suite covers default responsibility, same-workspace mentions,
recipient-only inbox access, stale assignment suppression, atomic notification
failure rollback, archived task/project guards, due buckets/timezones, bounded
catch-up beyond 100 tasks, deduplication, and HTTP origin/body/identifier guards.
The real PostgreSQL suite also checks concurrent overdue sync, comments, inbox
privacy and lifecycle visibility against the generated additive migration.

The CI runtime test extends the real session flow with comment persistence,
self-mention suppression, overdue notification/read acknowledgement and filters.
It calls scripts/test-browser-runtime.mjs against that isolated loopback server.
The browser check uses the runner's installed Chrome and Node's native protocol
client; it adds no package and accepts no production destination. It exercises
quick creation, task sheet, mentions, escaped comment content, unsent-draft
confirmation, board transitions, Trash/restore, inbox-to-task navigation, keyboard
focus and 390px overflow. It records only check names, never cookies/content.
A passing DOM/layout check is not a claim of manual visual or screen-reader QA.

## Productivity release gates

The native suite has 73 tests. Run the additional PostgreSQL contract with
node --experimental-strip-types --test tests/postgres-productivity.integration.test.ts.
It checks concurrent repeat creation, bulk rollback, template/checklist changes,
views/preferences/ownership, one-use invitations and leased encrypted outbox work.
The real-session runtime gate covers invited-account admission, reset token
use/reuse and session invalidation with a fake sender; it sends no email.
Browser coverage adds inline editing, checklist persistence, blockers, direct
link reload, named filters, bulk completion and create/search shortcuts.

The audit script emits scoped severity counts and fails on high/critical runtime
advisories. It does not hide tooling findings. The isolated PG18 performance and
restore script creates 20,000 synthetic tasks, measures 20 warm samples/scenario,
restores pg_dump output into stride_restore, compares 11 table counts and proves
independent write access. These are warm unloaded CI measurements, not a public
latency SLA or proof of configured production backups.


## Shared context and repository sources

The native suite includes context publication/task briefs and the GitHub source
provider, enrollment, durable jobs, request receipts, current access checks and
source-aware brief contracts. Provider requests use deterministic mocked responses
and generated synthetic keys; no real GitHub credential or paid model is needed.

Run `node --experimental-strip-types --test tests/postgres-context.integration.test.ts`
and `node --experimental-strip-types --test tests/postgres-repository-sources.integration.test.ts`
with the same isolated `TEST_DATABASE_URL` used by the existing PostgreSQL gate.
These apply committed migrations and test concurrent publishers, membership
revocation, source-worker claims and source/brief publication races.

The runtime/browser gate verifies the genuine human session → repository enrollment
→ durable source observation → saved task brief → changed commit → access outage
→ recovered source flow. The fixture substitutes only the external observation;
it passes through the real service and runtime-role database. Source snapshots,
events and request receipts must deny UPDATE and DELETE to the runtime role.
The browser captures plain-text source rendering, desktop/mobile layouts and
unavailable cached-content behavior. Installed-App/real-push verification remains
separate from this deterministic CI gate.

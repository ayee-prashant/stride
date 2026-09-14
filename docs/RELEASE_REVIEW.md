# Release review — 2026-09-14

## Productivity release

Application 78cfbb02963cdf0b27bd5b9f9cd644c8213b2c3d passed
[CI run 34864181983](https://github.com/ayee-prashant/stride/actions/runs/34864181983),
job 104043756700: 73 native tests, PostgreSQL contracts, generated migration
parity, typecheck, lint, production build, real invitation/reset/session flows
and expanded browser acceptance. Browser checks covered task creation, checklist,
blocker, direct link reload, inline edits, bulk completion, saved views, shortcuts,
collaboration and 390px layout. No manual visual or public-edge review is claimed.

The dependency refresh removed retired vinext/Vite/Cloudflare packages and their
unused configs. At 15:45:58 UTC both production and full-tree audits reported
zero moderate/high/critical findings and one low transitive esbuild advisory.
Pinned override generation and compilation passed; this is not a zero-advisory
claim. Generated migration 0002_cold_captain_universe.sql is additive; existing
0000/0001 migration bytes are unchanged. Temporary write-capable generation
workflows have been removed. Main is unchanged; PR #4 is the review surface.

Twenty warm samples on 20,000 synthetic tasks in isolated unloaded CI measured
p95: My Tasks 47.35 ms, project board 43.50 ms, overdue high priority 12.79 ms,
and title search 35.69 ms. Responses were about 48.8 KB. PG18 pg_dump/pg_restore
into the separate stride_restore database passed 11 table-count comparisons and
an independent-write check. These are query-level measurements and a synthetic
restore drill, not production load guarantees or verified production backup policy.

The post-build review tightened invitation acceptance against concurrent admin
revocation, template/file permissions against persisted membership, anonymous
invite quotas, pre-buffer upload throttling, and storage quotas during cleanup.
Bulk work and recurrence stay transaction-scoped; removed storage objects have
a durable retry record. Existing accounts/passwords and user work are preserved.

Deployment and production verification are in progress. The private Railway
stride-files bucket is staged. Resend was rechecked and is not connected;
reset/digest code is complete but outbound delivery is unavailable. The Vercel
team-scope and public-edge limitations below remain unchanged.

## First-sprint collaboration completion

The user reaffirmed comments, mentions, notifications and complete organization
as first-sprint scope. Source d2e6c481a82d43e7da80e9fbd3e3220fd3c501a0 passed
[CI run 34851848200](https://github.com/ayee-prashant/stride/actions/runs/34851848200),
job 104001499786: locked install, generated migration parity, 58 native tests,
real PostgreSQL contracts, type checking, lint (one unused test assignment warning),
production compilation, isolated provisioning, authenticated API flow and Chrome
browser acceptance. No dependency or production authentication bypass was added.

The browser exercised title-only quick creation, creator responsibility, task
details, comment/mention selection and persistence, escaped HTML-like comment
text, unsent-draft confirmation, Start/Complete board actions, Trash/restore,
My open tasks, inbox-to-task navigation, keyboard focus and 390px overflow.
It reported no JavaScript runtime/console errors. The first browser run timed out
at Chrome startup before reaching the app; the next full gate passed. The test
harness now gives cold browser startup a bounded 15 seconds. This does not claim
manual visual review, assistive-technology testing, or public-edge acceptance.

Second review after compilation covered composite tenant foreign keys,
recipient-private inbox queries, mention membership checks at the write,
assignment mutation tokens, transaction rollback, same-origin notification sync,
server-date/offset handling, bounded pagination/catch-up, and preserved drafts.
Fixed an ambiguous-error message, concurrent task/comment control states and
workspace switching with a quick-create draft. No credentials or user content
were added to logs. Removed the temporary migration-generation workflow after
its strictly scoped commit; the ordinary CI workflow remains read-only.

Generated additive migration 0001_fat_vapor.sql was committed by pinned Drizzle
at 5bb1adfca40129c3f41ad6244b2610d77415c569. All previous migrations are byte-for-byte
unchanged. Provisioning source 33ee73fd5f30de506f1fad4437632258a51910e6 passed
[CI run 34850811971](https://github.com/ayee-prashant/stride/actions/runs/34850811971).
Railway provisioning deployment 535de4ca-4d68-43f6-99f4-9e62d7d77051 emitted
`database_provisioned`, `ownerCreated=false`, `runtimeRole=stride_app` at
13:54:18 UTC. Existing accounts, passwords and task rows were preserved.

Automatic review initially classified the provisioning ref update as a possible
rollback. Read-only GitHub comparison proved it was four commits ahead, zero
behind the actual deployed branch, with no provisioning-script or old-migration
changes. The evidence-backed fast-forward was then approved. No force push or
default-branch update was used.

Railway web deployment d9e39a1e-9f0a-47a3-aea8-aa0243e86312 is SUCCESS at
13:56:39 UTC and identifies the tested d2e6c481a82d43e7da80e9fbd3e3220fd3c501a0
source. The private live job 9ca90315-4409-47fb-a1fb-d48a802f6b69 emitted
`production_verified` at 13:58:14 UTC with all eight checks: readiness, closed
enrollment, sign-in, workspace, task persistence, comments/inbox, origin/tenant
denial and sign-out. It used the approved demo account, confirmed the new comment,
overdue notification/read and filter paths, and archived its own QA task.
The job's source is 33ee73f; its verification script is identical in d2e6c48.
Its configured start command was restored to npm run db:provision, restart NEVER.

The Vercel team-scope/public-edge limitations below remain unchanged. This
release adds no external delivery or enrollment expansion. The source is reviewable in
[PR #3](https://github.com/ayee-prashant/stride/pull/3). Main is unchanged.

## Previous verified application

Application source c39487f01083aa945683075f89a4c7b5af7f0cfe passed GitHub Actions
[run 34831794534](https://github.com/ayee-prashant/stride/actions/runs/34831794534),
job 103936585084. The gates passed: clean npm ci, generated/committed migration
parity, 48 native tests, real PostgreSQL contract tests, typecheck, lint,
Next.js production build, isolated account provisioning, and the complete
authenticated Next.js/PostgreSQL runtime flow.

The runtime test used a restricted database role and real hashed credentials.
It checked closed registration, forged identity rejection, login, workspace
bootstrap, rendered workspace HTML, task create/complete/reopen/reload,
stale-version rejection, archive/restore, origin and tenant denial, password
change, old-password rejection, sign-out, and old-session invalidation.
These are API/SSR checks, not browser interaction tests.

## Production evidence

- Railway web deployment f3d48a4a-61dd-47ec-8210-297c8f83d57d is SUCCESS and
  identifies exactly c39487f01083aa945683075f89a4c7b5af7f0cfe. Its production
  build passed and /api/health succeeded at 10:26:47 UTC. The readiness handler
  queries the auth table through the restricted runtime role with verified TLS.
- PostgreSQL deployment 6e1ec0ac-b452-45fb-b835-bd165be01c30 issued a leaf
  certificate for postgres.railway.internal using the existing volume's CA/key
  and started PostgreSQL 18.6. No private key left the database container.
- Provisioning deployment a25ecf70-712b-45a8-91ba-db00aa4ca48f emitted
  database_provisioned with ownerCreated=true and runtimeRole=stride_app at
  10:24:36 UTC. Its source 27dd06bca30a44a27cc3d75b736d8c9a2da2db92 has the
  exact same tree as the tested application. Migrations, role grants, and the
  real owner account were created successfully through verified database TLS.
- The app and database run in sfo. PostgreSQL uses a persistent 5000 MB volume
  and private networking. Web runtime variables contain no migration credential
  or bootstrap password.
- Production verification deployment 74ff60fc-3815-4297-804d-e92bf56ecb57 used
  source 3417332693c0507f590555dbd07b30ccc7eed3fa and emitted production_verified
  at 10:45:43 UTC. All seven checks passed: readiness, closed enrollment, real
  sign-in with Secure/HttpOnly/SameSite cookie assertions, workspace SSR,
  durable task transitions and stale-write rejection, origin/tenant denial,
  and sign-out/session invalidation. Its own new verification task was archived.
  The job accessed only stride-app.railway.internal:8080 in the dedicated
  production environment. No owner password change or data reset was performed.
- Operations source 3417332 also passed the entire CI suite in
  [run 34834478104](https://github.com/ayee-prashant/stride/actions/runs/34834478104),
  job 103945077773, including the new production-script syntax check. Runtime
  application files are unchanged from the deployed and live-verified c39487f.
- After the one-off verification finished, the provisioning service's configured
  start command was restored to npm run db:provision with restart policy NEVER.
  It has no public domain or recurring verification schedule.

## Vercel and public checks

The Vercel entry redirect was submitted as production deployment
dpl_C4JL5hun7wMVYJfEgmH7PjE6kGNo. The connector returned INITIALIZING and alias
https://stride-prashant-sharma-s-projects1.vercel.app. Its source is committed
under infra/vercel/. It redirects to the canonical Railway application and
contains no application secrets.

Vercel status inspection returns 403 requiring reauthentication for team scope
prashant-sharma-s-projects1. Terminal Vercel status is therefore unverified.
The available public web checks reject the Railway and Vercel addresses as
non-retryable unsafe URLs. No alternate fetch or browser was used to bypass
those denials. Public DNS/CDN routing and browser interaction remain unverified.

## Second architecture and security review

Reviewed after compilation: real library-owned sessions, persisted allowlist
checks, per-request workspace authorization, same-origin mutation enforcement,
prepared SQL, bounded queries/pools/timeouts, immutable migrations, optimistic
versions, recoverable archives, private response caching, secure cookies, safe
errors, and credential separation. No public registration, header identity
fallback, insecure TLS override, production fixture credentials, or plaintext
password logging was introduced.

Corrections made during compilation and deployment included missing icon exports,
generic test typing, stale frontend response isolation, Zod 4 compatibility,
composite unique constraints before dependent foreign keys, hostname-correct
database TLS, the existing PostgreSQL database name, and deployment source
verification.

The first Railway create-deployment calls accepted a release branch in service
configuration but actually deployed old main commit fa813c9. Redeploy reused
that snapshot. Earlier claims that deployment 2b55f23a was the tested cfdc751
baseline were incorrect. A normal push to the configured branch and fresh
configuration deployment resolved it; source hashes and actual log events were
then checked. A one-off job's provider SUCCESS alone is not proof it completed:
structured JSON events may appear in log attributes with an empty message.

## Remaining limits

Browser, keyboard, screen-reader, mobile, and drag/drop acceptance checks have
not run in the current hosted environment. Load/latency budgets are unmeasured;
there is no enterprise-scale or SLA claim. Backup restore and a dated dependency
vulnerability audit have not been verified. Self-service emailed account recovery
is deferred. The initial audience is the approved owner; adding team accounts
requires controlled enrollment.

The earlier native baseline cfdc751 passed run 34828808360; initial Sites-only
source and registry blocks are historical and do not describe the current
compiled Railway runtime. See DEPLOYMENT.md for current operating instructions.

## Source delivery

The complete runtime, operations, and release evidence are available in
[PR #2](https://github.com/ayee-prashant/stride/pull/2), marked ready for review.
PR #1 is closed as superseded; its deployment branch is retained.
Automatic approval review rejected merging PR #2 into main because it requires
explicit authorization for that default-branch mutation. No direct push or other
method was used to bypass the rejection. The already deployed c39487f app and
its persisted database remain operational independently of that merge.

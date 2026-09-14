# Architecture decisions

## ADR-011: approved team productivity expansion

Accepted. Keep the modular monolith and compose a productivity service around
the existing repository. Version task/checklist/view/template edits. Use one
transaction for bulk changes and recurrence creation. A completed repeating task
creates exactly one new occurrence, with a unique predecessor reference; reopen
and re-complete never create duplicate successors. Templates copy values and
checklists, not mutable references to past work. Personal filters and notification
preferences are scoped to the authenticated member.

Admin-issued invitation tokens are high-entropy capabilities stored only as
hashes. Acceptance checks expiry, current admin authority, exact email identity,
single use, and membership limits in a transaction. It can enroll a new account
using Better Auth's maintained password hashing, never overwrite an existing
credential. Persisted invitation admission supplements the operator allowlist.
Email delivery uses a bounded durable outbox and a verified provider; missing
provider configuration is an explicit unavailable state. Private S3-compatible
storage holds attachment bodies; only metadata belongs in PostgreSQL.

## ADR-012: remove the superseded host build dependencies

The release audit found high-severity advisories in the unused vinext/Vite/
Cloudflare development stack retained from the original Sites starter. The
requested production runtime is native Next.js on Railway. Retire those unused
dependencies and keep historical integration examples outside the active source
tree. Refresh compatible transitive fixes. The deprecated Drizzle TypeScript
loader pulls an affected esbuild; use a scoped, pinned esbuild override and
verify migration generation, TypeScript, builds and real database migrations.
Do not adopt the audit command's suggested downgrade of Drizzle's schema tool.

## ADR-001: modular monolith

Accepted. A single deployable app keeps the first release operable. Separate
domain, request boundary, repository, and UI modules; do not add microservices,
CQRS, event sourcing, or generic dependency injection without concrete need.

## ADR-002: platform identity and D1

Superseded by ADR-007 and ADR-009. Originally accepted. Use the supported host's identity and durable SQL capabilities. Keep
provider access behind small server helpers. No browser-only source of truth,
password storage, or ad-hoc auth framework. Private deployment is the default.

## ADR-003: prepared SQL and generated schema migrations

Accepted. Drizzle owns schema definitions/migrations; application SQL is explicit,
parameterized, bounded, and reviewable. The repository accepts a small database
interface for real-SQL integration tests without production access.

## ADR-004: recoverable edits

Accepted. Compare-and-swap integer versions prevent overwrite conflicts.
Archive/restore replaces hard-delete. UI only confirms server-accepted results;
optimistic visual feedback never becomes unconfirmed authoritative data.

## ADR-005: fixed workflow

Accepted. Three statuses and three priorities. Due dates are optional calendar
dates; task ownership is optional. A visible status action remains available
where drag-and-drop is supported so keyboard/touch use is not blocked.

## ADR-006: small-team release, explicit scale limits

Accepted. Indexed, bounded SQL and stateless compute are a growth foundation,
not evidence of unlimited scale. Measure before sharding or adding a cache.

## ADR-007: requested Vercel and Railway migration

Superseded in part by ADR-009; retained as the original requested target. The user's explicit host request
supersedes ADR-002's deployment-provider choice, while preserving its requirement
for verified identity, durable SQL, and private task data. Run native Next.js on
Vercel and PostgreSQL on Railway. Keep UI/API same-origin and retain the existing
repository boundary. Sites-supplied identity headers are not trusted on these
hosts. Adopt a maintained session/authentication library with closed enrollment;
never simulate the original dispatch identity in production.

The PostgreSQL adapter and schema are initial preparation, not a verified
database migration or runtime switch. See DEPLOYMENT.md for remaining work.

## ADR-008: Better Auth and owner-approved GitHub accounts

Superseded by ADR-009. Originally selected for the requested native Next.js runtime. Better Auth owns OAuth state,
session cookies, and session persistence. GitHub owns passwords and account recovery.
No email/password registration is exposed. Enrollment checks immutable numeric
GitHub IDs, initially the repository owner's ID, configured explicitly at the host.
Session authorization rechecks the persisted provider account on every request;
no editable profile claim, email, or identity header grants access. Auth records
use separate tables from domain users. A dedicated OAuth application and host
secrets still need provisioning; the code fails closed until configuration exists.

## ADR-009: deploy through available Railway access with closed password sign-in

Accepted for this release after access checks on 2026-09-14. Vercel project
management repeatedly returns 403 and no teams; the separate GitHub OAuth client
has not been provisioned. Railway provides authenticated repository builds and private database access;
the completed source and deployment checks are recorded in RELEASE_REVIEW.md. Run the app and PostgreSQL there, with a Vercel
entry URL redirecting to the canonical Railway HTTPS address.

This supersedes ADR-007's placement of app compute and ADR-008's OAuth provider,
while retaining the modular monolith, server sessions, private enrollment,
tenant authorization, verified TLS, and same-origin API. Better Auth provides
email/password authentication and scrypt hashing. A controlled provisioning job
creates the first credential account and restricted runtime database role.
Credentials never enter Git. Public signup is disabled. A browser email change
cannot change the server-managed allowlist. Password changes revoke other sessions.
The operator can provision additional approved accounts through the same job.

Build changes in build/railway-runtime and verify them before advancing the
deployed deploy/vercel-railway branch. The database job has no public endpoint;
the app has no migration credential. No extra application microservice is added.

## ADR-010: complete the reaffirmed collaboration MVP

Accepted after the user restated the first-sprint requirements. Comments, mentions,
assignment/overdue notifications, and full filters/sorting belong in this release.
Use two additive PostgreSQL tables and the existing modular repository boundary.
Comments, activity, and mention notifications commit atomically. Notifications
are recipient-scoped and recheck persisted workspace/task access on every read.

Delivery is an in-app inbox, refreshed on focus and periodically while visible.
Overdue reminders synchronize through an authenticated same-origin mutation,
using server time and a bounded viewer timezone offset. A unique event key
prevents duplicate reminders for the same task, due date, and responsible user.
No outbound email, push service, scheduler, or message queue is needed for v1.

Quick creation defaults to the authenticated creator. Existing tasks without
an assignee retain the creator as their responsible person. Delete uses the
existing archive timestamp and a Trash/restore interface. The built-in saved
My open tasks view resets filters with one click and is the initial landing view.

# Architecture decisions

## ADR-001: modular monolith

Accepted. A single deployable app keeps the first release operable. Separate
domain, request boundary, repository, and UI modules; do not add microservices,
CQRS, event sourcing, or generic dependency injection without concrete need.

## ADR-002: platform identity and D1

Accepted. Use the supported host's identity and durable SQL capabilities. Keep
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

Target selected; implementation in progress. The user's explicit host request
supersedes ADR-002's deployment-provider choice, while preserving its requirement
for verified identity, durable SQL, and private task data. Run native Next.js on
Vercel and PostgreSQL on Railway. Keep UI/API same-origin and retain the existing
repository boundary. Sites-supplied identity headers are not trusted on these
hosts. Adopt a maintained session/authentication library with closed enrollment;
never simulate the original dispatch identity in production.

The PostgreSQL adapter and schema are initial preparation, not a verified
database migration or runtime switch. See DEPLOYMENT.md for remaining work.

## ADR-008: Better Auth and owner-approved GitHub accounts

Selected for the requested native Next.js runtime. Better Auth owns OAuth state,
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
has not been provisioned. Railway successfully built the tested Next.js revision
from the private repository. Run the app and PostgreSQL there, with a Vercel
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

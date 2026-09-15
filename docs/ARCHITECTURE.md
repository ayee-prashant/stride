# Solution architecture

## System

The approved productivity extension is specified in PRODUCTIVITY_RELEASE.md.
An additional job runs the same application modules for reminders, encrypted
email delivery and object cleanup. It processes a bounded member page using a
persisted cursor and lease, with deduplicated notifications and delivery keys.
The web and job use the restricted database role; migrations stay separate.
Private S3 storage holds attachment bodies, with transactional metadata/quota
reservations and compensating cleanup. No task content is stored in a public CDN.

React + TypeScript with native Next.js App Router, running beside PostgreSQL on
Railway. Vercel supplies an entry address that redirects to the canonical HTTPS
application origin. This avoids cross-origin cookies and removes runtime secrets
from Vercel. Drizzle owns schema changes. Better Auth verifies passwords and
persisted sessions; enrollment is closed and approved emails are configured at
the host. A separate job provisions the owner and runs migrations. One
modular monolith is appropriate for the first release; services can be extracted
later only when measured traffic or ownership boundaries justify the cost.

## Dependency direction

UI -> same-origin HTTP API -> application service/repository -> PostgreSQL.
The domain module contains validation and pure task/date rules, and imports no
framework, database, or browser code. HTTP handlers authenticate, apply mutation
guards, validate, delegate, and map typed failures to safe responses. Queries and
mutations live in the repository, not components. The database is passed into it;
SQLite exercises portable repository contracts and a separate PostgreSQL suite
checks the target SQL and generated migrations.

## Ownership and consistency

Users are keyed by Better Auth's persisted user ID. Every request revalidates its
database session and persisted credential account against the server allowlist. Workspace membership
authorizes access; authentication alone does not. Projects and tasks include
workspace_id, and all task queries are scoped. One workspace may contain many
projects; each task belongs to one project and has a responsible person: the selected
workspace member or its creator. Quick creation defaults to the creator.
The personal workspace is provisioned idempotently after authenticated bootstrap.

Integer record versions implement compare-and-swap updates. Stale updates return
409; drafts are preserved. Archive replaces deletion. Multi-statement operations
use one PostgreSQL transaction on one checked-out connection. Cross-tenant references are rejected in the service and
database constraints protect relational integrity.

## Performance design

- Bounded task pages (maximum 100; UI pages of 50) with explicit previous/next
  navigation and partial-result labels; no all-task downloads.
- Index workspace/project/archive and workspace/assignee/archive paths.
- Fetch shared workspace/member/project metadata once per workspace change.
- No per-task user lookup; join display metadata in the list query.
- Stateless Node.js application instances, private no-store responses, no cross-user application cache.
- Three connections per warm process, with connection, idle, and statement timeouts.
- Cap request bodies and field lengths. No uploaded binary blobs in the database.
- Refresh after mutations and on focus; no aggressive background polling.

## Scaling path and limits

Initial target: small teams, hundreds to low thousands of tasks per workspace.
Before materially larger traffic: measure query plans, p95 latency, response
bytes, error rate, and database contention. Database capacity is finite;
partition independent tenant data if measured contention warrants it. Move
notification delivery to a queue if measured load or external delivery requires it. Do not
claim enterprise scale or a latency SLA without deployed load tests.

## Collaboration consistency

Comments, their audit entries and member mention notifications share one
transaction. Assignment notifications use the task mutation token, so stale
writes cannot emit alerts. Mention membership is checked before and inside the
write. Inbox queries always bind the authenticated recipient and workspace;
admins have no cross-recipient inbox endpoint.

An additive migration introduces comments and notifications, composite tenant
foreign keys, and recipient/created-time/read-state indexes. Due indexes support
assignee and creator fallback paths. Comment/inbox pages contain at most 50 rows;
no per-row queries or rich-HTML rendering are used. Overdue catch-up inserts at
most 100 missing reminders and uses a unique event key for concurrent tabs. It
runs on same-origin inbox sync, not GET; a visible tab polls every 30 seconds.
Server time plus the viewer's bounded offset determines the calendar date.

My open tasks is a built-in saved view, so it survives browser/device changes
without adding a custom view model. Priority sorting applies across the filtered
result before pagination; default due-date sorting retains the daily sections.

## FAQ usability increment

Task lists and the newest comment page revalidate after 30 seconds while visible
and online, using a cancellable read loop with no overlapping reads and bounded
backoff. Task edits, dialogs and bulk selections pause list replacement. Transient
failures retain the last view with an explicit delayed-update message; access
failures clear it. Comment drafts and historical-page positions are retained.
Getting started is an optional guide; My Tasks remains the landing page.

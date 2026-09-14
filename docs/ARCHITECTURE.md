# Solution architecture

## System

React + TypeScript with Vinext App Router, running as an ESM Cloudflare Worker.
D1 supplies durable relational storage; Drizzle schema generation owns schema
changes. Sites supplies authenticated identity and private deployment. One
modular monolith is appropriate for the first release; services can be extracted
later only when measured traffic or ownership boundaries justify the cost.

## Dependency direction

UI -> same-origin HTTP API -> application service/repository -> D1.
The domain module contains validation and pure task/date rules, and imports no
framework, database, or browser code. HTTP handlers authenticate, apply mutation
guards, validate, delegate, and map typed failures to safe responses. Queries and
mutations live in the repository, not components. D1 is passed into it so the same
application behavior can be tested against an isolated SQLite adapter.

## Ownership and consistency

Users are keyed by the platform's stable per-Site user ID. Workspace membership
authorizes access; authentication alone does not. Projects and tasks include
workspace_id, and all task queries are scoped. One workspace may contain many
projects; each task belongs to one project and optionally one workspace member.
The personal workspace is provisioned idempotently after authenticated bootstrap.

Integer record versions implement compare-and-swap updates. Stale updates return
409; drafts are preserved. Archive replaces deletion. Multi-statement operations
use atomic D1 batches. Cross-tenant references are rejected in the service and
database constraints protect relational integrity.

## Performance design

- Bounded task pages (maximum 100; UI pages of 50) with explicit previous/next
  navigation and partial-result labels; no all-task downloads.
- Index workspace/project/archive and workspace/assignee/archive paths.
- Fetch shared workspace/member/project metadata once per workspace change.
- No per-task user lookup; join display metadata in the list query.
- Stateless Workers, private no-store responses, no cross-user application cache.
- Cap request bodies and field lengths. No uploaded binary blobs in D1.
- Refresh after mutations and on focus; no aggressive background polling.

## Scaling path and limits

Initial target: small teams, hundreds to low thousands of tasks per workspace.
Before materially larger traffic: measure query plans, p95 latency, response
bytes, error rate, and database contention. D1 write throughput is finite;
partition independent tenant data if measured contention warrants it. Move
notification work to a queue when notifications actually enter scope. Do not
claim enterprise scale or a latency SLA without deployed load tests.

# Implementation review and release gates

Status: first-release source authored; NOT compiled or deployed.

## Source completed in this iteration

- Shared TypeScript task/project/member contracts and strict validation.
- Drizzle schema with tenant-consistent foreign keys, indexes, and status checks.
- D1-compatible repository with idempotent bootstrap, admin/member checks,
  bounded task queries, versioned edits, archive/restore, and atomic audit writes.
- Platform-authenticated page and HTTP adapter; same-origin mutation protection,
  32 KiB streaming body cap, write quota, private no-store responses, safe errors.
- My Work, project board, task editor, project administration, people management,
  filtering/search, explicit pagination, keyboard-accessible status controls,
  drag-and-drop source, loading/empty/error states, and responsive styling.
- Client cancellation, 30-second request timeout, draft-preserving failures,
  explicit edit-conflict recovery, and completion undo using the saved version.
- Optional agent tool stages the visible task composer without claiming to save.

## Evidence actually obtained

`node scripts/test.mjs` on Node 24: **35 tests passed; 0 failed**.

Coverage includes domain validation, date-only urgency, SQL tenant isolation,
role denial, forged assignment, task lifecycle, archive/restore, pagination,
literal search/SQL metacharacters, rate windows, database foreign keys,
query-plan index selection, HTTP identity/origin/body checks, and client transport.
Additional tests simulate an update between read and write, prove no phantom
audit record after that conflict, and verify rollback when audit insertion fails.

Node syntax checks passed for the framework-independent TS modules, Drizzle
schema source, and HTTP adapter. These checks strip types: they are not a full
TypeScript typecheck and do not validate JSX, third-party APIs, or the Worker.

Repository tests used **tests/fixtures/schema.sql**, not generated production
migrations. The adapter automatically prefers generated migrations when present.
Drizzle-to-fixture parity remains an explicit release gate.

## Review findings fixed

1. Increased the body cap from 16 to 32 KiB so valid long Unicode descriptions
   fit while retaining bounded memory usage.
2. Lost mutation responses now say the write may already have succeeded; the
   client preserves its draft and never retries a mutation automatically.
3. Malformed percent-encoded path IDs now produce 400 instead of a generic 503.
4. Existing membership role updates remain possible when membership caps are
   reached; the owner is still protected from role changes.
5. Audit insertion uses a unique mutation token within the same atomic batch,
   preventing stale edits from emitting misleading activity.
6. Personal workspace names identify their owner when users belong to more
   than one workspace.
7. Manual JSX review corrected a missing conditional fallback in the work view.
   Full JSX parsing/compilation is still pending; this correction is not a build pass.
8. Mobile navigation closes after selection and the mobile task-row layout keeps
   due dates visible. Both changes still require browser verification.

## Blocked / not verified

The earlier required installer exited 65 with
`GET https://registry.npmjs.org/@babel%2Fcore: Forbidden - 403`.
Dependencies remain unavailable. This turn did not retry the denied request,
change the registry, replace the installer, or modify dependency manifests/locks.

Not run: framework type checking, lint, Drizzle migration generation/parity,
React/Worker production compilation, browser/keyboard/screen-reader QA, real
hosted sign-in, WebMCP registration/execution, D1 runtime integration, deployed
latency/load tests, dependency vulnerability audit, backup/restore, or deployment.
There is no live application URL. Source is not production-certified.

## Remaining implementation/release review

- Execute framework checks after a successful authorized installation; fix any
  JSX, component API, hook-lint, or server-runtime issues they reveal.
- Generate/inspect migrations and rerun the complete SQL suite against them.
- Validate the host preserves the request origin used by the mutation guard.
- Validate mobile navigation and task metadata visibility in a real browser.
- Validate the accessible task sheet, nested discard confirmation, and drag/drop.
- Verify the agent tool in a supported browser; currently unavailable here.
- Offset pagination can shift under concurrent changes; use a fresh view when
  reviewing a changing backlog. Keyset pagination is a later measured refinement.
- Role changes currently use admin-authorized upsert rather than a membership
  version. Add audited/versioned membership administration before broader rollout.
- Current activity records contain action/actor/time, not full before/after data.
- Security headers are authored, not verified on deployed responses. A nonce-
  compatible CSP and operational monitoring need a hosted security review.

## Resume safely

Reuse this project and its saved source; do not initialize another Site. Read
AGENTS.md and the Sites setup skill. Once authorized registry access exists,
resume the original preferred-pnpm installer attempt, retaining its lockfile
policy. Complete the remaining gates, correct findings, rerun checks, and only
then create and publish the immutable release version.

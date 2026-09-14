# Ordered development plan

Each slice includes validation and tests, rather than postponing security to the end.

| Order | Slice | Exit criterion |
|---|---|---|
| 1 | Agent setup, product contract, ADRs | Explicit scope, boundaries, commands, release gates |
| 2 | Schema, identity, memberships | Isolated authenticated workspace, idempotent onboarding |
| 3 | Project/task vertical flow | Create -> assign -> start -> complete -> reopen persists |
| 4 | Daily work UX | My Work, detail editing, board and quick actions |
| 5 | Organization and recovery | Filters, search, pagination, archive/restore, edit conflicts |
| 6 | Hardening | Unit/integration tests, permissions, bounds, lint, typecheck, build |
| 7 | Release | Second review, documented limits, immutable source, private deployment |

## Change control

P0: identity/authorization, durable CRUD, My Work, board, recovery, accessibility,
and validation. P1: drag-and-drop, title search, activity display. These are
bounded enhancements after P0 is functioning. Never cut permission checks or
input validation to meet a deadline. Future sprints remain in PRODUCT.md.

## Agent work protocol

1. Read AGENTS.md and relevant module contracts.
2. Name the smallest user-observable change and its acceptance check.
3. Implement using established modules and primitives.
4. Test happy path, malformed input, permission denial, and failure recovery.
5. Inspect the diff for scope creep, secret leakage, and migration changes.
6. Update the release review with evidence, not optimistic completion language.

The author must conduct a second architecture/security review after compilation,
fix findings, and rerun affected gates before release.

## Current progress

- Slices 1–6: application c39487f passed the 48-test suite, real PostgreSQL
  contract tests, migration parity, typecheck, lint, production build, and full
  authenticated runtime flow in GitHub Actions run 34831794534.
- Slice 7: that exact application is healthy on Railway, with a restricted
  database role, verified private database TLS, and separately provisioned owner.
- The production smoke job passed all seven checks at 10:45:43 UTC, including
  real sign-in, persistence, permission denials, and sign-out. Its QA task is
  archived. The immutable source and log evidence are in RELEASE_REVIEW.md.
- Vercel accepted the entry redirect submission but its status API denies the
  team scope; public-edge and browser checks remain unverified.
- Future work must preserve the approved private audience and use this release
  process. Preserve completed task flows while implementing the user-reaffirmed collaboration scope.

PR #2 contains the reviewable release. Its main-branch merge was rejected by
automatic approval review as requiring explicit merge authorization; deployment
and live verification are complete on the existing Railway release branch.
Vercel terminal status and public-edge/browser verification remain the stated
access limitations, not unfinished application implementation.

## Reaffirmed first-sprint completion

1. Restore the agreed requirement matrix and acceptance checks.
2. Add additive comment/inbox schema, authorization, and atomic event writes.
3. Add task discussion with mentions and the in-app notification inbox.
4. Complete ownership defaults, task filters/sorts, My open tasks, and always-visible creation.
5. Run SQLite and PostgreSQL contracts, real session flows, typecheck, lint, and build.
6. Review security and migration compatibility; provision and deploy the tested source.

This is the next uncompleted slice. No epics, reporting, custom workflows,
external integrations, or AI features are added. Main-branch merging remains a
separate approval boundary; the authorized release branch can deploy this work.

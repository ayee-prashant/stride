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

- Slices 1–6: native Next.js baseline cfdc751 passes the 48-test suite, real
  PostgreSQL contract test, migration parity, typecheck, lint, and production
  build in GitHub Actions run 34828808360.
- Railway built and started that exact baseline from the private repository.
- Current release work: private password sign-in, account password changes,
  restricted runtime role, separately controlled provisioning, verified private
  database TLS, and an authenticated runtime test.
- The deployment branch stays on the tested baseline while the new work passes
  CI in build/railway-runtime.
- Release remains incomplete until provisioning, readiness, live session/task
  behavior, and the final public URL are verified. Update RELEASE_REVIEW.md with
  actual evidence after the next compilation and deployment.

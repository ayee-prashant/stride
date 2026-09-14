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

- Slices 1–3: source complete and covered by the available Node/SQLite tests.
- Slices 4–5: frontend source authored and connected to the API, not compiled or
  exercised in a browser yet.
- Slice 6: 35 native tests passed and a second source review completed. Full
  typecheck, lint, schema migration parity, framework build, and hosted checks
  are blocked on the unresolved dependency installation.
- Slice 7: source checkpoint only. No deployment until all required gates pass.

## Requested hosting migration

Vercel plus Railway is now the target for the user's deployment request.
See DEPLOYMENT.md for the migration sequence. PostgreSQL adapter/schema source
and portable repository queries are prepared; 44 native tests pass. Provider
authorization, session authentication, pool/runtime wiring, generated migrations,
real PostgreSQL tests, compilation, and deployment remain outstanding. Keep the
migration in a draft branch until its complete release gates pass.

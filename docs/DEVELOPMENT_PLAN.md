# Ordered development plan

## Local development follow-up — 2026-09-15

The user selected local setup automation as the next change. Acceptance: a fresh
checkout can run `npm run setup`, provide a local email/name, and receive a
provisioned PostgreSQL environment with generated credentials. Reruns preserve
configuration, account passwords and database data; failures explain recovery.
Implementation and regression tests are present. See LOCAL_SETUP.md and the
current RELEASE_REVIEW.md entry for verification and environment limitations.

Each slice includes validation and tests, rather than postponing security to the end.

The active next release is ordered in PRODUCTIVITY_RELEASE.md. Its ten approved
improvements, reliability checks, and deployment are in progress. The completed
first-sprint evidence below remains the regression baseline.

| Order | Slice | Exit criterion |
|---|---|---|
| 1 | Agent setup, product contract, ADRs | Explicit scope, boundaries, commands, release gates |
| 2 | Schema, identity, memberships | Isolated authenticated workspace, idempotent onboarding |
| 3 | Project/task vertical flow | Create -> assign -> start -> complete -> reopen persists |
| 4 | Daily work UX | My Tasks, detail editing, board and quick actions |
| 5 | Collaboration | Comments, mentions, assignment/overdue inbox, activity |
| 6 | Find and organize | Complete filters, due/priority sort, My open tasks |
| 7 | Hardening and release | Tests, typecheck, lint, build, second review, tested deployment |

## Change control

P0: identity/authorization, durable task CRUD, ownership, My Tasks, board,
comments, mentions, in-app notifications, complete search/filters, recovery,
accessibility, and validation. Drag/drop supplements keyboard status controls. Never cut permission checks or
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

## Previous release evidence

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

All six completion steps are complete. Full CI and isolated browser acceptance
passed on d2e6c481a82d43e7da80e9fbd3e3220fd3c501a0, which is deployed on Railway.
The additive migration and all eight private live checks passed. See RELEASE_REVIEW.md. No epics, reporting, custom workflows,
external integrations, or AI features are added. Main-branch merging remains a
separate approval boundary; the authorized release branch can deploy this work.

## Productivity implementation status

All five slices in PRODUCTIVITY_RELEASE.md are implemented. Source 78cfbb0
passed the complete CI gate, real-session invitation/reset tests and expanded
browser checks. Migration, app/private storage and worker deployment are complete on 919d0d8;
all 12 controlled live checks passed. Email delivery remains gated by a verified sender;
record final infrastructure evidence in RELEASE_REVIEW.md.

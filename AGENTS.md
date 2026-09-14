# Stride: instructions for development agents

## Read first

Read README.md, docs/PRODUCT.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT_PLAN.md,
docs/SECURITY.md, and docs/TESTING.md before changing product code. Read
docs/DECISIONS.md before introducing a new dependency or architectural pattern.
The active scope is the user-approved team productivity release in
docs/PRODUCTIVITY_RELEASE.md. Preserve the completed first-release flows.

## Operating rules

- Implement the next uncompleted vertical slice in DEVELOPMENT_PLAN.md.
- Keep HTTP handling, business rules, persistence, and UI separate. Prefer simple
  composition over inheritance, microservices, generic frameworks, or speculative abstractions.
- Never trust client user IDs, workspace IDs, roles, assignees, or record versions.
  Validate input and authorize every server operation against persisted membership.
- Use prepared SQL, bounded queries, indexed access, and optimistic concurrency.
- Never log tokens, cookies, task contents, email addresses, or raw request bodies.
- No real credentials, development auth bypass, or production data in fixtures.
- Preserve user work, lockfiles, Site identity, migration history, and unrelated changes.
- No destructive schema/data operations or audience expansion without explicit authority.
- Use the provided accessible UI primitives. Support keyboard, small screens,
  loading, empty, unavailable, conflict, and success states.
- Save only confirmed server changes in authoritative UI state. Preserve drafts
  after failures. Do not automatically retry non-idempotent mutations.
- No arbitrary delegation. If delegation is explicitly authorized, assign bounded,
  nonoverlapping tasks; only the Site-owning agent edits/publishes the Site.

## Definition of done

Run type checking, automated unit/integration tests, lint, and the production
build. Review the diff against SECURITY.md and record actual results and known
limitations in docs/RELEASE_REVIEW.md. Never describe an unrun test as passed.
Deploy only an immutable, tested source version through the host workflow
explicitly chosen by the user. The current requested Vercel/Railway migration
is described in docs/DEPLOYMENT.md; consult docs/RELEASE_REVIEW.md for the
exact tested application and deployment evidence.
Scalability and performance budgets are targets until measured, not guarantees.

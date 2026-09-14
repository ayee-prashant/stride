# Quality strategy

## Gates

1. TypeScript no-emit type checking.
2. Node test runner: pure domain tests, client transport tests, and repository /
   HTTP integration tests against a fresh SQLite database. Generated migrations
   are preferred automatically. Until Drizzle can run, an explicitly identified
   test-only schema fixture is used; production migration parity is unverified.
3. Lint application, tests, and configuration.
4. Production ESM Worker build.
5. Review generated migrations and inspect query plans for common list queries.
6. Post-build security/architecture review, corrections, and gate rerun.
7. Verify terminal deployment status for the exact saved source version.

Tests must cover permissions, malformed inputs, dates, task lifecycle,
idempotent onboarding, version conflicts, archives, pagination, and rate limits.
Fixtures use fictional local identities and isolated in-memory databases only.

## Browser acceptance checklist

Sign in; create a project; title-only create; assign to self; start; complete;
undo; edit in the detail sheet; filter; drag or use status controls; archive;
restore; refresh and confirm persistence. Check keyboard focus, screen-reader
names, 360px layouts, 200% zoom, draft retention on error, and conflicting tabs.
Browser QA is a separate, explicitly requested environment capability; do not
claim that this checklist was executed without evidence.

## Performance budgets (unverified until measured)

Task list API p95 below 500 ms under representative deployment load; primary
quick action feedback within 100 ms, with a visible saving state. Task pages
never exceed 100 records. Test query plans against representative larger fixtures.
Track create/start/complete usability with real users before asserting 10 seconds.

## Available command

Run `node scripts/test.mjs` on Node 24. No package download is required for this
suite. Native TypeScript stripping executes TS but does not perform TypeScript
type checking or compile JSX. Do not confuse the passing suite with a full build.

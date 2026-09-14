# Vercel and Railway deployment

Status: migration in progress. A static Vercel setup preview and dedicated
Railway PostgreSQL infrastructure are created; the working application is not
released. The user explicitly selected these hosts after the original Sites build
was blocked. This host selection supersedes the earlier Sites-only release
instruction. It does not authorize removing authentication or opening private
task data to anonymous visitors.

## Target

| Component | Host | Responsibility |
|---|---|---|
| Native Next.js application | Vercel | UI, same-origin API, server-side session checks |
| PostgreSQL | Railway | Application records, sessions, atomic transactions |
| Source | Private GitHub repository | ayee-prashant/stride |

Keep the application as one modular monolith. Locate app compute and the
database close together where account-supported regions permit. Use a bounded
connection pool and statement/connection timeouts; measure before increasing
pool or instance counts. Connection strings and session secrets belong only in
provider-managed server environment variables, never NEXT_PUBLIC variables.

Vercel officially supports Next.js and Railway provides PostgreSQL services.
Neither of those facts makes this existing Cloudflare Worker deployable unchanged.
See [Vercel Next.js](https://vercel.com/docs/frameworks/full-stack/nextjs) and
[Railway PostgreSQL](https://docs.railway.com/databases/postgresql).

## Work already prepared

- `lib/server/postgres-adapter.ts` implements the existing database interface.
  Values remain bound separately from SQL. Batch statements use one checked-out
  client and one transaction, preserving task/audit atomicity. Failed rollback
  destroys the connection; ambiguous writes are never automatically retried.
- `db/postgres-schema.ts` preserves domain tables, indexes, composite tenant
  constraints, and check constraints. Dates remain validated ISO text so the
  existing API does not silently start returning Date objects.
- `drizzle.postgres.config.ts` separates PostgreSQL migration generation from
  the original D1 migration history. No PostgreSQL migration is generated yet.
- Repository queries use portable literal substring search, explicitly typed
  nullable assignee guards, and qualified conflict-update columns.
- Adapter unit tests cover parameter separation, statement immutability,
  transaction affinity, rollback, failed rollback, and connection cleanup.

The native Next.js routes now use Better Auth database sessions with an explicit
GitHub account ID allowlist. The PostgreSQL pool has three connections per warm
process, timeouts, and mandatory verified TLS outside local tests/development.
The old ChatGPT header helper is removed. Server APP_URL governs mutation origin
checks. Authentication schema, migration runner, sign-in/sign-out UI, and a
GitHub CI migration/build workflow are authored; their hosted gates remain pending.

The dependency-free adapter tests use a scripted PostgreSQL client, not a running PostgreSQL server.
The existing repository integration suite still runs against SQLite. Real
PostgreSQL behavior and generated schema parity remain release gates.
The adapter follows node-postgres's [transaction guidance](https://node-postgres.com/features/transactions)
and [parameterized query API](https://node-postgres.com/features/queries).

Validation for this preparation: `node scripts/test.mjs` passes 48 tests,
including the existing SQLite-backed repository/HTTP suite, eight adapter unit
tests, and a regression for literal wildcard characters in task search.
This is not a PostgreSQL integration test or a native Next.js build.

## Ordered remaining work

1. Confirm Vercel and Railway authorization in this conversation. Resolve actual
   project ownership, repository access, available regions, and current services
   through their integrations before creating anything. Reuse a clearly matching
   Stride service if present. Do not create duplicate deployments.
2. Provision a dedicated PostgreSQL database and separate preview/production
   data. Verify TLS and certificate handling for the endpoint actually returned.
   Do not disable certificate verification to make a connection succeed.
3. Add and lock the PostgreSQL driver and a maintained authentication library.
   Better Auth is the preferred candidate, with server-verified sessions and
   closed enrollment. Finalize its supported account bootstrap and recovery
   flow before exposing the app. Authentication storage must not conflict with
   the existing domain `users` table.
4. Replace `app/chatgpt-auth.ts` and the old sign-in/sign-out links with that
   session flow. Remove reliance on caller-supplied `oai-authenticated-*` headers.
   Vercel or Railway URLs are not behind the trusted Sites identity dispatcher.
   There must be no default user, shared demo session, or authentication bypass.
5. Wire the PostgreSQL pool into the existing repository and replace
   `cloudflare:workers` access in the API. Switch package commands to native
   `next dev`, `next build`, and `next start`; resolve legacy build-only files
   and type-check scope without suppressing application errors. Refresh and
   commit the lockfile through a successful authorized dependency install.
6. Generate and inspect PostgreSQL migrations, including authentication tables.
   Apply them once through a controlled migration job with a dedicated migration
   credential. Use a restricted runtime database role. Do not run schema
   creation on every request, apply test fixtures to production, or reset data.
7. Run the repository/security suite against real PostgreSQL, then full type
   checks, lint, and the native Next.js build. Review the changes again after
   compilation and fix findings before release. No such build is verified yet.
8. Create a protected preview from an exact GitHub revision and configure exact
   trusted app origins and auth callbacks. Preserve private owner access; do not
   assume provider deployment protection is available for every environment.
9. Verify authenticated create/edit/complete/reopen/archive/restore, persistence,
   tenant isolation, sign-out, invalid cookies, and cross-origin rejection.
   Check the external request origin behind the actual proxy. Protect health
   checks from exposing database or account details.
10. Promote only the verified revision. Confirm final provider status, an actual
    reachable URL, database backups, and rollback steps. Reverting application
    code does not automatically undo a database migration.

## Hosting access retry: 2026-09-14

Both plugins are installed. Railway profile/workspace/project access works.
Dedicated private project: `ccf1a908-637a-49c5-9e87-6b70e2ff1f87`, production
environment `36f9def0-14ef-4b84-b789-ecb893dd37a1`. Postgres service
`2dc67d03-febe-45de-82b0-00075e942aa5` uses the official postgres-ssl:18 image
and the existing 5000 MB persistent volume in sfo. Deployment health, actual
backup schedule, and verified external TLS must be confirmed from provider
state. The provisioning assistant's prose alone is not verification.

Vercel's direct file-deployment tool created a READY **static setup preview**:
https://stride-kplsmq5ug-prashant-sharma-s-projects1.vercel.app
Deployment: `dpl_GySugKzMoqPaBBFafkbQu7x8Btt7`. Its exact page source is retained
in infra/bootstrap/index.html. It contains no app APIs, sign-in, or task data.
This is infrastructure provisioning, not release of the unverified application.

Vercel list_teams returns an empty list; project inspection for the returned
team slug fails with 403 Forbidden, and protected URL inspection also fails
with 403. Direct deployment success does not prove project-management access.
No Vercel CLI/session credentials are available in this checkout. Connected
Railway OAuth exposes variable names, not secret values; do not export secrets
to source files or logs to work around these access limits.

A dedicated GitHub OAuth application is still required. Configure its callback
as APP_URL/api/auth/callback/github and provision the variables in .env.example
through the hosts' secret stores. The app remains closed until configured.

The original local package download remains denied with HTTP 403. The user-selected
GitHub/hosting build environment will run its normal dependency installation;
the draft CI workflow uploads its resulting lockfile and generated migrations
for review and commit. This one-time bootstrap must become npm ci before release.
No native Next.js build, real PostgreSQL contract run, or hosted authentication
check has passed yet. Do not label this branch ready for production.

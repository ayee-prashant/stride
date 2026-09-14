# Vercel and Railway deployment

Status: migration in progress; no Vercel or Railway deployment exists from this
work. The user explicitly selected these hosts after the original Sites build
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

These tests use a scripted PostgreSQL client, not a running PostgreSQL server.
The existing repository integration suite still runs against SQLite. Real
PostgreSQL behavior and generated schema parity remain release gates.
The adapter follows node-postgres's [transaction guidance](https://node-postgres.com/features/transactions)
and [parameterized query API](https://node-postgres.com/features/queries).

Validation for this preparation: `node scripts/test.mjs` passes 44 tests,
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

## Current blockers

The most recent connection check reports both hosting integrations uninstalled.
The user must complete their installation and account authorization. This is
account access needed to perform the requested deployment, not a request to
reapprove the already-authorized project work.

The original local package download was denied with HTTP 403. That denial has
not been bypassed or resolved. The PostgreSQL driver, authentication integration,
native Next.js build, provider configuration, migrations, and hosted validation
are still incomplete. Do not label this branch ready for deployment.

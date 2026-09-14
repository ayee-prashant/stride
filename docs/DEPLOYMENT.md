# Stride deployment

Current design: native Next.js and PostgreSQL in the dedicated Railway project.
Vercel supplies an entry address redirecting to the canonical Railway HTTPS app
origin. See ADR-009 for the measured access limitations behind this decision.
The app remains private through server sessions and closed enrollment.

## Identifiers

| Resource | Identifier |
|---|---|
| GitHub | ayee-prashant/stride |
| Railway project | ccf1a908-637a-49c5-9e87-6b70e2ff1f87 |
| Railway production environment | 36f9def0-14ef-4b84-b789-ecb893dd37a1 |
| PostgreSQL service | 2dc67d03-febe-45de-82b0-00075e942aa5 |
| Web service | 02968ece-d1c9-4782-b105-4c75f9662af0 |
| App origin | https://stride-app-production-d72b.up.railway.app |

The existing PostgreSQL volume is 5000 MB in sfo. No public PostgreSQL endpoint
is needed. Keep the application in the same region where available.

## Release sequence

1. Pass CI and review an immutable commit in build/railway-runtime before
   advancing deploy/vercel-railway, the branch watched by the running web service.
2. Verify the database leaf certificate against its dedicated CA and the private
   postgres.railway.internal hostname. infra/postgres/tls-start.sh issues the leaf
   within the database container using the existing CA and key; private keys
   never leave that container. Capture only the public root certificate for the
   client trust store. Keep rejectUnauthorized=true.
3. Generate distinct cryptographically random session, runtime-database, and
   initial-owner credentials. Put them in provider environment stores only.
4. Run npm run db:provision as a separate controlled service/job with no public
   domain. Give it MIGRATION_DATABASE_URL via Postgres.DATABASE_URL, the public CA,
   STRIDE_RUNTIME_PASSWORD, STRIDE_ALLOWED_EMAILS, and the three STRIDE_BOOTSTRAP_*
   values. It applies committed migrations, grants a restricted runtime role,
   and creates the approved owner only if absent. It preserves existing passwords.
5. The web app receives only DATABASE_URL for stride_app, DATABASE_CA_CERT,
   BETTER_AUTH_SECRET, STRIDE_ALLOWED_EMAILS, and APP_URL. It does not receive
   the admin/migration URL or initial owner password. Set /api/health as the
   readiness check and keep instance/connection counts bounded.
6. Verify readiness, private signup, actual sign-in, mutation origin enforcement,
   create/edit/complete/reopen/archive/restore, session invalidation, and task
   persistence. Inspect provider logs without exposing credentials or task bodies.
7. Deploy the Vercel entry redirect to the canonical app origin, then verify its
   real response and the destination. Production status requires more than a
   provider build-success message.

## Owner access and recovery

The initial password belongs in the provisioning service's secure variable store.
The owner retrieves it from the authenticated Railway dashboard, signs in with
the configured email, then uses Change password in the account controls. The
initial password is not committed, printed in logs, or embedded in the app.
A changed password survives migration/redeployment. Additional accounts require
an explicit allowlist entry and controlled provisioning.

Email delivery and self-service emailed recovery are not part of this release.
Recovery requires an authenticated operator to reset the specific credential
record with Better Auth hashing and revoke that account's sessions, through a
reviewed job. Never enable public signup or a default user as a recovery method.

## Rollback and limits

Keep the previous tested application commit available for rollback. Applying an
older app version does not reverse a database migration. Applied migration files
are immutable; preserve the existing volume and records. The TLS wrapper retains
the previous leaf certificate for recovery. Confirm provider backups and practice
restore before claiming business-critical readiness. Backup configuration alone
is not a verified restore.

The original cfdc751 baseline passes all compile/database checks and has a
successful Railway build. The new authentication/provisioning release is still
under validation; see RELEASE_REVIEW.md for actual, dated results.

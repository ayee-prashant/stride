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
| Provisioning service | 1b76c2b4-d393-4984-a2e6-43393fe1b269 |
| Scheduled worker | 013befc6-2284-460b-a9d0-60e1ef8814bc |
| Private file bucket | f48bc018-376f-49f3-a0e2-8e6df54e0043 |
| App origin | https://stride-app-production-d72b.up.railway.app |

The existing PostgreSQL volume is 5000 MB in sfo. No public PostgreSQL endpoint
is needed. Keep the application in the same region where available.

## Release sequence

1. Pass CI and review an immutable commit on the reviewed feature/release branch before
   advancing deploy/vercel-railway, the branch watched by the running web service.
2. Verify the database leaf certificate against its dedicated CA and the private
   postgres.railway.internal hostname. infra/postgres/tls-start.sh issues the leaf
   within the database container using the existing CA and key; private keys
   never leave that container. Capture only the public root certificate for the
   client trust store. Keep rejectUnauthorized=true.
3. On initial setup, generate distinct cryptographically random session,
   runtime-database, and initial-owner credentials in provider stores only.
   On subsequent releases, preserve these values and all existing accounts.
4. Run npm run db:provision as a separate controlled service/job with no public
   domain. Give it MIGRATION_DATABASE_URL assembled from Postgres references with the
   existing postgres database name, the public CA,
   STRIDE_RUNTIME_PASSWORD, STRIDE_ALLOWED_EMAILS, and the three STRIDE_BOOTSTRAP_*
   values. It applies committed migrations, grants a restricted runtime role,
   and creates the approved owner only if absent. It preserves existing passwords.
5. The web app receives only DATABASE_URL for stride_app, DATABASE_CA_CERT,
   BETTER_AUTH_SECRET, STRIDE_ALLOWED_EMAILS, and APP_URL. It does not receive
   the admin/migration URL or initial owner password. Set /api/health as the
   readiness check and keep instance/connection counts bounded.
6. Run node scripts/verify-production.mjs as a controlled, non-restarting job
   inside this project's production environment. STRIDE_INTERNAL_URL must be
   http://stride-app.railway.internal:8080 and STRIDE_VERIFY_ORIGIN must equal
   APP_URL. The job uses the approved demo credentials supplied through secure references,
   checks the private app, removes only its temporary files/views/templates,
   revokes its test invitation, archives its new tasks, and signs out. It does not reset
   data or change the owner password. Inspect the production_verified log event,
   including structured attributes. This is not a public-edge/browser check.
7. Deploy the Vercel entry redirect to the canonical app origin, then verify its
   real response and the destination. Production status requires more than a
   provider build-success message.

## Owner access and recovery

The initial password belongs in the provisioning service's secure variable store.
The owner retrieves it from the authenticated Railway dashboard, signs in with
the configured email, then uses Change password in the account controls. The
initial password is not committed, printed in logs, or embedded in the app.
A changed password survives migration/redeployment. Additional accounts require
an admin-issued email-bound invitation or controlled allowlist provisioning.

Password recovery and opt-in digests are implemented through Resend. Enable them
only with RESEND_API_KEY and a verified STRIDE_EMAIL_FROM on both web and worker.
The app queues encrypted bodies; a bounded scheduled worker delivers them. Until
a sender is connected, recovery clearly reports unavailable and digest controls
stay disabled. Change password remains available for signed-in accounts.

## Productivity storage and worker

Apply additive migration 0002 before deploying the productivity app or worker.
The existing provisioning job grants the restricted role access to the new tables
and preserves all existing account credentials.

Use the private Railway stride-files bucket. Web and worker receive
STRIDE_S3_ENDPOINT, STRIDE_S3_BUCKET, STRIDE_S3_REGION,
STRIDE_S3_ACCESS_KEY_ID and STRIDE_S3_SECRET_ACCESS_KEY as provider references;
never expose them in NEXT_PUBLIC variables or source. No public bucket domain is
needed. App quotas are 5 MB/file, 20/task and 200 MB/workspace.

The stride-worker service uses the tested deploy/vercel-railway source,
start command npm run worker, cron */5 * * * *, restart NEVER, and no public
domain. It shares the restricted DATABASE_URL, DATABASE_CA_CERT,
BETTER_AUTH_SECRET, STRIDE_ALLOWED_EMAILS and APP_URL through references to
stride-app. It receives the same S3 references and only verified email config
when available. It never receives migration credentials or bootstrap passwords.
The database cursor/lease bounds work and prevents overlapping reminder scans.
Inspect scheduled_work_completed and its counts to verify a real execution.

The private verification job checks task links, checklists, blockers, bulk
completion, templates/repetition, saved filters, invitation revocation and a real
S3 upload/download/deletion in addition to the first-sprint checks. Test records
are identified from that job's own create responses; no existing task is changed.

## Rollback and limits

Keep the previous tested application commit available for rollback. Applying an
older app version does not reverse a database migration. Applied migration files
are immutable; preserve the existing volume and records. The TLS wrapper retains
the previous leaf certificate for recovery. Confirm provider backups and practice
restore before claiming business-critical readiness. Backup configuration alone
is not a verified restore.

The c39487f application passed the complete CI runtime gate and Railway's live
database-backed readiness check. Provisioning created the restricted role and
approved owner. The controlled live job passed real authentication, task
persistence, permission denials, and sign-out, and archived its QA task. See
RELEASE_REVIEW.md for exact source and deployment evidence.

Do not trust a configured source branch alone. Confirm list-deployments commitHash:
the provider's first create-deployment used main despite the requested branch,
and redeploy reused the old snapshot. Push a reviewed commit to the configured
branch to deploy the intended source. Configuration changes also need a fresh
deployment. Never force an unreviewed branch or weaken TLS to recover readiness.

The Vercel entry source is infra/vercel/. Deploy those two files with no framework,
install, or build command. The current production submission has an unverified
terminal status because the Vercel connector denies the team's scope.
The Railway app is the canonical runtime; the Vercel entry stores no credentials.

The c39487f application is the previous baseline. First-sprint completion is
reviewable in PR #3; exact current source and deployments are in RELEASE_REVIEW.md. A main-branch merge requires
explicit authorization after an automatic approval-review rejection; do not
substitute a direct main ref update for that merge.

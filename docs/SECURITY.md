# Security model and review checklist

## Approved productivity expansion

The user approved admin-issued invitations as an explicit enrollment extension.
Public signup stays disabled. A valid invitation is email-bound, expires after
seven days, and is stored as a SHA-256 hash of a 256-bit random token. The UI
uses a URL fragment and temporary tab storage; tokens are not server query
parameters. Existing accounts must prove identity with their Better Auth session.
Acceptance locks the invitation and inviter's current admin membership and
atomically creates credentials, admission and membership. It cannot overwrite
an existing password. Anonymous invalid-token guesses create no quota records.

Recovery uses Better Auth's expiring, one-use reset tokens and revokes sessions.
The email outbox encrypts message bodies with AES-GCM, has bounded retries and
leases, uses provider idempotency keys, and erases delivered/expired contents.
Daily summaries are opt-in and recheck recipient membership before delivery.
Missing email credentials are surfaced as unavailable, not simulated delivery.

Attachments use private S3-compatible object storage. File bodies are bounded
to 5 MB, type/extension checked, and capped at 20 per task and 200 MB per workspace.
Pending cleanup still occupies the workspace byte quota. Downloads recheck
membership, active task and project; all files are forced downloads with
nosniff and a sandbox policy. SVG, HTML, executable files, archives and Office
containers are not accepted. Format checks do not constitute antivirus scanning.
Only uploaders and current admins can remove files. Failed uploads retain a
durable cleanup record. The scheduler purges abandoned uploads.

Checklist/view/template edits have version checks; bulk changes and repeat-task
creation share one transaction. Repeat predecessors are unique and tenant-bound.
The scheduled worker uses a restricted runtime database role and has no public
endpoint; it never receives migration credentials.

## Trust boundary

Production identity comes from Better Auth's verified database session and
persisted credential account. Account enrollment is operator-controlled; public
signup, email changes, account linking, and user deletion are disabled. Passwords
use Better Auth's maintained scrypt implementation. STRIDE_ALLOWED_EMAILS is
checked on every application request against the persisted session user.
Knowing an approved email is insufficient: the password and valid session are
required. Caller-supplied oai-authenticated-* headers are ignored. There are no
test-user fallbacks or client-supplied roles.
Missing identity returns 401. Unauthorized resource access returns a generic
404 or 403 without record details. Authorization is repeated on every request.

## Controls

- Workspace membership required for every project/task read and write.
- Admin role for project and membership administration; members manage tasks.
- Owner cannot be removed by member administration.
- Mutation requests require same-origin JSON and are capped in size.
- The trusted mutation origin is APP_URL, not a forwarded host header.
- Better Auth's origin/CSRF checks stay enabled. Cookies are HttpOnly, SameSite=Lax,
  Secure for HTTPS, and scoped to one host; account linking is disabled.
- Database TLS verifies certificates. URL ssl parameters cannot weaken it.
- Strict input schemas reject unknown fields, invalid dates, excessive text,
  invalid enums, and invalid versions. SQL uses bound values only.
- All task content is plain text rendered through React escaping; no raw HTML.
- Version checks prevent silent lost updates. Archive/restore prevents routine
  irreversible deletion. API responses use private no-store cache headers.
- Per-user mutation quotas prevent accidental write storms; infrastructure-level
  DDoS protection remains the platform's responsibility.
- Structured errors include a request ID but no SQL, stack trace, or credentials.
- Logs exclude task bodies, tokens, cookies, and personal identifiers.

## Mandatory negative tests

Missing identity; cross-workspace reads/writes; forged assignee; member attempting
admin action; malformed/oversized JSON; cross-origin mutation; invalid date;
SQL metacharacters as data; stale versions; archived-project mutation; rate limit.

## Operational requirements

Preserve owner-private audience. Test backup/restore and complete a deployed
load test before claiming business-critical readiness. Dependency audit results
must be dated; an unavailable registry is an unverified check, not a pass.
Deploy schema additions compatibly; applied migration files are immutable.

## References

- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)

These are design references, not certification or proof of security.

## Deployment credential separation

The web service receives only the restricted stride_app database credential,
the public database CA, the session signing secret, approved email list, and
canonical APP_URL. Migration/admin credentials and the initial owner password
belong to a separate provisioning job with no public domain. Initial provisioning
never overwrites an existing user's password. Users can change their password
from the account controls; other sessions are revoked.

The PostgreSQL leaf certificate must include postgres.railway.internal and
validate against the dedicated volume's public CA. Private keys remain in the
database container. No TLS verification override is introduced. Renewing the leaf
certificate leaves database records and keys intact. Public certificate retrieval
does not establish that a TLS handshake passed; verify using the deployed client.

## First-sprint collaboration review

- Comment input is plain text, capped at 4000 characters and 10 distinct mentions.
  Workspace membership is rechecked inside the write; forged recipient and author
  fields are rejected. Atomic rollback protects comment/activity/notification
  consistency. Comment rendering uses React escaping, with no HTML interpreter.
- Inbox reads and read acknowledgements bind the authenticated recipient. A
  workspace admin cannot read or acknowledge a teammate's inbox. Archived records
  cannot expose notification content or accept new comments.
- Overdue synchronization uses server time and a bounded timezone offset, unique
  event keys, bounded insert batches, and the same JSON/origin/rate-limit guards.
  Untrusted date or sort strings never become SQL operators or clauses.
- Ambiguous write errors preserve drafts and instruct refresh/check before retry.
  Changing task fields does not overwrite or silently discard an unsent comment.
- Existing production migrations and credentials are preserved. Migration 0001 is
  additive; the temporary trusted-branch generation workflow was removed after it
  committed generated files. The normal verification job has read-only access.

# Security model and review checklist

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

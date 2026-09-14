# Security model and review checklist

## Trust boundary

Production identity comes from Better Auth's verified database session plus the
persisted GitHub provider account. Check that account's numeric ID against
STRIDE_ALLOWED_GITHUB_IDS on every request; email and login names are not access
credentials. Caller-supplied oai-authenticated-* headers are ignored. There are
no app passwords, public email signup, test-user fallbacks, or client-supplied roles.
Missing identity returns 401. Unauthorized resource access returns a generic
404 or 403 without record details. Authorization is repeated on every request.

## Controls

- Workspace membership required for every project/task read and write.
- Admin role for project and membership administration; members manage tasks.
- Owner cannot be removed by member administration.
- Mutation requests require same-origin JSON and are capped in size.
- The trusted mutation origin is APP_URL, not a forwarded host header.
- OAuth state and callback checks stay enabled. Cookies are HttpOnly, SameSite=Lax,
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

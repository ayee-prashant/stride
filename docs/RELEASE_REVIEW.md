# Release review — 2026-09-14

## Current verified application

Application source c39487f01083aa945683075f89a4c7b5af7f0cfe passed GitHub Actions
[run 34831794534](https://github.com/ayee-prashant/stride/actions/runs/34831794534),
job 103936585084. The gates passed: clean npm ci, generated/committed migration
parity, 48 native tests, real PostgreSQL contract tests, typecheck, lint,
Next.js production build, isolated account provisioning, and the complete
authenticated Next.js/PostgreSQL runtime flow.

The runtime test used a restricted database role and real hashed credentials.
It checked closed registration, forged identity rejection, login, workspace
bootstrap, rendered workspace HTML, task create/complete/reopen/reload,
stale-version rejection, archive/restore, origin and tenant denial, password
change, old-password rejection, sign-out, and old-session invalidation.
These are API/SSR checks, not browser interaction tests.

## Production evidence

- Railway web deployment f3d48a4a-61dd-47ec-8210-297c8f83d57d is SUCCESS and
  identifies exactly c39487f01083aa945683075f89a4c7b5af7f0cfe. Its production
  build passed and /api/health succeeded at 10:26:47 UTC. The readiness handler
  queries the auth table through the restricted runtime role with verified TLS.
- PostgreSQL deployment 6e1ec0ac-b452-45fb-b835-bd165be01c30 issued a leaf
  certificate for postgres.railway.internal using the existing volume's CA/key
  and started PostgreSQL 18.6. No private key left the database container.
- Provisioning deployment a25ecf70-712b-45a8-91ba-db00aa4ca48f emitted
  database_provisioned with ownerCreated=true and runtimeRole=stride_app at
  10:24:36 UTC. Its source 27dd06bca30a44a27cc3d75b736d8c9a2da2db92 has the
  exact same tree as the tested application. Migrations, role grants, and the
  real owner account were created successfully through verified database TLS.
- The app and database run in sfo. PostgreSQL uses a persistent 5000 MB volume
  and private networking. Web runtime variables contain no migration credential
  or bootstrap password.
- A separate, guarded production verification job is prepared. Its result
  must be recorded from the actual log event before live session/task checks
  are described as passed.

## Vercel and public checks

The Vercel entry redirect was submitted as production deployment
dpl_C4JL5hun7wMVYJfEgmH7PjE6kGNo. The connector returned INITIALIZING and alias
https://stride-prashant-sharma-s-projects1.vercel.app. Its source is committed
under infra/vercel/. It redirects to the canonical Railway application and
contains no application secrets.

Vercel status inspection returns 403 requiring reauthentication for team scope
prashant-sharma-s-projects1. Terminal Vercel status is therefore unverified.
The available public web checks reject the Railway and Vercel addresses as
non-retryable unsafe URLs. No alternate fetch or browser was used to bypass
those denials. Public DNS/CDN routing and browser interaction remain unverified.

## Second architecture and security review

Reviewed after compilation: real library-owned sessions, persisted allowlist
checks, per-request workspace authorization, same-origin mutation enforcement,
prepared SQL, bounded queries/pools/timeouts, immutable migrations, optimistic
versions, recoverable archives, private response caching, secure cookies, safe
errors, and credential separation. No public registration, header identity
fallback, insecure TLS override, production fixture credentials, or plaintext
password logging was introduced.

Corrections made during compilation and deployment included missing icon exports,
generic test typing, stale frontend response isolation, Zod 4 compatibility,
composite unique constraints before dependent foreign keys, hostname-correct
database TLS, the existing PostgreSQL database name, and deployment source
verification.

The first Railway create-deployment calls accepted a release branch in service
configuration but actually deployed old main commit fa813c9. Redeploy reused
that snapshot. Earlier claims that deployment 2b55f23a was the tested cfdc751
baseline were incorrect. A normal push to the configured branch and fresh
configuration deployment resolved it; source hashes and actual log events were
then checked. A one-off job's provider SUCCESS alone is not proof it completed:
structured JSON events may appear in log attributes with an empty message.

## Remaining limits

Browser, keyboard, screen-reader, mobile, and drag/drop acceptance checks have
not run in the current hosted environment. Load/latency budgets are unmeasured;
there is no enterprise-scale or SLA claim. Backup restore and a dated dependency
vulnerability audit have not been verified. Self-service emailed account recovery
is deferred. The initial audience is the approved owner; adding team accounts
requires controlled enrollment.

The earlier native baseline cfdc751 passed run 34828808360; initial Sites-only
source and registry blocks are historical and do not describe the current
compiled Railway runtime. See DEPLOYMENT.md for current operating instructions.

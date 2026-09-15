# Local development setup

Install Node.js **24** and Docker Desktop with Linux containers, then start Docker
Desktop and wait for its engine to be ready. From the repository root:

```powershell
npm run setup
npm run dev
```

Setup asks for a local sign-in email and display name. It installs the committed
dependency tree with `npm ci`, generates four independent random secrets, starts
PostgreSQL 18 on loopback with a persistent Docker volume, applies the committed
migrations, and provisions a restricted `stride_app` role and private account.
It does not start the Next.js server. Open <http://127.0.0.1:3000> after `npm run dev`.

Find the initial email and password in **`.env.provision`**, under
`STRIDE_BOOTSTRAP_EMAIL` and `STRIDE_BOOTSTRAP_PASSWORD`. Open that file locally;
do not paste it into chat, logs, or source control. Change the password from the
account controls after signing in. Setup preserves an existing account's current
password, so the generated initial password no longer applies after a change.

## Options

```powershell
npm run setup -- --email you@example.com --name "Your Name"
npm run setup -- --email you@example.com --name "Your Name" --port 3001 --db-port 5544
npm run dev -- --port 3001
```

Choose alternate ports on the **first** run if another service uses 3000 or 5432.
App and database ports must differ and be between 1024 and 65535. The app port
must match `APP_URL`; follow the command printed by setup. Noninteractive runs
require `--email` and `--name`. Names and emails cannot contain dotenv syntax such
as quotes, `$`, backslashes, or line breaks. No password command-line option exists.

Run `npm run setup -- --help` for options (or `--help --json` for a machine-readable
option list). `--skip-install` is available after `npm ci`, for example when
resuming after a Docker failure. After pulling changes to the lockfile, run the
default setup or `npm ci` again.

### For scripts and agents

```powershell
npm run setup -- --check --json
npm run setup -- --email you@example.com --name "Your Name" --json
```

`--check` verifies Node, Docker reachability and port availability and exits
0 or 1 without installing anything, writing a file, or starting a container —
useful to confirm a checkout is ready before committing to a real run. `--json`
prints exactly one JSON result line on stdout (`{"ok": true, ...}` or
`{"ok": false, "mode": ..., "error": ...}`); human-readable progress and errors
go to stderr instead, so stdout stays parseable. Combined with `--email`/`--name`,
setup runs fully noninteractively — required whenever stdin/stdout are not a
terminal, which includes any agent or CI invocation.

## Manual setup (without Docker)

Use this if Docker is unavailable to you, or you already run PostgreSQL yourself.
`npm run setup` covers the common case; this reproduces what it generates by hand,
using the same two files it would otherwise manage.

1. Install PostgreSQL 18 and create an empty `stride` database reachable from this
   checkout, for example on `127.0.0.1:5432` with your own admin role.
2. Copy `.env.example` to `.env.local` and fill in the runtime block:
   - `APP_URL` — `http://127.0.0.1:3000` (or your chosen port).
   - `DATABASE_URL` — `postgresql://stride_app:<password>@<host>:<port>/stride`.
     Choose `<password>` yourself; step 4 creates the `stride_app` role and sets
     its password from `STRIDE_RUNTIME_PASSWORD` below, so the two must match.
   - `BETTER_AUTH_SECRET` — a random string of 32+ characters, for example the
     output of `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   - `STRIDE_ALLOWED_EMAILS` — your sign-in email.
   - Leave `DATABASE_CA_CERT` empty for a local, non-TLS connection.
3. Copy `.env.example` to `.env.provision` and fill in the provisioning block:
   - `MIGRATION_DATABASE_URL` — an admin/superuser connection string to the same
     database; used once, to apply migrations and create `stride_app`.
   - `STRIDE_RUNTIME_PASSWORD` — exactly 64 lowercase hex characters, matching the
     password embedded in `.env.local`'s `DATABASE_URL`.
   - `STRIDE_ALLOWED_EMAILS` — the same value as in `.env.local`.
   - `STRIDE_BOOTSTRAP_EMAIL` — must be one of the addresses in `STRIDE_ALLOWED_EMAILS`.
   - `STRIDE_BOOTSTRAP_NAME` — 1–100 characters.
   - `STRIDE_BOOTSTRAP_PASSWORD` — 12–128 characters; this is your initial sign-in
     password.
4. Apply migrations and provision the restricted role and account:
   ```powershell
   node --env-file=.env.provision --experimental-strip-types scripts/provision-postgres.ts
   ```
5. Run `npm run dev` and sign in with `STRIDE_BOOTSTRAP_EMAIL` and
   `STRIDE_BOOTSTRAP_PASSWORD`.

These are exactly the files `npm run setup` manages, so do not also run
`npm run setup` against a checkout configured this way; see **Existing manual
environment** below if you later want to switch to it. Production still uses
`docs/DEPLOYMENT.md`, which is a separate, Railway-specific release process.

## Files and data

| File/resource | Purpose |
| --- | --- |
| `.env.local` | App origin, restricted database connection, auth secret and approved email |
| `.env.provision` | Separate migration/admin credentials and initial account credentials |
| `.env.setup.json` | Checkout-bound recovery state, including generated secrets and resource identity |
| `stride-local-<id>` | PostgreSQL container, published only on `127.0.0.1` |
| `stride-local-<id>-data` | Persistent PostgreSQL data volume |

All three files are covered by the repository's existing `.env*` ignore rule.
New secret files request owner-only permissions on POSIX; on Windows they inherit
the checkout directory's access controls. Keep the checkout in a private folder.
Never copy these files into another checkout or send them to another developer.
Each new checkout gets independent credentials, container and volume identifiers;
concurrent checkouts need different ports.

Rerunning setup reuses the same files and data, restarts its stopped container,
and reapplies pending migrations. It can finish interrupted environment-file
creation using the saved recovery state. It never resets the database, removes a
container or volume, or overwrites an existing user's password. Stop the database
with the exact `docker stop stride-local-<id>` command printed at completion;
rerun setup to start it again.

## Recovery and existing configurations

- **Docker unavailable:** start Docker Desktop in Linux-container mode, wait for
  readiness, and rerun setup. A failed preflight creates no secret files.
- **Docker startup reports `dockerInference`:** this is a Docker Desktop startup
  error. See the [reported Windows stale-socket issue](https://github.com/docker/desktop-feedback/issues/554)
  and [Docker troubleshooting](https://docs.docker.com/desktop/troubleshoot/).
  Setup reports the unavailable engine and leaves the machine configuration alone.
- **Port busy:** stop the service occupying the port, or select another port on
  first setup. Reruns reject changed ports to avoid disconnecting existing data.
- **Pull/start/readiness failure:** credentials and any created volume remain.
  Correct Docker/network availability and rerun; setup does not delete resources.
- **Provisioning failure:** check Docker readiness and local file access. To see
  the provisioner's safe stage/error code, run
  `node --env-file=.env.provision --experimental-strip-types scripts/provision-postgres.ts`
  in a clean development shell after verifying that file contains local URLs.
- **Existing manual environment:** setup refuses to adopt or overwrite unmanaged
  `.env.local`/`.env.provision`, or a checkout with `.env`, `.env.development`, or
  `.env.development.local`. Continue with **Manual setup (without Docker)** above,
  or use a fresh checkout for automated setup. Existing optional S3/email settings
  may be added to a managed `.env.local`; managed credentials must continue to
  match state.
- **Files edited or copied:** setup fails closed if managed credentials, account,
  ports or checkout identity differ. Restore matching files from your local backup
  or use manual provisioning. Do not discard recovery state to work around this:
  it links the environment to its existing database volume.
- **Remote Docker context:** select a local context with `docker context use`,
  and clear `DOCKER_HOST`/`DOCKER_CONTEXT` overrides. Setup accepts local Unix
  sockets and Windows named pipes only, and pins that context for every command.

Use a clean development shell when starting the app: inherited `DATABASE_URL`,
`APP_URL`, or authentication variables override Next.js environment files.
The setup provisioner explicitly filters inherited production/database settings.
Email delivery and attachments remain optional; no external sender is needed to
sign in or manage tasks locally. Production deployment still uses `DEPLOYMENT.md`.

## Verification

`npm test` includes local setup regression tests covering secret separation,
input validation, interrupted writes, preserved configuration, local-only Docker,
resource conflicts, readiness failures, inherited production variables and ports.
Docker command tests use a scripted runner; see `RELEASE_REVIEW.md` for actual
database, installation and end-to-end evidence.

`npm run test:setup` requires a running local Docker engine. It creates a temporary
checkout fixture and PG18 container on free loopback ports, applies real migrations,
verifies the generated login password and restricted role, changes the fixture's
password, and reruns setup after stopping the database. It checks data, password
and file preservation, then removes only its own fixture container/volume. It is
also part of pull-request CI. Dependency installation is covered separately by
`npm ci`; the fixture reuses installed dependencies.

The Docker invocation follows [Docker's container run documentation](https://docs.docker.com/engine/containers/run/)
and the [official PostgreSQL image's PG18 volume layout](https://hub.docker.com/_/postgres).

# Use hosted Stride or develop it locally

## Choose your path

| Goal | What you need |
| --- | --- |
| Manage tasks or review agent work | Sign in to the team's existing Stride server. Open **Getting started**. |
| Connect an IDE agent | A reviewed companion checkout, Node 24, Git, `npm ci`, and a connection enrolled by that role's human operator. Follow [attended setup](agent-workforce/ATTENDED_SETUP.md). No new Stride database is needed. |
| Develop Stride itself | An isolated checkout, Node 24 and a running local Docker engine with Compose v2. Use the local commands below. |
| Operate production | Follow [Deployment](DEPLOYMENT.md) with separate runtime/provisioning credentials, verified TLS and human release approval. Local setup is not a production installer. |

## A fresh development checkout

Use Linux, macOS or WSL. On Windows, install Node/Git inside WSL and enable the
local Docker engine's WSL integration. Keep the checkout on the WSL filesystem
so owner-only Unix permissions are enforced. Native Windows credential storage
is not supported by these managed local commands or the attended companion.

Use a reviewed branch containing this release; the deployed branch is
`deploy/vercel-railway`. In a fresh checkout, run:

```sh
npm run setup:local
npm run dev:local
```

Setup checks Node 24, Git ignore rules, Compose and the selected local Docker
socket. It installs the committed dependency tree, starts PostgreSQL 18, waits
for readiness, applies committed migrations and provisions a restricted
`stride_app` database role plus one local owner. It prints the app's loopback URL.

Open `.stride-local/LOGIN.txt` locally for the generated sign-in details. There
is no shared or published default password. Setup reruns preserve an existing
owner's changed password. The local account and database are separate from your
hosted workspace, with no production data or agent credentials copied in.

The private `.env.local` contains only runtime settings. Provisioning secrets
remain under the owner-only `.stride-local` directory, excluded from Git. Do not
paste these files into agent chats, attach them to tickets or copy them between
worktrees. Filesystem permissions do not isolate programs running as the same
OS user; keep production credentials outside development environments.

## Resume, diagnose and stop

```sh
npm run doctor:local
npm run setup:local
npm run stop:local
```

Doctor reads prerequisites, private configuration and database readiness. It
prints no secrets and does not change data or claim sign-in/production readiness.
Setup resumes an interrupted local setup and uses the same volume and secrets.
Stop stops only this checkout's container and retains its data. There is no
automatic database reset or volume removal command.

Existing manually configured environment files are preserved. Managed commands
refuse ambiguous overrides, copied settings, remote Docker engines, unsafe file
permissions and shells containing application/database/provider credentials.
Use a clean development shell and a fresh checkout, or keep using the existing
manual setup with `npm run dev`. Do not delete a working configuration just to
make a diagnostic pass.

Ports are chosen from available loopback ports starting at 3000 and 55432. To
choose explicitly on the first setup:

```sh
npm run setup:local -- --app-port 3002 --db-port 55434
```

Selections are stored per checkout. `dev:local` uses that exact app port and
refuses a busy port; it cannot silently switch away from the configured auth
origin. A process taking the database port after the initial check makes Docker
startup fail visibly. Setup never kills the other process.

## Several agents, one shared project

Use a separate branch and working folder for each coding agent. For example,
replace `TICKET_ID` and `APPROVED_BASE_SHA` with the assigned ticket and reviewed
base commit, then run:

```sh
git worktree add -b work/TICKET_ID ../project-ticket APPROVED_BASE_SHA
```

Git worktrees isolate working files; they share repository objects and do not
isolate processes, ports, databases or secrets. When the target project is
Stride itself, run `setup:local` inside each worktree that needs a server. Each
gets a distinct Compose project/volume and available ports. Run heavy builds
sequentially if machine resources become constrained; there is no measured
universal machine or agent capacity claim.

For a different target repository, use that repository's development setup.
All agents continue connecting to the same hosted Stride workspace for approved
requirements, repository observations, work packets and checkpoints. Give each
tool/machine its own connection; do not share companion credential files.

Humans assign compatible scopes and an integration owner. Reviewers inspect an
exact integrated commit. Preparing a worktree does not initialize a role,
authorize a start, accept a report or grant release permission. Those decisions
remain in Stride. Reuse `stride_checkpoint`, `stride_submit` and the report schema
for handoffs instead of creating a competing source of project truth.

## Verify before handing off

```sh
npm run verify
```

This runs native unit/contract tests, TypeScript, lint and the production build
in order and stops at the first failed gate. It does not deploy, migrate a live
database, launch agents or claim human approval. Install locked dependencies
first with `npm ci` if using a manually prepared checkout.

CI separately runs PostgreSQL contracts/concurrency, OAuth/MCP/CLI and browser
flows, dependency audits, migration parity, synthetic performance/restore checks
and real local Docker setup. The browser harness remains limited to its isolated
Linux CI server; the shortcut does not pretend to run it on every local OS.
See [Testing](TESTING.md) for supported commands and evidence limits.

## References

- [Docker Compose services and loopback port publishing](https://docs.docker.com/reference/compose-file/services/)
- [Official PostgreSQL image and versioned data directory](https://github.com/docker-library/docs/blob/master/postgres/README.md)
- [Git worktree documentation](https://git-scm.com/docs/git-worktree)

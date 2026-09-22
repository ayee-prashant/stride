# Shared context hub

CLI agents working from one shared, versioned, human-approved context.
`agents.json` at the parent level decides which are in play. See [DESIGN.md](DESIGN.md) for why it is
built this way; this file is how to run it.

## Run it

```
node server.mjs          # http://localhost:7400
.\connect.ps1            # point all three agents at it
```

Then open <http://localhost:7400>.

## What each piece does

| | |
|---|---|
| `server.mjs` | MCP endpoint for agents, SSE feed and JSON API for the UI |
| `db.mjs` | the store — SQLite via built-in `node:sqlite`, no dependency |
| *(UI)* | being rebuilt - the server still serves `/`, which reports 503 until it lands |
| `connect.ps1` | registers the hub as an MCP server in all three CLIs |
| `runner.ps1` | runs agents **under the controller** (model + approval mode) |
| `db.test.mjs` | 35 checks of the invariants that make concurrency safe |
| `regression.test.mjs` | 17 checks, one per bug found in review |

## The controller

Model and approval mode live in the hub, not on the command line, so changing
them in the UI changes what actually launches:

```
claude   model=claude-opus-5    approval=auto
         -> claude --print --permission-mode bypassPermissions --model claude-opus-5
codex    model=gpt-5-codex      approval=prompt
         -> codex exec -c model=gpt-5-codex
gemini   model=gemini-2.5-pro   approval=auto
         -> gemini --yolo -m gemini-2.5-pro --prompt
```

`.\runner.ps1 -Show` prints exactly this without running anything.

**Approval mode means tool execution only** — whether an agent may act without
stopping to ask. It never lets an agent approve its own work: there is no such
tool, and proposed context stays `pending` until a human decides.

## Tools agents get

| Tool | For |
|---|---|
| `agent_identity` | who am I, on what model, who else is here (not `whoami` - that is a shell command) |
| `context_head` | the approved requirements, decisions, constraints |
| `context_get` | one document with its full history |
| `context_propose` | propose a change — lands as `pending` |
| `feed_read` | what every other agent has done, in order |
| `note_append` | publish a finding for the others |
| `work_list` / `work_claim` / `work_release` | leases, so two agents never duplicate a job |

Every response carries `head_sequence`, so an agent can tell its view is stale
without a second call.

## In STRIDE proper

The same capability now exists on STRIDE's own `/mcp` endpoint, backed by
Postgres and its existing OAuth, added in `lib/server/agent-mcp.ts`:
`stride_project_context`, `stride_context_changes`, `stride_context_history`,
`stride_peer_activity`. Those read as the connection's **human operator**, the
same scoping `companionNotices` already used, so an agent can never see more
than the person accountable for it.

This hub is the local harness: same concepts, no Postgres or OAuth to stand up.

## Bugs found in review, and why they mattered

- **A pending proposal erased approved context.** `contextHead` joined on the
  document's `current_version`, which advances on every proposal - so proposing
  an unapproved change removed the approved revision from every other agent's
  view. Any agent could suppress a constraint it did not want to follow just by
  proposing an edit to it. It now selects the latest revision whose state is
  `active`, and pending proposals are a separate list.
- **Expired leases read as held.** `work_claim` correctly let another agent take
  over an expired lease, but `work_list` still showed the old holder, so
  abandoned work looked like work in progress. Expiry is now applied on read and
  written to the log as `work_lease_expired`, so it is auditable rather than a
  silent disagreement between the list and what a claim would do.
- **Work creation was neither atomic nor idempotent.** The row was inserted
  outside the transaction that wrote its event, so a failure could leave an item
  that never appeared in the feed - invisible to every agent.
- **`prompt` mode is unusable headlessly.** Every runner invocation is
  non-interactive, so there is nobody to answer the approval prompt: the agent
  stalls having done nothing. The runner now refuses up front, with `-Auto` to
  switch the policy and proceed.
- **A cached token drifted.** Codex's token lived in `codex-token.txt`; when it
  went missing the tools returned 401, which read as a login failure rather than
  a stale copy. The runner now asks the hub per run, so there is one source of
  truth and no secret on disk.
- **An unverified model name failed at run time.** `gpt-5-codex` is rejected for
  a ChatGPT-account login. Leave the model blank to use the account default, and
  do not set a model you have not seen work.

## Gotchas that cost real time here

- **PowerShell 5.1 has no `??`** — that is PS7+. It is a parse error, not a
  runtime one, so it takes the whole script down.
- **PowerShell 5.1 splits a native argument on embedded double quotes.** Build
  docker arguments as arrays and keep double quotes out of them.
- **Codex stores the *name* of an env var, not the token.** The runner passes
  `HUB_TOKEN` at run time, fetched from the hub rather than a cached file.
- **A bare re-register must not clear policy.** `connect.ps1` re-registers every
  run and does not know the model, so an unset field means "leave it", not
  "clear it". There is a regression test for exactly this.
- **Gemini's hostname must stay pinned** (`stride-agent-gemini`); its credential
  store cannot be read in a container other than the one that wrote it, and
  `--name` does not set the hostname.

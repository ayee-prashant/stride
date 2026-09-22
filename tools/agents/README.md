# Agent team

Several CLI coding agents, each in its own container, each signed in with **your
own subscription**, sharing context through an MCP server and coordinating
through git. No API keys.

## Setup

```
agents setup
```

That is the whole thing. It builds the container images, installs and starts the
hub, clones a home volume per member, issues each a token, registers the hub as
an MCP server inside each one, and creates a git checkout per member.

Every step is skipped if it is already done, so **running it again is always
safe** — it is also the repair command when something drifts.

It stops and asks only for the one thing it cannot do for you, signing in:

```
agents login claude
agents login codex
```

Then `agents setup` again.

### When something is wrong

```
agents doctor
```

Checks every prerequisite and prints the exact fix beside anything broken —
Docker not running, an image not built, a runtime signed out, a member missing
its checkout. It never stops at the first problem, so one run tells you
everything that needs attention.

## Daily use

| Command | Does |
|---|---|
| `agents status` | the team at a glance, plus anything waiting on you |
| `agents ui` | the tracking panel — live feed, approvals, who holds what |
| `agents run <member> "<task>"` | give someone work |
| `agents doctor` | what is broken and how to fix it |

## The team

`agents.json` is the roster — who exists, which CLI they run, which model, and
what they are allowed to do. Editing it is how you change the team; nothing else
needs touching.

| Member | Runtime | Model | Role |
|---|---|---|---|
| manager | claude | claude-opus-5 | Plans, splits and assigns. Cannot implement. |
| agent1 | codex | gpt-5.6-terra | Implements assigned work. |
| agent2 | codex | gpt-5.6-sol | Implements assigned work. |
| tester | claude | claude-sonnet-5 | Writes tests and validates. |

Two members can share a runtime while being different agents on different
models — each gets a **clone** of that runtime's home volume, so it has its own
credentials, its own hub token and its own git branch. Without that the hub
could not tell them apart.

## How it works

- **Instructions reach an agent as tools it calls, not as a prompt.** All three
  CLIs speak MCP over HTTP natively, so shared context arrives as
  `context_head`, `feed_read`, `work_list` — things the agent can pull when it
  needs them, not a string fixed before it started.
- **Agents do not message each other.** Every action appends to one ordered log.
  Agent B learns what Agent A did by reading it, which gives a total order over
  who knew what and when, and lets a late joiner see the whole history.
- **Work is claimed with an expiring lease**, so two agents never duplicate a
  job, and nothing is stuck if one dies holding it.
- **Humans approve.** Agents propose; proposed context stays pending until a
  person promotes it. There is no approve tool on the agent surface at all.
- **Work is fenced, not just timed.** Every claim mints a `lease_generation`.
  A worker that stalls past its lease, loses the item to someone else and then
  wakes up is refused on its old generation rather than overwriting the current
  holder's result. An expiry alone cannot express that.
- **The log records what an actor had read**, not only the order things
  happened. `#52 after #51` says nothing about whether the actor had seen `#51`;
  every write carries `based_on_sequence` and `stale_by`, so you can say
  "this was built from state through #48 and was four events stale".
- **Git writes go through a gateway.** Each member has its own clone and branch.
  The authoritative bare repo is served by a `git daemon` container and is *not*
  mounted into any agent, so every write passes through `git-receive-pack` where
  the non-fast-forward and deletion hooks apply.

### What is enforced, and what is not

Each row below was tested by running the attack, not by reading the code.
"Attack-verified" means the attempt was made and the outcome observed.

**Attack-verified blocked**

| Attack | Stopped by |
|---|---|
| Write bare-repo files directly | no mount of it exists in any agent |
| Force-push / rewrite history | `receive.denyNonFastForwards` |
| Delete any ref | `receive.denyDeletes` |
| Push to `main` | `update` hook confining writes to `refs/heads/agent/*` |
| Create a ref outside `agent/*` | same hook |
| Create or assign work without being manager | role check in the store |
| Act on a lapsed lease | lease generations |
| Approve its own proposed context | no such tool exists |

**Attack-verified succeeds — not enforced**

| Attack | Why |
|---|---|
| `agent1` fast-forwards `agent2`'s branch | It is an ordinary fast-forward, which `denyNonFastForwards` is supposed to allow. `git://` has no authentication, so a hook cannot tell which agent is pushing. Branch *ownership* is a convention recorded in commit authorship, not a control. |
| Reach the internet, add a remote, exfiltrate | Containers have unrestricted egress — `github.com` and `example.com` are both reachable. A local `origin` is hygiene, not a boundary. Enforcement needs default-deny egress with an allowlist for the model endpoints. |

Both of these are left unenforced deliberately for now. The work-assignment
system already records which member owns an item, and git is artifact transport;
cryptographic branch ownership is worth building when there is a concrete need,
not before. Closing the first needs an authenticated gateway that checks caller
identity and lease generation per push, which `git daemon` cannot do.

**Corrections.** Two properties were previously documented as enforced and were
not. A writable bind mount of the bare repo let one agent delete another's
branch with `update-ref`, because `denyDeletes` only runs inside
`git-receive-pack`. And "agents cannot reach GitHub" was simply false. Both
claims were found by attacking them.

`hub/DESIGN.md` has the reasoning; `git/PROTOCOL.md` is what the agents read.

## Files

| | |
|---|---|
| `agents.cmd` / `agents.ps1` | **the entry point** — everything below is machinery |
| `agents.json` | the roster and runtimes |
| `hub/` | MCP server, store, tracking panel, 113 tests |
| `git/` | per-member checkouts and the shared repo |
| `team-setup.ps1`, `git/git-setup.ps1`, `hub/runner.ps1` | called by `agents setup` and `agents run` |

`hub/data`, `hub/node_modules`, `git/stride.git`, `git/clones` and `runs/` are
regenerated and not committed.

## Things that caused real bugs here

Worth knowing before changing any of this.

- **PowerShell 5.1 mangles a native-command argument containing double quotes or
  newlines.** A multi-line prompt arrived in the container as one run-together
  string with quotes stripped and newlines turned into the letter `n`. Prompts
  now go in as a mounted file; the agent working from a corrupted brief is how
  this was found.
- **`Set-Content -Encoding utf8` writes a BOM in 5.1.** The agent read an
  invisible U+FEFF as the first character of its instructions. Use
  `[System.IO.File]::WriteAllText` with `UTF8Encoding($false)`.
- **PowerShell function names are case-insensitive and shadow external
  commands.** A helper named `Git` made `& git` call itself.
- **PowerShell 5.1 has no `??`** — it is a parse error, not a runtime one.
- **A new Docker volume is owned by root**, but the images run as uid 1001, so
  copying into one needs `--user root` and a `chown` afterwards.
- **`--name` does not set a container's hostname**, only `--hostname` does.
- **Windows checks out CRLF by default.** These files are mounted into Linux
  containers where a CR breaks a shebang and every line after it — hence the
  `.gitattributes` entries. Getting this wrong once showed 326 files as modified.
- **Never set `ANTHROPIC_API_KEY`.** It takes precedence over the signed-in
  account, so a stray key silently bills the API instead of the subscription and
  makes auth failures look like key failures.
- **Verify a model id before setting it.** `gpt-5-codex` and `gpt-5.6-astra` are
  both rejected on a ChatGPT account; an unsupported id fails at run time.

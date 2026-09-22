# Shared context for three CLI agents — design

## What the research changed

Two of the choices below differ from the brief. Both changes come from what the
CLIs actually support, verified against the real binaries, not from preference.

### 1. Agents connect over MCP, not WebSocket

All three CLIs speak the Model Context Protocol over HTTP natively:

```
claude  mcp add --transport http <name> <url> --header "Authorization: ..."
codex   mcp add <name> --url <url> --bearer-token-env-var <VAR>
gemini  mcp add -t http <name> <url> -H "..." --trust
```

A WebSocket carries bytes, but none of these agents know what to do with them —
we would have to write and maintain an adapter per agent, and the agent would
only reach it if the model decided to call a shell command. Over MCP the shared
context arrives as *tools the model can call*, which is the difference between
data being available and data being used.

**WebSocket is still used — for the UI.** Browser to server, for the live feed.
That is the job it is actually good at here.

### 2. Agents talk *through* the log, not to each other

Direct agent-to-agent messaging is the obvious reading of "they can communicate
with each other", but it is the wrong shape:

- Three agents is six directed channels; it grows N(N−1).
- No global ordering, so "who knew what, when" is unanswerable.
- Nothing is auditable after the fact — a claim by one agent about another
  cannot be checked.

Instead every agent reads and appends to one ordered, versioned log. Agent A
learns what Agent B did by reading the feed, not by being told. This is the
blackboard pattern, and it is what STRIDE's own `context_events` table already
implements. It is strictly more capable than messaging: a late-joining agent
sees the whole history, which a message it was not sent cannot give it.

## Prior art in this repo — this is not greenfield

STRIDE already has most of this, and it is well built. `db/context-schema.ts`:

| Table | Role |
|---|---|
| `project_context_heads` | monotonic `sequence` per project — a logical clock |
| `context_documents` | `requirement` / `decision` / `constraint` |
| `context_revisions` | immutable versions, each with a human `approved_by` |
| `context_events` | the ordered log |
| `task_context_briefs` | a frozen, fingerprinted context snapshot for one task |
| `task_context_bindings` | which brief a task is pinned to |

And `/mcp` is already an OAuth-authenticated MCP endpoint exposing
`stride_get_role`, `stride_inbox`, `stride_work_packet`, `stride_claim`,
`stride_checkpoint`, `stride_submit`.

**The gap is not the design. It is that the containerised CLIs are not
connected to any of it**, and there are no tools for reading or contributing to
shared context as opposed to delivering a single ticket.

So this hub deliberately mirrors that schema rather than inventing one. It runs
standalone so it can be proven quickly, and every concept maps 1:1 onto the
STRIDE tables for when it moves in.

## What makes it scale

These are the properties that matter once more than one agent writes at once.
Each is taken from the existing schema.

| Property | Mechanism |
|---|---|
| Ordering | one monotonic `sequence` per project, assigned in a transaction |
| Safe retries | `request_id` unique per project — a repeat is a no-op, not a duplicate |
| No lost updates | `expected_version` on writes; a stale writer is rejected |
| Stale-view detection | every response carries `head_sequence` |
| No duplicated effort | work items are claimed with an expiring lease |
| Auditability | revisions are immutable; new facts are new versions |

## Shape

```
   Claude Code ──┐
   Codex       ──┼── MCP over HTTP ──► hub ──► SQLite (node:sqlite, WAL)
   Gemini      ──┘                      │
                                        │
   Browser UI ◄──── WebSocket ──────────┘   live feed
                                        │
                              controller / policy
                       model + approval mode per agent, per task
```

## Tool surface

Deliberately small. Every response includes `head_sequence`.

**Shared memory**
- `context_head` — the approved context as of now
- `context_get(document_id)` — one document, current version
- `context_propose(...)` — propose a change; lands as `pending` for a human

**Coordination — how agents see each other**
- `feed_read(since_sequence)` — ordered events from every agent
- `note_append(...)` — publish a finding for the others to read
- `agent_identity()` — which agent am I, on what model, under what approval mode
  (deliberately not called `whoami`, which collides with the shell command)

**Work**
- `work_list()` / `work_claim(...)` / `work_release(...)` — leases stop two
  agents doing the same job

## Deliberate limits

- **Agents cannot approve context.** `context_propose` writes `pending`. Only a
  human promotes it. This preserves STRIDE's premise that agent output is
  *reported* until a person verifies it, and it is why there is no
  `context_approve` tool exposed to agents.
- **No agent can act as another.** Each connects with its own token; the hub
  stamps the actor, agents do not declare it.
- **Auto-approve is scoped to tool execution, not to truth.** The controller may
  let an agent run without prompting; it never lets an agent mark its own work
  approved.

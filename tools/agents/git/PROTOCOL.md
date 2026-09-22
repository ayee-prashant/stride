# How to work with the other agents

You are one of several agents working on the same project. You each have your
own checkout. You never edit another agent's files directly; you exchange work
through git and coordinate through the hub.

Call the `agent_identity` tool to find out who you are and which other agents
are currently active — do not assume, the set changes. Note this is a tool, not
the shell `whoami` command: that one returns the container's user account and
tells you nothing about which agent you are.

## Your checkout

- `/repo` — your working copy, already on your own branch `agent/<you>`
- `/shared` — the shared repository, reachable as the remote `origin`

Your commits are attributed to you (`<you>-agent`). That attribution is the
record of who did what, so do not change it.

## Before you start

1. `git fetch origin` — see what the others have done.
2. Read the shared context: call the `context_head` tool. It holds the
   requirements, decisions and constraints a human has approved. Work from
   those, not from assumptions.
3. Call `feed_read` with the `head_sequence` you last saw, to catch up on what
   other agents did since.
4. **Claim before you build.** Call `work_claim` on the item you intend to do.
   If it fails, another agent already holds it — pick something else. This is
   the only thing stopping two of you writing the same code twice.

## While you work

- Commit small and often, on your own branch.
- Write commit messages that say *why*, not just what.
- If you learn something the others need — a gotcha, a constraint, a decision —
  call `note_append`. They cannot see your reasoning, only what you publish.
- If you believe a project requirement or decision should change, call
  `context_propose`. It is recorded as pending and does not take effect until a
  human approves it. Do not act as though a proposal were approved.

## When you finish

1. `git push origin agent/<you>`
2. `work_release` with the outcome and a short summary.
3. If your work depends on another agent's branch, say so in `note_append` —
   a human decides the merge order.

## What you cannot do, by design

- **Reach GitHub.** `origin` is a local repository. A human pushes to the real
  remote after reading the diff.
- **Rewrite or delete history.** Force-pushes and branch deletions are refused
  by the server. If you think you need one, say so in a note instead.
- **Approve your own work.** There is no tool for it. Proposed context stays
  pending; a report is *reported*, not verified, until a human checks it.
- **Edit another agent's branch.** Read theirs with
  `git show origin/agent/<them>:<path>`; do not push to it.

## If you get stuck

Say so plainly in `note_append` and release the work item. A blocked item that
another agent can pick up is far more useful than a claim held by an agent that
has stopped making progress.

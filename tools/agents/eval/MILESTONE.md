# Milestone 1 — does coordination earn its cost?

**Date:** 2026-09-22 · **Status:** feature freeze · **M1A:** one promising result, mechanism unattributed · **M1B:** partial

The system was built over one session on a feedback loop, which is a good way to
get capable and a bad way to stay honest. This is the stop-and-measure.

## The question

Not "use fewer tokens". Rather: **spend extra agents and tokens only where they
buy better software, better decisions, better traceability or safer recovery.**

## Method

One task — `parseDuration`, the inverse of a formatter the team built earlier —
graded by **77 held-out assertions written from the spec before any run and shown
to no agent**. The grader was validated against a known-good reference first,
77/77, so a low score means the implementation failed, not the test.

Two specs, same task:

- **precise** — every rule stated, including that `-0s` is invalid.
- **ambiguous** — the same task with three rules deleted: unit ordering and
  repetition, exact whitespace, and negated zero. Both readings defensible.

> **An important caveat about scoring the ambiguous spec.** The held-out suite
> embodies one chosen interpretation. An implementation that scores 75/77 against
> it is *not wrong relative to the spec it received* — it answered a question the
> spec never asked. So before the ambiguity is resolved, the legitimate measure is
> whether review **identified** it, **explained the consequence**, **offered the
> plausible readings**, and **escalated rather than silently inventing a rule**.
> Only after resolution does 77/77 become a fair correctness target.

## Results

### Does the four-role team beat one agent?

| Spec | Condition | Score | Agent time | Invocations |
|---|---|---:|---:|---:|
| precise | solo (terra) | 77/77 | 80s | 1 |
| precise | solo (opus) | 77/77 | 71s | 1 |
| precise | solo (sol) | 77/77 | 102s | 1 |
| precise | **team** | 77/77 | **217s** | **4** |
| ambiguous | solo (terra) | 75/77 | 82s | 1 |
| ambiguous | **team** | 75/77 | **284s** | **4** |

No. On a precise task three different models each hit the ceiling alone and the
team matched them for 2.7× the time. On the ambiguous task the team scored the
same as solo.

**But the team produced one thing solo did not.** Its manager identified the
exact ambiguity that cost both conditions their two assertions. The solo agent
reported *"Ambiguities found: none."* So did the team's own implementer.

**And the team failed to act on it.** That observation went into the manager's
report to a human. `PLAN.md`, the artifact the implementer was told to read, did
not contain it. **The defect was routing, not reasoning.**

### Is it the extra role, or the stronger model?

The team confounds both. So: hold the implementation fixed — Terra's 75/77
output — and vary only the reviewer.

| Reviewer | Model | `-0s` | repetition | whitespace | offered the reading the grader asserts | time |
|---|---|:---:|:---:|:---:|:---:|---:|
| agent1 | gpt-5.6-terra *(same model that wrote it)* | yes | yes | — | — | 38s |
| tester | claude-sonnet-5 | yes | yes | **yes** | — | 81s |
| manager | claude-opus-5 | yes | yes | — | **yes** | 48s |
| agent2 | gpt-5.6-sol | yes | yes | — | — | **4133s** |

All four reviewers recovered at least two of the three deleted rules, across
three different models and both runtimes. The implementation pass had declared
the spec unambiguous.

**The first row is the one that matters.** A fresh Terra invocation, asked to
review, surfaced requirements a Terra invocation asked to implement had missed.
That rules out "the stronger model found it".

> **What this does and does not establish.** It shows a fresh invocation doing
> review behaves differently from one doing implementation. It does **not**
> isolate *why*: role framing, fresh context and additional inference budget are
> all still confounded with each other. An ablation separating them — self-review
> inside one invocation, a fresh same-model *implementation* pass, and a fresh
> same-model *review* pass — would settle it and has not been run.

Reviewer-model differences were also visible: Sonnet found all three and verified
the runtime behaviour; Opus was the only one whose options included rejecting
`-0s`, which is what the grader asserts. **Single runs cannot attribute those
differences reliably to model capability** and they may reverse on a re-run.

**Cost variance between reviewers dwarfed quality variance.** Sol took 4133s —
69 minutes, 54× Sonnet — for a result no better than Terra's 38s. The run was
genuine: 178 lines of substantive review, no retries, no rate limiting in the
transcript. One run cannot separate an inherently slow model from transient
load, but a reviewer that may take an hour is not usable as a default stage
whatever it finds. Reviewer choice should be treated as a latency decision as
much as a quality one.

**A detail worth recording, because it cuts against the framing above.** Two
reviewers reported that the implementation returns `-0`, not `0`, and checked it
with `Object.is`. My own probe of the same code printed `0` — string
concatenation renders `-0` as `"0"`. The agents were more precise about the
artefact than the harness measuring them was. That is a caution about trusting
any single instrument here, including mine.

### Does routing the finding change the outcome?

The whole point. Take the same 75/77 implementation, hand it a structured open
question carrying the consequence, the readings and a human's resolution, and
re-run the implementer.

| Stage | Score | Ambiguity surfaced | Cost |
|---|---:|---|---:|
| implement alone | 75/77 | no — *"ambiguities: none"* | 82s |
| + independent review | 75/77 | **yes**, with readings | +38s |
| + routed resolution | **77/77** | resolved | +27s |

**The chain closes.** Independent review produced new information; a structured
artifact persisted it; a human resolved it; the implementer changed the code; the
measure moved.

The change was four lines, and the implementer correctly reported that only
OQ-1 required it — OQ-2 and OQ-3 already matched, and it left them alone.

```
implement(82s) + review(38s) + resolve(27s) = 147s, 3 invocations  ->  77/77
the four-role team                          = 284s, 4 invocations  ->  75/77
```

## The correction that matters most

**The only positive result in this project was produced without STRIDE.**

`run-solo.sh`, `run-review.sh` and `run-resolve.sh` — the three scripts that took
an implementation from 75/77 to 77/77 — contain **zero** references to the hub,
MCP, the network, or a token. Verified by inspection:

```
run-solo.sh      hub refs: 0   mcp refs: 0   network: 0   HUB_TOKEN: 0
run-review.sh    hub refs: 0   mcp refs: 0   network: 0   HUB_TOKEN: 0
run-resolve.sh   hub refs: 0   mcp refs: 0   network: 0   HUB_TOKEN: 0
```

Each is `docker run` with a mounted directory and a prompt file. No leases, no
event log, no roster, no gateway, no MCP.

So the evidence supports a claim about a **workflow**:

> implement → independent review → structured resolution → targeted fix
> improved one implementation on one task.

It does **not** support any claim about the coordination platform. A shell script
passing files between three CLI invocations is not a counterfactual to STRIDE
here — it is what actually produced the result.

Two further caveats on the team comparison that made STRIDE look worse than it
is, and which cut both ways: the team condition ran in a shared workspace rather
than the real architecture, and an over-broad transcript grep matched the word
"fail" and triggered an unnecessary fourth invocation. So 284s/4 is not a clean
measurement of the product either.

**What STRIDE has left to prove.** If a file-passing script reaches the same code
quality, the platform must justify its machinery on traceability, recovery, or
coordination under concurrency — not on output quality, where it currently has
no advantage to show.

## Conclusion

The finding is **not "multi-agent is better"**. It is:

> **A second, explicitly critical pass surfaces problems the same model misses
> while implementing — and only pays off if the finding is routed into an
> artifact the implementer must consume.**

A fixed four-role pipeline is the wrong default. It costs 4× and, in the one case
where it discovered something valuable, dropped it on the floor.

## Direction

Default to the smallest thing that works:

```
IMPLEMENT -> REVIEW -> (open question?) -> resolve -> targeted fix
```

Treat everything else as **escalation triggered by risk**, not a mandatory stage:

| Trigger | Escalate to |
|---|---|
| ambiguity the review cannot resolve | a human, or a manager role |
| risky or wide-reaching change | independent testing |
| disputed approach | a second implementation |
| critical artifact | sealed verification |

Multi-agent work becomes an escalation mechanism rather than the default shape.

## Still open

- **Does STRIDE add anything?** The next experiment is the same
  implement → review → resolve chain with the hub, leases and event log in the
  loop, compared against the file-passing scripts that already reach 77/77. If
  code quality is equal, the platform must be justified on traceability,
  recovery or concurrency instead.
- **The ablation.** Self-review in one invocation vs a fresh implementation pass
  vs a fresh review pass. Until that is run, "role separation" remains one of
  several candidate explanations alongside fresh context and extra inference.
- **One task, one run per condition.** Nothing here generalises yet.
- **One task, single runs.** The role-separation effect is large enough to read
  through that noise; the model gradient is not.
- **Five of the six dimensions are unmeasured.** Only software quality and cost
  have data. Reasoning diversity has one observation. Coordination effectiveness
  has one diagnosis. Traceability and recovery have none — and recovery is the
  one a "solid tool" claim rests on.
- **Cost is wall-clock and invocations.** The Claude CLI does not report tokens.
  Codex does: the resolution pass was 7,150. An attempt to measure the earlier
  task retroactively failed outright — its transcripts were 3 bytes each,
  destroyed by an encoding bug in the runner. Cost must be recorded as it happens.

## M1B — does coordination survive failure without lying?

Four invariants. "Recovers automatically" is deliberately not one of them: a
system that stops and says *"I have commit X, work Y never completed, worker Z is
gone"* has passed; one that quietly guesses has not.

| Invariant | Result |
|---|---|
| **No silent loss** — produced work stays recoverable | passed, after a fix |
| **No false success** — unfinished work never promoted | passed |
| **No duplicate authority** | **partial — coordination only** |
| **Explainable recovery** — the human can find out what happened | passed, after a fix |

**The authority invariant is narrower than first claimed.** Fencing covers the
hub. Git is a second, unauthenticated write path. Verified by attack:

```
hub:  agent1 refused -> stale lease: you hold generation 1, the item is on 2
git:  agent1 PUSHED 1aa79d0 to agent/agent2 - NOT fenced
```

A worker fenced out of recording completion can still modify the artifact the
current holder is working on, including on another agent's branch. The honest
statement is *"cannot record completion"*, not *"cannot write"*. The test and its
heading have been narrowed to match.

37 tests that kill things rather than mock them: the hub SIGKILLed mid-transaction
and immediately after commit, restart reconstruction, lease expiry, zombie
writers, and retries after a lost reply.

### Two gaps the attacks found

**Split brain — the artifact exists, the coordination write never landed.** An
agent pushed a real commit and died before `work_release`. Git held
`3ed922f by agent1-agent`; the hub showed the work `open`, no outcome, and **zero
events referencing the commit**. Neither system knew about the other, so produced
work was unrecoverable in practice — nothing told a human it existed.

Now `work_release` accepts the commit it produced, claims record the holder and
time, and `/api/recovery` reports what ended abnormally:

```
w_e814fbe6  needs a decision: held, then abandoned without reporting
            last held by agent1  ·  branch agent/agent1  ·  commit: none recorded
```

It deliberately does **not** attach the commit. Doing so would invent a
completion nobody verified.

**A stale hub reports healthy.** A claim came back with no lease generation, and
every check said "hub is running". It was — a process started before fencing
existed. My restart had silently failed to bind and the old one kept serving.
`/api/version` now compares process start time against source mtime, `doctor`
reports it, and `agents restart` fixes it.

The first version of that check was itself broken: it cached the mtime at
startup, so it could only ever compare a value against itself. It now reads at
request time.

## Reproducing

```
./run-solo.sh agent1                                  # precise, one agent
SPEC_FILE=SPEC-AMBIGUOUS.md ./run-solo.sh agent1      # ambiguous, one agent
./run-team.sh                                         # precise, four roles
SPEC_FILE=SPEC-AMBIGUOUS.md ./run-team.sh             # ambiguous, four roles
./run-review.sh <reviewer> runs/<impl-dir>            # fixed impl, vary reviewer
./run-resolve.sh agent1 runs/<impl-dir>               # route the resolution
```

Every condition is graded by the identical `heldout.test.mjs` in a clean
container. Each run writes `run.json` with time, invocations and, where the CLI
reports it, tokens.

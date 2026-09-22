# Milestone 1 — does coordination earn its cost?

**Date:** 2026-09-22 · **Status:** feature freeze, evaluated · **Verdict:** yes, but not as a team

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

| Reviewer | Model | `-0s` | repetition | whitespace | offered the reading the grader asserts |
|---|---|:---:|:---:|:---:|:---:|
| agent1 | gpt-5.6-terra *(same model that wrote it)* | yes | yes | — | — |
| tester | claude-sonnet-5 | yes | yes | **yes** | — |
| manager | claude-opus-5 | yes | yes | — | **yes** |

Every reviewer recovered at least two of the three deleted rules. The
implementation pass had declared the spec unambiguous.

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

- **The ablation.** Self-review in one invocation vs a fresh implementation pass
  vs a fresh review pass. Until that is run, "role separation" remains one of
  several candidate explanations.
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

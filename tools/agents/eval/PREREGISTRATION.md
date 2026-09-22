# M1C pre-registration — does STRIDE justify its existence?

**Written before the experiment is run.** Committed first so the acceptance
criteria cannot be adjusted once results are visible. If a measure or threshold
below turns out to be wrong, the correction goes in as a new commit with the
reason, not as a silent edit.

## The claim under test

> STRIDE's coordination platform — hub, MCP tools, leases, event log, git
> gateway — provides value beyond what the same models achieve passing files
> between invocations.

This is **not** the claim the existing evidence supports. The 75/77 → 77/77
result was produced by three `docker run` calls with a mounted directory and a
prompt file: zero hub references, zero MCP, no network, no token. That
established something about a *workflow*. This tests the *platform*.

## Conditions

Both run the same task, the same models, the same prompts, the same held-out
grading, and the same human decisions at the same points.

**A — baseline.** File-passing scripts, as they exist today, **plus a structured
JSONL run log** the harness writes: one record per step with actor, model, role,
timestamps, input hash, output hash, files touched, and commit SHA where one
exists.

> The log is not a handicap removal, it is what makes the comparison honest.
> Without it the baseline records nothing and STRIDE "wins" traceability by
> default — which would demonstrate that I wrote a logger, not that the platform
> is worth its machinery. The baseline should be what a competent engineer would
> build in an afternoon, because that is the real alternative.

**B — STRIDE.** The same workflow driven through the hub: work items, `work_claim`
with lease generations, MCP reads that advance the observation cursor,
`context_propose` for the open question, human resolution through the API,
`work_release` carrying the commit, and the git gateway for artifacts.

## Held constant

Task and spec (`SPEC-AMBIGUOUS.md`), models per role, prompt text, held-out
grader (`heldout.test.mjs`), the human's resolution (option C, reject negated
zero), and the number of model invocations where the design allows.

## Measures

### 1. Software quality

Identical held-out grading. **Parity is not a STRIDE advantage.** Both are
expected to reach 77/77 after resolution; if they do, this dimension is
uninformative and the decision rests entirely on the others.

### 2. Traceability

A **fresh agent that did not participate** is given each system's records alone
and asked ten fixed questions. The questions are fixed now so they cannot be
chosen to favour either system afterwards:

1. What requirement was this change made against, and at what version?
2. Which actor made it — name, model, role?
3. What state had that actor observed when it acted?
4. Which decisions were unresolved at the time of implementation?
5. Who resolved them, and was that before or after the code was written?
6. What commit resulted, and on which branch?
7. What tests were run, by whom, and what did they find?
8. What changed as a result of those findings?
9. What did a human approve, and at what point?
10. If the run had been interrupted, what was in flight?

Each answer scored **yes / partial / no** on whether it is derivable from records
alone. Scored by the fresh agent, not by me. Ties broken toward *no*.

### 3. Recovery

Both workflows interrupted at three equivalent points, by killing the container:

- **P1** after implementation, before review
- **P2** after review, before resolution
- **P3** after a commit is pushed, before completion is recorded

Measured per interruption: work lost, false completion recorded, manual steps to
recover, and whether the system states what was in flight without being asked.

### 4. Concurrency

Two agents on one work item with an injected lease expiry. Checked in **both**
the coordination records and the git artifacts.

> Known limitation, already verified by attack: lease fencing covers the hub
> only. A fenced worker pushed `1aa79d0` to another agent's branch and was
> accepted, because the git daemon has no authentication. STRIDE cannot claim a
> concurrency win it does not have, and this measure must report the git result
> alongside the hub result rather than only the flattering half.

### 5. Resource cost

Model usage where the CLI reports it, elapsed time, invocations, human
interventions, and infrastructure overhead — containers, daemons and processes
each condition requires to run at all.

## Decision rule, fixed in advance

**STRIDE is justified** if it shows a repeatable advantage in at least one of
traceability, recovery or concurrency, with no unacceptable regression in
quality or cost.

**STRIDE is not justified for this workload** if:

- quality is at parity, **and**
- the baseline's JSONL log answers the same traceability questions at the same
  score, **and**
- recovery differences are features rather than measurably better outcomes —
  fewer lost artifacts, fewer manual steps, less false completion.

"STRIDE has an endpoint for it" is not evidence. The question is whether a human
recovers faster or loses less.

**Repeatable** means at least two runs per condition. A single-run difference is
recorded as an observation, not a finding — the existing model gradient
(Sonnet 3-of-3, Opus 2-of-3) is exactly the kind of noise that should not become
a conclusion.

## Threats to validity, named now

- **I built one side.** I am more likely to notice a baseline weakness than a
  STRIDE one. The traceability scoring is delegated to a fresh agent for this
  reason, and the questions are fixed above.
- **One task.** `parseDuration` is small, single-file and well-understood.
  Concurrency and recovery advantages plausibly grow with task size, so a null
  result here bounds the claim to tasks of this size and does not refute the
  platform generally.
- **The earlier team comparison was flawed in both directions** — shared
  workspace rather than the real architecture, and an over-broad grep that
  triggered a fourth invocation. It is not being reused as a baseline.
- **Interruption points are chosen by me** and may suit one design. They are
  fixed above before either condition runs.

## What I will not do

- Choose measures, questions or thresholds after seeing results.
- Report the hub concurrency result without the git result beside it.
- Treat the existence of a feature as evidence that it helped.
- Call a single-run difference a finding.
- Add capability to either condition mid-experiment. If something is missing,
  that is a result.

---

## Amendment 1 — traceability scoring instrument

**Added before any M1C run. Committed separately from the original so the change
and its reason are visible in history rather than folded in.**

The original said traceability would be scored "by a fresh agent that did not
participate". That is changed to a typed `score` question per item, answered by
the decisions model already used elsewhere in this harness.

**Why.** The regexes this harness used to score the reviewer matrix were wrong in
two of four cells, and both errors flattered the result — one invented a model
gradient, the other inflated a cost figure. A chat model asked to grade prose
has the same failure mode with none of the calibration: its answer is a sentence
I then interpret. A typed question returns a probability, so a borderline answer
is recorded as borderline instead of being rounded by whoever reads it.

**The risk this introduces, stated plainly.** I am changing the measuring
instrument after seeing it produce a result I liked. That is the shape of a
post-hoc choice even when the reasoning is sound. Three constraints follow:

1. The ten questions are unchanged from the original. They were fixed before any
   scoring existed and are not renegotiated here.
2. Both conditions are scored by the same instrument, same questions, same
   order, in the same run.
3. The raw probabilities are reported, not just the yes/partial/no rounding, so
   the reader can see where the instrument was uncertain rather than taking my
   bucketing on trust.

**What would invalidate this choice.** If the model's answers disagree with a
manual reading of the records on any item, the manual reading wins and the
disagreement is reported. The instrument is here to be more consistent than a
regex, not to be the final authority on its own output.

# Milestone 1 — is the team worth what it costs?

**Date:** 2026-09-22  ·  **Status:** feature freeze, evaluated  ·  **Verdict:** not yet

The system was built over one session on a feedback loop, which is a good way to
get capable and a bad way to stay honest. This is the stop-and-measure.

## The question

Does coordinating several agents produce better software than one agent working
alone — and if so, where? Token cost is not the goal, but spending 4× for the
same output is not "traceable and solid", it is waste dressed as rigour.

## Method

One task (`parseDuration`, the inverse of the formatter the team built earlier),
graded by **77 held-out assertions written from the spec before any run and shown
to no agent**. The grader was validated against a known-good reference first —
77/77 — so a low score means the implementation failed, not the test.

Two specs, identical task:

- **precise** — every rule stated, including ordering, exact whitespace, and
  that `-0s` is invalid.
- **ambiguous** — the same task with those three rules removed. Both readings
  defensible. The held-out suite still asserts the strict reading.

Two conditions: one agent alone, told it is alone and that nobody will review
its work; and the team (manager plans and assigns, implementer builds, tester
validates from the spec, implementer fixes).

The team ran in a **single shared workspace** rather than separate git clones —
no fetch/push overhead, every member sees the others' files immediately. That
favours the team, so the cost below is a floor.

## Results

| Spec | Condition | Model(s) | Score | Agent time | Invocations |
|---|---|---|---:|---:|---:|
| precise | solo | gpt-5.6-terra | **77/77** | 80s | 1 |
| precise | solo | claude-opus-5 | **77/77** | 71s | 1 |
| precise | solo | gpt-5.6-sol | **77/77** | 102s | 1 |
| precise | **team** | all four | **77/77** | **217s** | **4** |
| ambiguous | solo | gpt-5.6-terra | **75/77** | 82s | 1 |
| ambiguous | **team** | all four | **75/77** | **284s** | **4** |

## What this says

**On a well-specified task the team is pure overhead.** Three different models,
working alone, each hit the ceiling. The team matched them for 2.7× the time and
4× the invocations. The tester found nothing, because there was nothing to find:
*"No violations found — parse.js correctly implements the spec."*

**On an ambiguous task the team scored no better either.** Both lost the same two
assertions, both on `-0s` — the same defect class as the signed-zero bug in the
earlier formatter task. Ambiguity in the spec produced a wrong guess whether one
agent or four were working.

**But one thing only the team produced.** The manager, unprompted:

> `"-0s"` parses to `-0` under a literal reading, and whether the hidden suite
> wants `0` or `-0` is unspecified; I'd return `0`.

That is the exact ambiguity that cost both conditions their two points. The solo
agent reported *"Ambiguities found: none."* So did the team's own implementer.

**And the team failed to act on it.** The manager put that observation in its
report to the human. Its `PLAN.md` — the artifact the implementer was told to
read — listed three rules likely to be got wrong (correctly predicting the sign
handling and the strict-form requirements) but **not the `-0s` ambiguity**. The
implementer never saw the one insight that would have changed the outcome.

## Conclusion

Right now the team is mostly waste. It costs 4× and produces the same artifact.

The mechanism that would justify it is real and was observed: **a reviewing role
notices that a specification is underdetermined when a building role does not.**
Both ran the same task; only the manager saw it. That is not a scoring
difference, it is an information difference, and it is the thing worth having —
a spec question routed to a human is worth more than a confident guess.

The defect is routing, not reasoning. The manager's uncertainty went into prose
addressed to a human instead of into the artifact the implementer consumes.

## What to do next — one change, then re-measure

**Make uncertainty a first-class artifact, not a paragraph.** The manager should
be required to emit `open_questions` as structured output, the implementer
required to read them, and anything still open at submission time recorded on
the work item so a human sees it. If the manager's `-0s` note had been an open
question the implementer had to answer or escalate, this experiment would have
had a different result.

Then re-run exactly this evaluation. If the ambiguous-spec gap does not move,
the team is not worth its cost for tasks of this size and should be reserved for
work too large for one agent — which this task is not.

**Explicitly not next:** more capability. No new roles, no sealed test flow, no
authenticated git gateway, no provenance schema. Those are all defensible and
none of them is the reason this scored 75/77.

## Reproducing

```
./run-solo.sh agent1                          # precise spec, one agent
SPEC_FILE=SPEC-AMBIGUOUS.md ./run-solo.sh agent1
./run-team.sh                                 # precise spec, the team
SPEC_FILE=SPEC-AMBIGUOUS.md ./run-team.sh
```

Each run writes `run.json` with time and, where the CLI reports it, tokens.
`heldout.test.mjs` grades every condition identically in a clean container.

**Measurement gap:** the Claude CLI does not report token usage, so cost here is
wall-clock and invocation count. Those are honest proxies but not the same
thing. An earlier attempt to measure retroactively failed outright — the
transcripts for the formatter task were 3 bytes each, destroyed by an encoding
bug in the runner. Cost must be recorded at the time or it is not recoverable.

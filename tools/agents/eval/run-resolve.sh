#!/usr/bin/env bash
# The causal-chain test.
#
#   ./run-resolve.sh <implementer> <impl-dir>
#
# The earlier team run showed the manager DISCOVERING an ambiguity and the
# implementation not changing, because the finding lived in prose addressed to a
# human rather than in an artifact the implementer consumes. This routes the
# same information as a structured open question with a resolution, hands it to
# the implementer, and re-grades.
#
# If the score moves, the chain is demonstrated end to end:
#   independent review -> new information -> persisted -> resolved -> changed
#   implementation -> measurable improvement.
# If it does not, the coordination layer is not paying for itself here.
set -uo pipefail
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

MEMBER="${1:-}"; SRC="${2:-}"
[ -n "$MEMBER" ] && [ -n "$SRC" ] || { echo "usage: $0 <implementer> <impl-dir>" >&2; exit 2; }
[ -f "$SRC/parse.js" ] || { echo "no parse.js in $SRC" >&2; exit 2; }

HERE="$(cd "$(dirname "$0")" && pwd)"
HOST="$(cygpath -m "$HERE" 2>/dev/null || echo "$HERE")"
CFG="$(cygpath -m "$HERE/.." 2>/dev/null || echo "$HERE/..")/agents.json"

read -r runtime model image < <(node -e "
  const c = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
  const m = c.roster[process.argv[2]];
  console.log([m.runtime, m.model, c.runtimes[m.runtime].image].join(' '));
" "$CFG" "$MEMBER") || exit 1

STAMP=$(date +%Y%m%d-%H%M%S)
RUN="$HERE/runs/resolve-$MEMBER-$STAMP"
RUN_HOST="$HOST/runs/resolve-$MEMBER-$STAMP"
mkdir -p "$RUN"
cp "$HERE/${SPEC_FILE:-SPEC-AMBIGUOUS.md}" "$RUN/SPEC.md"
cp "$SRC/parse.js" "$RUN/parse.js"

# The artifact. Structured, with a resolution - not a paragraph in a report.
# Every field exists because its absence is what failed last time: the question
# alone is not actionable, the consequence is what makes it worth acting on, and
# without a recorded resolution the implementer is guessing again.
cat > "$RUN/OPEN_QUESTIONS.md" <<'EOF'
# Open questions

Raised by an independent review of parse.js against SPEC.md. Each was
unspecified in the spec, so the implementation had to choose a reading. A human
has resolved them. Apply the resolutions.

---

## OQ-1 — negated zero

- **Requirement affected:** negative durations are allowed (`-1s` is valid).
- **Unspecified case:** how a negative zero duration such as `"-0s"` behaves.
- **Observed implementation:** returns `0`.
- **Consequence:** a caller cannot distinguish "zero" from "a malformed negative
  zero", and the formatter never produces `-0s`, so accepting it admits input
  the rest of the system cannot generate.
- **Interpretations:**
  - A. Accept and return `0`.
  - B. Preserve JavaScript `-0`.
  - C. Reject a `-` applied to a zero-valued duration.
- **RESOLUTION: C** — reject with `TypeError`. This applies to any zero-valued
  duration carrying a sign, such as `"-0s"`, `"-0d"`, `"-0d 0s"`.

---

## OQ-2 — repeated and out-of-order units

- **Requirement affected:** parts are `<integer><unit>`, largest unit first.
- **Unspecified case:** whether a unit may repeat (`"1h 1h"`) or appear out of
  order (`"1s 1d"`).
- **Observed implementation:** rejects both.
- **Interpretations:**
  - A. Reject both.
  - B. Allow repetition and sum the parts.
- **RESOLUTION: A** — reject both. Units must be strictly descending and may
  appear at most once.

---

## OQ-3 — whitespace

- **Requirement affected:** parts are separated by a space.
- **Unspecified case:** leading or trailing whitespace, and more than one space
  between parts.
- **Observed implementation:** rejects them.
- **RESOLUTION** — reject. Exactly one space between parts, no leading or
  trailing whitespace of any kind.
EOF

cat > "$RUN/prompt.txt" <<'EOF'
You implemented parse.js in this directory. An independent review raised
questions the spec did not answer, and a human has now resolved them.

Read OPEN_QUESTIONS.md and SPEC.md, then update parse.js so it matches every
RESOLUTION. Do not change behaviour the resolutions do not mention.

Report in three short lines: which resolutions required a change, what you
changed, and which required none.
EOF

case "$runtime" in
  claude) CMD=(claude --print --permission-mode bypassPermissions --model "$model"
                'Read the file /work/prompt.txt and do exactly what it says.') ;;
  codex)  CMD=(codex exec --dangerously-bypass-approvals-and-sandbox -c "model=$model"
                'Read the file /work/prompt.txt and do exactly what it says.') ;;
esac

echo "=== routed resolution: $MEMBER ($model) ==="
START=$(date +%s)
docker run --rm \
  -v "agent-${MEMBER}-home:/home/agent" \
  -v "$RUN_HOST:/work" -w /work \
  "$image" "${CMD[@]}" > "$RUN/agent-output.txt" 2>&1
SECS=$(( $(date +%s) - START ))

cat > "$RUN/run.json" <<JSON
{"condition":"resolve","member":"$MEMBER","model":"$model","seconds":$SECS,"invocations":1}
JSON

echo "  ${SECS}s"
cp "$HERE/heldout.test.mjs" "$RUN/"
echo "  --- held-out grading (same 77 assertions as every other condition) ---"
docker run --rm -v "$RUN_HOST:/w" -w /w node:24-slim node heldout.test.mjs ./parse.js 2>&1 | tail -12 | sed 's/^/  /'
echo "  run: $RUN"

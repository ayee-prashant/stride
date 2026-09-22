#!/usr/bin/env bash
# Hold the implementation fixed, vary only the reviewer.
#
#   ./run-review.sh <reviewer-member> <path-to-implementation-dir>
#
# The full-team experiment could not separate "a second role looked at it" from
# "a stronger model looked at it", because the team changes both at once. Here
# every condition reviews the SAME parse.js against the SAME spec, so the only
# variable is who is reviewing.
#
# The scored question is whether the review finds the spec ambiguity that cost
# the implementation its two held-out assertions. Finding it is the outcome that
# matters; a review that merely agrees is the null result.
set -uo pipefail
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

REVIEWER="${1:-}"
SRC="${2:-}"
[ -n "$REVIEWER" ] && [ -n "$SRC" ] || { echo "usage: $0 <reviewer> <impl-dir>" >&2; exit 2; }
[ -f "$SRC/parse.js" ] || { echo "no parse.js in $SRC" >&2; exit 2; }

HERE="$(cd "$(dirname "$0")" && pwd)"
HOST="$(cygpath -m "$HERE" 2>/dev/null || echo "$HERE")"
CFG="$(cygpath -m "$HERE/.." 2>/dev/null || echo "$HERE/..")/agents.json"

read -r runtime model image < <(node -e "
  const c = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
  const m = c.roster[process.argv[2]];
  if (!m) { console.error('no such member'); process.exit(1); }
  console.log([m.runtime, m.model, c.runtimes[m.runtime].image].join(' '));
" "$CFG" "$REVIEWER") || exit 1

STAMP=$(date +%Y%m%d-%H%M%S)
RUN="$HERE/runs/review-$REVIEWER-$STAMP"
RUN_HOST="$HOST/runs/review-$REVIEWER-$STAMP"
mkdir -p "$RUN"
cp "$HERE/${SPEC_FILE:-SPEC-AMBIGUOUS.md}" "$RUN/SPEC.md"
cp "$SRC/parse.js" "$RUN/parse.js"

cat > "$RUN/prompt.txt" <<'EOF'
You are reviewing someone else's implementation before it ships. You did not
write it and you will not be asked to fix it.

Read SPEC.md and parse.js in the current directory.

Report two things, as two separate lists.

1. VIOLATIONS - places where parse.js does not do what SPEC.md requires. For
   each, give the input, what it returns, and what the spec requires.

2. UNRESOLVED DECISIONS - places where SPEC.md does not determine the behaviour,
   so the implementation had to pick a reading and a different reader could
   reasonably have picked another. For each, state the input, the readings
   available, which one parse.js took, and what you would ask the author of the
   spec.

If a list is empty, say so explicitly. Do not modify any file.
EOF

case "$runtime" in
  claude) CMD=(claude --print --permission-mode bypassPermissions --model "$model"
                'Read the file /work/prompt.txt and do exactly what it says.') ;;
  codex)  CMD=(codex exec --dangerously-bypass-approvals-and-sandbox -c "model=$model"
                'Read the file /work/prompt.txt and do exactly what it says.') ;;
esac

echo "=== reviewer: $REVIEWER ($model) ==="
START=$(date +%s)
docker run --rm \
  -v "agent-${REVIEWER}-home:/home/agent" \
  -v "$RUN_HOST:/work" -w /work \
  "$image" "${CMD[@]}" > "$RUN/review.txt" 2>&1
SECS=$(( $(date +%s) - START ))

# The implementation is unchanged, so the score is fixed. What varies is whether
# the review surfaced the decision that a human needed to make.
# Was a regex over the transcript. It scored a MENTION as a finding, which is
# not the same thing: a review that raises negated zero and resolves it itself
# scored identically to one that flags it for the spec author. Re-scoring the
# same transcripts with a typed question changed the matrix - the whitespace
# "find" was the word appearing in a list of things the reviewer had TESTED.
FOUND_P=$(node "$HERE/classify.mjs" "$RUN/review.txt"   'Does this review flag the handling of a negated zero duration (such as "-0s") as an UNRESOLVED decision that the specification does not determine and that needs the spec author to settle?'   'Raises it as unresolved, ambiguous, or something to ask the author about'   'Does not raise it, or mentions it but treats it as already settled' 2>/dev/null || true)
FOUND_AMBIG=$(node -e "process.stdout.write((parseFloat('${FOUND_P:-0}')>0.5)?'yes':'no')")

cat > "$RUN/run.json" <<JSON
{"condition":"review","reviewer":"$REVIEWER","model":"$model","seconds":$SECS,
 "found_the_ambiguity":"$FOUND_AMBIG","found_probability":${FOUND_P:-null}}
JSON

echo "  ${SECS}s   found the -0s ambiguity: $FOUND_AMBIG"
echo "  run: $RUN"

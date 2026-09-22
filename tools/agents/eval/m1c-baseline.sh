#!/usr/bin/env bash
# M1C condition A — the baseline.
#
#   ./m1c-baseline.sh [run-id]
#
# implement -> review -> resolve, passing files between docker invocations, with
# a structured JSONL log. No hub, no MCP, no leases, no event log, no gateway.
# This is the thing STRIDE has to beat.
set -uo pipefail
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

HERE="$(cd "$(dirname "$0")" && pwd)"
HOST="$(cygpath -m "$HERE" 2>/dev/null || echo "$HERE")"
CFG="$(cygpath -m "$HERE/.." 2>/dev/null || echo "$HERE/..")/agents.json"
RUNID="${1:-$(date +%Y%m%d-%H%M%S)}"
RUN="$HERE/runs/m1c-baseline-$RUNID"
RUN_HOST="$HOST/runs/m1c-baseline-$RUNID"
mkdir -p "$RUN"
LOG="$RUN/run.jsonl"
: > "$LOG"
# node runs as a Windows process: both the script path and the file it writes
# have to be Windows paths, or it fails with MODULE_NOT_FOUND and the log comes
# out empty while the run itself looks fine. The baseline's log IS condition A,
# so a silent failure here would have decided the experiment by accident.
RUNLOG="$HOST/runlog.mjs"
LOG_W="$RUN_HOST/run.jsonl"

cp "$HERE/SPEC-AMBIGUOUS.md" "$RUN/SPEC.md"
SPEC_HASH=$(node "$RUNLOG" "$LOG_W" hash "$RUN_HOST/SPEC.md")
node "$RUNLOG" "$LOG_W" append "{\"step\":\"start\",\"condition\":\"baseline\",\"run_id\":\"$RUNID\",\"spec\":\"SPEC.md\",\"spec_version\":\"ambiguous-v1\",\"spec_hash\":\"$SPEC_HASH\"}"

TOTAL=0; INVOCATIONS=0

step() {   # step <member> <role> <prompt> <step-name>
  local member="$1" role="$2" prompt="$3" name="$4"
  read -r runtime model image < <(node -e "
    const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
    const m=c.roster[process.argv[2]];
    console.log([m.runtime,m.model,c.runtimes[m.runtime].image].join(' '));
  " "$CFG" "$member")

  printf '%s' "$prompt" > "$RUN/prompt.txt"
  local before; before=$(node "$RUNLOG" "$LOG_W" hash "$RUN_HOST/parse.js")
  local cmd=()
  case "$runtime" in
    claude) cmd=(claude --print --permission-mode bypassPermissions --model "$model" 'Read the file /work/prompt.txt and do exactly what it says.') ;;
    codex)  cmd=(codex exec --dangerously-bypass-approvals-and-sandbox -c "model=$model" 'Read the file /work/prompt.txt and do exactly what it says.') ;;
  esac

  echo "  --- $name: $member ($model) ---"
  local start end secs
  start=$(date +%s)
  docker run --rm -v "agent-${member}-home:/home/agent" -v "$RUN_HOST:/work" -w /work \
    "$image" "${cmd[@]}" > "$RUN/out-$name.txt" 2>&1
  end=$(date +%s); secs=$((end-start))
  TOTAL=$((TOTAL+secs)); INVOCATIONS=$((INVOCATIONS+1))

  local after tok
  after=$(node "$RUNLOG" "$LOG_W" hash "$RUN_HOST/parse.js")
  tok=$(grep -oE 'tokens used[[:space:]]*[0-9,]+' "$RUN/out-$name.txt" | grep -oE '[0-9,]+' | tr -d ',' | tail -1)
  RL_STEP="$name" RL_ACTOR="$member" RL_ROLE="$role" RL_MODEL="$model"   RL_RUNTIME="$runtime" RL_SECONDS="$secs" RL_TOKENS="${tok:-}"   RL_SPEC_HASH="$SPEC_HASH" RL_BEFORE="$before" RL_AFTER="$after"   RL_TRANSCRIPT="out-$name.txt"   node "$RUNLOG" "$LOG_W" step
  echo "      ${secs}s"
}

step agent1 implementer 'Read SPEC.md in the current directory and implement exactly what it describes.

Create parse.js in the current directory exporting parseDuration as a named ESM
export. Do not write tests - a separate reviewer handles that.

Report in two lines: what you implemented, and anything in the spec you found ambiguous.' implement

step agent1 reviewer 'You are reviewing someone else s implementation before it ships. You did not write it.

Read SPEC.md and parse.js in the current directory. Write your findings to REVIEW.md as two lists:

1. VIOLATIONS - where parse.js does not do what SPEC.md requires.
2. UNRESOLVED DECISIONS - where SPEC.md does not determine the behaviour, so the
   implementation had to pick a reading. For each: the input, the readings
   available, which one parse.js took, and what you would ask the spec author.

If a list is empty, say so. Do not modify parse.js.' review

# The human decision, identical to condition B.
cp "$HERE/OPEN_QUESTIONS.md" "$RUN/OPEN_QUESTIONS.md" 2>/dev/null || true
node "$RUNLOG" "$LOG_W" append '{"step":"human_resolution","actor":"human","decision":"OQ-1 resolved as option C: reject a sign applied to a zero-valued duration","artifact":"OPEN_QUESTIONS.md"}'

step agent1 implementer 'A review raised questions the spec did not answer, and a human has resolved them.

Read OPEN_QUESTIONS.md and SPEC.md, then update parse.js to match every RESOLUTION.
Do not change behaviour the resolutions do not mention.

Report in two lines: which resolutions required a change, and what you changed.' resolve

cp "$HERE/heldout.test.mjs" "$RUN/"
SCORE=$(docker run --rm -v "$RUN_HOST:/w" -w /w node:24-slim node heldout.test.mjs ./parse.js 2>&1 | grep -oE '[0-9]+ assertions, [0-9]+ passed, [0-9]+ failed' | tail -1)
node "$RUNLOG" "$LOG_W" append "{\"step\":\"graded\",\"actor\":\"harness\",\"result\":\"$SCORE\",\"grader\":\"heldout.test.mjs\"}"
node "$RUNLOG" "$LOG_W" append "{\"step\":\"end\",\"invocations\":$INVOCATIONS,\"total_seconds\":$TOTAL}"

echo
echo "  graded: $SCORE"
echo "  invocations: $INVOCATIONS   agent time: ${TOTAL}s"
echo "  records: $LOG  ($(wc -l < "$LOG") entries)"
echo "  run: $RUN"

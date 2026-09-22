#!/usr/bin/env bash
# The team on the same task: manager specs and assigns, an implementer builds,
# the tester validates, the implementer fixes anything found.
#
# One shared workspace rather than separate git clones. That favours the team -
# it removes fetch/push overhead and lets each member see the others' files
# immediately - so any cost measured here is a floor, not a ceiling.
set -uo pipefail
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

HERE="$(cd "$(dirname "$0")" && pwd)"
HOST="$(cygpath -m "$HERE" 2>/dev/null || echo "$HERE")"
CFG="$(cygpath -m "$HERE/.." 2>/dev/null || echo "$HERE/..")/agents.json"
HUB="http://localhost:7400"

STAMP=$(date +%Y%m%d-%H%M%S)
RUN="$HERE/runs/team-$STAMP"
RUN_HOST="$HOST/runs/team-$STAMP"
mkdir -p "$RUN"
cp "$HERE/${SPEC_FILE:-SPEC.md}" "$RUN/SPEC.md"

TOTAL_SECS=0
INVOCATIONS=0
COSTS="$RUN/costs.tsv"
printf 'member\truntime\tmodel\tseconds\ttokens\n' > "$COSTS"

step() {          # step <member> <prompt-file-content-var>
  local member="$1" prompt="$2"
  read -r runtime model image < <(node -e "
    const c = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
    const m = c.roster[process.argv[2]];
    console.log([m.runtime, m.model, c.runtimes[m.runtime].image].join(' '));
  " "$CFG" "$member")

  printf '%s' "$prompt" > "$RUN/prompt.txt"
  local carrier='Read the file /work/prompt.txt and do exactly what it says.'
  local cmd=()
  case "$runtime" in
    claude) cmd=(claude --print --permission-mode bypassPermissions --model "$model" "$carrier") ;;
    codex)  cmd=(codex exec --dangerously-bypass-approvals-and-sandbox -c "model=$model" "$carrier") ;;
  esac

  echo "  --- $member ($model) ---"
  local start end secs tok
  start=$(date +%s)
  local envs=()
  if [ "$runtime" = "codex" ]; then
    local t
    t=$(curl -s -X POST "$HUB/api/token" -H 'Content-Type: application/json' -d "{\"name\":\"$member\"}" \
        | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))" 2>/dev/null)
    [ -n "$t" ] && envs=(-e "HUB_TOKEN=$t")
  fi
  docker run --rm --network stride-agents \
    -v "agent-${member}-home:/home/agent" \
    "${envs[@]}" \
    -v "$RUN_HOST:/work" -w /work \
    "$image" "${cmd[@]}" >> "$RUN/transcript-$member.txt" 2>&1
  end=$(date +%s); secs=$((end-start))
  tok=$(grep -oE 'tokens used[[:space:]]*[0-9,]+' "$RUN/transcript-$member.txt" | grep -oE '[0-9,]+' | tr -d ',' | tail -1)
  printf '%s\t%s\t%s\t%s\t%s\n' "$member" "$runtime" "$model" "$secs" "${tok:-}" >> "$COSTS"
  TOTAL_SECS=$((TOTAL_SECS+secs)); INVOCATIONS=$((INVOCATIONS+1))
  echo "      ${secs}s"
}

echo "=== team on the same task ==="

step manager 'You are the manager. Read SPEC.md in the current directory.

Do NOT implement it yourself. Write a short file PLAN.md stating: what the one
work item is, who on the team should do it, and the two or three rules in the
spec you judge most likely to be got wrong. Then use work_create to record the
item, assigned to agent1.

Report in three lines what you planned.'

step agent1 'You are an implementer. Read SPEC.md and PLAN.md in the current directory.

Create parse.js exporting parseDuration as a named ESM export, exactly to the
spec. Do not write tests - a separate tester is responsible for those. Commit
nothing; just leave parse.js in this directory.

Report in two lines what you implemented and anything in the spec you found
ambiguous.'

step tester 'You are the tester. Read SPEC.md in the current directory.

Write test cases in tester.test.mjs derived from SPEC.md - from the SPEC, not
from reading parse.js first. Cover every rule including every invalid form.
Then run them against parse.js and report the real pass/fail counts and any rule
that parse.js violates.

Report: how many assertions, how many passed, and each violation found.'

if grep -qiE 'fail|violat' "$RUN/transcript-tester.txt" 2>/dev/null; then
  step agent1 'You are the implementer. The tester found problems with parse.js.

Read tester.test.mjs and its findings, fix parse.js so every case passes, and do
not weaken the tests. Report what you changed.'
fi

cp "$HERE/heldout.test.mjs" "$RUN/"
echo
echo "  --- held-out grading (identical to the solo runs) ---"
if [ -f "$RUN/parse.js" ]; then
  docker run --rm -v "$RUN_HOST:/w" -w /w node:24-slim node heldout.test.mjs ./parse.js 2>&1 | tail -14 | sed 's/^/  /'
else
  echo "  no parse.js produced"
fi

cat > "$RUN/run.json" <<JSON
{"condition":"team","invocations":$INVOCATIONS,"seconds":$TOTAL_SECS}
JSON
echo
echo "  invocations: $INVOCATIONS   total agent time: ${TOTAL_SECS}s"
echo "  run: $RUN"

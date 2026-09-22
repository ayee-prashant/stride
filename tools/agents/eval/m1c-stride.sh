#!/usr/bin/env bash
# M1C condition B — the platform.
#
#   ./m1c-stride.sh [run-id]
#
# The same implement -> review -> resolve workflow as the baseline, same models,
# same prompts, same human decision, same held-out grading. What differs is that
# coordination goes through the hub: a work item with a fenced lease, MCP reads
# that advance the observation cursor, a proposal for the open question, a human
# resolution through the API, and a release carrying the commit.
#
# Nothing here is allowed to help the agent do the task better. If it produces a
# better score than the baseline, that is a confound to investigate, not a win.
set -uo pipefail
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

HERE="$(cd "$(dirname "$0")" && pwd)"
HOST="$(cygpath -m "$HERE" 2>/dev/null || echo "$HERE")"
CFG="$(cygpath -m "$HERE/.." 2>/dev/null || echo "$HERE/..")/agents.json"
HUB="http://localhost:7400"
RUNID="${1:-$(date +%Y%m%d-%H%M%S)}"
RUN="$HERE/runs/m1c-stride-$RUNID"
RUN_HOST="$HOST/runs/m1c-stride-$RUNID"
mkdir -p "$RUN"
cp "$HERE/SPEC-AMBIGUOUS.md" "$RUN/SPEC.md"

jq_() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);console.log(eval('o'+process.argv[1]))}catch(e){console.log('')}})" "$1"; }

TOTAL=0; INVOCATIONS=0

# The human creates the work item. Everything after is recorded by the hub.
WORK=$(curl -s -X POST "$HUB/api/work" -H 'Content-Type: application/json' \
  -d '{"title":"Implement parseDuration per SPEC.md","body":"M1C condition B"}' | jq_ '.id')
echo "  work item: $WORK"

step() {   # step <member> <role> <prompt> <name>
  local member="$1" role="$2" prompt="$3" name="$4"
  read -r runtime model image < <(node -e "
    const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
    const m=c.roster[process.argv[2]];
    console.log([m.runtime,m.model,c.runtimes[m.runtime].image].join(' '));
  " "$CFG" "$member")

  printf '%s' "$prompt" > "$RUN/prompt.txt"
  local cmd=()
  case "$runtime" in
    claude) cmd=(claude --print --permission-mode bypassPermissions --model "$model" 'Read the file /work/prompt.txt and do exactly what it says.') ;;
    codex)  cmd=(codex exec --dangerously-bypass-approvals-and-sandbox -c "model=$model" 'Read the file /work/prompt.txt and do exactly what it says.') ;;
  esac

  local envs=()
  if [ "$runtime" = "codex" ]; then
    local t; t=$(curl -s -X POST "$HUB/api/token" -H 'Content-Type: application/json' -d "{\"name\":\"$member\"}" | jq_ '.token')
    [ -n "$t" ] && envs=(-e "HUB_TOKEN=$t")
  fi

  echo "  --- $name: $member ($model) ---"
  local start; start=$(date +%s)
  docker run --rm --network stride-agents \
    -v "agent-${member}-home:/home/agent" "${envs[@]}" \
    -v "$RUN_HOST:/work" -w /work \
    "$image" "${cmd[@]}" > "$RUN/out-$name.txt" 2>&1
  local secs=$(( $(date +%s) - start ))
  TOTAL=$((TOTAL+secs)); INVOCATIONS=$((INVOCATIONS+1))
  echo "      ${secs}s"
}

step agent1 implementer "You are an implementer on a coordinated team. The hub MCP server holds the work.

1. Call agent_identity, then work_list. Claim the work item $WORK with work_claim.
   Keep the lease_generation it returns - you will need it.
2. Read SPEC.md in the current directory and implement it. Create parse.js
   exporting parseDuration as a named ESM export. Do not write tests.
3. Call work_release with outcome open, your lease_generation, and a one-line
   summary, so the item returns to the pool for review.

Report in two lines: what you implemented, and anything in the spec you found ambiguous." implement

step agent1 reviewer "You are reviewing someone else's implementation. You did not write it.

1. Call agent_identity and feed_read since 0 to see what has happened.
2. Read SPEC.md and parse.js. Write findings to REVIEW.md as two lists:
   VIOLATIONS, and UNRESOLVED DECISIONS (where the spec does not determine
   behaviour and the implementation had to pick a reading).
3. For each unresolved decision, call context_propose with kind constraint,
   stating the readings available and which one parse.js took. It will be
   recorded as pending for a human - that is the point.
4. Call note_append summarising what you found, so it is in the shared log.

Do not modify parse.js. Report how many unresolved decisions you raised." review

# The human decision, identical text to the baseline, but routed through the hub.
PENDING=$(curl -s "$HUB/api/recovery" >/dev/null; curl -s "$HUB/api/state" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const s=JSON.parse(d); const p=(s.pending||[])[0];
  console.log(p ? p.document_id + ' ' + p.version : '');
});")
if [ -n "$PENDING" ]; then
  set -- $PENDING
  curl -s -X POST "$HUB/api/context/decide" -H 'Content-Type: application/json' \
    -d "{\"document_id\":\"$1\",\"version\":$2,\"approve\":true,\"approver\":\"human:prashant\"}" >/dev/null
  echo "  human approved $1 v$2"
else
  echo "  no proposal was raised - the human decision has nothing to approve"
fi
cp "$HERE/OPEN_QUESTIONS.md" "$RUN/OPEN_QUESTIONS.md" 2>/dev/null || true

step agent1 implementer "A review raised questions the spec did not answer and a human has resolved them.

1. Call context_head to read the APPROVED context, and feed_read to see the decision.
2. Read OPEN_QUESTIONS.md, then update parse.js to match every RESOLUTION.
   Do not change behaviour the resolutions do not mention.
3. Claim the work item $WORK again with work_claim, then call work_release with
   outcome done, your lease_generation, and the commit field set to the git
   commit you produce.
4. Commit your change and push it to your branch through origin.

Report in two lines: which resolutions required a change, and what you changed." resolve

cp "$HERE/heldout.test.mjs" "$RUN/"
SCORE=$(docker run --rm -v "$RUN_HOST:/w" -w /w node:24-slim node heldout.test.mjs ./parse.js 2>&1 | grep -oE '[0-9]+ assertions, [0-9]+ passed, [0-9]+ failed' | tail -1)

# The hub's own record of the run, which is condition B's answer to the
# traceability questions.
curl -s "$HUB/api/state" > "$RUN/hub-state.json"
curl -s "$HUB/api/recovery" > "$RUN/hub-recovery.json"

echo
echo "  graded: $SCORE"
echo "  invocations: $INVOCATIONS   agent time: ${TOTAL}s"
echo "  hub records: $RUN/hub-state.json"
echo "  run: $RUN"

#!/usr/bin/env bash
# One agent, working alone: implement and self-test from SPEC.md.
#
#   ./run-solo.sh <member>
#
# The control condition. Same spec, same held-out grading as the team, so the
# only thing that differs is whether there is any coordination structure at all.
set -uo pipefail
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

MEMBER="${1:-}"
[ -n "$MEMBER" ] || { echo "usage: $0 <member>" >&2; exit 2; }

HERE="$(cd "$(dirname "$0")" && pwd)"
HOST="$(cygpath -m "$HERE" 2>/dev/null || echo "$HERE")"
# node runs as a Windows process, so it cannot resolve the MSYS path this script
# sees. Convert it, and read the file rather than require() it.
CFG="$(cygpath -m "$HERE/.." 2>/dev/null || echo "$HERE/..")/agents.json"
read -r runtime model image < <(node -e "
  const c = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
  const m = c.roster[process.argv[2]];
  if (!m) { console.error('no such member: ' + process.argv[2]); process.exit(1); }
  console.log([m.runtime, m.model, c.runtimes[m.runtime].image].join(' '));
" "$CFG" "$MEMBER") || exit 1
[ -n "$runtime" ] || { echo "could not read the roster" >&2; exit 1; }

STAMP=$(date +%Y%m%d-%H%M%S)
RUN="$HERE/runs/solo-$MEMBER-$STAMP"
RUN_HOST="$HOST/runs/solo-$MEMBER-$STAMP"
mkdir -p "$RUN"
cp "$HERE/${SPEC_FILE:-SPEC.md}" "$RUN/SPEC.md"

cat > "$RUN/prompt.txt" <<'EOF'
Read SPEC.md in the current directory and implement exactly what it describes.

Create parse.js in the current directory exporting parseDuration as a named ESM
export. Then test your own work thoroughly against the spec: write test cases,
run them, and keep fixing parse.js until you are confident every rule in SPEC.md
holds, including every invalid form it lists.

You are working alone. Nobody else will review or test this before it is graded.

When you are done, report in three short lines: what you implemented, how many
test cases you ran, and anything in the spec you found ambiguous.
EOF

case "$runtime" in
  claude) CMD=(claude --print --permission-mode bypassPermissions --model "$model"
                "Read the file /work/prompt.txt and do exactly what it says.") ;;
  codex)  CMD=(codex exec --dangerously-bypass-approvals-and-sandbox -c "model=$model"
                "Read the file /work/prompt.txt and do exactly what it says.") ;;
esac

echo "=== solo: $MEMBER ($runtime, $model) ==="
START=$(date +%s)
docker run --rm \
  -v "agent-${MEMBER}-home:/home/agent" \
  -v "$RUN_HOST:/work" -w /work \
  "$image" "${CMD[@]}" > "$RUN/agent-output.txt" 2>&1
STATUS=$?
END=$(date +%s)
SECS=$((END-START))

TOKENS=$(grep -oE 'tokens used[[:space:]]*[0-9,]+' "$RUN/agent-output.txt" | grep -oE '[0-9,]+' | tr -d ',' | tail -1)
[ -n "${TOKENS:-}" ] || TOKENS=null

cat > "$RUN/run.json" <<JSON
{"condition":"solo","member":"$MEMBER","runtime":"$runtime","model":"$model",
 "seconds":$SECS,"tokens":$TOKENS,"invocations":1,"exit_code":$STATUS}
JSON

echo "  finished in ${SECS}s (tokens: $TOKENS)"
if [ -f "$RUN/parse.js" ]; then
  cp "$HERE/heldout.test.mjs" "$RUN/"
  echo "  --- held-out grading ---"
  docker run --rm -v "$RUN_HOST:/w" -w /w node:24-slim node heldout.test.mjs ./parse.js 2>&1 | tail -14 | sed 's/^/  /'
else
  echo "  no parse.js produced"
fi
echo "  run: $RUN"

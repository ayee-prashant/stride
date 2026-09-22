#!/usr/bin/env bash
# Run the workspace task headlessly in one agent container, then grade the result.
#     ./run-task.sh claude|codex|gemini
# Each agent gets its own copy of the workspace so they cannot see each other's work.
set -uo pipefail
# Git Bash on Windows rewrites container-side paths like /work into C:/Program Files/Git/work.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

AGENT="${1:-}"
case "$AGENT" in
  claude|codex|gemini) ;;
  *) echo "usage: $0 claude|codex|gemini" >&2; exit 2 ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
# Docker Desktop needs a Windows path (C:/...). Under Git Bash, $PWD is the MSYS
# view (/tmp/... or /c/...), and docker silently mounts an EMPTY directory from
# inside its Linux VM instead of failing - every agent then correctly reports
# that /work is empty. cygpath -m gives C:/... with forward slashes.
if command -v cygpath >/dev/null 2>&1; then
  HOSTDIR="$(cygpath -m "$HERE")"
else
  HOSTDIR="$HERE"
fi
# Codex is built from the official installer image.
IMG_SUFFIX=""; [ "$AGENT" = "codex" ] && IMG_SUFFIX="-official"
RUN="$HERE/runs/$AGENT"
RUN_HOST="$HOSTDIR/runs/$AGENT"
rm -rf "$RUN"; mkdir -p "$RUN"
cp "$HERE/workspace/TASK.md" "$HERE/workspace/verify.js" "$RUN/"

PROMPT='Read TASK.md in the current directory and implement exactly what it asks. Create roman.js. Then run `node verify.js` and keep fixing roman.js until it prints RESULT: PASS. Do not edit TASK.md or verify.js.'

# Headless invocation differs per CLI.
case "$AGENT" in
  claude) CMD=(claude --print --permission-mode bypassPermissions "$PROMPT") ;;
  codex)  CMD=(codex exec --dangerously-bypass-approvals-and-sandbox "$PROMPT") ;;
  gemini) CMD=(gemini --yolo --prompt "$PROMPT") ;;
esac

# Guard: prove the mount actually carries the files before spending a run on it.
if ! docker run --rm -v "$RUN_HOST:/work" -w /work node:24-slim test -f /work/verify.js; then
  echo "ERROR: $RUN_HOST did not mount into the container (no /work/verify.js)." >&2
  echo "       Docker Desktop must be able to share that path." >&2
  exit 1
fi

echo "=== $AGENT: starting ==="
START=$(date +%s)
# Gemini's encrypted credential store cannot be read in a container other than
# the one that wrote it. Docker sets the hostname from the random container ID,
# so pin it to a constant. Must match the value login.cmd uses.
HOSTNAME_ARG=()
[ "$AGENT" = "gemini" ] && HOSTNAME_ARG=(--hostname stride-agent-gemini)

docker run --rm \
  "${HOSTNAME_ARG[@]}" \
  -v "agent-${AGENT}-home:/home/agent" \
  -v "$RUN_HOST:/work" \
  -w /work \
  "stride-agent-${AGENT}${IMG_SUFFIX:-}" "${CMD[@]}" > "$RUN/agent-output.txt" 2>&1
STATUS=$?
END=$(date +%s)

echo "exit=$STATUS  elapsed=$((END-START))s"
echo "--- last lines of agent output ---"
tail -12 "$RUN/agent-output.txt"

echo
echo "=== grading (same verify.js for every agent) ==="
if [ -f "$RUN/roman.js" ]; then
  docker run --rm -v "$RUN_HOST:/work" -w /work node:24-slim node verify.js
  echo "grader exit=$?"
else
  echo "no roman.js was produced"
fi

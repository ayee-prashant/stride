#!/usr/bin/env bash
# Interactive login for one agent container. Run this yourself in a normal terminal:
#     ./login.sh claude    |    ./login.sh codex    |    ./login.sh gemini
# Credentials land in the named volume agent-<name>-home and survive container restarts.
set -euo pipefail

AGENT="${1:-}"
case "$AGENT" in
  claude|codex|gemini) ;;
  *) echo "usage: $0 claude|codex|gemini" >&2; exit 2 ;;
esac

# Ports: Codex and Gemini use a loopback OAuth callback. Publishing the port lets the
# browser on your host reach the listener inside the container. Codex also offers
# --device-auth, which needs no port at all.
PORTS=()
case "$AGENT" in
  codex)  PORTS=(-p 1455:1455) ;;
  gemini) PORTS=(-p 8085:8085 -p 7777:7777) ;;
esac

echo "Starting an interactive shell in stride-agent-$AGENT."
echo "Run the login command below, then type 'exit'."
echo
case "$AGENT" in
  claude) echo "   claude auth login" ;;
  codex)  echo "   codex login --device-auth      # no port needed, shows a code" ;;
  gemini) echo "   gemini            # then pick the auth option it offers" ;;
esac
echo

exec docker run --rm -it \
  -v "agent-${AGENT}-home:/home/agent" \
  -v "$(pwd)/workspace:/work" \
  "${PORTS[@]}" \
  "stride-agent-${AGENT}" bash

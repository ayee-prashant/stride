#!/usr/bin/env bash
# Runs inside the claude-login helper container.
#
# `claude auth login` is a TUI: it needs a pty or it will not render, and it
# waits at a "Paste code here" prompt. So run it under `script` (which gives it
# a pty) with stdin coming from a fifo we can write to from outside the
# container. That way the code is delivered by `docker exec`, not by typing
# into a terminal.
set -u

mkfifo /tmp/in

# Hold the write end open forever. Without this, the fifo would report EOF as
# soon as the first writer closed, and the CLI would abort before we sent a code.
sleep 3600 > /tmp/in &

script -qfc "claude auth login --claudeai" /dev/null < /tmp/in > /tmp/out 2>&1
echo "EXITCODE=$?" >> /tmp/out

# Stay alive so -Code and -Status can still read /tmp/out afterwards.
sleep 3600
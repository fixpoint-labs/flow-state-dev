#!/usr/bin/env bash
# run.sh <workdir> <log> [extra claude args...] < prompt
# Runs one isolated `claude -p` sub-agent in <workdir> with the prompt on stdin.
set -u
WD="$1"; LOG="$2"; shift 2
mkdir -p "$WD"
cd "$WD" || exit 2
claude -p --permission-mode acceptEdits \
  --allowedTools "Read Grep Glob Write Edit Agent Bash(node:*) Bash(grep:*) Bash(rg:*) Bash(ls:*) Bash(wc:*) Bash(cat:*) Bash(sed:*) Bash(head:*) Bash(cp:*) Bash(mkdir:*) Bash(printf:*) Bash(claude:*) Bash(/opt/pw-browsers/*)" \
  "$@" > "$LOG" 2> "$LOG.err"
echo "exit $?" >> "$LOG"

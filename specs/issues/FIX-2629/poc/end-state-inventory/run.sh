#!/usr/bin/env bash
# FIX-2629 spec evidence: the end-state inventory, its must-fail control and its green control.
# Run from anywhere: bash specs/issues/FIX-2629/poc/end-state-inventory/run.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
GREEN="$(mktemp -d)"
( cd "$HERE/green" && find . -name '*.fixture' | while read -r f; do mkdir -p "$GREEN/$(dirname "$f")"; cp "$f" "$GREEN/${f%.fixture}"; done )

echo "== 1. today's main: every rule must be red"
POC_EXPECT=red node "$HERE/check.mjs"; a=$?
echo; echo "== 2. green control: the epic's proposed lab passes the lab rules"
POC_LAB="$GREEN" POC_ONLY=lab node "$HERE/check.mjs"; b=$?
echo; echo "== 3. negative control: src/glue.ts planted in the green lab must fail"
POC_EXPECT=plant POC_PLANT=1 POC_LAB="$GREEN" POC_ONLY=lab node "$HERE/check.mjs"; c=$?
rm -rf "$GREEN"
echo
[ $a -eq 0 ] && [ $b -eq 0 ] && [ $c -eq 0 ] && echo "RESULT: as stated (red today, green on the proposed end state, red with a plant)" && exit 0
echo "RESULT: NOT as stated (1=$a 2=$b 3=$c)"; exit 1

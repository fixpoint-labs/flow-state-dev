#!/usr/bin/env bash
# Copies the POC into packages/testing/test for one run, then removes it.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
dest="$root/packages/testing/test/zz-answer.poc.test.ts"
cp "$root/specs/issues/FIX-2460/poc/answer-in-process/answer.poc.test.ts" "$dest"
trap 'rm -f "$dest"' EXIT
cd "$root/packages/testing" && npx vitest run --root . test/zz-answer.poc.test.ts

#!/usr/bin/env bash
# Run the FIX-1817 task-session POC from the repository root:
#   bash specs/issues/FIX-1817/poc/task-session-reentry/run.sh
#
# Not a package: the test is copied into packages/workforce/test for the run
# (where `../src/*` and the `@flow-state-dev/*` source aliases resolve) and
# removed afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
dest="$root/packages/workforce/test/zz-fix1817-reentry.poc.test.ts"

cp "$here/reentry.poc.test.ts" "$dest"
trap 'rm -f "$dest"' EXIT

cd "$root/packages/workforce"
../../node_modules/.bin/vitest run --root . test/zz-fix1817-reentry.poc.test.ts "$@"

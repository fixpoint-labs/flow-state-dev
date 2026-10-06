#!/usr/bin/env bash
# Run the FIX-1786 end-state POC from the repository root:
#   bash specs/epics/FIX-1786/poc/singleton-worker-link/run.sh
#
# Not a package: the test is copied into packages/orchestration/test for the
# run (where `../src/*` and the `@flow-state-dev/*` source aliases resolve)
# and removed afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
dest="$root/packages/orchestration/test/zz-fix1786-link.poc.test.ts"

cp "$here/link.poc.test.ts" "$dest"
trap 'rm -f "$dest"' EXIT

cd "$root/packages/orchestration"
../../node_modules/.bin/vitest run --root . test/zz-fix1786-link.poc.test.ts "$@"

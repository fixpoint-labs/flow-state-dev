#!/usr/bin/env bash
# Run the FIX-1793 scope POC from the repository root:
#   bash specs/issues/FIX-1793/poc/scope-config/run.sh
#
# Not a package: the test is copied into packages/orchestration/test for the
# run (where the `@flow-state-dev/*` source aliases resolve) and removed afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
dest="$root/packages/orchestration/test/zz-fix1793-scope.poc.test.ts"

cp "$here/scope-config.poc.test.ts" "$dest"
trap 'rm -f "$dest"' EXIT

cd "$root/packages/orchestration"
../../node_modules/.bin/vitest run --root . test/zz-fix1793-scope.poc.test.ts "$@"

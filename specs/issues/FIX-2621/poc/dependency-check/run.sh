#!/usr/bin/env bash
# Run the FIX-2621 POC from the repository root:
#   bash specs/issues/FIX-2621/poc/dependency-check/run.sh
#   FIX2621_RUNS=500 bash specs/issues/FIX-2621/poc/dependency-check/run.sh   # a longer cost run
#
# Not a package: the case is copied into packages/workforce/test for the run
# (where `./conversation-board-harness` and `@flow-state-dev/*` resolve, and
# which the package's vitest run already includes), and removed afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
dest="$root/packages/workforce/test/zz-fix2621-dependency-check.poc.test.ts"
cp "$here/dependency-check.poc.test.ts" "$dest"
trap 'rm -f "$dest"' EXIT
cd "$root/packages/workforce"
env -u FSDEV_DEFAULT_MODEL ../../node_modules/.bin/vitest run "test/$(basename "$dest")" "$@"

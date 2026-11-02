#!/usr/bin/env bash
# Run the FIX-2426 POC from the repository root:
#   bash specs/issues/FIX-2426/poc/stream-read-cost/run.sh
#   FIX2426_CONTROL=no-viewers bash specs/issues/FIX-2426/poc/stream-read-cost/run.sh   # must report 0
#   FIX2426_VIEWERS=1,10,50,100 FIX2426_WINDOW_MS=10000 bash ...                        # other grids
#
# Not a package: the case is copied into packages/store-postgres/test for the
# run (where `../src`, `./shared-pglite` and `@flow-state-dev/*` resolve, and
# which the package's vitest config already includes), and removed afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
dest="$root/packages/store-postgres/test/zz-fix2426-stream-read-cost.poc.test.ts"
cp "$here/stream-read-cost.poc.test.ts" "$dest"
trap 'rm -f "$dest"' EXIT
cd "$root/packages/store-postgres"
../../node_modules/.bin/vitest run "test/$(basename "$dest")" "$@"

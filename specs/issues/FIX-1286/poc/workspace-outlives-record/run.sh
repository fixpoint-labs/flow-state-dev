#!/usr/bin/env bash
# Run the FIX-1286 POC from the repository root, on FIX-1018's head (#2377)
# or on main once it merges:
#   bash specs/issues/FIX-1286/poc/workspace-outlives-record/run.sh
#
# Not a package: the case is copied into the two-users-one-tenant suite's
# directory for the run (where its harness and `@flow-state-dev/*` resolve,
# and which the integration-tests vitest config already includes), and
# removed afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
suite="$root/packages/integration-tests/src/two-users-one-tenant"
dest="$suite/zz-fix1286-workspace-outlives-record.poc.test.ts"

[ -f "$suite/harness.ts" ] || { echo "No two-users harness: run on FIX-1018's head or a main that has it." >&2; exit 1; }
cp "$here/workspace-outlives-record.poc.test.ts" "$dest"
trap 'rm -f "$dest"' EXIT

cd "$root/packages/integration-tests"
../../node_modules/.bin/vitest run --root . "src/two-users-one-tenant/$(basename "$dest")" "$@"

#!/usr/bin/env bash
# Run the FIX-1654 POC from the repository root, on main:
#   bash specs/issues/FIX-1654/poc/abort-fence-createdat/run.sh
#
# Not a package: the case is copied into packages/engine/test/ for the run
# (where the engine's sources and vitest config resolve), and removed after.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
dest="$root/packages/engine/test/zz-fix1654-abort-fence-createdat.poc.test.ts"

cp "$here/abort-fence-createdat.poc.test.ts" "$dest"
trap 'rm -f "$dest"' EXIT

cd "$root/packages/engine"
../../node_modules/.bin/vitest run --root . "test/$(basename "$dest")" "$@"

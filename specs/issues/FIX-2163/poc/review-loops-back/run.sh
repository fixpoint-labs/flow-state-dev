#!/usr/bin/env bash
# Run the FIX-2163 POC from the repository root:
#   bash specs/issues/FIX-2163/poc/review-loops-back/run.sh
#
# Not a package: the case is copied into packages/engine/test for the run
# (where `../src` and `@flow-state-dev/*` resolve, and which the engine's
# vitest config already includes), and removed afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
dest="$root/packages/engine/test/zz-fix2163-review-loops-back.poc.test.ts"
cp "$here/review-loops-back.poc.test.ts" "$dest"
trap 'rm -f "$dest"' EXIT
cd "$root/packages/engine"
../../node_modules/.bin/vitest run "test/$(basename "$dest")" "$@"

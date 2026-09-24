#!/usr/bin/env bash
# Run the FIX-1549 unarmed-registry POC from the repository root:
#   bash specs/issues/FIX-1549/poc/unarmed-leak/run.sh
#
# Not a package: the test is copied into packages/engine/test for the run
# (where `../src` and `@flow-state-dev/*` resolve) and removed afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
dest="$root/packages/engine/test/zz-fix1549-unarmed-leak.poc.test.ts"

cp "$here/unarmed-leak.poc.test.ts" "$dest"
trap 'rm -f "$dest"' EXIT

cd "$root/packages/engine"
../../node_modules/.bin/vitest run --root . test/zz-fix1549-unarmed-leak.poc.test.ts "$@"

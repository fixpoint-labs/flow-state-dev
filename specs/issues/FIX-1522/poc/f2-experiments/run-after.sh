#!/usr/bin/env bash
# Run the FIX-1522 F2 "after" suite against a checkout of the FIX-1529 branch:
#   bash specs/issues/FIX-1522/poc/f2-experiments/run-after.sh /path/to/fix-1529-checkout
#
# The suite imports APIs that exist only on that branch (owner pins, the
# private roster collection), so it is copied into the given checkout's
# packages/workforce/test for the run and removed afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
target="$(cd "${1:?usage: run-after.sh <fix-1529 checkout>}" && pwd)"
dest="$target/packages/workforce/test/zz-fix1522-f2-after.poc.test.ts"

cp "$here/after.poc.test.ts" "$dest"
trap 'rm -f "$dest"' EXIT

cd "$target/packages/workforce"
../../node_modules/.bin/vitest run --root . test/zz-fix1522-f2-after.poc.test.ts "${@:2}"

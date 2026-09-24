#!/usr/bin/env bash
# Run the FIX-1522 owner-planes POC from the repository root:
#   bash specs/issues/FIX-1522/poc/owner-planes/run.sh
#
# The POC is not a package, so its two files are copied into
# packages/workforce/test for the run (where `../src/*` and the
# `@flow-state-dev/*` imports resolve) and removed again afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
dest="$root/packages/workforce/test"

cp "$here/plane.ts" "$dest/plane.ts"
cp "$here/planes.poc.test.ts" "$dest/zz-fix1522-planes.poc.test.ts"
trap 'rm -f "$dest/plane.ts" "$dest/zz-fix1522-planes.poc.test.ts"' EXIT

cd "$root/packages/workforce"
../../node_modules/.bin/vitest run --root . test/zz-fix1522-planes.poc.test.ts "$@"

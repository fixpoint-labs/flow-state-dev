#!/usr/bin/env bash
# Run the FIX-1728 resource-talk POC from the repository root:
#   bash specs/spikes/FIX-1728/poc/resource-talk/run.sh
#
# The POC is not a package, so the test is copied into packages/workforce/test
# for the run (where `../src/*` and the `@flow-state-dev/*` imports resolve)
# and removed again afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
dest="$root/packages/workforce/test/zz-fix1728-resource-talk.poc.test.ts"

cp "$here/resource-talk.poc.test.ts" "$dest"
trap 'rm -f "$dest"' EXIT

cd "$root/packages/workforce"
../../node_modules/.bin/vitest run --root . test/zz-fix1728-resource-talk.poc.test.ts "$@"

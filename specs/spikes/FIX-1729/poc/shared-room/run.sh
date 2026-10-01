#!/usr/bin/env bash
# Run the FIX-1729 shared-room POC from the repository root:
#   bash specs/spikes/FIX-1729/poc/shared-room/run.sh
# Control (the membership gate removed; N1 must go red):
#   POC_NO_GATE=1 bash specs/spikes/FIX-1729/poc/shared-room/run.sh
#
# The POC is not a package, so the test is copied into packages/workforce/test
# for the run (where the `@flow-state-dev/*` imports resolve) and removed again
# afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
dest="$root/packages/workforce/test/zz-fix1729-shared-room.poc.test.ts"

cp "$here/shared-room.poc.test.ts" "$dest"
trap 'rm -f "$dest"' EXIT

cd "$root/packages/workforce"
../../node_modules/.bin/vitest run --root . test/zz-fix1729-shared-room.poc.test.ts "$@"

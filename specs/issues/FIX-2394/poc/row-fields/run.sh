#!/usr/bin/env bash
# Run the FIX-2394 POC from the repository root:
#   bash specs/issues/FIX-2394/poc/row-fields/run.sh             # must pass
#   POC_PLANT=1 bash specs/issues/FIX-2394/poc/row-fields/run.sh # negative control: must fail
#
# Not a package: the case is copied into packages/orchestration/test/skills for
# the run (where `../../src`, `./delegation-ctx` and `@flow-state-dev/*`
# resolve), and removed afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
dest="$root/packages/orchestration/test/skills/zz-fix2394-row-fields.poc.test.ts"
cp "$here/row-fields.poc.test.ts" "$dest"
trap 'rm -f "$dest"' EXIT
cd "$root/packages/orchestration"
env -u FSDEV_DEFAULT_MODEL ../../node_modules/.bin/vitest run "test/skills/$(basename "$dest")" "$@"

#!/usr/bin/env bash
# Run the FIX-2159 POC from the repository root:
#   bash specs/issues/FIX-2159/poc/take-in-turn/run.sh
#
# Not a package: the case is copied into packages/orchestration/test/tasks for
# the run (where `../../src` and `@flow-state-dev/*` resolve, and which the
# package's vitest config already includes), and removed afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
dest="$root/packages/orchestration/test/tasks/zz-fix2159-take-in-turn.poc.test.ts"
cp "$here/take-in-turn.poc.test.ts" "$dest"
trap 'rm -f "$dest"' EXIT
cd "$root/packages/orchestration"
env -u FSDEV_DEFAULT_MODEL ../../node_modules/.bin/vitest run "test/tasks/$(basename "$dest")" "$@"

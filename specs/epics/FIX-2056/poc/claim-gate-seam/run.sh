#!/usr/bin/env bash
# Run the FIX-2056 claim-gate end-state POC from the repository root:
#   bash specs/epics/FIX-2056/poc/claim-gate-seam/run.sh
#
# Not a package. The two test files are copied into packages/orchestration/test
# for the run (where `../src/*` and the `@flow-state-dev/*` aliases resolve) and
# removed afterwards. The census is a read of today's source.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
dest="$root/packages/orchestration/test"
cp "$here/today.poc.test.ts" "$dest/zz-fix2056-today.poc.test.ts"
cp "$here/end-state.poc.test.ts" "$dest/zz-fix2056-end-state.poc.test.ts"
trap 'rm -f "$dest"/zz-fix2056-*.poc.test.ts' EXIT

echo "== census: source files that write a task's ending today (orchestration + workforce, tests excluded)"
cd "$root/packages"
grep -rnE '\b(advisoryComplete|advisoryFail|settleSplitTask|cancelOrOwe)\(|[A-Za-z]+\??\.(complete|fail|cancel)\(' \
  orchestration/src workforce/src --include=*.ts \
  | grep -vE '/tests?/|\.test\.ts:|^\S+:[0-9]+:\s*(\*|//)' \
  | grep -vE 'function (advisoryComplete|advisoryFail|settleSplitTask|cancelOrOwe)' \
  | awk -F: '{print $1}' | sort | uniq -c

cd "$root/packages/orchestration"
../../node_modules/.bin/vitest run --root . test/zz-fix2056-today.poc.test.ts test/zz-fix2056-end-state.poc.test.ts "$@"

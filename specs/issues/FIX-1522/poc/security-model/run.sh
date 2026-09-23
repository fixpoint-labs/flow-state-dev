#!/usr/bin/env bash
# Run the FIX-1522 security-model POC from the repository root:
#   bash specs/issues/FIX-1522/poc/security-model/run.sh
#
# Not a package: the test is copied into packages/workforce/test for the run
# (where `../src/*` and `@flow-state-dev/*` resolve) and removed afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
dest="$root/packages/workforce/test/zz-fix1522-model.poc.test.ts"

cp "$here/model.poc.test.ts" "$dest"
trap 'rm -f "$dest"' EXIT

cd "$root/packages/workforce"
../../node_modules/.bin/vitest run --root . test/zz-fix1522-model.poc.test.ts "$@"

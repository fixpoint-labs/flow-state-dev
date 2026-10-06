#!/usr/bin/env bash
# Run the FIX-1789 two-shapes POC from the repository root:
#   bash specs/issues/FIX-1789/poc/two-shapes/run.sh
#
# Not a package: the directory is copied into packages/workforce/test for the
# run (where `../../src/*` and the `@flow-state-dev/*` source aliases resolve)
# and removed afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
dest="$root/packages/workforce/test/zz-fix1789"

rm -rf "$dest"
mkdir -p "$dest"
cp "$here"/*.ts "$dest"/
trap 'rm -rf "$dest"' EXIT

cd "$root/packages/workforce"
../../node_modules/.bin/vitest run --root . test/zz-fix1789/two-shapes.poc.test.ts "$@"

#!/usr/bin/env bash
# Run the FIX-2620 POC from the repository root:
#   bash specs/issues/FIX-2620/poc/no-session-read/run.sh
#   POC_STRICT_CONTROL=1 bash specs/issues/FIX-2620/poc/no-session-read/run.sh   # the control, red
#
# Not a package. For the run only: no-session.patch is applied to
# packages/engine/src (the change the verdict prices), the case is copied into
# packages/engine/test, and both are undone on exit.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
patch="$here/no-session.patch"
dest="$root/packages/engine/test/zz-fix2620-no-session-read.poc.test.ts"
cd "$root"
git apply --check "$patch"
git apply "$patch"
cp "$here/no-session-read.poc.test.ts" "$dest"
trap 'rm -f "$dest"; git -C "$root" apply -R "$patch"' EXIT
cd "$root/packages/engine"
env -u FSDEV_DEFAULT_MODEL ../../node_modules/.bin/vitest run "test/$(basename "$dest")" "$@"

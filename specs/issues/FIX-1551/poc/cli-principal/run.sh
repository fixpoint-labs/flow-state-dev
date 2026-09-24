#!/usr/bin/env bash
# FIX-1551 · POC runner. Copies the experiment into packages/cli/test/, runs it
# with the package's own vitest config (so core/engine resolve to source), and
# removes the copy. Pass planted controls as env vars, e.g.
#   POC_HOST_RESOLVER=none specs/issues/FIX-1551/poc/cli-principal/run.sh
# Needs: pnpm install, and `pnpm exec turbo run build --filter=@flow-state-dev/fsdev...`.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../../.." && pwd)"
DEST="$ROOT/packages/cli/test/_poc_fix_1551"
rm -rf "$DEST"
mkdir -p "$DEST"
cp "$HERE/cli-principal.test.ts" "$DEST/"
cp -r "$HERE/fixture" "$DEST/fixture"
trap 'rm -rf "$DEST"' EXIT
cd "$ROOT/packages/cli"
pnpm exec vitest run test/_poc_fix_1551/cli-principal.test.ts --reporter=verbose

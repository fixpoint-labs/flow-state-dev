#!/usr/bin/env bash
# Every premise DECISIONS -> Settled rests on, run in one go.
#
# From the repo root:
#   bash spec-poc/FIX-1355-runtime-premises/check-all.sh
#
# Prerequisites (a bare worktree has no install; TS6305 is the tell):
#   pnpm install
#   pnpm --filter @flow-state-dev/contracts --filter @flow-state-dev/core \
#        --filter @flow-state-dev/orchestration build
#   pnpm --filter @flow-state-dev/engine build      # engine BEFORE testing/workforce
#   pnpm --filter @flow-state-dev/testing build
#   pnpm --filter @flow-state-dev/workforce build

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

TSX=node_modules/.bin/tsx
DIR=spec-poc/FIX-1355-runtime-premises
failed=0

run() {
  echo
  echo "──────────────────────────────────────────────────────────────"
  echo "▶ $1"
  echo "──────────────────────────────────────────────────────────────"
  shift
  if ! "$@"; then failed=$((failed + 1)); fi
}

run "the built-in agent kind cannot be dispatched into (D3)" \
  $TSX "$DIR/check-agent-kind-has-no-internal-entry.mts"

run "openChannels cannot thread an orgId through, though the client API has one (S4, FIX-1412)" \
  bash "$DIR/check-no-org-door.sh"

run "a { key } delivery creates the seat session and inherits the org (S3)" \
  $TSX "$DIR/check-key-child-created-and-inherits-org.mts"

run "a delivery never crosses an org boundary" \
  bash -c "$TSX $DIR/check-org-boundary-refusal.mts"

run "seat skills reach a custom kind that declares the key (BR-3)" \
  $TSX "$DIR/check-seat-skills-reach-a-custom-kind.mts"

echo
echo "══════════════════════════════════════════════════════════════"
if [ "$failed" -eq 0 ]; then
  echo "ALL PREMISES CONFIRMED"
else
  echo "$failed PREMISE CHECK(S) FAILED — a spec defect, not a flake."
fi
exit "$failed"

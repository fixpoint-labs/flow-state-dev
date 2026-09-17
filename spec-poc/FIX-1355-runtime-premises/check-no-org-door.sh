#!/usr/bin/env bash
# Characterization check — FIX-1355, DECISIONS → Settled.
#
# Premise: `openChannels` has nowhere to put an `orgId`.
#
# The premise is an ABSENT field, so the evidence is a compile that must fail.
# A bare "tsc exited non-zero" would be BP-003's neighbour-of-the-claim — any
# unrelated type error would read as a pass — so this asserts the EXACT two
# TS2353 diagnostics, on `orgId`, and nothing else.
#
# Run from the repo root:
#   bash spec-poc/FIX-1355-runtime-premises/check-no-org-door.sh
#
# Goes red when the probe compiles clean (an org door was added — the client
# wrap in S4 is then cargo and ER-14 is fixed) or when it fails for some other
# reason (the probe has rotted and proves nothing).

set -uo pipefail

PROBE="spec-poc/FIX-1355-runtime-premises/no-org-door.probe.ts"

OUT="$(node_modules/.bin/tsc --noEmit --strict --skipLibCheck \
  --target es2022 --module esnext --moduleResolution bundler "$PROBE" 2>&1)"
STATUS=$?

echo "$OUT"
echo

if [ "$STATUS" -eq 0 ]; then
  echo "REFUTED — the probe compiled. openChannels now HAS an org door; D3/S4's client wrap is stale."
  exit 1
fi

TOTAL="$(printf '%s\n' "$OUT" | grep -c 'error TS')"
ON_ORGID="$(printf '%s\n' "$OUT" | grep -c "error TS2353.*'orgId' does not exist")"

if [ "$ON_ORGID" -ne 2 ] || [ "$TOTAL" -ne 2 ]; then
  echo "INCONCLUSIVE — expected exactly 2 errors, both TS2353 on 'orgId';"
  echo "               saw $TOTAL error(s), $ON_ORGID of them the expected one."
  echo "               The probe is measuring something other than the claim."
  exit 1
fi

echo "CONFIRMED — openChannels takes { client, userId } only; an orgId is refused at both doors,"
echo "            so binding an org means wrapping the session client (S4, ER-14)."
exit 0

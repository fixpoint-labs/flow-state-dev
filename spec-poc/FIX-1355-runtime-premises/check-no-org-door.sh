#!/usr/bin/env bash
# Characterization check — FIX-1355, DECISIONS -> Settled.
#
# Premise (as round 2 narrowed it): `openChannels` ITSELF has nowhere to put an
# `orgId`, so it cannot thread one through — even though the client API it
# calls does have an org door.
#
# Two halves, because either alone is misleading:
#   A. no-org-door.probe.ts    must FAIL  -> openChannels cannot pass an org.
#   B. org-door-exists.probe.ts must PASS -> the client CAN carry one.
#
# Together they say why the lab's wrap works, and keep FIX-1412 narrow: thread the
# org through openChannels, not "add an org door to the client".
#
# Half A asserts the EXACT two TS2353 diagnostics on `orgId`. A bare non-zero
# tsc would be BP-003's neighbour-of-the-claim: any unrelated type error would
# read as proof.
#
# Run from the repo root:
#   bash spec-poc/FIX-1355-runtime-premises/check-no-org-door.sh

set -uo pipefail

DIR=spec-poc/FIX-1355-runtime-premises
TSC="node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target es2022 --module esnext --moduleResolution bundler"

# ---- Half A: openChannels has no org door (must not compile) ----------------
OUT="$($TSC "$DIR/no-org-door.probe.ts" 2>&1)"
STATUS=$?
echo "$OUT"
echo

if [ "$STATUS" -eq 0 ]; then
  echo "REFUTED — the probe compiled. openChannels now HAS an org door; S4's client wrap is stale and FIX-1412 is fixed."
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

# ---- Half B: the client API DOES have one (must compile) --------------------
OUT_B="$($TSC "$DIR/org-door-exists.probe.ts" 2>&1)"
STATUS_B=$?

if [ "$STATUS_B" -ne 0 ]; then
  echo "$OUT_B"
  echo
  echo "REFUTED — CreateSessionOptions no longer accepts an orgId, so the lab's"
  echo "          client wrap has nothing to inject into. Settled and FIX-1412 both move."
  exit 1
fi

echo "CONFIRMED — openChannels takes { client, userId } only and declares a createSession"
echo "            carrying no orgId, so it cannot thread one through (half A)."
echo "            The client API DOES accept one — CreateSessionOptions.orgId (half B),"
echo "            which is what the lab's wrap injects. FIX-1412 is 'thread the org through"
echo "            openChannels', not 'give the client an org door'."
exit 0

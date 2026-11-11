#!/usr/bin/env bash
# Retained spec evidence for FIX-2624. Classifies every use of the four own-session helpers.
#   bash specs/issues/FIX-2624/poc/helper-inventory/run.sh              # PASS on main
#   POC_PLANT=1 bash specs/issues/FIX-2624/poc/helper-inventory/run.sh  # negative control: must FAIL
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
node specs/issues/FIX-2624/poc/helper-inventory/check.mjs

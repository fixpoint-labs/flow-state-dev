#!/usr/bin/env bash
# Run the FIX-2622 POC from the repository root, after `pnpm install`:
#   bash specs/issues/FIX-2622/poc/kit-or-api/run.sh            # everything (about 6 minutes)
#   FIX2622_SKIP_CONTRACT=1 bash specs/issues/FIX-2622/poc/kit-or-api/run.sh   # without the contract column
#   FIX2622_COST_ROUNDS=40 bash specs/issues/FIX-2622/poc/kit-or-api/run.sh    # a longer cost run
#   FIX2622_STEPS="1 5" bash specs/issues/FIX-2622/poc/kit-or-api/run.sh       # only some steps
#
# Not a package. Each host is copied into labs/teammates for the run (where its
# imports resolve), with the parity check, and everything is put back on exit:
#   host.zz-<name>.mts   today, b0-main-api, a-kit, b-api, and the control
#   poc-kit/, poc-api/   variant A's rough kit, variant B's install API
#   test/zz-fix2622-*.poc.test.ts
# For the lab's own host tests and the contract test, each variant is copied
# over labs/teammates/host.mts in turn, and today's is restored after.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
lab="$root/labs/teammates"
saved="$(mktemp)"
log="$(mktemp)"
cp "$lab/host.mts" "$saved"
cleanup() {
  cp "$saved" "$lab/host.mts"
  rm -f "$saved" "$log" "$lab"/host.zz-*.mts "$lab"/test/zz-fix2622-*.poc.test.ts
  rm -rf "$lab/poc-kit" "$lab/poc-api"
}
trap cleanup EXIT

# The model is scripted in every check; a model override in the shell would reach the engine anyway.
quiet_env=(env -u FSDEV_DEFAULT_MODEL -u FSDEV_INTENT_CHAT -u FSDEV_INTENT_PLAN -u FSDEV_INTENT_REASON -u FSDEV_INTENT_UTILITY)
variants=(b0-main-api a-kit b-api)
steps=" ${FIX2622_STEPS:-1 2 3 4 5} "
step() { [[ "$steps" == *" $1 "* ]]; }

# Runs vitest in the lab; prints the summary lines, or the whole log on a failure.
run_vitest() { run_vitest_in "$root" --root . "$@"; }
run_vitest_in() {
  local top="$1"
  shift
  if "${quiet_env[@]}" "$top/node_modules/.bin/vitest" run "$@" >"$log" 2>&1; then
    grep -E "RED \(as required\)|host serves|✓ |Test Files|Tests " "$log" || true
  else
    cat "$log" >&2
    return 1
  fi
}

cp "$lab/host.mts" "$lab/host.zz-today.mts"
# The cost run's A/A control: today's host again, under another name.
cp "$lab/host.mts" "$lab/host.zz-today-again.mts"
for v in "${variants[@]}"; do cp "$here/$v/host.mts" "$lab/host.zz-$v.mts"; done
cp -r "$here/a-kit/poc-kit" "$lab/poc-kit"
cp -r "$here/b-api/poc-api" "$lab/poc-api"
cp "$here/a-kit/host.mts" "$lab/host.zz-control.mts"
patch -s "$lab/host.zz-control.mts" "$here/control-no-lab-context.patch"
cp "$here/parity.test.ts" "$lab/test/zz-fix2622-parity.poc.test.ts"
cp "$here/cost.test.ts" "$lab/test/zz-fix2622-cost.poc.test.ts"

if step 1; then
  echo "== 1. attribution (red-path controls: one stripped row must read both, A only, B only, removable on main)"
  node "$here/attribute.mjs" "$lab/host.mts" "$here"
fi

cd "$lab"
all="today,$(IFS=,; echo "${variants[*]}")"

if step 2; then
  # From the repository root, so the working directory isn't the hosts' own folder and a relative
  # `tree` reads differently against the two.
  echo "== 2. host parity, and a relative tree: $all"
  (cd "$root" && FIX2622_HOSTS="$all" run_vitest_in "$root" --root labs/teammates zz-fix2622-parity)
fi

if step 3; then
  echo "== 3. control: a-kit with lab-context removed must fail parity"
  FIX2622_HOSTS=control FIX2622_EXPECT_RED=1 run_vitest test/zz-fix2622-parity.poc.test.ts
  grep -A1 "RED (as required) for control" "$log" > "$here/control-red.txt"
  grep -q "the served flow ids aren't today's" "$here/control-red.txt"
  cat "$here/control-red.txt"
fi

if step 4; then
  echo "== 4. each variant as the lab's host: typecheck, the four host tests, the contract test"
  host_tests=(test/checks.test.ts test/drain-budget.test.ts test/run-timeout.test.ts test/working-folder.test.ts)
  [ "${FIX2622_SKIP_CONTRACT:-0}" = "1" ] || host_tests+=(test/contract/contract.test.ts)
  for v in "${variants[@]}"; do
    echo "-- $v"
    cp "$lab/host.zz-$v.mts" "$lab/host.mts"
    node ../../scripts/typecheck.mjs   # standalone, so set -e stops the run on a failure
    echo "typecheck passed"
    run_vitest "${host_tests[@]}" >/dev/null
    grep -E "Test Files|Tests " "$log"
    cp "$saved" "$lab/host.mts"
  done
fi

if step 5; then
  echo "== 5. cost of opening each host, rotated, paired differences against today"
  for stub in 0 1; do
    FIX2622_STUB_READINESS=$stub FIX2622_HOSTS="$all,today-again" run_vitest test/zz-fix2622-cost.poc.test.ts >/dev/null
    sed -n '/^COST/,/^END COST/p' "$log"
  done
fi

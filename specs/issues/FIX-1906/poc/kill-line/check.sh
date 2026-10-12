#!/usr/bin/env bash
# FIX-1906 kill-line check: can a fresh worktree of this repository get its
# dependencies and build, and do concurrent worktrees of one checkout collide?
#
# Retained spec evidence, not production code. Nothing imports or runs it by
# default. Run it from the root of a checkout that has had `pnpm install` once
# (that is what fills the machine's pnpm store):
#
#   bash specs/issues/FIX-1906/poc/kill-line/check.sh            # every fact must PASS
#   CONTROL=1 bash specs/issues/FIX-1906/poc/kill-line/check.sh  # every control must FAIL
#
# Leaves nothing behind: its worktrees, branches and scratch repository are
# removed on exit.
set -u
REPO=$(git rev-parse --show-toplevel)
SCRATCH=$(mktemp -d)
WT="$SCRATCH/wt"
STAMP=$(date +%s)
BRANCH="poc/fix-1906-$STAMP"
status=0

cleanup() {
  git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1
  git -C "$REPO" branch -D "$BRANCH" >/dev/null 2>&1
  rm -rf "$SCRATCH"
}
trap cleanup EXIT

report() { # name, exit code, wanted ("pass" or "fail")
  local got=PASS; [ "$2" -ne 0 ] && got=FAIL
  if { [ "$3" = pass ] && [ $got = PASS ]; } || { [ "$3" = fail ] && [ $got = FAIL ]; }; then
    echo "ok    $1: $got (wanted $3)"
  else
    echo "WRONG $1: $got (wanted $3)"; status=1
  fi
}

# A scratch repository with one commit. Its own identity, so a host with no
# global git identity still commits; any setup failure stops the script, so a
# control can never "fail" because its setup did.
scratch_repo() { # path
  git init -q "$1" &&
    git -C "$1" -c user.name=fix-1906-poc -c user.email=poc@localhost commit -q --allow-empty -m init ||
    { echo "SETUP could not create the scratch repository $1"; exit 2; }
}

git -C "$REPO" worktree add -q -b "$BRANCH" "$WT" HEAD || exit 1

if [ "${CONTROL:-0}" = 1 ]; then
  # F1 control: an empty store. --offline must now fail, so F1's pass means
  # the shared store supplied every package.
  (cd "$WT" && pnpm install --frozen-lockfile --offline --store-dir "$SCRATCH/empty-store" >/dev/null 2>&1)
  report "F1 install from an empty store, offline" $? fail
  # F3 control: two worktrees on ONE branch. Git refuses the second, which is
  # the collision F3 shows distinct branches never meet.
  scratch_repo "$SCRATCH/r"
  git -C "$SCRATCH/r" worktree add -q -b same "$SCRATCH/a/checkout" HEAD ||
    { echo "SETUP the first worktree on branch same was not added"; exit 2; }
  git -C "$SCRATCH/r" worktree add -q "$SCRATCH/b/checkout" same 2>/dev/null
  report "F3 a second worktree on the same branch" $? fail
  exit $status
fi

# F1: the worktree installs from the machine's shared pnpm store, no network.
start=$(date +%s)
(cd "$WT" && pnpm install --frozen-lockfile --offline >/dev/null 2>&1)
report "F1 install, offline, in $(( $(date +%s) - start )) s" $? pass

# F2: a package with workspace dependencies builds, and its workspace links
# resolve inside the worktree, not to the checkout.
start=$(date +%s)
(cd "$WT" && pnpm --filter "@flow-state-dev/workspace..." build >/dev/null 2>&1)
report "F2 build workspace and its dependencies in $(( $(date +%s) - start )) s" $? pass
case "$(realpath "$WT/packages/workforce/node_modules/@flow-state-dev/core")" in
  "$WT"/*) report "F2 workspace links resolve inside the worktree" 0 pass ;;
  *) report "F2 workspace links resolve inside the worktree" 1 pass ;;
esac

# F3: 36 concurrent `git worktree add -b`, three rounds of 12, distinct
# branches, every checkout directory named `checkout` (the layout a mapped
# project's place uses), on one repository.
# Stress evidence for the spike, not the test contract: BR-17's test needs two
# concurrent provisions, repeated.
scratch_repo "$SCRATCH/r"
: > "$SCRATCH/errors"
for round in 1 2 3; do
  for i in $(seq 1 12); do
    git -C "$SCRATCH/r" worktree add -q -b "r$round-$i" "$SCRATCH/p/r$round/$i/checkout" HEAD \
      2>>"$SCRATCH/errors" || echo failed >>"$SCRATCH/errors" &
  done
  wait
done
count=$(git -C "$SCRATCH/r" worktree list | wc -l)
[ "$count" -eq 37 ] && [ ! -s "$SCRATCH/errors" ]
report "F3 36 concurrent worktrees, $((count - 1)) made, $(wc -l <"$SCRATCH/errors") errors" $? pass

exit $status

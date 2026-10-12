# POC · a fresh worktree of this repository installs and builds, and worktrees don't collide

Retained evidence for [FIX-1906](../../SPEC.md). Not production code: nothing imports it, it has
no package manifest, and it is outside default build, test, lint and knip discovery
([specs/README.md](../../../../README.md)).

## The question

The epic's kill line ([FIX-1903 SPEC](../../../../epics/FIX-1903/SPEC.md#the-goal-and-how-well-know-its-met)):
a coding agent can't do useful work in a worktree of this repository because it can't install or
build there. This spec has to prove it can, once, before anything builds on a worktree, and pick
how a worktree gets its dependencies. It also rests on git keeping concurrent worktrees of one
checkout apart without a lock of ours.

**What would show the spec is wrong:** an offline install in a fresh worktree that fails, a
workspace package that resolves to the checkout's sources instead of the worktree's, or concurrent
`git worktree add` calls on one repository that error or lose a worktree.

## How to run it

From the root of a checkout that has run `pnpm install` once:

```bash
bash specs/issues/FIX-1906/poc/kill-line/check.sh            # every fact must PASS
CONTROL=1 bash specs/issues/FIX-1906/poc/kill-line/check.sh  # every control must FAIL
```

It removes its worktree, branch and scratch repository on exit. A setup step that fails, such as a
scratch commit on a machine with no git identity, stops it with exit 2, so a control never "fails"
because its setup did.

## What it showed (2026-10-12, `main` at `be18f487`, node 22.22.0, pnpm 10.4.1, turbo 2.9.16)

| Fact | Result |
|---|---|
| F1 · `pnpm install --frozen-lockfile --offline` in a fresh worktree | PASS, 7 s. Files hard-linked from the machine's store (link count 4) |
| F1 control · the same with an empty `--store-dir` | FAIL, as it must: the pass came from the shared store, not the network |
| F2 · `pnpm --filter "@flow-state-dev/workspace..." build` | PASS, 11 s, a real build of the package and its workspace dependencies |
| F2 · `packages/workforce/node_modules/@flow-state-dev/core` resolves inside the worktree | PASS (pnpm links it as `../../../core`) |
| F3 · 36 concurrent `git worktree add -b`, three rounds of 12, each directory named `checkout` | PASS, 36 made, 0 errors; git named its records `checkout`, `checkout1` … |
| F3 control · a second worktree on a branch one already holds | FAIL, as it must: git refuses it |

The FIX-1906 thread's first run of the whole repository, on the same commit, recorded: install
40 s in the checkout with a partly warm store, then 6 s offline in a fresh worktree;
`pnpm packages:build` 30 of 30 tasks with no cache hits in 86 s; `pnpm --filter
@flow-state-dev/workspace test` 216 of 216 in 49 s; `pnpm --filter @flow-state-dev/shift-manager
typecheck` in 12 s. A second worktree's `pnpm packages:build` then took 2 s: turbo 2.9 keeps one
local cache for every worktree of a repository ("using shared worktree cache"), so the 86 s is paid
once per change, not once per worktree.

# FIX-2930 · One commit and diff reader, in the workspace package

**Spec** · [Decisions](DECISIONS.md) · epic [FIX-2927](../../epics/FIX-2927/SPEC.md)

Starts only after [#5682](https://github.com/fixpoint-labs/flow-state-dev/pull/5682) (FIX-2861,
turn diffs leave out a merged-in base) merges.

## Before and after

| A team that… | Today | After |
|---|---|---|
| **reads a run's commits** | Sees `git rev-list --count HEAD --not <baseCommit>` on the worktree row, which counts every base commit a run merged in, and a base-aware count on the review card | Sees one count on both, from one reader that moves the cut to the trusted base tip first |
| **builds a host without the manager** | Cannot reach the good reader, which lives in `harness-manager/src/commits.ts` | Imports it from `@flow-state-dev/workspace` |

## The goal, and how we'll know it's met

**One reader answers "what did this run commit and change", and every surface uses it.**

| How we verify | |
|---|---|
| **Signal** | One `rev-list --count` site for run commits in the repository. `harness-manager/src/commits.ts` is gone. A new test: a run that merges a moved-on base shows the same commit count in its worktree row, its review detail and its turn diff, and the count leaves out the base's commits. `goals/workspace/worktrees-resource` and `goals/harness-manager/where-the-work-went` pass through `fsdev run` |
| **Control that must fail** | The new test on today's tree: the worktree row counts the base's commits |

## What changes

- `effectiveCut`, `readRunCommits`, `readRunChanges`, `readRunDiff`, `readRunFilePatch` and
  their types move into a git read module in `packages/workspace/src/` beside `land.ts`,
  exported from the root.
- The worktree row snapshot in `local-host.ts` reads its count through it, with the host's own
  base tip (D1).
- harness-manager (`manager.ts`, `session-flow.ts`, `run-changes.ts`), and `fsdev worktrees`
  import from workspace. No copy or re-export stays in harness-manager.
- Changesets for workspace (minor) and harness-manager (minor: the exports leave).

## What stays as it is

What each reader returns, and the limits (`MAX_COMMIT_SUBJECTS`, `MAX_DIFF_FILES`,
`MAX_PATCH_CHARS`).

## What's already here, and the debt

**Builds on:** `harness-manager/src/commits.ts` as fixed by #5682. **Adds:** nothing new.
**Debt: net down,** one counter gone.

## Sign off

D1 in [DECISIONS.md](DECISIONS.md).

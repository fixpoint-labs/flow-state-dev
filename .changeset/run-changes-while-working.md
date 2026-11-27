---
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/shift-manager": patch
---

A coding run's changes can be read while it works, uncommitted ones included.

- **`uncommitted` on the run changes view.** `{ uncommitted: true }` reads the run's working tree too: tracked files edited since the last commit and new files git doesn't ignore, each marked `uncommitted: true` in the diff's `files`. A patch read with it opens those files too, and still refuses any path outside that list. New files count lines up to `MAX_UNTRACKED_FILES` (50); past that they're listed with no lines. A new symlink reads as the name it points at, never the file. `readRunDiff` and `readRunFilePatch` take the same option. Without it, nothing changes: a review still reads only what was committed.
- **Commits beside the diff.** The view's answer without `path` now carries `commits` (`count`, newest-first `subjects`, `verified`), read live from the checkout; `null` beside a patch.
- **Reads take no index lock.** Every git read in a run's checkout runs with optional locks off, so a read never holds the lock a harness's own commit needs.
- **shift-manager's Files list** marks a file "uncommitted", and an open file reads its diff again when its counts change.

Docs: packages/harness-manager/README.md and apps/docs/docs/orchestration/harness-manager.md (the view's `uncommitted` input and `commits` output, `MAX_UNTRACKED_FILES`)

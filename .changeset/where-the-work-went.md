---
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/ui": patch
---

A coding run now says where its work went. A harness session's `state.workspace` is `{ worktree }`, the key of its worktree's row in the user's `worktrees` list, which owns the path, branch, base, commit count and state; the copies of the path, branch and owner it held before are gone, and a stored record with them reads as `{ worktree: null }` until its next turn. `HarnessSessionProvisioned` no longer takes `branch`. A task's output gains `baseCommit`, `path` and `commitsVerified`. `workPlace` reads a task's output or a worktree row and returns the branch, the count, the worktree's name and state, whose it is for an attached session, and shell-quoted `git switch`, `cd` and `git log baseCommit..branch` commands. The UI registry gains a `work-place` component that draws them.

---
"@flow-state-dev/workspace": patch
---

The local workspace host no longer runs the repository's git hooks while it makes or hands back a checkout (`-c core.hooksPath=/dev/null` on its worktree git calls). A `post-checkout` hook that builds, such as `pnpm packages:build`, used to fail `git worktree add` in the fresh tree and fail the provision with it (FIX-1947).

---
"@flow-state-dev/workspace": minor
"@flow-state-dev/harness-manager": patch
---

A checkout handed back off its run's branch is no longer refused. The host moves it back onto the run's branch and keeps what the run made elsewhere: a fast-forward when the checkout's commit contains the branch, and otherwise a checkout of the branch after saving uncommitted changes as a commit on the branch the run left. It reports this as `place.repo.movedBack`. A half-done git operation, or the branch checked out in another worktree, is refused as the typed `WorkspaceRefusedError` `checkout-moved`, naming the git command that clears it. A run that switches its own branch no longer strands its session (FIX-2211).

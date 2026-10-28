---
"@flow-state-dev/workspace": minor
"@flow-state-dev/harness-manager": patch
---

A checkout handed back off its run's branch is no longer refused. The host moves it back onto the run's branch and keeps what the run made elsewhere: a fast-forward when the checkout's commit contains the branch, and otherwise a checkout of the branch. It reports this as `place.repo.movedBack`. A checkout with uncommitted changes on a branch that lacks the run's commits is handed back as it is and reported as `place.repo.offBranch`, because those changes are the run's to commit, stash or discard; harness-manager refuses that attempt with the message. A half-done git operation, or the branch checked out in another worktree, is refused as the typed `WorkspaceRefusedError` `checkout-moved`, naming the git command that clears it. A run that switches its own branch no longer strands its session (FIX-2211).

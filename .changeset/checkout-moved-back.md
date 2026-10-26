---
"@flow-state-dev/workspace": minor
"@flow-state-dev/harness-manager": patch
---

A checkout handed back off its run's branch is no longer refused outright. When the commit it is on contains the run's branch, the host fast-forwards the branch to it and points the checkout back, moving no file, and reports it as `place.repo.movedBack`. Otherwise it refuses as the typed `WorkspaceRefusedError` `checkout-moved`, naming the git command that clears it. A run that switched its own branch no longer strands its session (FIX-2211).

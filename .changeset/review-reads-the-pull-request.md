---
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/workspace": patch
---

A coding run's review reads as its pull request would (FIX-2920).

- **A run cut from the checked-out branch is read against that branch's tip.** A host that names no base cuts each run from whichever branch the repository has checked out (`baseRef: "HEAD"`). A review of such a run that had merged the moved-on base in counted the base's commits and files as the run's own. The workspace host now records the branch `HEAD` was on at the cut (`WorkspacePlace.repo.baseBranch`), the run record keeps it, and the review reads the base's tip from that branch. A run recorded before this keeps the old reading.
- **The review names the pull request the work is already on.** `ReviewDetail.pullRequest` is the pull request open from the run's branch, else a recorded one verified against the checkout's repository and run branch, as GitHub has it when the review is asked: its `state` (`open`, `merged` or `closed`) and `unpushed`, how many of the branch's commits it lacks. Either is `null` when it couldn't be read. `ReviewDetail.lands` offers a push only to the branch's open PR when it has commits to push, retaining the action when that count is unknown.

Custom `WorkspaceHost` implementations must return `WorkspacePlace.repo.baseBranch` when cutting a branch from `HEAD` to use the updated diff comparison. Without it, reviews keep the previous behavior.

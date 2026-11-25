---
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/workspace": patch
---

A coding run's review reads as its pull request would.

- **A run cut from the checked-out branch is read against that branch's tip.** A host that names no base cuts each run from whichever branch the repository has checked out (`baseRef: "HEAD"`). A review of such a run that had merged the moved-on base in counted the base's commits and files as the run's own. The workspace host now records the branch `HEAD` was on at the cut (`WorkspacePlace.repo.baseBranch`), the run record keeps it, and the review reads the base's tip from that branch. A run recorded before this keeps the old reading.
- **The review names the pull request the work is already on.** `ReviewDetail.pullRequest` is the pull request open from the run's branch, else the task's newest recorded one, as GitHub has it when the review is asked: its `state` (`open`, `merged` or `closed`) and `unpushed`, how many of the branch's commits it lacks. Either is `null` when it couldn't be read. A card can show it instead of offering to open a second pull request, and offer a push only when there is something to push.

Docs: packages/harness-manager/README.md (the review data's fields)

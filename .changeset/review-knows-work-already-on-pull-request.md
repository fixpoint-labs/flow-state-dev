---
"@flow-state-dev/workspace": minor
"@flow-state-dev/harness-manager": minor
---

A coding run's review no longer offers a push onto a pull request that already holds the run's work (FIX-2986).

- **`ExistingPullRequest.tip`** (`@flow-state-dev/workspace`): the pull request open from a run's branch now says how the branch's tip stands against its head, as the new `PullRequestTip` type: `pushed` when the head is the tip or already contains it, `ahead` when the tip has commits the head lacks, `diverged` when the head has commits the tip lacks (or one the repository doesn't have). Absent when GitHub gives no head.
- **`ReviewDetail.openPullRequestTip`** (`@flow-state-dev/harness-manager`), with the new `ReviewPullRequestTip` type: the same answer on the review's data, `null` when no pull request is open or it couldn't be told.
- **The review offers no way to land when the tip is `pushed` or `diverged`.** Neither a push nor a local merge is offered; the review's prompt says the work is already on the pull request, or that the pull request has commits the branch lacks. A plain accept completes the task, and Request changes stays. A tip that is `ahead` is offered the push as before. A pull request this task landed on before is no longer pushed to unasked when it diverged; the person is asked instead.

Docs: apps/docs/docs/reference/harness-runs.md and apps/docs/docs/catalog/starters/teammates.md (the review's landing choices: no push when the open pull request already holds the work or has diverged, and `openPullRequestTip` on `ReviewDetail`); packages/workspace/README.md (`ExistingPullRequest.tip`).

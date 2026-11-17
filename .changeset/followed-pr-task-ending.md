---
"@flow-state-dev/core": patch
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/workforce": patch
---

A pull request a coding run follows with `followPullRequest` now stops being followed when the run's task fails or is cancelled, also when the run's session works more than one task. A `PullRequestFollower` is handed a third argument, the run (`FollowingRun`, with its `taskId`), and harness-manager passes it; `subscribe`'s server-side write takes a `taskId` for the same purpose. A session that saves its own routine on a pull request it follows keeps hearing that pull request's merge or close (FIX-2786, FIX-2787).

Docs: packages/workforce/README.md (`followPullRequest`: a failed or cancelled task ends the follow), packages/core/README.md (`PullRequestFollower`'s `run` argument).

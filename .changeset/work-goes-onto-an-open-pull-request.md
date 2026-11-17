---
"@flow-state-dev/workspace": minor
"@flow-state-dev/harness-manager": patch
---

A coding run whose branch already has a pull request open from it puts its work there, with no review asking how to land it (FIX-2781).

- **workspace:** `WorkspaceHost.existingPullRequest(target)` answers the pull request already open from the branch `land` would land (`{ url, number, branch }`), or `null` when there is none or it can't be told. It never rejects. `existingPullRequest(host, target)` is the same check for a `LandHost`. A `pull-request` landing onto a pull request that was already open now says so with `existing: true` on its `Landed`.
- **harness-manager:** with `reviewChanges` on, a run whose branch has an open pull request is not held for "Review the run's changes". Its branch is pushed to that pull request, the stream says "Pushed <branch> to pull request #N", and with `awaitPullRequests` the task waits on it as before. The output's `review` stays `null`, since nobody reviewed it here. If the push fails, the review is asked with the error and offers only that pull request, never a second one or a local merge.

Docs: packages/workspace/README.md (`existingPullRequest` beside `land` and `landWays`), packages/harness-manager/README.md (the `reviewChanges` section: a branch with an open pull request lands there unasked)

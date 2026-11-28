---
"@flow-state-dev/workspace": patch
"@flow-state-dev/harness-manager": patch
---

A run whose own branch is gone no longer lands onto someone else's pull request (FIX-2973). When a run's branch no longer exists, landing pushes the branch its checkout is on, as before, but first asks GitHub which pull requests are open from that branch, into any base. If one of them isn't the run's own, nothing is pushed and the landing is refused `foreign-pull-request`, naming the pull request and the branch. If GitHub can't be asked, nothing is pushed either (`pull-request-failed`).

- **`LandTarget.ownPullRequests`** names the run's own pull requests by `pullRequestKey`. It is read only for a branch the run moved its work to. Absent, no pull request open from such a branch is the run's.
- **The harness manager** passes the pull requests an accept on the task already landed on (`landedPullRequests`). A pull request the coding session opened itself from a renamed branch is refused like any other, since nothing records it as the run's: keep the run's own branch, or rename it without opening a pull request, to land.
- A renamed branch with no pull request open from it still lands as before.

Docs: packages/workspace/README.md (landing: the moved-branch fallback and the new refusal reason)

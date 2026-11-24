---
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/shift-manager": patch
---

A coding run's review no longer offers to open a pull request when one is already open from its branch (FIX-2920).

- **harness-manager:** with `reviewChanges` on, a review asked about a run whose branch has a pull request open that no accept on this task landed on yet (for example, one the coding session opened itself) now names it. Its data carries `openPullRequest: { number, url }`, read by `reviewDetail` (`null` when none is open, or on data from before the field), the pull request is listed in `pullRequests`, and the prompt says "Pull request #N is already open from <branch>: <url>. An accept that lands as a pull request puts the work on it; no second pull request is opened." The ways to land are unchanged. A user's `pull-request` accept goes only onto that pull request: if it closed since, nothing is pushed or opened, and the review is asked again with the error and without it.
- **shift-manager:** the review card's accept onto that pull request reads "Accept: Push to PR #N" instead of "Accept: Open a PR".

Docs: packages/harness-manager/README.md (the `reviewChanges` section: a review on a branch with a pull request already open names it as `openPullRequest`, and an accept lands there)

---
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/workspace": patch
---

A reviewed coding run on a branch that already has an open pull request pushes its work to that pull request instead of asking how to land it (FIX-2781).

- **harness-manager:** with `reviewChanges` on, a run whose branch has an open pull request (opened by this run or earlier) raises no review offering Open a PR or Merge locally. Its commits are pushed to that pull request, the output's `landed` names it, the stream says how many commits it gained, and with `awaitPullRequests` the task waits on it. If that push fails, the review is asked with the error and offers only that pull request, never a local merge.
- **workspace:** `recordBranchPullRequests`'s result carries `open`: every pull request still open on the checked branches, however old, with its head commit (`OpenBranchPullRequest`).

Docs: none (behaviour of the review hold; no documented surface names the landing choices on a branch with an open pull request).

---
"@flow-state-dev/shift-manager": patch
---

A coding task whose work is a pull request now stays open until that pull request merges or closes (FIX-2578). Both of the coder's managers turn on harness-manager's `awaitPullRequests`, so a run that opened a pull request, or an accept's Open a PR, leaves its task waiting on it. The conversation's task line shows **PR open · #N** with the link and "Merged? Say so here and I'll check."; a line in the task's session wakes it to read the pull request: merged completes it, closed unmerged cancels it, still open runs the line on the same coding session.

Docs: none beyond the package's own UI; the harness-manager release notes cover the option.

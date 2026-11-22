---
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/shift-manager": patch
---

A message sent to a coding task that waits on its pull request is always answered, even when the pull request has already merged or closed (FIX-2884).

- **harness-manager:** with `awaitPullRequests`, a user's message (a line in the task's session, or a steer) that wakes a task whose pull requests have merged or closed now runs the harness on the same session. The brief tells the run what became of each pull request, in place of the lead for one still open, and asks it to answer rather than push. The settle after that run completes or cancels the task as before. Before, the message was taken with no run and never answered. A wake carrying only the pull request's own news (a delivery from GitHub, a deadline) still settles with no run.
- **harness-manager:** `landedOf(value, pullRequests?)` takes the output's settled pull request reads, and the coding board's `landed` pull request carries `state: "merged" | "closed"` once it has merged or closed.
- **shift-manager:** a finished task's landed pull request says "It has merged." or "It was closed without merging." in place of "Next: review and merge it."

Docs: packages/harness-manager/README.md (`awaitPullRequests`: a user's message on a merged or closed pull request runs the harness)

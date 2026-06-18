---
"@flow-state-dev/devtool": patch
---

DevTool now reflects suspend/resume live. Two gaps made a human-in-the-loop request look stuck until a manual refresh:

- The request-stream hook's status handler ignored `request.suspended` (and `interrupted` / `aborted`), so a request that paused at a `ctx.suspend()` gate stayed on the "in progress" badge. It now maps those to the matching status and stops the live spinner.
- Resolving a suspension (approve/reject) posted the resume but never re-attached the panel's stream, so the continuation's progress to terminal only appeared after a page refresh. The Suspensions view now hands the resumed request id back to the panel, which re-subscribes to the same-id continuation and follows it to completion.

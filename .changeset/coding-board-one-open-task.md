---
"@flow-state-dev/harness-manager": minor
---

The coding board view takes an optional `taskId` in its input (FIX-2773). With it, the view still returns every row, and the row it names carries `detail: { answer, answerCut }`: what the task came back with, cut at the same 20,000 characters `getTask` cuts output at. Without it, `detail` is `null` on every row, so a board read stays the size it was. A screen reads a task's answer this way while the task is open, and reads the board without one everywhere else.

A row's `error` now also carries the reason a cancelled task was cancelled with. Code that reads `error` as a failure should check `status === "errored"` too.

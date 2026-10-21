---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/harness-manager": minor
---

A worker can now end its task on the current attempt without writing the ending itself: throw `TaskEndsForGoodError` (from `@flow-state-dev/orchestration/task-board`) naming the task it holds (`taskId`), and the board's error recorder ends that row under the worker's claim, `errored` with no retry by default or `cancelled` with `{ ending: "cancelled" }`. A marker naming any other row, such as one rethrown by a board nested inside the worker, is an ordinary failure.

Harness Manager's refused run uses it: the manager no longer fails or cancels its own row, and the board records the ending. The outcome is unchanged (`errored` on a board read from the claim, `cancelled` on the fixed board). `HarnessRunRefused` now extends `TaskEndsForGoodError`, and its constructor takes a second argument, `{ taskId, ending }` (FIX-2090).

---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/harness-manager": patch
---

A worker can now end its task on the current attempt without writing the ending itself: throw `TaskEndsForGoodError` (from `@flow-state-dev/orchestration/task-board`), and the board's error recorder ends the row under the worker's claim, `errored` with no retry by default or `cancelled` with `{ ending: "cancelled" }`.

Harness Manager's refused run uses it: the manager no longer fails or cancels its own row, and the board records the ending. The outcome is unchanged (`errored` on a board read from the claim, `cancelled` on the fixed board). `HarnessRunRefused` now extends `TaskEndsForGoodError`, and its constructor takes the ending as a second argument (FIX-2090).

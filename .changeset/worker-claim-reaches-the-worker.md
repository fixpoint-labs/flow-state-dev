---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": patch
---

A task-board worker can now read its own claim. `currentWorkerClaim(ctx)` returns the ticket inside an inline board worker and inside a worker behind a claim gate, so a task tool called by a claimed worker presents ownership and a write to another task is refused. The observation ledger and the tool cache's `sourceTask` now record the worker's task.

`currentWorkerClaim` and `stampCurrentClaim` now take the block context. A claim belongs to the request that took it: a request the worker starts in-process (a message, a hand-off, a resumed turn) does not read it. Code that called `currentWorkerClaim()` with no argument must pass its `ctx`.

`taskLedgers` takes `taskTurn: false` for an entry whose turn answers the user rather than its filer. Such a turn keeps its claim but is not a task turn: it may wait on work it hands off, and it is not offered the question park. Workforce's delegated-post entry sets it, so a post turn behaves as it did before (FIX-1047).

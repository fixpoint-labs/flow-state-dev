---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": patch
---

A task-board worker can now read its own claim (FIX-1047). `currentWorkerClaim(ctx)` returns the ticket inside a worker the board runs inline and inside a worker reached through a task entry, and `undefined` outside one. A worker's task-tool writes are limited to the task it holds, so a write naming a different task is refused. The observation ledger and the tool cache's `sourceTask` now record the worker's task.

`currentWorkerClaim` takes the block context. A claim reads back only in the request that took it: a request the worker starts or resumes in the same process (a message, a dispatch, a resumed turn) gets `undefined`. Code that called `currentWorkerClaim()` with no argument must pass its `ctx`.

`taskLedgers` takes `taskTurn: false` for an entry whose run answers the user rather than the task's filer. Such a run keeps its claim but is not a task turn: it can wait on work it dispatches.

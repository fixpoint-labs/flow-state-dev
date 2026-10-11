---
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/orchestration": patch
---

`harnessManager` can read each run's board from its claim (FIX-1866). Give it `ledgers`, a resolver typed like `taskLedgers`'s, and the task's entry hands it the claim on its input as `claim: { collectionId, partition, incarnationId }`; every read and write is still fenced against the row at that ledger and partition. Runs are kept apart by board and partition (`runBoardSegment`). On such a board a refused run ends the task `errored` instead of `cancelled`, and a question parks the task on the board itself, with the answer reaching the next attempt's prompt. A completed run's output now carries `answer`, `branch`, `commits` and `judged`, and `isDone` reads the run's `answer`. An optional `judge` (a host block and a confidence floor) reads a run on such a board after `isDone` passes; `harnessDrainBudgetMs` takes `judge: true` to reserve its time. A fixed board runs as before.

Orchestration's `fail` takes `noRetry: true` to end a task `errored` on this failure even when it has attempts left.

---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/contracts": patch
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

A task board now reports when it saves a task's result and then cannot announce
it, instead of finishing the run as though nothing went wrong. The failure lands
on a persisted `task-board-recorder-failure` item and fails the run once every
other task has drained; on a handed-off task it fails that child run. `onError`
does not suppress it. Where the board cannot tell whether the write landed —
permanently so on a task store you supplied, and on rows that predate write
provenance — it says `undetermined` rather than assuming the write was lost, and
hands the row back rather than leaving it claimed (FIX-963).

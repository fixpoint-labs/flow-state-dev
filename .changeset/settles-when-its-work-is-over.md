---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
---

A dispatched task now settles once, when its work is over (FIX-2077): after its request, the background work that request started and the background work the flow's `onFinished` started have ended, with no task it filed still open or still owing its ending. Until then the row stays `in_progress`, and `Task.keptOpenBy` says what holds it (`"filed"`, `"suspended"` or `"steer"`). A row that waits has no lease, so a task that stops to ask a person or to wait on an event is no longer reclaimed and run again when its lease runs out. The output is the latest `reportProgress` checkpoint, else the last answer that counts; a message's answer never is.

Orchestration adds `taskRequestAdmission`, `noteTaskAnswer` and `afterTaskCheck` for a request that works on a waiting task, and `endRules` on `createTaskGate` and `taskLedgers`. Core adds `onRequestEnded` (`@flow-state-dev/core/types`), a framework-facing hook the engine runs after a request's last drain, on every way it ends.

In Workforce a split task stays running while its pieces are open, and its output is its worker's answer like any task's. Read a piece's result from its own row (`listTasks({ filedByTask })`, `getTask`). A failed piece no longer fails its task by itself: the turn its ending wakes decides, and only a turn that throws fails the attempt. A worker that ignores a failed piece completes its task anyway.

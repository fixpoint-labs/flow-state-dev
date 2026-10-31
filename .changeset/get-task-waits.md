---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
---

A request waits on a task it filed with `getTask({ id, wait: true, deadline? })`, now or in a later request, and gets the task back once it ends or as it stands at the deadline (FIX-2082). The deadline cancels nothing: the task runs on, and an ending that lands while the request still runs reaches it on its next `getTask`; one it never reads goes to `onTaskSettled`, once. A task's own request may wait too, and waits nest up to five deep, counted live. A wait's deadline is a wake on the waiting session, so a restart keeps it. Use `waitOnTask(ctx, board, id, { key })` from `@flow-state-dev/orchestration/task-board` when the wait is in application code rather than a tool.

- `dispatcher({ wait: true })` waits for the request it starts and outputs `{ status: "completed" | "failed" | "running", output?, error?, requestId }`.
- On a plan board a row filed `session: "new"` runs in a session of its own through `taskBoard({ newSession })`, and the drain waits on it. A plan board may hold dispatchers, whose rows it waits on; a plan board's dispatcher with `wait: false`, and a delegation board's with `wait: true`, are refused. In Workforce, a worker's step filed `session: "new"` runs in a new session of the same worker.
- `canHoldWait(ctx)`, `dispatchWaitResultSchema` and `DispatchWaitResult` are exported from `@flow-state-dev/core`; `RequestHost.waits.ended(requestIds)` says whether a request has stopped running its work, and `checkWait` (orchestration) runs a wait's checks alone.
- Hosts set a wait's deadline bounds with `waitDeadlines: { defaultMs, minMs, maxMs }` (5 minutes, 1 s, 24 h by default). A wait needs a store that keeps wakes. `parkOnWait` takes a `deadline` (epoch ms) and returns the `WaitOutcome`.

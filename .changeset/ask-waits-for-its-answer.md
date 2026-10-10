---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

A worker can ask a colleague and carry on the same turn with the answer (FIX-1816). `addTask` takes `waitForResponse` and `timeoutMs` (five minutes by default, 30 seconds to an hour, refused outside that as `wait_timeout_out_of_range` and never clamped) on a turn whose host can hold an ask: durable execution and a running durability sweeper, which the request host now reports as `RequestHost.hasAskSweeper`. Anywhere else `addTask` is unchanged and adds no tool. An asked task's ending resumes the turn that waits on it, through the same notice every ending sends, and wakes no new turn. The task notice module (`recordEnding`, `owedNotices`, `decideNotice` and the rest) moved from Workforce into `@flow-state-dev/orchestration/tasks`. `isTaskTurn(ctx)` is true on a turn that is itself working a task, and an ask there is refused as `wait_unavailable`. Orchestration's root exports `isTaskTurn`, `TASK_SESSION_TASK_KEY`, `resumeOwedAsks` and `taskToolsForTurn`; the rest of the ask mechanism (`addTaskAndWait`, which refuses a host that can't bound the ask, `canHoldAsk`, `askGateId` and the timeout bounds) is on `@flow-state-dev/orchestration/task-board`.

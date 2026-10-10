---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

A worker can ask a colleague and carry on the same turn with the answer (FIX-1816). `addTask` takes `waitForResponse` and `timeoutMs` (five minutes by default, 30 seconds to an hour, refused outside that as `wait_timeout_out_of_range` and never clamped) on a turn whose host can hold an ask: durable execution and a running durability sweeper, which the request host now reports as `RequestHost.hasAskSweeper`. Anywhere else `addTask` is unchanged and adds no tool. An asked task's ending resumes the turn that waits on it, through the same notice every ending sends, and wakes no new turn. The task notice module (`recordEnding`, `owedNotices`, `decideNotice` and the rest) moved from Workforce into `@flow-state-dev/orchestration/tasks`. `isTaskTurn(ctx)`, exported from orchestration's root, is the one test of a turn the receiving gate serves; an ask there is refused as `wait_unavailable`. `taskToolsForTurn`, `canHoldAsk`, `addTaskAndWait` and `resumeOwedAsks` are exported too.

---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

Ask follow-ups (FIX-1816). `createTaskToolsCapability` and `taskToolsForTurn` take `{ resumesAsks }`: `addTask` offers `waitForResponse` only on a board whose runner calls `resumeOwedAsks`, and the option defaults to off, so the standalone `taskTools` and a custom resolver no longer offer a wait nothing would wake. Workforce's conversation board opts in. `listTasks` marks an asked row `asked: true`. `addTaskAndWait` files its row once even across a crash between the row's write and the record of the filing, answers with a row that completed just before its timeout's cancel, and reports a re-driven ask its own timeout cancelled as `wait_timed_out`; `ASK_TIMED_OUT_REASON` is that cancel's reason.

---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": patch
---

Ask follow-ups (FIX-1816): `createTaskToolsCapability` and `taskToolsForTurn` take `{ resumesAsks }`, off by default, so an existing caller of either no longer offers `waitForResponse` until it passes `resumesAsks: true` for a board whose runner calls `resumeOwedAsks` (Workforce's conversation board does); `listTasks` marks an asked row `asked: true`; and `addTaskAndWait` files its row once across a crash, counts the deadline from the filing, answers with a row that completed just before its timeout's cancel, and on a re-drive reports the outcome its gate recorded.

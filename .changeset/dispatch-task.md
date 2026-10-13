---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
"@flow-state-dev/core": minor
"@flow-state-dev/devtool": patch
---

A new `dispatchTask` tool (and `dispatchTask_<board>` action, offered in the DevTool's Tasks tab) starts work on another worker now and can wait for its result with `wait: true`, while on a board that dispatches (a Workforce conversation's, or one built with `{ dispatches: true }`) `addTask` and `assignTask` only record a task until `dispatchTask` names its `taskId`, `addTask` refuses `waitForResponse` and `timeoutMs` with `add_task_does_not_wait`, and the wait names are renamed with no alias (`addTaskAndWait` → `dispatchAndWait`, `AskEndedError` → `WaitEndedError`, `canHoldAsk` → `canHoldWait`, and the rest of the `Ask` names to `Wait`) (FIX-1875).

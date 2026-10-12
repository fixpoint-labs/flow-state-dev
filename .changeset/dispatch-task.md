---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
"@flow-state-dev/core": minor
"@flow-state-dev/devtool": patch
---

`dispatchTask` starts work on another worker now, and can wait for the result. It takes `addTask`'s fields, or `taskId` for a task recorded earlier, plus `wait: true` (and `timeoutMs`) to park the turn until the task ends and return its output as `answer`. It is offered on a board that starts a ready row at once: a conversation's board in Workforce, or your own board with `createTaskToolsCapability(resolver, roster, { dispatches: true })`. The app's action is `dispatchTask_<board>` (`dispatchTask_tasks` on a conversation), which never waits. With no `assignee` and no single delegate to default to, it answers `assignee_required` and files nothing.

On such a board, `addTask` and `assignTask` record work and don't start it. `addTask` answers `{ ok: true, taskId, status: "recorded", note }`; the task starts when `dispatchTask` names its `taskId`. **A task filed through `addTask_tasks` on a conversation's board no longer starts; send `dispatchTask_tasks`.** Tasks stored before this change, and tasks flow code files on the board directly, start as before. Boards a drain runs (`taskBoard()`, the patterns) are unchanged and have no `dispatchTask`.

`addTask` no longer waits: `waitForResponse` and `timeoutMs` on `addTask` are refused by name with `add_task_does_not_wait`, and nothing is filed. Send the same fields to `dispatchTask` with `wait` in place of `waitForResponse`.

Renamed, with no alias: `addTaskAndWait` → `dispatchAndWait`, `AddTaskAndWaitOptions` → `DispatchAndWaitOptions`, `WaitForResponseResult` → `DispatchAndWaitResult`, `canHoldAsk` → `canHoldWait`, `AskEndedError` → `WaitEndedError`, `AskStoppedError` → `WaitStoppedError`, and `DEFAULT_ASK_TIMEOUT_MS`, `MIN_ASK_TIMEOUT_MS`, `MAX_ASK_TIMEOUT_MS` → `DEFAULT_WAIT_TIMEOUT_MS`, `MIN_WAIT_TIMEOUT_MS`, `MAX_WAIT_TIMEOUT_MS`.

The DevTool's Tasks tab offers a board's `dispatchTask` action on a row, so a recorded task can be started from it.

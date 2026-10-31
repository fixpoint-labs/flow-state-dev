---
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
"@flow-state-dev/engine": patch
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
"@flow-state-dev/devtool": patch
"@flow-state-dev/shift-manager": patch
"@flow-state-dev/harness-manager": patch
---

A question is one kind of task hold (FIX-2317). The two ways to stop for the user are named for what stops: `suspendForUser` suspends the request and resumes it with the answer, and `holdTaskForUser` holds the task until the user answers. Every rename below is breaking, with no alias.

- **Stopping the request.** `ctx.waitForUser` is `ctx.suspendForUser` (`core`), and `waitForUserOn`, `WaitForUser`, `WaitForUserOptions`, `WaitForUserContext` and `WaitForUserCancelled` are `suspendForUserOn`, `SuspendForUser`, `SuspendForUserOptions`, `SuspendForUserContext` and `SuspendForUserCancelled`. `WaitForUserKind` and `waitForUserKindOf` are `SuspendForUserKind` and `suspendForUserKindOf` (`contracts`, re-exported by `core`). The model's `waitForUser` tool is `suspendForUser`, built with `createSuspendForUserTool` (was `createWaitForUserTool`).
- **Holding the task.** The worker's `askQuestion({ question })` tool is `holdTaskForUser({ question })`, built with `createHoldTaskForUser` (was `createAskQuestion`).
- **A task's holds.** `Task.questions`, the `holds` an Inbox item and `getTask` / `listTasks` list, are `holds`. `TaskQuestion`, `RowQuestion`, `SuspensionQuestion`, `RowQuestionSource`, `SuspensionQuestionSource` and `InboxQuestion` are `TaskHold`, `RowHold`, `SuspensionHold`, `RowHoldSource`, `SuspensionHoldSource` and `InboxHold` (`taskHoldSchema` and so on). `QuestionCloser`, `QuestionChange` and `QuestionWriteResult` are `HoldCloser`, `HoldChange` and `HoldWriteResult`. The helpers read *hold*: `openHolds`, `hasOpenHold`, `openRowHolds`, `isRowHold`, `isSuspensionHold`, `suspensionHoldOf`, `holdsDue`, `nextHoldDue`, `newRowHolds`, `holdWrite`, `payHoldDeadlines`, `holdDueMs`, `holdOfSuspension`, `openUserHolds`. The options `whileQuestionOpen` and `refuseWithOpenQuestion` are `whileHoldOpen` and `refuseWithOpenHold`, and `setKeptOpenBy`'s `question` option is `hold`.
- **What keeps a task open.** `keptOpenBy: "wait"` is `"suspended"`: its own request is suspended.
- **Unchanged:** the filer's hold (status `held`, `hold()`, `release()`), filing with `questions`, `QuestionInit`, `updateTask({ answers })`, the Inbox client's `answerOne` and `questionId`, and the decline reasons `open-question` and `no-such-question`.

A row stored before this release still reads: its `questions` read as `holds`, and `keptOpenBy: "wait"` reads as `"suspended"`. A reader of raw stored rows, such as a browser's list of a board, maps a row the same way with `withRetiredShapes` from `@flow-state-dev/orchestration/tasks`. The conversation board's browser fields include `questions`, so a stored row keeps them on the way there. Shift Manager and the DevTool read them as holds.

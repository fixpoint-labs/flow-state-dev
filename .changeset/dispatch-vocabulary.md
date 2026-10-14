---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": patch
---

A task board that starts a row on another worker now **dispatches** it; **hand-off** means only passing work that is already under way (FIX-1876).

- The board's ending for "every remaining row is running in a dispatch run" is now `terminationReason: "dispatched"` (was `"handed-off"`). A log stored before the upgrade still carries `"handed-off"` for the same ending, so a reader of `task-board-meta` items should take both.
- The row-dispatch block's output is now `{ dispatched: true, taskId, sessionId, requestId, adopted }` (was `handedOff: true`).

The old exports are gone, with no alias, so an import of one fails to compile and names it:

- `@flow-state-dev/orchestration`: `createHandOff` → `createRowDispatch`, `HandOffOptions` → `RowDispatchOptions`, `HandOffAssignee` → `DispatchingAssignee`, `handedOffTaskPredicate` → `dispatchedTaskPredicate`, `assertHandOffBoardSupported` → `assertDispatchBoardSupported`, `assertHandOffBlockSupported` → `assertDispatchEntrySupported`, and the board handle's `handedOff` → `dispatchers`. The board's internal dispatch blocks keep their names (`<board>-hand-off-<assignee>`, `<board>-hand-off-fallback`), since a recorded route decision names them and a request resumed across the upgrade must reselect the same route.
- `@flow-state-dev/core` and `@flow-state-dev/engine`: no export changes. Definition-time and run-time refusals say a block "dispatches to task:…" where they said it "hands off to task:…".

The task-board page's "Assignees that hand off" section is now "Assignees that dispatch"; the old anchor still lands on it.

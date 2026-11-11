---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/shift-manager": patch
---

A board's task list and a coding run's changes are views (FIX-2623).

- **orchestration:** `taskToolViews(collectionId, resolve)` builds a board's task list as a keyed session view, `listTasks_<suffix>`. Its answer is the board's rows as the `listTasks_<suffix>` action lists them, keyed by task id. When a session has no board to list, it is refused with the list's own reason (`422 no_delegation_board`) rather than answered as an empty board. `taskListViewRef(flow, board)` from `@flow-state-dev/orchestration/inbox` is the client's typed handle on it (`TaskListView` is its type): `useView(taskListViewRef(flow, "tasks"), {}, { sessionId })` in React, or `client.view(...)`.
- **harness-manager, breaking:** `harnessRunChangesRead` is now `harnessRunChangesView`, and `HarnessRunChangesReadOptions` is now `HarnessRunChangesViewOptions`, with the same options. It returns a session view: declare it with `views: { changes: harnessRunChangesView({ board, uses }) }` instead of `reads: { changes: ... }`, and call it on the run's session with `client.view(viewRef(flow, "changes"), { taskId?, path? }, { sessionId })`. The answer is unchanged. `harnessSessionFlow`'s per-turn `changes` is a session view too.
- **shift-manager:** the Tasks panel and a feed's task cards watch the conversation board's view. They name no topic and read on the view's own timer where push can miss a change.

Docs: packages/orchestration/README.md (`taskToolViews` keyed, `taskListViewRef`, `TaskListView`), packages/harness-manager/README.md (`harnessRunChangesView`, `HarnessRunChangesViewOptions`, `changes` as a session view), apps/docs/docs/orchestration/harness-manager.md (the changes view replaces the read).

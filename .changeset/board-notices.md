---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/react": minor
"@flow-state-dev/core": patch
"@flow-state-dev/contracts": patch
"@flow-state-dev/shift-manager": patch
---

A task board's change reaches every open view of the board, from whichever session or process settles the task (FIX-2429).

- **orchestration:** every change to a board built by `getOrCreateTaskCollection` also publishes a `board` change notice on the topic of the session that filed the row (`Task.filer`, else the ledger's legacy filer, else the running session), narrowed to the board's `collectionId`. A screen subscribes `topic.session(conversationId, { resource: "tasks" })` and reads again. Nothing to wire: the `task-change` item is unchanged.
- **engine:** the block context carries the seam that publishes a board notice on the running request's bus, under its tenant, with the request as `origin`.
- **react:** **Breaking for a hand-built client slice:** a live `BoardList`'s `client` takes `subscribe` in place of `sessions.stream`. A client from `createClient` works as before. The list now hears a task that settles in another session or process, never wakes on a reply streaming in the session, and reads every 3 s where push can miss a change. `useSubscription` takes `client`, for an app that builds its own client.
- **core / contracts:** `ChangeKind` gains `"board"`; `publishBoardChange` and `BOARD_NOTICE_SEAM` (framework-facing) in `@flow-state-dev/core/types`.
- **shift-manager:** the conversation's task panel and task cards read on board notices; they keep their 3 s timer only while a task is open, and only where push can miss a change.

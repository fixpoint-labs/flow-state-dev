---
"@flow-state-dev/workforce": patch
"@flow-state-dev/react": patch
"@flow-state-dev/orchestration": patch
---

An app on workforce's client can stop one run, upload a file through a worker's flow, change a conversation's delegates and watch them live, without addressing a worker's flow itself (FIX-2776).

- **workforce:** `WorkforceClient.send` sets each send's request id and resolves to `{ requestId }`, so a screen can match the line and its turn, or stop it, before the turn ends. It takes `taskId`, the task the line is sent from, and passes it only to a door that takes one (the worker inventory's `doorTakesTask` for the session's flow), so a strict door is never handed a key it refuses. A caller that awaited `send` for nothing gets a value it can ignore.
- **workforce:** `WorkforceClient.stopRun(sessionId, requestId)` stops one run of a session through the flow it runs on; a run that already ended is no failure. `stopTurns` still stops every running turn.
- **workforce:** `WorkforceClient.upload(worker, request)` uploads a file for a line through the worker's flow, whose sign-in the send runs; a first line with no session yet uploads this way too.
- **workforce:** `WorkforceClient.addDelegate(sessionId, worker, note?)` and `removeDelegate(sessionId, worker)` change a conversation's delegates through its own actions, rejecting with the coordinator's reason.
- **workforce:** every flow built on `defineSessionBoard` declares a `delegates` session view (`views`): what `listDelegates` answers, each delegate with what it does and takes, read without writing. Watch it with `useView(delegatesViewRef(flow), {}, { sessionId })` from `@flow-state-dev/workforce/browser`; it hears every change to the list, the coordinator's own tool's included. Reading it never pins the list, `delegates: all`'s included. A flow that builds its own `views` spreads `board.views` to get it.
- **react:** `UseRequestStreamResult.completedAt` is when the followed request ended (the time of its ending status event), for a screen that follows one request by id rather than a session's latest turn.
- **orchestration:** `TaskChangeKind`, `TaskBoardCounts` and `TaskBoardMeta`, the values of the `task-change` and `task-board-meta` items a board writes, are exported from `@flow-state-dev/orchestration/tasks`. `TaskChangeKind` is no longer exported from `./internal`. The board's task-list view and `listTasks_<board>` action (never the model's tool) carry a row's `error`, `deps` and brief `attachments`.

Docs: packages/workforce/README.md (client section: `stopRun`, `upload`, `addDelegate`, `removeDelegate`, `send`'s `taskId` and answer, the delegates view), apps/docs/docs/workforce/delegating-work.md (the view beside `listDelegates`), packages/react/README.md (`useRequestStream`'s `completedAt`)

---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
---

A flow's `reads` are removed; views replace them (FIX-2623).

- **core, breaking:** `defineFlow` refuses a `reads` key with an error naming views, rather than defining the flow and serving nothing. `ReadConfig` and `ReadEntry` are removed from `@flow-state-dev/core` and `@flow-state-dev/core/types`, with no alias. Declare each read as a session view instead: `views: { name: defineView({ scope: "session", block }) }` (the block declares its `outputSchema`).
- **engine, breaking:** the read route, `POST /api/flows/:flowKind/:sessionId/reads/:readName`, is gone, and so is `runRead` from `@flow-state-dev/engine/internal`. A session view answers at `POST /api/flows/:flowKind/:sessionId/views/:viewName` with `{ output, topics }`.
- **client, breaking:** `client.flow(kind).read(name, input, { sessionId })` is removed. Call `client.view(viewRef(flow, name), input, { sessionId })`, or `useView` in React, which also keep the answer current from the topics it names.
- **orchestration, breaking:** `taskToolReads` is removed from `@flow-state-dev/orchestration/internal`. A board's task list is `taskToolViews(collectionId, resolve)`, watched through `taskListViewRef(flow, board)`.
- **workforce:** the coordinator, the agent worker flow and `defineSessionBoard` serve the conversation's task list as the session view `listTasks_tasks` only; `defineSessionBoard(...).reads` is gone (spread `views` instead).

Docs: packages/core/README.md and packages/engine/README.md (reads, `ReadConfig`, the read route and `runRead` leave), packages/client/README.md (`flow(kind).read` leaves; `client.view`), packages/orchestration/README.md (`taskToolReads` leaves), packages/workforce/README.md (`defineSessionBoard`'s `reads` leaves), apps/docs pages on flow reads (retire; point at Views).

# @flow-state-dev/devtool

## 0.3.0

### Minor Changes

- a3bfbc2: An Inventory tab on any session whose flow declares a readable inventory collection: the organization's registered seats (with their kind and channels), channels (with their members and registration time) and memberships, read through the production collection route with the configured bearer token, so it works with the debug endpoints off. A collection the flow does not declare reads "not installed on this flow", and a refused read names its status (FIX-1502).
- 211679a: New core block kind: `evaluator` (FIX-1554). It asks an evaluation model typed questions (`choice`, `score`, `boolean`) and returns typed answers, with the model's confidence when it reports one. Model strings resolve through your existing providers and gateways; models that can only generate are refused before any call. `BlockKind` and the trace's `blockKind` gain `"evaluator"`: code that switches on block kind should handle it. `ai` minimum raised to the first release with evaluation. `@ai-sdk/typesafe-ai` is an optional peer. `ModelResolver` gains an optional `resolveEvaluationModel`; a custom resolver without it runs generators as before and refuses evaluator model strings. Evaluation through Vercel's AI Gateway needs `@ai-sdk/gateway` 4.0.85 or later. `@flow-state-dev/testing` adds `mockEvaluationModel`.

### Patch Changes

- bb1c224: `FlowNavigator` now draws an open leaf's `leafToolbar` on that leaf's own row, showing both row slots only when the row is hovered or focused (always on touch screens), so give them icon buttons with an `aria-label`, it adds dashed tree lines you can colour with `--fsd-nav-guide` and a `leafDetail` slot for content that sits on its own lines under an open leaf's row, and untitled session rows show a shortened id with the full id on hover (FIX-1561).
- Updated dependencies [53b50f0]
- Updated dependencies [585b75b]
- Updated dependencies [8dc242e]
- Updated dependencies [7d4158f]
- Updated dependencies [211679a]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [bb1c224]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [a7f1c41]
- Updated dependencies [7d4c413]
- Updated dependencies [736e719]
- Updated dependencies [3311cc2]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [0e7e07e]
- Updated dependencies [407964a]
  - @flow-state-dev/core@0.3.0
  - @flow-state-dev/client@0.2.1
  - @flow-state-dev/react@0.3.0

## 0.2.0

### Minor Changes

- 6b8bfe4: Sessions a dispatcher ran work in are listable on their flow: `GET /sessions` takes `include=dispatch-runs` (off by default), `listSessions` takes `include`, `FlowNavigator` takes `includeDispatchRuns` and draws a run one level under the session that started it, the DevTool shows runs in the rail and inside a session's block tree on demand in place of its Children tab, and `requestHost.livenessOf` now also answers for a dispatch run under the caller's own principal, tenant, organization and flow instance rather than only for one beneath the asking session (FIX-1440).

  The dispatch-run liveness arm compares the caller's organization against the active-request entry as well as the session record. Both comparisons are required: they read separately stamped rows, and a caller whose organization was not forwarded to the read matched only entries carrying no organization at all.

### Patch Changes

- 795b550: The debug resource snapshot now reports each resource's `writable` and `llmWritable` settings where they are declared, and the DevTool marks a resource read-only when `writable` is `false` (FIX-1481).
- 9062055: The DevTool's flow navigator is now the `FlowNavigator` component from `@flow-state-dev/react`, which the package takes as a new dependency: flows are grouped by kind with their copies underneath, and a session list is read only when you open a single flow instance (FIX-1477).
- 802c053: The DevTool's Tasks tab now shows the note a task carries about itself in a `Reason` column, so a row parked for review says why without opening its JSON expander (FIX-1481).
- Updated dependencies [b597600]
- Updated dependencies [795b550]
- Updated dependencies [6b8bfe4]
- Updated dependencies [4833ff8]
- Updated dependencies [9062055]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [0056b97]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
  - @flow-state-dev/core@0.2.0
  - @flow-state-dev/client@0.2.0
  - @flow-state-dev/react@0.2.0

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/client@0.1.2
  - @flow-state-dev/core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
  - @flow-state-dev/core@0.1.1
  - @flow-state-dev/client@0.1.1

## 0.1.0

### Minor Changes

- 4e562d0: The chat transport is removed (FIX-1330): `@flow-state-dev/chat-sdk` no longer exists, `chat` is no longer an option on `defineFlow`, `ChatConfig` / `ChatEventBinding` / `validateChatConfig` are gone from core, `"chat"` is no longer a `DispatchType` or a public re-entry source in the engine, and the DevTool no longer renders a Chat provenance badge. Conversational bots are driven through a caller-addressed action in `actions`; platform events ride the webhook transport.
- b3e6e22: Initial release (FIX-1187).
- fda9b15: Background work is declared with a task-board dispatcher seat and read back as child sessions: a session's children are listed at `GET /sessions/:sessionId/children` through `listChildSessions()` and `useSession`'s `childSessions` / `childSessionsStale`, session-scoped resources shared with them use `sharedToLineage`, and the two `createFlowState` options are `dispatchDrainTimeoutMs` and `maxChildSessionListLimit`; the Workstream surface they replace is removed, `ctx.requestHost.startDetached` and `dispatch: { mode: "detached" }` with it (FIX-1308). From `@flow-state-dev/orchestration/task-board` that removes the detached-mode helpers (`assertDetachedBoardSupported`, `detachedTaskPredicate`, `coordinateKey`, `coordinateLabel`, `workstreamRoutingSeed`, `WorkerCoordinate`, `TaskWorkerDispatch`, `TaskWorkerSlot`, `TaskWorkerSlotRegistry`, `TaskWorkerEntry`, `isTaskWorkerEntry`) and `board.detachedWorkers`; a seat is a block or a `dispatcher({ type: "task" })`, and `resolveWorkerSlots` now returns the bare blocks plus the `HandOffSeat`s (`name`, `label`, `dispatch`) in one walk from the hand-off module. A `{ worker, dispatch }` or `{ block, session }` seat is refused by name at construction. The DevTool's Children panel pairs a child with its task from the dispatch key a `per-task` or `per-worker` seat derives (a `{ key }` policy pairs nothing) and shows the entry it was dispatched for.

### Patch Changes

- 527c5ca: The DevTool now identifies flows by instance rather than by kind, so two registered copies of one flow each show their own sessions, requests and controls instead of one copy's work appearing under the other (FIX-1324).
- 229da65: Task status `awaiting_review` is now `parked` (FIX-1245).

  `parked` is the word the docs and the task board already use for a task waiting on a
  person, and it is now the value on the wire too. `TaskStatus`, the transition table, and
  every board and skill surface that names the status use it.

  Rows persisted under the old name keep working. A stored task still carrying
  `awaiting_review` reads back as `parked` on both paths a row can arrive by: through
  `taskSchema` where state is parsed, and at the collection read boundary where a task row
  is cast rather than parsed — which is the path the task board itself runs on. Nothing to
  migrate, and no dual-write window: new writes always store `parked`, and the first write
  to a legacy row heals it.

  **What to change in your code:** anything comparing a task's status to the string
  `awaiting_review`, or listing it in a status filter, should now use `parked`. The
  `awaitReview()` method that parks a task is unchanged.

  **Replaying an old trace still works.** `task-change` items and `task-board-meta` counts
  already written into a persisted item log keep the old status word — an item log is
  immutable, so nothing can rewrite them. The DevTool and the task-plan renderer map them
  forward as they fold the log, so an old parked row renders as parked and its count reaches
  the ribbon.

- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [2c4b0f5]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0
  - @flow-state-dev/client@0.1.0

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-04-11 — DevTool: `fsdev dev` + `@flow-state-dev/devtool` (FIX-261)

New package. Ships pre-built DevTool static assets and exports `getAssetPath()` so the CLI's `fsdev dev` command can serve them from a single port. The build pipeline builds the DevTool Vite app (`apps/devtool`) and copies the output into this package. The CLI lists `@flow-state-dev/devtool` as an optional peer dependency.

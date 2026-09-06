# @flow-state-dev/orchestration

## 0.1.0

### Minor Changes

- bea3a24: `resumeFromReview` is renamed `unpark` and now refuses every status but `parked` as a `declined` value instead of writing or throwing, and the task board gains `board.unparkAndDrain`, a step that writes an answer to a parked task and drains the board in the same request only when the answer was accepted (FIX-1244).
- b3e6e22: Initial release (FIX-1187).
- 5fa52aa: One dispatch protocol: every arrival at a flow — a caller's action, a chat event, a webhook, a schedule, a task hand-off, an internal dispatch — is a dispatch of one type delivered to one entry addressed by `(type, name)`, with no fallback between types (FIX-1302).

  - **`defineFlow` gains `internal` and `task` entries, nested under their type.** `internal: { actions: { wake: { block } } }` and `task: { actions: { implement: { block } } }` are declared like actions and are definition-only, like the transport maps; the flat `internal: { wake }` / `tasks: { implement }` spelling is refused by name. An `internal` entry is reachable only from a `dispatcher()` inside the flow; a `task` entry is reachable only from a `dispatcher({ type: "task" })` seat on a task board the flow reaches, and `defineFlow` puts each one behind that board's claim gate (the row re-read, the claim verified, the task scope marked, the ticket re-minted) before the block runs. A task entry no board addresses, a task dispatcher no board holds, and two boards addressing one entry are refused at definition. Every entry, of every type, accepts its own `concurrency` (`ActionCore.concurrency`).
  - **`dispatcher()` is the block that sends.** `dispatcher({ name, type: "internal", target, session: { key } | { id }, payload? })` (`InternalDispatcherConfig`) returns a handler carrying its static address, and `defineFlow` refuses an address the flow does not declare — through composition, rescue handlers, and a generator's static `tools`. `{ key }` derives a child session of the running one (minted, then adopted on the same key); `{ id }` delivers into an existing session of the same flow and principal, refuses an unknown id rather than creating one, and is dropped if that session was deleted and recreated between acceptance and the run. A refusal throws `DispatchRefusedError` naming the refusal (`no-entry`, `session-not-found`, `session-not-addressable`, `key-occupied`, `no-dispatch-operation`, `dispatch-rejected`, `external-dispatcher`).
  - **`.forEach()` and `.forEachSideChain()` accept `blocks`.** A per-item factory declares the blocks it can produce, so they are walked for dispatch addresses and merged for resources like a block-shaped call's element. A task board's drain uses it, which is what lets `defineFlow` refuse a flow that reaches a board with a hand-off seat but never declares the entry it addresses.
  - **A task board hands off through a dispatcher seat.** A seat under `workers` is a block; a `dispatcher({ name, type: "task", target, session: "per-task" | "per-worker" | { key: (task) => string } })` (`TaskDispatcherConfig`) in that position hands the seat's rows off to `flow.task.actions[target]` in the child session the policy names. A `task` dispatch carries `{ boardId, seat, taskId, attempt, createdAt, incarnationId?, payload }` (`taskDispatchInputSchema`, `TaskDispatchInput` from core), and the entry's gate re-reads the row and verifies the claim before the block runs. A refused hand-off throws the same `DispatchRefusedError` a `dispatcher()` block throws. An entry a `per-worker` or `key` seat hands off to defaults to `concurrency: "queue"` (an explicit policy wins); a `per-task` seat keeps the flow default. `board.handedOff` lists the seats that hand off; `createTaskGate`, `createHandOff`, `StaleTaskClaimError` and the `TaskSeatRegistry` type are exported from `@flow-state-dev/orchestration/task-board`. `TaskSessionPolicy`, `taskSessionKeyFor`, `bindTaskDispatcher` and `taskBindingOf` are exported from core for substrate code.
  - **A dispatched request is stamped.** It records `metadata.dispatch = { type, target, from, key?, ... }` under `source: "internal"` or `"task"`; the child session it runs in carries `topic` (the key) and `coordinate` (`"<type>:<target>"`) and is listed by `GET /sessions/:sessionId/children` like any other child of its parent.
  - **`task` and `internal` dispatches can never be re-entered** from a public route: retry, continue and resume refuse them, and `publicReentrySources` cannot re-open them.
  - **`createMockTransportHost` publishes `usesExternalDispatcher: false`**, matching the widened `InboundTransportHost` contract.
  - **The dispatch seam is not a named member of the block context** — reach it with `dispatcher()`, or in substrate code with `dispatchThroughSeam` and `markDispatcher`. The Workstream surface this protocol replaces is removed in the same release; see the Workstream-removal note for the renames.

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

- fda9b15: Background work is declared with a task-board dispatcher seat and read back as child sessions: a session's children are listed at `GET /sessions/:sessionId/children` through `listChildSessions()` and `useSession`'s `childSessions` / `childSessionsStale`, session-scoped resources shared with them use `sharedToLineage`, and the two `createFlowState` options are `dispatchDrainTimeoutMs` and `maxChildSessionListLimit`; the Workstream surface they replace is removed, `ctx.requestHost.startDetached` and `dispatch: { mode: "detached" }` with it (FIX-1308). From `@flow-state-dev/orchestration/task-board` that removes the detached-mode helpers (`assertDetachedBoardSupported`, `detachedTaskPredicate`, `coordinateKey`, `coordinateLabel`, `workstreamRoutingSeed`, `WorkerCoordinate`, `TaskWorkerDispatch`, `TaskWorkerSlot`, `TaskWorkerSlotRegistry`, `TaskWorkerEntry`, `isTaskWorkerEntry`) and `board.detachedWorkers`; a seat is a block or a `dispatcher({ type: "task" })`, and `resolveWorkerSlots` now returns the bare blocks plus the `HandOffSeat`s (`name`, `label`, `dispatch`) in one walk from the hand-off module. A `{ worker, dispatch }` or `{ block, session }` seat is refused by name at construction. The DevTool's Children panel pairs a child with its task from the dispatch key a `per-task` or `per-worker` seat derives (a `{ key }` policy pairs nothing) and shows the entry it was dispatched for.

### Patch Changes

- b484d86: Task Board workers that declare `taskWorkerInputSchema` now receive the `priorWork` the board's flow policy selected instead of having it stripped by the schema (FIX-1288).
- 0443742: A task handed to a child session now takes its row back and runs when the child starts after the lease has lapsed, instead of refusing the dispatch and waiting for another drain to spend an attempt re-dispatching it (FIX-1305) — `renewLease` gains `adoptLapsedLease` for that takeover, tasks record the lease duration their claim was granted as `leaseDurationMs`, and `committedLeaseSpan(task)` reads it back.
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-13 — Skills declare a pattern (FIX-450)

New `taskTools` capability exposes `addTask`, `assignTask`, `completeTask`, `failTask`, `blockTask`, `cancelTask`, `updateTask`, `listTasks` for runtime mutation of the active pattern's board. Composes by default when `patternRegistry` is wired; opt out with `taskTools: false`. With no active pattern each tool returns a structured `no_active_pattern` error.

### 2026-04-30 — SSE noise reduction (FIX-477)

`taskBoard` worker schemas now mark `lastClaimed` and `currentTaskId` as `transientSlot` so claim-loop bookkeeping never appears on the wire or in checkpoints.

### 2026-04-30 — Sub-agent items as first-class data (FIX-480)

`TaskCollectionRef.list` / `get` now return a `TaskHandle` — the existing `Task` data fields plus an `items()` accessor returning the items emitted during the worker's claim window. Substrate utilities `extractTaskItems(items, collectionId, taskId)` and `computeTaskItemWindows(items, collectionId)` are exported.

### 2026-04-30 — `taskBoard` follow-up (FIX-447)

`TaskWorkerInput.deps` is now substrate-supplied. The worker dispatch path resolves each `task.deps[]` entry to its dep's `output` and passes the map to the worker before invocation. Substrate-internal task-board blocks (`claimTask`, `checkBoard`, `recordSuccess`, `recordError`, `seedCollection`, board-meta emitters) marked `transient: true`. `claimTask` skips its `lastClaimed` state patch when the value is unchanged. `claimTask` emits `Working on: {task.goal}` status on each successful claim.

### 2026-04-29 — Patterns migrated onto `taskBoard` (FIX-447)

Substrate emits `task-change` (per-task lifecycle) and `task-board-meta` (board-level aggregate) items.

### 2026-04-29 — `@flow-state-dev/tasks` substrate (FIX-444)

New package. Ships the unified Plan/Task primitive substrate. Canonical `Task` shape with status enum `pending | in_progress | blocked | awaiting_review | completed | errored | cancelled` and a `TaskCollectionRef` API across two backings: `sequencer` (default, durable) and `resource` (for collections that outlive a request). Five standard dispatchers, a `TaskWorkerInput` worker contract, `task_change` item emissions, helpers (`taskLoopBack`, `dispatchAndExecute`). HITL-ready (review lifecycle, `awaitReview` / `resumeFromReview`).

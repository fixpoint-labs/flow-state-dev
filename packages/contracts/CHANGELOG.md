# @flow-state-dev/contracts

## 0.5.0

### Minor Changes

- da9484b: `isUserSuspension` and `suspendForUserKindOf` read a stop core 0.2.0 stored under `human_approval` or `human_input` as a user's approval or input, so a stop waiting in your store when you upgrade is answered as a user's stop again. A new use of either reason is refused where it is written, naming `user_approval` or `user_input` (FIX-2454).

  Docs: apps/docs/docs/advanced/durable-execution.md (one line beside the reasons: a stored `human_*` stop reads as a user's; a new one throws)

### Patch Changes

- 3ef3979: **Breaking:** the client's root carries only what an app reads (FIX-2449). `ExecuteActionRequestBody` and `QueryValue`, which nothing outside the client reads, are no longer exported, and `clientPackageMarker` is removed, with no deprecated aliases. `ChildSessionStatus` and `ChildSessionSummary` are unchanged, now declared once in contracts (`@flow-state-dev/contracts/types/child-session`) and re-exported. `CollectionItemHandle` stays on the root: React's collection hooks return it.

  Docs: packages/client/README.md (add `CollectionItemHandle`: the item `useResourceCollectionList` and the collection hooks return, `{ topic, clientData, fetchContent() }`)

## 0.4.0

### Minor Changes

- bc65135: A live view hears other sessions' changes to the user and org state and the resources it reads (FIX-1506).

  - **engine:** a session, user or org state write, and a write to a resource a client can read, publishes a `state` or `resource` notice on its scope's topic once it lands, from any run, with or without a stream, naming the request that made it. The resource routes publish the session's topic too.
  - **react:** `useSession(id, { live: true })` subscribes its session, user and org topics: a state notice reads state again without the item history, a resource notice makes the resource hooks read again, and a notice from the view's own request is skipped. `Roster` and `BoardColumns` take `live` and read their collection again on another session's change to it.
  - **contracts:** `ChangeKind` gains `"state"` and `"resource"`; a `switch` over it that lists every kind needs the two new cases. `getPatternPrefix` is exported from `@flow-state-dev/contracts/helpers` (still re-exported from `@flow-state-dev/core/types`).

- 844a4f9: Screens can read again when something they show changes, without polling on the Node host (FIX-2428).

  - **client:** `fsd.subscribe(topics, { onChange, pollIntervalMs? })` calls `onChange` with the notice that woke it (`{ topic, kind, origin? }`), or `null` for a connect, a reconnect or a timer tick. Build topics with `topic.session(id)`, `topic.user()` and `topic.org()`, now exported from the client too. On a host with push, one WebSocket per client carries the notices, signed in through the client's fetcher; elsewhere `onChange(null)` runs every `pollIntervalMs`. `FlowCapabilities` gains `push`. **Breaking:** `fsd.stream()` is removed. It never worked (the server answered 501); use `fsd.subscribe()`. `UserStreamOptions`, `UserSSECallbacks` and `UserStreamHandle` are removed with it. Migration: replace `fsd.stream({ onResourceChanged, onScopeStateChanged, ... })` with `fsd.subscribe([topic.user(), topic.org()], { onChange: () => reread() })`, and read what you show in `onChange`. A notice carries no rows, so the read is what tells you what changed.
  - **react:** `useSubscription(topics, read, { pollIntervalMs?, enabled? })` runs a screen's read again on a change, one read in flight and one waiting.
  - **node:** `serve()` serves the change-notice WebSocket at `<basePath>/users/:userId/stream`. New options: `push` (default `true`) and `pushSecret` (default `FSD_PUSH_SECRET`, then a random key), which every process behind one address must share.
  - **engine:** `GET /capabilities` answers `{ userStream: false, push }`. `POST /users/:userId/stream` checks each topic with its scope's read check and answers a short ticket for the granted ones; a refused topic is left out, as a missing session is. `GET /users/:userId/stream` answers 426 instead of 501. `enablePushDelivery(router, { secret? })` turns push on for a host that serves the socket.
  - **contracts / core:** the push wire types (`PushCapability`, `PushMintAnswer`, `PushServerFrame`, `PushClientFrame`, `WireNotice`). **Breaking:** the user-stream event types `UserStreamEvent`, `UserEventBase`, `UserResourceChangedEvent`, `ResourceContentUpdatedEvent`, `ResourceContentCreatedEvent`, `ResourceContentDeletedEvent`, `ScopeStateChangedEvent`, `UserDebugEvent` and `UserPingEvent` are removed; `StreamEvent` is `RequestStreamEvent`.

### Patch Changes

- 531bf32: A task board's change reaches every open view of the board, from whichever session or process settles the task (FIX-2429).

  - **orchestration:** every change to a board built by `getOrCreateTaskCollection` also publishes a `board` change notice on the topic of the session that filed the row (`Task.filer`, else the ledger's legacy filer, else the running session), narrowed to the board's `collectionId`. A screen subscribes `topic.session(conversationId, { resource: "tasks" })` and reads again. Nothing to wire: the `task-change` item is unchanged. The board's `listTasks` action (a client's read, not the model's tool) also answers each row's `updatedAt`, so a client holding a row from two sources keeps the newer.
  - **engine:** the block context carries the seam that publishes a board notice on the running request's bus, under its tenant, with the request as `origin`.
  - **react:** **Breaking for a hand-built client slice:** a live `BoardList`'s `client` takes `subscribe` in place of `sessions.stream`. A client from `createClient` works as before. The list now hears a task that settles in another session or process, never wakes on a reply streaming in the session, and reads every 3 s where push can miss a change. `useSubscription` takes `client`, for an app that builds its own client, and hands `read` an `AbortSignal` that aborts when the subscription ends.
  - **core / contracts:** `ChangeKind` gains `"board"`; `publishBoardChange` and `BOARD_NOTICE_SEAM` (framework-facing) in `@flow-state-dev/core/types`.
  - **shift-manager:** the conversation's task panel and task cards read on board notices; they keep their 3 s timer only while a task is open, and only where push can miss a change.

- 5f569fd: A task's session tells what a person said from what the task was handed (FIX-2574, FIX-2575).

  - **core / engine:** an action's `userMessage` can return `{ text, metadata }`. The echo is still the request's `user` line, and it carries `metadata` for a client to read. A plain string works as before.
  - **orchestration:** a steer from a person (sent from a screen, or a coding review's request for changes) now shows in the task's session as a `user` line with their words alone, not as an assistant line reading "Message from the user: …". A filer's or the board's steer reads as before. **Breaking:** `showTakenSteers` is now async; await it.
  - **workforce:** a task request's opening `user` line (the task as filed, or re-queued with its steers) is marked as the task's brief. Read it with `taskBriefOf(item)` from `@flow-state-dev/workforce/browser` to draw it as a brief, not as the person's line.

## 0.3.0

### Minor Changes

- e0daf6e: Stores profiles take a `bus` slot: a change bus that carries notices that something under a session, user or org changed (`ChangeBus`, `ChangeNotice`, `BusTopic`, `createInMemoryBus`). Every request and session write publishes on its session's topic, through `withChangeBus`, which `resolveStores`, `createFlowState`, `runAction`, BullMQ's job processor and `fsdev run` / `chat` apply. The session stream (`GET /sessions/:id/stream`) now reads when a notice wakes it, at most once a second; on a bus that crosses processes it reads nothing while the session is idle. The in-memory bus, the default and the only one that ships today, keeps the once-a-second read as well, so nothing changes for a deployment that sets no `bus`. A `bus` adapter declares `"bus"` in its capabilities and resolves `{ bus }`. `@flow-state-dev/contracts` (re-exported by core) adds `ChangeKind` and the wire topic constructors `topic.session(id)`, `topic.user()` and `topic.org()` (FIX-2426).

### Patch Changes

- 387bee2: A durable sequencer saves its state at a suspension, and restores it before the resumed step runs. A `patchState` a step makes before `ctx.suspend()` or `ctx.suspendForUser()` is now kept across a restart, and the re-run of that step reads it. Sequencer-state writes the step made before the pause (including `incState` and `pushState`) apply once: when the re-run reaches the pause, the sequencer's state is set back to what was saved there, and writes after it apply as usual. A request that was already parked before this change resumes as it did before (FIX-2444).
- 6c4a3b3: A conversation's line about a task now says which task it is, as data, so an app reads it without parsing the words (FIX-2378).

  - `ctx.emit.message(text, { metadata })` attaches `metadata` to the message item. Clients read it; the model never sees it. `EmitMessageOptions` is exported from core.
  - Orchestration adds `noticeMetadata(notice, task)` and `parseNotice(item)` beside `noticeText`. `parseNotice` returns the task, its ending, title and what came back, and still reads lines stored before this from their words.
  - Workforce marks every task line it emits, and a delegate's answer carries the worker and the task it answered. Read it with `delegateAnswerOf(item)`, from the root or `./browser`.

## 0.2.0

### Minor Changes

- 24afa6e: A question is one kind of task hold (FIX-2317, FIX-2131, FIX-2133). The two ways to stop for the user are named for what stops, and a task's open stops live in one list.

  - **`suspendForUser`** (new) suspends the request and resumes it with the answer: `ctx.suspendForUser({ kind, prompt, deadline? })` in `core`, `suspendForUserOn`, `createSuspendForUserTool`, `SuspendForUser`, `SuspendForUserOptions`, `SuspendForUserContext`, `SuspendForUserCancelled`, and `SuspendForUserKind` / `suspendForUserKindOf` (`contracts`, re-exported by `core`). `kind` is `"approval"`, `"review"` or `"input"`.
  - **`holdTaskForUser({ question })`** holds the task until the user answers, built with `createHoldTaskForUser`. The turn ends; the next turn on the same attempt spends no retry.
  - **`Task.holds`** lists what stops the task being claimed until the user answers. There is no `kind` field on a hold: an entry is told apart by `source.kind` (`"row"` or `"suspension"`) and `ask.kind` (`question`, `confirm`, `approval`, `review`, `input`). `getTask`, `listTasks` and Inbox items list `holds`.

  `createTask({ questions })` files a task that stays `pending` until each question is answered: a plain string is a question, `{ kind: "confirm", prompt, onNo? }` asks for a yes or a no. Answer with `updateTask({ id, answers, message })`. The Inbox client's `answerOne` takes `questionId`. A deadline applies only when the host sets `userDeadlineMs`.

  **Breaking, from the last publish.** The `parked` status is gone, with `counts.parked`, `TaskCollectionRef.awaitReview` / `unpark`, `board.unparkAndDrain`, a board's `onReview`, and `@flow-state-dev/react`'s `BOARD_STATUS_COLUMNS` `parked` column. Ask for a review with `ctx.suspendForUser({ kind: "review", prompt })`. The filer's hold is unchanged: status `held`, `hold()`, `release()`. `keptOpenBy: "suspended"` means the task's own request is suspended. Stores are reset: a stored `parked` row is not read. Also removed with `parked`: `TaskTransitionOptions.refuseWhenParked`, `CheckBoardOptions.excuseParked`, the `"parked-for-review"` termination reason, the `"review_requested"` change kind, the `"parked"` write-decline reason, `unparkAndDrainInputSchema` / `UnparkAndDrainInput`, and the task-board exports `TaskBoardOnReview` and `assertParkExitSupported`. React no longer maps a legacy `awaiting_review` card status. `TaskClaimTicket.turn` is required: every claim advances the row's `turn`, and a ticket from an earlier turn of the same attempt is declined `lost-claim`.

  A row stored with `questions` still reads as `holds` (`withRetiredShapes` from `@flow-state-dev/orchestration/tasks`). Shift Manager and the DevTool read them as holds.

- 617aeab: `MANIFEST_DOMAINS` no longer lists `channels` (FIX-1792): discovery's domains are `workers`, `skills` and `resources`. `channels` and `seats` are unknown domains.
- 211679a: New core block kind: `evaluator` (FIX-1554). It asks an evaluation model typed questions (`choice`, `score`, `boolean`) and returns typed answers, with the model's confidence when it reports one. Model strings resolve through your existing providers and gateways; models that can only generate are refused before any call. `BlockKind` and the trace's `blockKind` gain `"evaluator"`: code that switches on block kind should handle it. `ai` minimum raised to the first release with evaluation. `@ai-sdk/typesafe-ai` is an optional peer. `ModelResolver` gains an optional `resolveEvaluationModel`; a custom resolver without it runs generators as before and refuses evaluator model strings. Evaluation through Vercel's AI Gateway needs `@ai-sdk/gateway` 4.0.85 or later. `@flow-state-dev/testing` adds `mockEvaluationModel`.
- 839e915: A block output or tool result over the new `maxRecordedValueBytes` router option (default 256 KiB) is now recorded as an `omitted` placeholder with its size and a preview while the run keeps the full value, and a resumed request that would need it fails with `RECORDED_VALUE_OMITTED` (FIX-1772).
- d1a4cab: The discovery domain `seats` is `workers`: `discover({ domain: "workers" })` lists what `seats` did, and `seats` is an unknown domain (FIX-1796).
- cd180d7: Stopping a paused request now ends it `aborted` and records its gate with the new `stopped` suspension status, a turn paused on an ask cancels the asked task instead of waiting for it, and a durable host now runs the durability sweeper even without `durabilityRetention`, so a paused request past its `expiresAt` expires and an ask past its deadline times out, while pruning still waits for a retention policy (FIX-1816).
- d97031f: The suspension reasons that wait for a user are now `"user_approval"` and `"user_input"`, renamed from `"human_approval"` and `"human_input"`. Nothing reads the old values: `SuspensionReason` still accepts any string, so a `ctx.suspend` or a `useSuspensions({ reasons })` filter that still passes an old value compiles but is treated as a custom reason: it is not a user's stop, gets no Inbox item, and an old `"human_input"` stop defaults to approve/reject instead of submit. Search your code for both old strings and replace them. Stored suspensions with the old reasons are not migrated (FIX-2151).
- 49d2aca: A stop that waits for a user holds its task and ends exactly once (FIX-2129).

  - **`ctx.suspendForUser({ kind, prompt, deadline? })`** (`core`): stop the request for an `approval`, a `review` or an `input`. It returns the answer, or `{ cancelled: true }` when the task was cancelled while it waited. At its deadline an approval reads as a no (`deadline: true`) and a review or an input throws `SuspensionTimeoutError`, which the block may catch. With no `deadline`, the host's `userDeadlineMs` applies, else none: the stop waits until it is answered, stopped or cancelled. The model's tool is `suspendForUser`; the task's open stop is listed on `Task.holds`.
  - **The answer route** (`engine`): `POST /api/flows/:flowKind/requests/:requestId/answer` answers a user's stop in any run, a task board's included, after the resume path's ownership checks; a request handle's `answer` (`client`) calls it. Who answered is the signed-in caller.
  - **`userDeadlineMs`** (`createFlowState`, `engine`): the host's deadline for a user's stop, unset by default.
  - **Cancel one stop:** `RequestHost.resumeWait({ suspension: { requestId, suspensionId }, outcome: { cancelled: true } })`.
  - `contracts` exports `isUserSuspension` and `suspendForUserKindOf`, and `SuspensionStatus` gains `"cancelled"`.

  A raw `ctx.suspend` with `user_approval` or `user_input` now gets the same mark, cancel and stop as `suspendForUser`. A raw `user_input` stop past its `timeoutMs` now resumes its block with `SuspensionTimeoutError` instead of staying parked, and a cancelled one throws `SuspensionRejectedError` with `cancelled: true`. A filing by a cancelled task is refused (`TaskFilingRefusedError`, rule `parent_cancelled`). Shift Manager answers every ask through the answer route.

### Patch Changes

- f8df86f: A flow's request and action observers (`request.onStarted`, `request.onFinished`, `onCompleted`, `onErrored`) now run on their own block path, `observer[<owner>.<hook>]`, instead of the action block's `root`. Before, an observer's trace on the root's id read as the action block running twice, and a session read (or a reload) dropped the messages the action block emitted: with `request.onStarted` under lean traces (production's default), and with `request.onFinished` in both trace modes (FIX-2299). `blockPathObserver(hook)` is exported beside the other block path helpers.
- 65ad58a: A resumed request now hands the next step the real result of an earlier `.asTool()` step, because a recorded value that points at a tool result resolves to that result instead of `undefined` (FIX-1847).
- 3b0161c: With a durability provider configured, a request resumed after a stop, or continued through `/continue`, no longer runs its completed steps again when trace observability is off, as it is by default in production. Without a durability provider, `/continue` behaves as it did before: it skips a completed step only from a full trace, so a request recorded with observability off runs again from the top. The lean record is marked `lean: true`. Each completed block now records a lean `block_trace` (its identity and output) whatever the observability setting, and resume replay reads that record to skip the block. Full capture (inputs, generator prompts, resource loads, failed traces) is still gated by `FSDEV_TRACE_OBSERVABILITY`. With observability off, a request's item log now holds one `block_trace` per completed, non-transient block. An output larger than the recorded-value limit is stored as an omitted placeholder, so a resume that reaches that step fails with `RECORDED_VALUE_OMITTED`, naming the block, rather than skipping it or running it again. With a durability provider, crash recovery (`/continue`) is at-least-once for a block whose completion had not been persisted when the process died: that block runs again. A completed `block_trace` now carries `rescued: true` when a `.rescue()` handler produced the block's output, so `ctx.wasRescued()` returns the same answer after a resume (FIX-2137).
- fa7b22e: A tool call that waited on an approval no longer reads as failed. A later turn's history replays it once, with its result; before, it also replayed the wait as a failed call carrying the approval's question, so the model read it as a failure it had retried. `isSuspensionWait(item)` (from `@flow-state-dev/contracts/items`, re-exported by `@flow-state-dev/core/items`) tells such a wait from a real failure, and the registry's tool card draws it as awaiting approval. Shift Manager draws a waiting call as waiting, and a conversation redraws once its ask is answered on the page, again when the run it resumed stops (FIX-1901).
- 60c8192: `getItems()`, `RequestRecord.items` and item subscriptions return `RuntimeItem`, which is `OutputItem` plus trace rows: `block_trace`, `router_decision`, `state_snapshot` and `generator_step` (FIX-2054). Only types change. Runtime behaviour is the same.

  These signatures return or pass `RuntimeItem`, which can break code that expects `OutputItem`:

  - `ResponseEmitterHandle.getItems()` and the `subscribeToItems` listener and filter (core).
  - `ResponseEmitter.getItems()`, `RequestRecord.items` and `RequestStore.persistItems` (engine).
  - The `testItems` selectors that don't filter by type: `all()`, `sideChain()`, `main()`, `byAgent()` and `byVisibility()` (testing). They return trace rows when given them.

  To upgrade, type arrays and callbacks that receive these values as `RuntimeItem`, imported from `@flow-state-dev/core`. Where code needs an `OutputItem`, filter out the trace rows with a type guard:

  ```ts
  import type { RuntimeItem } from "@flow-state-dev/core";
  import type { OutputItem } from "@flow-state-dev/core/items";

  const TRACE = new Set([
    "block_trace",
    "router_decision",
    "state_snapshot",
    "generator_step",
  ]);
  const isOutputItem = (item: RuntimeItem): item is OutputItem =>
    !TRACE.has(item.type);

  const visible = emitter.getItems().filter(isOutputItem);
  ```

  `.waitForCondition` predicates and `wakeOn` filters keep their `OutputItem` types. These signatures accept `RuntimeItem` as well as `OutputItem`: `resolveItemVisibility` and `collapseToCanonicalLog` (contracts, re-exported by core), `testItems` (testing), and the filter that `onTaskChangeFor` returns (orchestration). Existing callers need no change.

  `RequestStreamStore` and `createRequestStreamStore` (client) take the row type as a parameter, defaulting to `OutputItem`, so existing stores are unchanged. A store seeded with trace rows is created as `createRequestStreamStore<RuntimeItem>()`, and its `getSorted()`, `getRaw()`, `getById()` and `getOwnedBy()` return `RuntimeItem`.

- b7c523b: Add the session stream's event types: `SessionItemEvent`, `SessionRunsChangedEvent`, `SessionPingEvent`, their union `SessionStreamEvent`, and `SessionRun` (FIX-1609).

  Add `compareItemOrder`, the one order items are shown in: `ts`, then `itemIndex`, then `requestId`, then `id`. The session snapshot and a client merging streamed items both sort with it.

- a021cd1: `@flow-state-dev/contracts/helpers` (and `@flow-state-dev/core/helpers`) now export the resource-state version rule every `ResourceStateStore` adapter uses: `assertSetExpectedVersion`, `assertDeleteExpectedVersion` and `resourceStateConflict`, with the `ExpectedVersion`, `VersionedRow` and `VersionConflict` types. A custom store adapter can import them instead of copying the rule. `cloneValue` is now also exported from `@flow-state-dev/contracts/helpers`; its `@flow-state-dev/core/helpers` export is unchanged. No store's behaviour changes (FIX-1277).
- e11764a: `ctx.suspend()` takes an optional `title`, a short heading for the ask, carried onto the suspension record and the `suspension` item; `message` is then the body under it. The Error Reporter's preview now sends a short title with its count and questions as a markdown body (FIX-2030).
- 84cc226: New `isWindowsReservedName(name)` helper on `@flow-state-dev/contracts/helpers`, re-exported from `@flow-state-dev/core/helpers`: `true` for the names Windows reserves for devices (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`) in any letter case. The filesystem store and the workforce tree loader now both read this one list; which names they refuse, and the messages they give, are unchanged (FIX-1428).

## 0.1.2

### Patch Changes

- b597600: An agent can now ask what it can work with: `discoveryTools(createManifestRegistry([...]))` returns one `discover` tool that answers from whatever domains a scope registers a source for, and `resourcesManifestSource()` ships the resources domain. Two enumerators that ignored the `llmReadable` gate are closed with it — `resourceTools().listResources` is **removed** (it had no caller), and `globResources` now lists only resources the agent may read (FIX-817).
- e4c443e: A task board now reports when it saves a task's result and then cannot announce
  it, instead of finishing the run as though nothing went wrong. The failure lands
  on a persisted `task-board-recorder-failure` item and fails the run once every
  other task has drained; on a handed-off task it fails that child run. `onError`
  does not suppress it. Where the board cannot tell whether the write landed —
  permanently so on a task store you supplied, and on rows that predate write
  provenance — it says `undetermined` rather than assuming the write was lost, and
  hands the row back rather than leaving it claimed. `createRecordSuccess` and
  `createRecordError` composed outside a board raise the failure where it happens,
  since nothing downstream would read the report (FIX-963).

## 0.1.1

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

## 0.0.0

- Initial release. Extracts the item taxonomy, the deterministic
  block-instance-id helpers, and the pure leaf types (`ModelIdentity`,
  `SuspensionReason`, `SuspensionStatus`, `RequestStatus`) out of
  `@flow-state-dev/core` into a zero-dependency shared layer. `core`
  re-exports every moved symbol from its original path, so the move is
  non-breaking for existing consumers.

# @flow-state-dev/engine

## 0.3.1

### Patch Changes

- 9a355b2: `@flow-state-dev/react` exports `useInterruptKeys`, `createInterruptKeys` and `interruptChordLabel`, a keyboard stop for long-running work. One Esc never stops anything. A second Esc within 1.5 s does, and so does Cmd/Ctrl+. at once. An Esc typed in a text field, or one already used to close a dialog, never counts (FIX-2413).

  `@flow-state-dev/engine`: the request status route's `completedAtMs` is now set for aborted and failed requests, from the time they stopped. It was set only for requests that completed. A replayed or resumed stream's terminal event for an aborted request is now dated when the request was aborted, not when its record was last written.

  `@flow-state-dev/shift-manager`: one Esc on a task no longer interrupts its run. Press Esc twice or Cmd/Ctrl+. instead. Esc in the composer is the composer's. An interrupted run now says when it stopped.

- 387bee2: A durable sequencer saves its state at a suspension, and restores it before the resumed step runs. A `patchState` a step makes before `ctx.suspend()` or `ctx.suspendForUser()` is now kept across a restart, and the re-run of that step reads it. Sequencer-state writes the step made before the pause (including `incState` and `pushState`) apply once: when the re-run reaches the pause, the sequencer's state is set back to what was saved there, and writes after it apply as usual. A request that was already parked before this change resumes as it did before (FIX-2444).
- Updated dependencies [824ce87]
- Updated dependencies [387bee2]
  - @flow-state-dev/core@0.4.0

## 0.3.0

### Minor Changes

- 92b2b70: A conversation longer than its history window can keep what it said before the window (FIX-1613). `utility.historySummary({ summarize })` returns a `capability` for the generator that answers and a `fold` step to run before it: the fold writes the turns about to leave the window into a running summary, the capability hands that summary to the model and starts the generator's history after it. A capability preset may now declare `history` (a query added to that generator's history reads; generators only). The engine records `historyStart` on a request when earlier turns are out of view, exposes `ctx.session.window`, `ctx.session.items.turns()` and `history({ afterRequestId })`, and the client's request summary carries `historyStart`. Workforce's `defineAgentWorkerFlow` takes `beforeAnswer`, a block run before the worker answers.
- 5d31955: A flow can declare `reads`: blocks an app runs on a session to look at something the flow computes, stored nowhere. The engine serves them at `POST /:flowKind/:sessionId/reads/:readName`, answering `200 { output }` with no request record and no concurrency slot; any write a read's block tries is refused with `read_only`, and another user's session answers 404 as the action route does. The client calls one with `flow(kind).read(name, input, { sessionId })`. Orchestration adds `taskToolReads(collectionId, resolve)`, the `listTasks_<suffix>` listing as a read, and Workforce's coordinator and agent-worker flows now serve `listTasks_tasks` as a read, so an app polling a conversation's task board no longer stores a request per poll. The action of the same name is unchanged (FIX-2286).
- e2c190e: A running coding turn can take a message mid-turn (FIX-2254). Core declares the optional harness hook `onSteerable(steer | null, ctx)` (`HarnessSteer`, `HarnessSteerHook`): a harness whose run can take a line calls it with a `steer` that answers `"delivered"` or `"refused"`, and with `null` when the turn is over. `cursorAgent({ onSteerable })` offers Cursor's own run steering on local runs, through the `env` process too. The harness manager hands down `onSteerable` as an optional fifth feed; passed through, a message sent to the task while a step runs goes straight into that step, with no stop, extra step or new attempt. A line the run refuses is taken by the next step, as before.

  `autoResume: false` on an action (core's `ActionCore`, honoured by the engine) keeps a request on it from becoming its session's auto-resume target (`latestRequestId`), so a control sent beside a running request, such as that line, doesn't stop a reloading client from reattaching to the running one.

  Any app can steer a harness turn run in a session: `harnessSteering()` in core keeps each session's offer and builds the `steer` action (`{ taken, live }`), and the client's `sendHarnessLine` and `steerRunningTurn` send a typed line into the running turn, falling back to the next turn when it isn't taken.

- 283fb2a: Cancelling a request now only ever cancels the request whose owner was checked, and `RequestStore.setFieldsIfStatus`'s fifth argument is now that request's expected incarnation, which custom stores must honor (FIX-1654).
- 9f06d39: On a `bullmqWorker` deployment, a declared `queue` or `reject` concurrency policy is now enforced across every web and worker process, for every run: two `queue` runs into one session run one after the other in the order they were accepted, and a `reject` duplicate is refused. If you declared `queue` or `reject` on a BullMQ app and relied on it being ignored there, declare `concurrency: "allow"` on those entries to keep running in parallel. Upgrade workers before the processes that enqueue: a new job taken by an old worker runs once without the policy, and its session can wait up to `leaseMs` (10 seconds by default) before the next run starts.

  A `dispatcher()` delivery into an existing session (`session: { id }`) is accepted on BullMQ and runs under the recipient's policy, where it was refused `external-dispatcher`. A waiting job gives its worker slot back and requeues itself without using an attempt. The lease backend lives on the same Redis (`createRedisLeaseBackend`, new option `leaseMs`). A worker that can't renew the place its running job holds aborts the run's signal at half the lease, and the request ends `interrupted`; a run that honours the signal has ended before another can take the session.

  For custom lease backends, `isMyTurn` may answer `"missing"` (the waiter is re-admitted at the back of the line), `renew` may answer `false` (a running holder is stopped), and a backend may declare `leaseMs`. The engine exports `holdLeasePlace`, `settleUnstartedRequest` and `ConcurrencyLeaseLostError` for adapter workers (FIX-1634).

- 2ffc03c: "Dispatcher" now names only the `dispatcher()` block (FIX-2245). Two other things that shared the word are renamed, with no alias.

  - A task board's rule for which ready task it claims next is a claim order. `TaskDispatcher` is `ClaimOrder`; `fifoDispatcher`, `topologicalDispatcher` and `priorityDispatcher` are `fifoClaimOrder`, `topologicalClaimOrder` and `priorityClaimOrder`; harness-manager's `runOwnerDispatcher()` is `runOwnerClaimOrder()`. The task board's option is `claimOrder` (it was `dispatcher`, which it now refuses by name), and takes the same `"fifo"`, `"topological"` and `"priority"` names.
  - What decides where a flow action runs is a runner. `FlowDispatcher` is `FlowRunner`, `InProcessDispatcher` and `InProcessDispatcherDeps` are `InProcessRunner` and `InProcessRunnerDeps`, `createInProcessDispatcher` and `isInProcessDispatcher` are `createInProcessRunner` and `isInProcessRunner`, and BullMQ's `createWorkerDispatcher` and `CreateWorkerDispatcherOptions` are `createWorkerRunner` and `CreateWorkerRunnerOptions`. The option on `createFlowState`, `createFlowApiRouter` and `createInboundTransportHost` is `runner` (it was `dispatcher`, which they now refuse by name), `WorkerAdapter.createDispatcher` is `createRunner`, and `InboundTransportHost.usesExternalDispatcher` is `usesExternalRunner`.

  The `external-dispatcher` refusal keeps its value.

- b75c1ed: `fsdev run` and `fsdev chat` now run as whoever the app's resolver names (new `FlowState.resolveInProcessPrincipal`, with `source: "cli"` reserved for it), stop with exit 2 before writing anything when that resolver or a seat's pin refuses the terminal (a `--session` owned by another user or organization now also exits 2 instead of 1), and take `--org`/`--user` to name the identity locally (FIX-1551).
- 62133c4: Add the `hold` and `defer` concurrency policies. A `hold` request runs at once and marks its key busy while it runs; it never waits and is never refused. A `defer` request waits until nothing on its key is running or waiting, then runs, so follow-up work for a conversation lands after the current reply instead of beside it. Deferred requests run one at a time, and the wait ends when the request ahead settles, or when a crashed process's place on a shared lease backend expires. At most 32 deferred requests wait on a key per process; the next is refused with the new `ConcurrencyDeferLimitError` (a `ConcurrencyRejectedError`). A deferred request yields to newer `hold` requests for 30 seconds, then waits only for the ones it found. Both policies apply to in-process runs; a run handed to an external dispatcher under either runs as `allow` (FIX-1834).
- 651c87e: On the in-memory backend a `reject` refusal from `host.dispatch` now arrives as `ConcurrencyRejectedError` through the returned handle's `accepted` and `finished` instead of a synchronous throw, so await `accepted` (or `finished`) rather than wrapping `dispatch` in try/catch to observe it, and a caller who does not own the session no longer briefly holds its concurrency key (FIX-1837).
- d5ce1e0: A worker can answer a question from another of the user's conversations without waking it (FIX-2173).

  - `requestHost.sessions.history(sessionId, { limit })` reads a session's finished turns, oldest first, with `asOf` and `running`. Like `sessions.read`, it answers only for the caller's own sessions; anything else reads as `undefined`.
  - `utility.consultSessionHistoryTool()` (core) reads that history under a hard token budget (default 24,000) and answers on one tool-less generator, `intent/utility` by default. It returns a reading as of a time, and writes nothing to the other session.
  - `consultSessionsCapability(installation)` (workforce) puts it on a worker's turns as `consultSessionHistory`, with `of` naming a worker, `{ task }` or `{ session }`. Its `consult` preset is off until a worker's `WORKER.md` names `consultSessions: [consult]`. Set `models: { default, intents: { utility: [...] } }` in `createFlowState` to pick the cheaper model.

- 85b2965: The debug endpoints no longer admit requests without an `Origin` header by default (FIX-1710). `debugAllowAnonymousLocal` now defaults to `false`; opt in with `debugAllowAnonymousLocal: true` on `createFlowApiRouter` or `createFlowState`, or set `FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL=1`, and only on a server bound to loopback. `fsdev dev` opts in for you, so the DevTool keeps working there. A self-hosted DevTool page that reads the debug endpoints from the same origin sends no `Origin` header, so it needs the opt-in.
- 6819520: A task board that starts a row on another worker now **dispatches** it; **hand-off** means only passing work that is already under way (FIX-1876).

  - The board's ending for "every remaining row is running in a dispatch run" is now `terminationReason: "dispatched"` (was `"handed-off"`).
  - The row-dispatch block's output is now `{ dispatched: true, taskId, sessionId, requestId, adopted }` (was `handedOff: true`).

  The old exports are gone, with no alias, so an import of one fails to compile and names it:

  - `@flow-state-dev/orchestration`: `createHandOff` → `createRowDispatch`, `HandOffOptions` → `RowDispatchOptions`, `HandOffAssignee` → `DispatchingAssignee`, `handedOffTaskPredicate` → `dispatchedTaskPredicate`, `assertHandOffBoardSupported` → `assertDispatchBoardSupported`, `assertHandOffBlockSupported` → `assertDispatchEntrySupported`, and the board handle's `handedOff` → `dispatchers`.
  - `@flow-state-dev/core` and `@flow-state-dev/engine`: no export changes. Definition-time and run-time refusals say a block "dispatches to task:…" where they said it "hands off to task:…".

  The task-board page's "Assignees that hand off" section is now "Assignees that dispatch"; the old anchor still lands on it.

- 099906a: Shutting a `FlowState` down against a real store no longer logs a spurious stale-request sweeper failure, and `StaleRequestSweeper.dispose()` now returns a promise that settles once any running sweep finishes (FIX-1516).
- ad5df6f: Durable execution is on by default wherever stores persist (FIX-2063). `createFlowState` over filesystem, SQLite or Postgres stores now installs the checkpoint durability provider without `durable: true`; over in-memory stores it still installs none unless `durable: true` is set. `resolveDurabilityProvider({ stores, durable })` exports the rule for hosts that build `createFlowApiRouter` or call `runAction` themselves, and the in-memory checkpoint and suspension stores declare `persists: false`.

  `ctx.suspend()` on a host without durable execution now throws an error that names the rule and the setting to change, instead of "requires a DurabilityProvider". The durability sweeper arms for a pending stop's deadline as it does for a wait's, and reads the store's deadlines once at start.

  A no-config `fsdev run` now writes to `.fsdev/data/fsdev.db` (the SQLite file `fsdev dev` reads) instead of JSON files under `.fsdev/data`, and runs as `devuser`, the DevTool's default user (exported as `DEFAULT_LOCAL_USER_ID` from `@flow-state-dev/core`), instead of `cli-user`. `fsdev run` and `fsdev chat` use `devuser` as the default user with a config too. A run that stops for a person exits 0 with a `suspended` NDJSON event, `result.suspended` in `--capture`, and a waiting report on stderr. The no-config `fsdev dev` router is durable and sweeps. `--store filesystem` on `fsdev run` and `fsdev dev` keeps the JSON-file store, single-process.

  **Migration.** An app on persisting stores that never set `durable` now:

  - writes a checkpoint at every step of every sequencer (sequencers already default to `durable: true`),
  - resumes a request that crashed instead of rerunning it,
  - holds a raw `ctx.suspend()` until it is answered, where it used to fail the request,
  - runs the durability sweeper wherever it serves a router: a lease and a scan of pending stops on each tick, even when nothing waits.

  Set `durable: false` on `createFlowState` to keep the old behavior. Sessions a no-config `fsdev run` wrote as JSON files are not read by the SQLite default; pass `--store filesystem` to read them. Scripts that look up CLI sessions by `cli-user` should use `devuser`, or pass `--user cli-user`.

- 5902deb: A dispatch that reaches a key-derived child session which already exists, asking for another value of one of its readonly session-state fields, is refused with `key-occupied`, naming the field, instead of adopting the session. Nothing is written and nothing runs there (FIX-1788).
- 2ce15c7: Wakes: a debt's due time the engine keeps, one per session and internal entry (FIX-2078). The durability sweeper fires each due wake's entry in its session, as the session's owner, and re-arms on the earliest one; a pass in that session moves or clears it. `StoreRegistry.wakes` (`WakeStore`) is optional: the in-memory, filesystem, SQLite and Postgres stores keep wakes, and a custom store without them still loads, with debts paid on their fast paths only (the host says so once at start). `createFlowState({ maxDebtAgeMs })` sets how long a debt may stay outstanding past its due time, 24 hours by default. A host's shutdown waits for the requests its wakes started, up to `createFlowApiRouter({ shutdownDrainMs })` (10 s by default; `disposeFlowApiRouter(router, { drainMs })` per call), then aborts the rest and logs how many: each wake stays, and the next host fires it again. `@flow-state-dev/node`'s `serve()` passes what is left of its shutdown grace, through the server app's `dispose({ drainMs })`. At start the host reads its wake store once: one it can't read (a database upgraded without the migration that adds the wakes table) is treated as keeping none, with a one-time warning. **A Postgres or SQLite host that runs its migrations itself (`skipSchemaInit`) reruns them after upgrading**, or its wakes stay off. Custom store adapters can check theirs with `createWakeStoreConformanceTests` from `@flow-state-dev/engine/testing`.
- 4f2e13e: `errorCapture` now also receives one `final: true` event, at `scope: "request"`, when a request settles failed: after rescues and retries, and only when its failed status was written. The per-block events are unchanged (FIX-1983).
- 211679a: New core block kind: `evaluator` (FIX-1554). It asks an evaluation model typed questions (`choice`, `score`, `boolean`) and returns typed answers, with the model's confidence when it reports one. Model strings resolve through your existing providers and gateways; models that can only generate are refused before any call. `BlockKind` and the trace's `blockKind` gain `"evaluator"`: code that switches on block kind should handle it. `ai` minimum raised to the first release with evaluation. `@ai-sdk/typesafe-ai` is an optional peer. `ModelResolver` gains an optional `resolveEvaluationModel`; a custom resolver without it runs generators as before and refuses evaluator model strings. Evaluation through Vercel's AI Gateway needs `@ai-sdk/gateway` 4.0.85 or later. `@flow-state-dev/testing` adds `mockEvaluationModel`.
- fe5df7d: A request waits on a task it filed with `getTask({ id, wait: true, deadline? })`, now or in a later request, and gets the task back once it ends or as it stands at the deadline (FIX-2082). The deadline cancels nothing: the task runs on, and an ending that lands while the request still runs reaches it on its next `getTask`; one it never reads goes to `onTaskSettled`, once. A task's own request may wait too, and waits nest up to five deep, counted live. A wait's deadline is a wake on the waiting session, so a restart keeps it. Use `waitOnTask(ctx, board, id, { key })` from `@flow-state-dev/orchestration/task-board` when the wait is in application code rather than a tool.

  - `dispatcher({ wait: true })` waits for the request it starts and outputs `{ status: "completed" | "failed" | "running", output?, error?, requestId }`.
  - On a plan board a row filed `session: "new"` runs in a session of its own through `taskBoard({ newSession })`, and the drain waits on it. A plan board may hold dispatchers, whose rows it waits on; a plan board's dispatcher with `wait: false`, and a delegation board's with `wait: true`, are refused. In Workforce, a worker's step filed `session: "new"` runs in a new session of the same worker.
  - `canHoldWait(ctx)`, `dispatchWaitResultSchema` and `DispatchWaitResult` are exported from `@flow-state-dev/core`; `RequestHost.waits.ended(requestIds)` says whether a request has stopped running its work, and `checkWait` (orchestration) runs a wait's checks alone.
  - Hosts set a wait's deadline bounds with `waitDeadlines: { defaultMs, minMs, maxMs }` (5 minutes, 1 s, 24 h by default). A wait needs a store that keeps wakes. `parkOnWait` takes a `deadline` (epoch ms) and returns the `WaitOutcome`.

- 7da156e: Organization ids are now validated as well-formed, non-blank Unicode everywhere (resolver, `runAction`, dispatch, BullMQ jobs, schedules, `fsdev run --org`) and seat addresses escape any such id, while route segments are decoded exactly once on every host (`parseFlowRoute` now takes decoded segments, built from a raw URL by the new `decodePathSegments`), so escaped seat ids resolve on Next and Vercel and stored rows or queued jobs with a lone-surrogate org id are now refused (FIX-1757).
- 712dc22: A hired seat now keeps what it saves for a person (shared user-scoped resources and user state) under one user-scope key per organization and person, `<userId>:~org:<orgId>`, so the same person's seat in another organization starts empty and no seat reads the person's app-wide data; data seats saved before upgrading is not read for them until you run the optional offline copy in the persistence docs under "Upgrading: moving hired seats' stored data" (FIX-1538).
- 3a6c910: New `GET /api/flows/users/:userId/interrupted-requests` lists a user's interrupted requests every time it is called, including ones a sweep marked before the call; `check-interrupted` still sweeps and answers only what that call marked. Both lists now name each request's `flowId` (falling back to `flowKind` for older records). `RequestStatusSnapshot` gains `sessionId`, and the status route now answers 404 for a request in another tenant or of another principal. New `createInProcessFetch(app, { basePath? })` returns a fetch-shaped function that dispatches to the engine in this process, for a client's `fetcher`; `@flow-state-dev/node`'s `createServerApp` dispatches through it (FIX-2162).
- 028af6f: **Breaking:** model strings now name a route with a colon, as in the AI SDK (`vercel:anthropic/claude-sonnet-5`, `openai:gpt-5.4`, or a `providers` key such as `triage:native`), multi-hop `gateway/provider/model` slash strings are rejected with an error naming their colon spelling, and `ParsedModelString` is now a discriminated union with no `"gateway"` kind (FIX-1495).
- 7d4c413: Resource collections can be declared owner-private with `ownerPrivate: { param }`, and `ownerSegment(userId)` builds the owner key segment. Key segments beginning `~` are reserved for owner-private collections in every app, and flow registration refuses a single resource whose key has one. `defineResourceCollection` and flow registration no longer refuse collection patterns on Workforce's account, and `@flow-state-dev/core` no longer exports `assertRosterCollectionIsNotDeep`. Workforce's private roster collection is now owner-private; its refusal messages name the owner-private collection instead of the roster (FIX-1549).
- a64132b: `InstancePinMismatchError.reason` is `"owning-user"` where it was `"roster-owner"` (FIX-1549).
- c6b2db9: `pushState` on sequencer and block state now throws, leaving the value intact, when the field holds something other than an array (`null` included), matching the existing refusal on store-backed scopes instead of replacing the value (FIX-1704).
- 839e915: A block output or tool result over the new `maxRecordedValueBytes` router option (default 256 KiB) is now recorded as an `omitted` placeholder with its size and a preview while the run keeps the full value, and a resumed request that would need it fails with `RECORDED_VALUE_OMITTED` (FIX-1772).
- 02ee032: Remove backward-compatibility paths (FIX-1804, FIX-850): stores read only the current on-disk and table layouts with no migration of older data, `@flow-state-dev/claude-code` drops its package-root entry and deprecated handle aliases, `@flow-state-dev/patterns` drops `legacyWorkerAdapter` and `executableTaskSchema`, and removed options such as `clientData`, `requireOrg`, `presets`, `preset/*` model strings, `prefer` and `fileFilter`/`syncMode` are no longer refused by name.
- e0f10e2: Deleting a request (including through session retention) now also removes its events and runOnce results once its run has finished, and custom `RequestStore`s must persist `finalizedAtMs`/`heartbeatsUntilFinalized`, honor `setFieldsIfStatus`'s new `expectedIncarnation` argument, and call `isStillAuthorized` in live tails (FIX-1647).
- 9510a03: Requests now carry `ctx.request.incarnation`, a token that stays the same across a request's retries and resumes and that request-scoped workspace keys and local `scope: "run"` bash directories now include, so a request reusing a deleted request's id starts empty; existing run workspaces move once on upgrade, and a run in flight at deploy continues in an empty directory (FIX-1286).
- a4e626b: Session retention no longer deletes a request that started running again after retention judged it evictable. An `interrupted` turn the durability sweep re-drives between retention's read and its delete now keeps its record, items, events and runOnce results. `RequestStore` gains `deleteIfStatus(id, allowedStatuses)`, which deletes a request only while its status is one of `allowedStatuses`, checked in the same atomic step; the memory, filesystem, SQLite and Postgres stores implement it. A custom `RequestStore` must add it (FIX-2109).
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

- 8195995: Schedule index rows are now identified by the storage cell the schedule lives in plus its key, so a person's same-named schedules in two hired seats (or a seat and their app-wide flow) are two rows and turning one off no longer stops the other (FIX-1546). `ScheduleIndexRow` gains a required `cell`, `ScheduleIndex.remove` takes `{ cell, key }` instead of `(userId, key)`, and `CollectionHookContext` gains `cell`, the storage key the instance is persisted under. A custom `ScheduleIndex` must key its storage on `(cell, key)` and store `cell`; the conformance suite covers it. The SQLite and Postgres `schedule_index` tables are re-keyed on `(cell, key)` automatically at schema init, adopting every existing row as its person's own cell; with `skipSchemaInit: true`, apply the upgrade SQL in the schedule index reference. BullMQ scheduler ids are built from the cell and key; an app-wide schedule for an ordinary user id keeps its existing scheduler id.
- 71b0174: Version-checked scope-state writes such as `atomicState` and `setState` skip a no-op only after the store confirms it, so restoring a value another writer replaced in the meantime is stored, and direct `runWithCAS` callers, or `createScopeStateOps` callers that pass `persist`, must also pass the new `reread` option to keep skipping writes that equal the cached state (FIX-1275).
- 97894aa: A flow can check every new session's initial state with `session.createCheck`, refuse caller-seeded fields with `session.serverOwned`, and fix a field for a session's life by declaring it `.readonly()` in its session `stateSchema`; `listSessions({ state })` and the list route's `state.<field>` filter select sessions by a readonly field. On a flow that binds its sessions this way (a readonly field or a create check), an initial state that fails the `stateSchema` is refused on every path that creates a session; other flows keep it as sent. A dispatcher's `session: { key, state }` and a task dispatcher's `state` create the child session with that state. `ensureSessionRecord` now takes the create request beside the record it builds (FIX-1788).
- 92a8b49: The session routes now send a session as a client may see it (FIX-1588). `GET /sessions/:id`, the session listing, and the create and metadata-edit responses carry only the `state` fields the flow names in `session.client.expose` or declares readonly (empty when there are none), and no longer include the record's `journal` or stored `resources`. Server-side code that needs the whole record reads the session store.
- 9ed6b29: A block can stop another request running in its own session with `ctx.session.stopRequest(requestId)`. It records the same stop as the abort route, reaches a request in another process on its next heartbeat, and answers `"stopped"`, `"already-finished"` or `"not-in-this-session"` (FIX-1690). Anything that implements `SessionScopeHandle` itself must add the method.
- 9f32967: A session stream now opens on a session with many child runs in a fixed number of request reads instead of two per run, so on the filesystem store a hundred runs open in well under a second rather than several. `RequestListOptions.sessionId` now also accepts an array, matched by set membership (an empty array matches nothing), which custom request stores must honor (FIX-1702).
- b552b50: A dispatched task now settles once, when its work is over (FIX-2077): after its request, the background work that request started and the background work the flow's `onFinished` started have ended, with no task it filed still open or still owing its ending. Until then the row stays `in_progress`, and `Task.keptOpenBy` says what holds it (`"filed"`, `"suspended"` or `"steer"`). A row that waits has no lease, so a task that stops to ask a person or to wait on an event is no longer reclaimed and run again when its lease runs out. The output is the latest `reportProgress` checkpoint, else the last answer that counts; a message's answer never is.

  Orchestration adds `taskRequestAdmission`, `noteTaskAnswer` and `afterTaskCheck` for a request that works on a waiting task, and `endRules` on `createTaskGate` and `taskLedgers`. Core adds `onRequestEnded` (`@flow-state-dev/core/types`), a framework-facing hook the engine runs after a request's last drain, on every way it ends.

  In Workforce a split task stays running while its pieces are open, and its output is its worker's answer like any task's. Read a piece's result from its own row (`listTasks({ filedByTask })`, `getTask`). A failed piece no longer fails its task by itself: the turn its ending wakes decides, and only a turn that throws fails the attempt. A worker that ignores a failed piece completes its task anyway.

- 1f2dadd: `RequestStore.set` must now keep the stored items when a record leaves `items` off, which the request-state write now does so a mid-run state change no longer drops the items persisted since the run started, and a custom store that keeps items on the record and replaces it whole has to add this (FIX-1735).
- cd180d7: Stopping a paused request now ends it `aborted` and records its gate with the new `stopped` suspension status, a turn paused on an ask cancels the asked task instead of waiting for it, and a durable host now runs the durability sweeper even without `durabilityRetention`, so a paused request past its `expiresAt` expires and an ask past its deadline times out, while pruning still waits for a retention policy (FIX-1816).
- 0d6278e: `ctx.request.tokenUsage` now counts every model call in production too, so an action's `tokenBudget` warns, marks the request incomplete, or fails it there as it does in development (FIX-2145). A request that suspends and resumes keeps one count across both runs.
- 69ba29c: Every flow now keeps a user's data per organization, so `resolveUserStorageKey(userId, orgId, flow)` takes the organization and throws without one, a dynamic schedule's dispatch id is `<orgId>/<userId>/<key>` (built by the new `formatScheduleId`), and the test harness seeds user data in the run's organization (FIX-1790).
- d97031f: The suspension reasons that wait for a user are now `"user_approval"` and `"user_input"`, renamed from `"human_approval"` and `"human_input"`. Nothing reads the old values: `SuspensionReason` still accepts any string, so a `ctx.suspend` or a `useSuspensions({ reasons })` filter that still passes an old value compiles but is treated as a custom reason: it is not a user's stop, gets no Inbox item, and an old `"human_input"` stop defaults to approve/reject instead of submit. Search your code for both old strings and replace them. Stored suspensions with the old reasons are not migrated (FIX-2151).
- 49d2aca: A stop that waits for a user holds its task and ends exactly once (FIX-2129).

  - **`ctx.suspendForUser({ kind, prompt, deadline? })`** (`core`): stop the request for an `approval`, a `review` or an `input`. It returns the answer, or `{ cancelled: true }` when the task was cancelled while it waited. At its deadline an approval reads as a no (`deadline: true`) and a review or an input throws `SuspensionTimeoutError`, which the block may catch. With no `deadline`, the host's `userDeadlineMs` applies, else none: the stop waits until it is answered, stopped or cancelled. The model's tool is `suspendForUser`; the task's open stop is listed on `Task.holds`.
  - **The answer route** (`engine`): `POST /api/flows/:flowKind/requests/:requestId/answer` answers a user's stop in any run, a task board's included, after the resume path's ownership checks; a request handle's `answer` (`client`) calls it. Who answered is the signed-in caller.
  - **`userDeadlineMs`** (`createFlowState`, `engine`): the host's deadline for a user's stop, unset by default.
  - **Cancel one stop:** `RequestHost.resumeWait({ suspension: { requestId, suspensionId }, outcome: { cancelled: true } })`.
  - `contracts` exports `isUserSuspension` and `suspendForUserKindOf`, and `SuspensionStatus` gains `"cancelled"`.

  A raw `ctx.suspend` with `user_approval` or `user_input` now gets the same mark, cancel and stop as `suspendForUser`. A raw `user_input` stop past its `timeoutMs` now resumes its block with `SuspensionTimeoutError` instead of staying parked, and a cancelled one throws `SuspensionRejectedError` with `cancelled: true`. A filing by a cancelled task is refused (`TaskFilingRefusedError`, rule `parent_cancelled`). Shift Manager answers every ask through the answer route.

- 3c10d9d: `waitOnRequest(ctx, { requestId, gateId, planKey, deadlineMs?, deadlineAt?, message? })` is exported from core: it parks the running request on the wait gate until another request ends or the deadline passes, the half of `dispatcher({ wait: true })` that waits (FIX-2239). `RequestHost.waits.userStop()` returns the request of the running session parked for a person, if any; the engine implements it. A request's end now also resumes waits in its own session that are bound to it, when the run that ended it had resumed it.
- 96ff077: A turn waiting on another worker's task says **wait** (FIX-1876). `@flow-state-dev/core` exports `WAIT_GATE_REASON`, `isWaitGate`, `WaitGateBinding`, `WaitOutcome`, `WaitEndingErrorCode`, `parkOnWait`, `ParkOnWaitInput`, `parseWaitOutcome`, `recordedWaitOutcome`, `RequestHost.resumeWait`, `RequestHost.hasWaitSweeper`, `ResumeWaitInput` and `ResumeWaitResult`. `@flow-state-dev/orchestration` exports `waitGateId`; a row's wait slot is `Task.wait`, and `listTasks` marks a waited-on row `waitedOn: true`. `@flow-state-dev/engine`: the request host's `waitResume` and `waitSweeper` (`RuntimeConfig.requestHost`).

### Patch Changes

- 15f7c6b: A worker message lands once (FIX-2240). The recipient's `onMessageReceived` takes a message on its log row before it lands, so a late copy lands nothing, and the sending session's board pass sends a message again, backing off from 2 s to 5 min, until it is delivered, refused or past the host's debt age. A message that can't land after the send returned leaves a line in the sending session, which its next turn reads.

  **Migration.** The `sendMessage` tool answers `{ sent }` only: `unconfirmed` is gone, and `SendOutcome` no longer carries it. A log row's `status` is one of `unconfirmed` (on its way), `delivered` (landed in the recipient's conversation, not just accepted by its host), `refused` or `undeliverable`, and gains `toState`, `takenBy`, `deliveredAs`, `deliveredAt`, `resent` and `toldAt`. `dispatch-rejected`, `no-dispatch-operation` and `flow-not-found` are no longer final. The session's 500-id seen window (`workerMessagesSeen`, `messageReceivedStateShape`) is removed. The server function `sendMessage` takes an optional `{ id }`, so a repeated send under one server-chosen id is one message. Orchestration exports the take rule (`takeRule`, `decideTake`, `TakeRule`, `hasEnded`) and the resend backoff (`nextResendAt`, `NOTICE_RESEND_CAP_MS`) its task notices and worker messages share.

  The filesystem request store's `flushItems` now rejects when an item write failed, as `flushEvents` does, so a resolved flush means the items are stored.

- 24afa6e: A question is one kind of task hold (FIX-2317, FIX-2131, FIX-2133). The two ways to stop for the user are named for what stops, and a task's open stops live in one list.

  - **`suspendForUser`** (new) suspends the request and resumes it with the answer: `ctx.suspendForUser({ kind, prompt, deadline? })` in `core`, `suspendForUserOn`, `createSuspendForUserTool`, `SuspendForUser`, `SuspendForUserOptions`, `SuspendForUserContext`, `SuspendForUserCancelled`, and `SuspendForUserKind` / `suspendForUserKindOf` (`contracts`, re-exported by `core`). `kind` is `"approval"`, `"review"` or `"input"`.
  - **`holdTaskForUser({ question })`** holds the task until the user answers, built with `createHoldTaskForUser`. The turn ends; the next turn on the same attempt spends no retry.
  - **`Task.holds`** lists what stops the task being claimed until the user answers. There is no `kind` field on a hold: an entry is told apart by `source.kind` (`"row"` or `"suspension"`) and `ask.kind` (`question`, `confirm`, `approval`, `review`, `input`). `getTask`, `listTasks` and Inbox items list `holds`.

  `createTask({ questions })` files a task that stays `pending` until each question is answered: a plain string is a question, `{ kind: "confirm", prompt, onNo? }` asks for a yes or a no. Answer with `updateTask({ id, answers, message })`. The Inbox client's `answerOne` takes `questionId`. A deadline applies only when the host sets `userDeadlineMs`.

  **Breaking, from the last publish.** The `parked` status is gone, with `counts.parked`, `TaskCollectionRef.awaitReview` / `unpark`, `board.unparkAndDrain`, a board's `onReview`, and `@flow-state-dev/react`'s `BOARD_STATUS_COLUMNS` `parked` column. Ask for a review with `ctx.suspendForUser({ kind: "review", prompt })`. The filer's hold is unchanged: status `held`, `hold()`, `release()`. `keptOpenBy: "suspended"` means the task's own request is suspended. Stores are reset: a stored `parked` row is not read. Also removed with `parked`: `TaskTransitionOptions.refuseWhenParked`, `CheckBoardOptions.excuseParked`, the `"parked-for-review"` termination reason, the `"review_requested"` change kind, the `"parked"` write-decline reason, `unparkAndDrainInputSchema` / `UnparkAndDrainInput`, and the task-board exports `TaskBoardOnReview` and `assertParkExitSupported`. React no longer maps a legacy `awaiting_review` card status. `TaskClaimTicket.turn` is required: every claim advances the row's `turn`, and a ticket from an earlier turn of the same attempt is declined `lost-claim`.

  A row stored with `questions` still reads as `holds` (`withRetiredShapes` from `@flow-state-dev/orchestration/tasks`). Shift Manager and the DevTool read them as holds.

- f8df86f: A flow's request and action observers (`request.onStarted`, `request.onFinished`, `onCompleted`, `onErrored`) now run on their own block path, `observer[<owner>.<hook>]`, instead of the action block's `root`. Before, an observer's trace on the root's id read as the action block running twice, and a session read (or a reload) dropped the messages the action block emitted: with `request.onStarted` under lean traces (production's default), and with `request.onFinished` in both trace modes (FIX-2299). `blockPathObserver(hook)` is exported beside the other block path helpers.
- 8e67ce5: A worker's call that dies after sending its message and before it parks is continued (FIX-2269). A call (`sendMessage({ wait: true })`) now owes its park through the new optional `RequestWaits.owingPark(work)` before it sends. If the request is then marked `interrupted` while it still owes one, the durability sweeper continues it, and the replay waits on the message it already sent, so the call is answered instead of left waiting forever. A request still owing its park 10 minutes after the first owe is left `interrupted`. History and retention read an interrupted request that owes a park as one that will run again, and stopping it lets the owe go. A repeated call's send now dispatches itself, so the continued call has a request to wait on.
- 920adc3: Aborting a request now stops every run of it still live in the process, and `deregisterAbortController` takes an optional controller so one run ending no longer drops another run's (FIX-1665).
- 3221d05: A dispatched task's background work that errors now fails its attempt (FIX-2088), as if its request had thrown: the task runs again while it has attempts left, otherwise it fails with an error naming the step (`Background work "<step>" failed: ...`). It counts in every request working the task, including steps `onCompleted` and `onFinished` start and a step a default `.waitForSideChain()` already drained. The request itself still reports `completed`. A cancel never fails the task this way, and a step that failed before a suspension counts only if its rerun on the resume fails too. Make a step best-effort by catching inside it.

  Core adds `RequestEnding.backgroundFailures` and the `BackgroundFailure` type (`@flow-state-dev/core/types`), and `RequestSideChainPool.failures()`; the engine hands a request's background failures to its request-end hooks. In Workforce, a failed `afterAnswer` step (such as a memory capture) fails a task's attempt too, except in a task filed `resultTo: "conversation"`, where it is logged and the task keeps its answer. Conversation turns are unchanged. A step a timed-out `.waitForSideChain({ timeoutMs })` stopped waiting on is still waited for before the request ends, and its failure counts and is logged, with `failOnError` too; `drainScope` takes an `abandoned` signal for this. The MOAT bash provider's purge of stale containers now logs a failure instead of throwing it.

- f97b0ed: The task board's last old words are gone (FIX-2246), with no alias and no old spelling read. Stores written by an earlier version are not upgraded: a request left in flight across the upgrade may not resume.

  - `@flow-state-dev/workforce`: a coordinator's routing record and a routed task's brief name the message by `messageRequestId`.
  - `@flow-state-dev/orchestration`: a task notice's waited-on flag is `waitedOn`, the word `listTasks` uses. A wait gate's id starts `wait:`. The board's dispatch blocks are named `<board>-dispatch-<assignee>` and `<board>-dispatch-fallback`.
  - `@flow-state-dev/core`: `isWaitGate` is true only for a gate with the reason `"wait"`.
  - `@flow-state-dev/engine`: a wait gate the waiting turn's own conversation resolves records `wait:<session>` as its resolver.

- 397cfa7: Boot warnings and the active-profile line now print once per server process, not on every dev hot reload (FIX-1632).
- 452b702: BullMQ workers now honour the `hold` and `defer` concurrency policies, which used to run as `allow` once handed to a queue. A `hold` job runs at once and keeps its conversation busy until it ends. A `defer` job waits, by requeueing rather than holding a worker slot, until nothing on its key is running or waiting, then runs; a crashed worker's place frees once its lease runs out. The dispatching process counts a queued `defer` against the 32-per-key cap until its job ends, and checks ownership before either policy takes anything on the key (FIX-1836).

  For adapter authors, the engine adds `DispatchEnvelope.leaseTurn` (how a queued job reaches its turn), `planDeferWait` and `DEFER_PATIENCE_MS` (the `defer` wait, shared with the in-process arbiter), and a `budgetMs` option on `planQueueWait`. Roll out workers before the processes that enqueue: an older worker treats a `hold` job as `queue` and runs a `defer` job at once.

- e4fb1f1: `GET /api/flows` now lists a pinned flow instance that has its own `authentication.resolvePrincipal` to the callers that resolver accepts and the pin matches, the same callers who can already open and run it (FIX-1552).
- 538cd1a: `POST /api/flows/users/:userId/check-interrupted` now only reports and sweeps in-flight requests in the caller's own tenant (the tenant header, `x-tenant-id` by default), so a caller on one tenant can no longer see another tenant's request ids or mark its live requests `interrupted` (FIX-1569).
- 585b75b: `POST /api/flows/users/:userId/check-interrupted` and `createRecoveryClient().checkInterrupted({ staleThresholdMs })` now use the larger of the caller's `staleThresholdMs` and the server's `staleSweepThresholdMs`, so a smaller, zero, or negative value sweeps as if it were left out and a request that is still heartbeating is never marked `interrupted` (to sweep sooner, lower `staleSweepThresholdMs` on the server) (FIX-1571).
- 3b5266a: With route-level authentication on, session delete, child and request listings, and resource-content routes now return 404 when the session behind the id has changed hands since access was checked (FIX-1616).
- 25ac53a: Client streams no longer carry `item.updated` patches for items a client can't see, so a hidden item's data, such as a `block_trace`'s block output, stays off the end-user stream. A patch now passes only for an item the stream has already sent as client-visible, whether the update names it by `itemId` or by the legacy `id`. A patch for an item the stream never sent is dropped, for example on a stream resumed after that item's `item.added`. The item's `item.done` still delivers its final state. `?include=trace` streams are unchanged (FIX-1565).
- 6453d2c: A resource collection declared `writable: false` now refuses writes with the same non-retryable `FlowError` (`code: "resource_read_only"`) as a single resource, so a retry-configured block no longer re-runs on a collection refusal. The error messages are unchanged (FIX-1519).
- f282bcb: A queue adapter can supply a shared lease backend (`WorkerAdapter.leaseBackend`) so a session's `queue` / `reject` concurrency policy holds across every process of a deployment, and every transport answers a refusal that arrives after dispatch the same way it answers one thrown from it (FIX-1634).
- 55c62a6: `writeContent` now always writes to the content store. Previously a write whose body matched what the request had last read or written was skipped, so if another writer had changed the content in between, the later write was silently dropped while still resolving successfully (FIX-1274).
- 1355483: The debug resource endpoints no longer list, count, or return another user's user-owned hired seats, and fetching content for a collection topic that doesn't match the collection's pattern now returns 404 (FIX-1535).
- 5181ddb: An approval that passes its `expiresAt` no longer leaves its request suspended: the durability sweeper carries the turn on as if the approval were rejected, so the gated tool does not run, the model gets a result saying the approval expired and is no longer valid, and `SuspensionRejectedError` carries `expired: true` (FIX-1846).
- 60d1bf4: Request routes answer a caller from another organization with the same 404 an unused request id gets, so a request's existence no longer shows across organizations (FIX-2194). The resume route records the signed-in caller as who resumed a suspension (the request's owner when the app doesn't authenticate) and ignores a `resumedBy` in the body; `ResumeSuspensionBody.resumedBy` is deprecated (FIX-2195).
- 42bfbe6: `GET /sessions/:id` now answers 404 instead of another owner's session when the session id changed hands after the route's owner check, matching the other session-addressed routes (FIX-1852).
- 57323b9: A task's notice held for the request that filed it no longer waits out its resend backoff when that request's server died mid-run. `requestHost.waits.running` now answers `false` for a request still recorded `in_progress` whose registry heartbeat has been silent past the host's stale-request threshold (where the flow's heartbeat is on and beats at least twice per threshold), and the stale-request and startup sweeps bring the wakes kept for the session of each request they mark interrupted forward to now, so the filer's pass sends the notice at once. With the defaults, the notice is heard within about 90 seconds of the request's last heartbeat. `detectInterruptedRequests` and `createStaleRequestSweeper` take an optional `wakeEntriesOf` for this (FIX-2166).
- 8a55e23: A dispatch into a hired seat whose pin the sending session is outside now refuses at the seam as `flow-not-found`, the same answer an unregistered address gets, before any child session is written. A task board handing a row to such a seat now fails that row with the refusal instead of leaving it claimed until its lease lapses (FIX-1534).
- 01b29f0: A hired seat stays with the organization and user that hired it, so another organization or roster peer cannot list, open, or run that seat (FIX-1529).
- afb512f: `ItemQuery` gains `includeInFlight`: pass `false` to `ctx.session.items.history()` (or `all()`, `client()`, `selectForContext()`) to get earlier items only, without the items the current request has produced so far (FIX-1595).
- 430db1b: A session's history now includes a request its host died in (`interrupted`), with only its settled items, so the next turn sees the message that started that turn and the tool calls that already ran instead of starting without them. An interrupted request still parked on a gate that drives it again (pending, or resolved and owed a re-drive), or one a `/retry` re-ran, is left out. Session retention now bounds interrupted requests too (`maxAge`, `maxItems`), and never deletes a parked one. `applyRetentionPolicy` takes an optional durability provider as its last argument to read those gates (FIX-2101).
- 21ffcbb: A session's request listing and the conversation history a run in it gives its model now show only that session's own flow, owner and organization, so a session stored before runs were bound to it no longer serves another flow's or another user's turns (FIX-1648).
- f9995b1: An `{ id }` dispatch target may carry `state`, which creates the session at that id when none exists, through the target flow's create check (FIX-1989).
- 5a55080: `incState` now refuses a field that holds something other than a number (a string, boolean, object or array): the call throws and the stored value is left as it was, instead of being silently replaced by the delta. An absent or `null` field still starts from `0`. Custom stores implementing `incField` should throw the same way (FIX-1273).
- 2d2518b: Postgres lease acquire is now exclusive on every executor, so two instances can no longer both take the lease for the same request; lease ids are now UUIDs on every store, and custom `LeaseStore`s can run the shared `createLeaseStoreConformanceTests` from `@flow-state-dev/engine/testing` (FIX-1712).
- c57890d: `GET /api/flows/sessions` and `GET /api/flows/active-requests` now list the rows of a flow instance that has its own `authentication.resolvePrincipal` to the callers that resolver accepts as their owner (and the instance's pin admits), the same callers who can already open those sessions (FIX-1566).
- 3cbab3a: The request host implements `sessions.read(id)`: a block can read another session of its own principal, cut to that session's flow's read-only state fields (FIX-2160).
- a965a50: A request that resumes after `suspendForUser` restores the state of every sequencer it was inside, nested ones included, so a step after the resume sees what the steps before it wrote (FIX-2163). Two `loopBack`s that target the same step give each pass its own child paths, so a resumed request no longer reuses an earlier pass's step outputs for a later pass.
- 41638f3: A flow that sets no `tokenCounter` now counts with core's `estimateTokenCounter`, which reads each model's characters-per-token from the model lookup, instead of a flat four characters a token. `{ tokens: N }` history windows on a GPT, Gemini or Llama model count a little higher than before, so they hold slightly fewer turns. Blocks read the flow's counter as `ctx.tokenCounter` (absent on a mock context), and `utility.consultSessionHistoryTool` cuts its `budgetTokens` with it, for the answering model (FIX-2319).
- 27b198a: `defineResourceCollection` accepts `ownerWrites: { param }`: every reader the collection's scope serves reads each row, and only the user the row's owner segment names writes it. Key rows with `ownerSegment(userId)` at that parameter, as for `ownerPrivate`, and the same pattern rules apply (the parameter appears once, no `**`); a browser read is allowed. A create, update or delete by anyone else, through the collection handle, a ref obtained by reading, or the browser update and delete routes, throws `A row of an owner-writes collection is written only by the user it belongs to.` and changes nothing. The startup fence covers these collections too: a wider collection in the same scope that can reach their keys, or the same pattern declared `ownerPrivate`, stops the app from starting. A collection can't declare both modes, and an owner-writes collection can't declare an `eviction` policy other than `"none"` (FIX-1793).
- 0abbcd9: A resource whose name or `ref` matches a built-in object member (`__proto__`, `toString`, `constructor`, …) now seeds its default state and content, reads back what was stored, and writes without failing on its version. Previously its default was skipped and `patchState` threw `expectedVersion ... received NaN` (FIX-1254).
- d9d00a4: `PUBLIC_REENTRY_SOURCES` is now exported: the built-in request sources (`http`, `mcp`, `scheduled`) the public retry, continue and resume routes re-enter. A client that decides whether to offer an answer can pin its own copy to it in a test. A host's `publicReentrySources` option still extends it at runtime (FIX-1662).
- 711ed0e: A turn whose approval (or rejection, form submission or skip) was recorded but whose process died before the turn continued is now carried on by the durability sweep with that recorded answer, instead of staying paused forever (FIX-1850).
- 72c5b17: A resource write whose `stateSchema` parses a non-null value to `null` is now refused with a `ValidationError` instead of being stored as the cleared `{}` and reported as a success. This covers `setState`, `patchState` and `updateState`, `collection.create`, and the client create route, which now answers `400` rather than creating a row from a seed the schema parses to `null`. An explicit `setState(null)` on a `.nullable()` resource still clears it (FIX-1281).
- 65ddb90: Each request's record now stores its action result (`output` as JSON, and/or `error`) with its final status, `listSessionRequests` returns it (the output with `includeResultOutput`), the DevTool task row reads it instead of reconstructing it from traces, and a run a completion hook failed after the action answered now reports that answer as `output` (including `fsdev run`'s result, where it was `null`) (FIX-1661).
- 47a02d0: Retry, continue, resume and abort now answer a request that belongs to another user or tenant with the same `404 Request "<id>" not found` as an id nobody has used, and abort only stops the request it checked (FIX-1021).
- 9083569: A caller-supplied `requestId` is now bound to the principal that owns it (FIX-1018). An action call that sends a request id another user, tenant or organization already holds runs as the caller's own request, under an id returned in `x-request-id` and the 202 body, and never writes, adopts or re-parents the other principal's record. Every point that writes or adopts a request record refuses a foreign-principal record with the new exported `RequestOwnerMismatchError`; the HTTP action route answers that race with `409 request-id-in-use`. A caller reusing its own id is unaffected.
- 0935a47: The SQLite and Postgres request stores now write a settling record's `items` in the same transaction as its status, and read a record's row and items in one snapshot, so a reader never sees a final status without its items or one request's row paired with another's items after a request id is reused (FIX-1750, FIX-1619). A custom `RequestStore` must land the `items` a terminal `set` carries in that same write; the runtime no longer persists them separately before settling.
- d2f77fc: With a principal resolver configured, a request's status and stream now answer another user's request, or an event log whose record is gone, exactly as an unused id, and a session's state and stream show only its own flow's requests (FIX-1046).
- 0995afe: A live request stream (`GET …/requests/:id/stream`) now ends as soon as its caller disconnects on Node hosts that report a disconnect only through the request's signal. Before, it could keep its store subscription open until the live-tail liveness timeout (FIX-1617).
- adbcf0b: `RequestWaits` gains an optional `running(requestIds)`: whether each request of the running session is running its own work now (`in_progress`), as opposed to parked (`suspended`) or ended. The engine's request host implements it. A host that supplies its own `RequestWaits` should add `running` too: without it, a task board doesn't hold a task's notice while the request that filed the task runs (FIX-2123).
- d9d00a4: `GET /sessions/:id/resources/:ref/content` now returns a single resource's declared content (`content` or `contentFile`) when nothing has written it yet, instead of `null`. A block reading the same resource already saw that body. A document loaded with `resourcesFromDocs` and marked `client: { content: { read: true } }` is now readable from a browser before any run writes it (FIX-1662).
- 1cfd80c: `defineResource` and `defineResourceCollection` take a `secret` list of state fields the engine never sends to a client or returns from the debug routes, and Workforce marks a stored MCP key's `value` secret so the debug routes no longer show it (FIX-1955).
- 229de7a: The in-memory and filesystem resource state stores now commit the JSON form of a write, matching SQLite and Postgres (FIX-1266). A `Date` reads back as its ISO string, a `Map` or `Set` as `{}`, `Infinity`/`NaN` as `null`, and `undefined` or function fields are dropped on every store; a `bigint` or a cyclic state is refused with a `TypeError` on every store. Previously the in-memory store kept these values as written, so tests on memory could pass while the same write stored different data on a durable store.
- 4ca0e99: Request metadata can no longer resolve a suspension. `runAction` now drops `metadata.resumeContext` and `metadata.resumeOf` (logging a warning) instead of reading them, so an action request can't pre-approve a human-approval gate or release another request's resume lease. To continue a suspended request, use `continueRequest` (or the resume endpoint), which passes the resolution as the new typed `RunActionOptions.resumeContext`. Code that resumed by calling `runAction` with those metadata keys under a new request id must switch to `continueRequest` (FIX-1707).
- 3b0161c: With a durability provider configured, a request resumed after a stop, or continued through `/continue`, no longer runs its completed steps again when trace observability is off, as it is by default in production. Without a durability provider, `/continue` behaves as it did before: it skips a completed step only from a full trace, so a request recorded with observability off runs again from the top. The lean record is marked `lean: true`. Each completed block now records a lean `block_trace` (its identity and output) whatever the observability setting, and resume replay reads that record to skip the block. Full capture (inputs, generator prompts, resource loads, failed traces) is still gated by `FSDEV_TRACE_OBSERVABILITY`. With observability off, a request's item log now holds one `block_trace` per completed, non-transient block. An output larger than the recorded-value limit is stored as an omitted placeholder, so a resume that reaches that step fails with `RECORDED_VALUE_OMITTED`, naming the block, rather than skipping it or running it again. With a durability provider, crash recovery (`/continue`) is at-least-once for a block whose completion had not been persisted when the process died: that block runs again. A completed `block_trace` now carries `rescued: true` when a `.rescue()` handler produced the block's output, so `ctx.wasRescued()` returns the same answer after a resume (FIX-2137).
- d86c7db: A suspended request that resumes (a person's answer, a stop, or the durability sweep's re-drive) now takes its turn on its session's concurrency key instead of running beside whatever the session is running. Under `queue`, `reject` and `defer` it waits its turn under the `queue` budget; under `hold` it runs at once; under `allow` nothing changes. A resume that cannot get its turn in time stays suspended with its answer recorded and is re-driven by the durability sweep (FIX-2062).
- fa7b22e: A tool call that waited on an approval no longer reads as failed. A later turn's history replays it once, with its result; before, it also replayed the wait as a failed call carrying the approval's question, so the model read it as a failure it had retried. `isSuspensionWait(item)` (from `@flow-state-dev/contracts/items`, re-exported by `@flow-state-dev/core/items`) tells such a wait from a real failure, and the registry's tool card draws it as awaiting approval. Shift Manager draws a waiting call as waiting, and a conversation redraws once its ask is answered on the page, again when the run it resumed stops (FIX-1901).
- 83cd9c2: The children of a run's outermost block now read the run's input through `ctx.parent.input`, the same as children anywhere else in the tree. Before, it was `undefined` there (FIX-1570).
- 7c9e932: A running request's items are now readable while it runs on the in-memory stores too, and a message sent to a coding run whose harness hasn't named its session yet is held until it does instead of being refused as a run that can't continue (FIX-1735). `readCommitted` (in `@flow-state-dev/core/helpers`) reads a resource's state as committed now rather than as the request first read it.
- 637b6d5: `ctx.runOnce(key, fn)` no longer raises an unhandled promise rejection when `fn` rejects. The error still reaches the caller unchanged; nothing else is left unhandled, so a Node host running with the default `--unhandled-rejections=throw` no longer crashes when the caller catches it (FIX-1738).
- 0503c38: A schedule created with `schedules.create(key, { cron, kind, enabled })` on a `defineScheduleCollection` collection now fires and keeps firing after a reschedule: the resolver reads the row from resource state (`ScheduleResolutionStores` now requires `resourceState`), and a new `stampOrgId` collection option records the creating run's organization on the row, keeps it across updates, and refuses any write that names another organization (FIX-1545).
- 8b8ba8d: Served requests that die during setup now settle as `failed` instead of hanging at `in_progress` (FIX-1511).
- 3c2ab06: Another user's session id is now answered as not found (FIX-1022). With a principal resolver configured, every session-addressed route (`/sessions/:id`, its state, stream, requests, children, manifest, resources, metadata, delete and debug routes) answers another user's session with the same `404` an unused id gets, instead of `403 Caller is not the owner`. An action posted into another user's session is refused before it is acknowledged, with `404 Unknown session` and nothing written, instead of `202` followed by a failed run; `runAction` and the transport host throw `UserBindingMismatchError` at admission, ahead of the flow-instance check. The error's message no longer names the session's owner (`sessionUserId` still carries it). An organization mismatch for the session's own user still answers `403`, and another user's request is unchanged. The session debug suspensions route now answers `404 session_not_found` for a session that does not exist, as the other session debug routes do, instead of an empty list. Session keys are unchanged, so stored sessions need no migration.
- 334c1e3: A message item read through `ctx.session.items.all()`, `client()` or `selectForContext()` carries its `role`, so a block building its own prompt context can tell the caller's messages from the flow's (FIX-1828).
- 64b3ed7: `ctx.session.appendJournal` and `ctx.session.setMetadata` no longer overwrite session state or journal entries another request committed meanwhile: they now write at the version they read, retry on conflict, and throw `ConcurrentModificationError` once retries run out (FIX-1376).
- b7c523b: Add `GET /api/flows/sessions/:sessionId/stream`, which follows a whole session: each finished item any request in it keeps (filtered as the session snapshot filters), with its request id, and a notice naming the session's unfinished runs whenever that set changes. It is authorized as the snapshot is, reads the store about once a second (only what is unfinished or recently updated), and closes after at most 15 minutes. `@flow-state-dev/engine/testing` exports `createSessionStreamConformanceTests` for store adapters, and `sessionStreamReads`, the list options the stream's two repeated reads send, for an adapter's index tests (FIX-1609). Each copy of an item is sent once per connection, so a keyed item emitted again is sent again.

  The stream follows only the session its caller was checked against when it opened. If that session is deleted, or its id is used again for another session, the connection ends before anything more is sent, and the reconnect is answered as a fresh open: 404 or 403 when there is no session there the caller may read. The stream stops reading the store once its connection ends, even midway through a read. The snapshot and the stream show only requests made in the session under its owner and organization, and each answers 404 when the session under the id is not the one the caller's access was checked against (it was deleted and created again in between, by anyone and under any flow instance, or created after the check found none). A request's items read by its id after the stream's list found it are sent only while the id still holds that request, and a run the stream named is dropped once its child is deleted or its id holds another session.

  A request for a child session now moves that child's `updatedAt` when it is accepted, before it waits behind a concurrency key or in an external queue, so a live view of the parent names the run while it waits. That includes a run delivered into an existing child by its id, which before moved nothing. A request its session will refuse (another tenant, owner, or organization) moves nothing, nor does one whose child was deleted and created again (by anyone, under any flow instance), or created, after the request was admitted. A request from a session's owner acting for another organization, which the session refuses, no longer becomes its latest request, nor does a request become the latest of a session that took the id after its admission, or of another flow instance's session.

  `PATCH /api/flows/sessions/:sessionId/metadata` now writes at the version it read and advances it, as `ctx.session.setMetadata` does. An edit no longer puts back fields another write changed meanwhile; it reads the session again and retries. A session that keeps changing through every retry answers 409. An edit answers 404 when the session was deleted and created again under its id (by anyone) after the edit was authorized.

  `GET /api/flows/sessions/:sessionId/state` returns `at`, the server time its read began. Hand it to the session stream as `since` to start where the snapshot's read did. It also returns `sessionCreatedAt`, when the session it read was created. Hand that to the stream as `session_created_at`, and every connection, reconnects included, answers 404 once the id holds another session. The snapshot's items are sorted with `compareItemOrder`, so two requests' items that share a time and an index are ordered by request id, not by which request was updated last.

- 6bf61dc: On the SQLite and Postgres stores, the durable items a request holds when it settles, including the action's output, are now stored before its final status is written. A client that reads the status and then the items no longer misses them. Items emitted after the final status (by `onFinished` hooks, for example) are not covered (FIX-1749).
- c8c8b38: The collection-state reads, the resource manifest and the session debug routes now answer 404 when a session id changes hands between the route's owner check and its own read, as the other session routes already do, so they never serve another user's session. Session routes that read user- or org-scoped resources (the state snapshot, resource content and state, and the debug routes) now read them under the session they checked, not a second read of the id (FIX-2048, FIX-1854).
- 6306a75: Stopping a request whose approval was already granted, but which has not run again yet (its process died before it continued, so it waits on the durability sweep's re-drive), now stops it: the abort route answers `204` and `ctx.session.stopRequest` answers `"stopped"`, the request ends `aborted`, and the approved step never runs. Before, the stop answered `409` ("stop it again") every time until the sweep re-drove the request, which then ran the approved step and finished `completed`. The gate then records only the stop: the person's answer, and any form data they sent, is not kept. The same holds for a stop recorded on such a request before the sweep reaches it (FIX-2108).
- e11764a: `ctx.suspend()` takes an optional `title`, a short heading for the ask, carried onto the suspension record and the `suspension` item; `message` is then the body under it. The Error Reporter's preview now sends a short title with its count and questions as a markdown body (FIX-2030).
- 2c43888: The stale-request sweep no longer marks a request `interrupted` when it finished while the sweep was running, and `RequestStore.setFieldsIfStatus` can now move a record's status together with its result, which custom request stores must support (FIX-1128).
- 9af8ce5: A dispatched task records what its runs spent on its row (`spend`), every attempt counted, rising while a run works: the board writes it every 2 s and as the request ends, through the new `recordSpend` verb on `TaskCollectionRef`. `listTasks` from `taskToolActions` returns it folded (`taskSpendView`: harness, model, input and output tokens, `null` until reported). Harness runs report spend as they go, keyed by a `runId` with the model the run named, each report replacing the run's last; `readRequestSpend(ctx)` reads a running request's spend so far, and `requestSpendSources` moves from Workforce into core (FIX-2288).
- 6e1a819: The resource content routes no longer render another user's owner-private row as a `contentTemplateRef` template (FIX-1853).
- a26e426: A `response` that exposes only `emit()` now receives `item.updated` events keyed by `itemId`, like every other stream, instead of `id` (FIX-871).
- f741004: A wait whose deadline passes while its request is still parking now resumes at the sweeper's next tick once the park is recorded, rather than about five seconds later. Before, the sweep found the request not yet parked and put the deadline off for its overdue-wait retry, so a `getTask` wait with a short deadline could miss it by seconds when the park's request-end hooks took a while (FIX-2150).
- ce8f765: `RequestHost.resumeWait` now refuses a resume that lands while its turn is still parking as `busy` (retryable) rather than `already-resolved`, so a waited-on task that ends during the park still resumes the waiting turn promptly instead of at the wait's deadline (FIX-2135).
- Updated dependencies [92b2b70]
- Updated dependencies [20aa58f]
- Updated dependencies [5d31955]
- Updated dependencies [bea14a0]
- Updated dependencies [24afa6e]
- Updated dependencies [f8df86f]
- Updated dependencies [82eea02]
- Updated dependencies [e2c190e]
- Updated dependencies [0d55d46]
- Updated dependencies [1abab86]
- Updated dependencies [8e67ce5]
- Updated dependencies [dd353e2]
- Updated dependencies [3221d05]
- Updated dependencies [58ffc93]
- Updated dependencies [f97b0ed]
- Updated dependencies [397cfa7]
- Updated dependencies [53b50f0]
- Updated dependencies [646f8d2]
- Updated dependencies [16a8dab]
- Updated dependencies [456fe85]
- Updated dependencies [62133c4]
- Updated dependencies [9d02ac6]
- Updated dependencies [d5ce1e0]
- Updated dependencies [8dc242e]
- Updated dependencies [89af7db]
- Updated dependencies [7d4158f]
- Updated dependencies [5492a77]
- Updated dependencies [6819520]
- Updated dependencies [ad5df6f]
- Updated dependencies [211679a]
- Updated dependencies [dd80e01]
- Updated dependencies [2ce15c7]
- Updated dependencies [5181ddb]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [e71ea1a]
- Updated dependencies [49d6397]
- Updated dependencies [a55d07f]
- Updated dependencies [7db4d13]
- Updated dependencies [9e3b823]
- Updated dependencies [df3de3b]
- Updated dependencies [fe5df7d]
- Updated dependencies [423a405]
- Updated dependencies [08a9b05]
- Updated dependencies [7da156e]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [f9995b1]
- Updated dependencies [a7f1c41]
- Updated dependencies [3a6c910]
- Updated dependencies [80f6e25]
- Updated dependencies [3cbab3a]
- Updated dependencies [849f6ec]
- Updated dependencies [028af6f]
- Updated dependencies [a965a50]
- Updated dependencies [eb831f8]
- Updated dependencies [41638f3]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [db7df1c]
- Updated dependencies [0d6278e]
- Updated dependencies [968faa6]
- Updated dependencies [653549d]
- Updated dependencies [839e915]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
- Updated dependencies [9510a03]
- Updated dependencies [adbcf0b]
- Updated dependencies [1027b98]
- Updated dependencies [1cfd80c]
- Updated dependencies [3b0161c]
- Updated dependencies [385d01e]
- Updated dependencies [d1a4cab]
- Updated dependencies [3311cc2]
- Updated dependencies [7c9e932]
- Updated dependencies [60c8192]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [295e96a]
- Updated dependencies [97894aa]
- Updated dependencies [334c1e3]
- Updated dependencies [9ed6b29]
- Updated dependencies [b552b50]
- Updated dependencies [a021cd1]
- Updated dependencies [cd180d7]
- Updated dependencies [68b8957]
- Updated dependencies [e11764a]
- Updated dependencies [872a088]
- Updated dependencies [9cd314d]
- Updated dependencies [9af8ce5]
- Updated dependencies [30aa133]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [d97031f]
- Updated dependencies [49d2aca]
- Updated dependencies [3c10d9d]
- Updated dependencies [96ff077]
- Updated dependencies [84cc226]
  - @flow-state-dev/core@0.3.0

## 0.2.0

### Minor Changes

- 6b8bfe4: Sessions a dispatcher ran work in are listable on their flow: `GET /sessions` takes `include=dispatch-runs` (off by default), `listSessions` takes `include`, `FlowNavigator` takes `includeDispatchRuns` and draws a run one level under the session that started it, the DevTool shows runs in the rail and inside a session's block tree on demand in place of its Children tab, and `requestHost.livenessOf` now also answers for a dispatch run under the caller's own principal, tenant, organization and flow instance rather than only for one beneath the asking session (FIX-1440).

  The dispatch-run liveness arm compares the caller's organization against the active-request entry as well as the session record. Both comparisons are required: they read separately stamped rows, and a caller whose organization was not forwarded to the read matched only entries carrying no organization at all.

- 3e43c96: A flow can now be registered and unregistered after the runtime is built — `FlowState.register(flow)` admits one instance and `FlowState.unregister(id)` releases one address, both running exactly the checks construction runs, and a flow registered this way is served from the next request onward without cancelling one already running (FIX-1475).

  A workforce hired at runtime now survives a restart: `defineHiredRosterCollection()` declares the org-scoped roster at `workforce/roster/*`, `reloadHiredSeats({ stores, orgIds, kinds })` reads a whole one back at boot as `{ seats, problems }` for the caller to register a seat at a time, and `seatAddress(orgId, seatId)` is the address a hired seat answers on (FIX-1475).

  Migration: `meta.flowKeys` now reads the registry rather than the construction options, so it lists the instance ids actually being served. An app whose `flows` record keys differ from its instance ids will read different values there than before.

- b48158a: Organization identity is now required on every request (FIX-1442).

  A session, request, dispatched child and scheduled job each carry an
  organization, and the server checks it on reads and execution alongside the
  user. It comes from a configured `resolvePrincipal`, or — when an app
  configures no resolver — from the new reserved `DEFAULT_ORG_ID` exported by
  `@flow-state-dev/core`. A caller-supplied `orgId` is never authoritative.

  **What you need to change**

  - A resolver must return a verified `orgId`. Returning none, a blank one, or
    `DEFAULT_ORG_ID` is refused with 401. A machine transport may return
    `{ orgId }` alone and let `defaultUserId` name its system user.
  - Direct `runAction` calls must pass `orgId` — your verified organization, or
    `DEFAULT_ORG_ID` for single-organization development.
  - `authentication.requireOrg` and a block's `requireOrg` are removed.
    Organization is unconditional, so the declaration had nothing left to say;
    a config that still carries either is rejected at definition time rather
    than ignored.
  - Client and React session APIs no longer take an `orgId` — the server owns
    it. `SessionDetail.orgId` is now required on the way back.
  - `openChannels` no longer takes an `orgId`; the server binds the channel.
  - A queued BullMQ job that carries no organization now fails terminally
    instead of being retried: a worker runs below principal resolution, so no
    later attempt could supply one. Subscribers receive an error terminal rather
    than waiting for a job that never completes.

  **The schedule index stores the organization.** `schedule_index` gains a
  nullable `org_id` column in both the SQLite and PostgreSQL adapters, so the
  organization a schedule fires into survives a round trip through the database.
  The column is added for you on the next schema init — there is no manual DDL
  step. Existing rows read back with no organization and are quarantined rather
  than dispatched, so a schedule written before this upgrade does not fire until
  it is attributed; rewriting it stamps the organization of the execution that
  writes it.

  **Upgrading a store with existing data.** Records written before this carry no
  organization. They are preserved and refused (`409 migration-required`) rather
  than guessed at, and listings and scheduler scans skip them. Attribute them
  offline first — the procedure, including dynamic schedules, index rebuild and
  the reserved-id collision check, is in the persistence guide under "Which
  organization a record belongs to".

- e4b6576: `writable: false` on a resource collection now refuses `create(..., { replace: true })` on an existing instance and `delete`, the same way instance `setState` already does. `create` and `getOrCreate` of a new key stay open (FIX-1510).

### Patch Changes

- 795b550: The debug resource snapshot now reports each resource's `writable` and `llmWritable` settings where they are declared, and the DevTool marks a resource read-only when `writable` is `false` (FIX-1481).
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
- Updated dependencies [b597600]
- Updated dependencies [6b8bfe4]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
  - @flow-state-dev/core@0.2.0

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
  - @flow-state-dev/core@0.1.1

## 0.1.0

### Minor Changes

- 4e562d0: The chat transport is removed (FIX-1330): `@flow-state-dev/chat-sdk` no longer exists, `chat` is no longer an option on `defineFlow`, `ChatConfig` / `ChatEventBinding` / `validateChatConfig` are gone from core, `"chat"` is no longer a `DispatchType` or a public re-entry source in the engine, and the DevTool no longer renders a Chat provenance badge. Conversational bots are driven through a caller-addressed action in `actions`; platform events ride the webhook transport.
- afcac3d: A flow declares its `cardinality` — `"singleton"` (the default: `myFlow()` is the one instance, addressed by its kind, and `myFlow({ id: "default" })` now throws) or `"collection"` (several configured copies, each registered under its own required `id`) — every address (the action, stream, resume, retry and continue routes, `fsdev run`, dispatchers, BullMQ jobs, MCP, webhook and schedule dispatch) is the exact instance id with no first-registered fallback, every session and request records its owning `flowId` and is refused when reached through another instance (`FlowInstanceBindingMismatchError`; `409 wrong-instance-session` / `wrong-instance-request` / `migration-required` on the routes), and SQLite and Postgres add a nullable indexed `flow_id` column with no backfill (FIX-1321, FIX-1322).
- b3e6e22: Initial release (FIX-1187).
- af40427: Isolated user and org state now belongs to the flow instance that wrote it, not to its kind (FIX-1323). Two registered copies of one `collection` definition keep separate private scope state and separate `flowIsolation: true` resources; a singleton's keys are unchanged, because its instance id is its kind. The exported scope-key helpers (`resolveUserStorageKey`, `resolveOrgStorageKey`, `resolveResourceScopeId`, `resourceScopeIds`) take the instance-bearing shape `{ id, ... }` in place of `{ kind, ... }`. Isolation keys now encode the `(identity, instance)` pair rather than concatenating it, so two different pairs can no longer name one storage cell; an identity or instance id made of ordinary characters keys byte-identically to before, while one containing `:` or `\` is escaped and re-keys. An existing collection deployment with isolated data, or one whose identity ids carry those characters, moves it through the offline cutover documented in Persistence → Who owns a record.
- 5fa52aa: One dispatch protocol: every arrival at a flow — a caller's action, a webhook, a schedule, a task hand-off, an internal dispatch — is a dispatch of one type delivered to one entry addressed by `(type, name)`, with no fallback between types (FIX-1302).

  - **`defineFlow` gains `internal` and `task` entries, nested under their type.** `internal: { actions: { wake: { block } } }` and `task: { actions: { implement: { block } } }` are declared like actions and are definition-only, like the transport maps; the flat `internal: { wake }` / `tasks: { implement }` spelling is refused by name. An `internal` entry is reachable only from a `dispatcher()` inside the flow; a `task` entry is reachable only from a `dispatcher({ type: "task" })` seat on a task board the flow reaches, and `defineFlow` puts each one behind that board's claim gate (the row re-read, the claim verified, the task scope marked, the ticket re-minted) before the block runs. A task entry no board addresses, a task dispatcher no board holds, and two boards addressing one entry are refused at definition. Every entry, of every type, accepts its own `concurrency` (`ActionCore.concurrency`).
  - **`dispatcher()` is the block that sends.** `dispatcher({ name, type: "internal", target, session: { key } | { id }, payload? })` (`InternalDispatcherConfig`) returns a handler carrying its static address, and `defineFlow` refuses an address the flow does not declare — through composition, rescue handlers, and a generator's static `tools`. `{ key }` derives a child session of the running one (minted, then adopted on the same key); `{ id }` delivers into an existing session of the same flow and principal, refuses an unknown id rather than creating one, and is dropped if that session was deleted and recreated between acceptance and the run. A refusal throws `DispatchRefusedError` naming the refusal (`no-entry`, `session-not-found`, `session-not-addressable`, `key-occupied`, `no-dispatch-operation`, `dispatch-rejected`, `external-dispatcher`).
  - **`.forEach()` and `.forEachSideChain()` accept `blocks`.** A per-item factory declares the blocks it can produce, so they are walked for dispatch addresses and merged for resources like a block-shaped call's element. A task board's drain uses it, which is what lets `defineFlow` refuse a flow that reaches a board with a hand-off seat but never declares the entry it addresses.
  - **A task board hands off through a dispatcher seat.** A seat under `workers` is a block; a `dispatcher({ name, type: "task", target, session: "per-task" | "per-worker" | { key: (task) => string } })` (`TaskDispatcherConfig`) in that position hands the seat's rows off to `flow.task.actions[target]` in the child session the policy names. A `task` dispatch carries `{ boardId, seat, taskId, attempt, createdAt, incarnationId?, payload }` (`taskDispatchInputSchema`, `TaskDispatchInput` from core), and the entry's gate re-reads the row and verifies the claim before the block runs. A refused hand-off throws the same `DispatchRefusedError` a `dispatcher()` block throws. An entry a `per-worker` or `key` seat hands off to defaults to `concurrency: "queue"` (an explicit policy wins); a `per-task` seat keeps the flow default. `board.handedOff` lists the seats that hand off; `createTaskGate`, `createHandOff`, `StaleTaskClaimError` and the `TaskSeatRegistry` type are exported from `@flow-state-dev/orchestration/task-board`. `TaskSessionPolicy`, `taskSessionKeyFor`, `bindTaskDispatcher` and `taskBindingOf` are exported from core for substrate code.
  - **A dispatched request is stamped.** It records `metadata.dispatch = { type, target, from, key?, ... }` under `source: "internal"` or `"task"`; the child session it runs in carries `topic` (the key) and `coordinate` (`"<type>:<target>"`) and is listed by `GET /sessions/:sessionId/children` like any other child of its parent.
  - **`task` and `internal` dispatches can never be re-entered** from a public route: retry, continue and resume refuse them, and `publicReentrySources` cannot re-open them.
  - **`createMockTransportHost` publishes `usesExternalDispatcher: false`**, matching the widened `InboundTransportHost` contract.
  - **The dispatch seam is not a named member of the block context** — reach it with `dispatcher()`, or in substrate code with `dispatchThroughSeam` and `markDispatcher`. The Workstream surface this protocol replaces is removed in the same release; see the Workstream-removal note for the renames.

- 4054c64: `dispatcher()` can reply to who dispatched it: `session: { from: true }` delivers into the seam-stamped sender, and a request with no trusted stamp refuses `no-sender` (FIX-1312, FIX-1171).
- fda9b15: Background work is declared with a task-board dispatcher seat and read back as child sessions: a session's children are listed at `GET /sessions/:sessionId/children` through `listChildSessions()` and `useSession`'s `childSessions` / `childSessionsStale`, session-scoped resources shared with them use `sharedToLineage`, and the two `createFlowState` options are `dispatchDrainTimeoutMs` and `maxChildSessionListLimit`; the Workstream surface they replace is removed, `ctx.requestHost.startDetached` and `dispatch: { mode: "detached" }` with it (FIX-1308). From `@flow-state-dev/orchestration/task-board` that removes the detached-mode helpers (`assertDetachedBoardSupported`, `detachedTaskPredicate`, `coordinateKey`, `coordinateLabel`, `workstreamRoutingSeed`, `WorkerCoordinate`, `TaskWorkerDispatch`, `TaskWorkerSlot`, `TaskWorkerSlotRegistry`, `TaskWorkerEntry`, `isTaskWorkerEntry`) and `board.detachedWorkers`; a seat is a block or a `dispatcher({ type: "task" })`, and `resolveWorkerSlots` now returns the bare blocks plus the `HandOffSeat`s (`name`, `label`, `dispatch`) in one walk from the hand-off module. A `{ worker, dispatch }` or `{ block, session }` seat is refused by name at construction. The DevTool's Children panel pairs a child with its task from the dispatch key a `per-task` or `per-worker` seat derives (a `{ key }` policy pairs nothing) and shows the entry it was dispatched for.

### Patch Changes

- 67b4157: `dispatcher()` can address another flow: `flowKind` on an `internal` or `task` dispatcher resolves `action` on that flow's matching entry map and starts the work there, fire-and-forget. `defineFlow` holds one flow's entry maps and skips the check, so the miss is a named runtime refusal — `flow-not-found` for an unregistered flow, `no-entry` for a registered one that declares no such entry — never a retry, a queue, or a fall-through to the sender's own map. A cross-flow `{ key }` child belongs to the addressed flow (its `flowKind`, its state defaults) and roots its own lineage; a reply is the same `{ from: true }` dispatcher pointed back at the sender's `flowKind`. Omit `type` — ordinary dispatchers send `internal`, and a task-board seat is a dispatcher whose `session` is `"per-task"`, `"per-worker"`, or `{ key }` (FIX-1297, FIX-1171 family). The entry-name field is `action`.
- 527c5ca: The DevTool now identifies flows by instance rather than by kind, so two registered copies of one flow each show their own sessions, requests and controls instead of one copy's work appearing under the other (FIX-1324).
- e2fda9d: Resource state writes now reject whole-row Zod `.catch()` fallbacks on the write path (FIX-1264), including when the catch sits under `.nullable()` / `.default()` / `.readonly()`, leaving the stored row untouched instead of persisting the schema fallback.
- ce85e80: Two registered copies of one flow definition can be set up differently: `defineFlow({ configSchema })` declares what a copy may carry, the factory call takes `config`, and blocks read it as `ctx.flow.config` (FIX-1331).
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

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-17 — Turn-aware history windowing (FIX-608)

Conversation history packing for generators now operates on turn boundaries — the server-side message-window helper packs whole turns from the end and never splits across token budgets.

### 2026-05-16 — Idempotency primitives on handler context (FIX-402)

`RequestStore` gains `getRunOnceResult` / `setRunOnceResult` to back the new `ctx.runOnce(key, fn)` primitive. Memory and filesystem adapters carry the table. Scope is request-local on purpose; crash-recovery dispatches that mint a new `requestId` start with an empty namespace.

### 2026-05-14 — Delta store verbs (FIX-405)

The in-memory adapter ships the optional `patchField` / `incField` / `pushToArray` verbs. `createScopePersist` feature-detects per call and falls back to `set` when an adapter doesn't advertise the verb. State-and-scopes architecture doc documents the routing decision tree.

### 2026-05-12 — Bash tool: MOAT sandbox adapter (FIX-584)

`createBashCapability` now returns a `cleanupBlock` alongside the capability — wire it into `defineFlow({ request: { onFinished: bashCap.cleanupBlock } })` to release sandboxes at request end. Required for MOAT to avoid orphaning containers; effectively a no-op for the other providers.

### 2026-05-12 — Block trace honors `transient` (FIX-586)

The auto-emit path now reads the originating block's `transient` flag and stamps it on the emitted `block_trace` item. Transient blocks stream their trace lifecycle live to active SSE consumers but rows no longer enter the persisted items log or replay on history reload.

### 2026-05-12 — DevTool: surface context on block failures (FIX-582)

Generator output-validation failures now throw `OutputValidationError` carrying `{ rawOutput, issues, phase }` so the raw model text and Zod issues survive to the trace instead of collapsing to a single message string. Author-thrown `FlowError.details` flows through to `block_trace.error.details` verbatim.

### 2026-05-11 — DevTool full resource visibility (FIX-579)

New privileged debug read surface under `/api/flows/sessions/:id/debug/resources*`. Returns the full server-side resource layer with per-entry `clientView`. Fail-closed — off by default, opt in via `debugEndpointsEnabled: true` on `createFlowApiRouter` or `FSDEV_DEBUG_ENDPOINTS=1`. Loopback-origin gate by default. **Breaking (internal):** the undocumented `include_internal_resources` / `include=internal_state` params on `/state` are removed.

### 2026-05-11 — Session-state schema defaults pre-applied (FIX-561)

`handleCreateSession` now parses an empty `body.state` (or any caller override) through `flow.session.stateSchema` before persisting, so a brand-new session's `state` already contains every declared key with its initial value. Caller-supplied `body.state` still wins; on schema-parse failure the handler falls back to the raw caller state.

### 2026-05-11 — Resource API: multi-segment topics (FIX-561)

`GET /sessions/:id/resources/:ref/:topic` (and `:topic/content`, `PATCH`, `DELETE`) now match topics that contain `/`. The route table uses `*topic` (path-to-regexp v8 wildcard); `stringifyParams` joins the captured array on `/` before the route builder runs. A topic literally named `"content"` remains shadowed by the resource-content route.

### 2026-05-10 — Scheduled actions: declarative cron (FIX-440)

New `schedules?` config block on `defineFlow` accepting a typed `static` map and a dynamic `resolve(scheduleId, ctx)` hook. Cron strings validated at registration for static entries and at dispatch for dynamic ones. New `createBearerSecretPrincipalResolver` exported for the canonical shared-scheduler-secret pattern, with constant-time `timingSafeEqual`. `RequestRecord.source = "scheduled"` plus structured `metadata` (`scheduleId`, `origin`, `cron`, `nominalFireTime`, `dispatchedAt`, `timezone`).

### 2026-05-07 — `useClientData` mid-stream state changes (FIX-576)

Scope-level `patchState` / `setState` / `incState` / `pushState` / `setStateRecord` / `deleteStateRecord` / `atomicState` now emit `state_change` SSE items with the matching `scope` value, where previously only sequencer / target-state writes emitted on the wire.

### 2026-05-07 — Container lifecycle: in-flight signal (FIX-574)

Server now emits `container` items with `status: "in_progress"` when a sequencer or router scope opens, then patches via `item.updated` when it closes. First public-channel item type to use the `item.updated` primitive.

### 2026-05-07 — Block trace unification (FIX-573) [BREAKING]

Server emits a single `block_trace` item per block run, replacing the old `block_output` / `block_debug` split. Block traces stream live: an in-progress trace appears when the block starts, with input, prompt, and output filled in via `item.updated` events. `block_tool_output` renamed to `tool_output`.

### 2026-05-07 — Action POST disconnect no longer kills runAction

The HTTP request signal is no longer propagated into `runAction` via `actionInput.signal`. A tab refresh or browser-side cancel of the originating POST no longer aborts the in-flight execution. Refresh midstream now resumes against the still-running request.

### 2026-05-07 — Store-driven live tail (FIX-569)

The in-process active-streams registry is replaced by `RequestStore.subscribeToEvents`. SSE clients can now tail an in-flight request from any instance. `getEvents` widens with optional `fromSequence` for cursor reads. Conformance harness `createRequestStoreConformanceTests` shipped via `@flow-state-dev/engine/testing`. Long-running flows are no longer at risk of registry eviction; the legacy 5-minute TTL is gone.

### 2026-05-07 — Lazy collection state, query interface, resource manifest (FIX-427) [BREAKING]

New paginated list endpoint (`GET /sessions/:id/resources/:ref?limit=&offset=&topicPrefix=`) and single-item state endpoint. Pagination returns `{ offset, limit, total, hasMore, nextOffset }`. New manifest endpoint (`GET /sessions/:id/manifest`) describes every public resource on a flow.

### 2026-05-07 — `item.updated` SSE event (FIX-572)

New `item.updated` event with `{ itemId, patch }` shallow-merge semantics. New `emitItemUpdated(itemId, patch)` on `ResponseEmitter`. Updates for an unknown `itemId` are dropped with a debug event; updates after `item.done` apply normally.

### 2026-05-07 — Filesystem trace store + dev defaults (FIX-558)

New `FilesystemTraceStore` and `createFilesystemTraceStore`. Registry factories now pick `traceStore.maxRequests` from environment — 1000 when `NODE_ENV=development`, 50 otherwise; explicit config wins. New `createTraceStoreConformanceTests` helper exposed at `@flow-state-dev/engine/testing`. Trace events now survive `fsdev dev` and kitchen-sink `STORE_TYPE=filesystem` restarts.

### 2026-05-07 — Lift `.sideChain()` background tasks (FIX-554) [BREAKING]

The request executor now drains a single per-request background-task pool exactly once before terminal status. Inner sequencers no longer auto-await their own list. The SSE stream stays open until the drain completes; `sideChainTasks: N` status emissions reflect the request-level pool count.

### 2026-05-06 — `clientData` privacy fix + rename (FIX-505) [BREAKING]

The default session snapshot route no longer ships `response.state`. DevTool escape hatch: `?include=internal_state` re-attaches raw state under `internalState`. `FlowClient.state.getSessionState/getUserState/getOrgState` removed.

### 2026-05-06 — Trace channel separation, `step_error` removed (FIX-506) [BREAKING]

New `traces: TraceStore` on `StoreRegistry` with in-memory (default 50 requests, 5 MB/request) and SQLite implementations. Trace items ride the same SSE wire but are server-filtered by default; subscribe with `?include=trace`. The `?unfiltered=true` query param is renamed and gone. `emitWorkStepError` removed.

### 2026-05-06 — `mapModelOutput`

The AI SDK v6 bridge now passes `toModelOutput` from a tool block's `mapModelOutput` so providers materialise next-turn tool-result content from the mapper's string. Devtool inspection emits a transient `block_debug` carrying the mapper output, gated by `FSDEV_TRACE_OBSERVABILITY`.

### 2026-05-02 — MCP server adapter (FIX-22)

`createFlowApiRouter` now accepts `adapters: [createMcpTransportAdapter()]`. Every flow with `mcp.enabled: true` becomes its own MCP server at `POST /api/flows/:kind/mcp`. Authentication runs through the existing `host.resolvePrincipal` hook; `PrincipalResolutionError` maps to HTTP 401 + JSON-RPC `-32001` with `WWW-Authenticate: Bearer realm="MCP"`.

### 2026-05-02 — Memory pipeline + naming reliability fixes

Server-side `itemToLLMMessages` now reads `bto.toolCall.alias ?? sanitizeToolName(bto.toolCall.name)` so historical tool-call/tool-result replay carries the same model-facing name the model produced on the original turn.

### 2026-05-02 — Resource content moved out of scope records (FIX-347)

Execution context, state routes, and resource routes read and write content through `stores.content` directly. The legacy on-record content path and its merge logic are gone. Filesystem adapter writes each resource as a real file under `data/content/<scope>/<id>/<key>`. Operators upgrading from a build that persisted inline content must copy each record's old `resourceContent` map into `ContentStore` before deploying.

### 2026-05-01 — Per-scope FIFO mutation queue (FIX-492)

Server-side in-memory state container now serializes mutations through a per-`StateContainer` FIFO queue. External-store scopes (filesystem, sqlite, postgres) keep optimistic CAS. New `flow.request.mutationTimeoutMs` (default 30s) bounds worst-case waits.

### 2026-04-30 — `emit*` default-transient decouple (FIX-478)

`ctx.emitMessage()` / `emitComponent()` defaults changed at the emitter layer — neither now inherits the producing block's `transient` flag. Documents the **keyed snapshot** pattern (component item with stable `key`, latest-wins per `${requestId}:${key}`).

### 2026-04-30 — SSE noise reduction (FIX-477)

`applyMutation` now no-ops when the proposed next state deep-equals current — no persist, no `state_change` SSE emission, helper returns `false`. New `transientSlot()` helper for sequencer state fields that should never appear on the wire or in checkpoints.

### 2026-04-30 — `content.delta` non-replayable (FIX-479)

`content.delta` events no longer persist to the events log and no longer await the `flushEvents` durability barrier. Per-token disk round-trips no longer serialize concurrent worker streams. Live SSE consumers, devtool observers, and the in-memory event buffer continue to receive every delta.

### 2026-04-30 — Connection resilience (FIX-476)

Server emits `: ping\n\n` SSE comment frames on every live and GET-attach response (default 15s). Heartbeat injection moved out of `@flow-state-dev/vercel` so every deployment gets it. New server-internal sweeper marks `in_progress` requests whose executor heartbeat stopped as `interrupted`. New read-only `GET /api/flows/:flowKind/requests/:requestId/status` endpoint.

### 2026-04-29 — Per-flow authentication (FIX-23)

`createFlowApiRouter({ resolvePrincipal })` adds the host-level fallback. New helpers: `createHmacVerifier` (webhook signatures with timestamp tolerance and constant-time comparison), `createHs256JwtVerifier`, `extractBearerToken`. `requireUser: false` and `requireOrg: true` are enforced at the action route.

### 2026-04-29 — Inbound transport adapter contract (FIX-438)

New `InboundTransportAdapter` contract. Every entry point — HTTP, MCP, webhooks, scheduled actions, custom transports — implements the same factory shape. `createFlowApiRouter` ships with a built-in `HttpTransportAdapter`; new `adapters?: InboundTransportAdapter[]` option mounts additional transports with path-collision detection. `source` is a first-class field on `RequestRecord`.

### 2026-04-28 — Interrupted-request recovery

New `POST /api/flows/users/:userId/check-interrupted` endpoint sweeps stale `active_requests` and transitions matching `in_progress` records to `interrupted`. Long-running dev servers and serverless deployments now have an on-demand reconciliation path.

### 2026-04-28 — Generator debug capture: user messages

`BlockDebugPayload` adds optional `user` and `history` fields capturing the user-slot messages and resolved conversation history sent to the model. Gated by `FSDEV_TRACE_OBSERVABILITY=true`.

### 2026-04-28 — Durable sequencer checkpoint schema (FIX-401)

`CheckpointStore` implementations for memory, filesystem, SQLite, and Postgres. Resume-from-checkpoint runtime is a follow-on.

### 2026-04-26 — Org scope rename (FIX-428) [BREAKING]

Server-side rename of `project` → `org` in stores, routes, and request handling. Action route rejects requests against unbound sessions with `400 OrgRequired` when a downstream block declares `requireOrg: true`.

### 2026-04-24 — Cross-flow schema registry + per-flow isolation (FIX-431)

`FlowRegistry.register` collects every non-isolated flow's user/project schemas and throws `CrossFlowSchemaConflictError` at registration time on incompatible declarations. New `FlowRegistry.describeSharedSchemas()` for diagnostics.

### 2026-04-11 — DevTool: View Sequencer State (FIX-348)

Sequencer state-snapshot trace items emitted at each step boundary on the server side, captured into the trace store for both live and replay.

### 2026-04-11 — `defineCapability()` (FIX-351)

Server-side runtime wiring for capability installation, transitive composition, and `ctx.cap.{name}.{fn}` memoized helper resolution.

### 2026-03-20 — Resource Namespaces (FIX-98)

Full server runtime for namespaces in `createExecutionContext`: flat storage model (instances coexist with static resources), schema validation on create, eviction persistence, and hook context wiring.

### 2026-03-01 — Sequencer container item emission (FIX-8)

Server execution/context wiring emits `container` stream items whenever a scoped sequencer/router frame with container config is entered.

### 2026-03-01 — Block resource declarations (FIX-92)

Server wiring for the declared-resources pipeline: flow scope configs honor block-collected `sessionResources` / `userResources` / `projectResources`.

### 2026-02-27 — Server runtime logging improvements

Added structured action/block execution logging with default console output, bounded payload summaries, retry visibility, and terminal error logs. New `RuntimeLogger` hooks (`logger` option on `runAction` / `executeBlock`) plus reusable helpers (`DEFAULT_RUNTIME_LOGGER`, `summarizeForLog`, `createExecutionLogContext`).

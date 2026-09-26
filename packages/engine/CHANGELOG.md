# @flow-state-dev/engine

## 0.3.0

### Minor Changes

- b75c1ed: `fsdev run` and `fsdev chat` now run as whoever the app's resolver names (new `FlowState.resolveInProcessPrincipal`, with `source: "cli"` reserved for it), stop with exit 2 before writing anything when that resolver or a seat's pin refuses the terminal (a `--session` owned by another user or organization now also exits 2 instead of 1), and take `--org`/`--user` to name the identity locally (FIX-1551).
- 211679a: New core block kind: `evaluator` (FIX-1554). It asks an evaluation model typed questions (`choice`, `score`, `boolean`) and returns typed answers, with the model's confidence when it reports one. Model strings resolve through your existing providers and gateways; models that can only generate are refused before any call. `BlockKind` and the trace's `blockKind` gain `"evaluator"`: code that switches on block kind should handle it. `ai` minimum raised to the first release with evaluation. `@ai-sdk/typesafe-ai` is an optional peer. `ModelResolver` gains an optional `resolveEvaluationModel`; a custom resolver without it runs generators as before and refuses evaluator model strings. Evaluation through Vercel's AI Gateway needs `@ai-sdk/gateway` 4.0.85 or later. `@flow-state-dev/testing` adds `mockEvaluationModel`.
- 712dc22: A hired seat now keeps what it saves for a person (shared user-scoped resources and user state) under one user-scope key per organization and person, `<userId>:~org:<orgId>`, so the same person's seat in another organization starts empty and no seat reads the person's app-wide data; data seats saved before upgrading is not read for them until you run the optional offline copy in the persistence docs under "Upgrading: moving hired seats' stored data" (FIX-1538).
- 7d4c413: Resource collections can be declared owner-private with `ownerPrivate: { param }`, and `ownerSegment(userId)` builds the owner key segment. Key segments beginning `~` are reserved for owner-private collections in every app, and flow registration refuses a single resource whose key has one. `defineResourceCollection` and flow registration no longer refuse collection patterns on Workforce's account, and `@flow-state-dev/core` no longer exports `assertRosterCollectionIsNotDeep`. Workforce's private roster collection is now owner-private; its refusal messages name the owner-private collection instead of the roster (FIX-1549).
- a64132b: `InstancePinMismatchError.reason` is `"owning-user"` where it was `"roster-owner"` (FIX-1549).
- 8195995: Schedule index rows are now identified by the storage cell the schedule lives in plus its key, so a person's same-named schedules in two hired seats (or a seat and their app-wide flow) are two rows and turning one off no longer stops the other (FIX-1546). `ScheduleIndexRow` gains a required `cell`, `ScheduleIndex.remove` takes `{ cell, key }` instead of `(userId, key)`, and `CollectionHookContext` gains `cell`, the storage key the instance is persisted under. A custom `ScheduleIndex` must key its storage on `(cell, key)` and store `cell`; the conformance suite covers it. The SQLite and Postgres `schedule_index` tables are re-keyed on `(cell, key)` automatically at schema init, adopting every existing row as its person's own cell; with `skipSchemaInit: true`, apply the upgrade SQL in the schedule index reference. BullMQ scheduler ids are built from the cell and key; an app-wide schedule for an ordinary user id keeps its existing scheduler id.

### Patch Changes

- e4fb1f1: `GET /api/flows` now lists a pinned flow instance that has its own `authentication.resolvePrincipal` to the callers that resolver accepts and the pin matches, the same callers who can already open and run it (FIX-1552).
- 538cd1a: `POST /api/flows/users/:userId/check-interrupted` now only reports and sweeps in-flight requests in the caller's own tenant (the tenant header, `x-tenant-id` by default), so a caller on one tenant can no longer see another tenant's request ids or mark its live requests `interrupted` (FIX-1569).
- 585b75b: `POST /api/flows/users/:userId/check-interrupted` and `createRecoveryClient().checkInterrupted({ staleThresholdMs })` now use the larger of the caller's `staleThresholdMs` and the server's `staleSweepThresholdMs`, so a smaller, zero, or negative value sweeps as if it were left out and a request that is still heartbeating is never marked `interrupted` (to sweep sooner, lower `staleSweepThresholdMs` on the server) (FIX-1571).
- 1355483: The debug resource endpoints no longer list, count, or return another user's user-owned hired seats, and fetching content for a collection topic that doesn't match the collection's pattern now returns 404 (FIX-1535).
- 8a55e23: A dispatch into a hired seat whose pin the sending session is outside now refuses at the seam as `flow-not-found`, the same answer an unregistered address gets, before any child session is written. A task board handing a row to such a seat now fails that row with the refusal instead of leaving it claimed until its lease lapses (FIX-1534).
- 01b29f0: A hired seat stays with the organization and user that hired it, so another organization or roster peer cannot list, open, or run that seat (FIX-1529).
- afb512f: `ItemQuery` gains `includeInFlight`: pass `false` to `ctx.session.items.history()` (or `all()`, `client()`, `selectForContext()`) to get earlier items only, without the items the current request has produced so far (FIX-1595).
- c57890d: `GET /api/flows/sessions` and `GET /api/flows/active-requests` now list the rows of a flow instance that has its own `authentication.resolvePrincipal` to the callers that resolver accepts as their owner (and the instance's pin admits), the same callers who can already open those sessions (FIX-1566).
- 0503c38: A schedule created with `schedules.create(key, { cron, kind, enabled })` on a `defineScheduleCollection` collection now fires and keeps firing after a reschedule: the resolver reads the row from resource state (`ScheduleResolutionStores` now requires `resourceState`), and a new `stampOrgId` collection option records the creating run's organization on the row, keeps it across updates, and refuses any write that names another organization (FIX-1545).
- 8b8ba8d: Served requests that die during setup now settle as `failed` instead of hanging at `in_progress` (FIX-1511).
- 64b3ed7: `ctx.session.appendJournal` and `ctx.session.setMetadata` no longer overwrite session state or journal entries another request committed meanwhile: they now write at the version they read, retry on conflict, and throw `ConcurrentModificationError` once retries run out (FIX-1376).
- Updated dependencies [53b50f0]
- Updated dependencies [8dc242e]
- Updated dependencies [7d4158f]
- Updated dependencies [211679a]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [a7f1c41]
- Updated dependencies [7d4c413]
- Updated dependencies [3311cc2]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [407964a]
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

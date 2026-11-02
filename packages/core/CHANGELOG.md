# @flow-state-dev/core

## 0.4.0

### Minor Changes

- 824ce87: `resourceTools()`'s `readResource` now reads only from a collection that opted in with `llmReadable`, and leaves out the fields the collection names in `secret`. A path into a collection that didn't opt in answers as a path no collection matches. Mark a collection `llmReadable: true` if a model should read its state through this tool (FIX-2436).

### Patch Changes

- 387bee2: A durable sequencer saves its state at a suspension, and restores it before the resumed step runs. A `patchState` a step makes before `ctx.suspend()` or `ctx.suspendForUser()` is now kept across a restart, and the re-run of that step reads it. Sequencer-state writes the step made before the pause (including `incState` and `pushState`) apply once: when the re-run reaches the pause, the sequencer's state is set back to what was saved there, and writes after it apply as usual. A request that was already parked before this change resumes as it did before (FIX-2444).
- Updated dependencies [387bee2]
  - @flow-state-dev/contracts@0.2.1

## 0.3.0

### Minor Changes

- 92b2b70: A conversation longer than its history window can keep what it said before the window (FIX-1613). `utility.historySummary({ summarize })` returns a `capability` for the generator that answers and a `fold` step to run before it: the fold writes the turns about to leave the window into a running summary, the capability hands that summary to the model and starts the generator's history after it. A capability preset may now declare `history` (a query added to that generator's history reads; generators only). The engine records `historyStart` on a request when earlier turns are out of view, exposes `ctx.session.window`, `ctx.session.items.turns()` and `history({ afterRequestId })`, and the client's request summary carries `historyStart`. Workforce's `defineAgentWorkerFlow` takes `beforeAnswer`, a block run before the worker answers.
- 5d31955: A flow can declare `reads`: blocks an app runs on a session to look at something the flow computes, stored nowhere. The engine serves them at `POST /:flowKind/:sessionId/reads/:readName`, answering `200 { output }` with no request record and no concurrency slot; any write a read's block tries is refused with `read_only`, and another user's session answers 404 as the action route does. The client calls one with `flow(kind).read(name, input, { sessionId })`. Orchestration adds `taskToolReads(collectionId, resolve)`, the `listTasks_<suffix>` listing as a read, and Workforce's coordinator and agent-worker flows now serve `listTasks_tasks` as a read, so an app polling a conversation's task board no longer stores a request per poll. The action of the same name is unchanged (FIX-2286).
- bea14a0: A coding harness's plan now lasts as long as its conversation. Core adds `harnessConversationNamespace(conversationId)`, `planConversationPrefix(conversationId, key?)` and `readPlanTarget(requestId, markers)`, which finds a request's plan from the pointer its run left (`conversation` on the run's `observed-plan-list` marker) or falls back to the request's own per-run rows. Plan rows gain a nullable `requestId`, the request that last wrote them, and `replacePlanList` takes it as an option. The Claude Code block (`recordWork`) keys plan rows by its session id and the Cursor block (`recordPlan`) by its agent id, so a later turn keeps the titles and progress an earlier one recorded; file-operation rows stay per run (FIX-2259).
- 24afa6e: A question is one kind of task hold (FIX-2317, FIX-2131, FIX-2133). The two ways to stop for the user are named for what stops, and a task's open stops live in one list.

  - **`suspendForUser`** (new) suspends the request and resumes it with the answer: `ctx.suspendForUser({ kind, prompt, deadline? })` in `core`, `suspendForUserOn`, `createSuspendForUserTool`, `SuspendForUser`, `SuspendForUserOptions`, `SuspendForUserContext`, `SuspendForUserCancelled`, and `SuspendForUserKind` / `suspendForUserKindOf` (`contracts`, re-exported by `core`). `kind` is `"approval"`, `"review"` or `"input"`.
  - **`holdTaskForUser({ question })`** holds the task until the user answers, built with `createHoldTaskForUser`. The turn ends; the next turn on the same attempt spends no retry.
  - **`Task.holds`** lists what stops the task being claimed until the user answers. There is no `kind` field on a hold: an entry is told apart by `source.kind` (`"row"` or `"suspension"`) and `ask.kind` (`question`, `confirm`, `approval`, `review`, `input`). `getTask`, `listTasks` and Inbox items list `holds`.

  `createTask({ questions })` files a task that stays `pending` until each question is answered: a plain string is a question, `{ kind: "confirm", prompt, onNo? }` asks for a yes or a no. Answer with `updateTask({ id, answers, message })`. The Inbox client's `answerOne` takes `questionId`. A deadline applies only when the host sets `userDeadlineMs`.

  **Breaking, from the last publish.** The `parked` status is gone, with `counts.parked`, `TaskCollectionRef.awaitReview` / `unpark`, `board.unparkAndDrain`, a board's `onReview`, and `@flow-state-dev/react`'s `BOARD_STATUS_COLUMNS` `parked` column. Ask for a review with `ctx.suspendForUser({ kind: "review", prompt })`. The filer's hold is unchanged: status `held`, `hold()`, `release()`. `keptOpenBy: "suspended"` means the task's own request is suspended. Stores are reset: a stored `parked` row is not read. Also removed with `parked`: `TaskTransitionOptions.refuseWhenParked`, `CheckBoardOptions.excuseParked`, the `"parked-for-review"` termination reason, the `"review_requested"` change kind, the `"parked"` write-decline reason, `unparkAndDrainInputSchema` / `UnparkAndDrainInput`, and the task-board exports `TaskBoardOnReview` and `assertParkExitSupported`. React no longer maps a legacy `awaiting_review` card status. `TaskClaimTicket.turn` is required: every claim advances the row's `turn`, and a ticket from an earlier turn of the same attempt is declined `lost-claim`.

  A row stored with `questions` still reads as `holds` (`withRetiredShapes` from `@flow-state-dev/orchestration/tasks`). Shift Manager and the DevTool read them as holds.

- e2c190e: A running coding turn can take a message mid-turn (FIX-2254). Core declares the optional harness hook `onSteerable(steer | null, ctx)` (`HarnessSteer`, `HarnessSteerHook`): a harness whose run can take a line calls it with a `steer` that answers `"delivered"` or `"refused"`, and with `null` when the turn is over. `cursorAgent({ onSteerable })` offers Cursor's own run steering on local runs, through the `env` process too. The harness manager hands down `onSteerable` as an optional fifth feed; passed through, a message sent to the task while a step runs goes straight into that step, with no stop, extra step or new attempt. A line the run refuses is taken by the next step, as before.

  `autoResume: false` on an action (core's `ActionCore`, honoured by the engine) keeps a request on it from becoming its session's auto-resume target (`latestRequestId`), so a control sent beside a running request, such as that line, doesn't stop a reloading client from reattaching to the running one.

  Any app can steer a harness turn run in a session: `harnessSteering()` in core keeps each session's offer and builds the `steer` action (`{ taken, live }`), and the client's `sendHarnessLine` and `steerRunningTurn` send a typed line into the running turn, falling back to the next turn when it isn't taken.

- 0d55d46: A session keeps a record of the pull requests it opened (FIX-2268). Core adds the `observed-pull-requests` collection (`observedPullRequestsCollection`), one writer (`writePullRequests`), a replaceable GitHub rule (`githubPullRequestRule`, `DEFAULT_PULL_REQUEST_RULES`) and the recorder: `recordPullRequests(ctx)` for a block, and `pullRequestRecorder()` for a flow with no harness to add as a `.tap` step. A `gh pr create` command or a `create_pull_request` tool whose output holds the link is one row, written as the call settles. Each row carries the `requestId` that opened it.

  The Codex, Claude Code and Cursor blocks record by default; `recordPullRequests: false` turns it off. Workspace adds `recordBranchPullRequests`, a host-side check that asks GitHub through `gh` which pull requests a checkout's branch has. The harness manager declares the record and runs that check before its verdict and when a run fails.

  **Migration.** A Codex, Claude Code or Cursor block now declares the `observed-pull-requests` session collection by default. A test that asserts the block declares no resources must pass `recordPullRequests: false`.

- 58ffc93: Add `block.as({ name?, description? })`: a copy of any block under a new name and/or description, for showing it to a model as a tool or registering it under a catalog key that must match its name. The copy's name is used everywhere, in tool calls, items, traces, errors and resume; the original block is unchanged. No wrapper is added at run time (FIX-1811).
- f97b0ed: The task board's last old words are gone (FIX-2246), with no alias and no old spelling read. Stores written by an earlier version are not upgraded: a request left in flight across the upgrade may not resume.

  - `@flow-state-dev/workforce`: a coordinator's routing record and a routed task's brief name the message by `messageRequestId`.
  - `@flow-state-dev/orchestration`: a task notice's waited-on flag is `waitedOn`, the word `listTasks` uses. A wait gate's id starts `wait:`. The board's dispatch blocks are named `<board>-dispatch-<assignee>` and `<board>-dispatch-fallback`.
  - `@flow-state-dev/core`: `isWaitGate` is true only for a gate with the reason `"wait"`.
  - `@flow-state-dev/engine`: a wait gate the waiting turn's own conversation resolves records `wait:<session>` as its resolver.

- 62133c4: Add the `hold` and `defer` concurrency policies. A `hold` request runs at once and marks its key busy while it runs; it never waits and is never refused. A `defer` request waits until nothing on its key is running or waiting, then runs, so follow-up work for a conversation lands after the current reply instead of beside it. Deferred requests run one at a time, and the wait ends when the request ahead settles, or when a crashed process's place on a shared lease backend expires. At most 32 deferred requests wait on a key per process; the next is refused with the new `ConcurrencyDeferLimitError` (a `ConcurrencyRejectedError`). A deferred request yields to newer `hold` requests for 30 seconds, then waits only for the ones it found. Both policies apply to in-process runs; a run handed to an external dispatcher under either runs as `allow` (FIX-1834).
- d5ce1e0: A worker can answer a question from another of the user's conversations without waking it (FIX-2173).

  - `requestHost.sessions.history(sessionId, { limit })` reads a session's finished turns, oldest first, with `asOf` and `running`. Like `sessions.read`, it answers only for the caller's own sessions; anything else reads as `undefined`.
  - `utility.consultSessionHistoryTool()` (core) reads that history under a hard token budget (default 24,000) and answers on one tool-less generator, `intent/utility` by default. It returns a reading as of a time, and writes nothing to the other session.
  - `consultSessionsCapability(installation)` (workforce) puts it on a worker's turns as `consultSessionHistory`, with `of` naming a worker, `{ task }` or `{ session }`. Its `consult` preset is off until a worker's `WORKER.md` names `consultSessions: [consult]`. Set `models: { default, intents: { utility: [...] } }` in `createFlowState` to pick the cheaper model.

- 5492a77: A board can start work on another worker now: on a board that dispatches (a Workforce conversation's, or one built with `{ dispatches: true }`), a task is handed over as soon as it is filed, and one filed held waits until it is released. Filing a task never waits: it refuses `waitForResponse` and `timeoutMs` by name. The wait names are renamed with no alias (`canHoldAsk` → `canHoldWait`, and the rest of the `Ask` names to `Wait`) (FIX-1875).
- 6819520: A task board that starts a row on another worker now **dispatches** it; **hand-off** means only passing work that is already under way (FIX-1876).

  - The board's ending for "every remaining row is running in a dispatch run" is now `terminationReason: "dispatched"` (was `"handed-off"`).
  - The row-dispatch block's output is now `{ dispatched: true, taskId, sessionId, requestId, adopted }` (was `handedOff: true`).

  The old exports are gone, with no alias, so an import of one fails to compile and names it:

  - `@flow-state-dev/orchestration`: `createHandOff` → `createRowDispatch`, `HandOffOptions` → `RowDispatchOptions`, `HandOffAssignee` → `DispatchingAssignee`, `handedOffTaskPredicate` → `dispatchedTaskPredicate`, `assertHandOffBoardSupported` → `assertDispatchBoardSupported`, `assertHandOffBlockSupported` → `assertDispatchEntrySupported`, and the board handle's `handedOff` → `dispatchers`.
  - `@flow-state-dev/core` and `@flow-state-dev/engine`: no export changes. Definition-time and run-time refusals say a block "dispatches to task:…" where they said it "hands off to task:…".

  The task-board page's "Assignees that hand off" section is now "Assignees that dispatch"; the old anchor still lands on it.

- ad5df6f: Durable execution is on by default wherever stores persist (FIX-2063). `createFlowState` over filesystem, SQLite or Postgres stores now installs the checkpoint durability provider without `durable: true`; over in-memory stores it still installs none unless `durable: true` is set. `resolveDurabilityProvider({ stores, durable })` exports the rule for hosts that build `createFlowApiRouter` or call `runAction` themselves, and the in-memory checkpoint and suspension stores declare `persists: false`.

  `ctx.suspend()` on a host without durable execution now throws an error that names the rule and the setting to change, instead of "requires a DurabilityProvider". The durability sweeper arms for a pending stop's deadline as it does for a wait's, and reads the store's deadlines once at start.

  A no-config `fsdev run` now writes to `.fsdev/data/fsdev.db` (the SQLite file `fsdev dev` reads) instead of JSON files under `.fsdev/data`, and runs as `devuser`, the DevTool's default user (exported as `DEFAULT_LOCAL_USER_ID` from `@flow-state-dev/core`), instead of `cli-user`. `fsdev run` and `fsdev chat` use `devuser` as the default user with a config too. A run that stops for a person exits 0 with a `suspended` NDJSON event, `result.suspended` in `--capture`, and a waiting report on stderr. The no-config `fsdev dev` router is durable and sweeps. `--store filesystem` on `fsdev run` and `fsdev dev` keeps the JSON-file store, single-process.

  **Migration.** An app on persisting stores that never set `durable` now:

  - writes a checkpoint at every step of every sequencer (sequencers already default to `durable: true`),
  - resumes a request that crashed instead of rerunning it,
  - holds a raw `ctx.suspend()` until it is answered, where it used to fail the request,
  - runs the durability sweeper wherever it serves a router: a lease and a scan of pending stops on each tick, even when nothing waits.

  Set `durable: false` on `createFlowState` to keep the old behavior. Sessions a no-config `fsdev run` wrote as JSON files are not read by the SQLite default; pass `--store filesystem` to read them. Scripts that look up CLI sessions by `cli-user` should use `devuser`, or pass `--user cli-user`.

- 211679a: New core block kind: `evaluator` (FIX-1554). It asks an evaluation model typed questions (`choice`, `score`, `boolean`) and returns typed answers, with the model's confidence when it reports one. Model strings resolve through your existing providers and gateways; models that can only generate are refused before any call. `BlockKind` and the trace's `blockKind` gain `"evaluator"`: code that switches on block kind should handle it. `ai` minimum raised to the first release with evaluation. `@ai-sdk/typesafe-ai` is an optional peer. `ModelResolver` gains an optional `resolveEvaluationModel`; a custom resolver without it runs generators as before and refuses evaluator model strings. Evaluation through Vercel's AI Gateway needs `@ai-sdk/gateway` 4.0.85 or later. `@flow-state-dev/testing` adds `mockEvaluationModel`.
- 2ce15c7: Every ending of a delegated task reaches the session that filed it once, on any flow, and nothing a board owes waits for someone to touch it (FIX-2078).

  - **`onTaskSettled`.** A board that hands rows out records each ending's notice in the ending's own write and sends it to the filing session's `onTaskSettled` internal action. Build that action with `taskSettledEntry({ block })` (exported with `taskSettledInputSchema` from `@flow-state-dev/orchestration`): it takes each notice once, runs your block, and acknowledges it. A filed task now records the session that filed it (`Task.filer`, server-written).
  - **Cancels are heard.** A cancel the filer didn't make itself through its own task tool now sends a `cancelled` notice, and a failure or cancel notice names the dependents it cancelled (`cancelled`). A waited-on task resumes its waiter and sends no notice; a retry sends none.
  - **Due times.** Each owed notice has a due time, two seconds after its ending (`NOTICE_DUE_MS`). The board's pass resends only what is past due, and on a durable host the engine's wake pays it when due, after a crash too. One pass runs at a time per session; a pass asked for while one runs waits its turn.
  - **Workforce:** a final task failure goes to the Error Reporter's intake with its ending, before the notice is acknowledged, as the task occurrence it already dedupes. A report marker stored by an older version is sent once and dropped. A ready row starts on its own, without a touch.
  - **Upgrade.** Call `backfillBoardWakes(stores, { userCell })` (`@flow-state-dev/workforce`) once at host start, after the router is built: it owes a wake for every session holding a notice, report or split settle stored before this release, so its pass pays it without a touch. It is idempotent (a wake coalesces, and a pass that finds nothing clears it), and reads every user's conversation rows, so a host with many users runs it once, as a migration step. Shift Manager calls it at start.
  - **Core:** `RequestHost.wakes` (owe, read, settle, `maxDebtAgeMs`), present on durable hosts whose stores keep wakes, and `TaskBinding.requiresInternal`.
  - **Task tools:** a task's metadata from a caller (a tool call or a `_tasks` action) can't set or clear a notice marker. `cancelTask` answers `{ ok: true, cancelled: [ids] }` when its cancel also cancelled dependents. A notice its entry keeps refusing is resent with a doubling gap, up to 5 minutes.

  Migration, at upgrade, for teams outside the repo:

  - `resumeOwedWaits` is removed: the board's due-time wake pays an owed resume and a cancel owed.
  - A board that hands rows out (a dispatcher assignee, or a delegation board) on a flow with no `onTaskSettled` internal action is refused when the flow is built. Add `internal: { actions: { onTaskSettled: taskSettledEntry({ block }) } }`.
  - An `onTaskSettled` handler now receives `cancelled` endings.

- a55d07f: `defineFlow` now throws when the flow's own `resources` map declares an accessor a block also declares, with a different `defineResource()` reference. The flow's entry used to win silently, so the block read and wrote a resource it never declared. Use the block's reference, or pick a distinct accessor key (FIX-1586).
- 7db4d13: `defineFlow` takes `resourceVisibility`, a per-turn rule for which of the flow's resources the model's resource tools reach. A resource it hides is absent from listing, search and the discovery door, and answers "not found" when named; a read-only one is read but not written. Omitted, nothing changes (FIX-1788).
- fe5df7d: A request waits on a task it filed with `getTask({ id, wait: true, deadline? })`, now or in a later request, and gets the task back once it ends or as it stands at the deadline (FIX-2082). The deadline cancels nothing: the task runs on, and an ending that lands while the request still runs reaches it on its next `getTask`; one it never reads goes to `onTaskSettled`, once. A task's own request may wait too, and waits nest up to five deep, counted live. A wait's deadline is a wake on the waiting session, so a restart keeps it. Use `waitOnTask(ctx, board, id, { key })` from `@flow-state-dev/orchestration/task-board` when the wait is in application code rather than a tool.

  - `dispatcher({ wait: true })` waits for the request it starts and outputs `{ status: "completed" | "failed" | "running", output?, error?, requestId }`.
  - On a plan board a row filed `session: "new"` runs in a session of its own through `taskBoard({ newSession })`, and the drain waits on it. A plan board may hold dispatchers, whose rows it waits on; a plan board's dispatcher with `wait: false`, and a delegation board's with `wait: true`, are refused. In Workforce, a worker's step filed `session: "new"` runs in a new session of the same worker.
  - `canHoldWait(ctx)`, `dispatchWaitResultSchema` and `DispatchWaitResult` are exported from `@flow-state-dev/core`; `RequestHost.waits.ended(requestIds)` says whether a request has stopped running its work, and `checkWait` (orchestration) runs a wait's checks alone.
  - Hosts set a wait's deadline bounds with `waitDeadlines: { defaultMs, minMs, maxMs }` (5 minutes, 1 s, 24 h by default). A wait needs a store that keeps wakes. `parkOnWait` takes a `deadline` (epoch ms) and returns the `WaitOutcome`.

- 7da156e: Organization ids are now validated as well-formed, non-blank Unicode everywhere (resolver, `runAction`, dispatch, BullMQ jobs, schedules, `fsdev run --org`) and seat addresses escape any such id, while route segments are decoded exactly once on every host (`parseFlowRoute` now takes decoded segments, built from a raw URL by the new `decodePathSegments`), so escaped seat ids resolve on Next and Vercel and stored rows or queued jobs with a lone-surrogate org id are now refused (FIX-1757).
- 3a6c910: New `GET /api/flows/users/:userId/interrupted-requests` lists a user's interrupted requests every time it is called, including ones a sweep marked before the call; `check-interrupted` still sweeps and answers only what that call marked. Both lists now name each request's `flowId` (falling back to `flowKind` for older records). `RequestStatusSnapshot` gains `sessionId`, and the status route now answers 404 for a request in another tenant or of another principal. New `createInProcessFetch(app, { basePath? })` returns a fetch-shaped function that dispatches to the engine in this process, for a client's `fetcher`; `@flow-state-dev/node`'s `createServerApp` dispatches through it (FIX-2162).
- 849f6ec: Built-in model defaults move to the current generation (FIX-2050). `utility.sessionTitleGenerator`, `utility.decomposer`, the `planAndExecute` / `routedSpecialists` pattern defaults and `workingMemoryObserve` now default to `gpt-6-luna`, as do Shift Manager's Lab default model (`LAB_DEFAULT_MODEL`) and its DevTeam workers (previously `gpt-5-nano`, `gpt-5.4-mini`, `gpt-5-mini` or `gpt-4o-mini`). Pass `model` explicitly to keep the old one. The cost tables in `core` and `testing` now price `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna` and Claude Opus, Sonnet and Haiku 5.5.
- 028af6f: **Breaking:** model strings now name a route with a colon, as in the AI SDK (`vercel:anthropic/claude-sonnet-5`, `openai:gpt-5.4`, or a `providers` key such as `triage:native`), multi-hop `gateway/provider/model` slash strings are rejected with an error naming their colon spelling, and `ParsedModelString` is now a discriminated union with no `"gateway"` kind (FIX-1495).
- eb831f8: The scheduled-dispatch endpoint fires each scheduled time at most once across retries, restarts and hosts sharing a SQLite or Postgres store, refuses crons that aren't five fields and unknown time zones, and removes `idempotencyKey`, `idempotencyWindowMs` and `idempotencyOptions`; teams outside the repo rewrite at upgrade, see the migration notes (FIX-2085).
- 7d4c413: Resource collections can be declared owner-private with `ownerPrivate: { param }`, and `ownerSegment(userId)` builds the owner key segment. Key segments beginning `~` are reserved for owner-private collections in every app, and flow registration refuses a single resource whose key has one. `defineResourceCollection` and flow registration no longer refuse collection patterns on Workforce's account, and `@flow-state-dev/core` no longer exports `assertRosterCollectionIsNotDeep`. Workforce's private roster collection is now owner-private; its refusal messages name the owner-private collection instead of the roster (FIX-1549).
- 839e915: A block output or tool result over the new `maxRecordedValueBytes` router option (default 256 KiB) is now recorded as an `omitted` placeholder with its size and a preview while the run keeps the full value, and a resumed request that would need it fails with `RECORDED_VALUE_OMITTED` (FIX-1772).
- 02ee032: Remove backward-compatibility paths (FIX-1804, FIX-850): stores read only the current on-disk and table layouts with no migration of older data, `@flow-state-dev/claude-code` drops its package-root entry and deprecated handle aliases, `@flow-state-dev/patterns` drops `legacyWorkerAdapter` and `executableTaskSchema`, and removed options such as `clientData`, `requireOrg`, `presets`, `preset/*` model strings, `prefer` and `fileFilter`/`syncMode` are no longer refused by name.
- 16bb676: `SkillState.agents` and the `AgentSpec`, `Agent`, `AgentRegistry`, `AgentOverrides`, `MaterializeAgentFn`, `MaterializeAgentOptions`, `PersonaSource` and `PersonaInlineConfig` types are removed with skill sub-agents; delegate to workers through the task board instead (FIX-1814).
- 9510a03: Requests now carry `ctx.request.incarnation`, a token that stays the same across a request's retries and resumes and that request-scoped workspace keys and local `scope: "run"` bash directories now include, so a request reusing a deleted request's id starts empty; existing run workspaces move once on upgrade, and a run in flight at deploy continues in an empty directory (FIX-1286).
- 1027b98: A block that declares `resources` now gets a `ctx` you can pass to a function typed `(ctx: BlockContext)`, with no cast. Declared refs keep their own types on `ctx.resources`, `get` still accepts only a declared name, and reading an undeclared name is still a missing-property error (FIX-2060).

  `get` and `list` on a declared `ctx.resources` are typed as functions that are also resource refs. Calling them works as before. An object literal you build by hand and type as a declared registry, such as a test mock of `ctx.resources`, no longer compiles if it uses plain functions for `get` and `list`. To test a block, run it with `testBlock` from `@flow-state-dev/testing` and seed its resources, so the block gets the real registry. If you do need a hand-built registry, cast those two members, for example `get: ((name: string) => ref) as any`.

- d1a4cab: The task hand-off envelope (`TaskDispatchInput`) names its entry in `assignee` instead of `seat`, and the discovery tool describes the workers it lists (FIX-1796).
- 3311cc2: `HIRED_ROSTER_BROWSER_PATTERN` and `HIRED_ROSTER_PRIVATE_PATTERN` are now exported from `@flow-state-dev/workforce` instead of `@flow-state-dev/core/types`, and `@flow-state-dev/core` no longer exports `HIRED_ROSTER_PRIVATE_BRAND`, `markHiredRosterPrivateCollection` or `isHiredRosterPrivateCollection` (FIX-1549).
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

- 0503c38: A schedule created with `schedules.create(key, { cron, kind, enabled })` on a `defineScheduleCollection` collection now fires and keeps firing after a reschedule: the resolver reads the row from resource state (`ScheduleResolutionStores` now requires `resourceState`), and a new `stampOrgId` collection option records the creating run's organization on the row, keeps it across updates, and refuses any write that names another organization (FIX-1545).
- 8195995: Schedule index rows are now identified by the storage cell the schedule lives in plus its key, so a person's same-named schedules in two hired seats (or a seat and their app-wide flow) are two rows and turning one off no longer stops the other (FIX-1546). `ScheduleIndexRow` gains a required `cell`, `ScheduleIndex.remove` takes `{ cell, key }` instead of `(userId, key)`, and `CollectionHookContext` gains `cell`, the storage key the instance is persisted under. A custom `ScheduleIndex` must key its storage on `(cell, key)` and store `cell`; the conformance suite covers it. The SQLite and Postgres `schedule_index` tables are re-keyed on `(cell, key)` automatically at schema init, adopting every existing row as its person's own cell; with `skipSchemaInit: true`, apply the upgrade SQL in the schedule index reference. BullMQ scheduler ids are built from the cell and key; an app-wide schedule for an ordinary user id keeps its existing scheduler id.
- 295e96a: A block's `sequencerStateSchema` now joins the state of the sequencer `ctx.sequencer` resolves to (the nearest enclosing sequencer with a `stateSchema`), with its defaults in the initial state, and a capability's `sequencerStateSchema` joins the state of the sequencer that uses it. Composing a chain now throws `SequencerSchemaMismatchError` when a sequencer `stateSchema` field disagrees in kind with a block's or capability's requirement, when two blocks or two capabilities require different kinds of one field, or when such a shared field carries a `.transform()` on one side (share one schema between both sides instead), so a flow that composed such a pair before no longer builds. A durable sequencer resumed from a checkpoint gets schema defaults for the fields the checkpoint lacks (FIX-2039).
- 97894aa: A flow can check every new session's initial state with `session.createCheck`, refuse caller-seeded fields with `session.serverOwned`, and fix a field for a session's life by declaring it `.readonly()` in its session `stateSchema`; `listSessions({ state })` and the list route's `state.<field>` filter select sessions by a readonly field. On a flow that binds its sessions this way (a readonly field or a create check), an initial state that fails the `stateSchema` is refused on every path that creates a session; other flows keep it as sent. A dispatcher's `session: { key, state }` and a task dispatcher's `state` create the child session with that state. `ensureSessionRecord` now takes the create request beside the record it builds (FIX-1788).
- 9ed6b29: A block can stop another request running in its own session with `ctx.session.stopRequest(requestId)`. It records the same stop as the abort route, reaches a request in another process on its next heartbeat, and answers `"stopped"`, `"already-finished"` or `"not-in-this-session"` (FIX-1690). Anything that implements `SessionScopeHandle` itself must add the method.
- b552b50: A dispatched task now settles once, when its work is over (FIX-2077): after its request, the background work that request started and the background work the flow's `onFinished` started have ended, with no task it filed still open or still owing its ending. Until then the row stays `in_progress`, and `Task.keptOpenBy` says what holds it (`"filed"`, `"suspended"` or `"steer"`). A row that waits has no lease, so a task that stops to ask a person or to wait on an event is no longer reclaimed and run again when its lease runs out. The output is the latest `reportProgress` checkpoint, else the last answer that counts; a message's answer never is.

  Orchestration adds `taskRequestAdmission`, `noteTaskAnswer` and `afterTaskCheck` for a request that works on a waiting task, and `endRules` on `createTaskGate` and `taskLedgers`. Core adds `onRequestEnded` (`@flow-state-dev/core/types`), a framework-facing hook the engine runs after a request's last drain, on every way it ends.

  In Workforce a split task stays running while its pieces are open, and its output is its worker's answer like any task's. Read a piece's result from its own row (`listTasks({ filedByTask })`, `getTask`). A failed piece no longer fails its task by itself: the turn its ending wakes decides, and only a turn that throws fails the attempt. A worker that ignores a failed piece completes its task anyway.

- cd180d7: Stopping a paused request now ends it `aborted` and records its gate with the new `stopped` suspension status, a turn paused on an ask cancels the asked task instead of waiting for it, and a durable host now runs the durability sweeper even without `durabilityRetention`, so a paused request past its `expiresAt` expires and an ask past its deadline times out, while pruning still waits for a retention policy (FIX-1816).
- 872a088: A task board's dispatcher can now choose its entry and its session for each row (FIX-1872). Give a `task` dispatcher an `action` of `{ among, by }` and `by` picks, per row, one of the entries listed in `among`; every listed entry is checked when the flow is defined, and an answer outside the list fails that row with `no-entry`. Give it a `session` of `{ by }` and it answers, per row, `{ key }` for a child session or `{ id }` for a session that already exists. An existing session is delivered into and never created: a missing one, or one the running user can't reach on this flow, fails the row with `session-not-found` or `session-not-addressable`. A string `action` and the `"per-task"`, `"per-worker"` and `{ key }` policies behave as before.
- 30aa133: A task can now be handed to the worker its assignee names, including one hired after the host started (FIX-1778).

  - core: a task dispatcher's `flowKind` may be a function of the task (`TaskFlowTarget`), resolved once per hand-over; an empty answer refuses it `flow-not-found`. A task entry may declare `from` to take tasks from more than one ledger; such an entry runs queued unless it sets its own concurrency. A function `flowKind` requires `session: "per-task"`.
  - orchestration: `taskLedgers({ name, resolve })` builds that `from`, resolving each dispatch's ledger by id and refusing an unknown one before any row is read. A board's `defaultWorker` may now be a task dispatcher, handing a task over under its own assignee. Tasks record `createdBy` (the user whose request added them, server-only), which a hand-over passes to a per-task target as `filedBy`.
  - workforce: `createWorkerLookup({ instanceAt, declared })` says which worker a name means for the running caller, from the live registry; its `flowKind` plugs into a board's fallback.

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

- 20aa58f: A create call no longer records a pull request it only names (FIX-2307). `githubPullRequestRule` reads a `create_pull_request` result's `html_url` (else `url`), so a link in the new pull request's body, such as "Follow-up to …/pull/12", is not recorded as opened. A shell command whose only link-printing `gh` verb is `gh pr create` still records every link it prints. A command that also runs `gh pr view`, `gh api` or another verb that prints links now records nothing from that call, and the turn-end branch check finds a pull request it opened on the session's branch.
- f8df86f: A flow's request and action observers (`request.onStarted`, `request.onFinished`, `onCompleted`, `onErrored`) now run on their own block path, `observer[<owner>.<hook>]`, instead of the action block's `root`. Before, an observer's trace on the root's id read as the action block running twice, and a session read (or a reload) dropped the messages the action block emitted: with `request.onStarted` under lean traces (production's default), and with `request.onFinished` in both trace modes (FIX-2299). `blockPathObserver(hook)` is exported beside the other block path helpers.
- 82eea02: A running coding task now says how it's doing. The harness contract gains an optional `onActivity` hook (`HarnessActivityHook`), called with each completed assistant message and each tool call a run starts; `claudeCodeAgent`, `codexAgent` and `cursorAgent` (tool calls only) take it, and `reportHarnessActivity` / `harnessActivityOf` in `@flow-state-dev/core` map a harness's events to it. `harnessManager` hands the feed and keeps the task's `statusNote` set to the run's latest activity: the first at once, then at most one write per `PROGRESS_NOTE_MS` (30 s), fenced by the run's claim. A slot that builds its harness from named feeds must pass `onActivity` through to get notes (FIX-2290).
- 1abab86: A request suspended inside the model's `waitForUser` tool before it was renamed `suspendForUser` (FIX-2317) resumes when the user answers. Before this, answering it failed with `GeneratorToolUnavailableError`. When the resolved tools have nothing by the old name, the resumed step runs `suspendForUser` under the old name's path, so the stop matches the answer already given. A tool of an app's own that still has the old name resumes as itself. The model never sees the old name.
- 8e67ce5: A worker's call that dies after sending its message and before it parks is continued (FIX-2269). A call (`sendMessage({ wait: true })`) now owes its park through the new optional `RequestWaits.owingPark(work)` before it sends. If the request is then marked `interrupted` while it still owes one, the durability sweeper continues it, and the replay waits on the message it already sent, so the call is answered instead of left waiting forever. A request still owing its park 10 minutes after the first owe is left `interrupted`. History and retention read an interrupted request that owes a park as one that will run again, and stopping it lets the owe go. A repeated call's send now dispatches itself, so the continued call has a request to wait on.
- dd353e2: FIX-2321: An async `onActivity` hook that rejects is now logged like one that throws, instead of escaping as an unhandled rejection that could end the process.
- 3221d05: A dispatched task's background work that errors now fails its attempt (FIX-2088), as if its request had thrown: the task runs again while it has attempts left, otherwise it fails with an error naming the step (`Background work "<step>" failed: ...`). It counts in every request working the task, including steps `onCompleted` and `onFinished` start and a step a default `.waitForSideChain()` already drained. The request itself still reports `completed`. A cancel never fails the task this way, and a step that failed before a suspension counts only if its rerun on the resume fails too. Make a step best-effort by catching inside it.

  Core adds `RequestEnding.backgroundFailures` and the `BackgroundFailure` type (`@flow-state-dev/core/types`), and `RequestSideChainPool.failures()`; the engine hands a request's background failures to its request-end hooks. In Workforce, a failed `afterAnswer` step (such as a memory capture) fails a task's attempt too, except in a task filed `resultTo: "conversation"`, where it is logged and the task keeps its answer. Conversation turns are unchanged. A step a timed-out `.waitForSideChain({ timeoutMs })` stopped waiting on is still waited for before the request ends, and its failure counts and is logged, with `failOnError` too; `drainScope` takes an `abandoned` signal for this. The MOAT bash provider's purge of stale containers now logs a failure instead of throwing it.

- 397cfa7: Boot warnings and the active-profile line now print once per server process, not on every dev hot reload (FIX-1632).
- 53b50f0: New `utility.cascadingRouter` walks a tree of `evaluator` choice questions and sends anything the model didn't answer with enough reported confidence to one required `ambiguous` block (FIX-1558).
- 646f8d2: A harness can declare `stopsOnAbort` on the block it returns (an optional field on core's `HarnessBlock`): when its abort signal fires, the block returns only after its process has exited. `claudeCodeAgent` declares it, and now kills its agent process with `SIGKILL` if it is still running 5 seconds after the abort, then waits for it to exit. A harness manager built without `stopsOnAbort` now reads the harness's declaration, so a line typed into a running Claude Code task stops the run and the same request continues its session with the line. Set `stopsOnAbort: false` on the manager to keep the old behavior, where the line waits for the run's own end (FIX-2312).
- 16a8dab: See how much of Claude Code's subscription is used. Core's `HarnessUsageWindow` gains `level` (`ok`, `warning`, `reached`, or `null`) and its `usedPercent` may be `null` when a harness sends no percent; core adds `HarnessUsageHook` and `HarnessUsageReport`, the run-time twin of `HarnessSessionHook`. `claudeCodeAgent` takes `onUsage` and hands it each window a run's `rate_limit_event` reports, with the run's account; `readClaudeUsage` reads who is signed in for the usage query, and `probeClaudeAccount` takes a `signal` that stops and closes the probe, and marks a `none` it got no answer for with `unanswered: true`. `@flow-state-dev/harness-manager` feeds `onUsage` at both of its harness slots (`HarnessFeeds.onUsage`, now required, so code that builds `HarnessFeeds` itself must add it), writing into the run owner's usage record, and keeps a stored record's account and windows together across a sign-in change. Codex windows now carry `level: null`. Shift Manager's Usage view shows Claude Code's windows, saying "limit reached" or "under Claude Code's warning line" where there is no percent (FIX-2142).
- 456fe85: The resource CRUD tools and `resolveResourceByPath` now reach parameterized collections (`react/observations` for `[topic]/observations`) and nested paths under a `**` collection registered after a `*` one, matching what the full uri already resolved (FIX-1484).
- 9d02ac6: A sequencer's `uses` capabilities now stay reachable at `ctx.cap` after `.connectInput()`; previously calling it dropped them for the whole chain (FIX-1714).
- 8dc242e: `assertEvaluatorBlock(block, { slot, helper, questions })` refuses a value in an evaluator slot that is not an evaluator block, with one message shape shared by every package that takes an evaluator option (FIX-1555).
- 89af7db: **`@flow-state-dev/cursor`** — two opt-in options on `cursorAgent`, both off by default (FIX-1917):

  - `recordPlan: true` records Cursor's to-do list in the run's plan record (`observed-plan`, with its `observed-plan-list` marker): the whole list Cursor last confirmed, one row per place, with Cursor's own status words, written through core's `replacePlanList`.
  - `env` runs Cursor's local runtime in a separate process whose environment is exactly the variables you pass, so commands Cursor runs start with only those variables. It is not a security boundary: the process runs as the same OS user, and on Linux a command can still read the server's environment through `/proc`; use a separate user or a container when that matters. With `env` set, functions in `agent` or `send` and a custom `resolveCursorClient` are refused when the block is built.

  A resume Cursor refuses because it doesn't know the agent now fails with `harnessFailure: "unknown-conversation"`, which core's `harnessFailureKind` reads.

  **`@flow-state-dev/core`** — `harnessRunNamespace(ctx)`, the per-invocation namespace a harness keys its plan rows and list marker under. `@flow-state-dev/claude-code`'s `runNamespace` is now this same function.

- 7d4158f: `FSDEV_DEFAULT_MODEL` no longer throws in `createModelResolver` when an app declares no intents, so an environment that sets it no longer crashes apps and tests that never resolve a model (FIX-1083).
- dd80e01: Evaluators work with `@ai-sdk/gateway` 4.0.108 and later: core now requires `ai` 7.0.133 or later, which sends an evaluator's state the way those versions read it, and an array state still reaches the model as the array it is. Evaluation through Vercel's AI Gateway now needs `@ai-sdk/gateway` 4.0.108 or later in your app. `mockEvaluationModel` hands its `answers` function, and records on `calls`, the state the evaluator evaluated (FIX-1925).
- 5181ddb: An approval that passes its `expiresAt` no longer leaves its request suspended: the durability sweeper carries the turn on as if the approval were rejected, so the gated tool does not run, the model gets a result saying the approval expired and is no longer valid, and `SuspensionRejectedError` carries `expired: true` (FIX-1846).
- 2969b30: Add `defineFacetedCollection`: a resource collection whose bodies are classified once on write by an evaluator block you pass, storing the answers as `facets`, with a `search` block over the stored answers (optional `minConfidence`, no model call), a `reindex` block that reports `{ reindexed, failed }`, and the `resources` to register on the flow. A misconfiguration throws when the collection is defined: client body edits, `writable: false`, a `reactTo.contentUpdated` binding, parameterized key patterns, and evaluators with computed questions, an input schema that rejects a string, a `flowConfigSchema` or a lazy single resource (FIX-1583).
- a74429a: A generator no longer calls a capability preset's function-valued `tools` when it would drop the result: behind a declared `tools:` list, or while it assembles context from a capability added through a dynamic `uses` entry (FIX-1459).
- e71ea1a: The DevTeam and `fsd` Labs now ship a default model, so a worker that names no `model:` answers instead of failing every turn, and an `intent/<name>` with no model to fall back to fails with a setup error that names where to set one (FIX-2008).
- 49d6397: A refused flow config bag now throws `FlowConfigRefusalError`, which carries each issue as `{ path, code, message }` beside the same message as before (FIX-1789).
- 9e3b823: A text generator that runs without streaming now keeps the text it wrote before a tool call, returning the same text as the streamed turn (FIX-1628).
- df3de3b: A streaming text generator whose turn writes text in more than one step (text, then a tool call, then more text) now separates each step's text with a blank line, in both the streamed assistant message and the generator's output. Before, the pieces ran together with no space at the step boundary ("…the tool.I've filed…") (FIX-1626).
- 423a405: Add `harnessEnv({ pass })`, which builds a coding harness's `env` from an allowlist of variable names so a harness's agent process sees only the variables you name instead of the server's entire `process.env` (FIX-1716).
- 08a9b05: See how much of each coding harness's subscription is used. Core adds the neutral usage window and the on-demand reader signature (`HarnessUsageWindow`, `HarnessUsageReading`, `HarnessUsageReader`). `@flow-state-dev/codex` adds `readCodexUsage`, which asks the Codex CLI's app-server for every window's percent used and reset time with no run (local only), and exports `findCodexProgram`. `@flow-state-dev/harness-manager` adds the per-person `harness-usage/**` record and `harnessUsageAction({ readers })`, the one query that returns each window with its age and whether it has rolled over, refreshing a reader at most once a minute. Shift Manager shows it on a new Usage view (FIX-2141).
- 01b29f0: A hired seat stays with the organization and user that hired it, so another organization or roster peer cannot list, open, or run that seat (FIX-1529).
- 712dc22: A hired seat now keeps what it saves for a person (shared user-scoped resources and user state) under one user-scope key per organization and person, `<userId>:~org:<orgId>`, so the same person's seat in another organization starts empty and no seat reads the person's app-wide data; data seats saved before upgrading is not read for them until you run the optional offline copy in the persistence docs under "Upgrading: moving hired seats' stored data" (FIX-1538).
- afb512f: `ItemQuery` gains `includeInFlight`: pass `false` to `ctx.session.items.history()` (or `all()`, `client()`, `selectForContext()`) to get earlier items only, without the items the current request has produced so far (FIX-1595).
- f9995b1: An `{ id }` dispatch target may carry `state`, which creates the session at that id when none exists, through the target flow's create check (FIX-1989).
- a7f1c41: `utility.intentRouter` now keeps a category handler's own `connectInput`, applying it to the router's original input instead of dropping it (FIX-1558).
- 80f6e25: Models `createModelResolver` loads from a provider or gateway package carry `generateStep` and `streamStep` from the first resolution, so a generator runs its own tool loop on them and a tool's `ctx.suspend()` pauses the request instead of reaching the model as a failed tool call (FIX-1719).
- 3cbab3a: `RequestHost` gains `sessions.read(id)`, which returns a session's flow and its read-only state when the session belongs to the same user, tenant and organization as the request, and `undefined` otherwise (FIX-2160).
- a965a50: A request that resumes after `suspendForUser` restores the state of every sequencer it was inside, nested ones included, so a step after the resume sees what the steps before it wrote (FIX-2163). Two `loopBack`s that target the same step give each pass its own child paths, so a resumed request no longer reuses an earlier pass's step outputs for a later pass.
- 41638f3: A flow that sets no `tokenCounter` now counts with core's `estimateTokenCounter`, which reads each model's characters-per-token from the model lookup, instead of a flat four characters a token. `{ tokens: N }` history windows on a GPT, Gemini or Llama model count a little higher than before, so they hold slightly fewer turns. Blocks read the flow's counter as `ctx.tokenCounter` (absent on a mock context), and `utility.consultSessionHistoryTool` cuts its `budgetTokens` with it, for the answering model (FIX-2319).
- 311a6d5: `@flow-state-dev/orchestration/tasks` no longer reaches `node:module` or `node:url`, so a browser bundle can import it. Core adds two subpaths, `@flow-state-dev/core/blocks/handler` and `@flow-state-dev/core/blocks/sequencer`, that expose the block builders without the main entry's Node-only model resolver (FIX-1608).
- 27b198a: `defineResourceCollection` accepts `ownerWrites: { param }`: every reader the collection's scope serves reads each row, and only the user the row's owner segment names writes it. Key rows with `ownerSegment(userId)` at that parameter, as for `ownerPrivate`, and the same pattern rules apply (the parameter appears once, no `**`); a browser read is allowed. A create, update or delete by anyone else, through the collection handle, a ref obtained by reading, or the browser update and delete routes, throws `A row of an owner-writes collection is written only by the user it belongs to.` and changes nothing. The startup fence covers these collections too: a wider collection in the same scope that can reach their keys, or the same pattern declared `ownerPrivate`, stops the app from starting. A collection can't declare both modes, and an owner-writes collection can't declare an `eviction` policy other than `"none"` (FIX-1793).
- db7df1c: A `per-task` hand-off keys a follow-up task's child session by the task it follows (`followUpOf` on the worker input), so the follow-up runs in that task's session (FIX-1817).
- 0d6278e: Each worker's token usage is recorded per person and day, with harness runs reporting their spend through `reportHarnessSpend`, read through the `workerUsage` query, and shown on Shift Manager's Usage view (FIX-2145).
- 968faa6: The run's plan record is now part of the harness contract in `@flow-state-dev/core`: `OBSERVED_PLAN`, `observedPlanCollection`, `observedPlanItemStateSchema` and `ObservedOutcome`, with the same key and fields as before, and entries now stream to an open page as they change. New beside it: a per-run list marker (`OBSERVED_PLAN_LIST`, `observedPlanListCollection`) that says whether a run's plan is `writing`, `complete` or `incomplete`, and `replacePlanList(plan, marker, runNamespace, items)` for harnesses whose plan arrives as the whole list. Also new: `harnessFailureKind(error)`, which returns `"unknown-conversation"` when a harness refused to continue the conversation a run asked to resume, and `null` for any other failure (FIX-1915).
- 653549d: New `planRowsPrefix(requestId)` and `planKeySegment(value)`, from the package root and `@flow-state-dev/core/types`: the key prefix one request's plan entries (or, with `OBSERVED_PLAN_LIST`, its markers) are under, for reading one turn's plan with a `topicPrefix`, and how a request id or run name is written as one key segment (FIX-1915).
- adbcf0b: `RequestWaits` gains an optional `running(requestIds)`: whether each request of the running session is running its own work now (`in_progress`), as opposed to parked (`suspended`) or ended. The engine's request host implements it. A host that supplies its own `RequestWaits` should add `running` too: without it, a task board doesn't hold a task's notice while the request that filed the task runs (FIX-2123).
- 1cfd80c: `defineResource` and `defineResourceCollection` take a `secret` list of state fields the engine never sends to a client or returns from the debug routes, and Workforce marks a stored MCP key's `value` secret so the debug routes no longer show it (FIX-1955).
- 3b0161c: With a durability provider configured, a request resumed after a stop, or continued through `/continue`, no longer runs its completed steps again when trace observability is off, as it is by default in production. Without a durability provider, `/continue` behaves as it did before: it skips a completed step only from a full trace, so a request recorded with observability off runs again from the top. The lean record is marked `lean: true`. Each completed block now records a lean `block_trace` (its identity and output) whatever the observability setting, and resume replay reads that record to skip the block. Full capture (inputs, generator prompts, resource loads, failed traces) is still gated by `FSDEV_TRACE_OBSERVABILITY`. With observability off, a request's item log now holds one `block_trace` per completed, non-transient block. An output larger than the recorded-value limit is stored as an omitted placeholder, so a resume that reaches that step fails with `RECORDED_VALUE_OMITTED`, naming the block, rather than skipping it or running it again. With a durability provider, crash recovery (`/continue`) is at-least-once for a block whose completion had not been persisted when the process died: that block runs again. A completed `block_trace` now carries `rescued: true` when a `.rescue()` handler produced the block's output, so `ctx.wasRescued()` returns the same answer after a resume (FIX-2137).
- 385d01e: A generator tool that throws after its approved `ctx.suspend()` gate now reaches the model as a failed tool call, as in the live tool loop, while a cancel during that tool still stops the request (FIX-1719).
- 7c9e932: A running request's items are now readable while it runs on the in-memory stores too, and a message sent to a coding run whose harness hasn't named its session yet is held until it does instead of being refused as a run that can't continue (FIX-1735). `readCommitted` (in `@flow-state-dev/core/helpers`) reads a resource's state as committed now rather than as the request first read it.
- 334c1e3: A message item read through `ctx.session.items.all()`, `client()` or `selectForContext()` carries its `role`, so a block building its own prompt context can tell the caller's messages from the flow's (FIX-1828).
- a021cd1: `@flow-state-dev/contracts/helpers` (and `@flow-state-dev/core/helpers`) now export the resource-state version rule every `ResourceStateStore` adapter uses: `assertSetExpectedVersion`, `assertDeleteExpectedVersion` and `resourceStateConflict`, with the `ExpectedVersion`, `VersionedRow` and `VersionConflict` types. A custom store adapter can import them instead of copying the rule. `cloneValue` is now also exported from `@flow-state-dev/contracts/helpers`; its `@flow-state-dev/core/helpers` export is unchanged. No store's behaviour changes (FIX-1277).
- 68b8957: `defineFlow`'s build-time resource collision check now keys each declaration on the cell the engine actually writes (FIX-1257). Two collections sharing a `pattern` are refused whatever `ref` each carries, a `defineResource` carrying a `pattern` is checked as the collection it is stored as, and an aliased resource is checked only under the slot it persists to. A flow that previously built only because a collection carried a `ref` now throws `Resource collision` at definition time. The shared rule is exported as `isCollectionConfig` and `resourceStorageKeys` from `@flow-state-dev/core/types`.
- e11764a: `ctx.suspend()` takes an optional `title`, a short heading for the ask, carried onto the suspension record and the `suspension` item; `message` is then the body under it. The Error Reporter's preview now sends a short title with its count and questions as a markdown body (FIX-2030).
- 9cd314d: `defineTaskCollection` accepts `partitionBy` on a `user`-scoped collection, keeping one set of rows per partition so each conversation's board reads, claims, waits on and settles only its own tasks while a board's hand-off carries the partition (core's task dispatch envelope gains an optional `partition`) to a task entry on another flow, whose gate and `taskLedgers` resolver read the row there (FIX-1794).
- 9af8ce5: A dispatched task records what its runs spent on its row (`spend`), every attempt counted, rising while a run works: the board writes it every 2 s and as the request ends, through the new `recordSpend` verb on `TaskCollectionRef`. `listTasks` from `taskToolActions` returns it folded (`taskSpendView`: harness, model, input and output tokens, `null` until reported). Harness runs report spend as they go, keyed by a `runId` with the model the run named, each report replacing the run's last; `readRequestSpend(ctx)` reads a running request's spend so far, and `requestSpendSources` moves from Workforce into core (FIX-2288).
- 407964a: Resources declared on a block that a generator lists in a static `tools` array now reach `ctx.resources` when the model calls the tool, including when a `uses` capability also contributes tools, and a conflicting declaration at the same accessor now fails at `defineFlow` time (FIX-1578).
- 5708f16: A generator tool whose `mapModelOutput` throws is now recorded as a failed `tool_output` (code `MODEL_OUTPUT_MAP_FAILED`) and fails the run on resume and recovery too, instead of being stored as completed and replayed to the model as a success (FIX-1719).
- 50edfd4: A tool's `item.updated` event, sent when it completes or fails, is now keyed by `itemId` like every other stream, instead of `id` (FIX-1681).
- 84cc226: New `isWindowsReservedName(name)` helper on `@flow-state-dev/contracts/helpers`, re-exported from `@flow-state-dev/core/helpers`: `true` for the names Windows reserves for devices (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`) in any letter case. The filesystem store and the workforce tree loader now both read this one list; which names they refuse, and the messages they give, are unchanged (FIX-1428).
- Updated dependencies [24afa6e]
- Updated dependencies [f8df86f]
- Updated dependencies [617aeab]
- Updated dependencies [211679a]
- Updated dependencies [839e915]
- Updated dependencies [65ad58a]
- Updated dependencies [3b0161c]
- Updated dependencies [fa7b22e]
- Updated dependencies [d1a4cab]
- Updated dependencies [60c8192]
- Updated dependencies [b7c523b]
- Updated dependencies [a021cd1]
- Updated dependencies [cd180d7]
- Updated dependencies [e11764a]
- Updated dependencies [d97031f]
- Updated dependencies [49d2aca]
- Updated dependencies [84cc226]
  - @flow-state-dev/contracts@0.2.0

## 0.2.0

### Minor Changes

- b597600: An agent can now ask what it can work with: `discoveryTools(createManifestRegistry([...]))` returns one `discover` tool that answers from whatever domains a scope registers a source for, and `resourcesManifestSource()` ships the resources domain. Two enumerators that ignored the `llmReadable` gate are closed with it — `resourceTools().listResources` is **removed** (it had no caller), and `globResources` now lists only resources the agent may read (FIX-817).
- 6b8bfe4: Sessions a dispatcher ran work in are listable on their flow: `GET /sessions` takes `include=dispatch-runs` (off by default), `listSessions` takes `include`, `FlowNavigator` takes `includeDispatchRuns` and draws a run one level under the session that started it, the DevTool shows runs in the rail and inside a session's block tree on demand in place of its Children tab, and `requestHost.livenessOf` now also answers for a dispatch run under the caller's own principal, tenant, organization and flow instance rather than only for one beneath the asking session (FIX-1440).

  The dispatch-run liveness arm compares the caller's organization against the active-request entry as well as the session record. Both comparisons are required: they read separately stamped rows, and a caller whose organization was not forwarded to the read matched only entries carrying no organization at all.

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

- f25f03c: Rename the read-through collection family from `ExternalResource*` to `ProjectedResource*` (FIX-1518). Call `defineProjectedResourceCollection` and the `projected: true` brand; the old `External*` names and `external: true` brand are gone.
- bff5e06: FIX-1393: a generator's declared `tools:` is now a runtime fence over capability-contributed tools, not just a documented one.

  A capability's tools used to be unioned onto whatever the block declared, so a block with `tools: []` could still be handed tools it never named. Declaring the slot now drops a capability's catalog-granted tools — `tools: []` reaches the model with none. Omitting `tools:` entirely is unchanged: it declares no fence, so capability tools still flow.

  Capabilities declare tools through two slots. `tools` is a grant from the app's catalog and is fenced. The new `controlTools` is a framework control the consuming block's own configuration asked for, and the fence never touches it — a control is built inside its capability and never exported, so no `tools:` list could name it back in. One capability may use both: the skills library registers the app catalog through `tools` and its own skill loader through `controlTools`, and `taskTools` contributes the delegation board entirely as controls.

  **Migration.** If you relied on a capability's tools arriving past a narrower `tools:` declaration, name them in `tools:` or drop the declaration. Pattern factories (`planAndExecute`, `supervisor`, `routedSpecialists`) forward both slots, so a call site passing `tools` and `uses` together now gets the fence inside the pattern. Capability authors whose tools are framework controls rather than catalog grants should move them to `controlTools`.

### Patch Changes

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
- Updated dependencies [e4c443e]
  - @flow-state-dev/contracts@0.1.2

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/contracts@0.1.1

## 0.1.1

### Patch Changes

- 7c52923: `AgentSpec` accepts an optional `description` used as the roster blurb for a skill assignee prompt (FIX-1370).
- a8e22c4: A block whose `flowConfigSchema` asks for a setting inside a nested object can be installed on a flow again, and a block that declares a requirement from inside a dynamically resolved tool is now checked the same way a statically declared one is (FIX-1336).

## 0.1.0

### Minor Changes

- 67b4157: `dispatcher()` can address another flow: `flowKind` on an `internal` or `task` dispatcher resolves `action` on that flow's matching entry map and starts the work there, fire-and-forget. `defineFlow` holds one flow's entry maps and skips the check, so the miss is a named runtime refusal — `flow-not-found` for an unregistered flow, `no-entry` for a registered one that declares no such entry — never a retry, a queue, or a fall-through to the sender's own map. A cross-flow `{ key }` child belongs to the addressed flow (its `flowKind`, its state defaults) and roots its own lineage; a reply is the same `{ from: true }` dispatcher pointed back at the sender's `flowKind`. Omit `type` — ordinary dispatchers send `internal`, and a task-board seat is a dispatcher whose `session` is `"per-task"`, `"per-worker"`, or `{ key }` (FIX-1297, FIX-1171 family). The entry-name field is `action`.
- 4e562d0: The chat transport is removed (FIX-1330): `@flow-state-dev/chat-sdk` no longer exists, `chat` is no longer an option on `defineFlow`, `ChatConfig` / `ChatEventBinding` / `validateChatConfig` are gone from core, `"chat"` is no longer a `DispatchType` or a public re-entry source in the engine, and the DevTool no longer renders a Chat provenance badge. Conversational bots are driven through a caller-addressed action in `actions`; platform events ride the webhook transport.
- afcac3d: A flow declares its `cardinality` — `"singleton"` (the default: `myFlow()` is the one instance, addressed by its kind, and `myFlow({ id: "default" })` now throws) or `"collection"` (several configured copies, each registered under its own required `id`) — every address (the action, stream, resume, retry and continue routes, `fsdev run`, dispatchers, BullMQ jobs, MCP, webhook and schedule dispatch) is the exact instance id with no first-registered fallback, every session and request records its owning `flowId` and is refused when reached through another instance (`FlowInstanceBindingMismatchError`; `409 wrong-instance-session` / `wrong-instance-request` / `migration-required` on the routes), and SQLite and Postgres add a nullable indexed `flow_id` column with no backfill (FIX-1321, FIX-1322).
- 3cbc411: A shared contract for coding-agent harnesses (LAB-152), so a harness package no
  longer has to be built against another vendor's internals.

  `@flow-state-dev/core` now exports the shape a harness block is handed and the
  handle it returns — `harnessRunInputSchema` and `harnessRunHandleSchema` (plus
  `harnessRunEnvelopeSchema` for a fire-and-forget dispatch), with
  `HarnessRunInput`, `HarnessRunHandle`, `HarnessBlock`, `HarnessResolver` and
  `HarnessSessionHook` on `@flow-state-dev/core/types`. The handle names how a run
  ended (`outcome`: finished, stopped at a limit, or failed), its final message,
  usage, and cost — including whether that cost was reported by the agent or
  estimated. The input is the prompt alone: a working directory or a session to
  resume reaches a harness through a resolver the host supplies, not through a
  schema a model calling the block as a tool can see.

  `@flow-state-dev/claude-code`'s handles are the neutral ones plus Claude's own
  `resultSubtype` and `toolsObserved`. Two visible changes: `source` now reads
  `claude-code/sdk` and `claude-code/cli-remote` (the `<package>/<door>`
  convention every harness follows) and handles saved under the old `sdk` /
  `cli-remote` spellings still load; and the SDK handle carries `outcome` and
  `cost` alongside the existing `costUsd`, which stays for now. The package's
  `RemoteAgentTaskHandle`, `RemoteAgentSource`, `RemoteAgentStatus` and
  `remoteAgentTaskHandleSchema` are deprecated aliases of the core shapes.

- b3e6e22: Initial release (FIX-1187).
- ce85e80: Two registered copies of one flow definition can be set up differently: `defineFlow({ configSchema })` declares what a copy may carry, the factory call takes `config`, and blocks read it as `ctx.flow.config` (FIX-1331).
- 1b94521: Background Claude Code runs can continue a previous conversation (LAB-154).

  `claudeCodeAgent` and `createClaudeCodeAgentCapability` take `resume` (which
  session this run continues — return `null` to start fresh) and `onSession`
  (called during the run when the agent names its session, so a cancelled run's id
  is not lost). Both are background-path only and throw at construction without
  `detached: true`.

  Three things existing code can trip over:

  - **Every resolver option is now handed the block context alone.** `cwd`,
    `sandbox` and `resume` on `claudeCodeAgent`, and `root` on
    `createWorkspaceAgentCapability`, used to receive the run's input as a first
    argument. Drop it: `cwd: (_input, ctx) => …` becomes `cwd: (ctx) => …`.
  - **`costUsd` is gone from the SDK handle.** Read `cost.usd`. Handles already
    persisted with the old field still load.
  - **`HarnessResolver` in `@flow-state-dev/core/types` matches**, and its context
    keeps its types where it previously widened them to `any` — a resolver body
    reading an undeclared scope-state field no longer compiles.

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

- 527c5ca: The DevTool now identifies flows by instance rather than by kind, so two registered copies of one flow each show their own sessions, requests and controls instead of one copy's work appearing under the other (FIX-1324).
- d7208f7: LAB-153: the model price table now knows OpenAI's Codex models, so a Codex run can be priced.

  `gpt-5.4-codex-mini` previously matched the `gpt-5.4` row and was estimated at the full model's rate. Cost estimates for that model change; the other Codex names were unpriced before and are priced now.

- 2c4b0f5: Skills now follow the Agent Skills specification (https://agentskills.io/specification)
  in full for a SKILL.md's frontmatter (FIX-1318).

  - `name`, `license`, `compatibility`, and `metadata` are parsed into typed fields
    on `SkillState` (and `Skill`) instead of being kept only as preserved unknown
    keys. `name` is validated and must match the folder it lives in;
    `compatibility` is capped at 500 characters; `metadata` is a string → string
    map. `MAX_COMPATIBILITY_LENGTH` is exported alongside the existing caps.
  - `parseSkillMd` takes an optional `{ expectedName }` so directory readers and
    seeders can enforce the name/folder match. `readSkillsDirectory`,
    `importSkillsDirectory`, `ensureSeeded`, and `createSkillsLibrary` pass it.
  - Skill names follow the spec's hyphen rules: no leading, trailing, or
    consecutive hyphens. Names like `pdf-` or `pdf--tools` were accepted before
    and are rejected now.
  - `allowed-tools` accepts the spec's space-separated string form
    (`allowed-tools: search fetch`) in addition to a YAML list, and
    `serializeSkillMd` writes it in the spec form.

- Updated dependencies [b3e6e22]
  - @flow-state-dev/contracts@0.1.0

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-17 — Turn-aware history windowing (FIX-608)

`history: { limit: N }` on generators now counts conversational turns rather than raw LLM protocol messages, and `{ limit: { tokens: T } }` packs whole turns from the end without splitting across the budget. New explicit `{ limit: { turns: N } }` form is preferred for new code.

### 2026-05-16 — Sequencer DSL: `.throwIf()`

New `.throwIf((value, ctx) => boolean, Error | factory)` guard primitive on the sequencer DSL. Throws when the predicate is true, otherwise passes through. Pairs with `.rescue([...])` for typed early-stop patterns.

### 2026-05-16 — Idempotency primitives on handler context (FIX-402)

`BlockContext` now exposes `idempotencyKey` (stable `${requestId}:${blockPath}` string suitable for provider idempotency headers) and `runOnce(key, fn)` (memoizes a side effect per request-id and shares inflight promises across concurrent callers).

### 2026-05-14 — `useResourceCollection` invalidates on mid-stream changes

`SessionView` gains a dedicated `resourceChanges: ReadonlyArray<ResourceChangeNotice>` channel populated from `resource_change` SSE items, independent of the consumer's transient-item filter. New `ResourceChangeNotice` type exported.

### 2026-05-14 — Delta store verbs (FIX-405)

Single-field `patchState` calls now route to optional `patchField`, `incState({ field: delta })` to `incField`, and `pushState` to `pushToArray` when an adapter advertises them. Adapters that don't fall back to `set`. `createScopePersist` feature-detects per call. Hot-path cleanup: `MemoryStateContainer.read()` no longer deep-clones, and the `onStateSizeWarning` callback is removed from `ScopeStateOpsOptions`.

### 2026-05-14 — Observable model identity on emissions (FIX-518)

New `ModelIdentity` type (`{ actual, requested?, gateway? }`) exported. Every generator-emitted item (`message`, `reasoning`, `source`, `tool_output`, transient `tool_call_progress`) now carries `model: ModelIdentity`. `BlockTraceItem` for generator blocks gains a top-level `model` field, populated even on tool-only or structured-only turns. Additive — items persisted before this release surface as `model: undefined`.

### 2026-05-14 — `block.asTool()` (FIX-593)

New method on every `BlockDefinition`. Wrapping a block with `.asTool(opts?)` emits a `tool_output` envelope identical to the AI SDK tool-loop path while the block runs normally and returns its typed output unchanged. `agentType` / `agentName` opts control grouping. Failures flip the emitted `tool_output` to `failed` and rethrow.

### 2026-05-12 — Block trace honors `transient` (FIX-586)

Auto-emitted `block_trace` items now inherit `transient` from the originating block. Restores the FIX-478 contract that FIX-573's `block_output → block_trace` unification regressed by hardcoding `transient: false`.

### 2026-05-12 — DevTool: surface context on block failures (FIX-582)

`block_trace.error` and `tool_output.error` gain an optional `details: Record<string, unknown>` field. Generator output-validation failures now throw `OutputValidationError` carrying `{ rawOutput, issues, phase }`. `FlowError` relocated to `@flow-state-dev/core` so handler authors in third-party packages can throw it without a server dependency.

### 2026-05-11 — `makeSchemaStrict` public; BP-016 (FIX-561)

`makeSchemaStrict(schema)` is now re-exported from the package root. It unwraps `optional` / `default` / `nullable` but does NOT transform `z.record()` or non-literal `z.union()` — those still fail OpenAI strict mode and must be rewritten at source. BP-016 codifies the rules.

### 2026-05-11 — Client projection shortcuts: `expose`, `exclude` (FIX-580)

`defineResource` and `defineResourceCollection` now accept `client.expose` (whitelist) and `client.exclude` (blacklist) alongside `client.data`. Field names are type-checked against the state schema. The three projection forms are mutually exclusive; omit all three to ship the full state.

### 2026-05-07 — `useClientData` reflects mid-stream state changes (FIX-576)

`ctx.session.patchState`, `ctx.user.patchState`, `ctx.org.patchState`, and `ctx.request.patchState` (and their `setState` / `incState` / `pushState` / `setStateRecord` / `deleteStateRecord` / `atomicState` siblings) now emit `state_change` SSE items with the matching `scope` value. Previously only sequencer/target-state writes emitted on the wire.

### 2026-05-07 — Container lifecycle: in-flight signal (FIX-574)

`container` items now emit with `status: "in_progress"` when a sequencer or router scope opens, patch to `completed` (or `failed`) via `item.updated` when it closes, then emit the terminal `item.done`. New optional fields: `startedAt`, `completedAt`, `duration`, and `error: { message }` on failure.

### 2026-05-07 — Block trace unification (FIX-573) [BREAKING]

A single `block_trace` item per block run replaces the old `block_output` / `block_debug` split. `block_tool_output` renamed to `tool_output`. Hooks `onBlockDebugCapture` and `onConnectedInput` collapsed into a single `onBlockTraceCapture(payload, ctx)` keyed by phase. Migration: rename `block_output` → `block_trace` and `block_tool_output` → `tool_output` at consumer dispatch sites.

### 2026-05-07 — Lazy collection state, query interface, resource manifest (FIX-427) [BREAKING]

Collection snapshots dropped the eager `items` map; entries now carry `count` and an opt-in `prefetched` window. Per-item `clientData` in the window requires the new `client.state.read` permission. `defineResourceCollection` gains `prefetchWindow?: number` (lexicographic key sort, not recency).

### 2026-05-07 — `item.updated` SSE event (FIX-572)

New `item.updated` event carrying `{ itemId, patch }` with shallow top-level merge semantics. Identity-invariant keys (`id`, `type`, `provenance`, `agentType`, `transient`) are stripped server-side. New `emitItemUpdated(itemId, patch)` on `ResponseEmitter`.

### 2026-05-07 — Lift `.sideChain()` background tasks to a request-level pool (FIX-554) [BREAKING]

Background tasks are queued on a single per-request pool. Inner sequencers no longer auto-await; the request executor drains the pool exactly once before terminal status. `.waitForSideChain()` now drains by sequencer-instance scope. Migration: code that relied on inner-sequencer auto-await for ordering needs an explicit `.waitForSideChain()` at the inner sequencer boundary.

### 2026-05-06 — `clientData` privacy fix + rename (FIX-505) [BREAKING]

Default snapshot response no longer includes raw scope state — `response.state` is gone. New per-scope `client: { expose: string[], derived: { name: fn } }` shape on `session`, `user`, and `org`. Legacy `clientData: { name: fn }` keeps working with a one-time deprecation warning per scope per process.

### 2026-05-06 — Trace channel separation, `step_error` removed (FIX-506) [BREAKING]

Public `OutputItem` union shrinks from 15 to 10 entries — the four trace types (`block_output`, `router_decision`, `state_snapshot`, `block_debug`) leave the union and become observability-only. Public `BlockValue<T>` is now `inline | structure`; the `ref` case moves to `@flow-state-dev/core/items/internal`. `step_error` removed entirely.

### 2026-05-06 — `mapModelOutput`

New `BlockDefinition.mapModelOutput((output, ctx) => string)` method declares a separate, model-visible representation of a tool block's output. The structured `TOutput` keeps flowing through items, devtool, tests, and history replay; the mapper fires only at the AI SDK bridge boundary. Inert when the block is used as a regular sequencer step. Expected to be deterministic — replay re-runs it on the persisted structured output.

### 2026-05-06 — Generator: log unparseable candidates

When a generator's output schema rejects the model's response and repair gives up, the candidate string is now logged to stderr (truncated at 2000 chars) alongside the validation error.

### 2026-05-02 — Memory pipeline + naming reliability fixes

`sanitizeToolName` is now exported from `@flow-state-dev/core/utils/tool-name` (and the `@flow-state-dev/core/utils` barrel). `BlockToolOutputItem.toolCall` gains an optional `alias` field so tool-call replay reads the model-facing sanitized name from item metadata rather than re-sanitizing the framework name at replay time. `sideChainIf` predicate signature changed to `(value, ctx)` like `thenIf` and `tapIf`.

### 2026-05-02 — Resource content moved out of scope records (FIX-347)

`SessionRecord`, `UserRecord`, and `OrgRecord` no longer carry a `resourceContent` field. Content lives exclusively in `ContentStore`, keyed by `(scopeType, scopeId, resourceKey)`. Concurrent writes to different resources no longer contend on the scope-record CAS path.

### 2026-05-01 — Per-scope FIFO mutation queue (FIX-492)

In-memory state scopes now serialize mutations through a per-`StateContainer` FIFO queue. `ConcurrentModificationError` is no longer thrown for these scopes. New `flow.request.mutationTimeoutMs` (default 30s) bounds worst-case waits; `ScopeMutationTimeoutError` is thrown on exceedance.

### 2026-04-30 — `emit*` default-transient decouple (FIX-478)

`ctx.emitMessage()` and `ctx.emitComponent()` no longer inherit the producing block's `transient` flag — both default to `transient: false` regardless. `ctx.emitStatus()` continues to default to `transient: true`. All three emitters now accept a per-call `{ transient?: boolean }` override.

### 2026-04-30 — SSE noise reduction (FIX-477)

Framework-level no-op guard in `applyMutation`: when the proposed next state deep-equals current, the persist call is skipped, no `state_change` SSE item is emitted, and the helper returns `false`. New `transientSlot()` helper marks top-level fields on a sequencer's `stateSchema` as in-memory only. Breaking (internal): `runWithCAS` now returns `{ state, committed }`; `applyMutation` and the seven `ScopeStateOps` helpers return `Promise<boolean>`.

### 2026-04-30 — `content.delta` non-replayable (FIX-479)

`content.delta` events are no longer persisted to the events log and no longer await `flushEvents`. Running text is checkpointed via an items snapshot instead; new `ResponseEmitterItemHooks.onItemUpdate` hook fires on each delta. Resume contract change: mid-stream reconnects snap to the latest persisted snapshot rather than replaying the exact token sequence.

### 2026-04-30 — Connection resilience (FIX-476)

`RequestStatus` and `RequestStatusSnapshot` now live in `@flow-state-dev/core/types`.

### 2026-04-29 — Per-flow authentication (FIX-23)

New `authentication` config on `defineFlow`: `{ resolvePrincipal?, defaultUserId?, requireUser?, requireOrg? }`. `requireUser: false` is now a real option; flows that declare user-scoped state, clientData, or resources under `requireUser: false` are rejected at registration with the offending field named.

### 2026-04-28 — Durable sequencer checkpoint schema (FIX-401)

New `SequencerCheckpoint` type and `CheckpointStore` interface. `durable: true` is now the sequencer default. `state_snapshot` items now carry a stable `key` per sequencer instance.

### 2026-04-26 — Org scope rename + immutable session binding (FIX-428) [BREAKING]

`project` scope renamed to `org` across the framework. `ScopeType` is now `'request' | 'session' | 'user' | 'org'`. Block configs use `orgResources` / `orgStateSchema` / `orgClientData`. Session `orgId` and `userId` are now immutable; mismatches throw `OrgBindingMismatchError` / `UserBindingMismatchError`. New `requireOrg: true` block flag.

### 2026-04-24 — Cross-flow schema registry + per-flow isolation (FIX-431)

Added `isolateUserState` and `isolateProjectState` flags to `defineFlow`. Isolated flows get their user/org storage namespaced by `flowKind` and skip cross-flow schema checks. `FlowRegistry.register` throws `CrossFlowSchemaConflictError` on incompatible declarations. New storage-key helpers (`resolveUserStorageKey`, `resolveProjectStorageKey`).

### 2026-04-24 — Prompt caching audit and default-enable (FIX-423)

New `caching` field on `generator()` config, defaulting to `{ enabled: true, breakpoints: 'auto', ttl: '5m' }`. Provider-specific markers applied for Anthropic / OpenRouter / Vercel AI Gateway; OpenAI / Google / DeepSeek cache implicitly. `GeneratorModelUsage` gains `cacheReadInputTokens` and `cacheCreationInputTokens`.

### 2026-04-11 — DevTool: View Sequencer State (FIX-348)

New `SequencerStateSnapshotItem` trace item captures the full state of a sequencer at each step boundary. Sequencers now auto-emit an initial snapshot before execution begins and one after each step completes (including `loopBack` iterations).

### 2026-04-11 — `defineCapability()` (FIX-351)

New `defineCapability()` packages resources, state schemas, targets, helper functions, and presets under a single name. All four block kinds accept `uses: [capability]`. Capabilities compose transitively with cycle detection and diamond dedup. `.presets()` builder ships with boolean toggles and function-form overrides. `ctx.cap.{name}.{fn}` provides memoized helpers.

### 2026-03-20 — Resource Namespaces (FIX-98)

New `defineResourceNamespace()` for typed dynamic resource collections with glob patterns (`files/*`, `files/**`) and parameterized patterns (`[topic]/observations`). `ResourceNamespaceRef` runtime interface with `create`, `get`, `getOrCreate`, `list`, `delete`, `count`. `maxInstances` cap with `none` / `lru` / `oldest` eviction. Per-instance lifecycle hooks. Block-level `sessionResources` / `userResources` / `projectResources` slots accept namespace definitions alongside static resources.

### 2026-03-03 — `contextReducer` utility block (FIX-73)

New `utility.contextReducer(config)` generator factory with three modes: `distill`, `denoise`, `compress`. Mode-specific default output schemas exported with caller override support.

### 2026-03-01 — Sequencer container item emission (FIX-8)

Optional `container` metadata on the shared block config surface so sequencer/router container settings remain attached to built block definitions. Parent metadata extended with `parentInstanceId` and resolved container metadata.

### 2026-03-01 — Block resource declarations (FIX-92)

New `DeclaredResources` type and `declaredResources` field on `BlockDefinition`. Handler, generator, and router blocks accept `sessionResources`, `userResources`, `projectResources`. Sequencers collect declared resources from all child blocks (with build-time conflict detection on same-name/different-reference); `defineFlow` merges them into flow scope configs.

### 2026-02-15 — Monorepo init / package scaffolding

Initial scaffolding for `@flow-state-dev/core`: type contracts (blocks, flows, state/scopes, resources, items, events), shared schema helpers, the four block kinds (`handler`, `generator`, `sequencer`, `router`), `defineFlow`, sequencer DSL, and model-resolver wiring. Token-budget primitives, prompt-caching surface, and model-lookup tables for OpenAI / Gemini / Anthropic families.

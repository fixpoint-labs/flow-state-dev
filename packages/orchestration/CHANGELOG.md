# @flow-state-dev/orchestration

## 0.5.0

### Minor Changes

- 8be6d45: A failed or cancelled task can be retried as the same task (FIX-2383). `TaskCollectionRef.retry(id)` (optional, on both built-in backings) puts an `errored` or `cancelled` row back to `pending`, keeping its id, steers, output and spend, with the grant counted in `retryLedger`; it publishes a `retry_requested` change and declines `disallowed`, `settling`, `dependency-ended` or `retry-budget`. `taskToolActions` adds `retryTask_<suffix>`, an action only: a model's task tools are unchanged. Workforce's conversation board starts a retried row at once, as it does a released one.
- 3aced5b: Add `taskRowView` to `@flow-state-dev/orchestration/inbox`: one task row as a screen draws it, with a display state that says when the task waits on the user, what it asks, and its spend, harness and times (FIX-2379).

### Patch Changes

- Updated dependencies [824ce87]
- Updated dependencies [0554e0b]
- Updated dependencies [387bee2]
  - @flow-state-dev/core@0.4.0
  - @flow-state-dev/client@0.3.1

## 0.4.0

### Minor Changes

- dc17a39: The task collection files a task under the filer tool's name (FIX-2243). `TaskCollection.addTask` and `addTasks` are `createTask` and `createTasks`, and a board capability's `ctx.cap.<board>.addTask` and `addTasks` are `createTask` and `createTasks`, so the method and the model's `createTask` tool take one `TaskInit` under one name. The rename is breaking, with no alias.
- 5d31955: A flow can declare `reads`: blocks an app runs on a session to look at something the flow computes, stored nowhere. The engine serves them at `POST /:flowKind/:sessionId/reads/:readName`, answering `200 { output }` with no request record and no concurrency slot; any write a read's block tries is refused with `read_only`, and another user's session answers 404 as the action route does. The client calls one with `flow(kind).read(name, input, { sessionId })`. Orchestration adds `taskToolReads(collectionId, resolve)`, the `listTasks_<suffix>` listing as a read, and Workforce's coordinator and agent-worker flows now serve `listTasks_tasks` as a read, so an app polling a conversation's task board no longer stores a request per poll. The action of the same name is unchanged (FIX-2286).
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

- ad0babd: A person's running turn can hear the tasks that finished while the worker answered (FIX-2159). `defineAgentWorkerFlow({ answerAgain: true })` says each such result in that same request, under the delegate's name, and the worker answers again with it; pass a block instead to change what the worker is told (`finishedTasksAnswerAgain({ message })`, or your own sequencer around `takeFinishedTasks`). The worker's answer after its plan and these share one cap, `MAX_ANSWERS_AGAIN` (3 per request). Orchestration exports `takeOwedNotice`, which takes an owed notice in the running request's name through the same take record `onTaskSettled` uses.
- e00a3b0: The task tools' roster type is renamed `WorkerRoster` → `AssigneeRoster`, the name for who a board's tasks can be assigned to (FIX-1794). Its shape is unchanged (`has(assignee)`, `describe()`), so updating the import is the whole migration. The new `AssigneeRosterSource` is either a fixed `AssigneeRoster` or a function of the running block's context that is read on each call that checks an assignee, for a board whose team changes while it is in use. `createTaskToolsCapability(resolver, roster?)` and both `taskToolActions` overloads accept it.

  A durable task ledger can take `defineTaskCollection({ recordEnding })`, a pure function that is handed every write recording how a task ended (completed, errored, retried, cancelled) inside that same write, and whose `metadata` the row keeps. There is one ending signal on both backings. The ending is detected once, where every write passes, and each recorder runs there in the ending's own write.

- 4cdc088: A task board declares whether its drain waits on its tasks: `taskBoard({ mode })`, `"plan"` by default, or `"delegation"`, read back as `board.mode` (with `board.onReview` beside it). A plan board runs every task inline and waits on each; a delegation board hands every task to another session through a dispatcher assignee and waits on none. `taskBoard()` refuses a board whose assignees contradict its mode, naming the fix, and `goalSeekLoop()` refuses a delegation board and an `onReview: "exit"` board (FIX-2076).

  Migration, at upgrade, for teams outside the repo:

  - A board with a dispatcher assignee adds `mode: "delegation"`, the fix its refusal names. A board that mixed inline and dispatching assignees splits into a plan board and a delegation board.
  - `dispatchedTaskPredicate` is removed: use the board's `mode`.

  The task tools now answer a wrapping ref's own refusal, `TaskWriteRefusedError` (exported from `@flow-state-dev/orchestration/tasks`), as a soft `{ ok: false, error: "<code>: <message>" }`, with nothing written.

- f97b0ed: The task board's last old words are gone (FIX-2246), with no alias and no old spelling read. Stores written by an earlier version are not upgraded: a request left in flight across the upgrade may not resume.

  - `@flow-state-dev/workforce`: a coordinator's routing record and a routed task's brief name the message by `messageRequestId`.
  - `@flow-state-dev/orchestration`: a task notice's waited-on flag is `waitedOn`, the word `listTasks` uses. A wait gate's id starts `wait:`. The board's dispatch blocks are named `<board>-dispatch-<assignee>` and `<board>-dispatch-fallback`.
  - `@flow-state-dev/core`: `isWaitGate` is true only for a gate with the reason `"wait"`.
  - `@flow-state-dev/engine`: a wait gate the waiting turn's own conversation resolves records `wait:<session>` as its resolver.

- 2ffc03c: "Dispatcher" now names only the `dispatcher()` block (FIX-2245). Two other things that shared the word are renamed, with no alias.

  - A task board's rule for which ready task it claims next is a claim order. `TaskDispatcher` is `ClaimOrder`; `fifoDispatcher`, `topologicalDispatcher` and `priorityDispatcher` are `fifoClaimOrder`, `topologicalClaimOrder` and `priorityClaimOrder`; harness-manager's `runOwnerDispatcher()` is `runOwnerClaimOrder()`. The task board's option is `claimOrder` (it was `dispatcher`, which it now refuses by name), and takes the same `"fifo"`, `"topological"` and `"priority"` names.
  - What decides where a flow action runs is a runner. `FlowDispatcher` is `FlowRunner`, `InProcessDispatcher` and `InProcessDispatcherDeps` are `InProcessRunner` and `InProcessRunnerDeps`, `createInProcessDispatcher` and `isInProcessDispatcher` are `createInProcessRunner` and `isInProcessRunner`, and BullMQ's `createWorkerDispatcher` and `CreateWorkerDispatcherOptions` are `createWorkerRunner` and `CreateWorkerRunnerOptions`. The option on `createFlowState`, `createFlowApiRouter` and `createInboundTransportHost` is `runner` (it was `dispatcher`, which they now refuse by name), `WorkerAdapter.createDispatcher` is `createRunner`, and `InboundTransportHost.usesExternalDispatcher` is `usesExternalRunner`.

  The `external-dispatcher` refusal keeps its value.

- 5492a77: A board can start work on another worker now: on a board that dispatches (a Workforce conversation's, or one built with `{ dispatches: true }`), a task is handed over as soon as it is filed, and one filed held waits until it is released. Filing a task never waits: it refuses `waitForResponse` and `timeoutMs` by name. The wait names are renamed with no alias (`canHoldAsk` → `canHoldWait`, and the rest of the `Ask` names to `Wait`) (FIX-1875).
- 6819520: A task board that starts a row on another worker now **dispatches** it; **hand-off** means only passing work that is already under way (FIX-1876).

  - The board's ending for "every remaining row is running in a dispatch run" is now `terminationReason: "dispatched"` (was `"handed-off"`).
  - The row-dispatch block's output is now `{ dispatched: true, taskId, sessionId, requestId, adopted }` (was `handedOff: true`).

  The old exports are gone, with no alias, so an import of one fails to compile and names it:

  - `@flow-state-dev/orchestration`: `createHandOff` → `createRowDispatch`, `HandOffOptions` → `RowDispatchOptions`, `HandOffAssignee` → `DispatchingAssignee`, `handedOffTaskPredicate` → `dispatchedTaskPredicate`, `assertHandOffBoardSupported` → `assertDispatchBoardSupported`, `assertHandOffBlockSupported` → `assertDispatchEntrySupported`, and the board handle's `handedOff` → `dispatchers`.
  - `@flow-state-dev/core` and `@flow-state-dev/engine`: no export changes. Definition-time and run-time refusals say a block "dispatches to task:…" where they said it "hands off to task:…".

  The task-board page's "Assignees that hand off" section is now "Assignees that dispatch"; the old anchor still lands on it.

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

- 04ff39d: The task tools are now five: the filer's `createTask`, `getTask`, `listTasks` and `updateTask`, and the worker's `reportProgress` (FIX-2081). `createTask` takes `followUpOf` to file new work on a finished task in that task's session (FIX-1817). `addTask`, `assignTask`, `completeTask`, `failTask`, `cancelTask` and `readTask` are removed, as tools and as `<tool>_<board>` actions; no tool finishes a task. `updateTask({ id, ...fields })` takes flat fields with one rule each: `goal`, `title`, `context`, `input`, `deps`, `priority`, `labels`, `metadata`, `assignee`, `maxAttempts`, a hold and a release change only before a task first starts, and `status: "cancelled"` lands until it finishes. A refusal names the fields and the state (`field_locked_after_start`, `task_finished`). `reportProgress({ statusNote?, output? })` writes a status note and a checkpoint on the task its turn holds; `createReportProgress` builds it, and a checkpoint stays the task's output when the task completes. A task filed from a task turn carries `filedByTask`, and `listTasks` filters on it.

  In Workforce, a worker gives work only to its delegates, in a task session too: a piece for any other worker is refused with `unknown_assignee`. `delegates: all` delegates to the whole roster, read on each call. A coordinator's own turn has `addDelegate`, `removeDelegate` and `setFallback` only when its file sets `editsOwnDelegates: true`; every worker with a board has `listDelegates`. The DevTool's task row actions follow the new tools.

- fe5df7d: A request waits on a task it filed with `getTask({ id, wait: true, deadline? })`, now or in a later request, and gets the task back once it ends or as it stands at the deadline (FIX-2082). The deadline cancels nothing: the task runs on, and an ending that lands while the request still runs reaches it on its next `getTask`; one it never reads goes to `onTaskSettled`, once. A task's own request may wait too, and waits nest up to five deep, counted live. A wait's deadline is a wake on the waiting session, so a restart keeps it. Use `waitOnTask(ctx, board, id, { key })` from `@flow-state-dev/orchestration/task-board` when the wait is in application code rather than a tool.

  - `dispatcher({ wait: true })` waits for the request it starts and outputs `{ status: "completed" | "failed" | "running", output?, error?, requestId }`.
  - On a plan board a row filed `session: "new"` runs in a session of its own through `taskBoard({ newSession })`, and the drain waits on it. A plan board may hold dispatchers, whose rows it waits on; a plan board's dispatcher with `wait: false`, and a delegation board's with `wait: true`, are refused. In Workforce, a worker's step filed `session: "new"` runs in a new session of the same worker.
  - `canHoldWait(ctx)`, `dispatchWaitResultSchema` and `DispatchWaitResult` are exported from `@flow-state-dev/core`; `RequestHost.waits.ended(requestIds)` says whether a request has stopped running its work, and `checkWait` (orchestration) runs a wait's checks alone.
  - Hosts set a wait's deadline bounds with `waitDeadlines: { defaultMs, minMs, maxMs }` (5 minutes, 1 s, 24 h by default). A wait needs a store that keeps wakes. `parkOnWait` takes a `deadline` (epoch ms) and returns the `WaitOutcome`.

- 17444fe: On a board that hands tasks off, `setAssignee` now declines `immutable-assignee` only while an attempt holds the task (`in_progress`). A pending or blocked task can change hands, and its next claim hands it to the new assignee. A finished task declines `terminal`, as on any board (FIX-1780).
- 3cbab3a: A partitioned task ledger now keeps an id index, so `findTaskPartitions` finds a task by id alone; declare its resources with `taskLedgerResources(ledger)` instead of the ledger's own resource entry, or adding a task fails naming the missing index. `rowsInSession` lists the rows a session works (FIX-2160).
- f292079: A task now settles when its turn ends: a message to its session no longer holds it open and isn't part of it (FIX-2103). While the task's turn is running, the message is answered after that turn, with no claim on the task, so it can't report progress and its error doesn't fail the attempt. Steer open work with `updateTask({ message })`.
- f5b5457: Removed `dispatchAndExecuteBlock` and `taskLoopBack`, `classifierDispatcher` and `eventDispatcher`, and the default `taskTools` capability (FIX-2057). An import of a removed export fails to compile and names it.

  - `dispatchAndExecuteBlock` and `taskLoopBack` are gone; `taskBoard()` is the claim loop. Removed exports: `dispatchAndExecuteBlock`, `DispatchAndExecuteOptions`, `DispatchAndExecuteResult`, `taskLoopBack`, `defaultTaskLoopUntil`, `DEFAULT_TASK_LOOP_MAX_ITERATIONS`, `TaskLoopBackOptions`, `TaskLoopBackHandle`. If you drove `dispatchAndExecuteBlock` in a sequencer `loopBack`, use `taskBoard({ workers, collection }).drain` instead.
  - `classifierDispatcher` and `eventDispatcher` are gone; `fifoDispatcher`, `topologicalDispatcher` and `priorityDispatcher` remain. Removed exports: `classifierDispatcher`, `ClassifyFn`, `ClassifierDispatcherOptions`, `eventDispatcher`, `EventDispatcherOptions`. To pick a task by your own rule, write a `TaskDispatcher` whose `claim` calls `collection.claim(workerId, { eligibility })`.
  - The own-state "delegation board" is gone: the default `taskTools` capability that kept a board on the host generator's own state. The task tools now always run over the board your resolver returns. Removed exports: `taskTools`, `defaultOwnStateResolver`, `DELEGATION_BOARD_FIELD`, `delegationBoardSchema`. `createTaskToolsCapability(resolver, roster?, options?)` and `buildTaskToolsList(resolver, roster?, nameSuffix?)` now require the resolver. Where you wrote `uses: [taskTools]`, pass `createTaskToolsCapability(resolver)` with a resolver for your board.

- 16bb676: Skill sub-agents are removed: a `SKILL.md` that declares `agents:` is refused when it loads, `createSkillsLibrary` drops its `workerModelId`, `maxTotalTasks`, `maxEnqueuedTasks`, `agentRegistry`, `materializeAgent`, `capabilityCatalog` and `toolSeatFence` options and the `delegation` and `guidance` binding keys, and `runBoard`, `materializeWorker`, `buildUserMessage`, `workerInputSchema`, `DEFAULT_WORKER_PROMPT` and `FLOOR_WORKER_KEY` are gone, so delegate to workers through the task board and its task tools instead (FIX-1814).
- c4150e7: A person's message on a finished task reopens it: task collections gain `reopen(id)`, the harness manager's door reopens a finished run when its board names `reopenIn`, a worker's reply in a finished task's session on a Workforce conversation board reopens that task, and Shift Manager's task composer takes a message on a finished task (FIX-1764).
- d1a4cab: A task board's seat is an assignee: `TaskSeat`, `TaskSeatRegistry`, `TaskSeatAddress` and `HandOffSeat` are `TaskAssignee`, `TaskAssigneeRegistry`, `TaskAssigneeAddress` and `HandOffAssignee`, with no aliases (FIX-1796).
- 2ab7ea2: A coordinator hands each message to a delegate by filing a routed task: an ordinary task on the conversation's board with `session: "ongoing"`, `resultTo: "conversation"` and one attempt, worked on the delegate flow's `work` entry (FIX-2083).

  - A delegate is a worker whose flow takes tasks. Declare `work` with `workerTaskEntry({ name, turn })`; the turn is still handed `{ message }`. `routedTaskHistory` is the `work` turn's generator `history` that shows the model the conversation's recent lines.
  - `listDelegates` says a delegate `takes` `tasks` or `nothing`. A worker on a flow that takes no task can't be added as a delegate.
  - A judgment coordinator hands a message on with `createTask` and the routing settings (`session: "ongoing"`, `resultTo: "conversation"`, and `target` for a workstream's record); the server attaches the message as written. On a turn routing a message, `createTask` refuses a `session` other than `"ongoing"` (`routed_session_ongoing`) and `held`, `deps` or `followUpOf` (`routed_task_starts_now`). `createTask` takes `target`, set at filing only; `updateTask` refuses `session`, `resultTo` and `target` (`filing_setting_fixed`). `getTask` shows a task's `session`, `resultTo` and `target`.
  - On a board that dispatches, `createTask` starts a task as soon as it is filed; release a held one with `updateTask({ id, status: "pending" })`, with its `assignee` in the same write if it needs one, and wait with `getTask({ id, wait: true })`. On a conversation's board, a task filed with no assignee where several delegates take tasks now waits unassigned instead of being refused `assignee_required`.
  - A routed turn is a task turn, and a `taskLedgers` resolver is handed the claimed task's id as its fourth argument.
  - A delegate that files work for a message answers once that work has ended, and a second message to a busy delegate waits until the first ends. A round's deadline is a wake on the coordinator's session where the host keeps wakes, so it survives a restart.
  - The coordinator's line when nobody takes a message reads `Nobody took this message: …`.

- edc3197: A task row can carry `sealed`, a payload written once by the code that files it and packed to its worker as `TaskWorkerInput.sealed`; no task tool or update can set or change it, and `TaskFilter.sealed` matches on its plain values. (FIX-1872)
- 97894aa: A flow can check every new session's initial state with `session.createCheck`, refuse caller-seeded fields with `session.serverOwned`, and fix a field for a session's life by declaring it `.readonly()` in its session `stateSchema`; `listSessions({ state })` and the list route's `state.<field>` filter select sessions by a readonly field. On a flow that binds its sessions this way (a readonly field or a create check), an initial state that fails the `stateSchema` is refused on every path that creates a session; other flows keep it as sent. A dispatcher's `session: { key, state }` and a task dispatcher's `state` create the child session with that state. `ensureSessionRecord` now takes the create request beside the record it builds (FIX-1788).
- b552b50: A dispatched task now settles once, when its work is over (FIX-2077): after its request, the background work that request started and the background work the flow's `onFinished` started have ended, with no task it filed still open or still owing its ending. Until then the row stays `in_progress`, and `Task.keptOpenBy` says what holds it (`"filed"`, `"suspended"` or `"steer"`). A row that waits has no lease, so a task that stops to ask a person or to wait on an event is no longer reclaimed and run again when its lease runs out. The output is the latest `reportProgress` checkpoint, else the last answer that counts; a message's answer never is.

  Orchestration adds `taskRequestAdmission`, `noteTaskAnswer` and `afterTaskCheck` for a request that works on a waiting task, and `endRules` on `createTaskGate` and `taskLedgers`. Core adds `onRequestEnded` (`@flow-state-dev/core/types`), a framework-facing hook the engine runs after a request's last drain, on every way it ends.

  In Workforce a split task stays running while its pieces are open, and its output is its worker's answer like any task's. Read a piece's result from its own row (`listTasks({ filedByTask })`, `getTask`). A failed piece no longer fails its task by itself: the turn its ending wakes decides, and only a turn that throws fails the attempt. A worker that ignores a failed piece completes its task anyway.

- 2f342f6: Words sent into an open task now take one path, `updateTask({ id, message })`, and a finished task's output never changes (FIX-2086).

  - **Steer an open task.** `updateTask`'s `message` (tool and `updateTask_<board>` action), sent alone (`message_takes_no_edits` otherwise), keeps the message on the task (`Task.steers`, at most 20; `getTask` lists them as `steers`). A task that hasn't started gets every message in its first brief; a running request takes it before its next model call (`createSteerContext`); a task waiting on work it filed gets a turn now; one that lands after the last model call, even while the task settles, gets one more turn first (`taskLedgers({ endRules: { steerTurn } })`, with `complete`'s new `refuseUntakenSteers` guard, reason `untaken-steers`; on Workforce, `steerTurnEntry` declared under `STEER_TURN_ENTRY`). No attempt is used. A message taken mid-run shows in the task's session as a line from its sender (`showTakenSteers`). The collection write is `TaskCollectionRef.steer`, with `takeSteers` for the request holding the claim; the change kind is `"steered"`.
  - **Correct a finished task with a follow-up.** `updateTask({ message })` on a finished task is refused (`task_finished: a finished task takes no message; file a follow-up`). `getTask` shows the latest completed follow-up as `current: { id, output }`, and `listTasks` rows carry `current: { id }`.
  - **A line in a task's session.** On the built-in `agent` flow, a line in an open task's session is a steer from the user (`{ steered: <taskId> }`), with no reply beside it; in a finished one it is an ordinary turn and the task doesn't change.
  - **Coding runs.** `harnessSessionDoor({ board, harness, onSteered?, talkTimeoutMs? })` is a coding flow's one door: a steer while the task or a follow-up is open, talk (one run resuming the confirmed coding session, outside any attempt, holding the checkout) once all have finished. Its refusals are `not-started`, `cannot-continue`, `steer-limit`, `finished` and `not-supported`, the last three worded as Workforce's door words them (`LINE_STEER_REFUSALS`, `steerFromLine`). A steer reaches the run's next step in the same request and attempt; with `harnessManager({ stopsOnAbort: true })` it stops the running step once the harness has confirmed a session.

  **Migration.**

  - `TaskCollectionRef.reopen`, `Task.reopened`, the worker input's `reopened` and the `"reopened"` change kind are removed: file a follow-up, `createTask({ goal, followUpOf: id })`. A stored row with `reopened: true` reads unmarked; still open, it carries one steer pointing at the latest line in its session.
  - Send `updateTask({ id, message })` to steer a running task. A stored row that was waiting for a turn reads as `pending`, its next attempt uncharged.
  - Declare `harnessSessionDoor` as the coding flow's `message` action. `harnessManager` now returns a `TaskWorker`.
  - The harness manager's `turns` collection is no longer written or read. Run `upgradeKeptTurns(stores, { userCell, ledgers })` once at host start to write each kept line no attempt took onto its task as a steer. Shift Manager's DevTeam host runs it at every start; a second run adds nothing.

- edb3d46: `getOrCreateTaskCollection` now has two backings, `state` and `resource` (FIX-960). The
  `sequencer` and `request` backings merge into `state`: write `backing: "state", state: ref` where you wrote
  `backing: "sequencer", sequencer: ref`, and `backing: "state"` with no `state` where you wrote
  `backing: "request"`. Default slots are unchanged (`tasks` on a passed ref, the `collectionId` on
  the request), so stored tasks stay where they are. Renamed exports:
  `createSequencerBackedTaskCollection` → `createStateBackedTaskCollection`,
  `SequencerBackedOptions` (field `sequencer` → `state`) → `StateBackedOptions`, and
  `SequencerBackingSpec` / `RequestBackingSpec` → `StateBackingSpec`. `taskBoard` options are
  unchanged.
- 872a088: A task board's dispatcher can now choose its entry and its session for each row (FIX-1872). Give a `task` dispatcher an `action` of `{ among, by }` and `by` picks, per row, one of the entries listed in `among`; every listed entry is checked when the flow is defined, and an answer outside the list fails that row with `no-entry`. Give it a `session` of `{ by }` and it answers, per row, `{ key }` for a child session or `{ id }` for a session that already exists. An existing session is delivered into and never created: a missing one, or one the running user can't reach on this flow, fails the row with `session-not-found` or `session-not-addressable`. A string `action` and the `"per-task"`, `"per-worker"` and `{ key }` policies behave as before.
- 437727e: `createTask` now takes `input` as a JSON object. A string, number or array is refused at the tool's schema, so a model that would have sent the payload as a JSON string is told to send the object instead (FIX-1965).
- 2e8f640: A handed-off task now names the run working it: its row carries `run: { sessionId, requestId, attempt }`, written by the run before its worker starts and published as a `run_linked` task change (FIX-1668). `TaskCollectionRef` gains a required `linkRun` verb, so a hand-written collection must implement it.
- 30aa133: A task can now be handed to the worker its assignee names, including one hired after the host started (FIX-1778).

  - core: a task dispatcher's `flowKind` may be a function of the task (`TaskFlowTarget`), resolved once per hand-over; an empty answer refuses it `flow-not-found`. A task entry may declare `from` to take tasks from more than one ledger; such an entry runs queued unless it sets its own concurrency. A function `flowKind` requires `session: "per-task"`.
  - orchestration: `taskLedgers({ name, resolve })` builds that `from`, resolving each dispatch's ledger by id and refusing an unknown one before any row is read. A board's `defaultWorker` may now be a task dispatcher, handing a task over under its own assignee. Tasks record `createdBy` (the user whose request added them, server-only), which a hand-over passes to a per-task target as `filedBy`.
  - workforce: `createWorkerLookup({ instanceAt, declared })` says which worker a name means for the running caller, from the live registry; its `flowKind` plugs into a board's fallback.

- 7052203: A task now runs by the settings it was filed with, and nothing waits on work that will never finish (FIX-2080).

  - **`held` replaces `blocked`.** A held task is filed but doesn't start until it is released. `TaskCollection.block` / `unblock` become `hold` / `release`, the `"blocked"` status and `listTasks` filter value become `"held"`, `Task.undispatched` / `TaskInit.undispatched` become `held`, change kinds `blocked` / `unblocked` / `dispatched` become `held` / `released`, and the board's `counts.blocked` becomes `counts.held`. Stored `blocked` rows and recorded-not-started rows read as `held`; a `blocked` row's reason moves to `metadata.heldReason`, and a release starts it even if it had been retried.
  - **`blockTask` is removed.** Use `updateTask({ taskId, patch: { status: "held" } })` to hold a task before it starts, and `"pending"` to release it. `addTask` on a dispatching board files the task held.
  - **`patchSettings`** changes `held`, `deps` and `maxAttempts` until a task first starts, and declines `started` after.
  - **Dependencies are checked at filing.** A dependency on another board, on an ended task, or one that closes a loop throws `TaskFilingRefusedError` (`dependency_not_on_board`, `dependency_ended`, `dependency_loop`) and files nothing. To wait on another board, use a wait or a held task. A Workforce batch that names one id twice is refused (`duplicate_task_id`).
  - **Every board cancels the open dependents of a failed or cancelled task**, labelled `skipped`, with `causedBy`. `createCascadeSkipDependents` is removed; drop its `.tap()`. Plan-and-execute and supervisor now also cancel a cancelled step's dependents. A plan whose dependencies name no task, or loop, fails the run; a replanned task that depends on a failed one is filed skipped.
  - **Workforce:** a follow-up into a busy session waits, then runs when the open task ends, instead of being refused. The follow-up refusal code `follow_up_of_unfinished` is now `follow_up_of_unrun`: a follow-up of a task that never ran with a worker is refused, from the tools and from the board's ref alike. Code filing through the board's ref can set `session: "new" | "ongoing"` and `resultTo: "filer" | "conversation"` (one attempt; a wait on it is refused). When a task fails, is retried or is cancelled, the open pieces it filed are cancelled.

- 49d2aca: A stop that waits for a user holds its task and ends exactly once (FIX-2129).

  - **`ctx.suspendForUser({ kind, prompt, deadline? })`** (`core`): stop the request for an `approval`, a `review` or an `input`. It returns the answer, or `{ cancelled: true }` when the task was cancelled while it waited. At its deadline an approval reads as a no (`deadline: true`) and a review or an input throws `SuspensionTimeoutError`, which the block may catch. With no `deadline`, the host's `userDeadlineMs` applies, else none: the stop waits until it is answered, stopped or cancelled. The model's tool is `suspendForUser`; the task's open stop is listed on `Task.holds`.
  - **The answer route** (`engine`): `POST /api/flows/:flowKind/requests/:requestId/answer` answers a user's stop in any run, a task board's included, after the resume path's ownership checks; a request handle's `answer` (`client`) calls it. Who answered is the signed-in caller.
  - **`userDeadlineMs`** (`createFlowState`, `engine`): the host's deadline for a user's stop, unset by default.
  - **Cancel one stop:** `RequestHost.resumeWait({ suspension: { requestId, suspensionId }, outcome: { cancelled: true } })`.
  - `contracts` exports `isUserSuspension` and `suspendForUserKindOf`, and `SuspensionStatus` gains `"cancelled"`.

  A raw `ctx.suspend` with `user_approval` or `user_input` now gets the same mark, cancel and stop as `suspendForUser`. A raw `user_input` stop past its `timeoutMs` now resumes its block with `SuspensionTimeoutError` instead of staying parked, and a cancelled one throws `SuspensionRejectedError` with `cancelled: true`. A filing by a cancelled task is refused (`TaskFilingRefusedError`, rule `parent_cancelled`). Shift Manager answers every ask through the answer route.

- 96ff077: A turn waiting on another worker's task says **wait** (FIX-1876). `@flow-state-dev/core` exports `WAIT_GATE_REASON`, `isWaitGate`, `WaitGateBinding`, `WaitOutcome`, `WaitEndingErrorCode`, `parkOnWait`, `ParkOnWaitInput`, `parseWaitOutcome`, `recordedWaitOutcome`, `RequestHost.resumeWait`, `RequestHost.hasWaitSweeper`, `ResumeWaitInput` and `ResumeWaitResult`. `@flow-state-dev/orchestration` exports `waitGateId`; a row's wait slot is `Task.wait`, and `listTasks` marks a waited-on row `waitedOn: true`. `@flow-state-dev/engine`: the request host's `waitResume` and `waitSweeper` (`RuntimeConfig.requestHost`).
- 721a811: A task-board worker can now read its own claim (FIX-1047). `currentWorkerClaim(ctx)` returns the ticket inside a worker the board runs inline and inside a worker reached through a task entry, and `undefined` outside one. A worker's task-tool writes are limited to the task it holds, so a write naming a different task is refused. The observation ledger and the tool cache's `sourceTask` now record the worker's task.

  `currentWorkerClaim` takes the block context. A claim reads back only in the request that took it: a request the worker starts or resumes in the same process (a message, a dispatch, a resumed turn) gets `undefined`. Code that called `currentWorkerClaim()` with no argument must pass its `ctx`.

  `taskLedgers` takes `taskTurn: false` for an entry whose run answers the user rather than the task's filer. Such a run keeps its claim but is not a task turn: it can wait on work it dispatches.

### Patch Changes

- a5c1ce8: A task list's `delivery` can declare `onMidwayQuestion(ctx, row, holds)`: after a worker asks a question midway (`holdTaskForUser`, `askMidway`, or a coding run's question), the board calls it from the request that asked, with the row and its open midway holds, read from the stored row, so the task's filer can be told (FIX-2241). A replayed turn calls it again with the same holds. Task collection refs gain an optional `tellMidwayQuestions(row)`, which the resource backing implements when the declaration has the hook.
- 9f237f5: A turn woken by a filed task's ending, and an answer again about tasks that finished mid-turn (`answerAgain`), now read each ending as a `getTask` call and its result for that task, the row in full, instead of a user-role message holding the line with its output cut at 500 characters. The line under the delegate's name is unchanged, and a turn of your own that isn't the built-in generator still gets it as its message. `finishedTasksAnswerAgain`'s default message now names each finished task (`- <taskId> (<worker>): <ending>`) without its result. Orchestration exports `readTaskView(task, rows)`, the read `getTask` returns (FIX-2345).
- 5c8a130: A task's ending reaches the session that filed it once, on the defaults too: a `getTask({ id, wait: true })` that reads a task already ended no longer races that task's `onTaskSettled`. A notice now waits while the request that filed its task is running (not while it is parked on a person or a wait); that request sends what it held as it ends, and once it parks the session's pass sends it. `taskSettledEntry` takes a notice in one conditional write before it runs your block, and a copy never takes a notice from a request that hasn't ended. A wait that finds the notice taken returns `{ ok: true, taskId, arrivesAsNotice: true, message }` instead of the task. Task collection refs gain an optional `takeNotice(id, notice, take)`, which both built-in backings implement; a ref without it admits notices as before. A filing's `metadata` can no longer carry notice records (FIX-2123).
- cb364e8: A `getTask({ id, wait: true })` on a task whose ending the session already heard as a notice now returns the task, with its output, instead of `arrivesAsNotice` (FIX-2181). `arrivesAsNotice` still answers while that notice is being delivered: still owed, or acknowledged by an `onTaskSettled` request that is still running.
- af6c7cd: A settlement presented with the claim of a turn that asked questions midway is refused (`held`) even after its questions are answered, on both backings. The answer owes the task one more turn on the same attempt, and that turn settles it: an inline board's drain no longer completes the task with the asking turn's result (FIX-2132).
- c245f7c: A task board whose drain stops on tasks waiting on a user (a question, a confirm, or a run stopped for review or approval) now reports `terminationReason: "waiting-on-a-user"` on its completion item, instead of `"blocked-by-failures"`. A failed task beside them still reports `"blocked-by-failures"` (FIX-2214).
- 0836ffa: If a person's answer lands just as a `goalSeekLoop` drain stops, the loop drains again for the turn the task owes before judging, and those drains spend no iteration. If the task still owes a turn when they run out, the pass ends with `reason: "waiting-on-a-user"` without judging (FIX-2210).
- 10ded49: A stopped or timed-out wait whose own cancel of its task fails no longer leaves the task open for good (FIX-1844). The failed cancel is recorded on the row as `Task.cancelOwed`, and the next board touch cancels the row. Whatever ends the row clears the marker, and that ending owes the stopped turn no resume. Both built-in backings implement the new optional `TaskCollectionRef.markCancelOwed` (change kind `cancel_owed`), and `TaskFilter.cancelOwed` matches marked rows. A failed cancel no longer surfaces as a tool error on a timed-out wait: the call still answers `wait_timed_out`.
- 3221d05: A dispatched task's background work that errors now fails its attempt (FIX-2088), as if its request had thrown: the task runs again while it has attempts left, otherwise it fails with an error naming the step (`Background work "<step>" failed: ...`). It counts in every request working the task, including steps `onCompleted` and `onFinished` start and a step a default `.waitForSideChain()` already drained. The request itself still reports `completed`. A cancel never fails the task this way, and a step that failed before a suspension counts only if its rerun on the resume fails too. Make a step best-effort by catching inside it.

  Core adds `RequestEnding.backgroundFailures` and the `BackgroundFailure` type (`@flow-state-dev/core/types`), and `RequestSideChainPool.failures()`; the engine hands a request's background failures to its request-end hooks. In Workforce, a failed `afterAnswer` step (such as a memory capture) fails a task's attempt too, except in a task filed `resultTo: "conversation"`, where it is logged and the task keeps its answer. Conversation turns are unchanged. A step a timed-out `.waitForSideChain({ timeoutMs })` stopped waiting on is still waited for before the request ends, and its failure counts and is logged, with `failOnError` too; `drainScope` takes an `abandoned` signal for this. The MOAT bash provider's purge of stale containers now logs a failure instead of throwing it.

- 70cfac9: `cascadeSkipDependents` no longer labels a task `skipped`, or skips that task's dependents, when its cancel was declined because the task had already been settled by something else (FIX-985).
- 5d94e61: A filing's dependency check reads each dependency as stored now, so a dependency another request failed or cancelled while the filing ran is refused `dependency_ended` at filing, and nothing is stored, as the docs say. Before, the filing was accepted and a cascade cancelled it moments later (FIX-2114).
- b234f0d: A drain cancels a dependent stuck behind a crash-owed cascade before it decides to exit, and a refused batch files nothing (FIX-2096).
- ad5df6f: Durable execution is on by default wherever stores persist (FIX-2063). `createFlowState` over filesystem, SQLite or Postgres stores now installs the checkpoint durability provider without `durable: true`; over in-memory stores it still installs none unless `durable: true` is set. `resolveDurabilityProvider({ stores, durable })` exports the rule for hosts that build `createFlowApiRouter` or call `runAction` themselves, and the in-memory checkpoint and suspension stores declare `persists: false`.

  `ctx.suspend()` on a host without durable execution now throws an error that names the rule and the setting to change, instead of "requires a DurabilityProvider". The durability sweeper arms for a pending stop's deadline as it does for a wait's, and reads the store's deadlines once at start.

  A no-config `fsdev run` now writes to `.fsdev/data/fsdev.db` (the SQLite file `fsdev dev` reads) instead of JSON files under `.fsdev/data`, and runs as `devuser`, the DevTool's default user (exported as `DEFAULT_LOCAL_USER_ID` from `@flow-state-dev/core`), instead of `cli-user`. `fsdev run` and `fsdev chat` use `devuser` as the default user with a config too. A run that stops for a person exits 0 with a `suspended` NDJSON event, `result.suspended` in `--capture`, and a waiting report on stderr. The no-config `fsdev dev` router is durable and sweeps. `--store filesystem` on `fsdev run` and `fsdev dev` keeps the JSON-file store, single-process.

  **Migration.** An app on persisting stores that never set `durable` now:

  - writes a checkpoint at every step of every sequencer (sequencers already default to `durable: true`),
  - resumes a request that crashed instead of rerunning it,
  - holds a raw `ctx.suspend()` until it is answered, where it used to fail the request,
  - runs the durability sweeper wherever it serves a router: a lease and a scan of pending stops on each tick, even when nothing waits.

  Set `durable: false` on `createFlowState` to keep the old behavior. Sessions a no-config `fsdev run` wrote as JSON files are not read by the SQLite default; pass `--store filesystem` to read them. Scripts that look up CLI sessions by `cli-user` should use `devuser`, or pass `--user cli-user`.

- 3c10d9d: `checkWaitable(ctx, { key, deadlineMs?, step?, binding?, own?, unavailable })` and `toolCallOf(ctx)` are exported from `@flow-state-dev/orchestration/task-board`. `checkWaitable` runs the checks every wait makes before anything is written (`wait_unavailable`, `wait_deadline_out_of_range`, `wait_too_deep`, `wait_already_pending`), so a tool that waits shares `getTask`'s rules (FIX-2239). The step is now claimed after the depth check, so a wait refused for its depth no longer holds its model step.
- 3ee61e5: A failure's or a cancel's notice names every dependent its ending cancelled, as the docs say, also when another request filed the dependent after the failing worker's run had read the board. `onTaskSettled` cancels such a dependent before it runs your block and adds it to the notice's `cancelled`. Before, the notice named none, and the dependent was cancelled later with no notice of its own, so the filer never heard of it (FIX-2136).
- f12089e: A follow-up task's result now goes where its root task's went: a follow-up of a task filed `resultTo: "conversation"` lands as the delegate's reply, with one attempt, and a follow-up that names `resultTo` is refused `follow_up_takes_no_result_to`. In a Workforce conversation, the failure or cancel of a conversation-result task with no routed brief, such as that follow-up, now shows as a line, and wakes the coordinator's turn under judgment or best-fit routing (FIX-2122).
- 35bec56: A follow-up task now runs in the session its root task ran in when that task was filed `session: "ongoing"` or for a workstream: its row carries the root's `session`, `target` and `targetSessionId`, and a follow-up that names a `target` is refused `follow_up_takes_no_target` (FIX-2111).
- 3b40ca1: `getTask` names the dependents a failure or a cancel cancelled when its answer is how the filer hears that ending: a wait that finds the task already ended, a wait the ending resumes, or a read of an ending held for a wait that lapsed. The answer carries `cancelled` beside `task`, as the notice it replaces would have. Before, the notice was dropped and nothing named them (FIX-2138).
- 809cebd: `harnessManager` can read each run's board from its claim (FIX-1866). Give it `ledgers`, a resolver typed like `taskLedgers`'s, and the task's entry hands it the claim on its input as `claim: { collectionId, partition, incarnationId }`; every read and write is still fenced against the row at that ledger and partition. Runs are kept apart by board and partition (`runBoardSegment`). On such a board a refused run ends the task `errored` instead of `cancelled`, and a question parks the task on the board itself, with the answer reaching the next attempt's prompt. A completed run's output now carries `answer`, `branch`, `commits` and `judged`, and `isDone` reads the run's `answer`. An optional `judge` (a host block and a confidence floor) reads a run on such a board after `isDone` passes; `harnessDrainBudgetMs` takes `judge: true` to reserve its time. A fixed board runs as before.

  Orchestration's `fail` takes `noRetry: true` to end a task `errored` on this failure even when it has attempts left.

- c4d9743: A request parked on a person or on another wait no longer holds the ending of a task whose `getTask({ id, wait: true })` reached its deadline. The filing session's pass, woken at the park, lets the ending go: `onTaskSettled` hears it within seconds of the park, as it already hears a task the parked request filed. A wait on the task after the resume usually answers `arrivesAsNotice`; one that reads it in the couple of seconds before the pass takes the notice gets the ending inline instead. Either way the session hears it once. While the request runs, its next `getTask` on the task still gets the ending, as before. A request whose state the host can't read is treated as parked here too, as it already is for a held notice (FIX-2170).
- 90a5e64: A task's notice held while the request that filed the task was running now reaches the filer about two seconds after that request parks on a person or a wait, rather than at the notice's next resend, which could be up to 5 minutes away once its backoff had grown. The park owes the filer's pass one wake and reads no row. In Workforce, a drain parked on a step that runs in a session of its own now resumes within seconds when the step ends while the drain is still parking, rather than at the wait's deadline (FIX-2149).
- d356f52: `listTasks` (the task tool and its `listTasks_<board>` action) now answers each task's `run` link, the run working it or the one that last did, so a task list can open it (FIX-1792).
- 859f621: `createTask` files one task for one piece of work. Filing the same `goal` (ignoring case and spacing) for the same assignee and workstream `target` while a task for it is still open is refused with `already_open`, naming the open task by its title, and nothing is filed. A follow-up, and a message handed on with `resultTo: "conversation"`, keep their own rules (FIX-2350).
- 16455f2: New `@flow-state-dev/orchestration/inbox` subpath, safe to import in a browser: the read an Inbox lists from (FIX-2133).

  - `inboxItems` builds one item type for everything waiting on a user. Each task row that waits on the user gets one item, and a stop in its run never lists a second time. Each suspension no open task's run holds gets one item too.
  - Each hold carries an `answerable` flag, and an item is answerable when any hold is.
  - `createInboxClient(client).answer(item, answer)` is the one answer call. The answer is typed by what the hold asks (`InboxAnswerFor`). A suspension's answer goes to the engine's answer route.
  - The package now depends on `@flow-state-dev/client`.

- 24744af: On a Workforce conversation's board, a task runs one turn at a time in its session: while one of its turns waits on a step it filed for itself in a session of its own, a notice's turn and a steer's turn wait until it answers, instead of planning beside it and stalling the task. `taskSettledEntry` takes `defer`, and `resendNowPatch` is exported (FIX-2113).
- 4a3b026: A task whose worker stops for a person in the turn an answered question owes, such as a `suspendForUser({ kind: "review" })` after `holdTaskForUser`, now settles when that stop is answered and the turn ends (FIX-2283). Before, the stop's hold stayed open on the row and the task never left `in_progress`.
- 311a6d5: `@flow-state-dev/orchestration/tasks` no longer reaches `node:module` or `node:url`, so a browser bundle can import it. Core adds two subpaths, `@flow-state-dev/core/blocks/handler` and `@flow-state-dev/core/blocks/sequencer`, that expose the block builders without the main entry's Node-only model resolver (FIX-1608).
- 12bf045: A `defineTaskCollection` with `partitionBy` keeps its rows in the user's own cell even on a flow that isolates its user state (`isolateUserState`), so a task entry on another flow finds the row it was handed (FIX-1794).
- 726de78: A plan board's drain that fails after handing a row to a session of its own now fails its request, naming the row, whatever `onError` says, instead of waiting with no signal (FIX-2104).
- d348ae7: `getTask({ id, wait: true })` on a row a plan board's drain handed to another session and waits on is now refused with `wait_on_plan_step`, which tells the agent to wait on the plan instead, for as long as the drain waits, deadlines included. Before, a wait that landed at one of the drain's deadlines took the row's wait slot and failed the plan (FIX-2105).
- dd2563b: A conversation board now shows a browser the question a task waits on (`Task.holds`). Shift Manager's shift summary lists tasks held on a question for the user under Needs you, and its DevTeam chief of staff answers from what a finished task found (FIX-1972).
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

- d2dd7f7: Tasks filed in the same millisecond are claimed in the order they were filed. The id counter is fixed-width, so those ids compare in mint order. (FIX-2219)
- d994f51: `createSkillActivator` takes an optional `evaluator` for tier 3, with `skillEvaluator(model)` and `skillQuestions` to build one (FIX-1559). The evaluator picks one skill or none from the same catalog the classifier would see, and its pick is final: no confidence threshold, no fallback to the classifier. Without it, activation is unchanged.
- afb512f: `skillEvaluator(model, { recentMessages: N })` lets the skill activator's evaluator see the last N turns before the message, so follow-ups like "yes, do that" activate the skill an earlier offer was about (FIX-1595).
- 09e3705: Skill names that are Windows device names (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`) are now refused, so a skill with one of those names stops loading until it is renamed (FIX-1456).
- eb66ddd: A worker on a task can split it into pieces for any worker on the user's roster that takes tasks, not only its own delegates; an unassigned piece still goes to its only delegate, and the chain limits still apply. A split task now completes with `{ answer, pieces }`: the answer of the turn the last piece's ending woke, with the pieces' outputs under it. It settles only once every piece has ended and its ending has been heard. When it settles with no such turn (a settle replayed after a restart), the output is `{ pieces }` alone, as before. On a task turn, a worker files its pieces and ends the turn: each piece's ending wakes the task (FIX-1997).
- cd180d7: Stopping a paused request now ends it `aborted` and records its gate with the new `stopped` suspension status, a turn paused on an ask cancels the asked task instead of waiting for it, and a durable host now runs the durability sweeper even without `durabilityRetention`, so a paused request past its `expiresAt` expires and an ask past its deadline times out, while pruning still waits for a retention policy (FIX-1816).
- 9edbfa2: A worker can now end its task on the current attempt without writing the ending itself: throw `TaskEndsForGoodError` (from `@flow-state-dev/orchestration/task-board`) naming the task it holds (`taskId`), and the board's error recorder ends that row under the worker's claim, `errored` with no retry by default or `cancelled` with `{ ending: "cancelled" }`. A marker naming any other row, such as one rethrown by a board nested inside the worker, is an ordinary failure.

  Harness Manager's refused run uses it: the manager no longer fails or cancels its own row, and the board records the ending. The outcome is unchanged (`errored` on a board read from the claim, `cancelled` on the fixed board). `HarnessRunRefused` now extends `TaskEndsForGoodError`, and its constructor takes a second argument, `{ taskId, ending }` (FIX-2090).

- 9cd314d: `defineTaskCollection` accepts `partitionBy` on a `user`-scoped collection, keeping one set of rows per partition so each conversation's board reads, claims, waits on and settles only its own tasks while a board's hand-off carries the partition (core's task dispatch envelope gains an optional `partition`) to a task entry on another flow, whose gate and `taskLedgers` resolver read the row there (FIX-1794).
- 9af8ce5: A dispatched task records what its runs spent on its row (`spend`), every attempt counted, rising while a run works: the board writes it every 2 s and as the request ends, through the new `recordSpend` verb on `TaskCollectionRef`. `listTasks` from `taskToolActions` returns it folded (`taskSpendView`: harness, model, input and output tokens, `null` until reported). Harness runs report spend as they go, keyed by a `runId` with the model the run named, each report replacing the run's last; `readRequestSpend(ctx)` reads a running request's spend so far, and `requestSpendSources` moves from Workforce into core (FIX-2288).
- 7035b4c: `createTask` takes an optional `title`, a short label for the task apart from its `goal`, and `listTasks` answers it when a task has one (FIX-1974). A task filed without a title is still labelled by its goal.
- 912ae98: A durable task board's task tools can now run as flow actions (`taskToolActions(board)`), and the DevTool's Tasks tab opens a task's full record and runs those actions from the row, showing a refusal as a refusal (FIX-1629).
- 78178a9: A partitioned ledger now takes the bare user id from the user scope, not the user record's storage key, when the session names no user (FIX-1790).
- da86f88: A `getTask({ id, wait: true })` on a task that already ended returns it at once, and that answer is the filer's delivery: when the flow's `onTaskSettled` waits behind the turn that filed the task, as Workforce's turns make it, the ending's notice request still runs but no longer calls your block. Task collection refs gain an optional `dropNoticeReadByWait(id)`, which both built-in backings implement; a ref without it keeps the old behaviour (FIX-2112).
- 98b90a6: Workers can be data: `createWorkerInstallation` gives a worker flow a create check that names the session's worker once, `resolveWorker` loads it each turn, `createWorkerHireBlocks` writes the user's roster, and `createWorkforceClient` finds or starts a session with a worker. `writeShared` now names the worker the turn loaded, not a `seatId` setting. `createSkillsLibrary` takes `partitionBy` to keep one catalog per party on one flow copy (FIX-1788).
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
- Updated dependencies [585b75b]
- Updated dependencies [646f8d2]
- Updated dependencies [16a8dab]
- Updated dependencies [49852d9]
- Updated dependencies [698e06b]
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
- Updated dependencies [60d1bf4]
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
- Updated dependencies [f6461ea]
- Updated dependencies [41638f3]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [db7df1c]
- Updated dependencies [0d6278e]
- Updated dependencies [968faa6]
- Updated dependencies [653549d]
- Updated dependencies [6a3ecf5]
- Updated dependencies [839e915]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
- Updated dependencies [65ddb90]
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
- Updated dependencies [b7c523b]
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
  - @flow-state-dev/client@0.3.0

## 0.3.0

### Minor Changes

- 0f812c9: Skills, seats and channels now answer the agent discovery door and a seat narrows what it sees with its worker file's `discover:` key (FIX-817) — **breaking:** `createWorkforceCapability` no longer accepts `agents` (pass `roster` and `inventory`) or `catalog` (pass it to `defineAgentWorkerFlow({ catalog })` instead), each now a type error naming its replacement.
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
- bff5e06: FIX-1393: a generator's declared `tools:` is now a runtime fence over capability-contributed tools, not just a documented one.

  A capability's tools used to be unioned onto whatever the block declared, so a block with `tools: []` could still be handed tools it never named. Declaring the slot now drops a capability's catalog-granted tools — `tools: []` reaches the model with none. Omitting `tools:` entirely is unchanged: it declares no fence, so capability tools still flow.

  Capabilities declare tools through two slots. `tools` is a grant from the app's catalog and is fenced. The new `controlTools` is a framework control the consuming block's own configuration asked for, and the fence never touches it — a control is built inside its capability and never exported, so no `tools:` list could name it back in. One capability may use both: the skills library registers the app catalog through `tools` and its own skill loader through `controlTools`, and `taskTools` contributes the delegation board entirely as controls.

  **Migration.** If you relied on a capability's tools arriving past a narrower `tools:` declaration, name them in `tools:` or drop the declaration. Pattern factories (`planAndExecute`, `supervisor`, `routedSpecialists`) forward both slots, so a call site passing `tools` and `uses` together now gets the fence inside the pattern. Capability authors whose tools are framework controls rather than catalog grants should move them to `controlTools`.

### Patch Changes

- 8faf08e: A `CHANNEL.md` can declare `boards:`, durable task ledgers the channel holds, with `fileTask` and `readBoard` actions on the channel and a `channelBoard()` helper for the worker that drains them (FIX-1385).
- 218de72: An active skill's `allowed-tools` now renders into the generator's context as the skill's intent rather than as a grant of tool access (FIX-1451).
- Updated dependencies [b597600]
- Updated dependencies [6b8bfe4]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
  - @flow-state-dev/core@0.2.0

## 0.2.1

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2

## 0.2.0

### Minor Changes

- 64b323e: A skill `agents:` `prompt-ref` entry is the seat name only — `tools`, `model`, `visibility`, and `context-supply` now live in the prompt file's YAML frontmatter, and leftover skill-entry tuning is rejected at parse (FIX-1370).
- c25ad3e: `createSkillActivator` takes a new `enableKeywordMatch` option (default `true`, preserving today's pipeline). Set it `false` to drop tier 2 (keyword scan) from the activator pipeline entirely, leaving only the slash tier and, if enabled, the classifier — useful for a caller whose activation contract has no keyword tier (FIX-1363).
- 23ac6de: `createSkillsLibrary({ catalog })` takes a new `registerCatalogTools` option (default `true`, preserving today's behaviour). Set it `false` to keep validating a bound skill's declared `allowed-tools` against `catalog` without the library registering any of `catalog` on the generator itself — useful when a caller already owns tool registration through its own means (FIX-1363).

### Patch Changes

- 23bc757: Each worker on a roster now holds its own skills, seeded from its own org, team and worker folders instead of one shared bucket — a catalog already seeded under the shared key is re-seeded under the worker's own and its old rows are left behind (FIX-1362).
- 119936d: New `@flow-state-dev/workforce/loader` subpath: `readWorkforceDirectory(root)` scans `teams/<id>/workers/<name>/` and returns one neutral manifest per worker, so a workforce can be declared in files instead of wired by hand (FIX-1335). `orchestration` gains `splitFrontmatter` and `parseFrontmatterYaml`, the frontmatter dialect `SKILL.md` and `WORKER.md` share; parsed frontmatter records now have no prototype, so a `__proto__:` key in a hand-written file is carried as an ordinary key instead of silently replacing the record's prototype.
- 8a1173a: `readSkillsDirectory` now reports a `SKILL.md` that exists and cannot be read as a read failure, with the underlying reason, instead of reporting it as missing. A genuinely absent `SKILL.md` still reports missing (FIX-1356).
- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
  - @flow-state-dev/core@0.1.1

## 0.1.0

### Minor Changes

- bea3a24: `resumeFromReview` is renamed `unpark` and now refuses every status but `parked` as a `declined` value instead of writing or throwing, and the task board gains `board.unparkAndDrain`, a step that writes an answer to a parked task and drains the board in the same request only when the answer was accepted (FIX-1244).
- b3e6e22: Initial release (FIX-1187).
- 5fa52aa: One dispatch protocol: every arrival at a flow — a caller's action, a webhook, a schedule, a task hand-off, an internal dispatch — is a dispatch of one type delivered to one entry addressed by `(type, name)`, with no fallback between types (FIX-1302).

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

- fda9b15: Background work is declared with a task-board dispatcher seat and read back as child sessions: a session's children are listed at `GET /sessions/:sessionId/children` through `listChildSessions()` and `useSession`'s `childSessions` / `childSessionsStale`, session-scoped resources shared with them use `sharedToLineage`, and the two `createFlowState` options are `dispatchDrainTimeoutMs` and `maxChildSessionListLimit`; the Workstream surface they replace is removed, `ctx.requestHost.startDetached` and `dispatch: { mode: "detached" }` with it (FIX-1308). From `@flow-state-dev/orchestration/task-board` that removes the detached-mode helpers (`assertDetachedBoardSupported`, `detachedTaskPredicate`, `coordinateKey`, `coordinateLabel`, `workstreamRoutingSeed`, `WorkerCoordinate`, `TaskWorkerDispatch`, `TaskWorkerSlot`, `TaskWorkerSlotRegistry`, `TaskWorkerEntry`, `isTaskWorkerEntry`) and `board.detachedWorkers`; a seat is a block or a `dispatcher({ type: "task" })`, and `resolveWorkerSlots` now returns the bare blocks plus the `HandOffSeat`s (`name`, `label`, `dispatch`) in one walk from the hand-off module. A `{ worker, dispatch }` or `{ block, session }` seat is refused by name at construction. The DevTool's Children panel pairs a child with its task from the dispatch key a `per-task` or `per-worker` seat derives (a `{ key }` policy pairs nothing) and shows the entry it was dispatched for.

### Patch Changes

- b484d86: Task Board workers that declare `taskWorkerInputSchema` now receive the `priorWork` the board's flow policy selected instead of having it stripped by the schema (FIX-1288).
- 0443742: A task handed to a child session now takes its row back and runs when the child starts after the lease has lapsed, instead of refusing the dispatch and waiting for another drain to spend an attempt re-dispatching it (FIX-1305) — `renewLease` gains `adoptLapsedLease` for that takeover, tasks record the lease duration their claim was granted as `leaseDurationMs`, and `committedLeaseSpan(task)` reads it back.
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

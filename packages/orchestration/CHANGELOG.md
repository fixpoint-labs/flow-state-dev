# @flow-state-dev/orchestration

## 0.4.0

### Minor Changes

- e457697: A task row can be an ask (`Task.ask`: the gate its asking turn parks on, and a deadline). The write that ends an asked row also sets `Task.resumeOwed`, on both built-in backings; `TaskFilter.resumeOwed` matches those rows, and the optional `TaskCollectionRef.clearResumeOwed` clears the marker (change kind `resume_settled`). Rows that are not asks are unchanged (FIX-1816).
- 082693f: Ask follow-ups (FIX-1816): `createTaskToolsCapability` and `taskToolsForTurn` take `{ resumesAsks }`, off by default, so an existing caller of either no longer offers `waitForResponse` until it passes `resumesAsks: true` for a board whose runner calls `resumeOwedAsks` (Workforce's conversation board does); `listTasks` marks an asked row `asked: true`; and `addTaskAndWait` files its row once across a crash, counts the deadline from the filing, answers with a row that completed just before its timeout's cancel, keeps a caller-supplied id but adopts a row under it only when the same call filed it (an ask's gate id now ends in a per-filing nonce, so read it from `row.ask.gateId`, never rebuild it with `askGateId`), and on a re-drive reports the outcome its gate recorded.
- e00a3b0: The task tools' roster type is renamed `WorkerRoster` → `AssigneeRoster`, the name for who a board's tasks can be assigned to. Its shape is unchanged (`has(assignee)`, `describe()`), so updating the import is the whole migration. The new `AssigneeRosterSource` is either a fixed `AssigneeRoster` or a function of the running block's context that is read on each call that checks an assignee, for a board whose team changes while it is in use. `createTaskToolsCapability(resolver, roster?)` and both `taskToolActions` overloads accept it (FIX-1794).

  A durable task ledger can take `defineTaskCollection({ recordEnding })`, a pure function that is handed every write recording how a task ended (completed, errored, retried, parked, cancelled) inside that same write, and whose `metadata` the row keeps. There is one ending signal on both backings. The ending is detected once, where every write passes, and each recorder runs there in the ending's own write: orchestration's resume recorder first (`Task.resumeOwed` on an asked row's ending, unchanged), then the declared `recordEnding`. `awaitReview(..., { quiet: true })` tells the recorders a park asks nobody anything (FIX-1794).

- 5492a77: A new `dispatchTask` tool (and `dispatchTask_<board>` action, offered in the DevTool's Tasks tab) starts work on another worker now and can wait for its result with `wait: true`, while on a board that dispatches (a Workforce conversation's, or one built with `{ dispatches: true }`) `addTask` and `assignTask` only record a task until `dispatchTask` names its `taskId`, `addTask` refuses `waitForResponse` and `timeoutMs` with `add_task_does_not_wait`, and the wait names are renamed with no alias (`addTaskAndWait` → `dispatchAndWait`, `AskEndedError` → `WaitEndedError`, `canHoldAsk` → `canHoldWait`, and the rest of the `Ask` names to `Wait`) (FIX-1875).
- 6819520: A task board that starts a row on another worker now **dispatches** it; **hand-off** means only passing work that is already under way (FIX-1876).

  - The board's ending for "every remaining row is running in a dispatch run" is now `terminationReason: "dispatched"` (was `"handed-off"`). A log stored before the upgrade still carries `"handed-off"` for the same ending, so a reader of `task-board-meta` items should take both.
  - The row-dispatch block's output is now `{ dispatched: true, taskId, sessionId, requestId, adopted }` (was `handedOff: true`).

  The old exports are gone, with no alias, so an import of one fails to compile and names it:

  - `@flow-state-dev/orchestration`: `createHandOff` → `createRowDispatch`, `HandOffOptions` → `RowDispatchOptions`, `HandOffAssignee` → `DispatchingAssignee`, `handedOffTaskPredicate` → `dispatchedTaskPredicate`, `assertHandOffBoardSupported` → `assertDispatchBoardSupported`, `assertHandOffBlockSupported` → `assertDispatchEntrySupported`, and the board handle's `handedOff` → `dispatchers`. The board's internal dispatch blocks keep their names (`<board>-hand-off-<assignee>`, `<board>-hand-off-fallback`), since a recorded route decision names them and a request resumed across the upgrade must reselect the same route.
  - `@flow-state-dev/core` and `@flow-state-dev/engine`: no export changes. Definition-time and run-time refusals say a block "dispatches to task:…" where they said it "hands off to task:…".

  The task-board page's "Assignees that hand off" section is now "Assignees that dispatch"; the old anchor still lands on it.

- 17444fe: On a board that hands tasks off, `setAssignee` now declines `immutable-assignee` only while an attempt holds the task (`in_progress` or `parked`). A pending or blocked task can change hands, and its next claim hands it to the new assignee; `unpark` a parked task to move it. A finished task declines `terminal`, as on any board (FIX-1780).
- 0b37a7f: A person can send a running coding run a message (FIX-1690). `manager.messageDoor({ drain })` builds a public action that takes `{ message }` on the run's own session: it stops a running attempt, and the next attempt resumes the same coding session with the message in its prompt. `drain` names an `internal` entry on the flow that runs the board's drain; the door dispatches it into the session that claimed the row, so every attempt stays in the run's session. A run waiting on a question, between attempts, about to start one, or that didn't stop in time keeps the message for its next attempt and answers `kept`. A refusal (never started, finished, a harness that can't resume) fails the request with `TurnRefused`. The manager registers a new `turns` collection, so a capability that claims the `turns` accessor is now refused.

  In orchestration, `awaitReview(id, feedback, { forTurn: true })` parks a running row for a person's turn. It runs only from `in_progress`, and the claim that follows its `unpark` is counted in the new `turnReentries` field and not charged against `maxAttempts`.

- 16bb676: Skill sub-agents are removed: a `SKILL.md` that declares `agents:` is refused when it loads, `createSkillsLibrary` drops its `workerModelId`, `maxTotalTasks`, `maxEnqueuedTasks`, `agentRegistry`, `materializeAgent`, `capabilityCatalog` and `toolSeatFence` options and the `delegation` and `guidance` binding keys, and `runBoard`, `materializeWorker`, `buildUserMessage`, `workerInputSchema`, `DEFAULT_WORKER_PROMPT` and `FLOOR_WORKER_KEY` are gone, so delegate to workers through the task board and its task tools instead (FIX-1814).
- c4150e7: A person's message on a finished task reopens it: task collections gain `reopen(id)`, the harness manager's door reopens a finished run when its board names `reopenIn`, a worker's reply in a finished task's session on a Workforce conversation board reopens that task, and Shift Manager's task composer takes a message on a finished task (FIX-1764).
- d1a4cab: A task board's seat is an assignee: `TaskSeat`, `TaskSeatRegistry`, `TaskSeatAddress` and `HandOffSeat` are `TaskAssignee`, `TaskAssigneeRegistry`, `TaskAssigneeAddress` and `HandOffAssignee`, with no aliases (FIX-1796).
- edc3197: A task row can carry `sealed`, a payload written once by the code that files it and packed to its worker as `TaskWorkerInput.sealed`; no task tool or update can set or change it, and `TaskFilter.sealed` matches on its plain values. `dispatchTask` takes a post form (`post: true` with `assignee` and an optional `target`) on a turn that routes a post, when the board offers one (`DispatchPostForm`). (FIX-1872)
- 97894aa: A flow can check every new session's initial state with `session.createCheck`, refuse caller-seeded fields with `session.serverOwned`, and fix a field for a session's life by declaring it `.readonly()` in its session `stateSchema`; `listSessions({ state })` and the list route's `state.<field>` filter select sessions by a readonly field. On a flow that binds its sessions this way (a readonly field or a create check), an initial state that fails the `stateSchema` is refused on every path that creates a session; other flows keep it as sent. A dispatcher's `session: { key, state }` and a task dispatcher's `state` create the child session with that state. `ensureSessionRecord` now takes the create request beside the record it builds (FIX-1788).
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
- 437727e: `addTask` and `dispatchTask` now take `input` as a JSON object. A string, number or array is refused at the tool's schema, so a model that would have sent the payload as a JSON string is told to send the object instead (FIX-1965).
- 6f5a697: The task tools gain `answerTask` and `addTask`'s `followUpOf`, and `createParkOnQuestion` builds a worker's `parkOnQuestion`, so a task can stop on a question, take its answer without spending a retry, and be followed up in the same session (FIX-1817).
- 2e8f640: A handed-off task now names the run working it: its row carries `run: { sessionId, requestId, attempt }`, written by the run before its worker starts and published as a `run_linked` task change, and a mailbox board's `readBoard` and browser read both return it. `TaskCollectionRef` gains a required `linkRun` verb, so a hand-written collection must implement it (FIX-1668).
- 30aa133: A task can now be handed to the worker its assignee names, including one hired after the host started (FIX-1778).

  - core: a task dispatcher's `flowKind` may be a function of the task (`TaskFlowTarget`), resolved once per hand-over; an empty answer refuses it `flow-not-found`. A task entry may declare `from` to take tasks from more than one ledger; such an entry runs queued unless it sets its own concurrency. A function `flowKind` requires `session: "per-task"`.
  - orchestration: `taskLedgers({ name, resolve })` builds that `from`, resolving each dispatch's ledger by id and refusing an unknown one before any row is read. A board's `defaultWorker` may now be a task dispatcher, handing a task over under its own assignee. Tasks record `createdBy` (the user whose request added them, server-only), which a hand-over passes to a per-task target as `filedBy`.
  - workforce: `createWorkerLookup({ instanceAt, declared })` says which worker a name means for the running caller, from the live registry; its `flowKind` plugs into a board's fallback and `filingCheck` into a mailbox's new `checkAssignee` option, which refuses `fileTask` for a name no worker holds. `mailboxTaskLists(ids)` lets a worker take tasks from mailbox lists, and the `agent` kind's new `taskLists` option gives it a `work` task entry over them.

- 96ff077: A turn waiting on another worker's task now says **wait** everywhere; **ask** means only a question to a person (FIX-1876). The old exports are gone, with no alias, so an import of one fails to compile and names it:

  - `@flow-state-dev/core`: `ASK_GATE_REASON` → `WAIT_GATE_REASON`, `isAskGate` → `isWaitGate`, `AskGateBinding` → `WaitGateBinding`, `AskOutcome` → `WaitOutcome`, `AskEndingErrorCode` → `WaitEndingErrorCode`, `parkOnAsk` → `parkOnWait`, `ParkOnAskInput` → `ParkOnWaitInput`, `parseAskOutcome` → `parseWaitOutcome`, `recordedAskOutcome` → `recordedWaitOutcome`, `RequestHost.resumeAsk` → `RequestHost.resumeWait`, `RequestHost.hasAskSweeper` → `RequestHost.hasWaitSweeper`, `ResumeAskInput` → `ResumeWaitInput`, `ResumeAskResult` → `ResumeWaitResult`.
  - `@flow-state-dev/orchestration`: `resumeOwedAsks` → `resumeOwedWaits`, `askGateId` → `waitGateId`, the task tools' `resumesAsks` option → `resumesWaits`, a row's `Task.ask` → `Task.wait`, `listTasks` marks a waited-on row `waitedOn: true` instead of `asked: true`, and `parkOnQuestion` on a task a turn is waiting on is refused with `waited_on_task` instead of `asked_task`.
  - `@flow-state-dev/engine`: the request host's `askResume` → `waitResume` and `askSweeper` → `waitSweeper` (`RuntimeConfig.requestHost`).

  A wait parked before the upgrade resumes after it: a gate stored with the reason `"ask"` is still a wait gate (the public resume route still answers not-found for it), and a row stored with `ask` reads as `wait`. The run-once keys (`fsd.ask.*`), the gate id prefix (`ask:`) and a task notice's `asked` flag keep their spelling, so a replay across the upgrade finds what it recorded.

### Patch Changes

- 10ded49: A stopped or timed-out ask whose own cancel of its task fails no longer leaves the task open for good. The failed cancel is recorded on the row as `Task.cancelOwed`, and the next `resumeOwedAsks` touch cancels the row. Whatever ends the row clears the marker, and that ending owes the stopped turn no resume. Both built-in backings implement the new optional `TaskCollectionRef.markCancelOwed` (change kind `cancel_owed`), and `TaskFilter.cancelOwed` matches marked rows. A failed cancel no longer surfaces as a tool error on a timed-out ask: the call still answers `wait_timed_out` (FIX-1844).
- be1bddf: A worker can ask a colleague and carry on the same turn with the answer (FIX-1816). `addTask` takes `waitForResponse` and `timeoutMs` (five minutes by default, 30 seconds to an hour, refused outside that as `wait_timeout_out_of_range` and never clamped) on a turn whose host can hold an ask: durable execution and a running durability sweeper, which the request host now reports as `RequestHost.hasAskSweeper` (a router answers for its own sweeper, which `DurabilitySweeper.timesOutAsks()` reports). Anywhere else `addTask` is unchanged and adds no tool. An asked task's ending resumes the turn that waits on it, through the same notice every ending sends, and wakes no new turn. The task notice module (`recordEnding`, `owedNotices`, `decideNotice` and the rest) moved from Workforce into `@flow-state-dev/orchestration/tasks`. `isTaskTurn(ctx)` is true on a turn that is itself working a task, and an ask there is refused as `wait_unavailable`. Orchestration's root exports `isTaskTurn`, `TASK_SESSION_TASK_KEY`, `resumeOwedAsks` and `taskToolsForTurn`; the rest of the ask mechanism (`addTaskAndWait`, which refuses a host that can't bound the ask, `canHoldAsk`, `askGateId` and the timeout bounds) is on `@flow-state-dev/orchestration/task-board`.
- 70cfac9: `cascadeSkipDependents` no longer labels a task `skipped`, or skips that task's dependents, when its cancel was declined because the task had already been settled by something else (FIX-985).
- 809cebd: `harnessManager` can read each run's board from its claim (FIX-1866). Give it `ledgers`, a resolver typed like `taskLedgers`'s, and the task's entry hands it the claim on its input as `claim: { collectionId, partition, incarnationId }`; every read and write is still fenced against the row at that ledger and partition. Runs are kept apart by board and partition (`runBoardSegment`). On such a board a refused run ends the task `errored` instead of `cancelled`, and a question parks the task on the board itself, with the answer reaching the next attempt's prompt. A completed run's output now carries `answer`, `branch`, `commits` and `judged`, and `isDone` reads the run's `answer`. An optional `judge` (a host block and a confidence floor) reads a run on such a board after `isDone` passes; `harnessDrainBudgetMs` takes `judge: true` to reserve its time. A fixed board runs as before.

  Orchestration's `fail` takes `noRetry: true` to end a task `errored` on this failure even when it has attempts left.

- d356f52: `listTasks` (the task tool and its `listTasks_<board>` action) now answers each task's `run` link, the run working it or the one that last did, so a task list can open it (FIX-1792).
- 311a6d5: `@flow-state-dev/orchestration/tasks` no longer reaches `node:module` or `node:url`, so a browser bundle can import it. Core adds two subpaths, `@flow-state-dev/core/blocks/handler` and `@flow-state-dev/core/blocks/sequencer`, that expose the block builders without the main entry's Node-only model resolver (FIX-1608).
- 69a9e29: `awaitReview` with no reason now clears the task's `feedback` instead of leaving the previous note in place, so a failed attempt's error text no longer reads as the reason a parked task is waiting (FIX-1505).
- 12bf045: A `defineTaskCollection` with `partitionBy` keeps its rows in the user's own cell even on a flow that isolates its user state (`isolateUserState`), so a task entry on another flow finds the row it was handed (FIX-1794).
- dd2563b: Task tools gain `readTask`, which returns one task whole: its goal, input, status, and what it came back with (its result, its error, or the question it is parked on). `listTasks` still lists without results. `taskToolActions` exposes it as `readTask_<board>`. A conversation board now shows a browser the question a task parked on a question waits on (`feedback`, with `parkedOnQuestion`). Shift Manager's shift summary lists tasks parked on a question for the user under Needs you, and its DevTeam chief of staff answers from what a finished task found (FIX-1972).
- d994f51: `createSkillActivator` takes an optional `evaluator` for tier 3, with `skillEvaluator(model)` and `skillQuestions` to build one (FIX-1559). The evaluator picks one skill or none from the same catalog the classifier would see, and its pick is final: no confidence threshold, no fallback to the classifier. Without it, activation is unchanged.
- afb512f: `skillEvaluator(model, { recentMessages: N })` lets the skill activator's evaluator see the last N turns before the message, so follow-ups like "yes, do that" activate the skill an earlier offer was about (FIX-1595).
- 09e3705: Skill names that are Windows device names (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`) are now refused, so a skill with one of those names stops loading until it is renamed (FIX-1456).
- eb66ddd: A worker on a task can split it into pieces for any worker on the user's roster that takes tasks, not only its own delegates; an unassigned piece still goes to its only delegate, and the chain limits still apply. A split task now completes with `{ answer, pieces }`: the answer of the turn the last piece's ending woke, with the pieces' outputs under it. It settles only once every piece has ended and its ending has been heard. When it settles with no such turn (a settle replayed after a restart), the output is `{ pieces }` alone, as before. `taskToolsForTurn` and `dispatchAndWait` take a new `taskTurnInstead` option, the layer's own way to wait, which the `wait_unavailable` refusal and the `dispatchTask` description name on a task turn; Workforce's conversation boards set it: file the task without `wait` and end the turn, and its ending wakes the task (FIX-1997).
- cd180d7: Stopping a paused request now ends it `aborted` and records its gate with the new `stopped` suspension status, a turn paused on an ask cancels the asked task instead of waiting for it, and a durable host now runs the durability sweeper even without `durabilityRetention`, so a paused request past its `expiresAt` expires and an ask past its deadline times out, while pruning still waits for a retention policy (FIX-1816).
- 9cd314d: `defineTaskCollection` accepts `partitionBy` on a `user`-scoped collection, keeping one set of rows per partition so each conversation's board reads, claims, waits on and settles only its own tasks while a board's hand-off carries the partition (core's task dispatch envelope gains an optional `partition`) to a task entry on another flow, whose gate and `taskLedgers` resolver read the row there (FIX-1794).
- 7035b4c: `addTask` and `dispatchTask` take an optional `title`, a short label for the task apart from its `goal`, and `listTasks` answers it when a task has one (FIX-1974). A task filed without a title is still labelled by its goal.
- 912ae98: A durable task board's task tools can now run as flow actions (`taskToolActions(board)`, or `boardActions: true` in a `MAILBOX.md`), and the DevTool's Tasks tab opens a task's full record and runs those actions from the row, showing a refusal as a refusal (FIX-1629).
- 78178a9: A partitioned ledger now takes the bare user id from the user scope, not the user record's storage key, when the session names no user (FIX-1790).
- 98b90a6: Workers can be data: `createWorkerInstallation` gives a worker flow a create check that names the session's worker once, `resolveWorker` loads it each turn, `createWorkerHireBlocks` writes the user's roster, and `createWorkforceClient` finds or starts a session with a worker. `writeShared` now names the worker the turn loaded, not a `seatId` setting. `createSkillsLibrary` takes `partitionBy` to keep one catalog per party on one flow copy (FIX-1788).
- Updated dependencies [cd6f7fb]
- Updated dependencies [0b57bc9]
- Updated dependencies [be1bddf]
- Updated dependencies [58ffc93]
- Updated dependencies [397cfa7]
- Updated dependencies [53b50f0]
- Updated dependencies [456fe85]
- Updated dependencies [62133c4]
- Updated dependencies [9d02ac6]
- Updated dependencies [8dc242e]
- Updated dependencies [89af7db]
- Updated dependencies [7d4158f]
- Updated dependencies [5492a77]
- Updated dependencies [6819520]
- Updated dependencies [211679a]
- Updated dependencies [dd80e01]
- Updated dependencies [5181ddb]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [e71ea1a]
- Updated dependencies [49d6397]
- Updated dependencies [a55d07f]
- Updated dependencies [7db4d13]
- Updated dependencies [9e3b823]
- Updated dependencies [df3de3b]
- Updated dependencies [423a405]
- Updated dependencies [7da156e]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [f9995b1]
- Updated dependencies [a7f1c41]
- Updated dependencies [80f6e25]
- Updated dependencies [b808784]
- Updated dependencies [028af6f]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [db7df1c]
- Updated dependencies [968faa6]
- Updated dependencies [653549d]
- Updated dependencies [839e915]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
- Updated dependencies [9510a03]
- Updated dependencies [1cfd80c]
- Updated dependencies [385d01e]
- Updated dependencies [d1a4cab]
- Updated dependencies [3311cc2]
- Updated dependencies [7c9e932]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [97894aa]
- Updated dependencies [334c1e3]
- Updated dependencies [9ed6b29]
- Updated dependencies [a021cd1]
- Updated dependencies [cd180d7]
- Updated dependencies [68b8957]
- Updated dependencies [e11764a]
- Updated dependencies [872a088]
- Updated dependencies [9cd314d]
- Updated dependencies [30aa133]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [96ff077]
- Updated dependencies [84cc226]
  - @flow-state-dev/core@0.3.0

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

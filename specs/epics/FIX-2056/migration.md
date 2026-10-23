# FIX-2056 · Migration lines

[Spec](SPEC.md) · [Decisions](DECISIONS.md)

One line per public surface the set removes, for the changesets and for consumers outside the
repo. Each is removed outright in its owner's PR, with no deprecation release, in a minor bump
([(e)](DECISIONS.md#e)); that PR's changeset carries the row's line and says teams outside the
repo rewrite at upgrade. Each tool's `<tool>_tasks` action follows its tool. Shift Manager's
`errorCapture` is not here: it is kept ([(f)](DECISIONS.md#f)).

| Removed | Use instead | Owner |
|---|---|---|
| `addTask` | `createTask({ …, held: true })` to file without starting; `updateTask({ id, status: "pending" })` releases it | FIX-2081 |
| `dispatchTask` | `createTask`; `{ taskId }` is `updateTask({ id, status: "pending" })`; `{ taskId, assignee }` is `updateTask({ id, assignee, status: "pending" })`; wait with `getTask({ id, wait: true })`, and `timeoutMs` is `getTask`'s `deadline`, which cancels nothing: at the deadline the task runs on and `getTask` returns it as it stands; a coordinator files a routed task: `createTask` with `target` and the routing settings | FIX-2082 removes the wait form, FIX-2083 the post form; FIX-2083, the later, removes the tool ([FIX-2081 D1](../../issues/FIX-2081/DECISIONS.md#d1)) |
| `dispatchAndWait`, its `DispatchAndWaitOptions` and `DispatchAndWaitResult` types, `DispatchRef`, `DispatchTarget`, and `DEFAULT_WAIT_TIMEOUT_MS`, `MIN_WAIT_TIMEOUT_MS`, `MAX_WAIT_TIMEOUT_MS` | `getTask({ id, wait: true })` on a task filed with `createTask`; in code, `waitOnTask(ctx, board, id, { key })`. A wait's deadline bounds are the host's `waitDeadlines` (default 5 minutes, 1 s to 24 h) | FIX-2082 |
| `TaskInit.wait`, `TaskDispatchOptions.wait`, and `taskToolsForTurn`'s `taskTurnInstead` | Nothing: a filing doesn't wait, and a task's request may wait with `getTask` like any other | FIX-2082 |
| `parkOnWait`'s `timeoutMs`, the errors it threw (`WaitEndedError`, `WaitStoppedError`) | `parkOnWait({ …, deadline })`, an epoch-ms deadline kept as a wake; it returns the `WaitOutcome` (`answered`, an error, `deadline`, or `stopped`) instead of throwing | FIX-2082 |
| `readTask({ taskId })` | `getTask({ id })` | FIX-2081 |
| `updateTask`'s `taskId`, `patch` (FIX-2080's interim `patch.status` included), `addLabel`, `removeLabel` | Flat input: `updateTask({ id, priority, labels, status, … })`; `labels` replaces the list | FIX-2081 |
| `addDelegate`, `removeDelegate`, `setFallback` on every coordinator | `editsOwnDelegates: true` in the coordinator's `WORKER.md`; otherwise the user edits the list | FIX-2081 |
| A task session's reach to the whole roster | `delegates: [ … ]`, or `delegates: all` | FIX-2081 |
| `assignTask` | `assignee` at filing, or `updateTask({ assignee })` before it starts | FIX-2081 |
| `cancelTask` | `updateTask({ status: "cancelled" })` | FIX-2081 |
| `completeTask`, `failTask` | Return or throw: the claim gate records the ending | FIX-2081 |
| `blockTask` | `updateTask({ id, status: "held" })` and `"pending"` before it starts; `waitForUser` after | FIX-2080 |
| `TaskCollection.block`, `unblock` | `TaskCollection.hold`, `release` | FIX-2080 |
| The `"blocked"` task status, and `"blocked"` in `listTasks`' status filter | `"held"` | FIX-2080 |
| `Task.undispatched`, `TaskInit.undispatched` | `held` | FIX-2080 |
| Change kinds `blocked`, `unblocked` | `held`, `released` | FIX-2080 |
| Change kind `dispatched` | `released`: every release of a held row emits it | FIX-2080 |
| The board's `counts.blocked` | `counts.held` | FIX-2080 |
| `createCascadeSkipDependents` | Nothing: every board cancels a failed or cancelled row's dependents | FIX-2080 |
| `TaskCollection.reopen` | A follow-up: `createTask({ goal, followUpOf: id })` | FIX-2086 |
| `Task.reopened` and the worker input's `reopened` | A follow-up, which carries `followUpOf` | FIX-2086 |
| The `reopened` change kind | Nothing: a follow-up is a new task, with its own changes | FIX-2086 |
| `Task.parkedForTurn` and `awaitReview`'s `forTurn` | `updateTask({ id, message })`: a steer parks nothing | FIX-2086 |
| A board's `reopenIn` (harness manager) | A follow-up: `createTask({ followUpOf })` | FIX-2086 |
| `harnessMessageDoor`, `messageDoorInputSchema`, `messageDoorOutputSchema`, a manager's `messageDoor` | `updateTask({ id, message })` on the run's task; a line in an open task's session is a steer through the coding flow's own door (`message`, `respond` after FIX-2084) | FIX-2086 |
| `TurnRefused`, `TurnRefusalReason`, and the types `HarnessMessageDoorOptions`, `MessageDoorAction`, `MessageDoorBoard`, `MessageDoorOptions`, `MessageDoorOutput`, `DoorRunIdentity` | `updateTask`'s refusal, which names the rule | FIX-2086 |
| `DELEGATED_POST_ENTRY`, `delegatedPostEntry`, `delegatedPostOnFinished`, `delegatedPostSchema`, `DelegatedPost` | A routed task through `WORKER_TASK_ENTRY`: declare `work` with `workerTaskEntry`; the turn still gets `{ message }` | FIX-2083 |
| `delegatedPostHistory` | `routedTaskHistory`, as the `work` turn's generator `history`: the routed task's recent lines, just before the message | FIX-2083 |
| `DispatchPostForm`, `dispatchTask`'s `post: true` | `createTask` with the routing settings (`session: "ongoing"`, `resultTo: "conversation"`, `target` for a workstream's record) on a turn routing a message | FIX-2083 |
| `taskLedgers({ taskTurn })` | Nothing: a routed turn is a task turn | FIX-2083 |
| `defineCoordinatorFlow`'s `delegateFlows`; `defineSessionBoard`'s `postFlows` and `posts`; `posts` and `both` in `listDelegates`' takes | Nothing: a delegate is a worker whose flow takes tasks, checked by its roles at hire | FIX-2083 |
| `TaskCollectionRef.dispatch`, `TaskDispatchOptions`, `Task.dispatchCall`, the `already-dispatched` decline | `createTask`, and `updateTask({ id, status: "pending" })` to release a held row | FIX-2083, with `dispatchTask` (the later of FIX-2082 and FIX-2083) |
| `createScheduledTransportAdapter`'s `idempotencyWindowMs` | Nothing: the dispatch endpoint fires each scheduled time at most once, recorded in the host's store | FIX-2085 |
| `createScheduledTransportAdapter`'s `idempotencyOptions` (the cache's test seam) | Nothing: it goes with the cache | FIX-2085 |
| The dispatch request body's `idempotencyKey` | Nothing: the scheduled time is the key. A body that sends one is refused with `400` | FIX-2085 |
| A fixed `nominalFireTime` in a scheduler's body | Remove the body: a fire with none counts against the latest scheduled time already due. A fixed time fires once, then answers `200 duplicate`, with `reason: "stale"` and a server warning once it is more than one period old | FIX-2085 |
| A cron of more than five fields (a sixth is seconds) | Five fields. One with six is refused at registration, at dispatch (`400 invalid_schedule`) and by `saveSchedule` | FIX-2085 |
| A schedule `timezone` that isn't an IANA zone | A known IANA zone, or none for UTC. An unknown one is refused at registration and at dispatch (`400 invalid_schedule`) | FIX-2085 |
| A `ScheduleResolutionContext` built by hand (a test calling a resolver directly) | Pass `userStorageKey(userId, orgId)`, which the dispatch endpoint supplies; the resource-collection resolver reads a user's row through it | FIX-2085 |
| `settleSplitTask` | Nothing: a split task stays running, and the claim gate settles it when a request for it ends with no piece open | FIX-2077 |
| A split task's `{ answer, pieces }` output | The latest `reportProgress` checkpoint, else the worker's last answer; a piece's result from its own row, through FIX-2081's `listTasks({ filedByTask })` | FIX-2077 |
| A failed piece failing its task, and the retry marker (`retryOf`) | The worker's turn decides: throw to fail the task, or file a new piece. A turn that ignores a failed piece completes the task | FIX-2077 |
| Every worker flow's door: `run` (agent, coordinator, Error Reporter), Shift Manager's EM and coder `message`, and any outside the repo under another name | `respond`; a worker flow whose message action has another name is refused at hire, naming the action to rename | FIX-2084 |
| A manager's `runTaskBoard` entry | `dispatch` | FIX-2084 |
| A worker flow with a role's entries and no declared role | Declare it: `workerFlow(build, { roles })` or `{ flow, roles }` in `workerFlows` | FIX-2084 |
| `resumeOwedWaits` | Nothing: the board's due-time wake pays an owed resume and a cancel owed | FIX-2078 |
| `dispatchedTaskPredicate` | The board's declared `mode` (`board.mode`): a delegation board's drain waits on no row, a plan board's on every row. A delegation board excuses every row, so a board mixing inline and dispatching assignees isn't supported: split it into a plan board and a delegation board | FIX-2076 |

Behaviour that changes without a removed name, carried by the owner's changeset the same way.
Behaviour lines live here, not in the table above.

| Changed | Now | Owner |
|---|---|---|
| `updateTask` on a started or finished task | Refused, naming the field and the state; a started task takes only a cancel, and a message steer once FIX-2086 lands | FIX-2081 |
| Reassigning a running task | Refused: cancel it and file it again | FIX-2081 |
| A follow-up into a busy session being refused | It waits, then starts in that session when the open task ends | FIX-2080 |
| A dependency on another board, waiting for good | Refused at filing: cross boards with a wait or a held task | FIX-2080 |
| Plan-and-execute and supervisor cascading only a failed step | A cancelled step's dependents are cancelled too, with the same `skipped` label | FIX-2080 |
| A task a worker files naming itself (a piece for itself, in a task session of its own, its task parked on it) | A step on the session's plan ledger, worked by the same request; the request answers once, a string, instead of `{ answer, pieces }` (FIX-2077's row covers pieces for others) | FIX-2076 |
| A board with a dispatcher assignee | Declares `mode: "delegation"`, and every assignee on it dispatches; `taskBoard()` refuses it otherwise, naming the fix | FIX-2076 |
| `updateTask({ message })` on an open task | Steers it: uses no attempt and never cancels | FIX-2086 |
| A line typed in a finished task's session | Talk: the task doesn't change | FIX-2086 |
| A scheduled fire for a time already fired, or earlier than one that has | Answered `200` with status `duplicate`, and nothing runs: a late retry of a missed time, or one delivered after the next time fired, never runs ([FIX-2085 D2](../../issues/FIX-2085/DECISIONS.md#d2)) | FIX-2085 |
| A board that hands rows out (a `dispatcher` assignee, or a delegation board) on a flow with no `onTaskSettled` internal action | Refused when the flow is built, naming the entry: declare `internal: { actions: { onTaskSettled: taskSettledEntry({ block }) } }`, so every ending reaches the session that filed it | FIX-2078 |
| A request an earlier host left unfinished under a worker's `run` or `message`, and a request or wake under `runTaskBoard` | Rewritten to `respond` and `dispatch` by `upgradeWorkerEntryNames(stores, flows, { incarnationOf })` at host start, before the router, on registered worker flows only; Shift Manager and Kitchen Sink call it. A BullMQ job queued under an old name is not: drain the queues before deploying | FIX-2084 |
| A worker flow missing an entry its declared roles need, or carrying a role factory's piece without the role | Refused at every hire path (boot, reload, runtime hire), naming the flow, the role, the entry and the fix | FIX-2084 |
| An `onTaskSettled` handler, and a Workforce conversation, on a cancel | Receive `cancelled` endings: a cancel the filer didn't make itself through its own task tool is heard once, and a failure or cancel notice names the dependents it cancelled | FIX-2078 |

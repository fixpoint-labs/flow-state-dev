# @flow-state-dev/workforce

## 0.4.1

### Patch Changes

- 8be6d45: A failed or cancelled task can be retried as the same task (FIX-2383). `TaskCollectionRef.retry(id)` (optional, on both built-in backings) puts an `errored` or `cancelled` row back to `pending`, keeping its id, steers, output and spend, with the grant counted in `retryLedger`; it publishes a `retry_requested` change and declines `disallowed`, `settling`, `dependency-ended` or `retry-budget`. `taskToolActions` adds `retryTask_<suffix>`, an action only: a model's task tools are unchanged. Workforce's conversation board starts a retried row at once, as it does a released one.
- Updated dependencies [824ce87]
- Updated dependencies [8be6d45]
- Updated dependencies [cc0ab62]
- Updated dependencies [0554e0b]
- Updated dependencies [387bee2]
- Updated dependencies [3aced5b]
- Updated dependencies [cc0ab62]
  - @flow-state-dev/core@0.4.0
  - @flow-state-dev/orchestration@0.5.0
  - @flow-state-dev/workspace@0.3.0
  - @flow-state-dev/client@0.3.1
  - @flow-state-dev/scheduled@0.3.1
  - @flow-state-dev/tools@0.2.1

## 0.4.0

### Minor Changes

- f45d0b0: A worker flow can say its tasks need a project: `workerFlow(build, { needsProject: true })`, or `needsProject: true` on a `workerFlows` entry. A task for one of its workers filed with no project to work in (no workstream, no project on the conversation, none named in `input.project`) is refused at filing with `no_project`, before any row or run exists, so an app can ask for a project first. `projectWorkspace()`'s `no-project` refusal stays as the backstop, and its message now says to set the conversation's project (`listProjects`, then `setWorkProject`) instead of naming one in `input.project` (FIX-2333).
- 92b2b70: A conversation longer than its history window can keep what it said before the window (FIX-1613). `utility.historySummary({ summarize })` returns a `capability` for the generator that answers and a `fold` step to run before it: the fold writes the turns about to leave the window into a running summary, the capability hands that summary to the model and starts the generator's history after it. A capability preset may now declare `history` (a query added to that generator's history reads; generators only). The engine records `historyStart` on a request when earlier turns are out of view, exposes `ctx.session.window`, `ctx.session.items.turns()` and `history({ afterRequestId })`, and the client's request summary carries `historyStart`. Workforce's `defineAgentWorkerFlow` takes `beforeAnswer`, a block run before the worker answers.
- 11b0ec3: A task on a conversation board that asks a question midway now tells the worker that filed it: one message per question, from the task's worker, landing in the conversation that filed the task (FIX-2241). It names the task and the question's id, so the filer can answer with `updateTask({ id, answers, message })` without reading the task first; a task routed to a workstream says the user answers it from their Inbox instead. The message costs no budget, and a replayed turn sends no second copy. The Inbox item stays the one stop. `sendMessage` takes `exempt: true` for a message your server sends on its own, which spends no budget; never pass it for a model's send.
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

- 2fab18b: Workers hear a message through the `onMessageReceived` entry, which `hireWorkforce` requires on every worker flow on an installation (FIX-2238). A received message lands as a history line plus its own client item (`workforce:received`, with `from`, `id` and `inReplyTo`). A worker answers with `sendMessage({ inReplyTo })`; its plain text reaches no one. An answer lands in the session the original was sent from, and a message to the worker that filed the sender's task lands in the filing conversation. One budget covers a typed message: 6 messages in all, 3 per request. A task filed held starts a fresh budget when released. Coordinators can be messaged whatever their routing. A worker that hears only in its tasks' sessions (`hears: "task-sessions"`) is refused by name with `task_sessions_only`. Build the entry with `messageReceivedEntry({ installation, flowKind, turn?, hears? })` (or spread the session kit's `entries`), and add `workerMessagesResources` to a flow without the kit.
- 9c0c0b1: The built-in `agent` worker flow now opens every roster worker's system prompt with who it is: its name (its `WORKER.md` `name:`, else its id's worker segment), its team, its role (its `description`), the teammates it can message by id (a teammate that is also its delegate marked as one that takes its tasks, with a line that work for a delegate goes as a task), and any task-only workers to file a task with. One rule on using tools follows. The team's, the worker's own and its packages' instructions come after, unchanged. Off an installation the layer is absent. `RosterWorker` gains `name` and `teamName`; `workerRecipients`, `rosterDisplayName` and `rosterTeamName` are exported from the package root, and `sendMessage`'s recipient list reads the same `workerRecipients` (FIX-2334).
- 71ab534: A worker can read the project its session works in without a coding run (FIX-2285). `projectSourceCapability({ workspace })` has one preset, `read`. A worker names it in its file (`capabilities: { projectSource: [read] }`) to get `globProjectSource`, `readProjectSource` and `grepProjectSource`. Each tool finds the project through the host's run source (`projectWorkspace()`) and returns a refusal as its result, `{ kind: "refused", reason, message }`. Pass the host the app's coding runs use. A host with no `readSource` is refused when the capability is built.

  `projectWorkspace()` now refuses a run in a workstream's session, or in a task filed from one, with `not-a-member` when the workstream's owner is no longer one of the project's members. The project path already did this.

- ad0babd: A person's running turn can hear the tasks that finished while the worker answered (FIX-2159). `defineAgentWorkerFlow({ answerAgain: true })` says each such result in that same request, under the delegate's name, and the worker answers again with it; pass a block instead to change what the worker is told (`finishedTasksAnswerAgain({ message })`, or your own sequencer around `takeFinishedTasks`). The worker's answer after its plan and these share one cap, `MAX_ANSWERS_AGAIN` (3 per request). Orchestration exports `takeOwedNotice`, which takes an owed notice in the running request's name through the same take record `onTaskSettled` uses.
- cfef958: Any worker files tasks for its delegates that take one, not only a coordinator: `delegates:` joins the worker contract (`workerConfigSchema()`), so a worker flow that hand-declares the contract must accept it too, the built-in `agent` flow carries the task tools, the `addTask_tasks`-style actions and the four delegate actions, an app's own worker flow carries them with `defineSessionBoard({ installation, flowKind })`, and a worker none of whose delegates takes a task, a coordinator included, gets no task tools and its actions answer `no_delegation_board` (FIX-1802).
- b9de77e: A `best-fit` coordinator with a `description:` is now one of its own choices, so a post the evaluator picks it for runs the coordinator's own turn; a new `minConfidence:` key (0 to 1, `best-fit` only) sends a delegate pick below it, or one with no reported confidence, to the fallback or the coordinator's turn; the routing record's new `fit` field says why best fit handed a post on; and the coordinator's own turn now reads each delegate's answer under that delegate's name, with each post its routing handed on marked as handled (FIX-1833).
- f97b0ed: The task board's last old words are gone (FIX-2246), with no alias and no old spelling read. Stores written by an earlier version are not upgraded: a request left in flight across the upgrade may not resume.

  - `@flow-state-dev/workforce`: a coordinator's routing record and a routed task's brief name the message by `messageRequestId`.
  - `@flow-state-dev/orchestration`: a task notice's waited-on flag is `waitedOn`, the word `listTasks` uses. A wait gate's id starts `wait:`. The board's dispatch blocks are named `<board>-dispatch-<assignee>` and `<board>-dispatch-fallback`.
  - `@flow-state-dev/core`: `isWaitGate` is true only for a gate with the reason `"wait"`.
  - `@flow-state-dev/engine`: a wait gate the waiting turn's own conversation resolves records `wait:<session>` as its resolver.

- d5ce1e0: A worker can answer a question from another of the user's conversations without waking it (FIX-2173).

  - `requestHost.sessions.history(sessionId, { limit })` reads a session's finished turns, oldest first, with `asOf` and `running`. Like `sessions.read`, it answers only for the caller's own sessions; anything else reads as `undefined`.
  - `utility.consultSessionHistoryTool()` (core) reads that history under a hard token budget (default 24,000) and answers on one tool-less generator, `intent/utility` by default. It returns a reading as of a time, and writes nothing to the other session.
  - `consultSessionsCapability(installation)` (workforce) puts it on a worker's turns as `consultSessionHistory`, with `of` naming a worker, `{ task }` or `{ session }`. Its `consult` preset is off until a worker's `WORKER.md` names `consultSessions: [consult]`. Set `models: { default, intents: { utility: [...] } }` in `createFlowState` to pick the cheaper model.

- 2e1e079: A user's own conversation with a worker can work in a project (FIX-2161). `createWorkforceClient(...).setWorkProject(worker, { visibility, id }, { sessionId? })` sets it on the user's default conversation with the worker, or on another session of theirs with it, such as a new session just created. The conversation's coding runs, and the tasks it files from then on, work in that project through `projectWorkspace()`. A later call replaces the project; tasks already filed keep the one they were filed in.

  The call is refused, storing nothing, for a project the user isn't a member of (a private one: isn't theirs), and on the project coordinator's, a task's, a delegate's or a workstream lead's session. It runs the `setWorkProject` action (`SET_WORK_PROJECT_ACTION`), which the agent, coordinator and Error Reporter flows declare; an app's own worker flow declares `setWorkProjectAction` under that name. The project is kept in the server-owned session field `workProjectId` (`WORK_PROJECT_STATE_KEY`), which a session create can't seed.

- 12bf045: A coordinator conversation keeps its own task board, worked through Orchestration's task tools on the coordinator's turn and as `addTask_tasks`-style actions, for the conversation's delegates that take tasks; each task runs in a new task session of the user's, found with `findWorkerSession({ worker, taskId, filingSessionId })`, and the conversation hears once how it ended (FIX-1794).
- 5492a77: A board can start work on another worker now: on a board that dispatches (a Workforce conversation's, or one built with `{ dispatches: true }`), a task is handed over as soon as it is filed, and one filed held waits until it is released. Filing a task never waits: it refuses `waitForResponse` and `timeoutMs` by name. The wait names are renamed with no alias (`canHoldAsk` → `canHoldWait`, and the rest of the `Ask` names to `Wait`) (FIX-1875).
- 4f2e13e: Add the Error Reporter (FIX-1983): `createErrorReporter`, `defineErrorReporterFlow` and `defineErrorReporterIntakeFlow`. A request that settles failed, a task that ends errored on a conversation's board, or a problem a person describes to the reporter becomes one report per fingerprint, capped per window, drafted by a harness from a redacted dossier, previewed to the operator as an ordinary form, and filed through the tracker project's MCP servers once they answer.
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

- a600325: `fsdev gen` no longer depends on `@flow-state-dev/workforce`. It runs the generator a dependency of the app exports on a `./fsdev-gen` subpath (typed as `FsdevGenerator`), and `@flow-state-dev/workforce` now exports its generator there, so a Workforce app runs `fsdev gen` as before. `GenResult` reports `generator`, `entries`, `paths` and `summary` in place of the Workforce discovery lists, and `--root` defaults to the generator's own folder (FIX-1771).
- fe5df7d: A request waits on a task it filed with `getTask({ id, wait: true, deadline? })`, now or in a later request, and gets the task back once it ends or as it stands at the deadline (FIX-2082). The deadline cancels nothing: the task runs on, and an ending that lands while the request still runs reaches it on its next `getTask`; one it never reads goes to `onTaskSettled`, once. A task's own request may wait too, and waits nest up to five deep, counted live. A wait's deadline is a wake on the waiting session, so a restart keeps it. Use `waitOnTask(ctx, board, id, { key })` from `@flow-state-dev/orchestration/task-board` when the wait is in application code rather than a tool.

  - `dispatcher({ wait: true })` waits for the request it starts and outputs `{ status: "completed" | "failed" | "running", output?, error?, requestId }`.
  - On a plan board a row filed `session: "new"` runs in a session of its own through `taskBoard({ newSession })`, and the drain waits on it. A plan board may hold dispatchers, whose rows it waits on; a plan board's dispatcher with `wait: false`, and a delegation board's with `wait: true`, are refused. In Workforce, a worker's step filed `session: "new"` runs in a new session of the same worker.
  - `canHoldWait(ctx)`, `dispatchWaitResultSchema` and `DispatchWaitResult` are exported from `@flow-state-dev/core`; `RequestHost.waits.ended(requestIds)` says whether a request has stopped running its work, and `checkWait` (orchestration) runs a wait's checks alone.
  - Hosts set a wait's deadline bounds with `waitDeadlines: { defaultMs, minMs, maxMs }` (5 minutes, 1 s, 24 h by default). A wait needs a store that keeps wakes. `parkOnWait` takes a `deadline` (epoch ms) and returns the `WaitOutcome`.

- 7da156e: Organization ids are now validated as well-formed, non-blank Unicode everywhere (resolver, `runAction`, dispatch, BullMQ jobs, schedules, `fsdev run --org`) and seat addresses escape any such id, while route segments are decoded exactly once on every host (`parseFlowRoute` now takes decoded segments, built from a raw URL by the new `decodePathSegments`), so escaped seat ids resolve on Next and Vercel and stored rows or queued jobs with a lone-surrogate org id are now refused (FIX-1757).
- 98fa8da: `hiredSeatOwnerPin` now refuses a missing or empty organization id with the same error `registerHiredSeat` throws, instead of returning a pin with an empty `orgId` (FIX-1572).
- a3bfbc2: The worker inventory collection (`defineWorkerInventoryCollection`) declares a browser read (FIX-1502). A session on any flow that installs it can list its rows through the collection-state route, for that session's own organization only, with the row's named fields and nothing else. Every member of an organization can list its registered workers from the browser.
- 3cbab3a: `sendMessage` takes `{ task: id }`, which lands in the session working that task, and `{ session: id }`, which lands in one of the user's own conversations; both are checked before anything is written, and a task filed before this release can't be found by id (FIX-2160).
- ffeee8d: Workers send messages with `sendMessage({ to, text, inReplyTo?, replyRequested?, wait?, deadline? })` (FIX-2318, FIX-2238, FIX-2310). A send that asks for a reply (`replyRequested: true`) goes on; the one answer comes back as a message. A send that waits (`wait: true`) asks the same way and waits in this turn: an answer before the deadline is the tool's result, `{ status: "answered", sent, reply, noAnswer? }`, and does not also land as a message; at the deadline the tool answers `{ status: "running", sent, recipient? }` and the answer arrives later as a message. The result key is `sent`. A waited send to a worker that runs no turn on messages answers `{ status: "answered", noAnswer: true }` when the sender cannot tell up front, or is refused `no_reply` when it can. An answer whose sender still waits cannot itself ask for a reply (`reply_to_waiting`). `to` and `text` are required.

  Shift Manager draws a reply request in Messages as _reply · waiting_, _reply · waiting on the user_, _reply · answered_ or _reply · answered late_, and marks a received message that asks for a reply.

- 02019e2: Seats declared under `org/workers/<name>/` now load as org seats, with the folder name as their id, and `parseDeclaredSeatId` reads any declared seat's id back into its team (if any) and name (FIX-1719).
- 7d4c413: Resource collections can be declared owner-private with `ownerPrivate: { param }`, and `ownerSegment(userId)` builds the owner key segment. Key segments beginning `~` are reserved for owner-private collections in every app, and flow registration refuses a single resource whose key has one. `defineResourceCollection` and flow registration no longer refuse collection patterns on Workforce's account, and `@flow-state-dev/core` no longer exports `assertRosterCollectionIsNotDeep`. Workforce's private roster collection is now owner-private; its refusal messages name the owner-private collection instead of the roster (FIX-1549).
- edc3197: A coordinator's hand-off to each delegate is now one task on the conversation's board, and the board's claim decides that an answer lands once. (FIX-1872) Things for an app to change or expect:

  - A worker file whose `tools:` names `handOff` is refused at load. A coordinator hands a message on by filing a task (see the routed-tasks note in this release). `delegatedAnswerSchema` and `DelegatedAnswer` are removed.
  - A conversation saved with the old delivery ledger reads as if it had none and drops it at its next write. An answer still owed for a post delivered before the upgrade is dropped, and its round closes at its deadline, so a conversation with `rounds:` set can lose one round of answers once.

- 8ecb3e7: `defineWorkstreamBlocks()` adds `editWorkstreamTool`, a tool named `editWorkstream` for a project coordinator: it changes one of the caller's own workstreams by id (title, status, due date, objectives) in the project its conversation belongs to. Naming another project is refused (`other-project`), and an id the caller has no workstream under is refused (`no-such-workstream`). Marking one done takes its delegate off the coordinator in the same turn. `editWorkstreamInputSchema` is exported (FIX-1963).
- b2f2d4c: Each person talks to a project through their own project coordinator (`createWorkerInstallation({ projectCoordinator })`, then `ensureWorkerSession({ worker, projectId })`), whose delegates are their open workstreams there, kept in step by `openWorkstream` and `updateWorkstream`, with `parseWorkstreamEntry` on `@flow-state-dev/workforce/browser` reading an entry the way `readProject` does (FIX-1793).
- 58e92e1: A project can record its git remote (`repository`, set with `createProject` or the new `setRepository`) and keep members-only files in the new `project-files` collection, read with `readProjectFiles` (FIX-1762).
- 0471725: `projectWorkspace()` is a run source for a workspace host: a coding run on a project's workstream works in a branch of the project's repository with the project's files beside it, or on the project's files alone when it has no repository (FIX-1762). It refuses a run whose owner is not a member, or whose workstream no project holds. The block that asks it holds `projectWorkspaceCapability`.
- c2cb231: Projects can be private or shared, and each workstream in a project has one owner (FIX-1793).

  - `createProject` takes `visibility`: `"shared"` (the default) keeps the project in the organization, where everyone reads it; `"private"` keeps the project in the creator's own user scope, where nobody else lists or reads it and it shows only in the organization it was made in. A private project names no other members (`private-has-members`). The answer carries the project's `visibility`.
  - A project's address is its visibility and its id, `{ visibility, id }`. `setRepository` and `readProjectFiles` take `{ project: { visibility, id } }` in place of `projectId`. The private rows and files are `definePrivateProjectsCollection()` and `definePrivateProjectFilesCollection()`, at `projects/*` and `project-files/**` in user scope.
  - `defineWorkstreamBlocks({ installation, leadFlows })` adds `openWorkstream` and `updateWorkstream`. Opening one writes the caller's own entry at `workstreams/<project>/<~owner>/<workstream>` and starts the lead's workstream session, owned by the caller, on a lead from their roster. On a shared project only its members may open one. Everyone who reads the project reads every entry (title, lead, status, due date, objectives, latest report, `writtenBy`); only the owner can change theirs, whichever flow writes. A status is a short label in the owner's own words (at most `WORKSTREAM_STATUS_MAX_LENGTH` characters, `"on-track"` when opened); one label has a meaning, `"done"` (`DONE_STATUS`): a done workstream stays listed, is never stale and is never the next due date. `updateWorkstream` writes the caller's own entry, or the one its `owner` names, which the store refuses for anyone but that owner. `updateWorkstreamTool` lets a lead update the workstream its session leads.
  - A worker flow lets its workers lead a workstream by declaring `workstreamOpenedEntry()` under `internal.actions[WORKSTREAM_OPENED_ENTRY]`. The built-in `agent` flow declares it.
  - `findWorkerSession` and `ensureWorkerSession` take a `workstreamId` criterion: `{ project: { visibility, id }, id }`. They return the one session the caller's entry for that workstream names, and nothing while it names none; `ensureWorkerSession` never starts a workstream's session, since `openWorkstream` does. A worker session naming a workstream is created only for the caller's own entry, with the lead that entry names.
  - `readProject` returns a project's row, every workstream's entry and its progress, from two reads. `projectProgress(entries, now)` works progress out the same way anywhere: how many workstreams carry each status label present, objectives met of total, the next due date, and entries unchanged for `STALE_AFTER_MS` (seven days).
  - `projectWorkspace()` finds a run's project from the workstream its session leads, at the project's visibility, and refuses a run whose owner isn't the workstream's (`not-the-owner`).
  - `sharedResource(pattern, shape, options)` takes the rest of a collection's declaration, a user scope included, and `withWrittenBy(ctx, data)` stamps `writtenBy` for a writer that needs its own write.

- f292079: A task now settles when its turn ends: a message to its session no longer holds it open and isn't part of it (FIX-2103). While the task's turn is running, the message is answered after that turn, with no claim on the task, so it can't report progress and its error doesn't fail the attempt. Steer open work with `updateTask({ message })`.
- 16bb676: A worker no longer gets `runBoard` and a private board's task tools from a skill it holds, because skills can no longer declare `agents:`; a worker skill that still does is reported in `skillErrors` when the tree is read (FIX-1814).
- c4150e7: A person's message on a finished task reopens it: task collections gain `reopen(id)`, the harness manager's door reopens a finished run when its board names `reopenIn`, a worker's reply in a finished task's session on a Workforce conversation board reopens that task, and Shift Manager's task composer takes a message on a finished task (FIX-1764).
- d1a4cab: Workforce says worker and worker flow throughout: the `seat*` exports, configuration keys (`workerId`, `workerSkills`, `workerTools`, `workerPackages`) and stored names say worker, `KindRefusedHireError` is `WorkerFlowRefusedHireError`, `AGENT_KIND` is `AGENT_FLOW`, `fsdev gen` exports its worker flows as `workerFlows` (was `kinds`; run `fsdev gen` again), `discover:` takes `workers`, the loader's `SegmentLabel` `"Kind"` is `"Worker flow"`, and a best-fit coordinator's route question is answered under `worker` (was `member`), so a mocked evaluation model answers `{ worker: … }`; there are no aliases, and records saved under the old names are not read (FIX-1796).
- 2ab7ea2: A coordinator hands each message to a delegate by filing a routed task: an ordinary task on the conversation's board with `session: "ongoing"`, `resultTo: "conversation"` and one attempt, worked on the delegate flow's `work` entry (FIX-2083).

  - A delegate is a worker whose flow takes tasks. Declare `work` with `workerTaskEntry({ name, turn })`; the turn is still handed `{ message }`. `routedTaskHistory` is the `work` turn's generator `history` that shows the model the conversation's recent lines.
  - `listDelegates` says a delegate `takes` `tasks` or `nothing`. A worker on a flow that takes no task can't be added as a delegate.
  - A judgment coordinator hands a message on with `createTask` and the routing settings (`session: "ongoing"`, `resultTo: "conversation"`, and `target` for a workstream's record); the server attaches the message as written. On a turn routing a message, `createTask` refuses a `session` other than `"ongoing"` (`routed_session_ongoing`) and `held`, `deps` or `followUpOf` (`routed_task_starts_now`). `createTask` takes `target`, set at filing only; `updateTask` refuses `session`, `resultTo` and `target` (`filing_setting_fixed`). `getTask` shows a task's `session`, `resultTo` and `target`.
  - On a board that dispatches, `createTask` starts a task as soon as it is filed; release a held one with `updateTask({ id, status: "pending" })`, with its `assignee` in the same write if it needs one, and wait with `getTask({ id, wait: true })`. On a conversation's board, a task filed with no assignee where several delegates take tasks now waits unassigned instead of being refused `assignee_required`.
  - A routed turn is a task turn, and a `taskLedgers` resolver is handed the claimed task's id as its fourth argument.
  - A delegate that files work for a message answers once that work has ended, and a second message to a busy delegate waits until the first ends. A round's deadline is a wake on the coordinator's session where the host keeps wakes, so it survives a restart.
  - The coordinator's line when nobody takes a message reads `Nobody took this message: …`.

- b552b50: A dispatched task now settles once, when its work is over (FIX-2077): after its request, the background work that request started and the background work the flow's `onFinished` started have ended, with no task it filed still open or still owing its ending. Until then the row stays `in_progress`, and `Task.keptOpenBy` says what holds it (`"filed"`, `"suspended"` or `"steer"`). A row that waits has no lease, so a task that stops to ask a person or to wait on an event is no longer reclaimed and run again when its lease runs out. The output is the latest `reportProgress` checkpoint, else the last answer that counts; a message's answer never is.

  Orchestration adds `taskRequestAdmission`, `noteTaskAnswer` and `afterTaskCheck` for a request that works on a waiting task, and `endRules` on `createTaskGate` and `taskLedgers`. Core adds `onRequestEnded` (`@flow-state-dev/core/types`), a framework-facing hook the engine runs after a request's last drain, on every way it ends.

  In Workforce a split task stays running while its pieces are open, and its output is its worker's answer like any task's. Read a piece's result from its own row (`listTasks({ filedByTask })`, `getTask`). A failed piece no longer fails its task by itself: the turn its ending wakes decides, and only a turn that throws fails the attempt. A worker that ignores a failed piece completes its task anyway.

- 8ebab39: A worker given a task can split it: its task session files pieces for its own delegates, its task waits on them and completes from their outputs, or fails naming the pieces that failed for good. A chain of split tasks is at most five boards deep, and one top task has at most 100 tasks under it, finished ones included; `hireWorkforce(installation, { taskChainLimit })` sets an app's own limit. A filing past either is answered `total_task_cap_exceeded`. Cancelling a split task cancels its open pieces, down the chain. A worker flow's `work` entry now holds its session's reply line, so a piece's notice waits for the turn that filed it (FIX-1802).
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

- 6f5a697: A task's session stays open until the task is done and after: a follow-up filed with `createTask({ followUpOf })` runs in the same session (FIX-1817).
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

- f219769: `WORKER.md` and `TEAM.md` take an optional `name:`, a display name for people (FIX-1959). A team's name rides each of its workers as `teamName`. Both reach the worker inventory rows and the standard workers' roster entries as `name` and `teamName` (`null` when unset). `name` is read by the installation, never handed to a worker flow as a setting.
- fb99119: A worker session create now refuses a caller-set `filingSessionId`, and every worker flow built on `installation.session()` refuses `delegates`, `fallback`, `taskNotices` and `splitParent` by name instead of dropping them; `ensureWorkerSession` no longer creates a session for a `filingSessionId` (FIX-1855, FIX-1895).
- ae72c9d: `hireWorkforce` now takes your worker flows as `workerFlows` (renamed from `kinds`), checks each one against the worker contract before any worker runs, can keep a flow for declared workers, and ships `workerFlowProblems`, `sharedResource` and `writeShared` (FIX-1789).
- ecca6d0: A worker on the built-in `agent` kind with no `tools:` line can now call the tools of the capability presets its file picks under `capabilities:`, where before it got only their context. Write `tools: []` to keep the old reach; a worker that writes a `tools:` line is unchanged. For a worker with no line, the hired seat's `config.tools` is now absent rather than `[]`, and the worker is refused at startup if two presets it picks list different tools under one name (FIX-1459).
- 4cdc088: A worker plans its own work: a task its own turn files naming itself is a step, kept on the session's `plan` ledger and worked by the same request after the turn, one at a time, each a turn of the worker; then the worker answers once more, told how every step ended, and that answer is the request's result. On the built-in `agent` and `coordinator` flows a worker's turn gets the task tools for its steps whatever its delegates; an app's own worker flow wraps its turn in `defineSessionBoard(...).planned(turn)`. A step is filed only by the worker's own turn (an action naming the worker is refused), isn't waited on, completed, failed or blocked by a call, and doesn't trade places with a delegate's task through `assignTask`. Steps count toward the chain's 100 tasks under a top task and add no depth. The conversation board is a `mode: "delegation"` board (FIX-2076).

  Migration, at upgrade: a worker's task for itself used to open a task session of its own and park the filing task on it, which then completed with `{ answer, pieces }`. It is now a step in the same request, and the request answers once, as a string.

- d04f562: Workers can make, find and pick a project from their own turn, and an app can hire, change and fire the user's own workers through the workforce client (FIX-2309).

  - `projectTools(defineProjectBlocks())` returns `listProjects` (with `forCoding`, what to do with a coder's task that names no project), `createProject` and `setRepository` (each waits for the user's approval before it writes a repository), and `setBrief`, as tools for a worker flow's catalog. `setWorkProjectTool` is the `setWorkProject` action as a tool, so a worker can put its own conversation in the project it just created or picked.
  - `projectSourceTools(workspace)` is exported, so a flow whose workers write a `tools:` line can put the three project-source reads in its catalog.
  - `createWorkforceClient(fsd)` gains `hire`, `fork`, `edit` and `fire`, which run the roster flow's actions of the same names on the user's roster session.

- d2b080f: A worker flow now declares its roles where it is registered, `workerFlow(build, { roles })` or `{ flow, roles }` in `workerFlows`: `contributor` (takes tasks on `work`, from `workerTaskEntry`), `manager` (files tasks and runs its board on `dispatch`, with `onTaskSettled`, from `defineSessionBoard`) and `coordinator`. Every hire path refuses a declared role whose entries are missing, weren't built by its factory or refuse their input, and a role factory's piece on a flow that doesn't declare the role, naming the flow, the role, the entry and the fix; the built-in `agent` and `coordinator` declare their own. A flow that spreads `workerTaskEntry` or `defineSessionBoard`'s pieces without declaring the role is refused until it does. Every worker flow's door is now `respond`: the built-in `agent`'s, the coordinator's and the Error Reporter's `run`, and any worker flow's door under another name, are renamed, and a worker flow whose message action has another name is refused, naming the action to rename; apps that send to the inventory's `door` change nothing. A board's pass entry `runTaskBoard` is now `dispatch`. Neither old name is kept as an alias: call `upgradeWorkerEntryNames(runtime.stores, flows, { incarnationOf: resolveRequestIncarnation })` once at host start, with `hireWorkforce`'s copies, before `getRouter()`, so a request an earlier version left unfinished under `run` or `message` resumes as `respond`, and a request or wake under `runTaskBoard` as `dispatch`. Drain BullMQ queues (or let them empty) before deploying this version: a job queued under an old action name fails. `workerFlowProblems` takes the roles as a third argument. Teams outside the repo rename their doors and declare their roles at upgrade (FIX-2084).
- 9d636c0: A coordinator worker hands each post to delegates from its user's own roster: `defineCoordinatorFlow` routes by judgment or best fit, each conversation keeps its own delegates (changed with `addDelegate`, `removeDelegate` and `setFallback`, read with `listDelegates`), and a flow whose `work` entry is built with `workerTaskEntry` can have its workers as delegates; the built-in `agent` flow does. A coordinator's judgment is the agent's own turn, built from the `agent` options you give `defineCoordinatorFlow`, so its workers' `model`, `tools` and `skills` read as an `agent` worker's do. `createWorkerInstallation` now refuses a standard worker whose `delegates:` names a worker that isn't standard. An app finds the session a delegate was given for a conversation with `findWorkerSession({ worker, filingSessionId })`, using the `filingSessionId` that `listDelegates` returns; a lookup naming only `{ worker }` never returns one. `COORDINATOR_KIND`, `COORDINATOR_ROUTE` and `COORDINATOR_JUDGMENT` are on the `./browser` entry (FIX-1791).
- e3c1927: A coordinator can route by `round-robin` (the next delegate in list order) and `everyone` (each delegate that can be reached), and `rounds:` from 1 to 3 is now accepted: a delegate's answer goes back out that many times. Under `best-fit` and `round-robin` each answer is routed again as it lands, never to its own author; under `everyone` each delegate gets the other delegates' answers when the round closes; under `judgment` the coordinator's turn runs once per closed round, and its hand-offs go out in the next round. A round closes when each delegate in it has answered or failed, or at its deadline, which `defineCoordinatorFlow({ roundDeadlineMs })` sets (five minutes by default). The routing record's `by` adds `round-robin` and `everyone`. A round whose delegate says nothing closes on the conversation's next wake after its deadline. A conversation keeps at most 50 rounds open; a message that would open one more is delivered without a round, and its routing record's new optional `note` says why. `roundDeadlineMs` must be a positive whole number of milliseconds (FIX-1791).
- 617aeab: Channels are removed (FIX-1792, FIX-1748): `CHANNEL.md`, `channelFlow`, `openChannels`, `readChannelsDirectory`, `channelBoard`, `channelInstances`, the channel and membership inventory collections (`defineChannelInventoryCollection`, `defineMembershipIndexCollection`), and `fsdev gen`'s channel slot are gone. A coordinator is a `WORKER.md` on the `coordinator` flow. Start from an empty store: a store written with channel rows does not open.
- f6461ea: `createWorkforceClient(fsd)` takes the app's one client from `createClient` and works as its user, over its transport. It no longer takes `{ userId, baseUrl, apiPath, fetcher }`; `WorkforceClientOptions` is removed and `WorkforceClientSource` names what it reads (FIX-2162).
- b255c6b: Every worker runs on one shared copy of the flow it names (FIX-1788). `hireWorkforce(installation)` returns one copy of each worker flow and the roster flow (`workforce-roster`, with `hire`, `fork`, `edit` and `fire`), and mints nothing per worker and pins nothing. A worker flow declares `session: installation.session()` and loads its worker each turn; `workerFlow(...)` builds a flow in its own file on its installation, and `installation.resourceVisibility` narrows each turn's model to its worker's document grants. The built-in `agent` on an installation keeps each worker's skills apart and refuses a turn whose input names a worker.

  Removed from the last publish: `defineHiredRosterCollection`, `reloadHiredSeats`, and `seatAddress` / `splitSeatAddress`. A runtime-hired roster no longer reloads from `workforce/roster/*`; hire and fire write the user's roster through `createWorkerHireBlocks`.

- e9f9316: A worker can now hold packages, folders of a `PACKAGE.md` and a `blocks/` folder found in its own `packages/` folder or taken by name from its team's or the org's through `packages:`: the built-in `agent` kind adds their instructions to its prompt and, when the worker writes no `tools:` line, their blocks to its tools, with `readWorkforce` returning them on each record, `hireWorkforce` taking the generated `packageBlocks`, and a custom kind receiving them under `seatPackages` (FIX-1459).
- e8380b0: Projects name the MCP servers their coding runs get. The row gains `mcpServers` (a row stored before reads `[]`); `createProject` takes it and the new members-only `setMcpServers` replaces it, checked against `defineProjectBlocks({ mcpServers })` (`unknown-mcp-server`, `invalid-mcp-server`). `projectMcpTools(servers, { operator })` resolves a run's servers from the same read as `projectWorkspace()` and relays their tools through FSD's own connection with the run owner's key, read from the new user-scoped `mcp-credentials/*` collection (client read: `setAt` only) (FIX-1905).
- b2f2d4c: Projects: an organization's `projects` collection (`defineProjectsCollection`), and `defineProjectBlocks` for writing rows. `createProject` creates a row owned by the calling session's owner, with its members. Refusals are `ProjectRefusedError` (FIX-1718, part of FIX-1793).
- c364ebb: Each seat's inventory row now names its **door** (FIX-1690), the action that takes a person's message: the one public action its kind declares with `userMessage` and a `{ message }` input. A kind with none publishes `door: null`. A kind with two also publishes `null`, and the hire warns, naming both. `openInventory` reads the door from the seats you pass it, and `InventorySeat` now requires `actions`: pass `hireWorkforce`'s seats as they are, or `actions: {}` for a seat you build by hand that takes no message. Also exports `seatDoorOf(seat)`.

  Rows written before this read `door: null` until the next boot rewrites them.

- b24a0f2: `workerTaskEntry` takes a `block` instead of a `turn` (one or the other): the block is handed the task itself plus `claim`, the board, partition and row incarnation the gate verified (FIX-1866). `conversationLedgers` exports the entry's resolver for a conversation's board, and `filingConversationBoard(ctx)` finds the board of the conversation a task session was opened for, with the entry that runs it there. A conversation's board now copies a project conversation's project onto the task session it hands over (`filingProjectId`, readonly), and `projectWorkspace()` resolves a run's project from the filing workstream, then the filing project, then the task's `input.project` (`{ visibility, id }`, checked against the run's own user); a task naming another project than its conversation's is refused `other-project`.
- 98b90a6: Workers can be data: `createWorkerInstallation` gives a worker flow a create check that names the session's worker once, `resolveWorker` loads it each turn, `createWorkerHireBlocks` writes the user's roster, and `createWorkforceClient` finds or starts a session with a worker. `writeShared` now names the worker the turn loaded, not a `seatId` setting. `createSkillsLibrary` takes `partitionBy` to keep one catalog per party on one flow copy (FIX-1788).
- 2b118ab: A workstream's lead must list delegates: `openWorkstream` refuses a lead whose `delegates:` is empty with `cannot-lead`. `defineWorkstreamBlocks` also returns `listLeadsTool` (`listLeads`), which lists the workers on the caller's roster that can lead, so a project coordinator given it and `openWorkstream` can open a workstream for the person and hand their ask to it in the same turn. `installation.roster(ctx)` reads the user's whole roster, and `RosterWorker` carries its `delegates` (FIX-1793).

### Patch Changes

- 9f237f5: A turn woken by a filed task's ending, and an answer again about tasks that finished mid-turn (`answerAgain`), now read each ending as a `getTask` call and its result for that task, the row in full, instead of a user-role message holding the line with its output cut at 500 characters. The line under the delegate's name is unchanged, and a turn of your own that isn't the built-in generator still gets it as its message. `finishedTasksAnswerAgain`'s default message now names each finished task (`- <taskId> (<worker>): <ending>`) without its result. Orchestration exports `readTaskView(task, rows)`, the read `getTask` returns (FIX-2345).
- 5d31955: A flow can declare `reads`: blocks an app runs on a session to look at something the flow computes, stored nowhere. The engine serves them at `POST /:flowKind/:sessionId/reads/:readName`, answering `200 { output }` with no request record and no concurrency slot; any write a read's block tries is refused with `read_only`, and another user's session answers 404 as the action route does. The client calls one with `flow(kind).read(name, input, { sessionId })`. Orchestration adds `taskToolReads(collectionId, resolve)`, the `listTasks_<suffix>` listing as a read, and Workforce's coordinator and agent-worker flows now serve `listTasks_tasks` as a read, so an app polling a conversation's task board no longer stores a request per poll. The action of the same name is unchanged (FIX-2286).
- 741e900: `hireWorkforce` refuses a worker flow whose model is offered `sendMessage` but that carries no session-board `dispatch` pass, since a message it sent whose first delivery failed would never be sent again. Spread the session kit's `entries(turn)` into `internal.actions` and declare the `manager` role. The Error Reporter's flow now carries the pass, so its messages are sent again until they land, and declares `manager` itself (FIX-2271).
- 8debbfb: A worker flow's registration can name the settings a user may see: `workerFlows: { coder: { flow, showSettings: ["harness"] } }`, or `workerFlow(build, { showSettings })`. Each `roster()` row gains `settings`, which holds only those keys with the worker's own values, for standard workers and a user's own alike (`{}` when its flow shows none). Every other setting stays on the server. `hireWorkforce` refuses a name the flow's `configSchema` doesn't declare, a key every worker carries, or a key the hire reads itself (FIX-2281).
- 1460dc4: When a coordinator's routing (best fit, round robin or everyone) hands a message to a delegate and that delegate's task fails, the conversation now gets one line under the delegate's name: `<delegate> couldn't answer: <the error>`. It wakes no turn. A cancelled task or an empty reply still says nothing (FIX-2266).
- 1cd9821: A harness manager runs a task whose board-minted id isn't a usable identity segment, such as a coordinator's routed task (`routed:<request>:<round>:<delegate>`): a task that names no issue runs under `taskIssueSegment(taskId)`, the id itself when it fits and an `h-` hash otherwise. A session door's `runOf` keys a row's run with the same export. A conversation-result task whose output carries an `answer` string, as a coding run's does, now lands that answer in the conversation, routed or not (FIX-2270).
- 8e67ce5: A worker's call that dies after sending its message and before it parks is continued (FIX-2269). A call (`sendMessage({ wait: true })`) now owes its park through the new optional `RequestWaits.owingPark(work)` before it sends. If the request is then marked `interrupted` while it still owes one, the durability sweeper continues it, and the replay waits on the message it already sent, so the call is answered instead of left waiting forever. A request still owing its park 10 minutes after the first owe is left `interrupted`. History and retention read an interrupted request that owes a park as one that will run again, and stopping it lets the owe go. A repeated call's send now dispatches itself, so the continued call has a request to wait on.
- 0621900: `defineAgentWorkerFlow({ settings })` declares settings of the app's own on the built-in `agent` flow, beside its built-in ones, so a worker's file can set them and `showSettings` can put them on its `roster()` row. A key the flow already declares is refused when the flow is built (FIX-2341).
- 5ab09d4: A seat on the built-in `agent` kind now hands its model the earlier turns of its own conversation, up to the session's history window (the last 50 turns by default) and never another conversation's, so a follow-up keeps its subject (FIX-1612).
- 3221d05: A dispatched task's background work that errors now fails its attempt (FIX-2088), as if its request had thrown: the task runs again while it has attempts left, otherwise it fails with an error naming the step (`Background work "<step>" failed: ...`). It counts in every request working the task, including steps `onCompleted` and `onFinished` start and a step a default `.waitForSideChain()` already drained. The request itself still reports `completed`. A cancel never fails the task this way, and a step that failed before a suspension counts only if its rerun on the resume fails too. Make a step best-effort by catching inside it.

  Core adds `RequestEnding.backgroundFailures` and the `BackgroundFailure` type (`@flow-state-dev/core/types`), and `RequestSideChainPool.failures()`; the engine hands a request's background failures to its request-end hooks. In Workforce, a failed `afterAnswer` step (such as a memory capture) fails a task's attempt too, except in a task filed `resultTo: "conversation"`, where it is logged and the task keeps its answer. Conversation turns are unchanged. A step a timed-out `.waitForSideChain({ timeoutMs })` stopped waiting on is still waited for before the request ends, and its failure counts and is logged, with `failOnError` too; `drainScope` takes an `abandoned` signal for this. The MOAT bash provider's purge of stale containers now logs a failure instead of throwing it.

- dd80e01: A best-fit routing record now carries `evaluationFailed`, the evaluator's error, when that call failed and best fit asked again as a language model (FIX-1925).
- 8485a48: A coordinator that routes by best fit now hears a task it filed end in its own turn, as one that routes by judgment does, so it can file a failed task again and tell the person. Round robin and everyone still show the ending as a line only (FIX-1863).
- a11f57a: Best fit now routes when the coordinator flow's `routeModel` is a language model, such as `openai/gpt-5.4-mini` through Vercel's AI Gateway, by asking the same question once more as a language model when the evaluator call fails (FIX-1889).
- 397cfa7: Boot warnings and the active-profile line now print once per server process, not on every dev hot reload (FIX-1632).
- 4a367f6: A boot now publishes the inventory row of the hire the roster holds over a row left by an interrupted fire, so a replacement hire that stopped before publishing is listed again after the next restart (FIX-1621).
- e8afd98: A delegate's task whose run the user cancels now ends `cancelled` instead of `errored`, so it no longer owes the Error Reporter a report; `ERROR_REPORTER_FLOW` is exported from `@flow-state-dev/workforce/browser` (FIX-2051).
- 43649da: `defineProjectBlocks()` adds `listProjects`: the projects the caller is a member of, each with its address, title and repository. A shared project the caller isn't a member of is left out. The DevTeam Shift Coordinator has it as a tool, with a `forCoding` line saying what a coder's task that names no project does next, so asked to have the coder look at "our repo" it files the task for the one project with a repository without asking, and with two or more asks which one, naming them (FIX-1869).
- 8f604e7: A browser can now read its person's conversation boards through the `tasks` collection, every conversation's rows in one read and none of another person's, and `sessionIdOfFiling` is exported from `@flow-state-dev/workforce/browser` to name the conversation each row was filed in (FIX-1792).
- 4fae894: A coordinator conversation retries its state writes more times before giving up, so when many delegates answer at once a closed round's answers still go back out instead of being lost (FIX-1840).
- 87fb5c0: A worker's `discover:` line now narrows its discovery tool on every worker flow, `coordinator` included, so the DevTeam project coordinator reads workers only through `listLeads` (FIX-1920).
- 5f7dda5: A coordinator's failures now reach the Error Reporter: a delegate's failed post as it ends, and a best-fit crash answered with "Nobody took this post" (FIX-2010).
- 334c1e3: A best-fit coordinator reads each message with its conversation's recent lines, so a follow-up goes to the delegate whose answer it follows, and the delegate handed the message is shown those lines for that turn; a delegate flow of your own shows them by setting its generator's `history` to `routedTaskHistory` (FIX-1828).
- effa822: A coordinator's `handOff` tool now tells the model that a new message is a new post, even when it repeats an earlier ask, so a coordinator no longer declines to hand a repeated ask to the delegate that took it before (FIX-1826).
- 9b4e7b1: `defineCoordinatorFlow` now honours `agent.isolateUserState`: the coordinator flow keys its user-scoped storage by its copy when the judgment turn asks, as the `agent` flow does. Before, the option was accepted and ignored (FIX-1776).

  Shift Manager's DevTeam Shift Coordinator carries the standard memory set (working memory, the rolling digest, `memory/recall`), read-side only unless `DEVTEAM_MEMORY_CAPTURE=1`. It says when it has no memory of something rather than inventing one.

- ef185db: A task notice that reaches a coordinator conversation mid-reply now waits for the replies running when it arrives and any that start within 30 seconds of it, instead of running beside them, while a person's next message still starts at once (FIX-1834).
- 5d94e61: A filing's dependency check reads each dependency as stored now, so a dependency another request failed or cancelled while the filing ran is refused `dependency_ended` at filing, and nothing is stored, as the docs say. Before, the filing was accepted and a cascade cancelled it moments later (FIX-2114).
- 50b5273: The workforce discovery door now leaves out a stored roster row it cannot address, such as one an app's own hire action wrote under the development organization or one whose worker id starts with `~`, instead of dropping the organization's whole worker listing (FIX-1541).
- 6819520: A task board that starts a row on another worker now **dispatches** it; **hand-off** means only passing work that is already under way (FIX-1876).

  - The board's ending for "every remaining row is running in a dispatch run" is now `terminationReason: "dispatched"` (was `"handed-off"`).
  - The row-dispatch block's output is now `{ dispatched: true, taskId, sessionId, requestId, adopted }` (was `handedOff: true`).

  The old exports are gone, with no alias, so an import of one fails to compile and names it:

  - `@flow-state-dev/orchestration`: `createHandOff` → `createRowDispatch`, `HandOffOptions` → `RowDispatchOptions`, `HandOffAssignee` → `DispatchingAssignee`, `handedOffTaskPredicate` → `dispatchedTaskPredicate`, `assertHandOffBoardSupported` → `assertDispatchBoardSupported`, `assertHandOffBlockSupported` → `assertDispatchEntrySupported`, and the board handle's `handedOff` → `dispatchers`.
  - `@flow-state-dev/core` and `@flow-state-dev/engine`: no export changes. Definition-time and run-time refusals say a block "dispatches to task:…" where they said it "hands off to task:…".

  The task-board page's "Assignees that hand off" section is now "Assignees that dispatch"; the old anchor still lands on it.

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

- ee1d251: Standing rules (FIX-1945): workers on `agent` and coordinators keep notes a user asks them to keep, one list per worker per user, read on every turn. The worker edits them with `rules/read`, `rules/add`, `rules/change` and `rules/remove`, offered only on a turn the user started, and each write shows a line in the conversation. Both flows declare a `standingRules` action, and `createWorkforceClient().standingRules(worker, input)` reads and edits the list for the signed-in user, and a worker's inventory row carries `rules`, true when its flow declares that action. Limits: 20 rules of up to 300 characters, one line each; every write names the version it read.
- f12089e: A follow-up task's result now goes where its root task's went: a follow-up of a task filed `resultTo: "conversation"` lands as the delegate's reply, with one attempt, and a follow-up that names `resultTo` is refused `follow_up_takes_no_result_to`. In a Workforce conversation, the failure or cancel of a conversation-result task with no routed brief, such as that follow-up, now shows as a line, and wakes the coordinator's turn under judgment or best-fit routing (FIX-2122).
- 35bec56: A follow-up task now runs in the session its root task ran in when that task was filed `session: "ongoing"` or for a workstream: its row carries the root's `session`, `target` and `targetSessionId`, and a follow-up that names a `target` is refused `follow_up_takes_no_target` (FIX-2111).
- 90a5e64: A task's notice held while the request that filed the task was running now reaches the filer about two seconds after that request parks on a person or a wait, rather than at the notice's next resend, which could be up to 5 minutes away once its backoff had grown. The park owes the filer's pass one wake and reads no row. In Workforce, a drain parked on a step that runs in a session of its own now resumes within seconds when the step ends while the drain is still parking, rather than at the wait's deadline (FIX-2149).
- 01b29f0: A hired seat stays with the organization and user that hired it, so another organization or roster peer cannot list, open, or run that seat (FIX-1529).
- 85696dd: The `hire` tool's description and `settings` field now tell a model that a kind may require settings, and a hire the kind's settings schema refuses now says nothing was written and to call `hire` again with the setting (FIX-1758).
- b154c7d: A worker message sent from a task now counts on in the chain of the turn that filed the task, including a task filed `session: "ongoing"`, which runs in the delegate's existing session (FIX-2106). Before, a message from such a task started a new count, so a chain could get past `messages.budget` by passing through one. The filing writes its count on the row, under the `filedAtHop` metadata key, which a caller can't set or change. If you write in the filing conversation before the task starts, your line still starts a new count for it. A row filed before this change runs at its session's count, as it did.
- 046d8cc: `openWorkstreamTool`'s lead-fit check also asks whether a workstream's title and objectives say what sort of work it is, and no longer refuses work they don't, such as a bare name (FIX-2019).
- eede477: A lead's `updateWorkstream` tool (`updateWorkstreamTool`) no longer takes `title`, so a worker leading several workstreams can't write one's name onto another: `updateOwnWorkstreamInputSchema` is status, due date, objectives and report. A call with `title` fails validation. A workstream is renamed by its owner through `updateWorkstream`, or by their project coordinator's `editWorkstream` (FIX-1968).
- be3016d: The workforce client gains `listWorkerSessions(worker)`: the caller's conversations with one worker on its current flow, as `WorkerSessionEntry` rows (`{ session, isDefault }`). The default conversation, the one `ensureWorkerSession` returns, comes first; the rest follow by latest activity. A task's session, a conversation's delegate session, a workstream lead's session and the project coordinator's session for a project are left out, and listing never creates a session (FIX-2158).
- 718e84c: Adds `mergeSeatFlows(flows, seats)`, which refuses a hired seat whose id is already a flow's instead of replacing that flow, and exports `newIncarnation()` and `tagIncarnation()` so a host that writes roster rows itself can stamp its hires (FIX-1719).
- 467f3fb: `defineWorkstreamBlocks({ leadFit: { model } })` now checks a worker's pick of lead with the same fit check a coordinator's `best-fit` routing uses, so the two can't disagree about whether a worker fits some work. The check is asked about the chosen lead with three choices: the lead, _none fits_, or _the work doesn't say its sort_. It refuses the open with `lead-doesnt-fit` only on _none fits_; a bare-name workstream and a lead with a broad description still pass, and a failed check still lets the open through. The model is asked as an evaluation model first and, on a model string, once more as a language model when that fails. A borderline lead may now get a different verdict than before. `leadFit: { model }` and the `leadFit` record on the tool's answer keep their shape; the record's `unanswered:` reason can also name an answer that wasn't one of the choices. Tests that scripted the old check as the generator `workstream-lead-fit` answering `{ says, fits }` now script an evaluator of that name answering a `worker` choice (the lead, `~none-fits` or `~sort-unsaid`), and its language-model ask as `workstream-lead-fit-ask` (FIX-2083).
- 24744af: On a Workforce conversation's board, a task runs one turn at a time in its session: while one of its turns waits on a step it filed for itself in a session of its own, a notice's turn and a steer's turn wait until it answers, instead of planning beside it and stalling the task. `taskSettledEntry` takes `defer`, and `resendNowPatch` is exported (FIX-2113).
- 0d6278e: Each worker's token usage is recorded per person and day, with harness runs reporting their spend through `reportHarnessSpend`, read through the `workerUsage` query, and shown on Shift Manager's Usage view (FIX-2145).
- 4c501cf: A worker whose last plan step ran in a session of its own (`session: "new"`) now gets its answering turn once that step ends, and its request returns that answer. Before, the request finished with the turn's earlier answer and the step's result never reached it (FIX-2110).
- 315f7f3: `projectWorkspace({ checkouts })` runs a listed shared project's coding runs in worktrees of a checkout on the server's machine, with the project's kept files beside each worktree, which `localWorkspaceHost`'s `localRepositories` now supports (FIX-1906).
- ca2f7ea: A project coordinator's `readProject` tool now marks each workstream `yours: true` when the session's user owns it, so the coordinator can tell its user's workstreams from other members' (FIX-2005).
- 30904d4: A project's coordinator can now manage its own project: `defineProjectBlocks()` adds `setBrief`, and `setBrief` and `setRepository` take an optional `project` that defaults to the conversation's linked project (FIX-1900).
- 6a3ecf5: `@flow-state-dev/client` exports `readEveryCollectionPage`, one collection read with a single 1,000-page ceiling that fails when the server repeats a cursor, and the workforce panels, the DevTool Inventory tab, the Shift Manager and the workforce roster read now use it, so a repeated cursor ends a read with an error instead of 1,000 wasted page reads, a partial list shown as whole, or a read that never stops (FIX-1674).
- dd2563b: A conversation board now shows a browser the question a task waits on (`Task.holds`). Shift Manager's shift summary lists tasks held on a question for the user under Needs you, and its DevTeam chief of staff answers from what a finished task found (FIX-1972).
- eb831f8: A schedule in the user's schedule collection files an ordinary task on the named worker's board each time it is due, through the roster flow's new `saveSchedule`, `deleteSchedule` and `listSchedules`, and Shift Manager lists them on a Scheduled work screen (FIX-2085).
- 1cfd80c: `defineResource` and `defineResourceCollection` take a `secret` list of state fields the engine never sends to a client or returns from the debug routes, and Workforce marks a stored MCP key's `value` secret so the debug routes no longer show it (FIX-1955).
- 3311cc2: `HIRED_ROSTER_BROWSER_PATTERN` and `HIRED_ROSTER_PRIVATE_PATTERN` are now exported from `@flow-state-dev/workforce` instead of `@flow-state-dev/core/types`, and `@flow-state-dev/core` no longer exports `HIRED_ROSTER_PRIVATE_BRAND`, `markHiredRosterPrivateCollection` or `isHiredRosterPrivateCollection` (FIX-1549).
- ef72c19: A routed task that a coordinator's own turn filed (under `judgment`, or `best-fit` when it takes a message itself) now tells the conversation when it fails: the failure lands once as the delegate's line, naming the task and its error, and wakes the coordinator's turn so it can file the work again. A routed task a routing policy filed still ends only that delegate's part of the round, with no line (FIX-2115).
- 92a8b49: The session routes now send a session as a client may see it (FIX-1588). `GET /sessions/:id`, the session listing, and the create and metadata-edit responses carry only the `state` fields the flow names in `session.client.expose` or declares readonly (empty when there are none), and no longer include the record's `journal` or stored `resources`. Server-side code that needs the whole record reads the session store.
- 3d30b70: A split task whose failed piece is filed again, in the turn that failure woke, now completes once the retry does, and fails naming the retry only if the retry fails for good too (FIX-1802).
- eb66ddd: A worker on a task can split it into pieces for any worker on the user's roster that takes tasks, not only its own delegates; an unassigned piece still goes to its only delegate, and the chain limits still apply. A split task now completes with `{ answer, pieces }`: the answer of the turn the last piece's ending woke, with the pieces' outputs under it. It settles only once every piece has ended and its ending has been heard. When it settles with no such turn (a settle replayed after a restart), the output is `{ pieces }` alone, as before. On a task turn, a worker files its pieces and ends the turn: each piece's ending wakes the task (FIX-1997).
- 3f92a61: The turn a steer starts while a task waits on work it filed now shows the steer in the task's session as a line from its sender, so the turn that answers after that work ends reads it too (FIX-2113).
- e11764a: `ctx.suspend()` takes an optional `title`, a short heading for the ask, carried onto the suspension record and the `suspension` item; `message` is then the body under it. The Error Reporter's preview now sends a short title with its count and questions as a markdown body (FIX-2030).
- 2e8f640: A handed-off task now names the run working it: its row carries `run: { sessionId, requestId, attempt }`, written by the run before its worker starts and published as a `run_linked` task change (FIX-1668). `TaskCollectionRef` gains a required `linkRun` verb, so a hand-written collection must implement it.
- 9af8ce5: A dispatched task records what its runs spent on its row (`spend`), every attempt counted, rising while a run works: the board writes it every 2 s and as the request ends, through the new `recordSpend` verb on `TaskCollectionRef`. `listTasks` from `taskToolActions` returns it folded (`taskSpendView`: harness, model, input and output tokens, `null` until reported). Harness runs report spend as they go, keyed by a `runId` with the model the run named, each report replacing the run's last; `readRequestSpend(ctx)` reads a running request's spend so far, and `requestSpendSources` moves from Workforce into core (FIX-2288).
- 912ae98: A durable task board's task tools can now run as flow actions (`taskToolActions(board)`), and the DevTool's Tasks tab opens a task's full record and runs those actions from the row, showing a refusal as a refusal (FIX-1629).
- 7a1932d: A worker filing tasks from a workstream or a project's conversation is told that conversation's project in its task tools' context, and to leave `project` out of a task's `input`, so it no longer guesses one (FIX-1970).
- b36a8a5: A hand-built worker manifest with `tools: undefined` is now treated as having no `tools:` line everywhere (FIX-1459). Before, every turn already granted it its picked presets' tools, but the startup check read it as a written line and skipped the clash refusal, so a preset tool-name clash surfaced mid-turn instead of at hire.
- 78178a9: The project workspace now reads the bare user id, not the user record's storage key, so a person is recognized as a project member (FIX-1790).
- 49d2aca: A stop that waits for a user holds its task and ends exactly once (FIX-2129).

  - **`ctx.suspendForUser({ kind, prompt, deadline? })`** (`core`): stop the request for an `approval`, a `review` or an `input`. It returns the answer, or `{ cancelled: true }` when the task was cancelled while it waited. At its deadline an approval reads as a no (`deadline: true`) and a review or an input throws `SuspensionTimeoutError`, which the block may catch. With no `deadline`, the host's `userDeadlineMs` applies, else none: the stop waits until it is answered, stopped or cancelled. The model's tool is `suspendForUser`; the task's open stop is listed on `Task.holds`.
  - **The answer route** (`engine`): `POST /api/flows/:flowKind/requests/:requestId/answer` answers a user's stop in any run, a task board's included, after the resume path's ownership checks; a request handle's `answer` (`client`) calls it. Who answered is the signed-in caller.
  - **`userDeadlineMs`** (`createFlowState`, `engine`): the host's deadline for a user's stop, unset by default.
  - **Cancel one stop:** `RequestHost.resumeWait({ suspension: { requestId, suspensionId }, outcome: { cancelled: true } })`.
  - `contracts` exports `isUserSuspension` and `suspendForUserKindOf`, and `SuspensionStatus` gains `"cancelled"`.

  A raw `ctx.suspend` with `user_approval` or `user_input` now gets the same mark, cancel and stop as `suspendForUser`. A raw `user_input` stop past its `timeoutMs` now resumes its block with `SuspensionTimeoutError` instead of staying parked, and a cancelled one throws `SuspensionRejectedError` with `cancelled: true`. A filing by a cancelled task is refused (`TaskFilingRefusedError`, rule `parent_cancelled`). Shift Manager answers every ask through the answer route.

- 96ff077: A turn waiting on another worker's task says **wait** (FIX-1876). `@flow-state-dev/core` exports `WAIT_GATE_REASON`, `isWaitGate`, `WaitGateBinding`, `WaitOutcome`, `WaitEndingErrorCode`, `parkOnWait`, `ParkOnWaitInput`, `parseWaitOutcome`, `recordedWaitOutcome`, `RequestHost.resumeWait`, `RequestHost.hasWaitSweeper`, `ResumeWaitInput` and `ResumeWaitResult`. `@flow-state-dev/orchestration` exports `waitGateId`; a row's wait slot is `Task.wait`, and `listTasks` marks a waited-on row `waitedOn: true`. `@flow-state-dev/engine`: the request host's `waitResume` and `waitSweeper` (`RuntimeConfig.requestHost`).
- 2ce8d58: `setWorkProject(worker, project, { sessionId })` now refuses a session that runs a worker other than `worker`, storing nothing (FIX-2161). A follow-up of a task filed before tasks recorded their project, and such a task still waiting on the board, now stay in the project the task was filed in after the conversation's project is set or changed.
- 721a811: A task-board worker can now read its own claim (FIX-1047). `currentWorkerClaim(ctx)` returns the ticket inside a worker the board runs inline and inside a worker reached through a task entry, and `undefined` outside one. A worker's task-tool writes are limited to the task it holds, so a write naming a different task is refused. The observation ledger and the tool cache's `sourceTask` now record the worker's task.

  `currentWorkerClaim` takes the block context. A claim reads back only in the request that took it: a request the worker starts or resumes in the same process (a message, a dispatch, a resumed turn) gets `undefined`. Code that called `currentWorkerClaim()` with no argument must pass its `ctx`.

  `taskLedgers` takes `taskTurn: false` for an entry whose run answers the user rather than the task's filer. Such a run keeps its claim but is not a task turn: it can wait on work it dispatches.

- f90171c: `workerTaskEntry` is exported, so a worker flow you write can take the tasks a coordinator files for its workers. A delegate whose flow's `work` entry takes tasks only from another board is now reported by `listDelegates` as taking `nothing`, and a task filed for it is refused instead of waiting forever (FIX-1842).
- 1f2650b: Add a `@flow-state-dev/workforce/browser` subpath that exports the roster keys, session helpers and message names (`SEND_MESSAGE_TOOL`, `MESSAGE_RECEIVED_ENTRY`, `RECEIVED_MESSAGE_COMPONENT`) without reaching any Node built-in, so client components can import them where the server-only package root would fail to compile (FIX-1605).
- d67de66: A coordinator's `listDelegates` (the action and its turn's tool) now gives each delegate `description`, its worker's own description, and `takes`: `posts`, `tasks`, `both`, or `nothing` when it has been fired or its flow takes neither, read from the flow it runs on. A delegate that takes nothing, or a worker with no description, has a `description` of `null`. The type of `takes` is exported as `DelegateTakes`. A `handOff` refused for a delegate that can't take the post now ends by naming the delegates in the conversation that can, as in `Delegates here that take posts: eng.em.`, or `No delegate here takes posts.` A `hire`, `edit` or turn refused for a skill the installation doesn't register now names the skills it does, as in `Skills it registers: "cite", "summarize".`, or says `It registers no skills.` (FIX-1826).
- f94ba22: A worker session's read now shows `workProjectId`, the project `setWorkProject` put the conversation in, so a screen can name it. It stays server-owned: a client still can't write it. (FIX-2278, found while wiring FIX-2153)
- 848020a: A `defineFlow(...)` worker flow passed in `workerFlows` now typechecks in an app compiled with `strict: true`; it was refused with TS2322 before. The routing record of a best-fit post that nobody took, after the coordinator's own turn failed too, now carries `fit` with why best fit missed (FIX-1909, FIX-1912).
- c2168ec: `defineWorkstreamBlocks` takes an optional `leadFit: { model }` and returns `openWorkstreamTool`: a worker's open first checks, with one model call, that the lead's description says it does the work, and is refused `lead-doesnt-fit` when it doesn't. A user's own `openWorkstream` is never checked (FIX-1920).
- e602014: A task filed from a workstream or a project's conversation now names that conversation's project in `input.project`, whatever project the filer named (FIX-1969). Before, a lead that guessed a wrong project id got every coding run refused `other-project`.
- Updated dependencies [dc17a39]
- Updated dependencies [92b2b70]
- Updated dependencies [20aa58f]
- Updated dependencies [a5c1ce8]
- Updated dependencies [9f237f5]
- Updated dependencies [5d31955]
- Updated dependencies [bea14a0]
- Updated dependencies [71ab534]
- Updated dependencies [15f7c6b]
- Updated dependencies [5c8a130]
- Updated dependencies [24afa6e]
- Updated dependencies [f8df86f]
- Updated dependencies [82eea02]
- Updated dependencies [e2c190e]
- Updated dependencies [0d55d46]
- Updated dependencies [1abab86]
- Updated dependencies [cb364e8]
- Updated dependencies [8e67ce5]
- Updated dependencies [af6c7cd]
- Updated dependencies [dd353e2]
- Updated dependencies [c245f7c]
- Updated dependencies [0836ffa]
- Updated dependencies [ad0babd]
- Updated dependencies [10ded49]
- Updated dependencies [e00a3b0]
- Updated dependencies [3221d05]
- Updated dependencies [58ffc93]
- Updated dependencies [4cdc088]
- Updated dependencies [f97b0ed]
- Updated dependencies [397cfa7]
- Updated dependencies [70cfac9]
- Updated dependencies [53b50f0]
- Updated dependencies [585b75b]
- Updated dependencies [06ea781]
- Updated dependencies [2ffc03c]
- Updated dependencies [646f8d2]
- Updated dependencies [16a8dab]
- Updated dependencies [49852d9]
- Updated dependencies [698e06b]
- Updated dependencies [456fe85]
- Updated dependencies [62133c4]
- Updated dependencies [f282bcb]
- Updated dependencies [9d02ac6]
- Updated dependencies [d5ce1e0]
- Updated dependencies [8dc242e]
- Updated dependencies [89af7db]
- Updated dependencies [7d4158f]
- Updated dependencies [5d94e61]
- Updated dependencies [5492a77]
- Updated dependencies [6819520]
- Updated dependencies [b234f0d]
- Updated dependencies [ad5df6f]
- Updated dependencies [211679a]
- Updated dependencies [dd80e01]
- Updated dependencies [2ce15c7]
- Updated dependencies [5181ddb]
- Updated dependencies [8628a54]
- Updated dependencies [3c10d9d]
- Updated dependencies [2969b30]
- Updated dependencies [3ee61e5]
- Updated dependencies [a74429a]
- Updated dependencies [04ff39d]
- Updated dependencies [e71ea1a]
- Updated dependencies [60d1bf4]
- Updated dependencies [49d6397]
- Updated dependencies [a55d07f]
- Updated dependencies [7db4d13]
- Updated dependencies [f12089e]
- Updated dependencies [35bec56]
- Updated dependencies [9e3b823]
- Updated dependencies [df3de3b]
- Updated dependencies [3b40ca1]
- Updated dependencies [fe5df7d]
- Updated dependencies [17444fe]
- Updated dependencies [423a405]
- Updated dependencies [809cebd]
- Updated dependencies [ba74f01]
- Updated dependencies [08a9b05]
- Updated dependencies [c4d9743]
- Updated dependencies [90a5e64]
- Updated dependencies [7da156e]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [f9995b1]
- Updated dependencies [a7f1c41]
- Updated dependencies [3a6c910]
- Updated dependencies [80f6e25]
- Updated dependencies [d356f52]
- Updated dependencies [7725f5c]
- Updated dependencies [2348dbd]
- Updated dependencies [3cbab3a]
- Updated dependencies [3cbab3a]
- Updated dependencies [d5f5bba]
- Updated dependencies [849f6ec]
- Updated dependencies [028af6f]
- Updated dependencies [a965a50]
- Updated dependencies [eb831f8]
- Updated dependencies [859f621]
- Updated dependencies [f6461ea]
- Updated dependencies [16455f2]
- Updated dependencies [41638f3]
- Updated dependencies [24744af]
- Updated dependencies [4a3b026]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [12bf045]
- Updated dependencies [db7df1c]
- Updated dependencies [0d6278e]
- Updated dependencies [f2f8527]
- Updated dependencies [726de78]
- Updated dependencies [968faa6]
- Updated dependencies [653549d]
- Updated dependencies [d348ae7]
- Updated dependencies [315f7f3]
- Updated dependencies [f292079]
- Updated dependencies [6a3ecf5]
- Updated dependencies [dd2563b]
- Updated dependencies [839e915]
- Updated dependencies [f5b5457]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
- Updated dependencies [16bb676]
- Updated dependencies [c4150e7]
- Updated dependencies [65ddb90]
- Updated dependencies [9510a03]
- Updated dependencies [adbcf0b]
- Updated dependencies [1027b98]
- Updated dependencies [1cfd80c]
- Updated dependencies [3b0161c]
- Updated dependencies [385d01e]
- Updated dependencies [d1a4cab]
- Updated dependencies [d1a4cab]
- Updated dependencies [3311cc2]
- Updated dependencies [2ab7ea2]
- Updated dependencies [7c9e932]
- Updated dependencies [60c8192]
- Updated dependencies [d2dd7f7]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [edc3197]
- Updated dependencies [295e96a]
- Updated dependencies [97894aa]
- Updated dependencies [334c1e3]
- Updated dependencies [b7c523b]
- Updated dependencies [9ed6b29]
- Updated dependencies [b552b50]
- Updated dependencies [a021cd1]
- Updated dependencies [d994f51]
- Updated dependencies [afb512f]
- Updated dependencies [09e3705]
- Updated dependencies [eb66ddd]
- Updated dependencies [2f342f6]
- Updated dependencies [cd180d7]
- Updated dependencies [68b8957]
- Updated dependencies [e11764a]
- Updated dependencies [edb3d46]
- Updated dependencies [872a088]
- Updated dependencies [9edbfa2]
- Updated dependencies [437727e]
- Updated dependencies [9cd314d]
- Updated dependencies [2e8f640]
- Updated dependencies [9af8ce5]
- Updated dependencies [7035b4c]
- Updated dependencies [30aa133]
- Updated dependencies [912ae98]
- Updated dependencies [7052203]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [e8380b0]
- Updated dependencies [69ba29c]
- Updated dependencies [78178a9]
- Updated dependencies [d97031f]
- Updated dependencies [49d2aca]
- Updated dependencies [3c10d9d]
- Updated dependencies [da86f88]
- Updated dependencies [96ff077]
- Updated dependencies [84cc226]
- Updated dependencies [721a811]
- Updated dependencies [98b90a6]
- Updated dependencies [57a859d]
- Updated dependencies [707b340]
- Updated dependencies [c4d14f6]
  - @flow-state-dev/orchestration@0.4.0
  - @flow-state-dev/core@0.3.0
  - @flow-state-dev/client@0.3.0
  - @flow-state-dev/workspace@0.2.0
  - @flow-state-dev/tools@0.2.0
  - @flow-state-dev/scheduled@0.3.0

## 0.3.0

### Minor Changes

- 0f812c9: Skills, seats and channels now answer the agent discovery door and a seat narrows what it sees with its worker file's `discover:` key (FIX-817) — **breaking:** `createWorkforceCapability` no longer accepts `agents` (pass `roster` and `inventory`) or `catalog` (pass it to `defineAgentWorkerFlow({ catalog })` instead), each now a type error naming its replacement.
- 8faf08e: A `CHANNEL.md` can declare `boards:`, durable task ledgers the channel holds, with `fileTask` and `readBoard` actions on the channel and a `channelBoard()` helper for the worker that drains them (FIX-1385).
- 17e9748: Workers can call custom tools written as files. A `blocks/` folder registers a block name for the workers that can see it — the app's own folder for everyone, a team's for that team, a worker's own for that one seat — and a worker's `tools:` resolves a name nearest first. Registering does not grant use: the worker still names the block. `fsdev gen` exports the per-seat map as `seatBlocks`, which `hireWorkforce` now takes.

  Migration: a worker kind that hand-declares the admission contract instead of composing `workerConfigSchema()` must add the new `seatTools` key, or it refuses its roster at startup naming that key (FIX-1416).

- 3e43c96: A flow can now be registered and unregistered after the runtime is built — `FlowState.register(flow)` admits one instance and `FlowState.unregister(id)` releases one address, both running exactly the checks construction runs, and a flow registered this way is served from the next request onward without cancelling one already running (FIX-1475).

  A workforce hired at runtime now survives a restart: `defineHiredRosterCollection()` declares the org-scoped roster at `workforce/roster/*`, `reloadHiredSeats({ stores, orgIds, kinds })` reads a whole one back at boot as `{ seats, problems }` for the caller to register a seat at a time, and `seatAddress(orgId, seatId)` is the address a hired seat answers on (FIX-1475).

  Migration: `meta.flowKeys` now reads the registry rather than the construction options, so it lists the instance ids actually being served. An app whose `flows` record keys differ from its instance ids will read different values there than before.

- 1a3a009: A workforce root spelled with a `..` that steps back through an earlier segment — `/srv/app/current/../workforce`, where `current` is a release symlink — is now refused wherever a reader opens a root; pass the path it resolves to instead (FIX-1375).
- 8291951: `splitResourceModules` turns the generated `resourceModules` map into the two things a flow already takes (FIX-1388).

  ```ts
  const { capabilities, resources } = splitResourceModules(resourceModules);

  const agent = defineAgentWorkerFlow({ uses: capabilities /* ... */ });
  const flowResources = { ...resourcesFromDocs(documents), ...resources };
  ```

  A capability goes to the worker kind's `uses`, where the resources it declares for itself reach the flow; a plain resource or collection merges into the one resource map, under its own ref. Nothing is installed for you — spread both at your own call site. An entry that can be neither is refused, naming its ref.

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

- f7e98d9: A worker file can now name which of its kind's capabilities that seat wants, and which of their presets (FIX-1388).

  ```md
  ---
  description: Fields questions about how the desk is running this week.
  capabilities:
    research: [briefing]
  ---
  ```

  Read by the built-in `agent` kind. Selecting **adds** to what the kind installed; a seat that names nothing carries every installed capability's own defaults, exactly as before. The whole selection is validated when the roster is hired, so a typo is a refusal at boot rather than a failed turn — including a capability the kind does not carry, a preset the capability does not declare, a preset the app turned off at install, a preset on a capability with open config, and a preset whose surface has to exist before a request runs.

  `SeatCapabilitySelection` is exported as the parsed shape of that key.

- 8bfb08c: `fsdev gen` now finds the TypeScript in a workforce tree's `resources/` folders and exports it as a fourth map, `resourceModules` (FIX-1388).

  **Your committed `workforce.gen.ts` goes stale on upgrade**, whether or not your tree has any `resources/` modules: the file gains the fourth map and a line of its header. `fsdev gen --check` stays red until you run `fsdev gen` and commit the result.

  `renderWorkforceCode` takes the discovered modules as a second argument.

- c315362: A workforce tree can declare read-only documents in `references/` beside the writable ones in `resources/`. A reference's body is served from its file on every execution context rather than from a stored row, so editing the file is the edit; `writable`, `llmWritable`, `render` and `flowIsolation` are derived by the folder and refused in frontmatter. A seat reaches the references at or above its place in the tree — the org's, its own team's and its own folder's — with no install-side filter, narrowed further by a `references:` list in its `WORKER.md`. Installing references on a kind without also passing them to `hireWorkforce` as `references` is refused at hire, naming the option: the wall is derived against that catalog, so omitting it would leave every seat reaching every team's references with nothing to say so. `resources/` behaviour is unchanged. `clearShadowedReferences({ references, orgId, content, installedOn })` migrates a tree where a document was written before it moved — `installedOn` names the flow so the stored content is addressed where it actually lives rather than guessed at (FIX-1467).
- 68d836a: A `WORKER.md` can declare `resources:`, the documents that seat may touch — naming one grants read, `rw` grants write — and the app supplies its documents through a new `documents` option on `hireWorkforce` (FIX-1381).

  Migration: `resources` is now read by the hire step rather than passed on as a setting, so a worker kind that declared a `resources` setting of its own must rename that setting before upgrading — it no longer receives an authored value. A seat that declares no `resources:` key keeps the reach it has today.

- caffe1c: A team can say once what all its seats are told: an optional `TEAM.md` at `teams/<teamId>/` carries the team's `description` and, in its body, the instructions every seat on that team is given (FIX-1377).

  Two things a consumer can trip over:

  - **`readWorkforce`'s result grows two fields**, `teams` and `teamErrors`. Treat a non-empty `teamErrors` as fatal alongside `errors` and `skillErrors` — a team file that failed is a whole team's seats running without instructions someone wrote for them.
  - **A hired seat's settings bag can now carry `teamInstructions`.** Every kind that composes `workerConfigSchema()` already declared the key, so nothing new refuses; but a kind that reads its config exhaustively will see a key it did not see before, for seats whose team wrote a `TEAM.md`. It is absent — never empty — for every other seat, so a tree with no `TEAM.md` anywhere behaves exactly as it did.

  A seat's own instructions and its team's stay two separate settings and are never merged. On the built-in `agent` kind both go into the prompt, the team's first and the seat's own last. That order is fixed, and it is a position rather than a ranking: nothing in the prompt path resolves a contradiction between the two.

### Patch Changes

- 68fb69c: `openChannels` accepts an `orgId`, so a channel's session is opened under the org its documents are scoped to (FIX-1412).
- 0508765: `readDeclaredRoster(root)` on `@flow-state-dev/workforce/loader` reads a whole workforce tree in one call — workers, teams, documents and channels — and returns one flattened `problems` list, each entry tagged with the layer that reported it. Problems are collected rather than thrown, so the caller decides what is fatal. It throws on the `root` and nothing else: a path that cannot be read, a path that is a symlink, or one spelled with an interior `..` that steps back through an earlier segment (FIX-1405).
- 4cd4f13: `openInventory` fills the live workforce inventory at boot: one row per hired seat, and one per open channel written by that channel itself from its own session state. `channelInstances({ inventory: true })` builds the built-in channel kind carrying the writer, and `inventoryWriterActions(kind)` puts the same two actions on a hand-rolled channel kind (FIX-1405).
- d49f255: `defineSeatInventoryCollection()`, `defineChannelInventoryCollection()` and `defineMembershipIndexCollection()` declare the org-scoped resource collections for the live workforce inventory, addressed with `membershipKey` and `membershipPrefix` (FIX-1405).
- 0056b97: The hired roster and a channel board's ledger can now be read by a browser, so a UI can draw them without an action in between. Both are organization-scoped, so a read returns only the reading session's own organization's rows. Each publishes an explicit allowlist rather than the stored row: a roster row crosses as its seat id, flow kind and instructions, withholding the settings bag, and a board row crosses as `CHANNEL_BOARD_CLIENT_FIELDS`, withholding the claim, lease, retry ledger, write log and the task's own payloads (FIX-1477).
- Updated dependencies [0f812c9]
- Updated dependencies [b597600]
- Updated dependencies [8faf08e]
- Updated dependencies [6b8bfe4]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [218de72]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
  - @flow-state-dev/orchestration@0.3.0
  - @flow-state-dev/core@0.2.0

## 0.2.1

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2
  - @flow-state-dev/orchestration@0.2.1

## 0.2.0

### Minor Changes

- 3c15e14: Rename the channel kind factory from `createChannelFlow` to `defineChannelFlow` (FIX-1386).
- 33c8d10: New `hireWorkforce`: turn worker records into one configured flow copy each, with a worker's instructions handed to its flow as an `instructions` setting (FIX-1325).
- 23bc757: Each worker on a roster now holds its own skills, seeded from its own org, team and worker folders instead of one shared bucket — a catalog already seeded under the shared key is re-seeded under the worker's own and its old rows are left behind (FIX-1362).
- 2f74e07: Removed the Agent factory — `defineAgent`, `createAgentRegistry`, `materializeAgent`, `agentBlock`, `AgentCapabilityError` and `AGENT_CAPABILITY_UNRESOLVED` are no longer exported, so declare a worker as a `WORKER.md` record and hire it with `hireWorkforce`, and supply your own `agentRegistry`/`materializeAgent` to `createSkillsLibrary` for any skill that staffs a seat with `agent-ref` (FIX-1344).
- 70f787e: Hiring now hands every worker seat the same settings — its instructions and the skills its folders declared, plus a reserved `teamInstructions` key nothing populates yet — so a custom worker kind must accept them by composing the new `workerConfigSchema()` into its `configSchema`, or it refuses the whole roster at startup (FIX-1367).
- f9a3626: Ship a built-in worker kind, so a worker file that names no `flow:` hires instead of being refused (FIX-1363).

  `defineAgentWorkerFlow()` called with no arguments is that built-in; the same call with a tool catalog, skills or a default model builds the flow you register under `agent` to replace it for every seat. Its settings are `instructions`, `model`, `tools` and a switch for up-front skill matching (off by default). Tool names are resolved against the catalog your app supplies and refused at the hire, by name, when it carries no such key.

  Two behaviour changes on `hireWorkforce`: `kinds` is now optional, and a record with no `flow:` resolves to the built-in rather than refusing. A `flow:` that is present but empty or whitespace-only still refuses — only an absent key means the default — and every other refusal stands unchanged, with the unknown-kind message now listing `agent` among the kinds available.

- af6d6b9: A name anywhere in a workforce tree — team, worker, channel, document, kind or block — may no longer be one Windows reserves for a device (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`), since a tree holding one cannot be checked out on Windows whatever the extension (FIX-1357).
- d46fb72: The `./loader` subpath publishes the walk every workforce-tree reader shares — `openRoot`, `walkTeams`, `classify`, `openStructuralDirectory`, `refusedSymlink`, `unreadable` and `IGNORED_ENTRIES` — so a new convention calls the walk instead of copying it (FIX-1389).

  Two changes existing code can trip over:

  - **A symlinked workforce root is now refused by every reader.** `readWorkforceDirectory` and `readSeatSkills` followed the link and loaded the tree behind it; they now throw `Symlinked workforce directory "<root>" — refused for safety`, which `readChannelsDirectory` and `readResourcesDirectory` already did and all four readers' docs already promised. The refusal holds with a trailing separator or without, and in the published `classify` and `openStructuralDirectory` primitives as much as in the four readers. It does not reach a root named through a `.` segment, and nothing above the root is checked, so a path that passes through a symlink on its way in still reads. If you point a root at a symlink deliberately, pass the path it resolves to instead.
  - **Every `readWorkforceDirectory` failure now carries a `kind`.** `ReadWorkforceDirectoryResult["errors"]` entries gain a required tag — `unreadable-slot`, `worker-load-failed` or `refused-declaration` — matching the other three readers, so a caller can tell the conditions apart without matching on `error.message`. Reading `errors` is unaffected; constructing the type (a mock, a fixture) now needs the tag.

### Patch Changes

- cee0c62: `defineAgentWorkerFlow` accepts three new optional options — `uses` for capabilities every worker carries, `afterAnswer` for a block that runs after the answer, and `isolateUserState` to give each worker its own storage — so an app can compose memory or any other capability into the built-in worker kind (FIX-1364).
- 8270f00: Add channels: a built-in `channel` flow kind, plus `channelInstances` and `openChannels` to register it and open one named session per channel record (FIX-1311).
- efd4981: Channels can be declared in files: `readChannelsDirectory(root)` on the `@flow-state-dev/workforce/loader` subpath reads each `teams/<id>/channels/<name>/CHANNEL.md` into a `ChannelManifest` that `channelInstances` and `openChannels` already take, collecting per-path failures instead of throwing (FIX-1352).
- d195a90: When `readWorkforceDirectory` reports a worker folder that holds no `WORKER.md`, the error names the route for a worker whose behavior differs: define the flow in your app, pass it to `hireWorkforce` in `kinds`, and name it in that worker's `flow:` (FIX-1342).
- 2b728c2: Custom flow kinds and blocks now register from the file tree: `fsdev gen` walks `workforce/flows/workers/`, `workforce/flows/channels/` and `workforce/blocks/` and writes a committed module exporting the `kinds`, `channelKinds` and `blocks` maps that `hireWorkforce`, `channelInstances` and a task board already take, so adding one no longer needs a startup line (FIX-1357).
- bbecd2d: Read a worker's own `resources/` folder as a third document root (FIX-1368).

  `readResourcesDirectory` now walks `workers/<name>/resources/` under both `org/` and every team,
  alongside the org and team roots it already read. A document there is addressed by the folders above
  it — `teams/<teamId>/workers/<worker>/<name>`, or `workers/<worker>/<name>` for an organization-level
  worker — so two seats can each have a `runbook` without their authors agreeing on a name.

  The org and team roots are unchanged: same documents, same order, same errors. A worker folder's
  documents load whether or not the folder holds a `WORKER.md`, and a `workers/` level or worker folder
  that is symlinked or unreadable is reported under its own path with the existing `unreadable-slot`
  kind. No new error kind.

  A worker's folder is a namespace, not a visibility boundary. To give one seat a document of its own,
  put `flowIsolation: true` in that document's frontmatter: each seat then gets its own rows, and a
  sibling seat asking for the same document reads its own empty copy.

- 119936d: New `@flow-state-dev/workforce/loader` subpath: `readWorkforceDirectory(root)` scans `teams/<id>/workers/<name>/` and returns one neutral manifest per worker, so a workforce can be declared in files instead of wired by hand (FIX-1335). `orchestration` gains `splitFrontmatter` and `parseFrontmatterYaml`, the frontmatter dialect `SKILL.md` and `WORKER.md` share; parsed frontmatter records now have no prototype, so a `__proto__:` key in a hand-written file is carried as an ordinary key instead of silently replacing the record's prototype.
- 7986a48: Documents can be declared in files: `readResourcesDirectory(root)` on the `@flow-state-dev/workforce/loader` subpath reads `org/resources/<name>.md` and `teams/<id>/resources/<name>.md` into one record each, and `resourcesFromDocs(documents)` turns those records into the resource map you spread into `defineFlow({ resources })` (FIX-1354). A resource is a file rather than a folder, and where the file sits decides the document's scope and ref — so `scope`, `ref`, `stateSchema`, `default`, the content sources and a lazy `prefetchMode` are refused by name in frontmatter rather than quietly ignored.
- 8a1173a: New `readSeatSkills(root, { team, worker })` on `@flow-state-dev/workforce/loader`: reads the skills one seat can see — the org's, its own team's, and any sitting beside the worker, which are included without being listed — and returns the same `InitialSkill[]` `initialSkills` takes. A name reaching one seat from more than one of those levels is refused, and its error entry carries every colliding path in `paths`; two teams may each carry the same name. Anything that should have reached the seat and did not lands in `errors`, each entry tagged with a `kind` naming which condition it is, so a caller can tolerate one class and refuse another without reading the message text (FIX-1356).
- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
- Updated dependencies [23bc757]
- Updated dependencies [64b323e]
- Updated dependencies [119936d]
- Updated dependencies [c25ad3e]
- Updated dependencies [8a1173a]
- Updated dependencies [23ac6de]
  - @flow-state-dev/core@0.1.1
  - @flow-state-dev/orchestration@0.2.0

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

### Patch Changes

- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [bea3a24]
- Updated dependencies [b484d86]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [0443742]
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [229da65]
- Updated dependencies [2c4b0f5]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0
  - @flow-state-dev/orchestration@0.1.0

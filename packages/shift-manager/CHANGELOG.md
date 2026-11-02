# @flow-state-dev/shift-manager

## 0.1.1

### Patch Changes

- 9a355b2: `@flow-state-dev/react` exports `useInterruptKeys`, `createInterruptKeys` and `interruptChordLabel`, a keyboard stop for long-running work. One Esc never stops anything. A second Esc within 1.5 s does, and so does Cmd/Ctrl+. at once. An Esc typed in a text field, or one already used to close a dialog, never counts (FIX-2413).

  `@flow-state-dev/engine`: the request status route's `completedAtMs` is now set for aborted and failed requests, from the time they stopped. It was set only for requests that completed. A replayed or resumed stream's terminal event for an aborted request is now dated when the request was aborted, not when its record was last written.

  `@flow-state-dev/shift-manager`: one Esc on a task no longer interrupts its run. Press Esc twice or Cmd/Ctrl+. instead. Esc in the composer is the composer's. An interrupted run now says when it stopped.

- Updated dependencies [70f09b5]
- Updated dependencies [cc0ab62]
  - @flow-state-dev/devtool@0.3.1
  - @flow-state-dev/fsdev@0.4.0

## 0.1.0

### Minor Changes

- 849f6ec: Built-in model defaults move to the current generation (FIX-2050). `utility.sessionTitleGenerator`, `utility.decomposer`, the `planAndExecute` / `routedSpecialists` pattern defaults and `workingMemoryObserve` now default to `gpt-6-luna`, as do Shift Manager's Lab default model (`LAB_DEFAULT_MODEL`) and its DevTeam workers (previously `gpt-5-nano`, `gpt-5.4-mini`, `gpt-5-mini` or `gpt-4o-mini`). Pass `model` explicitly to keep the old one. The cost tables in `core` and `testing` now price `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna` and Claude Opus, Sonnet and Haiku 5.5.
- d1a4cab: Shift Manager says worker where it said seat, in its screens and the DevTeam lab (FIX-1796).
- 3d6f5b8: Shift Manager's coordinator worker is now `shift-coordinator`, not `chief-of-staff`. Rename the folder `org/workers/chief-of-staff/` to `org/workers/shift-coordinator/` (or `teams/<team>/workers/chief-of-staff/` to `…/shift-coordinator/`). A Lab that still declares `chief-of-staff` has no Shift Coordinator: Shift Manager shows the line that says how to add one. The view's address is `/shift-coordinator` (it was `/cos`; an unknown path still opens the view), and its test ids start with `shift-coordinator-` instead of `cos-` (FIX-2244).
- 6c65b15: The DevTeam's coder takes a conversation's task: ask your Shift Coordinator to have the coder look at a project's repository, and it files a task for `eng.coder` naming the project (`input.project`, `{ visibility, id }`). The coder works it in its own checkout of that project's repository (or on its files when it has none), and its answer lands in the conversation under its name. A task naming no project, or one you aren't a member of, fails at once saying why; a run that fails, or whose answer Jev judges as missing the goal, gets one more attempt and then fails with the reason. A question from the coder lands as a line, and your answer goes back into the same run. Feature work from the EM's board runs as before (FIX-1866).
- 9590119: The Shift Coordinator is a coordinator: the DevTeam's Shift Coordinator runs on the `coordinator` flow, routing by judgment, and hands work to its delegates. Its panel lists the conversation's delegates, adds one from your roster and removes one; a delegate's answer appears under the delegate's name, each routing decision as a quiet note beside the lines, and the Shift Coordinator comes first on Roster (FIX-1791).
- 2b3fd17: The DevTeam profile's Storefront opens two workstreams, `feature` and `release`, led by the EM, which files the coder's tasks on the board of the workstream it leads (FIX-1792). PROJECTS lists workstreams under a project, and a person reads the organization's workers through their roster session.
- b2f2d4c: A project's Stream is now your own project coordinator, and its Workstreams tab lists every workstream with the project's progress. You open a workstream by asking your project coordinator for the work: it picks the lead from your workers, such as the DevTeam's engineering manager, and hands your ask to it. The Workstreams tab has no form for opening one, and the DevTeam profile has no workstream coordinator worker. The Tasks view groups a workstream's tasks under the workstream, so one worker leading two workstreams shows as two groups (FIX-1793).
- fc2826f: Shift Manager has three themes, Day, Evening and Night, instead of light and dark: the mark in the sidebar changes the theme, `--shift` also takes `evening`, and with no pick the page opens on the theme the clock calls for (FIX-1800).
- 5d4306a: Roster lists the signed-in person's own workers beside the Lab's standard ones, read through Workforce's roster flow, and the Shift Coordinator's conversation is a session of its flow that names the worker. A Lab registers the flows `hireWorkforce(installation)` returns (FIX-1788).

### Patch Changes

- 24afa6e: A question is one kind of task hold (FIX-2317, FIX-2131, FIX-2133). The two ways to stop for the user are named for what stops, and a task's open stops live in one list.

  - **`suspendForUser`** (new) suspends the request and resumes it with the answer: `ctx.suspendForUser({ kind, prompt, deadline? })` in `core`, `suspendForUserOn`, `createSuspendForUserTool`, `SuspendForUser`, `SuspendForUserOptions`, `SuspendForUserContext`, `SuspendForUserCancelled`, and `SuspendForUserKind` / `suspendForUserKindOf` (`contracts`, re-exported by `core`). `kind` is `"approval"`, `"review"` or `"input"`.
  - **`holdTaskForUser({ question })`** holds the task until the user answers, built with `createHoldTaskForUser`. The turn ends; the next turn on the same attempt spends no retry.
  - **`Task.holds`** lists what stops the task being claimed until the user answers. There is no `kind` field on a hold: an entry is told apart by `source.kind` (`"row"` or `"suspension"`) and `ask.kind` (`question`, `confirm`, `approval`, `review`, `input`). `getTask`, `listTasks` and Inbox items list `holds`.

  `createTask({ questions })` files a task that stays `pending` until each question is answered: a plain string is a question, `{ kind: "confirm", prompt, onNo? }` asks for a yes or a no. Answer with `updateTask({ id, answers, message })`. The Inbox client's `answerOne` takes `questionId`. A deadline applies only when the host sets `userDeadlineMs`.

  **Breaking, from the last publish.** The `parked` status is gone, with `counts.parked`, `TaskCollectionRef.awaitReview` / `unpark`, `board.unparkAndDrain`, a board's `onReview`, and `@flow-state-dev/react`'s `BOARD_STATUS_COLUMNS` `parked` column. Ask for a review with `ctx.suspendForUser({ kind: "review", prompt })`. The filer's hold is unchanged: status `held`, `hold()`, `release()`. `keptOpenBy: "suspended"` means the task's own request is suspended. Stores are reset: a stored `parked` row is not read. Also removed with `parked`: `TaskTransitionOptions.refuseWhenParked`, `CheckBoardOptions.excuseParked`, the `"parked-for-review"` termination reason, the `"review_requested"` change kind, the `"parked"` write-decline reason, `unparkAndDrainInputSchema` / `UnparkAndDrainInput`, and the task-board exports `TaskBoardOnReview` and `assertParkExitSupported`. React no longer maps a legacy `awaiting_review` card status. `TaskClaimTicket.turn` is required: every claim advances the row's `turn`, and a ticket from an earlier turn of the same attempt is declined `lost-claim`.

  A row stored with `questions` still reads as `holds` (`withRetiredShapes` from `@flow-state-dev/orchestration/tasks`). Shift Manager and the DevTool read them as holds.

- 43649da: `defineProjectBlocks()` adds `listProjects`: the projects the caller is a member of, each with its address, title and repository. A shared project the caller isn't a member of is left out. The DevTeam Shift Coordinator has it as a tool, with a `forCoding` line saying what a coder's task that names no project does next, so asked to have the coder look at "our repo" it files the task for the one project with a repository without asking, and with two or more asks which one, naming them (FIX-1869).
- 16a8dab: See how much of Claude Code's subscription is used. Core's `HarnessUsageWindow` gains `level` (`ok`, `warning`, `reached`, or `null`) and its `usedPercent` may be `null` when a harness sends no percent; core adds `HarnessUsageHook` and `HarnessUsageReport`, the run-time twin of `HarnessSessionHook`. `claudeCodeAgent` takes `onUsage` and hands it each window a run's `rate_limit_event` reports, with the run's account; `readClaudeUsage` reads who is signed in for the usage query, and `probeClaudeAccount` takes a `signal` that stops and closes the probe, and marks a `none` it got no answer for with `unanswered: true`. `@flow-state-dev/harness-manager` feeds `onUsage` at both of its harness slots (`HarnessFeeds.onUsage`, now required, so code that builds `HarnessFeeds` itself must add it), writing into the run owner's usage record, and keeps a stored record's account and windows together across a sign-in change. Codex windows now carry `level: null`. Shift Manager's Usage view shows Claude Code's windows, saying "limit reached" or "under Claude Code's warning line" where there is no percent (FIX-2142).
- 5329a47: A coding run's tool calls read the same on Claude Code, Codex and Cursor: `Bash`, `command_execution` and `shell` are all "ran a command", `Edit`, `edit` and Codex's `file_change` are all "edited a file", and `Grep` is "searched the code", where some showed as the tool's bare name before (FIX-2343).
- 9b4e7b1: `defineCoordinatorFlow` now honours `agent.isolateUserState`: the coordinator flow keys its user-scoped storage by its copy when the judgment turn asks, as the `agent` flow does. Before, the option was accepted and ignored (FIX-1776).

  Shift Manager's DevTeam Shift Coordinator carries the standard memory set (working memory, the rolling digest, `memory/recall`), read-side only unless `DEVTEAM_MEMORY_CAPTURE=1`. It says when it has no memory of something rather than inventing one.

- a6fe11a: The Shift Coordinator's TASKS panel lists only active tasks. Done tasks fold into a closed count and errored ones into their own closed group, each opening to its tasks. A workstream's Board still lists every task (FIX-1962).
- 7c6196c: DevTeam's `openLab` and its `coder` worker flow take `stopsOnAbort`. With it on, a line typed into a running coding task stops the run and the same request continues its coding session with the line, using no attempt; off, the line waits for the run's own end. Absent, the harness decides: Claude Code stops, the scripted stub doesn't (FIX-2293, FIX-2312).
- d48b16c: A task a conversation files shows in its feed as one card (title, worker, status, Open) instead of the conversation's whole task list, and the card follows the task's real status as it runs, fails, or finishes (FIX-2006).
- fa33814: Shift Manager now lists, adds, edits and deletes a worker's standing rules for the signed-in user, from a Rules view on its Roster row and a RULES section in the Shift Coordinator's panel (FIX-1945).
- 250bc9e: A worker's standing rules now live on its settings page (`/roster/<workerId>/settings`), opened from a Settings button on every Roster row and, for the Shift Coordinator, from a gear in its header. The Shift Coordinator's right panel no longer lists RULES. `/roster/<workerId>/rules` still opens the same page (FIX-2007).
- e71ea1a: The DevTeam and `fsd` Labs now ship a default model, so a worker that names no `model:` answers instead of failing every turn, and an `intent/<name>` with no model to fall back to fails with a setup error that names where to set one (FIX-2008).
- e71ea1a: A message sent from a task's composer, and the worker's reply to it, now show in that task's Session tab, including when the worker keeps one session for several tasks (FIX-2009).
- 08a9b05: See how much of each coding harness's subscription is used. Core adds the neutral usage window and the on-demand reader signature (`HarnessUsageWindow`, `HarnessUsageReading`, `HarnessUsageReader`). `@flow-state-dev/codex` adds `readCodexUsage`, which asks the Codex CLI's app-server for every window's percent used and reset time with no run (local only), and exports `findCodexProgram`. `@flow-state-dev/harness-manager` adds the per-person `harness-usage/**` record and `harnessUsageAction({ readers })`, the one query that returns each window with its age and whether it has rolled over, refreshing a reader at most once a minute. Shift Manager shows it on a new Usage view (FIX-2141).
- 008c63e: New content never scrolls a conversation, even when the reader is at the end; a jump-to-latest arrow appears instead. A conversation still opens at its end with no scroll animation: on mount, on a switch to another session, and when its first read fills it. Sending your own line takes you to the end. `@flow-state-dev/react` exports the rule as `useJumpToLatest({ resetKey?, startAtEnd? })`, returning `{ ref, atEnd, jump, sent }`. The DevTool's stream view and Shift Manager's conversations use it (FIX-2346, FIX-2360).
- ffeee8d: Workers send messages with `sendMessage({ to, text, inReplyTo?, replyRequested?, wait?, deadline? })` (FIX-2318, FIX-2238, FIX-2310). A send that asks for a reply (`replyRequested: true`) goes on; the one answer comes back as a message. A send that waits (`wait: true`) asks the same way and waits in this turn: an answer before the deadline is the tool's result, `{ status: "answered", sent, reply, noAnswer? }`, and does not also land as a message; at the deadline the tool answers `{ status: "running", sent, recipient? }` and the answer arrives later as a message. The result key is `sent`. A waited send to a worker that runs no turn on messages answers `{ status: "answered", noAnswer: true }` when the sender cannot tell up front, or is refused `no_reply` when it can. An answer whose sender still waits cannot itself ask for a reply (`reply_to_waiting`). `to` and `text` are required.

  Shift Manager draws a reply request in Messages as _reply · waiting_, _reply · waiting on the user_, _reply · answered_ or _reply · answered late_, and marks a received message that asks for a reply.

- 0d6278e: Each worker's token usage is recorded per person and day, with harness runs reporting their spend through `reportHarnessSpend`, read through the `workerUsage` query, and shown on Shift Manager's Usage view (FIX-2145).
- fc93035: A project's Workstreams and Board tabs read the project again every few seconds while they're on screen, so a workstream the Shift Coordinator or a project coordinator opens shows up without a reload (FIX-1922).
- 6a3ecf5: `@flow-state-dev/client` exports `readEveryCollectionPage`, one collection read with a single 1,000-page ceiling that fails when the server repeats a cursor, and the workforce panels, the DevTool Inventory tab, the Shift Manager and the workforce roster read now use it, so a repeated cursor ends a read with an error instead of 1,000 wasted page reads, a partial list shown as whole, or a read that never stops (FIX-1674).
- dd2563b: A conversation board now shows a browser the question a task waits on (`Task.holds`). Shift Manager's shift summary lists tasks held on a question for the user under Needs you, and its DevTeam chief of staff answers from what a finished task found (FIX-1972).
- eb831f8: A schedule in the user's schedule collection files an ordinary task on the named worker's board each time it is due, through the roster flow's new `saveSchedule`, `deleteSchedule` and `listSchedules`, and Shift Manager lists them on a Scheduled work screen (FIX-2085).
- c4150e7: A person's message on a finished task reopens it: task collections gain `reopen(id)`, the harness manager's door reopens a finished run when its board names `reopenIn`, a worker's reply in a finished task's session on a Workforce conversation board reopens that task, and Shift Manager's task composer takes a message on a finished task (FIX-1764).
- fa7b22e: A tool call that waited on an approval no longer reads as failed. A later turn's history replays it once, with its result; before, it also replayed the wait as a failed call carrying the approval's question, so the model read it as a failure it had retried. `isSuspensionWait(item)` (from `@flow-state-dev/contracts/items`, re-exported by `@flow-state-dev/core/items`) tells such a wait from a real failure, and the registry's tool card draws it as awaiting approval. Shift Manager draws a waiting call as waiting, and a conversation redraws once its ask is answered on the page, again when the run it resumed stops (FIX-1901).
- 07bf0e1: Shift Manager names the `chief-of-staff` worker the Shift Coordinator wherever it shows a worker: Roster, the on-call list, Jump to, Inbox, ask lines, Tasks and the task view, delegates and routing notes. The old docs address `/docs/workforce/chief-of-staff` redirects to the new page. The DevTeam's coordinator introduces itself as the Shift Coordinator. The worker's id is still `chief-of-staff` (FIX-1960).
- e112ab3: Shift Manager now shows tasks filed on a person's conversation boards beside workstream boards, in Roster, Tasks, the task screen and its run session (FIX-1792).
- 70c8651: A conversation that holds only state or resource changes, such as the Shift Coordinator's once its standing rules are read, now says nobody has talked with the worker yet instead of drawing an empty list, and the project caret under PROJECTS is drawn at design v2's 11px in a 12px box (FIX-2000).
- f146db2: Shift Manager drops On Call. A worker is on shift or off shift: one running a task, or waiting on you with a parked task or a pending ask, is on shift. Roster's last column is WAITING ON YOU, and the on-call counts, the Shift Coordinator's ON CALL list and its "Who's on call?" suggestion are gone. The DevTeam Lab no longer has an `ops.oncall` worker (FIX-1964).
- 195eaf4: Inbox shows the asks the signed-in person's own workers are waiting on them for, and those workers read as on shift on Roster and in TEAMS. The snapshot reader reads the person's roster before it reads asks (FIX-1830).
- 9cc903f: Shift Manager is published: install `@flow-state-dev/shift-manager` and run `shift-manager --config ./fsdev.config.mts` to open a Workforce Lab in the browser on `fsdev dev --app`, with `--dev` to restart the Lab and reload the page on a save, and `--team`, `--devtool` and `--devtool-assets` removed in favor of `--config` (FIX-1770).
- fd21824: The sidebar's TEAMS lists the signed-in person's own workers beside the Lab's standard ones, read from their roster as Roster reads it, and its on-shift counts include them (FIX-1741).
- 8b339b2: Shift Manager's sidebar nests each project's workstreams beneath it again. The project on screen shows them, the arrow beside any project shows or hides them, and a click opens the workstream's own view. A workstream opened elsewhere appears without a reload. Only a shown project's workstreams are read, by that project's one prefix (FIX-1961).
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

- 91b6b61: A conversation whose session exists but holds nothing yet, such as a project's Stream on its first visit, now shows its empty-state line instead of a blank panel (FIX-1893).
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

- e3a24a3: A project's Workstreams tab counts each workstream's objectives met on its row, and your own workstream opens with its objectives, each marked met or not, above the conversation with its lead (FIX-1921).
- Updated dependencies [24afa6e]
- Updated dependencies [b75c1ed]
- Updated dependencies [9490722]
- Updated dependencies [a3bfbc2]
- Updated dependencies [f6461ea]
- Updated dependencies [f469423]
- Updated dependencies [2c213b4]
- Updated dependencies [ad5df6f]
- Updated dependencies [211679a]
- Updated dependencies [04ff39d]
- Updated dependencies [bb1c224]
- Updated dependencies [204860e]
- Updated dependencies [7f892f6]
- Updated dependencies [9cc903f]
- Updated dependencies [83c48a7]
- Updated dependencies [a600325]
- Updated dependencies [e9f9316]
- Updated dependencies [82ec64e]
- Updated dependencies [7da156e]
- Updated dependencies [008c63e]
- Updated dependencies [6a3ecf5]
- Updated dependencies [02ee032]
- Updated dependencies [65ddb90]
- Updated dependencies [d1a4cab]
- Updated dependencies [2ab7ea2]
- Updated dependencies [97894aa]
- Updated dependencies [cd180d7]
- Updated dependencies [912ae98]
- Updated dependencies [7052203]
- Updated dependencies [49d2aca]
  - @flow-state-dev/devtool@0.3.0
  - @flow-state-dev/fsdev@0.3.0

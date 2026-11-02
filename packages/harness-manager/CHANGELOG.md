# @flow-state-dev/harness-manager

## 0.4.0

### Minor Changes

- cc0ab62: Choose where a coding session starts, and remove what it left on disk (FIX-2419).

  - `@flow-state-dev/workspace`: a `baseRef` naming a pinned remote's branch (`origin/main`) in a listed repository is fetched before the cut, and refused as `remote-unreadable` when the fetch fails. `PlaceRequest.existing` checks a branch out instead of cutting one, making it from the remote's when absent (`no-such-branch` when there is none). `localWorkspaceHost` gains `list()` and `remove(target, { deleteBranch?, force? })`, the one removal path, which refuses uncommitted work (`uncommitted-work`), a place mid-provision (`place-busy`) and, unless forced, deleting a branch that holds the only copy of a commit, or removing a detached HEAD that does (`unique-commits`). `pullRequestHead` resolves a same-repository pull request to its head branch. `occupyWorktree` holds a worktree in use (`<dir>.lock`), and `remove` refuses one a run holds (`in-use`); `checkedOutBranch` reads the branch a worktree is on.
  - `@flow-state-dev/harness-manager`: harness session state gains `start` (`{ base } | { branch } | { pullRequest } | { worktreeOf }`, fixed at create like `model`) and a server-owned `workspace` record. `HarnessSessionWorkspace.provision(place, { start })` may return `{ path, branch }`; the turn-end pull-request check reads the recorded branch. A `removeWorktree` action, refused while a turn runs, calls the workspace's optional `remove`. `resolveHarnessSessionStart` maps a start to a workspace host's request. `{ worktreeOf: sessionId }` attaches a session to another session's worktree and branch: refused at create (404) when that worktree isn't there in the caller's tenant and at its turn when it isn't in the user's own list of worktrees, each turn holds the same in-use lock as the owner's, only the owner may `removeWorktree`, and an attached turn that leaves the worktree on another branch is recorded as failed. The workspace record carries `owner`.
  - `@flow-state-dev/fsdev`: `fsdev worktrees <root>` lists a workspace host's worktrees and removes one with `--remove`.

- cc0ab62: A coding run now says where its work went (FIX-2386). A harness session's `state.workspace` is `{ worktree }`, the key of its worktree's row in the user's `worktrees` list, which owns the path, branch, base, commit count and state; the copies of the path, branch and owner it held before are gone, and a stored record with them reads as `{ worktree: null }` until its next turn. `HarnessSessionProvisioned` no longer takes `branch`. A task's output gains `baseCommit`, `path` and `commitsVerified`. `workPlace` reads a task's output or a worktree row and returns the branch, the count, the worktree's name and state, whose it is for an attached session, and shell-quoted `git switch`, `cd` and `git log baseCommit..branch` commands. The UI registry gains a `work-place` component that draws them.
- cc0ab62: Add a shared list of worktrees (FIX-2439).

  - `@flow-state-dev/workspace`: `worktreesCollection` is a user-scoped, `llmReadable` collection with one row per worktree a host made. A row holds `name`, `path`, `branch`, `repo`, `baseCommit`, `owner`, `attached`, `state`, `commits`, `lastTurnAt` and `pullRequests`. To have the host write rows, give it the collection: `PlaceRequest.worktrees` writes `provisioning`, then `ready`; the new `host.attach` adds a session or run to `attached` (`{ kind, id, lastTurnAt }`); the new `host.recordCheckout` writes the branch and commit count together at a turn's end and returns what it read; and `RemoveOptions.worktrees` marks the row `removed`. `recordBranchPullRequests` takes `worktree: { collection, key }`. `WorkspacePlace.worktree` is the row's key.
  - `@flow-state-dev/harness-manager`: the session flow declares the collection and passes it to `HarnessSessionWorkspace`: on `provision` and `remove`, and on the new optional `attach` and `recordCheckout`. It stores the row's key as `state.workspace.worktree`, and marks `worktrees` read-only to the model's resource tools. The board manager writes a row for each run's checkout.

### Patch Changes

- 1fb64c9: `harnessManager({ approveTools: true })` makes a run's tool call that isn't pre-allowed wait for a person's approval as the task's hold, then resumes the same coding session on Allow, Allow for this run, or Deny; claude-code's `onToolApproval` gains a `held` decision, and react's `useApproval` gains `approveWith`, `rejectWith` and `approveOptionsOf` (FIX-2389).
- Updated dependencies [824ce87]
- Updated dependencies [8be6d45]
- Updated dependencies [cc0ab62]
- Updated dependencies [387bee2]
- Updated dependencies [3aced5b]
- Updated dependencies [cc0ab62]
  - @flow-state-dev/core@0.4.0
  - @flow-state-dev/orchestration@0.5.0
  - @flow-state-dev/workspace@0.3.0

## 0.3.0

### Minor Changes

- 78312a3: A coding run's question now holds its task on the board, where the Inbox lists it, and the answer continues the same coding session on the same attempt: an answer spends no retry (FIX-2132). The run's own question, the judge's _ask_ and held work that doesn't match its record all ask this way. Answer through the board's `updateTask({ id, answers, message })`, or with a line typed in the run's session; a cancel closes the question and starts nothing.

  **Migration.** The manager's question inbox is removed: `askQuestion`, `answerQuestion`, `listQuestions`, `readQuestion`, `withdrawQuestion`, `inboxCollection`, `INBOX`, `questionTopic`, `questionFingerprint`, `parseQuestionTopic`, and the `QuestionAnnouncement` type. `harnessManager({ announce })` is refused at construction; read held tasks from the board (`openRowHolds` on its rows). `PromptRunContext.answers` is the task's answered questions, oldest first, read from its row. `run.askMarkerPath` is now `.fsdev/ask/<attempt>-<run>.md`, a new path for every run; `askMarkerPath` and `readAskMarker` take the run as a third argument. A phase that hard-codes the old `<attempt>.md` path must use the path it is handed.

- e2c190e: A running coding turn can take a message mid-turn (FIX-2254). Core declares the optional harness hook `onSteerable(steer | null, ctx)` (`HarnessSteer`, `HarnessSteerHook`): a harness whose run can take a line calls it with a `steer` that answers `"delivered"` or `"refused"`, and with `null` when the turn is over. `cursorAgent({ onSteerable })` offers Cursor's own run steering on local runs, through the `env` process too. The harness manager hands down `onSteerable` as an optional fifth feed; passed through, a message sent to the task while a step runs goes straight into that step, with no stop, extra step or new attempt. A line the run refuses is taken by the next step, as before.

  `autoResume: false` on an action (core's `ActionCore`, honoured by the engine) keeps a request on it from becoming its session's auto-resume target (`latestRequestId`), so a control sent beside a running request, such as that line, doesn't stop a reloading client from reattaching to the running one.

  Any app can steer a harness turn run in a session: `harnessSteering()` in core keeps each session's offer and builds the `steer` action (`{ taken, live }`), and the client's `sendHarnessLine` and `steerRunningTurn` send a typed line into the running turn, falling back to the next turn when it isn't taken.

- 0d55d46: A session keeps a record of the pull requests it opened (FIX-2268). Core adds the `observed-pull-requests` collection (`observedPullRequestsCollection`), one writer (`writePullRequests`), a replaceable GitHub rule (`githubPullRequestRule`, `DEFAULT_PULL_REQUEST_RULES`) and the recorder: `recordPullRequests(ctx)` for a block, and `pullRequestRecorder()` for a flow with no harness to add as a `.tap` step. A `gh pr create` command or a `create_pull_request` tool whose output holds the link is one row, written as the call settles. Each row carries the `requestId` that opened it.

  The Codex, Claude Code and Cursor blocks record by default; `recordPullRequests: false` turns it off. Workspace adds `recordBranchPullRequests`, a host-side check that asks GitHub through `gh` which pull requests a checkout's branch has. The harness manager declares the record and runs that check before its verdict and when a run fails.

  **Migration.** A Codex, Claude Code or Cursor block now declares the `observed-pull-requests` session collection by default. A test that asserts the block declares no resources must pass `recordPullRequests: false`.

- 2ffc03c: "Dispatcher" now names only the `dispatcher()` block (FIX-2245). Two other things that shared the word are renamed, with no alias.

  - A task board's rule for which ready task it claims next is a claim order. `TaskDispatcher` is `ClaimOrder`; `fifoDispatcher`, `topologicalDispatcher` and `priorityDispatcher` are `fifoClaimOrder`, `topologicalClaimOrder` and `priorityClaimOrder`; harness-manager's `runOwnerDispatcher()` is `runOwnerClaimOrder()`. The task board's option is `claimOrder` (it was `dispatcher`, which it now refuses by name), and takes the same `"fifo"`, `"topological"` and `"priority"` names.
  - What decides where a flow action runs is a runner. `FlowDispatcher` is `FlowRunner`, `InProcessDispatcher` and `InProcessDispatcherDeps` are `InProcessRunner` and `InProcessRunnerDeps`, `createInProcessDispatcher` and `isInProcessDispatcher` are `createInProcessRunner` and `isInProcessRunner`, and BullMQ's `createWorkerDispatcher` and `CreateWorkerDispatcherOptions` are `createWorkerRunner` and `CreateWorkerRunnerOptions`. The option on `createFlowState`, `createFlowApiRouter` and `createInboundTransportHost` is `runner` (it was `dispatcher`, which they now refuse by name), `WorkerAdapter.createDispatcher` is `createRunner`, and `InboundTransportHost.usesExternalDispatcher` is `usesExternalRunner`.

  The `external-dispatcher` refusal keeps its value.

- 16a8dab: See how much of Claude Code's subscription is used. Core's `HarnessUsageWindow` gains `level` (`ok`, `warning`, `reached`, or `null`) and its `usedPercent` may be `null` when a harness sends no percent; core adds `HarnessUsageHook` and `HarnessUsageReport`, the run-time twin of `HarnessSessionHook`. `claudeCodeAgent` takes `onUsage` and hands it each window a run's `rate_limit_event` reports, with the run's account; `readClaudeUsage` reads who is signed in for the usage query, and `probeClaudeAccount` takes a `signal` that stops and closes the probe, and marks a `none` it got no answer for with `unanswered: true`. `@flow-state-dev/harness-manager` feeds `onUsage` at both of its harness slots (`HarnessFeeds.onUsage`, now required, so code that builds `HarnessFeeds` itself must add it), writing into the run owner's usage record, and keeps a stored record's account and windows together across a sign-in change. Codex windows now carry `level: null`. Shift Manager's Usage view shows Claude Code's windows, saying "limit reached" or "under Claude Code's warning line" where there is no percent (FIX-2142).
- 3ec9bca: On a board read from the claim, feature work is now named only under `HARNESS_FEATURE_KEY` (`"harnessFeature"`): `input: { harnessFeature: { issue, phase } }`. The rest of a task's `input` is the filer's own, so a task whose fields include a plain `issue` (a model's word for "the problem") runs as an ordinary task instead of being refused as half a feature payload (FIX-2282). `namesHarnessFeature(input)` and `harnessFeatureOf(input)` read the key the way the manager does.

  **Migration.** A flow that files feature work on a conversation's board must move `{ issue, phase }` under `harnessFeature`; a task carrying them at the top of `input` now runs as the manager's phase with its task id standing in for the issue. Fixed boards are unchanged: their rows carry `{ issue, phase }` at the top of `input`, as before.

- 4a3b026: FIX-2157: add `goalJudge`, a ready-made judge for the manager's `judge` option. An evaluation model reads a run's answer and commits against its task's goal and answers done, not done (with why), or a question for the person.
- ac632a0: On a workspace host with a held-work store, the manager now holds a run's repository work at the end of each turn, when it stops for a person, and when the harness fails, and brings it back on another machine (FIX-1766). The run record gains `place` (`{ host, state }`) and `held` (the last hold, or why it failed); both stay `null` with holding off. A run whose held work does not match its record, or lands on a host with holding off, holds its task for its owner with a question naming what disagreed, instead of starting over. A run is not completed on work it could not hold.
- 3b3171a: A phase's `buildPrompt` now receives `run.task`: the claimed row's goal, plus its title, context, input, dependency outputs and selected prior work when present. `PromptRunContext.task` is a required field, so code that builds a `PromptRunContext` by hand (a test fixture, say) must now supply it. Prompt builders that only read `run.issue` keep working unchanged (FIX-1717).
- a965a50: `harnessManager({ reviewChanges: true })` has a user review a run's commits before its task completes. A run that would complete with commits on its branch holds the task on a review (`ask.kind: "review"`) that lists the commits and the judge's verdict. The user accepts, or asks for changes in words, which one more run on the same attempt takes as a steer in the same coding session. The answer is checked against the exported `harnessReviewAnswerSchema` (type `HarnessReviewAnswer`). The manager's output gains `review: "accepted" | "deadline" | null`; `"deadline"` means the host's `userDeadlineMs` passed with no answer, not an approval. Needs a host with durable execution: without it, a manager with `reviewChanges` on cancels the task before any harness step. Off by default (FIX-2163).
- ba74f01: `harnessManager({ workspace })` accepts a workspace host from `@flow-state-dev/workspace` as well as a fixed `{ root, sourceRepo, baseRef }`, and provisions every run through the host either way. A run keeps the repository and base it started on (recorded on its run record) when its source later changes, and a run that started with no repository stays on its kept files. Its kept files are saved at the end of each turn, when it asks a question, and when the harness fails, and a run is not completed while its last save failed. A run its workspace refuses (the source answers `refused`, or the host won't provision the remote) is cancelled on its first attempt instead of being retried, and `HarnessRunRefused` is exported. `localWorkspaceHost` gains `localRepositories`, for a repository on the machine that runs are cut from directly, with no clone and no fetch, and a place request can name a directory the checkout's repository must keep out of git, which a run with no repository also leaves out of its saved files. A provision's `provisionTimeoutMs` now covers its waits for other provisions of the same place or clone, and `save` refuses a place handle that a later provision of the same place has replaced. `run`, `GIT_TIMEOUT_MS` and `CHECKOUT_CLEANUP_TIMEOUT_MS` from `@flow-state-dev/harness-manager/checkout` are now re-exported from `@flow-state-dev/workspace` (FIX-1762).
- 350e0e3: New: `harnessSessionFlow`, a coding harness as one long-lived session a person talks to. Each turn continues the conversation the harness last confirmed, a session is created with the model it runs, a `steer` action hands a line to the running turn, and each turn is recorded in `harnessSessionStateSchema`. The host says where sessions work (`workspace`) and builds the harness block from the feeds (`agent`). Also new: `harnessStub`, a scripted harness for the slot, for checks that run no model (FIX-2320).
- 90ed00b: A coding run's checkout folder and branch now include the organization the request was admitted under, so one person's runs in two organizations on one host no longer share a checkout or a branch; `RunPrincipal` requires `orgId`, and a run already under way keeps the branch its record names (FIX-1926).
- c4150e7: A person's message on a finished task reopens it: task collections gain `reopen(id)`, the harness manager's door reopens a finished run when its board names `reopenIn`, a worker's reply in a finished task's session on a Workforce conversation board reopens that task, and Shift Manager's task composer takes a message on a finished task (FIX-1764).
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

- 9edbfa2: A worker can now end its task on the current attempt without writing the ending itself: throw `TaskEndsForGoodError` (from `@flow-state-dev/orchestration/task-board`) naming the task it holds (`taskId`), and the board's error recorder ends that row under the worker's claim, `errored` with no retry by default or `cancelled` with `{ ending: "cancelled" }`. A marker naming any other row, such as one rethrown by a board nested inside the worker, is an ordinary failure.

  Harness Manager's refused run uses it: the manager no longer fails or cancels its own row, and the board records the ending. The outcome is unchanged (`errored` on a board read from the claim, `cancelled` on the fixed board). `HarnessRunRefused` now extends `TaskEndsForGoodError`, and its constructor takes a second argument, `{ taskId, ending }` (FIX-2090).

### Patch Changes

- 859f621: A coding run stops when its task is cancelled. The manager reads the task's row every `STEER_POLL_MS` while a step runs, and aborts the harness within that second once the task is cancelled, finished, or claimed again. Before, a cancelled run kept working until the lease's next renewal or the run's deadline (FIX-2349).
- 24afa6e: A question is one kind of task hold (FIX-2317, FIX-2131, FIX-2133). The two ways to stop for the user are named for what stops, and a task's open stops live in one list.

  - **`suspendForUser`** (new) suspends the request and resumes it with the answer: `ctx.suspendForUser({ kind, prompt, deadline? })` in `core`, `suspendForUserOn`, `createSuspendForUserTool`, `SuspendForUser`, `SuspendForUserOptions`, `SuspendForUserContext`, `SuspendForUserCancelled`, and `SuspendForUserKind` / `suspendForUserKindOf` (`contracts`, re-exported by `core`). `kind` is `"approval"`, `"review"` or `"input"`.
  - **`holdTaskForUser({ question })`** holds the task until the user answers, built with `createHoldTaskForUser`. The turn ends; the next turn on the same attempt spends no retry.
  - **`Task.holds`** lists what stops the task being claimed until the user answers. There is no `kind` field on a hold: an entry is told apart by `source.kind` (`"row"` or `"suspension"`) and `ask.kind` (`question`, `confirm`, `approval`, `review`, `input`). `getTask`, `listTasks` and Inbox items list `holds`.

  `createTask({ questions })` files a task that stays `pending` until each question is answered: a plain string is a question, `{ kind: "confirm", prompt, onNo? }` asks for a yes or a no. Answer with `updateTask({ id, answers, message })`. The Inbox client's `answerOne` takes `questionId`. A deadline applies only when the host sets `userDeadlineMs`.

  **Breaking, from the last publish.** The `parked` status is gone, with `counts.parked`, `TaskCollectionRef.awaitReview` / `unpark`, `board.unparkAndDrain`, a board's `onReview`, and `@flow-state-dev/react`'s `BOARD_STATUS_COLUMNS` `parked` column. Ask for a review with `ctx.suspendForUser({ kind: "review", prompt })`. The filer's hold is unchanged: status `held`, `hold()`, `release()`. `keptOpenBy: "suspended"` means the task's own request is suspended. Stores are reset: a stored `parked` row is not read. Also removed with `parked`: `TaskTransitionOptions.refuseWhenParked`, `CheckBoardOptions.excuseParked`, the `"parked-for-review"` termination reason, the `"review_requested"` change kind, the `"parked"` write-decline reason, `unparkAndDrainInputSchema` / `UnparkAndDrainInput`, and the task-board exports `TaskBoardOnReview` and `assertParkExitSupported`. React no longer maps a legacy `awaiting_review` card status. `TaskClaimTicket.turn` is required: every claim advances the row's `turn`, and a ticket from an earlier turn of the same attempt is declined `lost-claim`.

  A row stored with `questions` still reads as `holds` (`withRetiredShapes` from `@flow-state-dev/orchestration/tasks`). Shift Manager and the DevTool read them as holds.

- 1cd9821: A harness manager runs a task whose board-minted id isn't a usable identity segment, such as a coordinator's routed task (`routed:<request>:<round>:<delegate>`): a task that names no issue runs under `taskIssueSegment(taskId)`, the id itself when it fits and an `h-` hash otherwise. A session door's `runOf` keys a row's run with the same export. A conversation-result task whose output carries an `answer` string, as a coding run's does, now lands that answer in the conversation, routed or not (FIX-2270).
- 82eea02: A running coding task now says how it's doing. The harness contract gains an optional `onActivity` hook (`HarnessActivityHook`), called with each completed assistant message and each tool call a run starts; `claudeCodeAgent`, `codexAgent` and `cursorAgent` (tool calls only) take it, and `reportHarnessActivity` / `harnessActivityOf` in `@flow-state-dev/core` map a harness's events to it. `harnessManager` hands the feed and keeps the task's `statusNote` set to the run's latest activity: the first at once, then at most one write per `PROGRESS_NOTE_MS` (30 s), fenced by the run's claim. A slot that builds its harness from named feeds must pass `onActivity` through to get notes (FIX-2290).
- 06ea781: A checkout handed back off its run's branch is no longer refused. The host moves it back onto the run's branch and keeps what the run made elsewhere: a fast-forward when the checkout's commit contains the branch, and otherwise a checkout of the branch. It reports this as `place.repo.movedBack`. A checkout with uncommitted changes on a branch that lacks the run's commits is handed back as it is and reported as `place.repo.offBranch`, because those changes are the run's to commit, stash or discard; harness-manager refuses that attempt with the message. A half-done git operation, or the branch checked out in another worktree, is refused as the typed `WorkspaceRefusedError` `checkout-moved`, naming the git command that clears it. A run that switches its own branch no longer strands its session (FIX-2211).
- 646f8d2: A harness can declare `stopsOnAbort` on the block it returns (an optional field on core's `HarnessBlock`): when its abort signal fires, the block returns only after its process has exited. `claudeCodeAgent` declares it, and now kills its agent process with `SIGKILL` if it is still running 5 seconds after the abort, then waits for it to exit. A harness manager built without `stopsOnAbort` now reads the harness's declaration, so a line typed into a running Claude Code task stops the run and the same request continues its session with the line. Set `stopsOnAbort: false` on the manager to keep the old behavior, where the line waits for the run's own end (FIX-2312).
- 809cebd: `harnessManager` can read each run's board from its claim (FIX-1866). Give it `ledgers`, a resolver typed like `taskLedgers`'s, and the task's entry hands it the claim on its input as `claim: { collectionId, partition, incarnationId }`; every read and write is still fenced against the row at that ledger and partition. Runs are kept apart by board and partition (`runBoardSegment`). On such a board a refused run ends the task `errored` instead of `cancelled`, and a question parks the task on the board itself, with the answer reaching the next attempt's prompt. A completed run's output now carries `answer`, `branch`, `commits` and `judged`, and `isDone` reads the run's `answer`. An optional `judge` (a host block and a confidence floor) reads a run on such a board after `isDone` passes; `harnessDrainBudgetMs` takes `judge: true` to reserve its time. A fixed board runs as before.

  Orchestration's `fail` takes `noRetry: true` to end a task `errored` on this failure even when it has attempts left.

- e6bd135: A feature task (one naming an `issue` and a `phase`) on a board read from the claim now runs under the id its board minted, keyed by that task id, instead of being refused for not carrying the id its payload derives (FIX-1792). A fixed board still refuses such a row.
- d10b1ba: A board id may carry a single dot between its parts (`eng.feature.work`), and the manager uses it as is for each run's checkout folder and branch, so it never shares either with `eng-feature-work` (FIX-1667). Board ids that worked before derive exactly the same folders and branches. An id a git branch can't carry, such as one ending in `.lock`, is now refused when the manager is built rather than when a row is claimed.
- 08a9b05: See how much of each coding harness's subscription is used. Core adds the neutral usage window and the on-demand reader signature (`HarnessUsageWindow`, `HarnessUsageReading`, `HarnessUsageReader`). `@flow-state-dev/codex` adds `readCodexUsage`, which asks the Codex CLI's app-server for every window's percent used and reset time with no run (local only), and exports `findCodexProgram`. `@flow-state-dev/harness-manager` adds the per-person `harness-usage/**` record and `harnessUsageAction({ readers })`, the one query that returns each window with its age and whether it has rolled over, refreshing a reader at most once a minute. Shift Manager shows it on a new Usage view (FIX-2141).
- 2348dbd: A repository listed in `localRepositories` now fetches the base's upstream and cuts a new run's branch from whichever of local and upstream is newer, refusing a base whose two copies have each moved as `base-diverged` and recording the commit cut at as `place.repo.baseCommit`, which the run record keeps and `readRunCommits` now counts a run's commits from (FIX-1927).
- 3cbab3a: `harnessTalkTurn` is the session door's talk half as its own block: it resumes a finished task's coding session with a message and returns `{ reply, taskId }`, refusing a task that is still running (FIX-2160).
- 7c9e932: A running request's items are now readable while it runs on the in-memory stores too, and a message sent to a coding run whose harness hasn't named its session yet is held until it does instead of being refused as a run that can't continue (FIX-1735). `readCommitted` (in `@flow-state-dev/core/helpers`) reads a resource's state as committed now rather than as the request first read it.
- cd180d7: Stopping a paused request now ends it `aborted` and records its gate with the new `stopped` suspension status, a turn paused on an ask cancels the asked task instead of waiting for it, and a durable host now runs the durability sweeper even without `durabilityRetention`, so a paused request past its `expiresAt` expires and an ask past its deadline times out, while pruning still waits for a retention policy (FIX-1816).
- 78178a9: A run's owner is now the bare user id, not the user record's storage key (FIX-1790).
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
- Updated dependencies [06ea781]
- Updated dependencies [2ffc03c]
- Updated dependencies [646f8d2]
- Updated dependencies [16a8dab]
- Updated dependencies [456fe85]
- Updated dependencies [62133c4]
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
- Updated dependencies [2348dbd]
- Updated dependencies [3cbab3a]
- Updated dependencies [3cbab3a]
- Updated dependencies [849f6ec]
- Updated dependencies [028af6f]
- Updated dependencies [a965a50]
- Updated dependencies [eb831f8]
- Updated dependencies [859f621]
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
- Updated dependencies [dd2563b]
- Updated dependencies [839e915]
- Updated dependencies [f5b5457]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
- Updated dependencies [16bb676]
- Updated dependencies [c4150e7]
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
  - @flow-state-dev/workspace@0.2.0

## 0.2.0

### Minor Changes

- 0ab8c2e: A phase's `isDone` is handed how the run said it stopped, as `CompletionRunContext.stopReport`, so a completion check can refuse to settle a row whose run ran out of budget partway (FIX-1438).

### Patch Changes

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

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2
  - @flow-state-dev/orchestration@0.2.1

## 0.1.1

### Patch Changes

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

- 7cf0ca3: New package: a task-board worker that turns a row into a supervised coding run —
  its own git checkout, a verdict read before the row settles, a question it can
  ask a person and be answered on, and the coding agent supplied as a slot rather
  than built in (LAB-154).

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

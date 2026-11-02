# @flow-state-dev/devtool

## 0.3.1

### Patch Changes

- 70f09b5: `@flow-state-dev/devtool/react` exports `readDevtoolUrl()`, which reads the DevTool address `fsdev dev --app` writes into each page (the `fsdev-devtool-url` meta), and `traceHref(devtoolUrl, sessionId?)`, which builds the link that opens one session in the DevTool (FIX-2405).
- Updated dependencies [b616e7c]
- Updated dependencies [9a355b2]
- Updated dependencies [824ce87]
- Updated dependencies [0554e0b]
- Updated dependencies [387bee2]
- Updated dependencies [1fb64c9]
  - @flow-state-dev/react@0.3.1
  - @flow-state-dev/core@0.4.0
  - @flow-state-dev/client@0.3.1

## 0.3.0

### Minor Changes

- 9490722: The DevTool now uses the Flow State brand: Space Grotesk and IBM Plex Mono, square hairline surfaces, and three themes (Paper, Draft, Night) picked from a header switch and remembered per browser. Night is the default. The panel's colors are scoped to `.fsd-devtool-panel`, so an embedding host's own tokens are untouched. `FlowStateMark` now renders an inline SVG that follows the active theme; its `theme` prop is removed (FIX-1928).
- a3bfbc2: An Inventory tab on any session whose flow declares a readable inventory collection: the organization's registered workers, read through the production collection route with the configured bearer token, so it works with the debug endpoints off (FIX-1502). A collection the flow does not declare reads "not installed on this flow", and a refused read names its status.
- f6461ea: `./react` exports `withBearerToken(token)`, the fetcher the DevTool builds its one client with, in place of `bearerFetcher` (FIX-2162).
- 211679a: New core block kind: `evaluator` (FIX-1554). It asks an evaluation model typed questions (`choice`, `score`, `boolean`) and returns typed answers, with the model's confidence when it reports one. Model strings resolve through your existing providers and gateways; models that can only generate are refused before any call. `BlockKind` and the trace's `blockKind` gain `"evaluator"`: code that switches on block kind should handle it. `ai` minimum raised to the first release with evaluation. `@ai-sdk/typesafe-ai` is an optional peer. `ModelResolver` gains an optional `resolveEvaluationModel`; a custom resolver without it runs generators as before and refuses evaluator model strings. Evaluation through Vercel's AI Gateway needs `@ai-sdk/gateway` 4.0.85 or later. `@flow-state-dev/testing` adds `mockEvaluationModel`.
- 02ee032: Remove backward-compatibility paths (FIX-1804, FIX-850): stores read only the current on-disk and table layouts with no migration of older data, `@flow-state-dev/claude-code` drops its package-root entry and deprecated handle aliases, `@flow-state-dev/patterns` drops `legacyWorkerAdapter` and `executableTaskSchema`, and removed options such as `clientData`, `requireOrg`, `presets`, `preset/*` model strings, `prefer` and `fileFilter`/`syncMode` are no longer refused by name.
- d1a4cab: The inventory and roster views say worker where they said seat, and a task board's entry is its assignee (FIX-1796).

### Patch Changes

- 24afa6e: A question is one kind of task hold (FIX-2317, FIX-2131, FIX-2133). The two ways to stop for the user are named for what stops, and a task's open stops live in one list.

  - **`suspendForUser`** (new) suspends the request and resumes it with the answer: `ctx.suspendForUser({ kind, prompt, deadline? })` in `core`, `suspendForUserOn`, `createSuspendForUserTool`, `SuspendForUser`, `SuspendForUserOptions`, `SuspendForUserContext`, `SuspendForUserCancelled`, and `SuspendForUserKind` / `suspendForUserKindOf` (`contracts`, re-exported by `core`). `kind` is `"approval"`, `"review"` or `"input"`.
  - **`holdTaskForUser({ question })`** holds the task until the user answers, built with `createHoldTaskForUser`. The turn ends; the next turn on the same attempt spends no retry.
  - **`Task.holds`** lists what stops the task being claimed until the user answers. There is no `kind` field on a hold: an entry is told apart by `source.kind` (`"row"` or `"suspension"`) and `ask.kind` (`question`, `confirm`, `approval`, `review`, `input`). `getTask`, `listTasks` and Inbox items list `holds`.

  `createTask({ questions })` files a task that stays `pending` until each question is answered: a plain string is a question, `{ kind: "confirm", prompt, onNo? }` asks for a yes or a no. Answer with `updateTask({ id, answers, message })`. The Inbox client's `answerOne` takes `questionId`. A deadline applies only when the host sets `userDeadlineMs`.

  **Breaking, from the last publish.** The `parked` status is gone, with `counts.parked`, `TaskCollectionRef.awaitReview` / `unpark`, `board.unparkAndDrain`, a board's `onReview`, and `@flow-state-dev/react`'s `BOARD_STATUS_COLUMNS` `parked` column. Ask for a review with `ctx.suspendForUser({ kind: "review", prompt })`. The filer's hold is unchanged: status `held`, `hold()`, `release()`. `keptOpenBy: "suspended"` means the task's own request is suspended. Stores are reset: a stored `parked` row is not read. Also removed with `parked`: `TaskTransitionOptions.refuseWhenParked`, `CheckBoardOptions.excuseParked`, the `"parked-for-review"` termination reason, the `"review_requested"` change kind, the `"parked"` write-decline reason, `unparkAndDrainInputSchema` / `UnparkAndDrainInput`, and the task-board exports `TaskBoardOnReview` and `assertParkExitSupported`. React no longer maps a legacy `awaiting_review` card status. `TaskClaimTicket.turn` is required: every claim advances the row's `turn`, and a ticket from an earlier turn of the same attempt is declined `lost-claim`.

  A row stored with `questions` still reads as `holds` (`withRetiredShapes` from `@flow-state-dev/orchestration/tasks`). Shift Manager and the DevTool read them as holds.

- f469423: The DevTool opens a session from its address: `?session=<id>` on the page opens that session under the flow that owns it, or says why it can't. The link takes precedence over the session last open under that flow, and a read that fails for a reason that may pass is tried again when the flow list reloads. `DevToolPanel` takes the same as an `openSessionId` prop, and `readSessionAddress()` reads it off the page (FIX-1691).
- 2c213b4: On a narrow board, such as the DevTool's center pane in a 1280px window, a Tasks row now shows its goal and reason again: the Change column is hidden there (the open row still shows it) and the Run column narrows (FIX-1943).
- ad5df6f: Durable execution is on by default wherever stores persist (FIX-2063). `createFlowState` over filesystem, SQLite or Postgres stores now installs the checkpoint durability provider without `durable: true`; over in-memory stores it still installs none unless `durable: true` is set. `resolveDurabilityProvider({ stores, durable })` exports the rule for hosts that build `createFlowApiRouter` or call `runAction` themselves, and the in-memory checkpoint and suspension stores declare `persists: false`.

  `ctx.suspend()` on a host without durable execution now throws an error that names the rule and the setting to change, instead of "requires a DurabilityProvider". The durability sweeper arms for a pending stop's deadline as it does for a wait's, and reads the store's deadlines once at start.

  A no-config `fsdev run` now writes to `.fsdev/data/fsdev.db` (the SQLite file `fsdev dev` reads) instead of JSON files under `.fsdev/data`, and runs as `devuser`, the DevTool's default user (exported as `DEFAULT_LOCAL_USER_ID` from `@flow-state-dev/core`), instead of `cli-user`. `fsdev run` and `fsdev chat` use `devuser` as the default user with a config too. A run that stops for a person exits 0 with a `suspended` NDJSON event, `result.suspended` in `--capture`, and a waiting report on stderr. The no-config `fsdev dev` router is durable and sweeps. `--store filesystem` on `fsdev run` and `fsdev dev` keeps the JSON-file store, single-process.

  **Migration.** An app on persisting stores that never set `durable` now:

  - writes a checkpoint at every step of every sequencer (sequencers already default to `durable: true`),
  - resumes a request that crashed instead of rerunning it,
  - holds a raw `ctx.suspend()` until it is answered, where it used to fail the request,
  - runs the durability sweeper wherever it serves a router: a lease and a scan of pending stops on each tick, even when nothing waits.

  Set `durable: false` on `createFlowState` to keep the old behavior. Sessions a no-config `fsdev run` wrote as JSON files are not read by the SQLite default; pass `--store filesystem` to read them. Scripts that look up CLI sessions by `cli-user` should use `devuser`, or pass `--user cli-user`.

- 04ff39d: The task tools are now five: the filer's `createTask`, `getTask`, `listTasks` and `updateTask`, and the worker's `reportProgress` (FIX-2081). `createTask` takes `followUpOf` to file new work on a finished task in that task's session (FIX-1817). `addTask`, `assignTask`, `completeTask`, `failTask`, `cancelTask` and `readTask` are removed, as tools and as `<tool>_<board>` actions; no tool finishes a task. `updateTask({ id, ...fields })` takes flat fields with one rule each: `goal`, `title`, `context`, `input`, `deps`, `priority`, `labels`, `metadata`, `assignee`, `maxAttempts`, a hold and a release change only before a task first starts, and `status: "cancelled"` lands until it finishes. A refusal names the fields and the state (`field_locked_after_start`, `task_finished`). `reportProgress({ statusNote?, output? })` writes a status note and a checkpoint on the task its turn holds; `createReportProgress` builds it, and a checkpoint stays the task's output when the task completes. A task filed from a task turn carries `filedByTask`, and `listTasks` filters on it.

  In Workforce, a worker gives work only to its delegates, in a task session too: a piece for any other worker is refused with `unknown_assignee`. `delegates: all` delegates to the whole roster, read on each call. A coordinator's own turn has `addDelegate`, `removeDelegate` and `setFallback` only when its file sets `editsOwnDelegates: true`; every worker with a board has `listDelegates`. The DevTool's task row actions follow the new tools.

- bb1c224: `FlowNavigator` now draws an open leaf's `leafToolbar` on that leaf's own row, showing both row slots only when the row is hovered or focused (always on touch screens), so give them icon buttons with an `aria-label`, it adds dashed tree lines you can colour with `--fsd-nav-guide` and a `leafDetail` slot for content that sits on its own lines under an open leaf's row, and untitled session rows show a shortened id with the full id on hover (FIX-1561).
- 008c63e: New content never scrolls a conversation, even when the reader is at the end; a jump-to-latest arrow appears instead. A conversation still opens at its end with no scroll animation: on mount, on a switch to another session, and when its first read fills it. Sending your own line takes you to the end. `@flow-state-dev/react` exports the rule as `useJumpToLatest({ resetKey?, startAtEnd? })`, returning `{ ref, atEnd, jump, sent }`. The DevTool's stream view and Shift Manager's conversations use it (FIX-2346, FIX-2360).
- 6a3ecf5: `@flow-state-dev/client` exports `readEveryCollectionPage`, one collection read with a single 1,000-page ceiling that fails when the server repeats a cursor, and the workforce panels, the DevTool Inventory tab, the Shift Manager and the workforce roster read now use it, so a repeated cursor ends a read with an error instead of 1,000 wasted page reads, a partial list shown as whole, or a read that never stops (FIX-1674).
- 65ddb90: Each request's record now stores its action result (`output` as JSON, and/or `error`) with its final status, `listSessionRequests` returns it (the output with `includeResultOutput`), the DevTool task row reads it instead of reconstructing it from traces, and a run a completion hook failed after the action answered now reports that answer as `output` (including `fsdev run`'s result, where it was `null`) (FIX-1661).
- 2ab7ea2: A coordinator hands each message to a delegate by filing a routed task: an ordinary task on the conversation's board with `session: "ongoing"`, `resultTo: "conversation"` and one attempt, worked on the delegate flow's `work` entry (FIX-2083).

  - A delegate is a worker whose flow takes tasks. Declare `work` with `workerTaskEntry({ name, turn })`; the turn is still handed `{ message }`. `routedTaskHistory` is the `work` turn's generator `history` that shows the model the conversation's recent lines.
  - `listDelegates` says a delegate `takes` `tasks` or `nothing`. A worker on a flow that takes no task can't be added as a delegate.
  - A judgment coordinator hands a message on with `createTask` and the routing settings (`session: "ongoing"`, `resultTo: "conversation"`, and `target` for a workstream's record); the server attaches the message as written. On a turn routing a message, `createTask` refuses a `session` other than `"ongoing"` (`routed_session_ongoing`) and `held`, `deps` or `followUpOf` (`routed_task_starts_now`). `createTask` takes `target`, set at filing only; `updateTask` refuses `session`, `resultTo` and `target` (`filing_setting_fixed`). `getTask` shows a task's `session`, `resultTo` and `target`.
  - On a board that dispatches, `createTask` starts a task as soon as it is filed; release a held one with `updateTask({ id, status: "pending" })`, with its `assignee` in the same write if it needs one, and wait with `getTask({ id, wait: true })`. On a conversation's board, a task filed with no assignee where several delegates take tasks now waits unassigned instead of being refused `assignee_required`.
  - A routed turn is a task turn, and a `taskLedgers` resolver is handed the claimed task's id as its fourth argument.
  - A delegate that files work for a message answers once that work has ended, and a second message to a busy delegate waits until the first ends. A round's deadline is a wake on the coordinator's session where the host keeps wakes, so it survives a restart.
  - The coordinator's line when nobody takes a message reads `Nobody took this message: …`.

- cd180d7: Stopping a paused request now ends it `aborted` and records its gate with the new `stopped` suspension status, a turn paused on an ask cancels the asked task instead of waiting for it, and a durable host now runs the durability sweeper even without `durabilityRetention`, so a paused request past its `expiresAt` expires and an ask past its deadline times out, while pruning still waits for a retention policy (FIX-1816).
- 912ae98: A durable task board's task tools can now run as flow actions (`taskToolActions(board)`), and the DevTool's Tasks tab opens a task's full record and runs those actions from the row, showing a refusal as a refusal (FIX-1629).
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
- Updated dependencies [91a5afd]
- Updated dependencies [f97b0ed]
- Updated dependencies [397cfa7]
- Updated dependencies [53b50f0]
- Updated dependencies [585b75b]
- Updated dependencies [646f8d2]
- Updated dependencies [16a8dab]
- Updated dependencies [49852d9]
- Updated dependencies [698e06b]
- Updated dependencies [456fe85]
- Updated dependencies [126d131]
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
- Updated dependencies [bb1c224]
- Updated dependencies [a55d07f]
- Updated dependencies [7db4d13]
- Updated dependencies [0c9eb57]
- Updated dependencies [9e3b823]
- Updated dependencies [df3de3b]
- Updated dependencies [fe5df7d]
- Updated dependencies [715480f]
- Updated dependencies [423a405]
- Updated dependencies [5eb8209]
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
- Updated dependencies [008c63e]
- Updated dependencies [eb831f8]
- Updated dependencies [f6461ea]
- Updated dependencies [41638f3]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [931fdf9]
- Updated dependencies [736e719]
- Updated dependencies [db7df1c]
- Updated dependencies [0d6278e]
- Updated dependencies [968faa6]
- Updated dependencies [653549d]
- Updated dependencies [f6461ea]
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
- Updated dependencies [d1a4cab]
- Updated dependencies [3311cc2]
- Updated dependencies [7c9e932]
- Updated dependencies [60c8192]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [0e7e07e]
- Updated dependencies [295e96a]
- Updated dependencies [97894aa]
- Updated dependencies [334c1e3]
- Updated dependencies [b52626d]
- Updated dependencies [b7c523b]
- Updated dependencies [9ed6b29]
- Updated dependencies [b552b50]
- Updated dependencies [a021cd1]
- Updated dependencies [cd180d7]
- Updated dependencies [0581c5d]
- Updated dependencies [68b8957]
- Updated dependencies [e11764a]
- Updated dependencies [872a088]
- Updated dependencies [9cd314d]
- Updated dependencies [9af8ce5]
- Updated dependencies [30aa133]
- Updated dependencies [7052203]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [b7c523b]
- Updated dependencies [d97031f]
- Updated dependencies [524370f]
- Updated dependencies [49d2aca]
- Updated dependencies [3c10d9d]
- Updated dependencies [96ff077]
- Updated dependencies [84cc226]
  - @flow-state-dev/core@0.3.0
  - @flow-state-dev/client@0.3.0
  - @flow-state-dev/react@0.3.0

## 0.2.0

### Minor Changes

- 6b8bfe4: Sessions a dispatcher ran work in are listable on their flow: `GET /sessions` takes `include=dispatch-runs` (off by default), `listSessions` takes `include`, `FlowNavigator` takes `includeDispatchRuns` and draws a run one level under the session that started it, the DevTool shows runs in the rail and inside a session's block tree on demand in place of its Children tab, and `requestHost.livenessOf` now also answers for a dispatch run under the caller's own principal, tenant, organization and flow instance rather than only for one beneath the asking session (FIX-1440).

  The dispatch-run liveness arm compares the caller's organization against the active-request entry as well as the session record. Both comparisons are required: they read separately stamped rows, and a caller whose organization was not forwarded to the read matched only entries carrying no organization at all.

### Patch Changes

- 795b550: The debug resource snapshot now reports each resource's `writable` and `llmWritable` settings where they are declared, and the DevTool marks a resource read-only when `writable` is `false` (FIX-1481).
- 9062055: The DevTool's flow navigator is now the `FlowNavigator` component from `@flow-state-dev/react`, which the package takes as a new dependency: flows are grouped by kind with their copies underneath, and a session list is read only when you open a single flow instance (FIX-1477).
- 802c053: The DevTool's Tasks tab now shows the note a task carries about itself in a `Reason` column, so a row parked for review says why without opening its JSON expander (FIX-1481).
- Updated dependencies [b597600]
- Updated dependencies [795b550]
- Updated dependencies [6b8bfe4]
- Updated dependencies [4833ff8]
- Updated dependencies [9062055]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [0056b97]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
  - @flow-state-dev/core@0.2.0
  - @flow-state-dev/client@0.2.0
  - @flow-state-dev/react@0.2.0

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/client@0.1.2
  - @flow-state-dev/core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
  - @flow-state-dev/core@0.1.1
  - @flow-state-dev/client@0.1.1

## 0.1.0

### Minor Changes

- 4e562d0: The chat transport is removed (FIX-1330): `@flow-state-dev/chat-sdk` no longer exists, `chat` is no longer an option on `defineFlow`, `ChatConfig` / `ChatEventBinding` / `validateChatConfig` are gone from core, `"chat"` is no longer a `DispatchType` or a public re-entry source in the engine, and the DevTool no longer renders a Chat provenance badge. Conversational bots are driven through a caller-addressed action in `actions`; platform events ride the webhook transport.
- b3e6e22: Initial release (FIX-1187).
- fda9b15: Background work is declared with a task-board dispatcher seat and read back as child sessions: a session's children are listed at `GET /sessions/:sessionId/children` through `listChildSessions()` and `useSession`'s `childSessions` / `childSessionsStale`, session-scoped resources shared with them use `sharedToLineage`, and the two `createFlowState` options are `dispatchDrainTimeoutMs` and `maxChildSessionListLimit`; the Workstream surface they replace is removed, `ctx.requestHost.startDetached` and `dispatch: { mode: "detached" }` with it (FIX-1308). From `@flow-state-dev/orchestration/task-board` that removes the detached-mode helpers (`assertDetachedBoardSupported`, `detachedTaskPredicate`, `coordinateKey`, `coordinateLabel`, `workstreamRoutingSeed`, `WorkerCoordinate`, `TaskWorkerDispatch`, `TaskWorkerSlot`, `TaskWorkerSlotRegistry`, `TaskWorkerEntry`, `isTaskWorkerEntry`) and `board.detachedWorkers`; a seat is a block or a `dispatcher({ type: "task" })`, and `resolveWorkerSlots` now returns the bare blocks plus the `HandOffSeat`s (`name`, `label`, `dispatch`) in one walk from the hand-off module. A `{ worker, dispatch }` or `{ block, session }` seat is refused by name at construction. The DevTool's Children panel pairs a child with its task from the dispatch key a `per-task` or `per-worker` seat derives (a `{ key }` policy pairs nothing) and shows the entry it was dispatched for.

### Patch Changes

- 527c5ca: The DevTool now identifies flows by instance rather than by kind, so two registered copies of one flow each show their own sessions, requests and controls instead of one copy's work appearing under the other (FIX-1324).
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
  - @flow-state-dev/client@0.1.0

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-04-11 — DevTool: `fsdev dev` + `@flow-state-dev/devtool` (FIX-261)

New package. Ships pre-built DevTool static assets and exports `getAssetPath()` so the CLI's `fsdev dev` command can serve them from a single port. The build pipeline builds the DevTool Vite app (`apps/devtool`) and copies the output into this package. The CLI lists `@flow-state-dev/devtool` as an optional peer dependency.

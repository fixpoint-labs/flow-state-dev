# @flow-state-dev/react

## 0.3.1

### Patch Changes

- b616e7c: `@flow-state-dev/react` exports `isSendKey(event, { enterSends? })`, the send shortcut for a message box: Cmd+Enter (Mac) or Ctrl+Enter (elsewhere) always sends, plain Enter sends only where `enterSends` is set, and Shift+Enter or an Enter that confirms an IME composition never sends (FIX-2365).
- 9a355b2: `@flow-state-dev/react` exports `useInterruptKeys`, `createInterruptKeys` and `interruptChordLabel`, a keyboard stop for long-running work. One Esc never stops anything. A second Esc within 1.5 s does, and so does Cmd/Ctrl+. at once. An Esc typed in a text field, or one already used to close a dialog, never counts (FIX-2413).

  `@flow-state-dev/engine`: the request status route's `completedAtMs` is now set for aborted and failed requests, from the time they stopped. It was set only for requests that completed. A replayed or resumed stream's terminal event for an aborted request is now dated when the request was aborted, not when its record was last written.

  `@flow-state-dev/shift-manager`: one Esc on a task no longer interrupts its run. Press Esc twice or Cmd/Ctrl+. instead. Esc in the composer is the composer's. An interrupted run now says when it stopped.

- 1fb64c9: `harnessManager({ approveTools: true })` makes a run's tool call that isn't pre-allowed wait for a person's approval as the task's hold, then resumes the same coding session on Allow, Allow for this run, or Deny; claude-code's `onToolApproval` gains a `held` decision, and react's `useApproval` gains `approveWith`, `rejectWith` and `approveOptionsOf` (FIX-2389).
- Updated dependencies [824ce87]
- Updated dependencies [0554e0b]
- Updated dependencies [387bee2]
  - @flow-state-dev/core@0.4.0
  - @flow-state-dev/client@0.3.1
  - @flow-state-dev/contracts@0.2.1

## 0.3.0

### Minor Changes

- 24afa6e: A question is one kind of task hold (FIX-2317, FIX-2131, FIX-2133). The two ways to stop for the user are named for what stops, and a task's open stops live in one list.

  - **`suspendForUser`** (new) suspends the request and resumes it with the answer: `ctx.suspendForUser({ kind, prompt, deadline? })` in `core`, `suspendForUserOn`, `createSuspendForUserTool`, `SuspendForUser`, `SuspendForUserOptions`, `SuspendForUserContext`, `SuspendForUserCancelled`, and `SuspendForUserKind` / `suspendForUserKindOf` (`contracts`, re-exported by `core`). `kind` is `"approval"`, `"review"` or `"input"`.
  - **`holdTaskForUser({ question })`** holds the task until the user answers, built with `createHoldTaskForUser`. The turn ends; the next turn on the same attempt spends no retry.
  - **`Task.holds`** lists what stops the task being claimed until the user answers. There is no `kind` field on a hold: an entry is told apart by `source.kind` (`"row"` or `"suspension"`) and `ask.kind` (`question`, `confirm`, `approval`, `review`, `input`). `getTask`, `listTasks` and Inbox items list `holds`.

  `createTask({ questions })` files a task that stays `pending` until each question is answered: a plain string is a question, `{ kind: "confirm", prompt, onNo? }` asks for a yes or a no. Answer with `updateTask({ id, answers, message })`. The Inbox client's `answerOne` takes `questionId`. A deadline applies only when the host sets `userDeadlineMs`.

  **Breaking, from the last publish.** The `parked` status is gone, with `counts.parked`, `TaskCollectionRef.awaitReview` / `unpark`, `board.unparkAndDrain`, a board's `onReview`, and `@flow-state-dev/react`'s `BOARD_STATUS_COLUMNS` `parked` column. Ask for a review with `ctx.suspendForUser({ kind: "review", prompt })`. The filer's hold is unchanged: status `held`, `hold()`, `release()`. `keptOpenBy: "suspended"` means the task's own request is suspended. Stores are reset: a stored `parked` row is not read. Also removed with `parked`: `TaskTransitionOptions.refuseWhenParked`, `CheckBoardOptions.excuseParked`, the `"parked-for-review"` termination reason, the `"review_requested"` change kind, the `"parked"` write-decline reason, `unparkAndDrainInputSchema` / `UnparkAndDrainInput`, and the task-board exports `TaskBoardOnReview` and `assertParkExitSupported`. React no longer maps a legacy `awaiting_review` card status. `TaskClaimTicket.turn` is required: every claim advances the row's `turn`, and a ticket from an earlier turn of the same attempt is declined `lost-claim`.

  A row stored with `questions` still reads as `holds` (`withRetiredShapes` from `@flow-state-dev/orchestration/tasks`). Shift Manager and the DevTool read them as holds.

- bb1c224: `FlowNavigator` now draws an open leaf's `leafToolbar` on that leaf's own row, showing both row slots only when the row is hovered or focused (always on touch screens), so give them icon buttons with an `aria-label`, it adds dashed tree lines you can colour with `--fsd-nav-guide` and a `leafDetail` slot for content that sits on its own lines under an open leaf's row, and untitled session rows show a shortened id with the full id on hover (FIX-1561).
- 0c9eb57: `useSession` has `followRequest(requestId)`: follow a request of the session that was sent without the hook, streaming its items into `items` and making it the request `abortRequest` stops (FIX-2265). Send a request beside the one the page follows through the client, and follow it once that one ends, so the page stays on the running request meanwhile.

  `abortRequest` now closes only the request it stopped. If the session moves to another request while the stop's answer is still out, that request keeps its stream and becomes the one the next stop reaches.

  `useHarnessLines(session)` sends a harness session's lines while its turns run: into the running turn when the run takes them, else as the next turn, in the order typed, with the session view kept on the running turn until it ends. It follows each waiting turn once the turn before it has ended, and follows the oldest running turn first when the view opens while turns wait.

- 715480f: `ItemsRenderer`'s `toolGroupRenderer` and `buildItemRenderStream`'s `groupToolCalls` now group `reasoning` items with `tool_output` items: a run of an agent's tool calls and thinking between its messages is one `group` segment, and a thought no longer splits a run of calls in two. A group's `items` are `ActivityItem[]` (exported); a renderer that assumed every item in a group is a `tool_output` must handle `reasoning`.

  `ItemsRenderer` also takes `live`: while the stream is open, the `toolGroupRenderer` receives `live` on the trailing group (the work no message has yet ended), so it can show the latest step instead of a summary.

- f6461ea: Hooks and components take the one client from `@flow-state-dev/client`. `FlowProvider` gains `fetcher`, the transport every hook and component under it uses. `FlowNavigator` takes one `client` (no `sessionClient`, no `userId`) and lists that client's user's sessions. `Roster`, `BoardColumns`, `BoardList` and `WorkerDetail` take `client` in place of `resourceClient`; `BoardList` drops `fetcher` and `baseUrl`, since its live stream goes through the same client as its reads. New `PanelLiveSource` type (FIX-2162).
- d1a4cab: The roster panels say worker: `SeatDetail`, `RosterSeat` and `RosterSeatRow` are `WorkerDetail`, `RosterWorker` and `RosterWorkerRow` (FIX-1796).
- cd180d7: Stopping a paused request now ends it `aborted` and records its gate with the new `stopped` suspension status, a turn paused on an ask cancels the asked task instead of waiting for it, and a durable host now runs the durability sweeper even without `durabilityRetention`, so a paused request past its `expiresAt` expires and an ask past its deadline times out, while pruning still waits for a retention policy (FIX-1816).
- d97031f: The suspension reasons that wait for a user are now `"user_approval"` and `"user_input"`, renamed from `"human_approval"` and `"human_input"`. Nothing reads the old values: `SuspensionReason` still accepts any string, so a `ctx.suspend` or a `useSuspensions({ reasons })` filter that still passes an old value compiles but is treated as a custom reason: it is not a user's stop, gets no Inbox item, and an old `"human_input"` stop defaults to approve/reject instead of submit. Search your code for both old strings and replace them. Stored suspensions with the old reasons are not migrated (FIX-2151).

### Patch Changes

- 91a5afd: New `BoardList` panel draws a board as one list, newest first, with each task's status, and with `live` it reads the board again whenever the session it reads through keeps a change to that board (FIX-1622).
- 698e06b: New `apiPath` option on every client constructor and on `FlowProvider` names where the server mounts the flow API (default `/api/flows`), so the client and React hooks can reach a Node server started with a custom `basePath`. Requests go to `baseUrl` + `apiPath` + route; with `apiPath` unset, every URL is unchanged. The `@flow-state-dev/node` README documents pairing `basePath` with `apiPath` (FIX-1677).
- 126d131: `useResourceCollection` no longer serves one session's cached pages after a switch to another session, collection or server, and a response that lands after the switch is never cached. `useResourceCollectionList` and `useResourceCollectionItem` no longer show the previous session's rows or item while the new session's read loads, and a late page from the old session no longer replaces the new rows (FIX-2037).
- 5eb8209: `useHarnessLines`: when the running turn's stream drops while a line's turn waits behind it, the hook follows the running turn again (up to three times), so the waiting turn's answer shows when the running one ends instead of only after a reload (FIX-2304). `useSession.followRequest` on a request whose stream dropped picks up after the last event the view had, instead of replaying it from the start and applying its state changes twice. `followRequest` now returns `false`, and follows nothing, for a request the person stopped or dismissed; `useHarnessLines` then moves on to the waiting turn.
- 008c63e: New content never scrolls a conversation, even when the reader is at the end; a jump-to-latest arrow appears instead. A conversation still opens at its end with no scroll animation: on mount, on a switch to another session, and when its first read fills it. Sending your own line takes you to the end. `@flow-state-dev/react` exports the rule as `useJumpToLatest({ resetKey?, startAtEnd? })`, returning `{ ref, atEnd, jump, sent }`. The DevTool's stream view and Shift Manager's conversations use it (FIX-2346, FIX-2360).
- 931fdf9: `Roster`, `BoardColumns` and `BoardList` now show their error line, with Retry, when a collection still has pages left after 1,000 reads, instead of rendering the rows read so far as the complete list (FIX-1577).
- 736e719: `Roster` and `BoardColumns` now read every page of their collection, following the list route's cursor instead of stopping at the first page — a collection past the route's default page size no longer truncates silently, dropping its last rows (FIX-1477).
- 6a3ecf5: `@flow-state-dev/client` exports `readEveryCollectionPage`, one collection read with a single 1,000-page ceiling that fails when the server repeats a cursor, and the workforce panels, the DevTool Inventory tab, the Shift Manager and the workforce roster read now use it, so a repeated cursor ends a read with an error instead of 1,000 wasted page reads, a partial list shown as whole, or a read that never stops (FIX-1674).
- 0e7e07e: Adds `SeatDetail`, a panel showing one seat's kind (from a prop, no read) and its instructions (one item read from the roster collection). A user-owned or undeclared seat shows its instructions as not published, with no read (FIX-1500).
- b52626d: `useSession` reports `isLoading` on the first paint when a session id is given, and `useFlow` reports it on the first paint of its list read, so a transcript can hide until the snapshot lands (FIX-2218).
- 0581c5d: `useSession().abortRequest` now stops a turn whenever it is pressed: while the turn's POST is still out (the stop is sent again once the server has the request, and the turn is not picked back up), on a turn the hook resumed on mount, and mid-stream, where the hook's stop record now stays in `items` until a snapshot holds the server's own (FIX-1956).
- 7052203: A task now runs by the settings it was filed with, and nothing waits on work that will never finish (FIX-2080).

  - **`held` replaces `blocked`.** A held task is filed but doesn't start until it is released. `TaskCollection.block` / `unblock` become `hold` / `release`, the `"blocked"` status and `listTasks` filter value become `"held"`, `Task.undispatched` / `TaskInit.undispatched` become `held`, change kinds `blocked` / `unblocked` / `dispatched` become `held` / `released`, and the board's `counts.blocked` becomes `counts.held`. Stored `blocked` rows and recorded-not-started rows read as `held`; a `blocked` row's reason moves to `metadata.heldReason`, and a release starts it even if it had been retried.
  - **`blockTask` is removed.** Use `updateTask({ taskId, patch: { status: "held" } })` to hold a task before it starts, and `"pending"` to release it. `addTask` on a dispatching board files the task held.
  - **`patchSettings`** changes `held`, `deps` and `maxAttempts` until a task first starts, and declines `started` after.
  - **Dependencies are checked at filing.** A dependency on another board, on an ended task, or one that closes a loop throws `TaskFilingRefusedError` (`dependency_not_on_board`, `dependency_ended`, `dependency_loop`) and files nothing. To wait on another board, use a wait or a held task. A Workforce batch that names one id twice is refused (`duplicate_task_id`).
  - **Every board cancels the open dependents of a failed or cancelled task**, labelled `skipped`, with `causedBy`. `createCascadeSkipDependents` is removed; drop its `.tap()`. Plan-and-execute and supervisor now also cancel a cancelled step's dependents. A plan whose dependencies name no task, or loop, fails the run; a replanned task that depends on a failed one is filed skipped.
  - **Workforce:** a follow-up into a busy session waits, then runs when the open task ends, instead of being refused. The follow-up refusal code `follow_up_of_unfinished` is now `follow_up_of_unrun`: a follow-up of a task that never ran with a worker is refused, from the tools and from the board's ref alike. Code filing through the board's ref can set `session: "new" | "ongoing"` and `resultTo: "filer" | "conversation"` (one attempt; a wait on it is refused). When a task fails, is retried or is cancelled, the open pieces it filed are cancelled.

- b7c523b: `useSession` takes `live: true` to hear requests the view didn't send: other tabs, other people, agents answering in the same session. Their finished items join `items` about a second after the server keeps them, each once, in the order a reload shows, and `childSessions` is re-read whenever a run starts or finishes. Off by default (FIX-1609).

  `useSession` now tells items apart by request and item id, live or not. Two requests that each keep a keyed item with the same key both appear in `items`; before, the later one replaced the earlier, or a reload showed it twice.

  A live view opens its stream from the snapshot's `at`, so nothing kept after the snapshot is missed however long the snapshot took. Once a live view holds a finished copy of an item, a copy still being written never replaces it, whichever arrives first. A keyed item emitted twice keeps its later copy (by the server's `ts`, then `itemIndex`), whichever stream or snapshot brings it last.

  The user's message a view shows while a request is sent gives way to the server's copy from either stream, so it no longer shows twice when the view's own stream drops first. An item that arrives live stays in view until a snapshot requested after it arrived, however long an earlier snapshot takes to land.

  A snapshot read never undoes a newer one: when two are in flight, the one requested later wins, and an earlier one landing after it is dropped with the session detail read beside it. A session switch retires every read in flight. A history longer than a page is read so that no item is skipped when a request is removed or a keyed item moves between two pages: the read starts over, and fails after five tries rather than show part of the history as whole. It starts over too when a later page comes from another session that took the id. A snapshot read that lands, from `refresh()` or anywhere else, takes away the `error` an earlier failed snapshot read set, including the five-tries error; it leaves an error from anything else, such as a failed action, and one set by a read requested after it.

  A live view's stream follows the session its snapshot read. When the session is deleted and its id used again, the stream stops; once a snapshot of the new session lands, the stream opens again on that one.

  With `live: true`, once the stream has named the runs, a reconnect that fails, a refusal, or the session gone keeps the rows and raises `childSessionsStale`, until a connection names the runs again, or for good.

- 524370f: `useSession` now applies `item.updated` patches from its request stream as they arrive, so an in-flight item (a tool call's result, a container's status, a trace row's input) updates in `session.items` before the item finishes. A patch to an item the view already holds finished, or to an item the item filter excludes, is ignored (FIX-2038).
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
- Updated dependencies [617aeab]
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
- Updated dependencies [65ad58a]
- Updated dependencies [3b0161c]
- Updated dependencies [385d01e]
- Updated dependencies [fa7b22e]
- Updated dependencies [d1a4cab]
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
- Updated dependencies [b7c523b]
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
  - @flow-state-dev/contracts@0.2.0

## 0.2.0

### Minor Changes

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

### Patch Changes

- 4833ff8: `FlowNavigator` browses your flow kinds and their sessions, reading each kind's depth from its declared `cardinality` and fetching sessions only when a leaf opens, and `sessionQueryFor` turns a flow address into the right session-listing filter (FIX-1477).
- 9062055: A `FlowNavigator` section can omit `kinds` to cover every kind the server registers, for an app that cannot name them ahead of time (FIX-1477).
- 0056b97: `Roster` lists the seats hired in an organization, including the ones a boot reload could not restore, and `BoardColumns` draws one task board as columns grouped by the existing task statuses. Both read a collection through the host's own resource client, take no organization filter because the collections are organization-scoped on the server, and theme through `--fsd-panel-*` custom properties (FIX-1477).
- Updated dependencies [b597600]
- Updated dependencies [795b550]
- Updated dependencies [6b8bfe4]
- Updated dependencies [4833ff8]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
  - @flow-state-dev/core@0.2.0
  - @flow-state-dev/contracts@0.1.2
  - @flow-state-dev/client@0.2.0

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/client@0.1.2
  - @flow-state-dev/contracts@0.1.1
  - @flow-state-dev/core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
  - @flow-state-dev/core@0.1.1
  - @flow-state-dev/client@0.1.1

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).
- fda9b15: Background work is declared with a task-board dispatcher seat and read back as child sessions: a session's children are listed at `GET /sessions/:sessionId/children` through `listChildSessions()` and `useSession`'s `childSessions` / `childSessionsStale`, session-scoped resources shared with them use `sharedToLineage`, and the two `createFlowState` options are `dispatchDrainTimeoutMs` and `maxChildSessionListLimit`; the Workstream surface they replace is removed, `ctx.requestHost.startDetached` and `dispatch: { mode: "detached" }` with it (FIX-1308). From `@flow-state-dev/orchestration/task-board` that removes the detached-mode helpers (`assertDetachedBoardSupported`, `detachedTaskPredicate`, `coordinateKey`, `coordinateLabel`, `workstreamRoutingSeed`, `WorkerCoordinate`, `TaskWorkerDispatch`, `TaskWorkerSlot`, `TaskWorkerSlotRegistry`, `TaskWorkerEntry`, `isTaskWorkerEntry`) and `board.detachedWorkers`; a seat is a block or a `dispatcher({ type: "task" })`, and `resolveWorkerSlots` now returns the bare blocks plus the `HandOffSeat`s (`name`, `label`, `dispatch`) in one walk from the hand-off module. A `{ worker, dispatch }` or `{ block, session }` seat is refused by name at construction. The DevTool's Children panel pairs a child with its task from the dispatch key a `per-task` or `per-worker` seat derives (a `{ key }` policy pairs nothing) and shows the entry it was dispatched for.

### Patch Changes

- afcac3d: A flow declares its `cardinality` — `"singleton"` (the default: `myFlow()` is the one instance, addressed by its kind, and `myFlow({ id: "default" })` now throws) or `"collection"` (several configured copies, each registered under its own required `id`) — every address (the action, stream, resume, retry and continue routes, `fsdev run`, dispatchers, BullMQ jobs, MCP, webhook and schedule dispatch) is the exact instance id with no first-registered fallback, every session and request records its owning `flowId` and is refused when reached through another instance (`FlowInstanceBindingMismatchError`; `409 wrong-instance-session` / `wrong-instance-request` / `migration-required` on the routes), and SQLite and Postgres add a nullable indexed `flow_id` column with no backfill (FIX-1321, FIX-1322).
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
  - @flow-state-dev/contracts@0.1.0

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-18 — Moderated Debate (FIX-607)

Kitchen-sink ships a new `<Debate />` container renderer (in the UI registry) that groups the transcript by round, opens each round with the moderator's decision card (speakers, briefing, focus), and closes with the judge's verdict.

### 2026-05-18 — Configurable downstream information flow on Task Board (FIX-610)

`<TaskPlan />` and related renderers attribute cached `tool_output` items via `cached: true`, `cacheAgeMs`, and `sourceTask` for cross-task hits.

### 2026-05-16 — Round Robin pattern reshape (FIX-597)

UI renderers for Round Robin updated to render referee critiques per round and to drop the judge's terminating summary (the synthesizer is now the terminal step).

### 2026-05-15 — Kitchen-sink in-flight status (FIX-600)

Default fallback verb changed from "Thinking..." to "Working..." to stop duplicating the reasoning chrome's header text. `RequestGroupRenderer` / `RequestGroup` gain an optional `isFinishing` prop; the in-flight indicator switches to a muted "Tidying up..." state while a request is in its background-task drain phase. Generator/tool status snapshot-and-restore so a tool's status no longer lingers past its own execution.

### 2026-05-14 — `useResourceCollection` invalidates on mid-stream changes

`useResourceCollection` now watches `session.resourceChanges` instead of `session.items`, invalidating its page cache as soon as a notice whose path is under the watched `ref` arrives. `get`'s callback identity flips on invalidation so single-item subscribers via `useResourceCollectionItem` actually refetch.

### 2026-05-14 — Observable model identity (FIX-518)

New `<ModelBadge model={item.model} />` component. Renders the `actual` model id as a pill with the requested/gateway in the tooltip; renders nothing when `model` is undefined.

### 2026-05-12 — DevTool: surface context on block failures (FIX-582)

DevTool's failed-block detail panel renders a dedicated "Raw output" pane for the model's text, a typed "Validation issues" list for Zod issues, and a generic "Details" JSON panel for any other keys. Failed tool-invoked blocks gain Input and Tool call sections.

### 2026-05-11 — DevTool full resource visibility (FIX-579)

DevTool reads from the new `/debug/resources*` surface to render full server-side resource layer for a session, including the per-entry `clientView`. Dual-registered resources collapse into one entry. Collection counts are bounded with `itemCountTruncated` markers.

### 2026-05-11 — `useClientData` mid-stream first-run (FIX-561)

`useSession` now buffers `state_change` SSE items that arrive while the initial snapshot fetch is still in flight, and drains them onto the snapshot the moment it lands. Internal cleanup: `pendingStateChangesRef` is cleared on session-id change.

### 2026-05-07 — `useClientData` reflects mid-stream state changes (FIX-576)

`useSession` now reduces incoming session/user/org-scope `state_change` deltas into the cached snapshot via a new pure `mergeStateChangeIntoSnapshot` helper (handles `patch`, `set`, `increment`, `push`, `delete_key`, `setStateRecord`; skips `atomic`). Re-render isolation preserved: a delta touching one expose key doesn't churn consumers reading a different one. Trade-off: the first set of an expose key whose initial value was `undefined` won't surface mid-stream.

### 2026-05-07 — Block trace unification (FIX-573) [BREAKING]

`useRequestStream` and the DevTool consumer dispatch `block_trace` and `tool_output` items (renamed from `block_output` / `block_tool_output`).

### 2026-05-07 — Lazy collection state, query interface (FIX-427) [BREAKING]

`useResourceCollection` returns `{ list, get, query, actions, refetch, prefetched, count }`. New hooks: `useResourceCollectionList`, `useResourceCollectionItem`, `useResourceManifest`.

### 2026-05-07 — `item.updated` SSE event (FIX-572)

`useRequestStream` applies `item.updated` patches to its items map without touching item order. Routed through a new `onItemUpdated` callback.

### 2026-04-30 — `content.delta` non-replayable (FIX-479)

Page-load bootstrap now shows the latest accumulated text for in-flight messages instead of empty content. Completed messages still replay exactly.

### 2026-04-30 — Sub-agent items as first-class data (FIX-480)

`<TaskPlan />` per-task expansion uses `extractTaskItems` / `computeTaskItemWindows` from `@flow-state-dev/tasks` so worker windows can be inspected without touching the renderer.

### 2026-04-30 — `taskBoard` follow-up (FIX-447)

`<TaskPlan />` row expansions now render a vertical timeline of windowed items — tool calls, message lines, reasoning, and the worker's `task.output` Markdown — instead of nesting the chat-thread `<ToolGroup>` card inside the section card. Per-task ownership keys on `item.ts` so post-terminal tool emissions attribute correctly.

### 2026-04-30 — Connection resilience (FIX-476)

`useSession` exposes `isStuck` (watchdog-tripped flag) and `dismissRequest(requestId?)` (works without a live SSE handle). `sendAction` auto-dismisses a stuck prior request before opening the new stream. `EventQueueProgress` removed.

### 2026-04-29 — `<TaskPlan />` + DevTool (FIX-445)

New `<TaskPlan />` component (registered as `task-plan` in the UI registry). Section-grouped renderer for any `TaskCollection` — subscribes to `task-change` and `task-board-meta` items, latest-wins per task, sectioned by status. Per-task rows show goal, assignee, deps, error/feedback, and a retry indicator. New "Tasks" tab in DevTool auto-discovers every TaskCollection in the active session.

### 2026-04-29 — Patterns migrated onto `taskBoard` (FIX-447) [BREAKING]

Renderers updated to consume `task-change` / `task-board-meta` items. The old `plan-meta` / `plan-task` ComponentItems and the legacy `<Plan />` flow are gone.

### 2026-04-26 — Org scope rename (FIX-428) [BREAKING]

React hooks and renderers renamed `project` → `org` in snapshot fields, projection helpers, and DevTool tab labels.

### 2026-02-15 — Initial scaffolding

Initial scaffolding: `useFlow`, `useSession`, `useProjections`, `useAction`, `useRequestStream`, context renderer resolution, `useBlockContext`. Plural `<ItemsRenderer items={...} />` default renderer.

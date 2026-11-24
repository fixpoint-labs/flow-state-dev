# @flow-state-dev/orchestration

## 0.7.0

### Minor Changes

- 2cb6326: A coding task can wait for its pull request to merge before it completes (FIX-2578).

  - **harness-manager:** new option `awaitPullRequests` (off by default). When it is on, a task whose run opened a pull request does not complete at its settle. It waits on its pull requests, and each wake reads them through `gh`: all merged completes the task with no new run; none open with some merged completes it and the output notes the closed ones; all closed without merging cancels it with the reason "its pull request was closed without merging"; any still open runs the wake's words as a steer on the same attempt and session, then waits again. A pull request that can't be read never settles the task: it runs the steer, waits again, and adds a status note. A completed run's output gains `pullRequests` (`{ url, number, title, state }[]`, `null` when no wait ran).
  - **harness-manager:** `pullRequestWait(row, records?)` and `PULL_REQUEST_EVENT`, from the package root and from `./browser`, read a task's open pull-request wait for a screen: the hold, when it opened, and each pull request's number, link and title. `CLOSED_WITHOUT_MERGING` is the cancel reason.
  - **orchestration:** a new row hold, `external`, for a running task that waits on something outside the board. It is the system's (`actor: "system"`), never a question: the filer is not told of it, the Inbox does not list it, and `waitsOnUser` is false. It holds the row as a question does (no lease, unclaimable, the waiting turn cannot settle). Open one from the turn holding the claim with `waitExternally(ctx, ledger, { prompt, events })` (`./task-board`) or `ref.awaitExternal(id, wait, { claim })`. A user's line in the task's session answers it, and so does an answer from `"service"`. New readers `holdActorOf(row)` (`"user"`, `"system"` or `undefined`), `externalHoldOf(row)` and `isExternalHold(hold)` from `./tasks`. A board whose only open rows wait on an event ends with the reason `waiting-on-an-event`.
  - **orchestration:** steers and answers gain the source `"service"`, for words from outside the app, with the sender's handle as `by`. A run reads them quoted as the sender's, never as the user's. The filer's answer through `updateTask` on an `external` hold is refused (`wait_is_not_a_question`).
  - **workspace:** `readPullRequest({ cwd, number, repository?, host? })` reads a pull request's `state` and `merged`, a fork's included. `pullRequestHead` also returns `state` and `merged`.
  - **core:** `writePullRequests` keeps a pull request's `state` current: a sighting's state replaces the stored one. Other fields still fill only when null.
  - **workforce:** a message delivered to a task's session whose task waits on an `external` hold answers that wait, as `"service"` from its sender, instead of queueing behind it.

  Docs: packages/harness-manager/README.md (settling: a section "Waiting on a pull request" for `awaitPullRequests`, the four outcomes, the unreadable case, `pullRequestWait` in the `./browser` list, the `pullRequests` output field), packages/orchestration/README.md (the `external` hold beside questions and confirms, `waitExternally` / `awaitExternal`, `holdActorOf`, the `"service"` steer source, the `waiting-on-an-event` reason), packages/workspace/README.md (`readPullRequest`), packages/workforce/README.md (a message to a task waiting on an outside event answers its wait).

- 84b912d: A board's task list and a coding run's changes are views (FIX-2623).

  - **orchestration:** `taskToolViews(collectionId, resolve)` builds a board's task list as a keyed session view, `listTasks_<suffix>`. Its answer is the board's rows as the `listTasks_<suffix>` action lists them, keyed by task id. When a session has no board to list, it is refused with the list's own reason (`422 no_delegation_board`) rather than answered as an empty board. `taskListViewRef(flow, board)` from `@flow-state-dev/orchestration/inbox` is the client's typed handle on it (`TaskListView` is its type): `useView(taskListViewRef(flow, "tasks"), {}, { sessionId })` in React, or `client.view(...)`.
  - **harness-manager, breaking:** `harnessRunChangesRead` is now `harnessRunChangesView`, and `HarnessRunChangesReadOptions` is now `HarnessRunChangesViewOptions`, with the same options. It returns a session view: declare it with `views: { changes: harnessRunChangesView({ board, uses }) }` instead of `reads: { changes: ... }`, and call it on the run's session with `client.view(viewRef(flow, "changes"), { taskId?, path? }, { sessionId })`. The answer is unchanged. `harnessSessionFlow`'s per-turn `changes` is a session view too.
  - **shift-manager:** the Tasks panel and a feed's task cards watch the conversation board's view. They name no topic and read on the view's own timer where push can miss a change.

  Docs: packages/orchestration/README.md (`taskToolViews` keyed, `taskListViewRef`, `TaskListView`), packages/harness-manager/README.md (`harnessRunChangesView`, `HarnessRunChangesViewOptions`, `changes` as a session view), apps/docs/docs/orchestration/harness-manager.md (the changes view replaces the read).

- e505adf: Structured content is one item kind, `data`, emitted with `ctx.emit.data(dataType, value, { key? })` (FIX-2738). The `component` item kind is removed, with no alias: a "component" is now a `dataType` with a renderer registered for it.

  **Breaking.**

  - **core / engine:** `ctx.emit.component` is removed. `ctx.emit.data(dataType, value, options?)` emits `{ type: "data", dataType, value, key? }`. Options are `key` (keyed snapshot: id `item_data_keyed:<key>`, one entry per request and key, `value` replaced), `itemVisibility`, `agentName` and `transient` (default `false`, persisted). Migrate `ctx.emit.component(name, data, opts)` to `ctx.emit.data(name, data, opts)`.
  - **contracts / core:** `ComponentItem` is removed from the `OutputItem` union; `DataItem` replaces it. With no `itemVisibility` a data item reaches the client and never model history (`{ client: true, history: false }`); `itemVisibility` overrides both. With `history: true`, a turn's history replays it as one assistant line, `[dataType] <value as JSON>`. A reader filters `item.type === "data"` and `item.dataType`, and reads `item.value` (not `item.data`).
  - **react:** `RendererRegistry.data` holds item renderers, keyed by `dataType`. A data item with no renderer there renders nothing, never the JSON fallback, so it stays invisible in the UI and readable by code. `renderers.component` no longer draws items: it holds only the renderers a `suspension` item names with `render.component`. Move `renderers={{ component: { x: X } }}` to `renderers={{ data: { x: X } }}`; `X` receives `{ item: DataItem }`. Keyed data items dedup per request and key, and a container renderer manages the data items it owns. `useContainerItems` reads a container's `state` from its latest data item whose `dataType` is the container's `component`; `componentsByKey` is renamed `dataByKey`, with no alias.
  - **testing:** `testItems(items).components()` is removed; use `testItems(items).data(dataType?)`.
  - **orchestration:** `task-change`, `task-board-meta`, `task-board-recorder-failure` and `goal-seek-loop-termination` are data items. The constants are renamed, with no alias: `TASK_CHANGE_DATA_TYPE`, `TASK_BOARD_META_DATA_TYPE`, `TASK_BOARD_RECORDER_FAILURE_DATA_TYPE`, `GOAL_SEEK_LOOP_TERMINATION_DATA_TYPE`. The recorder-failure and termination records reach no client.
  - **workforce:** `coordinator-route` and `workforce:received` are data items; `RECEIVED_MESSAGE_COMPONENT` is renamed `RECEIVED_MESSAGE_DATA_TYPE`, with no alias. An app renderer for either moves to `renderers.data` and reads `item.value`.
  - **patterns:** debate's `debate-turn`, `debate-turn-pending`, `debate-decision` and `debate-verdict`, event actors' `rb-entry`, routed specialists' `routedSpecialists` snapshot and the response auditor's `audit-annotation` are data items. An app renderer for one moves to `renderers.data` and reads `item.value`.
  - **ui registry:** the generative `link-card` and `info-card` tools emit data items, and their renderers register under `renderers.data`.
  - **devtool / shift-manager:** draw data items; the devtool's component item view is gone.

  **Stored sessions.** A request stored before this can hold `component` items. The request store reads each one back as a data item (`component` → `dataType`, `data` → `value`, same status and key), in a record and in a replayed or resumed stream, so every reader sees data items. A keyed item's id reads back as `item_data_keyed:<key>`, so a resumed request's next snapshot of that key replaces it. This applies on every entry that runs flows (`createFlowState`, `createFlowApiRouter`, `runAction`, `fsdev run`, `dev` and `chat`); host code reading a store directly, past those entries, sees the stored shape. Nothing is rewritten in the store.

  Docs: apps/docs/docs/streaming/emitting-items.md (one item kind for structured content: `ctx.emit.data`, `value`, keyed snapshots, default visibility, drawing through `renderers.data`; remove every `ctx.emit.component` section), apps/docs/docs/streaming/overview.md and apps/docs/docs/configuration/blocks.md (emitter tables), apps/docs/docs/client/react.md, apps/docs/docs/api/react.md and packages/react/README.md (`renderers.data`, `renderers.component` for suspensions only, `useContainerItems` `dataByKey`), packages/core/README.md (emitters), apps/docs/docs/orchestration/task-board.md, apps/docs/docs/orchestration/task-substrate.md, apps/docs/docs/sequencers/wait-for-condition.md and packages/orchestration/README.md (task records are data items, renamed constants), apps/docs/docs/patterns/plan-and-execute.md, apps/docs/docs/patterns/response-auditor.md, apps/docs/docs/patterns/event-actors.md and packages/patterns/README.md (pattern records are data items, renderers go under `data`), apps/docs/docs/ui/flow-aware-components.md and packages/ui/README.md (generative cards and the chat registry use the `data` slot), apps/docs/docs/workforce/coordinators.md, packages/workforce/README.md and packages/shift-manager/README.md (routing records and received messages are data items, renamed constant), apps/docs/docs/api/testing.md, apps/docs/docs/testing/testing-flows.md, apps/docs/docs/testing/overview.md and packages/testing/README.md (`testItems().data()`, `components()` removed).

- 5c7de6e: `withRetiredShapes` is removed from `@flow-state-dev/orchestration/tasks`. A stored task is read only in the current shape: status `blocked` is not read as `held`, and a hold whose marker is `"row"` is not read as `"task"`. `heldFromBlocked` is removed. A write against a row whose status is not a current status is declined `unknown-status`, and the row is left as stored. There is no alias and no migration (FIX-2833).

  Docs: apps/docs/docs/orchestration/task-substrate.md

- c7ce9ff: A flow's `reads` are removed; views replace them (FIX-2623).

  - **core, breaking:** `defineFlow` refuses a `reads` key with an error naming views, rather than defining the flow and serving nothing. `ReadConfig` and `ReadEntry` are removed from `@flow-state-dev/core` and `@flow-state-dev/core/types`, with no alias. Declare each read as a session view instead: `views: { name: defineView({ scope: "session", block }) }` (the block declares its `outputSchema`).
  - **engine, breaking:** the read route, `POST /api/flows/:flowKind/:sessionId/reads/:readName`, is gone, and so is `runRead` from `@flow-state-dev/engine/internal`. A session view answers at `POST /api/flows/:flowKind/:sessionId/views/:viewName` with `{ output, topics }`.
  - **client, breaking:** `client.flow(kind).read(name, input, { sessionId })` is removed. Call `client.view(viewRef(flow, name), input, { sessionId })`, or `useView` in React, which also keep the answer current from the topics it names.
  - **orchestration, breaking:** `taskToolReads` is removed from `@flow-state-dev/orchestration/internal`. A board's task list is `taskToolViews(collectionId, resolve)`, watched through `taskListViewRef(flow, board)`.
  - **workforce:** the coordinator, the agent worker flow and `defineSessionBoard` serve the conversation's task list as the session view `listTasks_tasks` only; `defineSessionBoard(...).reads` is gone (spread `views` instead).

  Docs: packages/core/README.md and packages/engine/README.md (reads, `ReadConfig`, the read route and `runRead` leave), packages/client/README.md (`flow(kind).read` leaves; `client.view`), packages/orchestration/README.md (`taskToolReads` leaves), packages/workforce/README.md (`defineSessionBoard`'s `reads` leaves), packages/harness-manager/README.md (the run-changes section: `POST .../reads/changes` becomes the `harnessRunChangesView` session view), apps/docs pages on flow reads (retire; point at Views).

- e5a9596: The Inbox client's board actions (`inbox.board(at)`) gain `get(id)`: one task as the board's `getTask` reads it, its brief (context, labels, priority) whole. Read a task with it before `refile` so a re-run keeps a long brief (FIX-2773). The read's type is exported as `BoardTaskRead` from `@flow-state-dev/orchestration/inbox`.
- 556aabe: An Inbox suspension may come from a run with no conversation: `InboxSuspension.sessionId` and a suspension hold's `source.sessionId` are `string | null`, and such a hold answers through its flow alone. `InboxSuspension.due` (the ask's deadline) becomes the hold's `due` (FIX-2774).

  Docs: apps/docs/docs/orchestration/task-board.md (the Inbox: an ask with no conversation)

- c049036: The task shapes no published orchestration wrote (`questions`, `keptOpenBy: "wait"` or `"queued"`, the recorded-not-started mark, `reopened`, a post row) no longer read, and `taskSchema` refuses `keptOpenBy: "wait"`. The board's `onReview` option, the collection's `"sequencer"` and `"request"` backings, and a SKILL.md `agents:` block are no longer refused by name: the backings fail as unknown backings, and `onReview` and `agents:` are ignored like any unknown key. `SkillAgentsRemovedError` is gone. Also gone are the refusals of `expectAttempt`, an assignee's `dispatch: { mode }`, `{ block, session }` or `{ worker, dispatch }` (still refused as not a block), SKILL.md `context: fork` / `pattern`, `pattern:` and `workers:`, `createTask`'s `waitForResponse` and `updateTask`'s `question`. A stored `status: "blocked"` row still reads as `held` (FIX-2454).

  Docs: packages/orchestration/README.md (drop "a row stored with the old names still reads"; only a stored `blocked` row reads, as `held`). The old names and shapes are removed outright, with no refusal message.

- b43424c: A change notice names what changed, so a screen can re-read only those rows (FIX-2625).

  - **contracts / client:** `WireNotice` gains `ids?: string[]`: the ids of what changed, never its data. Absent means read everything. A `board` notice names the tasks whose rows changed, a collection entry's `resource` notice names the entry's storage key (only when its path may be named: never an owner-private row or a user-scope entry), a `run` notice on a parent session's topic names the child session (on a user's own topic it names nothing, since that topic spans the user's orgs), and a `request` notice names the request. `items`, `state` and `resync` name nothing. `client.live` and `client.subscribe` pass them through; notices of one topic and kind waiting on a read union their ids, up to 100, past which a notice names none.
  - **engine:** `createFlowState({ noticeIds: { org: false } })` (also on `createFlowApiRouter`) turns ids off for a topic scope, for an app where even the timing of an org's changes is sensitive. No notice of that scope reaches a browser with ids, and a resource notice reaches a scope-wide subscription with no path, so every resource watcher in that scope reads everything on any resource change. On by default. A key other than `session`, `user` or `org`, or a non-boolean value, is refused at startup.
  - **store-postgres:** the Postgres bus carries ids across processes; a notice too large for `NOTIFY` drops its ids before it is widened to its scope.
  - **orchestration:** a task board's change notice names the task.

  A client from before this change ignores `ids` and reads everything, as before.

  Docs: apps/docs/guides/realtime.md (ids on a notice; turning them off per scope with `noticeIds`), apps/docs/docs/api/client.md (`WireNotice.ids`), apps/docs/docs/persistence/overview.md (what the Postgres bus carries), packages/client/README.md (`WireNotice.ids`), packages/engine/README.md (`noticeIds`), packages/core/README.md (notice ids)

- 80175df: **Breaking:** names only FSD's own packages read move to a new `@flow-state-dev/orchestration/internal` entry, and names nothing reads are no longer exported (FIX-2459). `./internal` is published so sibling packages resolve it, but it is not for apps and sits outside semver. There are no deprecated aliases: an old import fails to compile with "has no exported member".

  - **Moved to `./internal`** from the root: `payBoardDebts`, `settlePassWake`, `takeOwedNotice`, `splitFrontmatter`, `parseFrontmatterYaml`, the lease-renewal scope (`openLeaseRenewalScope`, `withLeaseRenewalScope`, `stampLeaseRenewal`, `currentLeaseRenewal`), `TASK_SESSION_TASK_KEY`, `taskToolReads`, `taskToolsForTurn`, `taskToolSuffix`, `readTaskView`, `STATUS_NOTE_LIMIT`, the steer-context helpers and `pushActiveSkill`. From `./tasks`: both backing constructors (`createStateBackedTaskCollection`, `createResourceBackedTaskCollection`), `TASK_SETTLED_ENTRY`, `filerResolver`, the filing asserts, the notice helpers, the steer helpers, `readCommittedTask`, `taskLedgerResources`, `findTaskPartitions`, `TaskWriteRefusedError` and the rest the census found only our packages read. From `./task-board`: `taskBoardStateSchema`, `afterTaskCheck`, `packWorkerInput`, `checkWaitable`, `toolCallOf` and the board's component-type markers. Open a collection with `defineTaskCollection` or `getOrCreateTaskCollection`.
  - **One home each:** `taskToolActions` is on `./task-board` only, no longer on the root. `isTaskTurn` is on the root only, no longer on `./task-board`. `TaskSessionPolicy` is imported from `@flow-state-dev/core/types`.
  - **No longer exported**, with no reader: from the root, `camelToKebab`, `kebabToCamel`, `buildSkillsCatalogContext`, `buildActiveSkillsContext`, `ensureSeeded` and other skill-format internals; from `./tasks`, the observation-ledger constructors, `isDefinedTaskCollection`, `freezeLedgerAssignee`, the cap defaults and lease bounds; from `./task-board`, the board's own block factories (`createClaimTask`, `createCheckBoard`, `createTaskGate`, `createSeedCollection`, …) and their state schemas.

  Docs: packages/orchestration/README.md (one line saying `./internal` is not for apps; move the passages on the pass pair, the filing asserts, `taskToolReads` and the lease-renewal scope to `docs/architecture/`; name `taskToolActions` from `./task-board`; document the skill-format API the docs site already describes in prose: `parseSkillMd`, `serializeSkillMd`, `ParsedSkillMd`, `ParseSkillMdOptions`, `createRunSkillTool`, `RunSkillToolOptions`, `inlineActivate`, `matchedSkillSchema`, `skillActivationSourceSchema`, `MatchedSkill`, `SkillActivationSource`, `SkillState`, `SkillContextMode`); and the orchestration row of the page on what each package root is for: the root for skills, the task-turn test and the settled entry, `./internal` for FSD's own packages

- b9bb900: **Breaking:** the task board has two named claim orders, `"fifo"` and `"priority"`, and `"fifo"` is the default (FIX-2459). `topologicalClaimOrder` and the `"topological"` name are removed. They had `fifoClaimOrder`'s body: neither claims a task with unmet `deps`, because the collection's own admission rule gates on them. A board that names no claim order behaves as before. Replace `claimOrder: "topological"` with `claimOrder: "fifo"` (or drop the option), and `topologicalClaimOrder` with `fifoClaimOrder` from `@flow-state-dev/orchestration/tasks`. There is no alias: the old name fails to compile.

  Docs: packages/orchestration/README.md, packages/patterns/README.md, apps/docs/docs/orchestration/task-board.md, apps/docs/docs/orchestration/task-substrate.md, apps/docs/docs/orchestration/configuration.md, apps/docs/docs/glossary.md, apps/docs/guides/building-a-research-team.md (two claim orders, `fifo` the default; drop `topologicalClaimOrder` and the "behave identically" line; `claimOrder: "topological"` examples become `"fifo"` or drop the option)

- fabd6a7: **Breaking:** the task substrate's names are no longer exported from the `@flow-state-dev/orchestration` root. Import them from `@flow-state-dev/orchestration/tasks`, their one home, which is safe to bundle for a browser (FIX-2459). This covers every name on `./tasks`, about 220, among them `defineTaskCollection`, `getOrCreateTaskCollection`, `taskSchema`, `Task`, `TaskCollectionRef`, `flowPolicy`, `ticketForClaim`, `beginTaskWrite`, `onTaskChangeFor` and `ShownSteer`. There are no deprecated aliases: an old root import fails to compile with "has no exported member". The root keeps skills, `resolveCatalogTools`, `isTaskTurn` and the `taskSettledEntry` family.

  Docs: packages/orchestration/README.md, packages/patterns/README.md, apps/docs/docs/orchestration/task-substrate.md, apps/docs/docs/orchestration/flow-policy.md, apps/docs/docs/sequencers/wait-for-condition.md (import task names from `@flow-state-dev/orchestration/tasks`, not the root; the orchestration README's header line "depends only on core" is also wrong, it depends on client too)

- de09b77: **Breaking:** 1,107 exports are removed from the roots of the published `@flow-state-dev/*` packages, with no deprecated aliases, so importing one from a package root no longer compiles; some of them are still exported from another entry of the same package (FIX-2562).
- c82adfa: **Breaking:** one word for a stored thing, _resource_, and _Status_ for a lifecycle (FIX-2479). Exported names that said _row_ or _collection item_ for a resource, or _row_ for a task, are renamed, with no aliases. Stored field names, storage keys and HTTP paths do not change: a worktree record keeps its `state` field, now typed `WorktreeStatus`.

  ### Renamed exports

  | Package                            | Old                                                      | New                                                                                        |
  | ---------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
  | `core` (`/internal`)               | `WaitRow`                                                | `TaskAddress`                                                                              |
  | `core` (`/harness`)                | `planRowsPrefix`                                         | `planResourcesPrefix`                                                                      |
  | `core` (`/harness`)                | `readPlanTarget(...)` result field `rowsPrefix`          | `resourcesPrefix`                                                                          |
  | `core`                             | `SessionCreateCheckInput.readCollectionItem(ref, topic)` | `readCollectionResource(ref, topic)`                                                       |
  | `engine`                           | `DebugCollectionItem`                                    | `DebugCollectionResource`                                                                  |
  | `engine`                           | `DebugCollectionItemsResponse`                           | `DebugCollectionResourcesResponse` (its `items` wire field is unchanged)                   |
  | `engine`                           | `ResourceIndexBuildState`                                | `ResourceIndexBuildStatus`                                                                 |
  | `workspace`                        | `WorktreeRow`                                            | `WorktreeResourceState`                                                                    |
  | `workspace`                        | `worktreeRowSchema`                                      | `worktreeResourceStateSchema`                                                              |
  | `workspace`                        | `WorktreeState`                                          | `WorktreeStatus`                                                                           |
  | `workspace`                        | `worktreeStateSchema`                                    | `worktreeStatusSchema`                                                                     |
  | `scheduled`                        | `ScheduleIndexRow`                                       | `ScheduleIndexEntry` (one schedule's entry in the schedule index)                          |
  | `client`                           | `CollectionItemHandle`                                   | `CollectionResourceHandle`                                                                 |
  | `client`                           | `CollectionItemState`                                    | `CollectionResourceState`                                                                  |
  | `client`                           | `CreateCollectionItemOptions`                            | `CreateCollectionResourceOptions`                                                          |
  | `client`                           | `ListCollectionItemsOptions`                             | `ListCollectionResourcesOptions`                                                           |
  | `client`                           | `DebugCollectionItem`                                    | `DebugCollectionResource`                                                                  |
  | `client`                           | `DebugCollectionItemsResponse`                           | `DebugCollectionResourcesResponse` (its `items` wire field is unchanged)                   |
  | `client`                           | `ListDebugCollectionItemsOptions`                        | `ListDebugCollectionResourcesOptions`                                                      |
  | `client`                           | `client.resources.listCollectionItems`                   | `listCollectionResources`                                                                  |
  | `client`                           | `client.resources.createCollectionItem`                  | `createCollectionResource`                                                                 |
  | `client`                           | `client.resources.getCollectionItemState`                | `getCollectionResourceState`                                                               |
  | `client`                           | `client.resources.getCollectionItemContent`              | `getCollectionResourceContent`                                                             |
  | `client`                           | `client.resources.deleteCollectionItem`                  | `deleteCollectionResource`                                                                 |
  | `client`                           | `client.sessions.debug.listCollectionItems`              | `listCollectionResources` (the debug route's URL is unchanged)                             |
  | `client`                           | `client.sessions.debug.fetchCollectionItemContent`       | `fetchCollectionResourceContent`                                                           |
  | `client`                           | `SessionConnectionState`                                 | `SessionConnectionStatus`                                                                  |
  | `react`                            | `useResourceCollectionItem`                              | `useCollectionResource` (its result's `item` field is unchanged)                           |
  | `react`                            | `UseResourceCollectionItemResult`                        | `UseCollectionResourceResult`                                                              |
  | `react` (`/workforce`)             | `PanelRowSource`, `PanelItemSource`                      | unchanged names; they now pick `listCollectionResources` and `getCollectionResourceState`  |
  | `orchestration` (`/tasks`)         | `rowHoldSchema`                                          | `ownHoldSchema` (a task's own hold: a question, a confirm or an external wait)             |
  | `orchestration` (`/tasks`)         | `RowHold`                                                | `OwnHold`                                                                                  |
  | `orchestration` (`/inbox`)         | `RowHoldSource`                                          | `OwnHoldSource` (its `kind` is `"task"`, was `"row"`)                                      |
  | `orchestration` (`/inbox`)         | `InboxRow`                                               | `InboxTaskInput`                                                                           |
  | `orchestration` (`/inbox`)         | `RefileRow`                                              | `RefiledTask`                                                                              |
  | `orchestration` (`/inbox`)         | `taskRowView(row, holds?)`                               | `taskView(task, holds?)`                                                                   |
  | `orchestration` (`/inbox`)         | `TaskRowView`                                            | `TaskView`                                                                                 |
  | `orchestration` (`/inbox`)         | `TaskViewRow`                                            | `TaskViewInput`                                                                            |
  | `orchestration` (`/inbox`)         | `TaskRowState`                                           | `TaskViewStatus`                                                                           |
  | `orchestration` (`/inbox/check`)   | `RowTruth`                                               | `TaskTruth` (its `rowHolds` field is `ownHolds`)                                           |
  | `orchestration` (`/inbox/check`)   | `rowTruthOf`                                             | `taskTruthOf`                                                                              |
  | `orchestration` (`/internal`)      | `isRowHold`, `openRowHolds`                              | `isOwnHold`, `openOwnHolds`                                                                |
  | `orchestration` (`/internal`)      | `rowsInSession`                                          | `tasksInSession`                                                                           |
  | `engine` (`/internal`)             | `OwnerRunRefusal` value `"no_row"`                       | `"no_resource"`                                                                            |
  | `harness-manager`                  | `HarnessReadinessRow`                                    | `HarnessReadinessView`                                                                     |
  | `harness-manager`                  | `harnessReadinessRowSchema`                              | `harnessReadinessViewSchema`                                                               |
  | `harness-manager`                  | `HarnessUsageRow`                                        | `HarnessUsageView`                                                                         |
  | `harness-manager`                  | `HarnessUsageWindowRow`                                  | `HarnessUsageWindowView`                                                                   |
  | `harness-manager` (and `/browser`) | `PullRequestRecordRow`                                   | `PullRequestRecordResourceState`                                                           |
  | `harness-manager` (and `/browser`) | `PullRequestWaitRow`                                     | `PullRequestWaitInput`                                                                     |
  | `harness-manager`                  | `PlaceState`                                             | `PlaceStatus` (a run record's place keeps its `state` field, now typed `PlaceStatus`)      |
  | `harness-manager`                  | `placeStateSchema`                                       | `placeStatusSchema`                                                                        |
  | `harness-manager`                  | `readRunRow`                                             | `readRunRecord`                                                                            |
  | `workforce`                        | `WorkerRow`                                              | `WorkerResourceState` (the worker's configuration, as stored)                              |
  | `workforce`                        | `workerRowSchema`                                        | `workerResourceStateSchema`                                                                |
  | `workforce`                        | `parseWorkerRow(value)`                                  | `parseWorkerResourceState(value)`, answering `{ worker }` (was `{ row }`) or `{ problem }` |
  | `workforce`                        | `StandardWorkerRow`                                      | `StandardWorkerResourceState`                                                              |
  | `workforce`                        | `standardWorkerRowSchema`                                | `standardWorkerResourceStateSchema`                                                        |
  | `workforce`                        | `ProjectRow`                                             | `ProjectResourceState`                                                                     |
  | `workforce`                        | `projectRowSchema`                                       | `projectResourceStateSchema`                                                               |
  | `workforce`                        | `WorkerInventoryRow`                                     | `WorkerInventoryResourceState`                                                             |
  | `workforce`                        | `workerInventoryRowSchema`                               | `workerInventoryResourceStateSchema`                                                       |
  | `workforce`                        | `SubscriptionRow`                                        | `SubscriptionResourceState`                                                                |
  | `workforce`                        | `subscriptionRowSchema`                                  | `subscriptionResourceStateSchema`                                                          |
  | `workforce` (and `/browser`)       | `WorkerMessageRow`                                       | `WorkerMessageResourceState`                                                               |
  | `workforce` (and `/browser`)       | `workerMessageRowSchema`                                 | `workerMessageResourceStateSchema`                                                         |
  | `workforce`                        | `WorkerUsageRow`                                         | `WorkerUsageView` (one worker's line in the `workerUsage` query's answer)                  |
  | `workforce`                        | `ReportRow`                                              | `ReportResourceState`                                                                      |

  ### For client developers: values and messages an app branches on or matches

  Code that branches on one of these values, or matches one of these messages, changes when it upgrades. In each message only the noun changes; the rest of the sentence is the same.

  | What                                                                                            | Old                                                                             | New                                                                                                                  |
  | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
  | A task's own hold (`Task.holds[].source.kind`, and the Inbox's `InboxHold.source.kind`)         | `"row"`                                                                         | `"task"`. A hold stored as `"row"` still reads as `"task"` and can still be answered; `"row"` is never written again |
  | Dispatch refusal (`DispatchOutcome.refused`)                                                    | `"external-dispatcher"`                                                         | `"external-flow-runner"`                                                                                             |
  | Owner-private refusal                                                                           | starts "A row of an owner-private …"                                            | "A resource in an owner-private collection is readable only by the user it belongs to."                              |
  | Owner-writes refusal                                                                            | starts "A row of an owner-writes …"                                             | "A resource in an owner-writes collection is written only by the user it belongs to."                                |
  | Startup overlap error                                                                           | `Collection pattern "<P>" can reach the rows of owner-<mode> collection "<Q>".` | `Collection pattern "<P>" can reach the resources of owner-<mode> collection "<Q>".`                                 |
  | Owner-segment refusal ("That segment is reserved for the user an owner-private collection's …") | "… row belongs to, …"                                                           | "… resource belongs to, …"                                                                                           |

  Every other error and refusal message that said _row_ follows one rule: _task_ where the row was a task (dispatch, the task board, the ledger), _resource_ elsewhere, and _collection resources_ for _collection items_. In this release that covers the task board's, the task entry's, the ledger's and the task collection's errors in `orchestration` (and the `listTasks` tool's description a model reads), the Inbox check's drift lines, the dispatcher's and `defineFlow`'s task-entry errors, the faceted and owner-writes collection errors in `core`, the parent-task, owner-run and cross-board errors in `engine`, the schedule-index warning in `scheduled`, the harness manager's superseded-attempt, run-record, worktree-resource, phase-mismatch and foreign-run errors and the scripted coder's steps and commit message in `harness-manager`, the worker inventory's, the shadowed-reference, the hire and roster-loader document, the project-read tool's description and the project-link errors in `workforce`, and the DevTool's "Failed to fetch collection resources" (was "…collection items").

  Docs: every published page and package README that still names a renamed export or value, by page, with the names it uses. Pages: `docs/glossary.md` ("A task is a row", "A project is one row", "One row, in user or org scope", "A resource row") and `docs/resources/collections.md` (the collections pages say _resource_; collections.md also quotes the owner-private and owner-writes refusals and the overlap error, and names `CollectionItemHandle`); `docs/workforce/projects.md` (quotes the owner-writes refusal; `getCollectionItemContent`); `docs/orchestration/task-substrate.md` (the hold marker `"row"` is `"task"`, and its refusal tables' `external-dispatcher` is `external-flow-runner`); `docs/advanced/concurrency-policies.md`, `docs/server/background-work.md` and `guides/keeping-a-flow-running.md` (`external-dispatcher`); `docs/tools/coding-agents.md` (`planRowsPrefix`, `readPlanTarget`'s `rowsPrefix`); `docs/fundamentals/state-and-scopes.md` (`readCollectionItem`); `docs/api/client.md` (`CollectionItemState` and the client methods `listCollectionItems`, `createCollectionItem`, `getCollectionItemState`, `getCollectionItemContent`, `deleteCollectionItem`); `docs/client/overview.md` (`listCollectionItems`, `getCollectionItemState`); `docs/client/react.md` (`CollectionItemHandle`, `useResourceCollectionItem`); `docs/resources/client-access.md` (`createCollectionItem`, `getCollectionItemContent`, `deleteCollectionItem`, `useResourceCollectionItem`); `docs/workforce/delegating-work.md`, `docs/workforce/inventory.md` and `docs/workforce/ui.md` (`listCollectionItems`); `guides/writing-ui-stories.md` (`resources.listCollectionItems`, `getCollectionItemState`, and the story fixtures `loadingRowsSource` and `failingRowsSource`, now `loadingResourcesSource` and `failingResourcesSource`); `docs/workforce/messaging-workers.md` (`workerMessageRowSchema`); `docs/orchestration/harness-manager.md` (its readiness section: `HarnessReadinessRow`, `harnessReadinessRowSchema`); `docs/orchestration/task-board.md` (`taskRowView`); `docs/server/schedule-index.md` and `guides/scheduled-dynamic.md` (`ScheduleIndexRow`). READMEs, each with the old names it still uses (the tables above give the new ones): packages/core/README.md (`planRowsPrefix`, `readPlanTarget`'s `rowsPrefix`, `useResourceCollectionItem`, `external-dispatcher`, and a quote of the owner-writes refusal); packages/claude-code/README.md and packages/cursor/README.md (`readPlanTarget`'s `rowsPrefix`); packages/client/README.md (`CollectionItemState`, `listCollectionItems`, `createCollectionItem`, `getCollectionItemState`, `getCollectionItemContent`, `deleteCollectionItem`, `SessionConnectionState`); packages/react/README.md (`CollectionItemHandle`, `resources.listCollectionItems`, `resources.getCollectionItemState`, `useResourceCollectionItem`); packages/orchestration/README.md (`taskRowView`, `rowsInSession`); packages/harness-manager/README.md (`openRowHolds`, `HarnessReadinessRow`, `harnessReadinessRowSchema`, `HarnessUsageRow`, `readRunRow`); packages/workforce/README.md (`listCollectionItems`, `taskRowView`, `workerRowSchema`, `parseWorkerRow`, `WorkerInventoryRow`, `workerInventoryRowSchema`, `subscriptionRowSchema`, `WorkerMessageRow`, `workerMessageRowSchema`, `WorkerUsageRow`, and a quote of the owner-writes refusal); packages/engine/README.md (`no_row`). packages/workspace/README.md (a worktree record is `WorktreeResourceState`, its `state` field typed `WorktreeStatus`, parsed with `worktreeStatusSchema`).

- 81c145c: A task filed with files keeps them in its brief, and every run of the task gets them (FIX-2522).

  - **orchestration:** a task has `attachments`, its brief's files as stored references, beside `context`. `createTask` fills it with copies of every file the turn that files the task carried; a model can't set it, and `updateTask` takes no files. Like `context`, the files are fixed once the task starts (`TASK_FIELD_RULES.attachments`). Every run is handed them on its input (`TaskWorkerInput.attachments`). When the turn's files can't be kept (a server with no blob store), `createTask` refuses with `task_files_not_kept` and files nothing.
  - **core:** `attachmentReferenceSchema` (`@flow-state-dev/core/attachments`) reads a stored file's reference and refuses bytes. An action's `userMessage` may return `attachments`: files the flow kept itself, written on the line after the user's own.
  - **engine:** a task's copies belong to the user's own scope, not the conversation, so deleting the conversation leaves them. Any run of that user reads them, in any session; nobody else's does. `GET /api/flows/blobs/:id` serves them to that user only, signed in as the flow that kept them signs them in; anyone else, an anonymous caller included, gets 404.
  - **workforce:** a conversation's task run opens with the brief's files on its brief line, so a generator worker's model reads them with the brief. The board's browser read carries `attachments`.
  - **harness-manager:** a task's coding run hands the harness the brief's files beside the prompt on every attempt. A harness that declares no `accepts` is never handed one: the attempt fails, naming the file.
  - **shift-manager:** every composer (a task's, a workstream's, Inbox's reply, the Shift Coordinator's) takes files by paste, the + button or a drop, and sends them with the line. A line that fails to send keeps its files for Retry. A task's brief shows its files on the task screen and on the brief line in its session.

  Docs: the Shift Manager README gains _Attaching files_ (composers, a task's brief, Retry). The orchestration README's task fields gain `attachments`. The attachments guide gains a line: a task filed from a message keeps its own copy of that message's files.

- c9d33ff: A model's `createTask` with no assignee files the task only where something will run it (FIX-2735).

  - **orchestration:** with a roster, `createTask` files a task with no assignee unassigned only when the roster sets the new `claimsUnassigned: true` (the board's default worker takes a task naming nobody). Otherwise it files the task for the roster's `soleAssignee()` when it names one, files it unassigned when it is `held: true`, and else answers `assignee_required`, listing the roster, and files nothing. `unknown_assignee` offers to leave the assignee unset only on a `claimsUnassigned` roster. `taskToolActions` are unchanged: an action may still file a task with no assignee. To keep the old behaviour on a board whose default worker claims unassigned tasks, add `claimsUnassigned: true` to its roster.
  - **workforce:** a worker's `createTask` with no assignee, in a conversation with several delegates that take tasks, is refused with `assignee_required` instead of waiting on the board, unassigned, with nothing to start it. `createTask_tasks` is unchanged.

  Docs: packages/orchestration/README.md (the `taskTools` passage on the roster: with a roster, a model's `createTask` with no assignee files the task unassigned when the roster sets `claimsUnassigned: true`, for the roster's one worker when `soleAssignee()` names one, and unassigned when filed `held: true`; otherwise it answers `assignee_required`, listing the roster, and files nothing; `taskToolActions` may still file a task with no assignee, for its caller to assign later), packages/workforce/README.md ("Splitting a task": an unassigned piece goes to the worker's delegate when it has exactly one; with several, `createTask` refuses it with `assignee_required`, listing them, unless it is filed `held: true`), apps/docs/docs/workforce/coordinators.md (after "A task with no assignee goes to the conversation's only delegate…": a worker's own `createTask` with no assignee and no `held: true`, with several delegates, is refused with `assignee_required`, which lists the delegates, and nothing is filed; `createTask_tasks` still files it unassigned), apps/docs/docs/workforce/delegating-work.md (splitting a task: the same refusal for a piece with no assignee when the worker has several delegates, unless held).

- bb95ce1: A coordinator can hear what nobody else heard on a PR, issue or repository it follows, and its `inferredWork:` decides what its turn may do with work nobody asked for (FIX-2538).

  - **Subscribing unmatched:** an event routine's trigger takes `unmatched: true`, in a coordinator's conversation only (`not_a_coordinator` elsewhere). Such a subscription hears an event only when no other subscription heard it, and only the event types the app forwards. `defineCoordinatorFlow({ routines: true })` gives the coordinator flow the routine actions (`saveRoutine` and the rest), on the providers `hireWorkforce`'s `routines.providers` names.
  - **Forwarding:** `defineSubscriptionServiceFlow` and `githubServiceFlow` take `forwards`, the event types the app forwards. Without it nothing is forwarded. An event a screen couldn't judge (`interest: unjudged`, or `<screen>: failed`) is never forwarded. The routing entry's output gains `unmatched: { forwarded, dropped? }`, which counts each unheard event and says why none heard it.
  - **The mark:** the delivery marks each forward `addressed` (the event's `addressed`) or `inferred`, on the message's new optional `forward` field. A model never writes it.
  - **`inferredWork:`** on a coordinator's `WORKER.md`: `observe` (the default) runs the turn, and every task it files on an inferred forward waits on the user's yes, a confirm in the Inbox. Only a yes releases it: a No cancels it, no host deadline closes it, a cancelled one can't be retried (`inferred_needs_a_yes`), and the turn its ending wakes files under the same rule. A step for itself, or a message to another worker, is refused on that turn. `auto` runs the turn as any other. `off` lands an inferred forward as a line and runs no model. An addressed event runs in every mode.

  - **orchestration:** a question at filing can be `untimed: true`: no deadline, whatever the host's `userDeadlineMs`, so it closes only on an answer or the task's cancel. Server code sets it; the task tools don't pass it.

  Docs: packages/workforce/README.md (unmatched subscriptions, `forwards`, `inferredWork`), apps/docs/docs/workforce/messaging-workers.md (a forward as a message from the service), the coordinator guide (`inferredWork:` and the confirm)

- 1970b12: A keyed view can answer for just the rows a change touched, and a collection read re-reads just the entries that changed (FIX-2625).

  - **core:** in a view's run, `ctx.view.changed` is the notice that woke its watcher: its topic, kind and `ids`. It is set only when the notice named ids and the view declares a `key`. Return `ctx.view.partial(rows, { removed })` to answer for just those rows. A view that never calls it answers whole, as before. `partial` throws on a run with no change, or in a view with no `key`. A partial answer never reorders rows: answer whole wherever a change could move a row. A partial answer that brings a row the screen doesn't hold makes the screen read the view whole, since only a whole run says where it goes. New types: `ViewChange`, `ViewRunContext`.
  - **engine:** the view routes take `changed` in the body. A partial answer comes back as `{ output, topics, keys, partial: { removed } }`.
  - **client:** `client.view(ref, input, { changed })` sends the notice, and `ViewResult.partial` marks a partial answer. `watchView` (and so `useView`) asks a keyed view for just the rows a notice names, and places the answer by key over the rows it holds. In development and tests, it compares each partial answer with a whole run, logs the view's name when they differ, and shows the whole run.
  - **react:** `useResource` on a user or org collection re-reads just the entries a notice names, when it shows them all. A new entry, a notice with no ids, or an org with ids turned off still reads the collection.
  - **orchestration:** the board's task-list view (`taskToolViews`) answers a board notice with just the named tasks' rows and the rest of their follow-up chains.

  Docs: the Views page FIX-2623 adds at release (answering for the rows that changed: `ctx.view.changed`, `ctx.view.partial`, the never-reorder rule, the development check), apps/docs/guides/realtime.md (what a screen re-reads on a notice with ids), packages/core/README.md (`ctx.view`), packages/client/README.md (`client.view`'s `changed`, `ViewResult.partial`), packages/react/README.md (`useResource` re-reads named entries)

- 23bac7e: A view's watcher reads again only on a change to what the view read, and a task board's view re-reads only the tasks a change named (FIX-2625).

  - **engine:** a view's answer adds `hears`: for each of its topics, the kinds of change that may touch what its run read and, for a resource, the storage roots a change's path must fall under. A write to another resource of the same scope, or a run's own bookkeeping, no longer wakes it. A user-scope collection entry's change notice now names its collection's root (the static prefix of its pattern), never the entry's key, so a screen of another user resource can skip it.
  - **core:** new type `ViewHearing`, the shape of each `hears` entry: a topic, its `kinds`, and for a resource its `paths`.
  - **client:** `ViewResult.hears` carries it (`ViewHearing[]`), and `watchView` (and so `useView`) reads again only on a notice it admits, through the same path rule `client.live` uses. An answer from a server that sends no `hears` reads on every notice under its topics, as before.
  - **react:** a session collection list (`useResourceCollection`, `useResourceCollectionList`) reads once for one change. It holds each change signal (a named change, its count moving) for 50 ms and reads once after the last, and at least every 250 ms while signals keep coming. A list now shows a change up to 50 ms later than before.
  - **orchestration:** a view that reads a task board through its task collection hears the board's own notices, which name the tasks that changed, and no longer hears its ledger's notices on the user topic, which can't. Every write to a task ledger publishes the board notice.

  Docs: the Views page (what a view's watcher reads again on), apps/docs/guides/realtime.md (a user-scope entry's notice names its collection's root; a board view hears its board's notices), packages/core/README.md (`ViewHearing`, the shape of a view answer's `hears`), packages/client/README.md (`ViewResult.hears`)

- 1f46aaf: A view can read the caller's own sessions, and workforce serves a user's sessions with a worker and one session's turns as live views (FIX-2725).

  - **core, engine:** the request host's `sessions` gains `list` (the caller's top-level sessions, filtered by flow and by readonly state fields, newest first, at most 100 with a `more` flag, and an `offset` to read on past them) and `turns` (one session's requests, or up to 100 sessions' at once, by status and action: id, action, status, source, times and error, never the words; at most 50 a session). `read` also answers the session's `lineageId`, which is for server reads only. Each answers only the caller's own sessions (same user, tenant and organization); another's reads as one that doesn't exist.
  - **engine:** a user view may now make these reads, as a session view may; an org view still can't. In a view, each session read also passes the per-row check the HTTP session list applies: a session of a flow with its own sign-in answers only when that sign-in accepts this caller, and a write session never. A view hears what changes each read: the list on the caller's session changes and request statuses, a session's turns on its requests and on its deletion or recreation, a session's flow and lineage on its deletion or recreation. None wakes a view once per streamed chunk.
  - **orchestration:** `getOrCreateTaskCollection` takes `readFor` on a resource-backed board: the conversation a view reads the board for, in the running session's place. A user view, which runs in no session, can now read a conversation's board, and hears its first task filed.
  - **workforce:** the roster flow serves two user views. `workerSessionsViewRef()` with `{ worker }` answers the user's conversations with a worker: id, title ("Untitled" until one is set), last change, whether a turn runs in it, its `state` (the exposed and readonly fields the HTTP session list shows the caller), `isDefault` (the default first, then by latest activity), and the tasks of its board waiting on the user, by id and attempt. `sessionTurnsViewRef()` with `{ sessionId }` answers that session's turns, oldest first, by status; the words stay on the session stream. `TURN_ACTIONS` names the actions that run a turn. A client component types a row with `ListedWorkerSession` or `ListedTurn` from `@flow-state-dev/workforce/browser`, or with `@flow-state-dev/client`'s `ViewValueOf` on either ref.
  - **workforce:** `createWorkforceClient`'s `listWorkerSessions` and the `WorkerSessionEntry` type are removed, with no alias. To migrate, watch `workerSessionsViewRef()` with `useView`, or read it once with `client.view(workerSessionsViewRef(), { worker })`; each row's `id` and `isDefault` replace `entry.session.id` and `entry.isDefault`. A row's `state` carries what the HTTP session list shows the caller, not the session's whole state.

  Docs: the Views page gains "reading your sessions" (what a view may read of the caller's sessions, and when it hears a change); apps/docs/docs/workforce/workers-on-disk.md's "all their conversations" section moves from `listWorkerSessions` to the worker sessions view; packages/workforce/README.md (the `listWorkerSessions` paragraph and the `createWorkforceClient` row move to the two views; list `workerSessionsViewRef`, `sessionTurnsViewRef` and `TURN_ACTIONS`); packages/orchestration/README.md (`readFor` on `getOrCreateTaskCollection`).

### Patch Changes

- a27cf26: A task board open for one conversation no longer re-reads when a task is filed in another conversation of the same user (FIX-2750).

  - **contracts:** `WireNotice` gains an optional `partition`: on a `board` notice for a row added to a partitioned ledger, an opaque key for the partition the row went into. `ViewHearing` gains an optional `partitions`, the keys of the partitions a view's run read. `hearsNotice` skips a `board` notice whose `partition` the answer didn't read. A notice with no `partition`, or an answer that lists none, hears every board notice, as before.
  - **engine:** the push socket and the view route send a partition only as an HMAC-SHA256 key under the router's push secret, over the tenant and the partition. A key names no session and can't be matched by hashing guessed ids. Every process behind one address must share the push secret (`FSD_PUSH_SECRET`, or `serve({ pushSecret })`), which tickets already require. A host with no push names no partition in its answers. When the push secret changes while a socket is open (`secret: () => string`), the socket sends a `resync` on its topics before the first key made under the new secret, so every open view reads again.
  - **orchestration:** a partitioned task ledger (`partitionBy`) names its partition on each row-added notice and on each board read, so a conversation board hears only its own conversation's new rows.
  - **client:** a `partition` on a socket frame that isn't a string is dropped; the notice is kept.
  - **store-postgres:** the Postgres bus carries a notice's partition across processes, and drops it with the ids when the payload is too large.

  Docs: apps/docs/docs/api/client.md (the `onChange` notice can carry `partition` on a `board` notice: an opaque key to compare, never a session id)

- 9dde49f: A steer sent through the board now answers a running task's open `external` wait (FIX-2578).

  - **orchestration:** `updateTask`'s `message` (the Inbox's steer, an app's Steer box) and `ref.steer` answer a running task's open external wait in the same write, as a line typed in the task's session already did: the steer carries `answers`, and the same attempt is owed its turn. A task waiting on its pull request no longer sleeps with an untaken steer. The answer has its place under the steer cap kept, so a full task still takes it.
  - **workforce:** a board steer that answered a task's wait starts the turn it owes, in the task's session.

  Docs: packages/orchestration/README.md (the `external` hold: a board steer answers it, beside a line and a `"service"` answer).

- 77a6c9b: A task board's view now shows a row filed from a session it hadn't seen yet, and an org board's view no longer names other members' sessions (FIX-2625).

  - **orchestration:** every row added to a resource-backed task board publishes a board notice on the board's own scope topic (the session's, the user's or the org's). A board view hears it, so a row filed from another session or by another member shows without a reload. On the user topic the notice names no task.
  - **engine:** a view that reads an org-scope task board hears the org topic only: the board's notices for added rows, and its ledger's own change notices. Its answer's `topics` and `hears` no longer name the sessions rows were filed from. A session- or user-scope board still hears the sessions its rows were filed from, and now also the board's notices for added rows on its scope topic.

  Docs: apps/docs/guides/realtime.md (what a board view hears, by its ledger's scope)

- 8b5801a: A run that stops for a person after its task moved on no longer waits forever (FIX-2847). Before, a coding run whose task was cancelled while its judge read stopped for its review anyway. No row held that stop, and the cancel had found nothing to resume, so the run's request stayed `suspended`. A session's runs counted it as background work still running, and its review card could still be answered.

  Now, when the claim gate checks a request that stopped for a person, and the row has moved on before the gate could record that stop:

  - **The task ended** (cancelled, or finished): the stop is cancelled as the task's cancel would have, and the run asks nobody again.
  - **A later attempt or turn holds the task:** the old request's stop is ended as superseded. The task is not cancelled, and the newer claim's row is not written.
  - **Only the lease lapsed** (no other claim took the row): the gate takes the row back, as a lapsed holder may, and records the stop. The review waits for its person, as it does with no lapse.
  - **Taking the row back failed with an error** (not a refusal): the stop stays for its person, and a warning names the error. It is not ended, because the attempt may still own the row.

- a62f6d0: A steer that can't start a turn on a task with no live run says so (FIX-2859).

  - **orchestration:** `TaskWriteOutcome`'s `recorded` case may carry a `note`, which a wrapping ref sets when the write held but what should follow it didn't. `updateTask` returns it beside `ok: true` when a message's steer carries one.
  - **workforce:** a steer through a conversation board to a task with no run in a session answers `updateTask` with a `note` saying the message was recorded but no turn could be started, so the sender isn't told it is under way. `startOwedSteerTurn` now resolves to whether it started or owed the turn; a start the runtime refused counts as not started.

  Docs: packages/workforce/README.md, if it describes steering a parked task.

- 0e0df19: An app on workforce's client can stop one run, upload a file through a worker's flow, change a conversation's delegates and watch them live, without addressing a worker's flow itself (FIX-2776).

  - **workforce:** `WorkforceClient.send` sets each send's request id and resolves to `{ requestId }`, so a screen can match the line and its turn, or stop it, before the turn ends. It takes `taskId`, the task the line is sent from, and passes it only to a door that takes one (the worker inventory's `doorTakesTask` for the session's flow), so a strict door is never handed a key it refuses. A caller that awaited `send` for nothing gets a value it can ignore.
  - **workforce:** `WorkforceClient.stopRun(sessionId, requestId)` stops one run of a session through the flow it runs on; a run that already ended is no failure. `stopTurns` still stops every running turn.
  - **workforce:** `WorkforceClient.upload(worker, request)` uploads a file for a line through the worker's flow, whose sign-in the send runs; a first line with no session yet uploads this way too.
  - **workforce:** `WorkforceClient.addDelegate(sessionId, worker, note?)` and `removeDelegate(sessionId, worker)` change a conversation's delegates through its own actions, rejecting with the coordinator's reason.
  - **workforce:** every flow built on `defineSessionBoard` declares a `delegates` session view (`views`): what `listDelegates` answers, each delegate with what it does and takes, read without writing. Watch it with `useView(delegatesViewRef(flow), {}, { sessionId })` from `@flow-state-dev/workforce/browser`; it hears every change to the list, the coordinator's own tool's included. Reading it never pins the list, `delegates: all`'s included. A flow that builds its own `views` spreads `board.views` to get it.
  - **react:** `UseRequestStreamResult.completedAt` is when the followed request ended (the time of its ending status event), for a screen that follows one request by id rather than a session's latest turn.
  - **orchestration:** `TaskChangeKind`, `TaskBoardCounts` and `TaskBoardMeta`, the values of the `task-change` and `task-board-meta` items a board writes, are exported from `@flow-state-dev/orchestration/tasks`. `TaskChangeKind` is no longer exported from `./internal`. The board's task-list view and `listTasks_<board>` action (never the model's tool) carry a row's `error`, `deps` and brief `attachments`.

  Docs: packages/workforce/README.md (client section: `stopRun`, `upload`, `addDelegate`, `removeDelegate`, `send`'s `taskId` and answer, the delegates view), apps/docs/docs/workforce/delegating-work.md (the view beside `listDelegates`), packages/react/README.md (`useRequestStream`'s `completedAt`)

- 6407fbf: An action's answer is read with one call, by the request's id, however long its session is (FIX-2455).

  - **client:** `request.result({ pollMs?, timeoutMs?, signal? })` on every request handle polls the request by its id, as `wait()` does, with its stored result, and returns the read that found it settled. It resolves `{ status, output?, outputNotRecorded?, error? }` for every way a request settles: branch on `status`. A failure resolves `failed` with its `error`, and a stop for a user resolves `suspended`. It rejects only past `timeoutMs`, on a transport error, or when `signal` aborts. New types: `RequestResult` and `WaitOptions`. `wait()` takes `signal` too. Stopping either wait never stops the run. `steerRunningTurn` reads the steer's answer by id, so a steer behind 20 newer requests no longer reads as not taken.
  - **react:** `useAction({ action, result: true })`: `execute` resolves to `request.result()`'s shape, `loading` holds until the request settles, and an unmount stops the wait without stopping the run. Without the option, `execute` resolves on acceptance, as before.
  - **react (breaking):** `useReadFence` and `ReadFence` are no longer exported from `@flow-state-dev/react`. They moved to `@flow-state-dev/react/internal`, a subpath for the framework's own packages, with no alias. Apps should not import it.
  - **orchestration:** the Inbox client's board actions and row answers read the board's answer by request id. A session holding more than 2,000 requests no longer rejects an answer the board gave.
  - **workforce:** the Workforce client's roster and project actions (`hire`, `fork`, `edit`, `fire`, the standing rules and the work project) read their answer by request id, so a roster session longer than 100 requests no longer reads a finished action as unread.
  - **shift-manager:** actions, sent lines, interrupts and answered asks wait through the client's one wait and read their answer by request id.

  Docs: packages/client/README.md (a `result()` row in the request handle table, with its resolved shape and the rule that it resolves for every ending; `wait`'s `signal`; the _Sending an action_ example reads `const { status, output, error } = await sent.result()` instead of listing the session's requests), packages/react/README.md (`useAction`'s `result: true` option: what `execute` resolves to and how long `loading` holds; drop `useReadFence`), packages/engine/README.md (the status endpoint's `include_result_output` is what `result()` reads), apps/docs/docs/client/overview.md (_Sending an action_ and the _Requests_ table: `result()`), apps/docs/docs/fundamentals/actions.md (_From the client SDK_: read the answer with `sent.result()`), apps/docs/docs/api/client.md (`result` and `wait`'s `signal`), apps/docs/docs/client/react.md and apps/docs/docs/api/react.md (`useAction`'s `result` option), apps/docs/docs/fundamentals/flows.md (_Reads_: one line pointing at the `useSubscription` recipe in `client/react.md`), the package-roots page FIX-2448 adds, apps/docs/docs/api/package-roots.md (react's row gains `react/internal`: our packages' entry, not for apps)

- 91184e2: A stopped request settles the task it works when it ends, not when the task's lease lapses (FIX-2795).

  - **orchestration:** when a person stops a task's own request (the abort route, `ctx.session.stopRequest`), the request ends `aborted` and its task is **cancelled**, with the reason "The request working the task was stopped." The cancel is an ending like any other: rows that depend on the task are cancelled too, and the filer hears it. An answer the request gave before the stop is not taken. Before, the task was meant to fail its attempt, so the work the person stopped would run again.
  - **orchestration:** a person's stop of a later request admitted for a task (a steer's turn, a notice) fails nothing and cancels nothing, and its own answer is never taken. The steers it read are given back for the next turn. The task is then checked as it stands now: it waits again on what still holds it, or it owes a steer's turn.
  - **orchestration:** when nothing holds the task any more (its filed work ended under the stopped turn, say), a stopped later turn can now let the task complete on the answer its own request gave earlier.
  - **orchestration:** a stop from inside the process (`abortRequest(id)`, such as a host's shutdown) ends the request `interrupted`, and its attempt fails at once, so the task is free for its next claim, or fails if it has no attempts left. Before, the task stayed `in_progress` until its lease lapsed, and a durable continuation of the interrupted request could still settle it on the same attempt. Now that continuation finds its claim gone and writes nothing on the next attempt's row.
  - **orchestration:** `RecorderKind` gains `"cancel"`, the recorder named on a recorder-failure report when the cancel a stopped request owes its task fails to write. A `switch` over every kind gets a new case.
  - **core:** `onRequestEnded(ctx, hook, options?)` and `RequestEndSeam.add(hook, options?)` take `RequestEndHookOptions` (`{ writesOutliveAbort?: boolean }`, exported from `@flow-state-dev/core/internal`). A hook added with `writesOutliveAbort: true` keeps its resource writes when the request was stopped. Off by default.
  - **engine:** the request-end registry runs a hook added with `writesOutliveAbort` with its writes not stopped by the abort. A registry built without a way to do that refuses such a hook when it is added, rather than run it as any other.

- 3e7d5f3: The board's `listTasks` action (a client's read, not the model's tool) answers each row's `createdAt`, and its `startedAt` and `completedAt` once they happen, beside `updatedAt`. `taskRowView(row).times` now fills from a board read, so a screen can show how long a task has run and order ended tasks by when they ended (FIX-2395).

  Docs: the orchestration README's `listTasks` spend paragraph should name these times beside `updatedAt`.

- Updated dependencies [091a1dd]
- Updated dependencies [04812f3]
- Updated dependencies [801aa5e]
- Updated dependencies [61efa05]
- Updated dependencies [ffbe992]
- Updated dependencies [ec99b11]
- Updated dependencies [4b4a7d4]
- Updated dependencies [8e111c9]
- Updated dependencies [d30f516]
- Updated dependencies [f888e69]
- Updated dependencies [2cb6326]
- Updated dependencies [2876f11]
- Updated dependencies [a27cf26]
- Updated dependencies [aa28006]
- Updated dependencies [e3ca793]
- Updated dependencies [7a2bb7e]
- Updated dependencies [ad80d4e]
- Updated dependencies [9d8f2be]
- Updated dependencies [0b56b1c]
- Updated dependencies [e505adf]
- Updated dependencies [98b888d]
- Updated dependencies [5b2bd16]
- Updated dependencies [fe85f56]
- Updated dependencies [8dfcb2e]
- Updated dependencies [091078d]
- Updated dependencies [a06ad2d]
- Updated dependencies [ec679dd]
- Updated dependencies [4394069]
- Updated dependencies [c7ce9ff]
- Updated dependencies [95d9686]
- Updated dependencies [1600ca1]
- Updated dependencies [6b360fa]
- Updated dependencies [3973e1f]
- Updated dependencies [41dcd7e]
- Updated dependencies [e238e18]
- Updated dependencies [e9722ee]
- Updated dependencies [c049036]
- Updated dependencies [b43424c]
- Updated dependencies [182fb96]
- Updated dependencies [1a2eaf3]
- Updated dependencies [3ef3979]
- Updated dependencies [3ef3979]
- Updated dependencies [030eb14]
- Updated dependencies [f9daf5a]
- Updated dependencies [de09b77]
- Updated dependencies [6407fbf]
- Updated dependencies [995e1a8]
- Updated dependencies [c82adfa]
- Updated dependencies [aa45e92]
- Updated dependencies [546603f]
- Updated dependencies [4a6643c]
- Updated dependencies [8127ab6]
- Updated dependencies [18adad9]
- Updated dependencies [246f0ba]
- Updated dependencies [4698256]
- Updated dependencies [0454257]
- Updated dependencies [85ca2a3]
- Updated dependencies [714e98f]
- Updated dependencies [91184e2]
- Updated dependencies [1e58902]
- Updated dependencies [81c145c]
- Updated dependencies [13e3970]
- Updated dependencies [ec1fdf9]
- Updated dependencies [1970b12]
- Updated dependencies [c36ffa0]
- Updated dependencies [23bac7e]
- Updated dependencies [1f46aaf]
- Updated dependencies [b5b52b9]
  - @flow-state-dev/core@0.6.0
  - @flow-state-dev/client@0.6.0

## 0.6.0

### Minor Changes

- 531bf32: A task board's change reaches every open view of the board, from whichever session or process settles the task (FIX-2429).

  - **orchestration:** every change to a board built by `getOrCreateTaskCollection` also publishes a `board` change notice on the topic of the session that filed the row (`Task.filer`, else the ledger's legacy filer, else the running session), narrowed to the board's `collectionId`. A screen subscribes `topic.session(conversationId, { resource: "tasks" })` and reads again. Nothing to wire: the `task-change` item is unchanged. The board's `listTasks` action (a client's read, not the model's tool) also answers each row's `updatedAt`, so a client holding a row from two sources keeps the newer.
  - **engine:** the block context carries the seam that publishes a board notice on the running request's bus, under its tenant, with the request as `origin`.
  - **react:** **Breaking for a hand-built client slice:** a live `BoardList`'s `client` takes `subscribe` in place of `sessions.stream`. A client from `createClient` works as before. The list now hears a task that settles in another session or process, never wakes on a reply streaming in the session, and reads every 3 s where push can miss a change. `useSubscription` takes `client`, for an app that builds its own client, and hands `read` an `AbortSignal` that aborts when the subscription ends.
  - **core / contracts:** `ChangeKind` gains `"board"`; `publishBoardChange` and `BOARD_NOTICE_SEAM` (framework-facing) in `@flow-state-dev/core/types`.
  - **shift-manager:** the conversation's task panel and task cards read on board notices; they keep their 3 s timer only while a task is open, and only where push can miss a change.

- 8d3921e: An app can change a task on a board with one call each, from the browser-safe Inbox entry (FIX-2381).

  - **orchestration:** `createInboxClient(client).board({ flowId, sessionId, board })` returns the board's `cancel(id)`, `steer(id, message)`, `release(id)`, `retry(id)` and `refile(row, overrides?)`. Each resolves when the board says yes and rejects with the board's own words when it refuses. `cancel` resolves to the dependents it cancelled with the task, `refile` to the new task's id. `taskActionName(tool, board)` gives a board action's name. New types: `BoardAt`, `BoardActions`, `RefileRow`, `RefileOverrides`, `TaskActionTool`. A row answer through `answer` / `answerOne` now finds its request past the first 100 in the session, and rejects when the board's answer can't be read instead of resolving.
  - **workforce:** a browser's read of a conversation board now includes each row's `context`, beside `goal`.

- 5f569fd: A task's session tells what a person said from what the task was handed (FIX-2574, FIX-2575).

  - **core / engine:** an action's `userMessage` can return `{ text, metadata }`. The echo is still the request's `user` line, and it carries `metadata` for a client to read. A plain string works as before.
  - **orchestration:** a steer from a person (sent from a screen, or a coding review's request for changes) now shows in the task's session as a `user` line with their words alone, not as an assistant line reading "Message from the user: …". A filer's or the board's steer reads as before. **Breaking:** `showTakenSteers` is now async; await it.
  - **workforce:** a task request's opening `user` line (the task as filed, or re-queued with its steers) is marked as the task's brief. Read it with `taskBriefOf(item)` from `@flow-state-dev/workforce/browser` to draw it as a brief, not as the person's line.

- 8788d02: A partitioned task ledger finds a task id through its own declared `byTaskId` index (FIX-2532).

  - `findTaskPartitions` uses an index on SQLite and Postgres and scans the user's rows on other stores. Tasks added by an older version are found too: on SQLite and Postgres, the first lookup in each user's scope indexes the rows already there.
  - `taskLedgerResources(ledger)` returns the ledger alone. The `<ledger id>__ids` collection is gone, and the `__ids` rows an older version wrote are no longer read or written; they can be left in the store or deleted.
  - `taskIdIndexKey` is removed from `@flow-state-dev/orchestration/tasks`.

### Patch Changes

- 3646a14: The board's `listTasks` action (a client's read, not the model's tool) answers a running row's `leaseUntil`, the deadline a live run keeps pushing forward while it works. Pass the row to `leaseLapsed(row, now)` from `@flow-state-dev/orchestration/tasks` to tell a task whose run stopped answering, by the same rule the board uses to take such a row back. A row nobody holds has no `leaseUntil` and never reads lapsed. A row's `run.startedAt` is when this attempt's first run started, so a screen can time the attempt rather than the task (FIX-2394).

  Docs: packages/orchestration/README.md (the `listTasks` rows section: `run.startedAt` and `leaseUntil`, with `leaseLapsed`)

- Updated dependencies [531bf32]
- Updated dependencies [05a7022]
- Updated dependencies [c67aa49]
- Updated dependencies [a1386ea]
- Updated dependencies [f1e6315]
- Updated dependencies [da4a4bb]
- Updated dependencies [5f569fd]
- Updated dependencies [844a4f9]
  - @flow-state-dev/core@0.5.0
  - @flow-state-dev/client@0.5.0

## 0.5.0

### Minor Changes

- 8be6d45: A failed or cancelled task can be retried as the same task (FIX-2383). `TaskCollectionRef.retry(id)` (optional, on both built-in backings) puts an `errored` or `cancelled` row back to `pending`, keeping its id, steers, output and spend, with the grant counted in `retryLedger`; it publishes a `retry_requested` change and declines `disallowed`, `settling`, `dependency-ended` or `retry-budget`. `taskToolActions` adds `retryTask_<suffix>`, an action only: a model's task tools are unchanged. Workforce's conversation board starts a retried row at once, as it does a released one.
- 3aced5b: Add `taskRowView` to `@flow-state-dev/orchestration/inbox`: one task row as a screen draws it, with a display state that says when the task waits on the user, what it asks, and its spend, harness and times (FIX-2379).
- ddf60c8: `taskSpendView` gains `costUsd`: the sum of the charges vendors reported for the task, or `null` when none did (a subscription run reports none). `requestSpendView` reads one request's spend the same way. `harnessSessionFlow` records what each turn spent on its turn record (`spend`, in `taskSpendView`'s shape, and `endedAt`), hands harnesses an `onUsage` feed that records subscription windows in the user's usage record, and carries a `harnessUsage` action that reads it, with optional `usageReaders` (FIX-2398).

### Patch Changes

- 6c4a3b3: A conversation's line about a task now says which task it is, as data, so an app reads it without parsing the words (FIX-2378).

  - `ctx.emit.message(text, { metadata })` attaches `metadata` to the message item. Clients read it; the model never sees it. `EmitMessageOptions` is exported from core.
  - Orchestration adds `noticeMetadata(notice, task)` and `parseNotice(item)` beside `noticeText`. `parseNotice` returns the task, its ending, title and what came back, and still reads lines stored before this from their words.
  - Workforce marks every task line it emits, and a delegate's answer carries the worker and the task it answered. Read it with `delegateAnswerOf(item)`, from the root or `./browser`.

- Updated dependencies [e0daf6e]
- Updated dependencies [b9e6dd0]
- Updated dependencies [151309c]
- Updated dependencies [824ce87]
- Updated dependencies [29579d4]
- Updated dependencies [147d923]
- Updated dependencies [0554e0b]
- Updated dependencies [7d92efe]
- Updated dependencies [387bee2]
- Updated dependencies [6c4a3b3]
  - @flow-state-dev/core@0.4.0
  - @flow-state-dev/client@0.4.0

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

# @flow-state-dev/workspace

## 0.6.0

### Minor Changes

- 990ebc5: Where a bash scope keeps its files, and how a projection is opened and flushed, are each written once, in `@flow-state-dev/workspace` (FIX-2935).

  - **New in `@flow-state-dev/workspace`:** `scopeFolder(root, scope, principal)`, the folder one scope instance keeps its files in (`root/.fsdev/workspaces/<scope>/…`). The bash tools use it, and every existing bash folder resolves to the same path as before.
  - **New:** `projectionSession({ place, mounts })` opens a projection, hydrates it, and flushes it back. A place that could not be read settles as `{ readable: false, error }`; a store failure rejects. Bash and the Claude Code workspace use it.
  - **New:** `encodeSegment` and `tenantSegment` (the harness checkout encoder, unchanged), `readableSegment`, and `segmentDigest` (the 12-hex digest in a bash folder and MOAT run name) are exported from `@flow-state-dev/workspace`. `@flow-state-dev/harness-manager/checkout` still exports the first two.
  - **Breaking:** `FileEntryState` is removed from `@flow-state-dev/tools` and `@flow-state-dev/tools/bash`. Use `ProjectedEntryState` from `@flow-state-dev/workspace`; it is the same shape. No alias.

  Docs: packages/workspace/README.md (`scopeFolder`, `projectionSession`) · packages/tools/README.md and apps/docs/docs/tools/bash.md (`FileEntryState` becomes `ProjectedEntryState` from workspace)

- 9930b5e: The package has one entry point (FIX-2934). `refreshLock` and `privateTempRoot` are on the root export, and the `@flow-state-dev/workspace/internal` subpath is gone, with no alias.

  - **`refreshLock(lease)`** marks a held lock live now, beside `acquireLock` and `releaseLock`. For a holder that refreshes as its work goes rather than on a timer.
  - **`privateTempRoot(name, purpose)`** returns a temp folder private to this OS user, for files a harness hands its agent outside any checkout.
  - **Breaking:** import both from `@flow-state-dev/workspace`.

  Docs: apps/docs/docs/tools/workspace.md (the two functions, in its API list) and packages/workspace/README.md

- a8c9519: One way to hand the harness manager a workspace (FIX-2933).

  - **New: `localRepoWorkspaceHost({ root, repo, baseRef?, setup?, pullRequestRepo?, provisionTimeoutMs? })`** in `@flow-state-dev/workspace` returns a workspace host whose every run is a worktree of one repository on this machine, its branch kept in that repository. A relative `repo` is resolved. A host whose source changes per run, or that cuts from several repositories, still calls `localWorkspaceHost`.
  - **Breaking:** `harnessManager({ workspace })` takes a `WorkspaceHost` only. The `{ root, sourceRepo, baseRef }` object form is gone: pass `localRepoWorkspaceHost({ root, repo: sourceRepo, baseRef })`. `WorkspaceConfig` and `hostForConfig` are removed, with no alias. A mode's `doneWhen.validate` receives the host.
  - **Breaking:** in `@flow-state-dev/harness-manager/checkout`, `checkoutPathFor(root, location)` takes the host's root, and `provisionCheckout(host, answer, location)` takes the host and the run source's answer.

  Docs: packages/workspace/README.md (the new helper) · packages/harness-manager/README.md (its `workspace: { root, sourceRepo, baseRef }` example becomes `localRepoWorkspaceHost({ root, repo, baseRef })`)

### Patch Changes

- Updated dependencies [3a21218]
- Updated dependencies [019b156]
- Updated dependencies [81387f7]
- Updated dependencies [fad96df]
- Updated dependencies [9b18dd4]
- Updated dependencies [7ac7f90]
- Updated dependencies [136e348]
- Updated dependencies [16e6852]
- Updated dependencies [6968618]
- Updated dependencies [aec3d83]
- Updated dependencies [c51d3e6]
  - @flow-state-dev/core@0.7.0

## 0.5.0

### Minor Changes

- ffbe992: An app can follow and drive its users' worker sessions through package hooks and calls, with no stream, subscription or flow address of its own (FIX-2757).

  - **client:** a session feed's snapshot has `historyLoaded`, `true` once the history read has landed, so an empty session can be told from one still being read. `request(id).stream({ reconnect: true })` keeps following until the request ends: a failed connection opens again after the client's backoff (1 s, doubling, at most 30 s), resuming after the last event, without reporting it; five empty answers in a row (a request that already ended) or a 401, 403 or 404 still end it with `onError`, and `close()` ends it, a reconnect waiting on its backoff included. A user or org collection's handle has `listAll()`, every entry page after page, stopping with `CollectionReadStoppedError` on a repeated cursor or past 1,000 pages.
  - **react:** `useSessionFeed(sessionId, { itemTypes, client })` follows one session live (its items once the history lands, `[]` for an empty session even while its stream is still connecting; its unfinished runs and connection state, `loadEarlier`, and `followResponse` for a streamed send). `useRequestStream` takes `reconnect: true`, handed to the client's stream above, a `client` of the host's own, and asks for no flow while `enabled: false`. `useResource` takes `client` and `pollIntervalMs` at user and org scope.
  - **workforce:** the workforce client opens a new session with a worker (`startSession(worker, { fields })`, writing the app's session fields at open), sends to it (`send`, or `send(..., { stream: true })` for the streamed `Response`), each on the instance of its flow that owns the session, stops its running turns (`stopTurns`, resolving to the ids it stopped) and runs a failed turn again (`retryTurn`). `operatorGitHub({ operator, token })` and `operatorGitHubToken()` give a single-user host GitHub routines on the operator's own token, for the operator alone.
  - **harness-manager:** each coding board row names `runFlow`, the flow its run's session runs on, so a screen reads that run's own stream without looking the session up.
  - **workspace:** `sessionRepositorySource({ field, repositories, check })` is the run source for a host whose sessions each work in one repository a session field names; `listedRepository` maps a path or `file://` remote to the listed repository it is. `setupCommandFrom(value, setting)` reads a setup command from a setting, beside `checkCommandsFrom`.
  - **store-sqlite:** `sqliteScheduleIndex({ filename })` is a schedule index on a SQLite file of its own.

  Docs: packages/client/README.md (the session feed snapshot's `historyLoaded`; `request(id).stream`'s `reconnect`; a collection handle's `listAll`), packages/react/README.md (`useSessionFeed`; `useRequestStream`'s `reconnect` and `client`; `useResource`'s `client` and `pollIntervalMs`), packages/workforce/README.md (the client's `startSession`, `send`, `stopTurns`, `retryTurn`; `operatorGitHub`), packages/harness-manager/README.md (the coding board row's `runFlow`), packages/workspace/README.md (`sessionRepositorySource`, `listedRepository`, `setupCommandFrom`), packages/store-sqlite/README.md (`sqliteScheduleIndex`)

- 5f1c26a: **Breaking:** eleven names leave the `@flow-state-dev/workforce` and `@flow-state-dev/workspace` roots, with no alias (FIX-2641). An old import fails to compile with "has no exported member".

  - **workforce:** `taskBriefOf`, `taskBriefMetadata` and the `TaskBrief` type leave the root. They stay on `@flow-state-dev/workforce/browser`, beside `delegateAnswerOf`: a client reads a task's brief with `taskBriefOf(item)`, which answers `{ taskId }` for a message item that is a task's brief and `undefined` for any other. To migrate, import them from `@flow-state-dev/workforce/browser`.
  - **workforce:** the subscription storage internals leave the root and are no longer exported: `SUBSCRIPTIONS_RESOURCE`, `SUBSCRIPTION_CURSORS_RESOURCE`, `SUBSCRIPTION_INDEX_RESOURCE`, `MAX_SCREEN_TERMS`, `screenVerdictsSchema`, and the `ListedScreen` and `SubscriptionCursor` types. A flow declares the subscription resources through `subscriptionResources`; the shapes stay public as `listedScreenSchema`, `subscriptionCursorSchema` and `screenVerdictSchema`, and a `subscribe` input's screens are typed by `SubscribeInput["screens"]`. Nothing persisted changes.
  - **workspace:** `LAND_TIMEOUT_MS` leaves the root and is no longer exported. A landing still defaults to two minutes when `LandRequest.timeoutMs` is unset.

  Docs: packages/workforce/README.md ("Reading a task's lines in a client": a task's brief is read with `taskBriefOf(item)` from `@flow-state-dev/workforce/browser`, which answers `{ taskId }`, next to `delegateAnswerOf`). The other ten names never had a README entry, so no other README changes.

- 7ddae5c: A file a workspace saves keeps that workspace's path, content hash, and `updatedAt`, which is an ISO timestamp. `entryState` and bash `createState` can still add other fields. A `path`, `hash`, or `updatedAt` they return is ignored (FIX-2749).

  Docs: apps/docs/docs/tools/workspace.md

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

- 6b68a97: A `RunSource` is now handed the run's `BlockContext` instead of a `LooseBlockContext`, so a source can pass it to any helper typed `BlockContext` without a cast (FIX-2609). Code that calls a `RunSource` itself must pass a full `BlockContext`, as harness-manager does. `ProjectChecksResolver` (from `projectChecks()`) is likewise typed `(run: { ctx: BlockContext })` instead of taking `ctx: unknown`.
- 9f8b8d3: A coding task's branch and worktree folder are now one short name made from the task's title, so its pull request can be pushed to GitHub (FIX-2657).

  - **harness-manager:** a board run's branch is `conductor/<name>` and its folder `<root>/<name>`, where the name is a slug of the task's title (led by the tracker issue when the task names one, at most 32 characters) and 6 hex of the run's identity, for example `conductor/fix-2657-cap-failed-at-five-3f9a1c`. The full ref stays under 100 bytes. Before, the branch spelled the tenant, organization, user and board out as full digests, and a run on a conversation's board pushed a ref over GitHub's 255-byte limit, which GitHub refused (`GH005`). When another run holds the name, or another worktree or branch already has it, a new run takes `-2`, `-3` and so on. A run already under way keeps the branch and folder its record names. The worktree's `name` in the `worktrees` resource is the same name. New exports from `@flow-state-dev/harness-manager/checkout`: `runName`, `freeRunLocation`, `worktreeNameFor`, `runIdentityKey`, `locationFor`. **Behaviour change for hosts deriving a run's place themselves:** `branchFor`, `checkoutPathFor` and `provisionCheckout` now give the short shape. For a run recorded in the old long shape, find its location with `locationFor(location, recordedBranch)`, or pass `nested: true`.
  - **workspace:** `WorkspaceHost.reserve` reserves a place's and branch's names for one run, atomically, refusing a name another run holds or a worktree or branch already has. The local host keeps the holder in a `<place>.holder` file beside the place. A host without it gives a run its derived name as it is. `WorktreeRecording.name` sets a worktree's name when the caller already named the worktree.

  Docs: packages/harness-manager/README.md (where a run's checkout and branch are, and what they are named), packages/workspace/README.md (`reserve`, `WorktreeRecording.name`)

- 89b40bc: A coding run whose branch already has a pull request open from it puts its work there, with no review asking how to land it (FIX-2781).

  - **workspace:** `WorkspaceHost.existingPullRequest(target)` answers the pull request already open from the branch `land` would land, into the base it would land on (`{ url, number, branch }`), or `null` when there is none. It rejects when git or GitHub can't be read. `existingPullRequest(host, target)` is the same check for a `LandHost`. A `pull-request` landing onto a pull request that was already open now says so with `existing: true` on its `Landed`. A pull request open from a fork's branch of the same name, or into another base, is no longer taken as the run's. A `pull-request` landing with `onlyExisting: true` pushes only to that open pull request: when none is open it is refused `pull-request-gone`, pushing nothing and opening nothing.
  - **harness-manager:** with `reviewChanges` on, a run whose branch has an open pull request that a person's accept on this task already landed on is not held for "Review the run's changes". Its branch is pushed to that pull request, the stream says "Pushed <branch> to pull request #N", and with `awaitPullRequests` the task waits on it as before. The output's `review` stays `null`, since nobody reviewed it here. If the push fails, the person is asked with the error (the coding session isn't handed it) and offered only that pull request, never a second one or a local merge. If that pull request closed before the push, nothing is pushed or opened and the person is asked with every way to land. If GitHub can't say whether one is open, the stream says so and the review is asked as usual. Any other pull request open from the branch, including one the coding session opened itself, is never pushed to unasked: the stream says so and the review is asked as usual, and accepting "Open a PR" puts the work on that pull request rather than opening a second. The run record keeps the accepted pull requests in a new `landedPullRequests` field (`null` on older records, read as none).

  Docs: packages/workspace/README.md (`existingPullRequest` beside `land` and `landWays`), packages/harness-manager/README.md (the `reviewChanges` section: a branch with an open pull request lands there unasked)

- d0e892d: Child processes the workspace starts no longer inherit the host's whole environment (FIX-2687). A setup command, a project check (`runCheckoutCommands`, and harness-manager's `commandCheck`), and `run`/`runToEnd` now start from an allowlist: `PATH`, `HOME`, the shell's own variables, locale, proxy and CA settings (`WORKSPACE_BASE_PASS`), plus whatever the caller sets in `env`. A secret such as `GITHUB_TOKEN` or a model gateway key reaches one only when the host names it. To migrate, pass any variable a setup or check needs, a private registry token say, through `setup.env` (or the check's `env`): `setup: { command, env: { NPM_TOKEN: process.env.NPM_TOKEN! } }`.

  The host's own git starts with its git settings: `GIT_CONFIG_GLOBAL`, identity including `EMAIL`, and the `GIT_CONFIG_COUNT` pairs less any `http.*`, `credential.*`, `url.*` or `remote.*` one, which can carry a credential. Only its remote calls (fetch, push, `ls-remote`, `gh`) get credentials and transport settings: `GH_TOKEN`, `GITHUB_TOKEN`, `SSH_AUTH_SOCK`, gh's config, `XDG_CACHE_HOME`, git's `GIT_SSL_*` and HTTP proxy variables, and every config pair. Fetching a cloned remote now runs in a repository of its own, so nothing a run writes into the clone's config is read by it. Landing and fetching work as before. If your credential helper reads other variables, CodeCommit's `AWS_*` say, list their names in `remotes.pass` and only the remote calls see them. `GIT_SSL_NO_VERIFY` and `GIT_ASKPASS` are not passed. `run` and `runToEnd` take `pass`, names to pass from the host's environment.

### Patch Changes

- 2cb6326: A coding task can wait for its pull request to merge before it completes (FIX-2578).

  - **harness-manager:** new option `awaitPullRequests` (off by default). When it is on, a task whose run opened a pull request does not complete at its settle. It waits on its pull requests, and each wake reads them through `gh`: all merged completes the task with no new run; none open with some merged completes it and the output notes the closed ones; all closed without merging cancels it with the reason "its pull request was closed without merging"; any still open runs the wake's words as a steer on the same attempt and session, then waits again. A pull request that can't be read never settles the task: it runs the steer, waits again, and adds a status note. A completed run's output gains `pullRequests` (`{ url, number, title, state }[]`, `null` when no wait ran).
  - **harness-manager:** `pullRequestWait(row, records?)` and `PULL_REQUEST_EVENT`, from the package root and from `./browser`, read a task's open pull-request wait for a screen: the hold, when it opened, and each pull request's number, link and title. `CLOSED_WITHOUT_MERGING` is the cancel reason.
  - **orchestration:** a new row hold, `external`, for a running task that waits on something outside the board. It is the system's (`actor: "system"`), never a question: the filer is not told of it, the Inbox does not list it, and `waitsOnUser` is false. It holds the row as a question does (no lease, unclaimable, the waiting turn cannot settle). Open one from the turn holding the claim with `waitExternally(ctx, ledger, { prompt, events })` (`./task-board`) or `ref.awaitExternal(id, wait, { claim })`. A user's line in the task's session answers it, and so does an answer from `"service"`. New readers `holdActorOf(row)` (`"user"`, `"system"` or `undefined`), `externalHoldOf(row)` and `isExternalHold(hold)` from `./tasks`. A board whose only open rows wait on an event ends with the reason `waiting-on-an-event`.
  - **orchestration:** steers and answers gain the source `"service"`, for words from outside the app, with the sender's handle as `by`. A run reads them quoted as the sender's, never as the user's. The filer's answer through `updateTask` on an `external` hold is refused (`wait_is_not_a_question`).
  - **workspace:** `readPullRequest({ cwd, number, repository?, host? })` reads a pull request's `state` and `merged`, a fork's included. `pullRequestHead` also returns `state` and `merged`.
  - **core:** `writePullRequests` keeps a pull request's `state` current: a sighting's state replaces the stored one. Other fields still fill only when null.
  - **workforce:** a message delivered to a task's session whose task waits on an `external` hold answers that wait, as `"service"` from its sender, instead of queueing behind it.

  Docs: packages/harness-manager/README.md (settling: a section "Waiting on a pull request" for `awaitPullRequests`, the four outcomes, the unreadable case, `pullRequestWait` in the `./browser` list, the `pullRequests` output field), packages/orchestration/README.md (the `external` hold beside questions and confirms, `waitExternally` / `awaitExternal`, `holdActorOf`, the `"service"` steer source, the `waiting-on-an-event` reason), packages/workspace/README.md (`readPullRequest`), packages/workforce/README.md (a message to a task waiting on an outside event answers its wait).

- abed271: `checkCommandsFrom(value, setting)` reads a host's checks from one `;`-separated setting, such as an environment variable: each command trimmed, blanks dropped, and each checked with `checkoutCommandProblem`. It returns `undefined` when the value names no command, and throws `<setting>: <problem>` for the first command that would need a shell (FIX-2628).

  Docs: packages/workspace/README.md (`checkCommandsFrom` beside `checkoutCommandProblem`, with the `;`-separated form and the error's setting prefix)

- 091078d: A failed turn's reason reads as plain text. When a thrown error's message carries terminal colour codes, as the AI SDK's "Unauthenticated request to AI Gateway" error does when no gateway key is set, the engine removes them as it normalizes the error, so the turn's `error` item, the request's recorded error and every surface that shows them get the words without the codes (FIX-2558).

  - **engine:** `normalizeError` strips ANSI colour and style codes from the message of the `FlowError` it returns, on every path (a plain throw, a thrown `FlowError`, a classified AI SDK error). The original error, kept as `cause`, is unchanged.
  - **engine:** the `details.cause` of a failed `block_trace` and of the terminal `error` item now leaves out only the layer the engine itself adds around a plain throw. A `FlowError` you throw always shows its own `cause`, even when the cause's message is exactly the same as yours. Before, that one case lost a level.
  - **core:** `stripAnsi(text)` is exported from `@flow-state-dev/core/helpers`: the text with its ANSI control sequences removed, colon-form colour codes (`ESC[38:2::255:0:0m`) included.
  - **workspace:** the output tail of a checkout command (`runCheckoutCommands`) uses the same helper, so colon-form colour codes no longer stay in it.

  Docs: packages/core/README.md (Helpers section: a `stripAnsi(text)` entry beside `toError`)

- 1600ca1: A coding task that opens a GitHub pull request hears each review, comment and CI result on it once, through a signed webhook, from `service:github` (FIX-2535).

  - **workforce:** `githubServiceFlow({ provider, installation, trustedBots, agentHandles })` is GitHub's service flow, with the webhook route declared. `githubSubscriptionProvider({ token })` answers who can read a repository and who the user is on GitHub, on the user's own token. `followPullRequest({ providers })` subscribes a coding session to each pull request it records, hearing its reviews, comments and CI until it merges or closes. `normalizeGitHubEvent` maps a webhook payload, or a poll's object of the same shape, to normalized events; `defineSubscriptionServiceFlow` takes `normalize` (declares the webhook route) and `maxOwnerRuns` (the most subscriptions one event reaches, 100 by default).
  - **core:** a webhook provider entry can be a service route, `webhooks: { <provider>: { service: { entry, normalize } } }`, instead of `on`. `WebhookSubscriptionConfig` is now a union of the two, so code that reads `.on` off it must check for `undefined`. The normalized subscription event gains an optional `addressed: true` when it asks the app's agent. `writePullRequests` takes `onRecorded`, called once per newly recorded pull request; `followRecordedPullRequests(ctx, follower)` hands a request's new pull requests to a `PullRequestFollower`.
  - **engine:** the webhook transport routes a service route's events through `routeServiceEvent`, as `service:<provider>`, answering 202 once each owner run is recorded, 503 when one wasn't.
  - **harness-manager:** `harnessManager({ onPullRequestRecorded })` hands each pull request a run records to the follower, mid-turn.
  - **workspace:** the branch check hands the pull requests it records to the request's follower.

  Docs: packages/workforce/README.md (GitHub's service flow, the provider, `followPullRequest`, the webhook mount), packages/core/README.md (the `service` webhook form, `addressed`, `onRecorded`), packages/engine/README.md (the service route in the webhook transport), packages/harness-manager/README.md (`onPullRequestRecorded`), apps/docs/docs/server/webhooks.md (the service route beside bindings), apps/docs/guides/webhooks-github.md (mount the flow; a task follows its pull request; `sessionId` routing for GitHub is gone)

- 2e63b30: A coding run that merged its moved-on base branch into its own branch is now judged and reviewed on its own work: the judge's commit count, subjects and diff, and the review card's files, match the pull request's diff (where the branch meets the base branch's tip now), not everything since the commit the branch was cut at (FIX-2859).

  - **workspace:** `WorkspaceHost` has a new optional method, `baseTip({ cwd, baseRef })`: the commit the run's base branch is at now, fetched from the remote the host pinned, into the checkout's object store. It answers only a commit that fetch brought, never a local branch or tracking ref a run could move, and `undefined` for a checkout outside a listed repository, a base named only as `HEAD` (whichever branch the repository is on when asked), a base with no pinned upstream, or a failed fetch. `localWorkspaceHost` implements it; a custom host may leave it out.
  - **harness-manager:** at settle the manager asks the host for the tip once and reads the run's commits, its diff and a round's commits against it, when it has the recorded cut in its history (`effectiveCut`). Any other tip, or none, leaves the cut as the base, as before: the reads can over-report the base's commits, never hide the run's. The commit the settle read against is kept on the run record (`effectiveCut`, `null` on older records) on every settle, so a file's patch opened from the `changes` view later matches the review's files and the judge's read; `baseCommit` stays the commit the branch was cut at. Every commit and diff read now ignores replace refs, grafts and the commit-graph in the run's checkout, so a run can't rewrite the base's history to hide its own commits.

  Docs: packages/workspace/README.md (the `WorkspaceHost` method list: `baseTip`)

- cc91d7a: Landing an accepted run is safer, and is offered only where it can work (FIX-2543).

  - **workspace:** a local merge never runs a program set in the checkout's own git config, which a run shares: fsmonitor, filters, merge drivers and signing programs fall back to your global or system config, or are off. `gh` runs outside every checkout, with `--repo` taken from the pinned remote URL and an explicit `--head`, so it never pushes or reads a run's config; a remote that names no GitHub repository is refused as `no-pull-request-repo` before anything is pushed. Set `pullRequestRepo` on `localWorkspaceHost` when the pinned URL doesn't name the repository itself. A merge that fails is undone under its own time limit and checked; if the checkout couldn't be put back, `merge-failed` says so. New: `WorkspaceHost.landWays(target)`, the landings that will work for a run (none for a run cloned from a remote).
  - **harness-manager:** the review offers only the landings the host's `landWays` answers, so a run that can't be landed keeps the plain Accept. The workspace config gains `pullRequestRepo`.

  Docs: apps/docs/docs/orchestration/harness-manager.md

- 3f23173: Open a PR and Merge locally on a coding run's review now find their way past a failure instead of giving up after one (FIX-2658).

  - **workspace:** `land` lands the branch the run's checkout is on when the run's own branch is gone (the run renamed it, or moved its work to a branch it named), provided it holds commits over the new `LandTarget.baseCommit`; `Landed.branch` names the branch landed. A pull request already open from the branch is the landing, and no second one is opened. A push refused then is let go only when the remote branch already holds the checkout's tip; otherwise it is `push-failed`. A gone branch with nothing to land is refused as `branch-gone`.
  - **harness-manager:** a landing that fails is handed to the run's coding session as one more step, with the exact error and the person's note, and tried again when that step stops, without asking the person. New option `landAttempts` (default 3) caps the tries; `1` asks the person after every failure, as before. Failures no run can fix (no remote, no GitHub repository, a repointed remote, an unknown base, a host that can't land) go straight back to the person. An accept takes optional `words`. The review's data carries `landAttempts`, every try with its error, which `reviewDetail` reads.

  Docs: packages/harness-manager/README.md (`landAttempts`, the hand-off to the coding session, `words` on an accept), packages/workspace/README.md (`land` and a moved branch, an open pull request, `baseCommit`, `branch-gone`)

- 8d4dd64: Open a PR works when the branch a run was started from is gone from the remote, the normal state of a checkout after its own pull request merged and GitHub deleted the branch (FIX-2858).

  - **workspace:** a pull-request landing asks the pinned remote whether the base branch is still there. When it is gone, the pull request goes into the remote's default branch, and the `Landed` result carries `baseGone` with the branch that was gone. `existingPullRequest` looks into the same base. The default branch is taken only when it holds the commit the run was cut at: a base merged by squash or rebase would bring its changes into the pull request again. That case, and a remote that names no default branch, are refused with a new reason, `base-gone`, before anything is pushed.
  - **harness-manager:** a landing GitHub refuses (`pull-request-failed`, `pull-request-gone`, `base-gone`) is no longer handed to the coding session to fix. The person sees the failure on the review asked again, and only the landing opens the pull request. A refused push is still handed to the coding session, as before. The landed line says when the pull request went into the default branch instead.

  Docs: none. No docs page or README documents a landing's base or its refusal reasons.

- 714e98f: A harness run that is still working is no longer stopped at a short limit on how long it has run. Coding runs and harness session turns are stopped once the harness has sent nothing for 20 minutes, and they fail with a message that names the harness, such as "No output from Claude Code for 20 mins; stopped." A cap on total run time, 4 hours by default, stops a run that loops while still sending events. (FIX-2794)

  - **Coding runs.** `harnessManager` and the harness kit take `idleTimeoutMs` (default 20 minutes). `runTimeoutMs` is now an optional cap on a run's total time, 4 hours by default; pass `0` to turn it off. Before, it was required, and the kit capped every run at 20 minutes. A run stopped at its cap fails saying so, such as "Claude Code ran for 1 hr, its cap on run time; stopped.", not with the harness's aborted error. `harnessManager` also takes `harnessLabel`, the harness's name in the stop message, which the kit fills from each harness's `label`. `codingDrainBudgetMs` takes `idleTimeoutMs` too. A shutdown waits out a cap you set; with the default cap, or with it off, `codingDrainBudgetMs` gives a run's harness 20 minutes before the run is cancelled.
  - **Session turns.** `harnessSessionFlow` takes `idleTimeoutMs` (default 20 minutes) and `harnessLabel`. `turnTimeoutMs` is now an optional cap, 4 hours by default; pass `0` to turn it off. Before, every turn was capped at 60 minutes. A turn stopped at its cap ends with the same words as a coding run's cap. A turn stopped for silence is recorded as `timedOut`, like one stopped at the cap.
  - **The harness contract.** A new optional feed, `onEvent` (type `HarnessEventHook`, helper `reportHarnessEvent` in `@flow-state-dev/core/harness`), is called on every event a run sends. `claudeCodeAgent`, `codexAgent` and `cursorAgent` call it, and `codexHarness()` and `cursorHarness()` pass it on. **If you write your own harness slot and pick feeds by name, pass `onEvent` on too.** A harness that never calls it is stopped after the idle window, however busy it is.
  - **Checkout locks.** A coding run's checkout lock is marked live on its events, so a long run keeps its lock. The stale window is sized from the idle window rather than from a run's length.

  Docs: apps/docs/docs/orchestration/harness-manager.md (`runTimeoutMs` is an optional cap, 4 hours by default, `0` for none; `idleTimeoutMs` and `harnessLabel`; the drain budget's run term), the harness kit page (the `idleTimeoutMs` key; `runTimeoutMs` 4 hours by default, `0` for none), the session flow's `turnTimeoutMs` (4 hours by default, `0` for none), apps/docs/docs/tools/codex.md and cursor.md (`onEvent` on the block's options), the harness contract reference (`onEvent`, `HarnessEventHook`, `reportHarnessEvent`).

- Updated dependencies [091a1dd]
- Updated dependencies [04812f3]
- Updated dependencies [61efa05]
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
- Updated dependencies [41dcd7e]
- Updated dependencies [e238e18]
- Updated dependencies [e9722ee]
- Updated dependencies [c049036]
- Updated dependencies [b43424c]
- Updated dependencies [182fb96]
- Updated dependencies [3ef3979]
- Updated dependencies [030eb14]
- Updated dependencies [f9daf5a]
- Updated dependencies [de09b77]
- Updated dependencies [c82adfa]
- Updated dependencies [aa45e92]
- Updated dependencies [546603f]
- Updated dependencies [4a6643c]
- Updated dependencies [246f0ba]
- Updated dependencies [4698256]
- Updated dependencies [0454257]
- Updated dependencies [85ca2a3]
- Updated dependencies [714e98f]
- Updated dependencies [91184e2]
- Updated dependencies [1e58902]
- Updated dependencies [81c145c]
- Updated dependencies [13e3970]
- Updated dependencies [1970b12]
- Updated dependencies [c36ffa0]
- Updated dependencies [23bac7e]
- Updated dependencies [1f46aaf]
- Updated dependencies [b5b52b9]
  - @flow-state-dev/core@0.6.0

## 0.4.0

### Minor Changes

- 73f8352: Accepting a coding run's review can now land its work: **Open a PR** pushes the run's branch and opens a pull request, and **Merge locally** merges it into the base branch where your checkout has it (FIX-2543).

  - **harness-manager:** with `reviewChanges`, an accept can name `land: "pull-request" | "merge"` (`harnessReviewAnswerSchema`). The review's data lists the ways this host offers (`lands`). If the landing fails, the task doesn't complete: the review is asked again with the error (`landFailed: { land, message }`), so the user can retry or pick the other way, and the run's branch and commits are kept. The output gains `landed`: `{ kind: "pull-request", url, number, branch, base, remote }` or `{ kind: "merge", branch, commit, checkout, from }`, `null` unless the work landed. A pull request is written to the run session's `observed-pull-requests` record. `ReviewDetail` gains optional `lands` and `landFailed`, and `ReviewLand` is exported from the `browser` entry. A plain `{ verdict: "accepted" }` completes the task without landing anything.
  - **workspace:** `WorkspaceHost.land(target, request)`, implemented by `localWorkspaceHost` for a repository in `localRepositories`. A pull request pushes to the remote pinned at start (the base's upstream, else `origin`), never force-pushes, and returns the pull request already open for the branch instead of opening a second. A merge lands the run's commits on the base by fast-forward or a merge commit, whatever the repository's squash or no-commit settings say, never overwrites an ignored file, and never resolves a conflict. A base that names a pinned remote's branch (`origin/main`, `refs/remotes/origin/main`) targets that branch on the remote for a pull request and the local branch tracking it for a merge; a local branch named `origin/main` stays that branch. A refusal is a `WorkspaceRefusedError` whose `reason` is `land-unsupported`, `base-unknown`, `no-push-remote`, `remote-repointed`, `push-failed`, `pull-request-failed`, `base-not-checked-out`, `checkout-dirty`, `checkout-busy` (the checkout is mid-merge, rebase, cherry-pick or revert, and is left alone), `merge-conflict` (aborted, naming the files) or `merge-failed`; after a merge refusal the checkout is as it was. New exports: `LAND_TIMEOUT_MS`, `Landed`, `LandRequest`, `LandTarget`.
  - **ui registry (`review-hold`):** with `lands`, Accept is two buttons, **Open a PR** and **Merge locally**, and a review asked again with `landFailed` shows the error and **Retry**. Pass the stop's suspension id, or the hold's id, as `holdId`, so a retry that fails with the same error still shows Retry. `LandedOutcome` draws where accepted work went and what to do next.

  Docs: apps/docs/docs/orchestration/harness-manager.md, packages/harness-manager/README.md, packages/workspace/README.md, packages/ui/README.md

### Patch Changes

- a124a8e: A project's repository can be checked before any run. `localWorkspaceHost` answers `checkRepository(repository, { ignored })` without making anything: whether a run's checkout could be made there, and if not, a sentence naming the fix. The ignore rule is read from the last commit, as a run's checkout gets it, so a rule that is only in uncommitted changes is refused with "commit it". `defineProjectBlocks({ checkRepository })` uses it to refuse `createProject` and `setRepository` with `repository-unusable`, and serves a read-only `checkRepository` action a page can ask before Create. `harness-manager` exports `ASK_MARKER_IGNORED`, the rule coding runs need (FIX-2403).
- Updated dependencies [531bf32]
- Updated dependencies [05a7022]
- Updated dependencies [c67aa49]
- Updated dependencies [f1e6315]
- Updated dependencies [da4a4bb]
- Updated dependencies [5f569fd]
- Updated dependencies [844a4f9]
  - @flow-state-dev/core@0.5.0

## 0.3.0

### Minor Changes

- cc0ab62: Choose where a coding session starts, and remove what it left on disk (FIX-2419).

  - `@flow-state-dev/workspace`: a `baseRef` naming a pinned remote's branch (`origin/main`) in a listed repository is fetched before the cut, and refused as `remote-unreadable` when the fetch fails. `PlaceRequest.existing` checks a branch out instead of cutting one, making it from the remote's when absent (`no-such-branch` when there is none). `localWorkspaceHost` gains `list()` and `remove(target, { deleteBranch?, force? })`, the one removal path, which refuses uncommitted work (`uncommitted-work`), a place mid-provision (`place-busy`) and, unless forced, deleting a branch that holds the only copy of a commit, or removing a detached HEAD that does (`unique-commits`). `pullRequestHead` resolves a same-repository pull request to its head branch. `occupyWorktree` holds a worktree in use (`<dir>.lock`), and `remove` refuses one a run holds (`in-use`); `checkedOutBranch` reads the branch a worktree is on.
  - `@flow-state-dev/harness-manager`: harness session state gains `start` (`{ base } | { branch } | { pullRequest } | { worktreeOf }`, fixed at create like `model`) and a server-owned `workspace` record. `HarnessSessionWorkspace.provision(place, { start })` may return `{ path, branch }`; the turn-end pull-request check reads the recorded branch. A `removeWorktree` action, refused while a turn runs, calls the workspace's optional `remove`. `resolveHarnessSessionStart` maps a start to a workspace host's request. `{ worktreeOf: sessionId }` attaches a session to another session's worktree and branch: refused at create (404) when that worktree isn't there in the caller's tenant and at its turn when it isn't in the user's own list of worktrees, each turn holds the same in-use lock as the owner's, only the owner may `removeWorktree`, and an attached turn that leaves the worktree on another branch is recorded as failed. The workspace record carries `owner`.
  - `@flow-state-dev/fsdev`: `fsdev worktrees <root>` lists a workspace host's worktrees and removes one with `--remove`.

- cb395b2: `localWorkspaceHost({ setup: { command, env? } })` runs a setup command, such as `pnpm install`, in each new repository checkout before handing it over. It runs again on later provisions until it succeeds, and it counts against `provisionTimeoutMs`. `PlaceRequest.onSetup` is called when it starts, and `WorkspacePlace.setup` reports `done`, or `failed` with the tail of the output. A failure doesn't refuse the provision. In harness-manager, `WorkspaceConfig.setup` is passed through to the host, and task-board runs show the setup on their stream. The session flow's `provision(place, request)` may return `{ path, setup }` and pass `request.onSetup` to the host, and the turn record gains `setup` (FIX-2420).
- cc0ab62: Add a shared list of worktrees (FIX-2439).

  - `@flow-state-dev/workspace`: `worktreesCollection` is a user-scoped, `llmReadable` collection with one row per worktree a host made. A row holds `name`, `path`, `branch`, `repo`, `baseCommit`, `owner`, `attached`, `state`, `commits`, `lastTurnAt` and `pullRequests`. To have the host write rows, give it the collection: `PlaceRequest.worktrees` writes `provisioning`, then `ready`; the new `host.attach` adds a session or run to `attached` (`{ kind, id, lastTurnAt }`); the new `host.recordCheckout` writes the branch and commit count together at a turn's end and returns what it read; and `RemoveOptions.worktrees` marks the row `removed`. `recordBranchPullRequests` takes `worktree: { collection, key }`. `WorkspacePlace.worktree` is the row's key.
  - `@flow-state-dev/harness-manager`: the session flow declares the collection and passes it to `HarnessSessionWorkspace`: on `provision` and `remove`, and on the new optional `attach` and `recordCheckout`. It stores the row's key as `state.workspace.worktree`, and marks `worktrees` read-only to the model's resource tools. The board manager writes a row for each run's checkout.

### Patch Changes

- 488b203: `@flow-state-dev/workspace` exports `parseCheckoutCommand(command)`, which checks and splits a command in one call: `{ words }` with the program first, or `{ problem }` with the same sentence `checkoutCommandProblem` gives. Use it where a setting becomes a command to run, such as a host's setup command (FIX-2387).
- Updated dependencies [e0daf6e]
- Updated dependencies [151309c]
- Updated dependencies [824ce87]
- Updated dependencies [7d92efe]
- Updated dependencies [387bee2]
- Updated dependencies [6c4a3b3]
  - @flow-state-dev/core@0.4.0

## 0.2.0

### Minor Changes

- 71ab534: A workspace host can read a run source's files without a run (FIX-2285). `WorkspaceHost.readSource(answer, request)` is an optional method that lists paths by a glob, reads a range of one file's lines, or searches with grep. `localWorkspaceHost` implements it. It reads a repository from its shared clone at the remote's default branch, never a run's branch. It reads a checkout listed in `localRepositories` at the base a new run there would be cut from, and kept files from their collection. It makes no place. A read fetches the clone at most once a minute and never waits on the clone's lock. Results are capped by `SOURCE_READ_LIMITS` (500 paths; 2,000 lines or 256 KB; 200 matches with 200-character snippets) and say when they were cut. A path that is not a plain repository path is refused as `invalid-path`. `tryAcquireLock` is new: it tries the host's lock once and does not wait. The host now keeps `<root>/.clones/<key>.fetched.json` beside each clone, naming when it was fetched and the default branch and commit that fetch landed on, which reads serve. `run` takes an `onLine` option that hands standard output over line by line instead of buffering it.
- 0d55d46: A session keeps a record of the pull requests it opened (FIX-2268). Core adds the `observed-pull-requests` collection (`observedPullRequestsCollection`), one writer (`writePullRequests`), a replaceable GitHub rule (`githubPullRequestRule`, `DEFAULT_PULL_REQUEST_RULES`) and the recorder: `recordPullRequests(ctx)` for a block, and `pullRequestRecorder()` for a flow with no harness to add as a `.tap` step. A `gh pr create` command or a `create_pull_request` tool whose output holds the link is one row, written as the call settles. Each row carries the `requestId` that opened it.

  The Codex, Claude Code and Cursor blocks record by default; `recordPullRequests: false` turns it off. Workspace adds `recordBranchPullRequests`, a host-side check that asks GitHub through `gh` which pull requests a checkout's branch has. The harness manager declares the record and runs that check before its verdict and when a run fails.

  **Migration.** A Codex, Claude Code or Cursor block now declares the `observed-pull-requests` session collection by default. A test that asserts the block declares no resources must pass `recordPullRequests: false`.

- 06ea781: A checkout handed back off its run's branch is no longer refused. The host moves it back onto the run's branch and keeps what the run made elsewhere: a fast-forward when the checkout's commit contains the branch, and otherwise a checkout of the branch. It reports this as `place.repo.movedBack`. A checkout with uncommitted changes on a branch that lacks the run's commits is handed back as it is and reported as `place.repo.offBranch`, because those changes are the run's to commit, stash or discard; harness-manager refuses that attempt with the message. A half-done git operation, or the branch checked out in another worktree, is refused as the typed `WorkspaceRefusedError` `checkout-moved`, naming the git command that clears it. A run that switches its own branch no longer strands its session (FIX-2211).
- ba74f01: `harnessManager({ workspace })` accepts a workspace host from `@flow-state-dev/workspace` as well as a fixed `{ root, sourceRepo, baseRef }`, and provisions every run through the host either way. A run keeps the repository and base it started on (recorded on its run record) when its source later changes, and a run that started with no repository stays on its kept files. Its kept files are saved at the end of each turn, when it asks a question, and when the harness fails, and a run is not completed while its last save failed. A run its workspace refuses (the source answers `refused`, or the host won't provision the remote) is cancelled on its first attempt instead of being retried, and `HarnessRunRefused` is exported. `localWorkspaceHost` gains `localRepositories`, for a repository on the machine that runs are cut from directly, with no clone and no fetch, and a place request can name a directory the checkout's repository must keep out of git, which a run with no repository also leaves out of its saved files. A provision's `provisionTimeoutMs` now covers its waits for other provisions of the same place or clone, and `save` refuses a place handle that a later provision of the same place has replaced. `run`, `GIT_TIMEOUT_MS` and `CHECKOUT_CLEANUP_TIMEOUT_MS` from `@flow-state-dev/harness-manager/checkout` are now re-exported from `@flow-state-dev/workspace` (FIX-1762).
- 2348dbd: A repository listed in `localRepositories` now fetches the base's upstream and cuts a new run's branch from whichever of local and upstream is newer, refusing a base whose two copies have each moved as `base-diverged` and recording the commit cut at as `place.repo.baseCommit`, which the run record keeps and `readRunCommits` now counts a run's commits from (FIX-1927).
- 9510a03: Requests now carry `ctx.request.incarnation`, a token that stays the same across a request's retries and resumes and that request-scoped workspace keys and local `scope: "run"` bash directories now include, so a request reusing a deleted request's id starts empty; existing run workspaces move once on upgrade, and a run in flight at deploy continues in an empty directory (FIX-1286).
- 57a859d: A workspace host can now hold a repository run's commits and uncommitted files off the machine, and rebuild the checkout on another host. Off by default: pass `heldWork: fileHeldWorkStore({ dir })` (or your own `HeldWorkStore`) to `localWorkspaceHost`, and have the run source answer a `heldPrefix`. `checkpoint(place, recorded?)` now returns the hold (or `null`) instead of nothing; new `dropHeld`, `hostId` and `holds` on the host; `provision` takes the run's `recorded` place and hold, returns `origin`, and rejects with `HeldWorkMismatchError` when held work disagrees with the record. A host without a store rejects a recorded hold with `field: "disabled"` instead of starting the run over (FIX-1766).
- 707b340: Add `localWorkspaceHost`, which turns a run source's answer into a place a worker edits (a fresh branch of an allowed remote in `checkout/` with kept files in `project/`, or kept files alone in `workspace/`) and saves the kept files back, plus a `scope` on `Mount` that confines a projection to one key prefix of its collection (FIX-1762).

### Patch Changes

- 8628a54: `redactRemote` is exported so a caller can show a git remote with its userinfo removed (FIX-1762).
- f2f8527: A repository listed in `localWorkspaceHost`'s `localRepositories` now keeps the remote URLs and branch upstreams the host pinned across restarts, so a run that rewrites the repository's config can't aim a later host's fetch. A remote that no longer matches its pin is not fetched, and the warning names the pin file to delete to accept a deliberate change. A fetch that fails or is skipped now starts the run from the local base instead of the remote-tracking ref (FIX-1934).
- 315f7f3: `projectWorkspace({ checkouts })` runs a listed shared project's coding runs in worktrees of a checkout on the server's machine, with the project's kept files beside each worktree, which `localWorkspaceHost`'s `localRepositories` now supports (FIX-1906).
- c4d14f6: The local workspace host no longer runs the repository's git hooks while it makes or hands back a checkout (`-c core.hooksPath=/dev/null` on its worktree git calls). A `post-checkout` hook that builds, such as `pnpm packages:build`, used to fail `git worktree add` in the fresh tree and fail the provision with it (FIX-1947).
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
- Updated dependencies [646f8d2]
- Updated dependencies [16a8dab]
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
- Updated dependencies [41638f3]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [db7df1c]
- Updated dependencies [0d6278e]
- Updated dependencies [968faa6]
- Updated dependencies [653549d]
- Updated dependencies [839e915]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
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

## 0.1.3

### Patch Changes

- Updated dependencies [b597600]
- Updated dependencies [6b8bfe4]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
  - @flow-state-dev/core@0.2.0

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
  - @flow-state-dev/core@0.1.1

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

### Patch Changes

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

## 0.0.0

- Initial release. The file projection between resource collections and
  wherever an agent works: `createProjection({ mounts, place })` hydrates
  mounted collections into a place and flushes them back, reporting an
  outcome for every path it reached. A path two writers touched comes back
  as a `conflict` carrying what the projection last committed, what the
  collection holds, and what the place holds — the three values needed to
  tell "I changed this" from "somebody else changed this". Ships
  `createHostPlace` (a real directory, contained, symlinks neither listed
  nor followed) and `createMemoryPlace` (a `Map`, for tests).

# @flow-state-dev/scheduled

## 0.4.0

### Minor Changes

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

### Patch Changes

- c049036: `createScheduledTransportAdapter` no longer refuses `idempotencyWindowMs` or `idempotencyOptions`; each is an unknown option that nothing reads (FIX-2454).

  Docs: apps/docs/docs/server/scheduled.md and packages/scheduled/README.md (drop the lines that say the adapter throws on `idempotencyWindowMs` or `idempotencyOptions`). The old names are removed outright, with no refusal message.

- Updated dependencies [2cb6326]
- Updated dependencies [7a2bb7e]
- Updated dependencies [ad80d4e]
- Updated dependencies [9d8f2be]
- Updated dependencies [0b56b1c]
- Updated dependencies [819c2a5]
- Updated dependencies [a06ad2d]
- Updated dependencies [ec679dd]
- Updated dependencies [4394069]
- Updated dependencies [1600ca1]
- Updated dependencies [c049036]
- Updated dependencies [c049036]
- Updated dependencies [74a7b9d]
- Updated dependencies [3ef3979]
- Updated dependencies [3ef3979]
- Updated dependencies [c82adfa]
- Updated dependencies [0454257]
- Updated dependencies [85ca2a3]
- Updated dependencies [95f3cce]
- Updated dependencies [0454257]
- Updated dependencies [13e3970]
  - @flow-state-dev/core@0.6.0
  - @flow-state-dev/engine@0.6.0

## 0.3.2

### Patch Changes

- Updated dependencies [531bf32]
- Updated dependencies [05a7022]
- Updated dependencies [c67aa49]
- Updated dependencies [4d3f49e]
- Updated dependencies [a1386ea]
- Updated dependencies [46e4297]
- Updated dependencies [d3eaa00]
- Updated dependencies [f1e6315]
- Updated dependencies [45c158b]
- Updated dependencies [bc65135]
- Updated dependencies [65ee4c5]
- Updated dependencies [da4a4bb]
- Updated dependencies [5f569fd]
- Updated dependencies [844a4f9]
  - @flow-state-dev/engine@0.5.0
  - @flow-state-dev/core@0.5.0

## 0.3.1

### Patch Changes

- Updated dependencies [e0daf6e]
- Updated dependencies [b9e6dd0]
- Updated dependencies [151309c]
- Updated dependencies [9a355b2]
- Updated dependencies [824ce87]
- Updated dependencies [7d92efe]
- Updated dependencies [387bee2]
- Updated dependencies [6c4a3b3]
  - @flow-state-dev/engine@0.4.0
  - @flow-state-dev/core@0.4.0

## 0.3.0

### Minor Changes

- 7da156e: Organization ids are now validated as well-formed, non-blank Unicode everywhere (resolver, `runAction`, dispatch, BullMQ jobs, schedules, `fsdev run --org`) and seat addresses escape any such id, while route segments are decoded exactly once on every host (`parseFlowRoute` now takes decoded segments, built from a raw URL by the new `decodePathSegments`), so escaped seat ids resolve on Next and Vercel and stored rows or queued jobs with a lone-surrogate org id are now refused (FIX-1757).
- eb831f8: The scheduled-dispatch endpoint fires each scheduled time at most once across retries, restarts and hosts sharing a SQLite or Postgres store, refuses crons that aren't five fields and unknown time zones, and removes `idempotencyKey`, `idempotencyWindowMs` and `idempotencyOptions`; teams outside the repo rewrite at upgrade, see the migration notes (FIX-2085).
- 02ee032: Remove backward-compatibility paths (FIX-1804, FIX-850): stores read only the current on-disk and table layouts with no migration of older data, `@flow-state-dev/claude-code` drops its package-root entry and deprecated handle aliases, `@flow-state-dev/patterns` drops `legacyWorkerAdapter` and `executableTaskSchema`, and removed options such as `clientData`, `requireOrg`, `presets`, `preset/*` model strings, `prefer` and `fileFilter`/`syncMode` are no longer refused by name.
- 8195995: Schedule index rows are now identified by the storage cell the schedule lives in plus its key, so a person's same-named schedules in two hired seats (or a seat and their app-wide flow) are two rows and turning one off no longer stops the other (FIX-1546). `ScheduleIndexRow` gains a required `cell`, `ScheduleIndex.remove` takes `{ cell, key }` instead of `(userId, key)`, and `CollectionHookContext` gains `cell`, the storage key the instance is persisted under. A custom `ScheduleIndex` must key its storage on `(cell, key)` and store `cell`; the conformance suite covers it. The SQLite and Postgres `schedule_index` tables are re-keyed on `(cell, key)` automatically at schema init, adopting every existing row as its person's own cell; with `skipSchemaInit: true`, apply the upgrade SQL in the schedule index reference. BullMQ scheduler ids are built from the cell and key; an app-wide schedule for an ordinary user id keeps its existing scheduler id.
- 69ba29c: Every flow now keeps a user's data per organization, so `resolveUserStorageKey(userId, orgId, flow)` takes the organization and throws without one, a dynamic schedule's dispatch id is `<orgId>/<userId>/<key>` (built by the new `formatScheduleId`), and the test harness seeds user data in the run's organization (FIX-1790).

### Patch Changes

- f282bcb: A queue adapter can supply a shared lease backend (`WorkerAdapter.leaseBackend`) so a session's `queue` / `reject` concurrency policy holds across every process of a deployment, and every transport answers a refusal that arrives after dispatch the same way it answers one thrown from it (FIX-1634).
- 712dc22: A hired seat now keeps what it saves for a person (shared user-scoped resources and user state) under one user-scope key per organization and person, `<userId>:~org:<orgId>`, so the same person's seat in another organization starts empty and no seat reads the person's app-wide data; data seats saved before upgrading is not read for them until you run the optional offline copy in the persistence docs under "Upgrading: moving hired seats' stored data" (FIX-1538).
- 0503c38: A schedule created with `schedules.create(key, { cron, kind, enabled })` on a `defineScheduleCollection` collection now fires and keeps firing after a reschedule: the resolver reads the row from resource state (`ScheduleResolutionStores` now requires `resourceState`), and a new `stampOrgId` collection option records the creating run's organization on the row, keeps it across updates, and refuses any write that names another organization (FIX-1545).
- Updated dependencies [92b2b70]
- Updated dependencies [20aa58f]
- Updated dependencies [5d31955]
- Updated dependencies [bea14a0]
- Updated dependencies [15f7c6b]
- Updated dependencies [24afa6e]
- Updated dependencies [f8df86f]
- Updated dependencies [82eea02]
- Updated dependencies [e2c190e]
- Updated dependencies [0d55d46]
- Updated dependencies [1abab86]
- Updated dependencies [8e67ce5]
- Updated dependencies [920adc3]
- Updated dependencies [283fb2a]
- Updated dependencies [dd353e2]
- Updated dependencies [3221d05]
- Updated dependencies [58ffc93]
- Updated dependencies [f97b0ed]
- Updated dependencies [397cfa7]
- Updated dependencies [9f06d39]
- Updated dependencies [452b702]
- Updated dependencies [53b50f0]
- Updated dependencies [e4fb1f1]
- Updated dependencies [538cd1a]
- Updated dependencies [585b75b]
- Updated dependencies [3b5266a]
- Updated dependencies [2ffc03c]
- Updated dependencies [646f8d2]
- Updated dependencies [16a8dab]
- Updated dependencies [b75c1ed]
- Updated dependencies [25ac53a]
- Updated dependencies [456fe85]
- Updated dependencies [6453d2c]
- Updated dependencies [62133c4]
- Updated dependencies [f282bcb]
- Updated dependencies [651c87e]
- Updated dependencies [9d02ac6]
- Updated dependencies [d5ce1e0]
- Updated dependencies [55c62a6]
- Updated dependencies [8dc242e]
- Updated dependencies [89af7db]
- Updated dependencies [85b2965]
- Updated dependencies [1355483]
- Updated dependencies [7d4158f]
- Updated dependencies [5492a77]
- Updated dependencies [6819520]
- Updated dependencies [099906a]
- Updated dependencies [ad5df6f]
- Updated dependencies [5902deb]
- Updated dependencies [2ce15c7]
- Updated dependencies [4f2e13e]
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
- Updated dependencies [42bfbe6]
- Updated dependencies [fe5df7d]
- Updated dependencies [423a405]
- Updated dependencies [08a9b05]
- Updated dependencies [57323b9]
- Updated dependencies [7da156e]
- Updated dependencies [8a55e23]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [430db1b]
- Updated dependencies [21ffcbb]
- Updated dependencies [f9995b1]
- Updated dependencies [5a55080]
- Updated dependencies [a7f1c41]
- Updated dependencies [3a6c910]
- Updated dependencies [80f6e25]
- Updated dependencies [2d2518b]
- Updated dependencies [c57890d]
- Updated dependencies [3cbab3a]
- Updated dependencies [3cbab3a]
- Updated dependencies [849f6ec]
- Updated dependencies [028af6f]
- Updated dependencies [a965a50]
- Updated dependencies [eb831f8]
- Updated dependencies [41638f3]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [a64132b]
- Updated dependencies [db7df1c]
- Updated dependencies [0d6278e]
- Updated dependencies [968faa6]
- Updated dependencies [653549d]
- Updated dependencies [0abbcd9]
- Updated dependencies [d9d00a4]
- Updated dependencies [c6b2db9]
- Updated dependencies [839e915]
- Updated dependencies [711ed0e]
- Updated dependencies [72c5b17]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
- Updated dependencies [65ddb90]
- Updated dependencies [47a02d0]
- Updated dependencies [e0f10e2]
- Updated dependencies [9083569]
- Updated dependencies [9510a03]
- Updated dependencies [0935a47]
- Updated dependencies [d2f77fc]
- Updated dependencies [0995afe]
- Updated dependencies [adbcf0b]
- Updated dependencies [d9d00a4]
- Updated dependencies [1027b98]
- Updated dependencies [1cfd80c]
- Updated dependencies [229de7a]
- Updated dependencies [4ca0e99]
- Updated dependencies [3b0161c]
- Updated dependencies [d86c7db]
- Updated dependencies [385d01e]
- Updated dependencies [fa7b22e]
- Updated dependencies [a4e626b]
- Updated dependencies [d1a4cab]
- Updated dependencies [83cd9c2]
- Updated dependencies [3311cc2]
- Updated dependencies [7c9e932]
- Updated dependencies [637b6d5]
- Updated dependencies [60c8192]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [71b0174]
- Updated dependencies [295e96a]
- Updated dependencies [8b8ba8d]
- Updated dependencies [97894aa]
- Updated dependencies [3c2ab06]
- Updated dependencies [334c1e3]
- Updated dependencies [64b3ed7]
- Updated dependencies [92a8b49]
- Updated dependencies [9ed6b29]
- Updated dependencies [9f32967]
- Updated dependencies [b7c523b]
- Updated dependencies [6bf61dc]
- Updated dependencies [b552b50]
- Updated dependencies [a021cd1]
- Updated dependencies [c8c8b38]
- Updated dependencies [1f2dadd]
- Updated dependencies [cd180d7]
- Updated dependencies [6306a75]
- Updated dependencies [68b8957]
- Updated dependencies [e11764a]
- Updated dependencies [2c43888]
- Updated dependencies [872a088]
- Updated dependencies [9cd314d]
- Updated dependencies [9af8ce5]
- Updated dependencies [30aa133]
- Updated dependencies [6e1a819]
- Updated dependencies [0d6278e]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [a26e426]
- Updated dependencies [69ba29c]
- Updated dependencies [d97031f]
- Updated dependencies [f741004]
- Updated dependencies [49d2aca]
- Updated dependencies [3c10d9d]
- Updated dependencies [ce8f765]
- Updated dependencies [96ff077]
- Updated dependencies [84cc226]
  - @flow-state-dev/core@0.3.0
  - @flow-state-dev/engine@0.3.0

## 0.2.0

### Minor Changes

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

- Updated dependencies [b597600]
- Updated dependencies [795b550]
- Updated dependencies [6b8bfe4]
- Updated dependencies [3e43c96]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
- Updated dependencies [e4b6576]
  - @flow-state-dev/core@0.2.0
  - @flow-state-dev/engine@0.2.0

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2
  - @flow-state-dev/engine@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
  - @flow-state-dev/core@0.1.1
  - @flow-state-dev/engine@0.1.1

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

### Patch Changes

- afcac3d: A flow declares its `cardinality` — `"singleton"` (the default: `myFlow()` is the one instance, addressed by its kind, and `myFlow({ id: "default" })` now throws) or `"collection"` (several configured copies, each registered under its own required `id`) — every address (the action, stream, resume, retry and continue routes, `fsdev run`, dispatchers, BullMQ jobs, MCP, webhook and schedule dispatch) is the exact instance id with no first-registered fallback, every session and request records its owning `flowId` and is refused when reached through another instance (`FlowInstanceBindingMismatchError`; `409 wrong-instance-session` / `wrong-instance-request` / `migration-required` on the routes), and SQLite and Postgres add a nullable indexed `flow_id` column with no backfill (FIX-1321, FIX-1322).
- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [e2fda9d]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [af40427]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [2c4b0f5]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0
  - @flow-state-dev/engine@0.1.0

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-11 — Scheduled actions: schedule index, auto-mirroring (FIX-581)

New `ScheduleIndex` interface for store-backed schedule fan-out. Implementations track `(userId, key, cron, timezone, nextFireAt)` rows and expose `upsert`, `remove`, and atomic `claimDue`. New `defineScheduleCollection` wraps `defineResourceCollection` with the standard schedule state schema and mirrors every create / update / delete into an attached index automatically. Rows with `enabled: false` are removed from the index, so disabling a schedule stops it firing without deleting the record.

### 2026-05-10 — Scheduled actions: declarative cron + dispatch endpoint (FIX-440)

New `@flow-state-dev/scheduled` package shipping `createScheduledTransportAdapter`, `findScheduledRequest`, and `createResourceCollectionScheduleResolver`. Mounts `POST /api/flows/:kind/schedules/:scheduleId/dispatch` and a sibling `GET .../schedules` listing endpoint. Two-phase auth: `host.resolvePrincipal` establishes the gateway principal and each schedule carries an optional `principal` that wins for the action's effective user. Idempotency (per-process LRU keyed on `(scheduleId, nominalFireTime)`, default 60s window). `onOverlap: "skip" | "allow"` (skip is default).

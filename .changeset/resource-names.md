---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/workspace": minor
"@flow-state-dev/scheduled": minor
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
"@flow-state-dev/devtool": patch
"@flow-state-dev/orchestration": minor
"@flow-state-dev/shift-manager": patch
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/workforce": minor
---

**Breaking:** one word for a stored thing, *resource*, and *Status* for a lifecycle (FIX-2479). Exported names that said *row* or *collection item* for a resource, or *row* for a task, are renamed, with no aliases. Stored field names, storage keys and HTTP paths do not change: a worktree record keeps its `state` field, now typed `WorktreeStatus`.

### Renamed exports

| Package | Old | New |
|---|---|---|
| `core` (`/internal`) | `WaitRow` | `TaskAddress` |
| `core` (`/harness`) | `planRowsPrefix` | `planResourcesPrefix` |
| `core` (`/harness`) | `readPlanTarget(...)` result field `rowsPrefix` | `resourcesPrefix` |
| `core` | `SessionCreateCheckInput.readCollectionItem(ref, topic)` | `readCollectionResource(ref, topic)` |
| `engine` | `DebugCollectionItem` | `DebugCollectionResource` |
| `engine` | `DebugCollectionItemsResponse` | `DebugCollectionResourcesResponse` (its `items` wire field is unchanged) |
| `engine` | `ResourceIndexBuildState` | `ResourceIndexBuildStatus` |
| `workspace` | `WorktreeRow` | `WorktreeResourceState` |
| `workspace` | `worktreeRowSchema` | `worktreeResourceStateSchema` |
| `workspace` | `WorktreeState` | `WorktreeStatus` |
| `workspace` | `worktreeStateSchema` | `worktreeStatusSchema` |
| `scheduled` | `ScheduleIndexRow` | `ScheduleIndexEntry` (one schedule's entry in the schedule index) |
| `client` | `CollectionItemHandle` | `CollectionResourceHandle` |
| `client` | `CollectionItemState` | `CollectionResourceState` |
| `client` | `CreateCollectionItemOptions` | `CreateCollectionResourceOptions` |
| `client` | `ListCollectionItemsOptions` | `ListCollectionResourcesOptions` |
| `client` | `DebugCollectionItem` | `DebugCollectionResource` |
| `client` | `DebugCollectionItemsResponse` | `DebugCollectionResourcesResponse` (its `items` wire field is unchanged) |
| `client` | `ListDebugCollectionItemsOptions` | `ListDebugCollectionResourcesOptions` |
| `client` | `client.resources.listCollectionItems` | `listCollectionResources` |
| `client` | `client.resources.createCollectionItem` | `createCollectionResource` |
| `client` | `client.resources.getCollectionItemState` | `getCollectionResourceState` |
| `client` | `client.resources.getCollectionItemContent` | `getCollectionResourceContent` |
| `client` | `client.resources.deleteCollectionItem` | `deleteCollectionResource` |
| `client` | `client.sessions.debug.listCollectionItems` | `listCollectionResources` (the debug route's URL is unchanged) |
| `client` | `client.sessions.debug.fetchCollectionItemContent` | `fetchCollectionResourceContent` |
| `client` | `SessionConnectionState` | `SessionConnectionStatus` |
| `react` | `useResourceCollectionItem` | `useCollectionResource` (its result's `item` field is unchanged) |
| `react` | `UseResourceCollectionItemResult` | `UseCollectionResourceResult` |
| `react` | `AudioPlayerState`, `AudioRecorderState` | `AudioPlayerStatus`, `AudioRecorderStatus` |
| `react` (`/workforce`) | `PanelRowSource`, `PanelItemSource` | unchanged names; they now pick `listCollectionResources` and `getCollectionResourceState` |
| `orchestration` (`/tasks`) | `rowHoldSchema` | `ownHoldSchema` (a task's own hold: a question, a confirm or an external wait) |
| `orchestration` (`/tasks`) | `RowHold` | `OwnHold` |
| `orchestration` (`/inbox`) | `RowHoldSource` | `OwnHoldSource` (its `kind` is `"task"`, was `"row"`) |
| `orchestration` (`/inbox`) | `InboxRow` | `InboxTaskInput` |
| `orchestration` (`/inbox`) | `RefileRow` | `RefiledTask` |
| `orchestration` (`/inbox`) | `taskRowView(row, holds?)` | `taskView(task, holds?)` |
| `orchestration` (`/inbox`) | `TaskRowView` | `TaskView` |
| `orchestration` (`/inbox`) | `TaskViewRow` | `TaskViewInput` |
| `orchestration` (`/inbox`) | `TaskRowState` | `TaskViewStatus` |
| `orchestration` (`/inbox/check`) | `RowTruth` | `TaskTruth` (its `rowHolds` field is `ownHolds`) |
| `orchestration` (`/inbox/check`) | `rowTruthOf` | `taskTruthOf` |
| `orchestration` (`/internal`) | `isRowHold`, `openRowHolds` | `isOwnHold`, `openOwnHolds` |
| `orchestration` (`/internal`) | `rowsInSession` | `tasksInSession` |
| `engine` (`/internal`) | `OwnerRunRefusal` value `"no_row"` | `"no_resource"` |
| `harness-manager` | `HarnessReadinessRow` | `HarnessReadinessView` |
| `harness-manager` | `harnessReadinessRowSchema` | `harnessReadinessViewSchema` |
| `harness-manager` | `HarnessUsageRow` | `HarnessUsageView` |
| `harness-manager` | `HarnessUsageWindowRow` | `HarnessUsageWindowView` |
| `harness-manager` (and `/browser`) | `PullRequestRecordRow` | `PullRequestRecordResourceState` |
| `harness-manager` (and `/browser`) | `PullRequestWaitRow` | `PullRequestWaitInput` |
| `harness-manager` | `PlaceState` | `PlaceStatus` (a run record's place keeps its `state` field, now typed `PlaceStatus`) |
| `harness-manager` | `placeStateSchema` | `placeStatusSchema` |
| `harness-manager` | `readRunRow` | `readRunRecord` |
| `workforce` | `WorkerRow` | `WorkerResourceState` (the worker's configuration, as stored) |
| `workforce` | `workerRowSchema` | `workerResourceStateSchema` |
| `workforce` | `parseWorkerRow(value)` | `parseWorkerResourceState(value)`, answering `{ worker }` (was `{ row }`) or `{ problem }` |
| `workforce` | `StandardWorkerRow` | `StandardWorkerResourceState` |
| `workforce` | `standardWorkerRowSchema` | `standardWorkerResourceStateSchema` |
| `workforce` | `ProjectRow` | `ProjectResourceState` |
| `workforce` | `projectRowSchema` | `projectResourceStateSchema` |
| `workforce` | `WorkerInventoryRow` | `WorkerInventoryResourceState` |
| `workforce` | `workerInventoryRowSchema` | `workerInventoryResourceStateSchema` |
| `workforce` | `SubscriptionRow` | `SubscriptionResourceState` |
| `workforce` | `subscriptionRowSchema` | `subscriptionResourceStateSchema` |
| `workforce` (and `/browser`) | `WorkerMessageRow` | `WorkerMessageResourceState` |
| `workforce` (and `/browser`) | `workerMessageRowSchema` | `workerMessageResourceStateSchema` |
| `workforce` | `WorkerUsageRow` | `WorkerUsageView` (one worker's line in the `workerUsage` query's answer) |
| `workforce` | `ReportRow` | `ReportResourceState` |

### For client developers: values and messages an app branches on or matches

Code that branches on one of these values, or matches one of these messages, changes when it upgrades. In each message only the noun changes; the rest of the sentence is the same.

| What | Old | New |
|---|---|---|
| A task's own hold (`Task.holds[].source.kind`, and the Inbox's `InboxHold.source.kind`) | `"row"` | `"task"`. A hold stored as `"row"` still reads as `"task"` and can still be answered; `"row"` is never written again |
| Dispatch refusal (`DispatchOutcome.refused`) | `"external-dispatcher"` | `"external-flow-runner"` |
| Owner-private refusal | starts "A row of an owner-private …" | "A resource in an owner-private collection is readable only by the user it belongs to." |
| Owner-writes refusal | starts "A row of an owner-writes …" | "A resource in an owner-writes collection is written only by the user it belongs to." |
| Startup overlap error | `Collection pattern "<P>" can reach the rows of owner-<mode> collection "<Q>".` | `Collection pattern "<P>" can reach the resources of owner-<mode> collection "<Q>".` |
| Owner-segment refusal ("That segment is reserved for the user an owner-private collection's …") | "… row belongs to, …" | "… resource belongs to, …" |

Every other error and refusal message that said *row* follows one rule: *task* where the row was a task (dispatch, the task board, the ledger), *resource* elsewhere, and *collection resources* for *collection items*. In this release that covers the task board's, the task entry's, the ledger's and the task collection's errors in `orchestration` (and the `listTasks` tool's description a model reads), the Inbox check's drift lines, the dispatcher's and `defineFlow`'s task-entry errors, the faceted and owner-writes collection errors in `core`, the parent-task, owner-run and cross-board errors in `engine`, the schedule-index warning in `scheduled`, the harness manager's superseded-attempt, run-record, worktree-resource, phase-mismatch and foreign-run errors and the scripted coder's steps and commit message in `harness-manager`, the worker inventory's, the shadowed-reference, the hire and roster-loader document, the project-read tool's description and the project-link errors in `workforce`, and the DevTool's "Failed to fetch collection resources" (was "…collection items").

Docs: every published page and package README that still names a renamed export or value, by page, with the names it uses. Pages: `docs/glossary.md` ("A task is a row", "A project is one row", "One row, in user or org scope", "A resource row") and `docs/resources/collections.md` (the collections pages say *resource*; collections.md also quotes the owner-private and owner-writes refusals and the overlap error, and names `CollectionItemHandle`); `docs/workforce/projects.md` (quotes the owner-writes refusal; `getCollectionItemContent`); `docs/orchestration/task-substrate.md` (the hold marker `"row"` is `"task"`, and its refusal tables' `external-dispatcher` is `external-flow-runner`); `docs/advanced/concurrency-policies.md`, `docs/server/background-work.md` and `guides/keeping-a-flow-running.md` (`external-dispatcher`); `docs/tools/coding-agents.md` (`planRowsPrefix`, `readPlanTarget`'s `rowsPrefix`); `docs/fundamentals/state-and-scopes.md` (`readCollectionItem`); `docs/api/client.md` (`CollectionItemState` and the client methods `listCollectionItems`, `createCollectionItem`, `getCollectionItemState`, `getCollectionItemContent`, `deleteCollectionItem`); `docs/client/overview.md` (`listCollectionItems`, `getCollectionItemState`); `docs/client/react.md` (`CollectionItemHandle`, `useResourceCollectionItem`); `docs/resources/client-access.md` (`createCollectionItem`, `getCollectionItemContent`, `deleteCollectionItem`, `useResourceCollectionItem`); `docs/workforce/delegating-work.md`, `docs/workforce/inventory.md` and `docs/workforce/ui.md` (`listCollectionItems`); `guides/writing-ui-stories.md` (`resources.listCollectionItems`, `getCollectionItemState`); `docs/workforce/messaging-workers.md` (`workerMessageRowSchema`); `docs/orchestration/harness-manager.md` (its readiness section: `HarnessReadinessRow`, `harnessReadinessRowSchema`); `docs/orchestration/task-board.md` (`taskRowView`); `docs/server/schedule-index.md` and `guides/scheduled-dynamic.md` (`ScheduleIndexRow`). READMEs, each with the old names it still uses (the tables above give the new ones): packages/core/README.md (`planRowsPrefix`, `readPlanTarget`'s `rowsPrefix`, `useResourceCollectionItem`, `external-dispatcher`, and a quote of the owner-writes refusal); packages/claude-code/README.md and packages/cursor/README.md (`readPlanTarget`'s `rowsPrefix`); packages/client/README.md (`CollectionItemState`, `listCollectionItems`, `createCollectionItem`, `getCollectionItemState`, `getCollectionItemContent`, `deleteCollectionItem`, `SessionConnectionState`); packages/react/README.md (`CollectionItemHandle`, `resources.listCollectionItems`, `resources.getCollectionItemState`, `useResourceCollectionItem`); packages/orchestration/README.md (`taskRowView`, `rowsInSession`); packages/harness-manager/README.md (`openRowHolds`, `HarnessReadinessRow`, `harnessReadinessRowSchema`, `HarnessUsageRow`, `readRunRow`); packages/workforce/README.md (`listCollectionItems`, `taskRowView`, `workerRowSchema`, `parseWorkerRow`, `WorkerInventoryRow`, `workerInventoryRowSchema`, `subscriptionRowSchema`, `WorkerMessageRow`, `workerMessageRowSchema`, `WorkerUsageRow`, and a quote of the owner-writes refusal); packages/engine/README.md (`no_row`). packages/workspace/README.md (a worktree record is `WorktreeResourceState`, its `state` field typed `WorktreeStatus`, parsed with `worktreeStatusSchema`).

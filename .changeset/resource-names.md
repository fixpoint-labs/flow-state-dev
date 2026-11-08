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
"@flow-state-dev/harness-manager": patch
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
| `workspace` | `WorktreeRow` | `WorktreeResourceState` |
| `workspace` | `worktreeRowSchema` | `worktreeResourceStateSchema` |
| `workspace` | `WorktreeState` | `WorktreeStatus` |
| `workspace` | `worktreeStateSchema` | `worktreeStatusSchema` |
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
| `react` | `useResourceCollectionItem` | `useCollectionResource` (its result's `item` field is unchanged) |
| `react` | `UseResourceCollectionItemResult` | `UseCollectionResourceResult` |
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
| `engine` (`/internal`) | `OwnerRunRefusal` value `"no_row"` | `"no_resource"` |

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

Every other error and refusal message that said *row* follows one rule: *task* where the row was a task (dispatch, the task board, the ledger), *resource* elsewhere, and *collection resources* for *collection items*. In this release that covers the task board's, the task entry's, the ledger's and the task collection's errors in `orchestration` (and the `listTasks` tool's description a model reads), the Inbox check's drift lines, the dispatcher's and `defineFlow`'s task-entry errors, the faceted and owner-writes collection errors in `core`, the parent-task, owner-run and cross-board errors in `engine`, the schedule-index warning in `scheduled`, and the DevTool's "Failed to fetch collection resources" (was "…collection items").

Docs: the published glossary and collections pages, the task-substrate refusal tables (`external-dispatcher` becomes `external-flow-runner`), the run's plan section of the coding-agents page (`planResourcesPrefix`, `resourcesPrefix`), the create-check section of state and scopes (`readCollectionResource`), and the six pages that quote the owner-collection messages. packages/workspace/README.md (a worktree record is `WorktreeResourceState`, its `state` field is typed `WorktreeStatus`, parsed with `worktreeStatusSchema`). packages/client/README.md (the collection types are `CollectionResourceHandle`, `CollectionResourceState`, `CreateCollectionResourceOptions`, `ListCollectionResourcesOptions`; the debug types are `DebugCollectionResource`, `DebugCollectionResourcesResponse`, `ListDebugCollectionResourcesOptions`; the methods are `listCollectionResources`, `createCollectionResource`, `getCollectionResourceState`, `getCollectionResourceContent`, `deleteCollectionResource`, and on `sessions.debug` `listCollectionResources` and `fetchCollectionResourceContent`). packages/react/README.md (the one-resource hook is `useCollectionResource`, returning `UseCollectionResourceResult`; the panels' client slice picks `resources.listCollectionResources`, or `resources.getCollectionResourceState` for `WorkerDetail`). The published client, React, collections, client-access and workforce pages name the old client methods and `useResourceCollectionItem`. packages/orchestration/README.md (the task-view section: `taskRowView` is `taskView`, returning `TaskView` with a `TaskViewStatus`, read from a `TaskViewInput`; the Inbox's `InboxRow` is `InboxTaskInput`, `RefileRow` is `RefiledTask`, `RowHoldSource` is `OwnHoldSource` with `kind: "task"`; on `/tasks` `rowHoldSchema` and `RowHold` are `ownHoldSchema` and `OwnHold`; on `/inbox/check` `RowTruth` and `rowTruthOf` are `TaskTruth` and `taskTruthOf`; on `/internal` `isRowHold` and `openRowHolds` are `isOwnHold` and `openOwnHolds`). packages/harness-manager/README.md (held tasks' open questions are read with `openOwnHolds`). packages/workforce/README.md (fold a task's spend with `taskView`). packages/engine/README.md (an owner run's refusal for a cell holding no such resource is `no_resource`). The published task-substrate page's hold markers say `"task"` for a task's own hold.

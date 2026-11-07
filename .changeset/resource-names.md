---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/workspace": minor
"@flow-state-dev/scheduled": minor
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

### For client developers: values and messages an app branches on or matches

Code that branches on one of these values, or matches one of these messages, changes when it upgrades. In each message only the noun changes; the rest of the sentence is the same.

| What | Old | New |
|---|---|---|
| Dispatch refusal (`DispatchOutcome.refused`) | `"external-dispatcher"` | `"external-flow-runner"` |
| Owner-private refusal | starts "A row of an owner-private …" | "A resource in an owner-private collection is readable only by the user it belongs to." |
| Owner-writes refusal | starts "A row of an owner-writes …" | "A resource in an owner-writes collection is written only by the user it belongs to." |
| Startup overlap error | `Collection pattern "<P>" can reach the rows of owner-<mode> collection "<Q>".` | `Collection pattern "<P>" can reach the resources of owner-<mode> collection "<Q>".` |
| Owner-segment refusal ("That segment is reserved for the user an owner-private collection's …") | "… row belongs to, …" | "… resource belongs to, …" |

Every other error and refusal message that said *row* follows one rule: *task* where the row was a task (dispatch, the task board, the ledger), *resource* elsewhere, and *collection resources* for *collection items*. In this release that covers the dispatcher's and `defineFlow`'s task-entry errors, the faceted and owner-writes collection errors in `core`, the parent-task, owner-run and cross-board errors in `engine`, and the schedule-index warning in `scheduled`.

Docs: the published glossary and collections pages, the task-substrate refusal tables (`external-dispatcher` becomes `external-flow-runner`), the run's plan section of the coding-agents page (`planResourcesPrefix`, `resourcesPrefix`), the create-check section of state and scopes (`readCollectionResource`), and the six pages that quote the owner-collection messages.

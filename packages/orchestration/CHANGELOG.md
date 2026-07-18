# @flow-state-dev/orchestration

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

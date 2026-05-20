# @flow-state-dev/react

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

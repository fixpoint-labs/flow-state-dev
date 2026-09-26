# @flow-state-dev/react

## 0.3.0

### Minor Changes

- bb1c224: `FlowNavigator` now draws an open leaf's `leafToolbar` on that leaf's own row, showing both row slots only when the row is hovered or focused (always on touch screens), so give them icon buttons with an `aria-label`, it adds dashed tree lines you can colour with `--fsd-nav-guide` and a `leafDetail` slot for content that sits on its own lines under an open leaf's row, and untitled session rows show a shortened id with the full id on hover (FIX-1561).

### Patch Changes

- 736e719: `Roster` and `BoardColumns` now read every page of their collection, following the list route's cursor instead of stopping at the first page — a collection past the route's default page size no longer truncates silently, dropping its last rows (FIX-1477).
- 0e7e07e: Adds `SeatDetail`, a panel showing one seat's kind (from a prop, no read) and its instructions (one item read from the roster collection). A user-owned or undeclared seat shows its instructions as not published, with no read (FIX-1500).
- Updated dependencies [53b50f0]
- Updated dependencies [585b75b]
- Updated dependencies [8dc242e]
- Updated dependencies [7d4158f]
- Updated dependencies [211679a]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [a7f1c41]
- Updated dependencies [7d4c413]
- Updated dependencies [3311cc2]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [407964a]
  - @flow-state-dev/core@0.3.0
  - @flow-state-dev/client@0.2.1
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

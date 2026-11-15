---
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/react": minor
"@flow-state-dev/testing": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
"@flow-state-dev/patterns": minor
"@flow-state-dev/devtool": patch
"@flow-state-dev/shift-manager": patch
---

Structured content is one item kind, `data`, emitted with `ctx.emit.data(dataType, value, { key? })` (FIX-2738). The `component` item kind is removed, with no alias: a "component" is now a `dataType` with a renderer registered for it.

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

**Stored sessions.** A request stored before this can hold `component` items. The request store `createFlowState` builds reads each one back as a data item (`component` → `dataType`, `data` → `value`, same id, status and key), in a record and in a replayed or resumed stream, so every reader sees data items. Nothing is rewritten in the store. Stores built directly, outside `createFlowState`, do not migrate.

Docs: apps/docs/docs/streaming/emitting-items.md (one item kind for structured content: `ctx.emit.data`, `value`, keyed snapshots, default visibility, drawing through `renderers.data`; remove every `ctx.emit.component` section), apps/docs/docs/streaming/overview.md and apps/docs/docs/configuration/blocks.md (emitter tables), apps/docs/docs/client/react.md, apps/docs/docs/api/react.md and packages/react/README.md (`renderers.data`, `renderers.component` for suspensions only, `useContainerItems` `dataByKey`), packages/core/README.md (emitters), apps/docs/docs/orchestration/task-board.md, apps/docs/docs/orchestration/task-substrate.md, apps/docs/docs/sequencers/wait-for-condition.md and packages/orchestration/README.md (task records are data items, renamed constants), apps/docs/docs/patterns/plan-and-execute.md, apps/docs/docs/patterns/response-auditor.md, apps/docs/docs/patterns/event-actors.md and packages/patterns/README.md (pattern records are data items, renderers go under `data`), apps/docs/docs/ui/flow-aware-components.md and packages/ui/README.md (generative cards and the chat registry use the `data` slot), apps/docs/docs/workforce/coordinators.md, packages/workforce/README.md and packages/shift-manager/README.md (routing records and received messages are data items, renamed constant), apps/docs/docs/api/testing.md, apps/docs/docs/testing/testing-flows.md, apps/docs/docs/testing/overview.md and packages/testing/README.md (`testItems().data()`, `components()` removed).

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

A new `data` conversation item for records of something that happened, emitted with `ctx.emit.data(dataType, value, { key? })` (FIX-2738). `component` items now mean generative UI only.

- **core / engine:** `ctx.emit.data(dataType, value, options?)` emits `{ type: "data", dataType, value, key? }`. The payload is `value`. Options are `key` (keyed snapshot: one entry per request and key, `value` replaced), `itemVisibility`, `agentName` and `transient` (default `false`, persisted).
- **contracts / core:** `DataItem` joins the `OutputItem` union. A data item's visibility is opt-in: with no `itemVisibility` it reaches no client stream, no session snapshot and no model history (`resolveItemVisibility` → `{ client: false, history: false }`). A reader that asks for it by type (`items.all({ itemTypes: ["data"] })`, a snapshot's `item_types`) still gets it. With `history: true`, a turn's history replays it as one assistant line, `[dataType] <value as JSON>`.
- **react:** `RendererRegistry` has a `data` slot keyed by `dataType`. A data item with no renderer there renders nothing, never the JSON fallback. Keyed data items dedup like keyed components, and a container renderer manages the data items it owns. `useContainerItems` reads a container's `state` from its latest data item whose `dataType` is the container's `component`, and `componentsByKey` is renamed `dataByKey` (data items by key). The old name is removed.
- **testing:** `testItems(items).data(dataType?)` returns data items.
- **orchestration:** `task-change`, `task-board-meta`, `task-board-recorder-failure` and `goal-seek-loop-termination` are data items. The constants are renamed, with no alias: `TASK_CHANGE_DATA_TYPE`, `TASK_BOARD_META_DATA_TYPE`, `TASK_BOARD_RECORDER_FAILURE_DATA_TYPE`, `GOAL_SEEK_LOOP_TERMINATION_DATA_TYPE`. A reader of these records reads `item.type === "data"`, `item.dataType` and `item.value`. The recorder-failure and termination records no longer reach a client.
- **workforce:** `coordinator-route` and `workforce:received` are data items; `RECEIVED_MESSAGE_COMPONENT` is renamed `RECEIVED_MESSAGE_DATA_TYPE`, with no alias. An app renderer for either moves from `renderers.component` to `renderers.data` and reads `item.value`. A conversation stored before this still reads its routing records.
- **patterns:** debate's `debate-turn`, `debate-turn-pending`, `debate-decision` and `debate-verdict`, event actors' `rb-entry`, routed specialists' `routedSpecialists` snapshot and the response auditor's `audit-annotation` are data items. An app renderer for one moves to `renderers.data` and reads `item.value`.
- **devtool:** draws data items, and its task boards read the data records.
- **shift-manager:** draws routing records, received messages and task boards from data items.

Sessions stored before this keep their old `component`-shaped records. Only the coordinator's routing reads them; a board or a debate in an older session shows nothing from those items.

Docs: apps/docs/docs/streaming/emitting-items.md (a section on data items vs components: `ctx.emit.data`, `value`, keyed snapshots, opt-in visibility, rendering through `renderers.data`; the keyed-snapshot matrix names data records), apps/docs/docs/client/react.md, apps/docs/docs/api/react.md and packages/react/README.md (`renderers.data`, `useContainerItems` `dataByKey`), apps/docs/docs/orchestration/task-board.md, apps/docs/docs/orchestration/task-substrate.md, apps/docs/docs/sequencers/wait-for-condition.md and packages/orchestration/README.md (task records are data items, renamed constants), apps/docs/docs/patterns/plan-and-execute.md, apps/docs/docs/patterns/response-auditor.md, apps/docs/docs/patterns/event-actors.md and packages/patterns/README.md (pattern records are data items, renderers go under `data`), apps/docs/docs/ui/flow-aware-components.md and packages/ui/README.md (the chat registry's `data` slot), apps/docs/docs/workforce/coordinators.md, packages/workforce/README.md and packages/shift-manager/README.md (routing records and received messages are data items, renamed constant), apps/docs/docs/api/testing.md, apps/docs/docs/testing/testing-flows.md, apps/docs/docs/testing/overview.md and packages/testing/README.md (`testItems().data()`; record assertions read data items).

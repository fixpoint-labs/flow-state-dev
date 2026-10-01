# Items

**Read before touching items, rendering, or the stream.** Blocks produce items; they stream over SSE and the durable ones persist on the request record. Emitting, keyed snapshots and the wire protocol are user-facing: [Emitting Items](../../apps/docs/docs/streaming/emitting-items.md), [SSE Protocol](../../apps/docs/docs/streaming/items.md) (which also covers generator identity, `agentName` and `selectForContext`). Types: `packages/contracts/src/items/types.ts`. This page is the registry and its contracts.

## Visibility

`resolveItemVisibility(item)` (`packages/contracts/src/items/resolve-visibility.ts`) is a pure function of `(item.type, item.itemVisibility)` returning `{ client, history }`. The devtool sees everything.

| Category | Types | Visibility |
|---|---|---|
| Trace | `block_trace`, `router_decision`, `state_snapshot`, `generator_step` | always `{ client: false, history: false }` |
| Conversational | `message`, `reasoning`, `tool_output` | `item.itemVisibility`, default `{ client: true, history: true }` |
| Structural | everything else | fixed `{ client: true, history: false }`; `itemVisibility` is metadata only (filtering, per-agent rendering) |

Design decisions, so they aren't reopened:

- **Two independent booleans, not an enum.** The earlier `agentType` (`primary`/`sub`/`trace`) couldn't express `{ client: false, history: true }` (private/injected context).
- **No position-inferred default.** Nesting never changes a generator's emission; each declares its own, and pattern factories expose `*ItemVisibility` knobs per internal role. Inference would silently reclassify output based on composition shape.
- **Visibility is metadata, not type remapping.** Sub-agent text stays a `message`; clients decide rendering. `<ItemsRenderer>` hides `{ client: true, history: false }` by default (`showSubAgents` opts in).
- **One history filter.** `items.history()` means conversation history; any other slice is `selectForContext` (raw, unfiltered `SessionItem[]`).

## Registry

| Type | Emitted by | Category | Persistence |
|---|---|---|---|
| `message` | generator (auto), `ctx.emit.message` | conversational | persistent |
| `reasoning` | generator (thinking models) | conversational | persistent |
| `tool_output` | generator, per tool call | conversational | persistent |
| `component` | `ctx.emit.component` | structural | persistent; **keyed: upsert**, one entry per `(requestId, key)`, `data` replaced not merged |
| `container` | sequencer/router with `container` config | structural | persistent |
| `source` | generator (provider-native tools) | structural | persistent |
| `status` | `ctx.emit.status`, `activeStatusMessage` | structural | **always transient** |
| `state_change` | state mutations | structural | transient in prod, persistent in dev (`persistStateChanges: true` forces) |
| `resource_change` | resource mutations | structural | transient by default |
| `error` | runtime, terminal failure | structural | persistent |
| `suspension` | `ctx.suspend()` | structural | persistent |
| `suspension_resume` | resume | structural | persistent; **not rendered**: audit record, read by `useSuspensions` |
| `continuation` | crash-recovery re-entry | structural | persistent; marks the seam between the prior log and the live re-run |
| `block_trace` | every block | trace | persistent |
| `router_decision` | router selection | trace | persistent |
| `state_snapshot` | sequencer step boundaries | trace | stripped from the items log; durable frames go to `stores.checkpoints` |
| `generator_step` | owned generator loop, per tool-calling step | trace | persistent, replay-only; never in `GET`/`useSession` |

### Contracts per type

- **`container`** opens an ownership scope: items emitted inside carry `ownedBy`. Lifecycle `item.added` (`in_progress`, `startedAt`) → `item.updated` (`completed`/`failed`, `completedAt`, `duration`, `error`) → `item.done`. `ItemsRenderer` suppresses owned `component` / `tool_output` items when the container has a registered renderer (it renders them via `useContainerItems`); `message`, `reasoning`, `status`, `error` always render in the main stream.
- **`state_change` / `resource_change`** share an `InvalidationItem` base (`scope`, `delta`, `version`) with distinct operation vocabularies and identity fields (`path` vs `resourcePath`). `version` is required on `state_change`, optional on `resource_change`; `resource_change` scope excludes `block_instance`. Both are **notifications, not state**. `state_change` is suppressed for no-op writes (structural equality) and for mutations touching only `transientSlot()` keys.
- **`tool_output`** is added `in_progress` *before* the called block runs, then patched. The called block keeps its own `block_trace`, whose `output` is a `ref` to the `tool_output`, so the result lives in one place. On failure both are `failed`.
- **`suspension`** carries `allow: ResumeAction[]` (`approve`/`reject`/`submit`/`skip`); the resume route refuses other actions with `409`, and renderers read it to choose controls. Apps derive resume state from the log (`suspension_resume`), **not** from `suspension.suspensionStatus`. Default renderer dispatch: `render.component` → `reason` → `resumeSchema` shape.
- **`generator_step`** is written *before* that step's tools dispatch, keyed by logical path + step number (accumulating). It holds the step's buffered pre-tool text and full tool-call array; step 0 also holds the compiled prelude. On resume the generator rebuilds its conversation from these plus `tool_output` items rather than re-calling the model. The owned loop never emits per-step assistant `message`s, so **this is the only durable record of a step's assistant turn**, which is also what makes a crash between "step returned" and "tools dispatched" recoverable. `collapseToCanonicalLog` keeps it across resumes, like the suspension pair.

### `block_trace`

One row per block execution: `item.added` (`in_progress`, input) → `item.updated` patches → `item.done`. Late subscribers see only the settled row.

- **Persistence must diff by content, not reference.** The row is one object mutated in place, so a reference diff never sees `in_progress → completed` and the persisted row stays `in_progress`, which breaks resume memoisation (`getCompletedOutput` only short-circuits a `completed` trace). The cross-store conformance suite enforces this on every adapter.
- `error` (on `block_trace`, `tool_output` and the terminal `error` item) is `{ message, code?, details? }`. The runtime fills `details` for: output-validation failures (`rawOutput`, `issues`, `phase`), any `cause` chain (serialised so a buried `ECONNRESET` survives), and the `fetch` tool (`errorType`, HTTP status, truncated body). Author `FlowError.details` passes through verbatim.
- `output` and `input.source` are a `BlockValue<T>`:
  - **`inline`**: novel content (leaves, `.map`, non-identity `connectOutput`).
  - **`ref`**: identical to another item's content, `sourceItemId` pointing at it. **Flatten-at-emit**: a ref always points one hop to a content-bearing item, never to another ref. Streaming-text generators ref their `message`; tool calls ref their `tool_output`.
  - **`structure`**: a novel container of existing content (`.parallel`, `.stepAll`, `.forEach`).
  
  This is why a pass-through pipeline `s1 → s2 → s3 → generator` persists the LLM text once. Read history through `resolveBlockValue(value, lookup)`; `ctx.getBlockOutput()` resolves transparently. Per-method kinds: [Blocks → Sequencer trace values](./blocks.md#sequencer-trace-values).

## Persistence

- **Persistent** items land on the request record. **Transient** ones are stripped before the record is written and never reappear on reload.
- A block's `transient: true` suppresses only its auto-emitted `block_trace`. Explicit emits use their own `transient` (defaults: `message`/`component` persisted, `status` live-only; per-call override).
- **`transient` and `key` are orthogonal:**

| `transient` | `key` | Meaning | Example |
|:-:|:-:|---|---|
| false | — | append-only event | finished message; `task-board-recorder-failure` (two failures must both survive, so no key) |
| false | ✓ | **keyed snapshot**: latest replays on reload | `task-change`, `task-board-meta`, `rb-entry` |
| true | — | ephemeral one-shot | debug trace |
| true | ✓ | live-only progress with dedup | spinner-style status |

  A keyed snapshot derives a deterministic item id from `key`, so the record holds one entry per `(requestId, key)` while the SSE log still appends every emission. `deduplicateComponentItems` is a no-op on the persisted path but still runs on event-log replay.
- **Two storage targets**: the item record (final state of durable items, for history) and the event log (every SSE event in order, for resume and devtool replay).
- Memory, filesystem and SQLite keep items inline as `data.items`; Postgres uses a `request_items` table with batched UPSERT ([README](../../packages/store-postgres/README.md#items-storage)) to avoid write amplification on long serverless requests. Same `RequestStore.persistItems` interface and `RequestRecord` shape everywhere.

### Streaming text is not replayable

`content.delta` (and `content.audio.delta`) never enter the event log; only `item.added`, `content.added`, `content.done`, `item.done` do. Deltas accumulate into the in-flight item, which is checkpointed via `persistItems` at the store's cadence. A mid-stream reconnect snaps to the latest snapshot rather than replaying tokens, and `item.done` supersedes it. Deliberate: per-token disk writes under concurrent streams serialise behind one per-request write queue and the request appears to hang. Full exclusion list: [Streaming](./streaming.md).

## Status slot

One request-scoped slot; the latest value wins and clears at request end. There is **no "clear on block complete"**: the next status overwrites, otherwise the last lingers, which avoids flicker between adjacent blocks.

- `activeStatusMessage` (any block kind) feeds the slot at block start.
- **Exception: generator tool dispatch.** The slot is snapshotted on the first tool entry of a round and restored when the last tool exits (to the generator's own `activeStatusMessage`, else cleared), so a finished tool's status can't linger as a stale "still running".
- `ctx.emit.status(message, { blocked?, sideChainTasks? })`: a string (including `""`, which clears) sets the message; `undefined` leaves it and updates only the signals; an unchanged value emits nothing.
- Multiple `emit.status` calls inside one handler usually mean it should be a sequencer (BP-011).

## Task attribution

`TaskHandle.items()` answers "what did this worker emit while holding its claim?". Attribution is by **execution scope stamped at emit time**: a worker scope marks its claimed task (`ctx._markTaskScope`) and every item it and its descendants emit gets `OutputItem.taskId`. Timestamp windows were abandoned because they can't separate concurrent producers.

- Each item belongs to **at most one** task. Re-claims (retry, resume after `parked`) run in fresh scopes under the same task id, so attempts union. Items outside any task scope carry no id.
- **Substrate components are excluded even though they carry a task id**: `task-change`, `task-board-meta`, `task-board-recorder-failure`. The test for a new type is **whose event it is**: if the substrate emitted it *about itself*, it goes on this list with a case in `packages/core/test/items/task-attribution.test.ts`. (A recorder failure is stamped with its task so readers know whose bookkeeping failed, but the worker may well have succeeded.)
- **And a renderer-registry entry.** A `component` is structural, so it reaches the client, and an unregistered component type renders as a `<pre>` of raw JSON. Each substrate component must be named in `chatAssistantRenderers` (`packages/ui/registry/components/chat-assistant.tsx`), with a renderer or `false`. Enforced by `packages/ui/test/substrate-components-never-raw.test.ts`. Apps with their own registry owe the same.
- One algorithm (`attributeItemsToTasks` / `itemsForTask` / `collectAttributedItemIds` in `@flow-state-dev/core/items`) backs both the substrate (`extractTaskItems`, also exported from `@flow-state-dev/orchestration/tasks`) and the UI, so they agree by construction.

## What doesn't belong in items

- Block lifecycle transitions: `block_trace.status` already tracks them.
- Per-block activity trees: status is one slot. For parallel visibility, group by `agentName`.
- Session metadata: on the session record, via `session.metadata.changed`.
- Resource state: `resource_change` notifies; the value lives in the store.
- LLM history: assembled on demand by filtering the log.
- Inter-block data: pass it through the sequencer output chain.

## Adding an item type

Try `component` with a registered renderer first. If a new type is genuinely needed:

1. Schema in `packages/contracts/src/items/types.ts`, added to `OutputItem`.
2. Visibility in `resolve-visibility.ts`: add to `TRACE_TYPES` or `CONVERSATIONAL_TYPES`; anything else falls to `STRUCTURAL_DEFAULT`.
3. A row in the registry above, every column filled.
4. Persistence (`transient: true` at emission for stream-only).
5. Client rendering: a fallback in `ItemRenderer.ts`, `NON_RENDERABLE_TYPES`, or a deliberate JSON fallback. Never implicit.
6. Devtool rendering if the generic view isn't enough.
7. The rationale in the PR: why can't an existing type do this?

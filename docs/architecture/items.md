# Items

Read this before touching anything that involves items, rendering, or the SSE stream.

## The basic idea

When a block executes, it produces **items**. Items flow to clients over SSE in real time, and the durable ones are persisted to the request record so sessions can reconstruct their history. Every piece of output you see in a chat UI — a message, a thinking block, a tool call card — is an item.

Every item has a `type` that determines what it is, a `status` that tracks its lifecycle (`in_progress` → `completed | incomplete | failed`), and `provenance` that records which block produced it.

## Visibility

Every item's visibility is derived from two things: its `type` and the optional `itemVisibility` field on the item. `resolveItemVisibility(item)` returns two booleans:

- **`client`** — whether the item is sent to connected clients (browser, mobile, CLI)
- **`history`** — whether the item is included in LLM conversation history

Visibility is a pure function of `(item.type, item.itemVisibility)`. The devtool always sees everything.

### Three type categories

Items fall into three visibility categories based on their `type`:

**Trace types** (`block_trace`, `router_decision`, `state_snapshot`, `generator_step`) always resolve to `{ client: false, history: false }` by their type alone. No stamp needed — the type is sufficient.

**Conversational types** (`message`, `reasoning`, `tool_output`) use `item.itemVisibility` if present, otherwise default to `{ client: true, history: true }`.

**Structural types** (everything else: `component`, `container`, `source`, `status`, `state_change`, `resource_change`, `error`, `suspension`, `suspension_resume`, `continuation`) default to `{ client: true, history: false }`.

### The `itemVisibility` field

Generators declare `itemVisibility` in their config. Conversational items emitted by that generator inherit the visibility setting:

| `itemVisibility` | Client | History |
|------------------|:------:|:-------:|
| `{ client: true, history: true }` | ✓ | ✓ |
| `{ client: true, history: false }` | ✓ | — |
| `{ client: false, history: false }` | — | — |
| `{ client: false, history: true }` | — | ✓ |
| *unset* | ✓ | ✓ (handler-emit fallback) |

The `{ client: true, history: false }` setting lets items reach the client for live observability while excluding them from conversation history. `{ client: false, history: false }` items are observability-only — devtool and `selectForContext` can see them, nothing else. The `{ client: false, history: true }` corner enables private/injected context that the LLM sees but the client does not.

See `generator-identity.md` for the full identity model.

### Structural types have fixed visibility

Structural items ignore `itemVisibility` for visibility resolution. `itemVisibility` on a structural item is metadata only (useful for per-agent rendering or queries via `selectForContext`).

## Item types

### External items — what the user sees

**`message`** is the primary content item. Generators emit these automatically; any block can call `ctx.emit.message()`. Messages enter LLM history so future model calls know what was said. This is the item type you'll work with most.

**`reasoning`** holds chain-of-thought output when a model produces thinking. Rendered as a collapsible block in the UI. Goes into LLM history.

**`component`** is a structured data item rendered by a registered UI component. Use it when `message` can't express the output — a plan visualization, a search results card, a form. See [Component items](#component-items) for details.

**`container`** is emitted by sequencers and routers that declare a `container` config. It marks the start of a visual grouping and establishes an ownership scope — items emitted during the container's execution carry an `ownedBy` reference back to it.

`container` follows a lifecycle: `item.added` with `status: "in_progress"` and `startedAt` set on scope entry, `item.updated` patching `status: "completed" | "failed"`, `completedAt`, `duration` (and `error` on failure) when the scope closes, and a final `item.done`. Public-stream consumers see a live in-flight signal for sequencer execution. This is the first public-channel item type to use the `item.updated` primitive.

**`source`** holds a URL reference from a provider-native tool like web search. Rendered alongside the message that produced it.

**`status`** is a transient progress update — "Searching the web...", "Running analysis...". Streams to the client but is never persisted. Backed by a request-scoped single slot: the latest `emit.status` value wins, and the UI renders it as a single in-flight indicator (falling back to "Thinking..." when the slot is empty). Emit declaratively via `activeStatusMessage` on any block config, or imperatively via `ctx.emit.status()` — see [Status slot semantics](#status-slot-semantics).

**`state_change`** records that a state mutation happened. In production it's transient; the client uses it to know something changed so it can update its view. In development it's persisted to support the devtool state timeline. The framework suppresses emission when the proposed write is structurally equal to the current state (no-op guard) and when the mutation only touches keys marked `transientSlot()` on a sequencer's `stateSchema`.

**`resource_change`** records that a resource was created, updated, or deleted. A notification — the real state lives in the resource store. Transient by default.

`state_change` and `resource_change` share an `InvalidationItem` base (`scope`/`delta`/`version`); the leaves keep distinct operation vocabularies and identity fields (`path` vs `resourcePath`). `version` is required on `state_change`, optional on `resource_change`, and `resource_change` scope excludes `block_instance`.

**`error`** is the terminal error item emitted when a request fails unrecoverably. Persisted so session history shows what went wrong.

**`tool_output`** is emitted when a generator invokes a block as a tool. Carries the tool name, input arguments, and result. Goes into LLM history as the tool result so the model can continue reasoning. Also visible in the chat UI for tool call rendering.

`tool_output` follows a lifecycle: the runtime emits an `in_progress` placeholder via `item.added` before the called block runs (args known, output empty), then patches it via `item.updated` once the block returns. The called block still gets its own `block_trace` row, decoupled from the `tool_output`, but its `output` is a `ref` to the `tool_output` so the result lives in one place. On failure, the patch sets `status: "failed"` and an `error` field; the called block's `block_trace.status` is also `failed`.

### Devtool-only items — what the devtool sees

**`block_trace`** is emitted for every block execution. The same row is added at block start, patched in place as more becomes known, and finalized when the block returns. It carries the block name, kind, input source, output, timing, model usage (for generators), and on failure the error. This is how the devtool builds its execution trace tree.

`block_trace.error` (and `tool_output.error`, and the terminal `error` item) is `{ message: string; code?: string; details?: Record<string, unknown> }`. The runtime auto-populates `details` for known cases:

- Generator output-validation failures attach `rawOutput` (the raw text the model returned), `issues` (the Zod issues), and `phase` (`"stream"` | `"final"`).
- Any thrown error with a `cause` has that chain serialized into `cause` (a plain `{ name, message, code?, cause? }` object), so an intermediate failure — a buried `ECONNRESET`, for example — is never swallowed at the item boundary.
- The `fetch` tool attaches `errorType` (`"http"` | `"network"` | `"timeout"` | `"abort"` | `"parse"` | `"unknown"`), and for HTTP failures `httpStatus`, `httpStatusText`, and a truncated `responseBody`.

Author-thrown `FlowError.details` flows through verbatim, and authors may attach arbitrary additional keys. The devtool renders `details` via a generic JSON view, with dedicated panels for the well-known keys.

Lifecycle: `item.added` (status `in_progress`, input filled in, output empty) → zero or more `item.updated` patches (connector input, generator bundle, model usage) → `item.done` (terminal status, output written, timing closed). Consumers reconcile by id. Late subscribers see only the final settled row.

Because that row is mutated in place — one object reference, fields changed between phases — a store's incremental item persistence MUST diff by item **content**, not object reference. A reference-identity diff never observes the `in_progress → completed` field change and leaves the persisted row at `in_progress`, which defeats resume memoization (`getCompletedOutput` short-circuits a block only when its persisted trace is `completed`). "Last-write-wins per item id" is therefore by content. The cross-store conformance suite enforces this on every adapter (FIX-839).

`block_trace.output` is a `BlockValue<T>` discriminated union with three cases:

- **`inline`** — the block produced novel content. Leaves (generators, handlers) and explicit transforms (`.map`, non-identity `connectOutput`) emit this kind. The payload rides on `output.value`.
- **`ref`** — the block's output is reference-identical to another item's content. Pass-through composers (`.step`, `.work`, `.tap`, routers, `.rescue`) emit this kind, with `output.sourceItemId` pointing at the content-bearing item. The invariant is **flatten-at-emit**: every ref points one hop to a content-bearing item, never to another ref. Streaming-text generators (`outputSchema: z.string()`, `itemVisibility` set) emit a `ref` pointing at their just-emitted `MessageItem` instead of inlining a duplicate copy of the streamed text. Tool-call paths emit a `ref` pointing at the produced `tool_output` item. `resolveBlockValue` resolves message-targeting refs to the joined `output_text` content.
- **`structure`** — the block produced a novel container of existing content. Aggregators (`.stepAll`, `.parallel`, `.forEach`) emit this kind, with `output.shape` describing the array or object of nested BlockValues.

`block_trace.input.source` is a `BlockValue<T>` of the same shape, stamped at block start. Sequential steps stamp a `ref` to the upstream block's trace; aggregator branches share the same upstream ref; downstream consumers of an aggregator see a `structure` of branch refs; `forEach` per-iteration children see `inline` with the element value; the request entry point sees `inline` with the raw input.

The union exists so a deeply nested pass-through pipeline (`s1 → s2 → s3 → generator`) persists the LLM output exactly once, on the generator's item — intermediate sequencers carry a ~40-byte ref rather than an N-byte copy. Tool calls extend the same idea: the called block and the `tool_output` item are decoupled, but the called block's `block_trace.output` refs the `tool_output` so the result lives in one place.

Consumers reading historical items should use `resolveBlockValue(item.output, lookup)` from `@flow-state-dev/core/items` to recover the typed payload `T`. `ctx.getBlockOutput()` and `TargetHandle` resolve transparently.

**`router_decision`** records which branch a router selected.

**`state_snapshot`** captures the full sequencer state at each step boundary. Carries `key: blockInstanceId` so consumers treat new emissions for the same key as in-place updates (one logical item per sequencer that updates N times, not N items per sequencer per turn). When `durable: true` (the sequencer default; see FIX-401), the runtime side-channels these into `stores.checkpoints` for resume by the future durable execution runtime (FIX-141). Items themselves still stay out of the request items log.

**`generator_step`** is a replay-only record of one step of a generator's framework-owned tool loop. The loop writes one per tool-calling step, *before* it dispatches that step's tools, keyed by the generator's logical path + step number (accumulating — never overwritten). It carries the step's buffered pre-tool assistant text and the full framework tool-call array (ids/names/aliases/args); the step-0 artifact additionally carries the compiled prelude (the assembled system/user/history messages). It exists purely so a suspended generator can resume: on continuation the generator rebuilds its conversation from these artifacts plus the persistent `tool_output` items, rather than re-calling the model for recorded steps (FIX-814). Because the loop buffers per-step text in memory and never emits a per-step assistant `message`, this artifact is the only durable record of a step's assistant turn — which is also what makes a crash between "model step returned" and "tool dispatched" recoverable. It is never client- or history-visible and never surfaces via `GET`/`useSession`; `collapseToCanonicalLog` retains it across resume cycles like the `suspension`/`suspension_resume` audit pair.

## Persistence

Items fall into three buckets:

**Persistent** — stored in the request record. Survive page refreshes. Form the session's durable history. Most items are persistent. Keyed `component` items (`emit.component(..., { key })`) are a special case: persisted with **upsert** semantics — one entry per `(requestId, key)`, latest snapshot wins, `data` replaced not merged. See the matrix below and [Emitting Items — Keyed snapshots](../../apps/docs/docs/streaming/emitting-items.md#keyed-snapshots).

**Transient** — stream-only. The client sees them during execution via SSE, but they're stripped before the request record is written. When someone reconnects or opens a past session, these items don't appear. `status` is always transient. `resource_change` and `state_snapshot` are transient by default.

**Conditionally persistent** — `state_change` items are transient in production and persistent in development. Use `persistStateChanges: true` on the flow config to force persistence in production (needed for the devtool state timeline).

When a block is marked `transient: true`, the framework's auto-emitted bookkeeping for that block (`block_trace` traces) is suppressed. Items the block emits explicitly (via `emit.message`, `emit.component`, `emit.status`) are **not** affected by the block flag — their persistence is controlled by their own `transient` field, with sensible per-emitter defaults: `false` for `emit.message` and `emit.component` (persisted), `true` for `emit.status` (live-only). Each emitter accepts a per-call `transient?: boolean` override.

### Transient × keyed item matrix

The `transient` and `key` fields compose orthogonally — knowing one tells you nothing about the other.

| `transient` | `key` | Semantics | Example |
|:-----------:|:-----:|-----------|---------|
| `false` | absent | Append-only event | A finalized message; a completed tool output |
| `false` | present | **Keyed snapshot** — replays on reload | `task-change`, `task-board-meta`, `rb-entry` |
| `true` | absent | Ephemeral one-shot | A debug trace |
| `true` | present | Live-only progress with dedup | A spinner-style "currently doing X" |

The `(transient: false, key: present)` cell is the **keyed snapshot** pattern: one logical entity whose latest state replays on reload. The framework derives a deterministic item ID from `key` so emissions upsert in place — the persisted record holds one entry per `(requestId, key)`, and the SSE event log still appends `item.added` + `item.done` per emission for live consumers. The renderer's `deduplicateComponentItems` is a no-op on the pre-collapsed persisted-record path but still runs on the event-log replay path. See [Emitting Items — Keyed snapshots](../../apps/docs/docs/streaming/emitting-items.md#keyed-snapshots) for the user-facing reference.

There are two storage targets, kept separate:
- **Item record** — the final state of each durable item, used to reconstruct session history
- **Event log** — every SSE event in order, including transient items and intermediate states, used for SSE resume and devtool replay

### Storage by adapter

The item record's physical layout varies per adapter:

- **Memory, filesystem, SQLite** — items live inline in the request record as `data.items`.
- **Postgres** — items live in a dedicated `request_items` table, one row per item, written via batched UPSERT (see [`@flow-state-dev/store-postgres` README](../../packages/store-postgres/README.md#items-storage)). The same `RequestStore.persistItems` interface is used everywhere; the diff and per-row write happen inside the adapter. The framework code does not care.

The Postgres shape sidesteps a write-amplification pathology that affected long-running requests on serverless deployments. The semantics are identical from the framework's perspective — `get(requestId)` returns the same `RequestRecord` shape regardless of adapter.

### Streaming-text contract (FIX-479)

`content.delta` events are non-replayable. The events log only carries the durable boundaries — `item.added`, `content.added`, `content.done`, `item.done`. The running text accumulates into the in-flight `MessageItem.content[i].text` (and `ReasoningItem.summary[i].text`) on each delta and the items snapshot is checkpointed via `persistItems` at the store's natural cadence.

This means streaming text fits the same "transient × keyed" cell that other live-only updates occupy: the wire and live observers see every delta; the durable surface is the latest accumulated snapshot keyed by item id. Mid-stream reconnects via `Last-Event-ID` snap forward to the latest snapshot rather than replaying token-by-token; the eventual `item.done` payload supersedes with the authoritative final text. The trade-off is intentional — token-by-token disk persistence under concurrent worker streams serializes every delta behind a single per-request write queue and the request appears to lock up.

Streaming TTS audio (FIX-523, `content.audio.delta`) follows the same rule for the same reasons — see [streaming.md](./streaming.md) for the full exclusion list. The durable representation is the eventual `OutputAudioContent` snapshot; chunks are live transport only.

## Item windows (per task)

Pattern aggregators (synthesizer prompt builders, reviewer input builders, replanners) often want a slice of the item log: "what did worker X emit while it held its claim?". Since FIX-480, that's first-class via `TaskHandle.items()` on the `TaskCollectionRef.list / get` returns.

Attribution is by **execution scope** — which worker/turn produced the item — captured at emit time, not by a timestamp range. A worker scope marks itself with the task it claimed (`ctx._markTaskScope`), and every item that scope and its descendants emit is stamped with that task id (`OutputItem.taskId`) as it is produced. The earlier timestamp-window approach could not separate concurrent producers — while a worker was still looping, its window stayed open, so a sibling worker that ran inside that interval was wrongly absorbed into it. Stamping the origin at emit time removes the ambiguity.

The attribution guarantee: each item belongs to **at most one** task. Concurrent sibling workers and sequential turns of one worker are separated by execution scope, not by time, so neither overlaps the other. A re-claim — a retry, or resuming after `awaiting_review` — runs in a fresh scope but marks the same task id, so all attempts union under that task. Synthesizers iterating completed tasks never see an item twice. Items emitted outside any task scope (seed-time events, board scaffolding) carry no task id and are excluded. Bookend `task-change` and `task-board-meta` items are excluded too — they drive status grouping / mount the board, they aren't worker emissions.

One shared algorithm in `@flow-state-dev/core/items` (`attributeItemsToTasks` / `itemsForTask` / `collectAttributedItemIds`) backs both the substrate (`extractTaskItems` → `task.items()`) and the UI (`<TaskPlan />` per-task expansion and the chat-thread renderer's dedup), so the two agree by construction. The standalone substrate utility — `extractTaskItems(items, collectionId, taskId)` — is exported from `@flow-state-dev/tasks` for any consumer that wants the same attribution without going through a `TaskCollection`.

## The full registry

| Type | Emitted by | Client | History | Visibility category | Persistence |
|------|------------|:------:|:-------:|:-------------------:|-------------|
| `message` | Generator (auto), `ctx.emit.message()` | itemVisibility | itemVisibility | Conversational | Persistent |
| `reasoning` | Generator (auto, CoT models) | itemVisibility | itemVisibility | Conversational | Persistent |
| `tool_output` | Generator (per tool invocation) | itemVisibility | itemVisibility | Conversational | Persistent |
| `component` | `ctx.emit.component()` | ✓ | — | Structural | Persistent (keyed: upsert in place — one entry per `(requestId, key)`) |
| `container` | Sequencer/Router with `container` config | ✓ | — | Structural | Persistent |
| `source` | Generator (provider-native tools) | ✓ | — | Structural | Persistent |
| `status` | `ctx.emit.status()` | ✓ | — | Structural | **Always transient** |
| `state_change` | Auto on state mutations | ✓ | — | Structural | Transient in prod / persistent in dev |
| `resource_change` | Auto on resource mutations | ✓ | — | Structural | Transient by default |
| `error` | Runtime (terminal failure) | ✓ | — | Structural | Persistent |
| `suspension` | `ctx.suspend()` (durable actions, on suspend) | ✓ | — | Structural | Persistent |
| `suspension_resume` | Resume (durable actions, on continuation) | ✓ | — | Structural | Persistent. Not rendered client-side — apps render their resume UI off the `suspension` item, not this one. |
| `continuation` | Runtime (auto, on crash-recovery re-entry) | ✓ | — | Structural | Persistent. Not a HITL item — marks the seam between the prior durable log and the live re-run, for the DevTool and audit trail. |
| `block_trace` | Every block (auto, lifecycle: in_progress → updates → terminal) | — | — | Trace | Persistent |
| `router_decision` | Router (auto, on selection) | — | — | Trace | Persistent |
| `state_snapshot` | Sequencer (at step boundaries) | — | — | Trace | Stripped from request items log; durable frames side-channel to `stores.checkpoints` |
| `generator_step` | Generator owned loop (once per tool-calling step, before dispatch) | — | — | Trace | Persistent (replay-only; retained across resume collapse; never in `GET`/`useSession`) |

**Column meanings:** `Client` = sent to connected clients; `History` = included in LLM conversation history. `Visibility category` = how `resolveItemVisibility(item)` determines visibility. Conversational types use `item.itemVisibility` (default `{ client: true, history: true }`). Structural types have fixed per-type defaults. Trace types always resolve to `{ client: false, history: false }`.

### Suspension item rendering

`suspension` items are consumer-renderable. The `suspension` item carries an `allow: ResumeAction[]` field (`"approve" | "reject" | "submit" | "skip"`) recording which resolutions the gate permits — the resume route gates inbound actions against it (`409` otherwise), and renderers read it to decide which controls to show (e.g. a Skip button appears iff `"skip"` is present). `resolution` on the `suspension_resume` item, and the resolved status more broadly, now includes `submitted` and `skipped` alongside `approved` / `rejected` / `timed_out` / `expired`.

`ItemRenderer` dispatches `type === "suspension"` items to a built-in default by `render.component` hint → `reason` → `resumeSchema` shape: a registered `render.component` wins; otherwise `human_approval` → `ApprovalRenderer` (Approve / Reject), and `human_input` → a free-text question, an enum selection, or a flat-object form depending on the schema. Register a custom component under the `suspension` slot of `RendererRegistry` to replace the default entirely, or set `suspension: false` to suppress it (headless layouts use `useSuspensions` and render the resolution UI in a modal or sidebar instead).

`suspension_resume` items are not rendered. They carry the audit record of a resolved suspension and are used by `useSuspensions` to flip a suspension from `pending` to resolved. Apps derive resume state from the item log, not from the `suspension` item's `suspensionStatus` field.

See [Suspensions and approvals](/docs/client/react#suspensions-and-approvals) for the React surface.

## Status slot semantics

Status is a request-scoped single slot. The latest `emit.status` value wins; the UI renders one line — whichever message was most recently emitted. When the request terminates, the slot clears and the indicator disappears.

### Declarative: `activeStatusMessage`

Every block config (handler, generator, sequencer, router) accepts an `activeStatusMessage` field. It's resolved at block start and fed into `emit.status` automatically.

```ts
handler({
  name: "ingest-documents",
  activeStatusMessage: "Ingesting documents...",
  execute: async (input, ctx) => { /* ... */ },
});

generator({
  name: "analyze",
  activeStatusMessage: (input) => `Analyzing ${input.items.length} items...`,
  model: "openai/gpt-5",
  prompt: "...",
});
```

There's no corresponding "on complete clear." The next block that sets a status overwrites the previous one; otherwise the last message lingers until the request ends. This matches the "treat status as a global value" intent and avoids flicker back to "Working..." between adjacent blocks.

**Generator/tool exception.** A generator's tool-call dispatch is the one place that does scope status to the inner block's lifetime. When the generator's AI-SDK loop invokes a tool, the slot is snapshotted on the first tool entry of a round and restored when the last tool exits. Tools compete on the slot while they run — the latest emit wins as elsewhere — but a finished tool's `activeStatusMessage` cannot linger past its own execution as a stale "still running" indicator. If the generator itself had set `activeStatusMessage`, that value is what gets restored; otherwise the slot clears and the indicator falls back to "Working...".

Prefer `activeStatusMessage` when a block has one meaningful status for its whole execution. Reserve `ctx.emit.status()` for blocks that genuinely need to update status mid-execution (e.g. per-file upload progress). Don't wrap multi-phase logic in a single handler with multiple `emit.status` calls — that's a symptom of a handler that should be a sequencer of distinct blocks (BP-011).

### Imperative: `ctx.emit.status(message, options?)`

```ts
ctx.emit.status(
  message: string | undefined,
  options?: { blocked?: boolean; backgroundTasks?: number }
): void
```

**Message update rules:**

- A string (including `""`) sets the slot. `""` explicitly clears the message; the UI falls back to "Thinking...".
- `undefined` does not touch the message. Use this when updating only `blocked` / `backgroundTasks` signals.
- If `message` equals the current slot value, the emit is skipped (no item, no SSE event).

`blocked` and `backgroundTasks` are flow-control signals — orthogonal to the human-readable message. `emit.status(undefined, { blocked: false, backgroundTasks: 0 })` is the canonical way to update signals without changing the visible text.

## Component items

Component items are more complex than other types because they support streaming updates and a container ownership model.

### Emitting a component item

```ts
// Emit initial state
ctx.emit.component("plan-view", { steps: [], status: "working" }, { key: "plan" });

// Update by emitting with the same key — replaces the previous version:
ctx.emit.component("plan-view", { steps: ["Step 1 done"], status: "working" }, { key: "plan" });
ctx.emit.component("plan-view", { steps: ["Step 1 done", "Step 2 done"], status: "complete" }, { key: "plan" });
```

Each `emit.component()` call with the same `key` replaces the previous version in the client UI. Live clients see every update via SSE events. All versions are persisted, but the client renders only the latest for each key.

If you need each step to be a distinct persisted item (e.g. a plan where each step is independently addressable), emit them as separate items with different `key` values.

### Stable key for deduplication

```ts
ctx.emit.component("search-results", { results }, { key: "search" });
```

When `key` is set, `ItemsRenderer` shows only the latest item with that key per request. Use this when the component represents a stateful view you want to replace in-place — for example, incrementally updating search results rather than appending a new card for each update.

When combined with `transient: false` (the default), this is the **keyed snapshot** pattern: one logical entity whose latest state replays on reload. See [Persistence](#persistence) above for the full transient × key matrix and [Emitting Items — Keyed snapshots](../../apps/docs/docs/streaming/emitting-items.md#keyed-snapshots) for the user-facing reference.

### Registering a renderer

```tsx
<FlowProvider renderers={{ component: { "plan-view": PlanView } }}>
```

`PlanView` receives `{ item: ComponentItem }`. Access the data via `item.data`.

### Container components

When a sequencer or router declares `container: { component: "my-container" }`, it emits a `ContainerItem` at execution start. Items emitted inside the container scope carry `ownedBy: containerBlockInstanceId`.

`ItemsRenderer` suppresses `component` and `tool_output` items owned by a container with a registered renderer — the container renderer is responsible for displaying them. Use `useContainerItems` to access them:

```ts
const { state, items, componentsByKey } = useContainerItems(containerItem, session);
// state — latest ComponentItem data for the container's own component key
// items — all items owned by this container, chronologically sorted
// componentsByKey — latest data per unique key across owned component items
```

Primary output types (`message`, `reasoning`, `status`, `error`) always render in the main stream even when owned by a container.

### Component vs native types

Use `component` when the output needs custom UI that native types can't express. For everything else, use the native type:

- Conversational text → `message`
- Progress during a long operation → `status`
- Search citations → `source`
- Errors → `error`

Using `component` for things native types cover bypasses built-in history assembly and adds renderer maintenance overhead.

## What doesn't belong in items

**Block execution status** — the `status` field on `block_trace` already tracks `in_progress → completed/failed`. Don't emit a separate item type for each lifecycle transition.

**Per-block activity trees** — there is no per-block status hierarchy or activity graph. Status is a single request-scoped slot ("what is happening right now"). If you need per-agent live visibility of parallel work, group items by `agentName` and render that — don't invent a tree on top of status.

**Session metadata** — title, description, and tags live on the session record. They flow via `session.metadata.changed` SSE events, not items.

**Resource state** — `resource_change` is a notification that something changed, not the new state. The actual resource value lives in the resource store.

**LLM conversation history** — history is assembled on-demand by filtering the item log for LLM audience types. It's not stored separately and doesn't need its own item type.

**Internal computation artifacts** — if a block computes something that another block needs, pass it through the sequencer output chain. Items are for output the browser or devtool needs to see, not for inter-block data routing.

## Adding a new item type

Most new UI needs can be expressed via `component` items with a registered renderer. Before adding a new type, confirm that won't work.

If a new type is genuinely needed:

1. **Define the schema** in `packages/core/src/items/types.ts` and add it to the `OutputItem` union.
2. **Decide visibility** — which category? In `packages/core/src/items/resolve-visibility.ts`: if trace, add it to `TRACE_TYPES` (always `{ client: false, history: false }`); if conversational, add it to `CONVERSATIONAL_TYPES` so `item.itemVisibility` governs visibility. Structural types need no edit — anything not in `TRACE_TYPES` or `CONVERSATIONAL_TYPES` falls through to `STRUCTURAL_DEFAULT` (`{ client: true, history: false }`).
3. **Add a registry row** to the table in this document — all columns required.
4. **Set persistence** — `transient: true` at emission for stream-only items.
5. **Define kitchen sink rendering** — register a built-in fallback in `ItemRenderer.ts`, add to `NON_RENDERABLE_TYPES`, or accept the JSON dev fallback. Don't leave it implicit.
6. **Define devtool rendering** — generic types fall through to the stream view; add a dedicated renderer if the type needs special treatment.
7. **Write the rationale** in the PR — why can't an existing type do this?

## Base schema reference

```ts
type ItemVisibility = { client: boolean; history: boolean };

type OutputItemBase = {
  id: string;
  type: string;
  status: "in_progress" | "completed" | "incomplete" | "failed";
  transient?: boolean;    // true = stream-only, never persisted
  requestId: string;
  itemIndex: number;      // Monotonic within the request
  provenance: ItemProvenance;
  ts: number;             // Epoch ms
  ownedBy?: string;       // blockInstanceId of the enclosing container, if any
  itemVisibility?: ItemVisibility;  // Governs visibility for conversational types
  agentName?: string;     // Stable name of the producing agent (defaults to block name)
};

type ItemProvenance = {
  blockName: string;
  blockDefinitionId?: string;
  blockInstanceId: string;
  parentBlockInstanceId?: string;
  phase: "main" | "work"; // work = inside a sequencer work queue
  stepIndex?: number;
  workGroupId?: string;
  attempt?: number;
};
```

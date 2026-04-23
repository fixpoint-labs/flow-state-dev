# Items

Read this before touching anything that involves items, rendering, or the SSE stream.

## The basic idea

When a block executes, it produces **items**. Items flow to clients over SSE in real time, and the durable ones are persisted to the request record so sessions can reconstruct their history. Every piece of output you see in a chat UI — a message, a thinking block, a tool call card — is an item.

Every item has a `type` that determines what it is, a `status` that tracks its lifecycle (`in_progress` → `completed | incomplete | failed`), and `provenance` that records which block produced it.

## Visibility

Every item's visibility is derived from two things: its `type` and the optional `agentType` identity of the generator that produced it. `resolveItemVisibility()` returns two booleans:

- **`client`** — whether the item is sent to connected clients (browser, mobile, CLI)
- **`history`** — whether the item is included in LLM conversation history

There are no per-item `client`/`history` overrides. Visibility is a pure function of `(type, agentType)`. The devtool always sees everything.

### Generator identity governs conversational items

Messages, reasoning, and `block_tool_output` items — the conversational types — inherit visibility from the producing generator's `agentType`:

| `agentType` | Client | History |
|-------------|:------:|:-------:|
| `"primary"` | ✓ | ✓ |
| `"sub"`     | ✓ | — |
| `"trace"`   | — | — |
| *unset*     | ✓ | ✓ (handler-emit fallback) |

`sub` items reach the client for live observability but are excluded from conversation history. `trace` items are observability-only — devtool and `selectForContext` can see them, nothing else.

See `generator-identity.md` for the full identity model.

### Structural types have fixed visibility

Component, container, source, status, state_change, resource_change, error, step_error → `{ client: true, history: false }`. Block_output, router_decision, state_snapshot, block_debug → `{ client: false, history: false }` (devtool-only).

Structural items ignore `agentType` for visibility. `agentType` on a structural item is metadata only (useful for per-agent rendering or queries via `selectForContext`).

## Item types

### External items — what the user sees

**`message`** is the primary content item. Generators emit these automatically; any block can call `ctx.emitMessage()`. Messages enter LLM history so future model calls know what was said. This is the item type you'll work with most.

**`reasoning`** holds chain-of-thought output when a model produces thinking. Rendered as a collapsible block in the UI. Goes into LLM history.

**`component`** is a structured data item rendered by a registered UI component. Use it when `message` can't express the output — a plan visualization, a search results card, a form. See [Component items](#component-items) for details.

**`container`** is emitted by sequencers and routers that declare a `container` config. It marks the start of a visual grouping and establishes an ownership scope — items emitted during the container's execution carry an `ownedBy` reference back to it.

**`source`** holds a URL reference from a provider-native tool like web search. Rendered alongside the message that produced it.

**`status`** is a transient progress update — "Searching the web...", "Running analysis...". Streams to the client but is never persisted. Backed by a request-scoped single slot: the latest `emitStatus` value wins, and the UI renders it as a single in-flight indicator (falling back to "Thinking..." when the slot is empty). Emit declaratively via `activeStatusMessage` on any block config, or imperatively via `ctx.emitStatus()` — see [Status slot semantics](#status-slot-semantics).

**`state_change`** records that a state mutation happened. In production it's transient; the client uses it to know something changed so it can update its view. In development it's persisted to support the devtool state timeline.

**`resource_change`** records that a resource was created, updated, or deleted. A notification — the real state lives in the resource store. Transient by default.

**`error`** is the terminal error item emitted when a request fails unrecoverably. Persisted so session history shows what went wrong.

**`step_error`** is a block-level error within a sequencer — either handled by a rescue boundary (`recovered: true`) or not. Persisted so you can see what went wrong in session history.

**`block_tool_output`** is emitted when a generator invokes a block as a tool. Carries the tool name, input arguments, and result. Goes into LLM history as the tool result so the model can continue reasoning. Also visible in the chat UI for tool call rendering.

### Devtool-only items — what the devtool sees

**`block_output`** is emitted after every block finishes, automatically. It records the block name, kind, output, timing, and model usage. This is how the devtool builds its execution trace tree.

**`router_decision`** records which branch a router selected.

**`state_snapshot`** captures the full sequencer state at each step boundary. Transient — streams to the devtool during execution but isn't persisted.

## Persistence

Items fall into three buckets:

**Persistent** — stored in the request record. Survive page refreshes. Form the session's durable history. Most items are persistent.

**Transient** — stream-only. The client sees them during execution via SSE, but they're stripped before the request record is written. When someone reconnects or opens a past session, these items don't appear. `status` is always transient. `resource_change` and `state_snapshot` are transient by default.

**Conditionally persistent** — `state_change` items are transient in production and persistent in development. Use `persistStateChanges: true` on the flow config to force persistence in production (needed for the devtool state timeline).

When a block is configured with `transient: true`, all items it emits become transient regardless of their type. This is how you mark an entire block's output as stream-only.

There are two storage targets, kept separate:
- **Item record** — the final state of each durable item, used to reconstruct session history
- **Event log** — every SSE event in order, including transient items and intermediate states, used for SSE resume and devtool replay

## The full registry

| Type | Emitted by | Client | History | Identity-governed | Persistence |
|------|------------|:------:|:-------:|:-----------------:|-------------|
| `message` | Generator (auto), `ctx.emitMessage()` | agentType | agentType | ✓ | Persistent |
| `reasoning` | Generator (auto, CoT models) | agentType | agentType | ✓ | Persistent |
| `block_tool_output` | Generator (per tool invocation) | agentType | agentType | ✓ | Persistent |
| `component` | `ctx.emitComponent()` | ✓ | — | — | Persistent |
| `container` | Sequencer/Router with `container` config | ✓ | — | — | Persistent |
| `source` | Generator (provider-native tools) | ✓ | — | — | Persistent |
| `status` | `ctx.emitStatus()` | ✓ | — | — | **Always transient** |
| `state_change` | Auto on state mutations | ✓ | — | — | Transient in prod / persistent in dev |
| `resource_change` | Auto on resource mutations | ✓ | — | — | Transient by default |
| `error` | Runtime (terminal failure) | ✓ | — | — | Persistent |
| `step_error` | Sequencer (block error, with/without rescue) | ✓ | — | — | Persistent |
| `block_output` | Every block (auto, post-execution) | — | — | — | Persistent |
| `router_decision` | Router (auto, on selection) | — | — | — | Persistent |
| `state_snapshot` | Sequencer (at step boundaries) | — | — | — | **Always transient** |
| `block_debug` | Generator (resolved config at start) | — | — | — | Transient |

**Column meanings:** `Client` = sent to connected clients; `History` = included in LLM conversation history. `Identity-governed` = visibility derives from the producing generator's `agentType`. A `trace` agentType forces `client: false, history: false` regardless of type.

## Status slot semantics

Status is a request-scoped single slot. The latest `emitStatus` value wins; the UI renders one line — whichever message was most recently emitted. When the request terminates, the slot clears and the indicator disappears.

### Declarative: `activeStatusMessage`

Every block config (handler, generator, sequencer, router) accepts an `activeStatusMessage` field. It's resolved at block start and fed into `emitStatus` automatically.

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

There's no corresponding "on complete clear." The next block that sets a status overwrites the previous one; otherwise the last message lingers until the request ends. This matches the "treat status as a global value" intent and avoids flicker back to "Thinking..." between adjacent blocks.

Prefer `activeStatusMessage` when a block has one meaningful status for its whole execution. Reserve `ctx.emitStatus()` for blocks that genuinely need to update status mid-execution (e.g. per-file upload progress). Don't wrap multi-phase logic in a single handler with multiple `emitStatus` calls — that's a symptom of a handler that should be a sequencer of distinct blocks (BP-011).

### Imperative: `ctx.emitStatus(message, options?)`

```ts
ctx.emitStatus(
  message: string | undefined,
  options?: { blocked?: boolean; backgroundTasks?: number }
): void
```

**Message update rules:**

- A string (including `""`) sets the slot. `""` explicitly clears the message; the UI falls back to "Thinking...".
- `undefined` does not touch the message. Use this when updating only `blocked` / `backgroundTasks` signals.
- If `message` equals the current slot value, the emit is skipped (no item, no SSE event).

`blocked` and `backgroundTasks` are flow-control signals — orthogonal to the human-readable message. `emitStatus(undefined, { blocked: false, backgroundTasks: 0 })` is the canonical way to update signals without changing the visible text.

## Component items

Component items are more complex than other types because they support streaming updates and a container ownership model.

### Emitting a component item

```ts
// Emit initial state
ctx.emitComponent("plan-view", { steps: [], status: "working" }, { key: "plan" });

// Update by emitting with the same key — replaces the previous version:
ctx.emitComponent("plan-view", { steps: ["Step 1 done"], status: "working" }, { key: "plan" });
ctx.emitComponent("plan-view", { steps: ["Step 1 done", "Step 2 done"], status: "complete" }, { key: "plan" });
```

Each `emitComponent()` call with the same `key` replaces the previous version in the client UI. Live clients see every update via SSE events. All versions are persisted, but the client renders only the latest for each key.

If you need each step to be a distinct persisted item (e.g. a plan where each step is independently addressable), emit them as separate items with different `key` values.

### Stable key for deduplication

```ts
ctx.emitComponent("search-results", { results }, { key: "search" });
```

When `key` is set, `ItemsRenderer` shows only the latest item with that key per request. Use this when the component represents a stateful view you want to replace in-place — for example, incrementally updating search results rather than appending a new card for each update.

### Registering a renderer

```tsx
<FlowProvider renderers={{ component: { "plan-view": PlanView } }}>
```

`PlanView` receives `{ item: ComponentItem }`. Access the data via `item.data`.

### Container components

When a sequencer or router declares `container: { component: "my-container" }`, it emits a `ContainerItem` at execution start. Items emitted inside the container scope carry `ownedBy: containerBlockInstanceId`.

`ItemsRenderer` suppresses `component` and `block_tool_output` items owned by a container with a registered renderer — the container renderer is responsible for displaying them. Use `useContainerItems` to access them:

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
- Errors → `error` or `step_error`

Using `component` for things native types cover bypasses built-in history assembly and adds renderer maintenance overhead.

## What doesn't belong in items

**Block execution status** — the `status` field on `block_output` already tracks `in_progress → completed/failed`. Don't emit a separate item type for each lifecycle transition.

**Per-block activity trees** — there is no per-block status hierarchy or activity graph. Status is a single request-scoped slot ("what is happening right now"). If you need per-agent live visibility of parallel work, group items by `agentName` and render that — don't invent a tree on top of status.

**Session metadata** — title, description, and tags live on the session record. They flow via `session.metadata.changed` SSE events, not items.

**Resource state** — `resource_change` is a notification that something changed, not the new state. The actual resource value lives in the resource store.

**LLM conversation history** — history is assembled on-demand by filtering the item log for LLM audience types. It's not stored separately and doesn't need its own item type.

**Internal computation artifacts** — if a block computes something that another block needs, pass it through the sequencer output chain. Items are for output the browser or devtool needs to see, not for inter-block data routing.

## Adding a new item type

Most new UI needs can be expressed via `component` items with a registered renderer. Before adding a new type, confirm that won't work.

If a new type is genuinely needed:

1. **Define the schema** in `packages/core/src/items/types.ts` and add it to the `OutputItem` union.
2. **Decide visibility** — is it conversational (identity-governed) or structural? If structural, add it to `STRUCTURAL_TYPE_DEFAULTS` in `packages/core/src/items/resolve-visibility.ts` with fixed `client` / `history` values. If conversational, add it to `CONVERSATIONAL_TYPES` so `agentType` governs visibility.
3. **Add a registry row** to the table in this document — all columns required.
4. **Set persistence** — `transient: true` at emission for stream-only items.
5. **Define kitchen sink rendering** — register a built-in fallback in `ItemRenderer.ts`, add to `NON_RENDERABLE_TYPES`, or accept the JSON dev fallback. Don't leave it implicit.
6. **Define devtool rendering** — generic types fall through to the stream view; add a dedicated renderer if the type needs special treatment.
7. **Write the rationale** in the PR — why can't an existing type do this?

## Base schema reference

```ts
type AgentType = "primary" | "sub" | "trace";

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
  agentType?: AgentType;  // Governs visibility for conversational types
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

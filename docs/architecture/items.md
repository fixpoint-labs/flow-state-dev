# Items

Read this before touching anything that involves items, rendering, or the SSE stream.

## The basic idea

When a block executes, it produces **items**. Items flow to clients over SSE in real time, and the durable ones are persisted to the request record so sessions can reconstruct their history. Every piece of output you see in a chat UI — a message, a thinking block, a tool call card — is an item.

Every item has a `type` that determines what it is, a `status` that tracks its lifecycle (`in_progress` → `completed | incomplete | failed`), and `provenance` that records which block produced it.

## Item roles

Every item has a **role** that controls which consumers can see it. There are three roles:

**`external`** — the default. The browser renders it, the LLM sees it in history (for items that carry conversational content), the devtool sees it. Most items are external.

**`internal`** — hidden from the browser, but participates in LLM history. Use this for helper blocks that produce content the next model call should know about, but that the user shouldn't see. Think of it as the programmatic equivalent of a system message — invisible to the end user, meaningful to the model.

**`trace`** — visible only in the devtool. Neither the browser nor the LLM sees it. Use this for structural/observability items: execution timings, route decisions, state snapshots.

The hierarchy is `external ⊃ internal ⊃ trace`: external items have the broadest visibility, trace items the narrowest.

Role is resolved in this order when an item is emitted:
1. Explicit `itemRole` field on the emitted item
2. Legacy `trace: true` boolean (backward compatible — treated as `"trace"`)
3. Structural item types (`block_output`, `router_decision`, `sequencer_state_snapshot`) default to `"trace"`
4. Work-phase items (inside a sequencer work queue) default to `"trace"`
5. Everything else → `"external"`

You can set a block-level default on generators via `itemRole: "internal" | "trace"`. This stamps all items the block emits with that role, overridable per-item-type using the generator's `emit` config.

The devtool always sees everything, regardless of role. That's the point — it's the observability surface for what the browser and LLM don't see.

## Item types

### External items — what the user sees

**`message`** is the primary content item. Generators emit these automatically; any block can call `ctx.emitMessage()`. Messages enter LLM history so future model calls know what was said. This is the item type you'll work with most.

**`reasoning`** holds chain-of-thought output when a model produces thinking. Rendered as a collapsible block in the UI. Goes into LLM history.

**`component`** is a structured data item rendered by a registered UI component. Use it when `message` can't express the output — a plan visualization, a search results card, a form. See [Component items](#component-items) for details.

**`container`** is emitted by sequencers and routers that declare a `container` config. It marks the start of a visual grouping and establishes an ownership scope — items emitted during the container's execution carry an `ownedBy` reference back to it.

**`source`** holds a URL reference from a provider-native tool like web search. Rendered alongside the message that produced it.

**`status`** is a transient progress update — "Searching the web...", "Running analysis...". Streams to the client but is never persisted. Emit via `ctx.emitStatus()`.

**`state_change`** records that a state mutation happened. In production it's transient; the client uses it to know something changed so it can update its view. In development it's persisted to support the devtool state timeline.

**`resource_change`** records that a resource was created, updated, or deleted. A notification — the real state lives in the resource store. Transient by default.

**`error`** is the terminal error item emitted when a request fails unrecoverably. Always transient.

**`step_error`** is a block-level error within a sequencer — either handled by a rescue boundary (`recovered: true`) or not. Persisted so you can see what went wrong in session history.

**`block_tool_output`** is emitted when a generator invokes a block as a tool. Carries the tool name, input arguments, and result. Goes into LLM history as the tool result so the model can continue reasoning. Also visible in the chat UI for tool call rendering.

### Internal items — what the LLM sees but the user doesn't

**`context`** injects text into the LLM prompt without showing it to the user. Emit via `ctx.emitLLMContext()`. Useful for dynamic system prompts computed at runtime.

Any block can produce internal items by setting `itemRole: "internal"` on the generator config or by using the `emit` config to assign the role per item type. An internal `message`, for example, contributes to LLM conversation history across turns without ever appearing in the browser.

### Trace items — what the devtool sees

**`block_output`** is emitted after every block finishes, automatically. It records the block name, kind, output, timing, and model usage. This is how the devtool builds its execution trace tree.

**`router_decision`** records which branch a router selected.

**`sequencer_state_snapshot`** captures the full sequencer state at each step boundary. Transient — streams to the devtool during execution but isn't persisted.

## Persistence

Items fall into three buckets:

**Persistent** — stored in the request record. Survive page refreshes. Form the session's durable history. Most items are persistent.

**Transient** — stream-only. The client sees them during execution via SSE, but they're stripped before the request record is written. When someone reconnects or opens a past session, these items don't appear. `status` and `error` are always transient. `resource_change` and `sequencer_state_snapshot` are transient by default.

**Conditionally persistent** — `state_change` items are transient in production and persistent in development. Use `persistStateChanges: true` on the flow config to force persistence in production (needed for the devtool state timeline).

When a block is configured with `transient: true`, all items it emits become transient regardless of their type. This is how you mark an entire block's output as stream-only.

There are two storage targets, kept separate:
- **Item record** — the final state of each durable item, used to reconstruct session history
- **Event log** — every SSE event in order, including transient items and intermediate states, used for SSE resume and devtool replay

## The full registry

| Type | Emitted by | Role | LLM history | Persistence |
|------|------------|:----:|:-----------:|-------------|
| `message` | Generator (auto), `ctx.emitMessage()` | external | ✓ | Persistent |
| `reasoning` | Generator (auto, CoT models) | external | ✓ | Persistent |
| `component` | `ctx.emitComponent()` | external | — | Persistent |
| `container` | Sequencer/Router with `container` config | external | — | Persistent |
| `source` | Generator (provider-native tools) | external | — | Persistent |
| `status` | `ctx.emitStatus()` | external | — | **Always transient** |
| `state_change` | Auto on state mutations | external | — | Transient in prod / persistent in dev |
| `resource_change` | Auto on resource mutations | external | — | Transient by default |
| `error` | Runtime (terminal failure) | external | — | **Always transient** |
| `step_error` | Sequencer (block error, with/without rescue) | external | — | Persistent |
| `block_tool_output` | Generator (per tool invocation) | external | ✓ | Persistent |
| `context` | `ctx.emitLLMContext()` | internal | ✓ | Persistent |
| `block_output` | Every block (auto, post-execution) | trace | ¹ | Persistent |
| `router_decision` | Router (auto, on selection) | trace | — | Persistent |
| `sequencer_state_snapshot` | Sequencer (at step boundaries) | trace | — | **Always transient** |

¹ `block_output` enters LLM history only when it has a `toolCall` field (legacy generator tool path). New code uses `block_tool_output`.

**Role meanings:** `external` = browser + LLM history; `internal` = LLM history only, hidden from browser; `trace` = devtool only.

## Component items

Component items are more complex than other types because they support streaming updates and a container ownership model.

### Emitting a component item

```ts
const handle = ctx.emitComponent("plan-view", { steps: [], status: "working" });

// Update data in-place as work progresses:
handle.update({ steps: ["Step 1 done"], status: "working" });
handle.update({ steps: ["Step 1 done", "Step 2 done"], status: "complete" });

handle.done();
```

`update()` mutates the item's data in-place. Live clients see every intermediate state via SSE events on the same item ID. The persisted record holds only the final state — there's no history of intermediate updates stored.

If you need each step to be a distinct persisted item (e.g. a plan where each step is independently addressable), emit them as separate items with different `key` values rather than updates to a single item.

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

**Block activity indicators** — `ctx.setStatus()` for live activity trees is a forthcoming feature (FIX-387). The design isn't settled. Don't speculate by emitting custom items for this.

**Session metadata** — title, description, and tags live on the session record. They flow via `session.metadata.changed` SSE events, not items.

**Resource state** — `resource_change` is a notification that something changed, not the new state. The actual resource value lives in the resource store.

**LLM conversation history** — history is assembled on-demand by filtering the item log for LLM audience types. It's not stored separately and doesn't need its own item type.

**Internal computation artifacts** — if a block computes something that another block needs, pass it through the sequencer output chain. Items are for output the browser or devtool needs to see, not for inter-block data routing.

## Adding a new item type

Most new UI needs can be expressed via `component` items with a registered renderer. Before adding a new type, confirm that won't work.

If a new type is genuinely needed:

1. **Define the schema** in `packages/core/src/items/types.ts` and add it to the `OutputItem` union.
2. **Add a registry row** to the table in this document — all columns required.
3. **Assign a role** — decide if the type is `external` (browser + LLM history), `internal` (LLM history only, not browser), or `trace` (devtool only). Update audience routing in `createExecutionContext.ts` and `CLIENT_ITEM_TYPES` in `useSession.ts` as needed.
4. **Set persistence** — `transient: true` at emission for stream-only items.
5. **Define kitchen sink rendering** — register a built-in fallback in `ItemRenderer.ts`, add to `NON_RENDERABLE_TYPES`, or accept the JSON dev fallback. Don't leave it implicit.
6. **Define devtool rendering** — generic types fall through to the stream view; add a dedicated renderer if the type needs special treatment.
7. **Write the rationale** in the PR — why can't an existing type do this?

## Base schema reference

```ts
type ItemRole = "external" | "internal" | "trace";

type OutputItemBase = {
  id: string;
  type: string;
  status: "in_progress" | "completed" | "incomplete" | "failed";
  itemRole?: ItemRole;    // Visibility tier. Resolved via resolveItemRole() if absent.
  transient?: boolean;    // true = stream-only, never persisted
  trace?: boolean;        // Legacy — treated as itemRole: "trace". Prefer itemRole.
  requestId: string;
  itemIndex: number;      // Monotonic within the request
  provenance: ItemProvenance;
  ts: number;             // Epoch ms
  ownedBy?: string;       // blockInstanceId of the enclosing container, if any
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

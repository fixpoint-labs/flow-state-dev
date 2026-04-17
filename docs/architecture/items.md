# Item System

Read this before implementing anything that touches items, rendering, or the stream. The item system is the connective tissue between execution and the client — getting it wrong causes rendering bugs, history corruption, and silent data loss.

## 1. What is an item?

An item is the canonical output of a block execution. Items flow over SSE during execution and are persisted to the request record after it completes. The client reconstructs session state from the persisted item log.

Every item extends `OutputItemBase`:

```ts
type OutputItemBase = {
  id: string;
  type: string;            // Discriminant — identifies the item kind
  status: ItemStatus;      // "in_progress" | "completed" | "incomplete" | "failed"
  transient?: boolean;     // When true: stream-only, never persisted
  trace?: boolean;         // When true: lifecycle/observability metadata, excluded from LLM context
  requestId: string;
  itemIndex: number;       // Monotonic within the request — determines ordering
  provenance: ItemProvenance;
  ts: number;              // Emission timestamp (epoch ms)
  ownedBy?: string;        // blockInstanceId of the enclosing container, if any
};
```

`ItemProvenance` carries full execution context:

```ts
type ItemProvenance = {
  blockName: string;
  blockDefinitionId?: string;
  blockInstanceId: string;
  parentBlockInstanceId?: string;
  phase: "main" | "work";  // work = inside a sequencer work queue
  stepIndex?: number;
  workGroupId?: string;
  attempt?: number;
};
```

Status lifecycle is one-way: `in_progress → completed | incomplete | failed`. Terminal states are immutable.

Items are mutable objects during emission — a block emits `item.added` with `status: "in_progress"`, may update fields in-place (e.g. component data), then emits `item.done` with the terminal state. The persisted record holds only the terminal state; the SSE event log holds the full intermediate history.

## 2. Item type registry

This table is authoritative. Any new item type requires a row here before it can be merged.

| Type | Emitted by | Client | LLM | Trace | Persistence | Description |
|------|------------|--------|-----|-------|-------------|-------------|
| `message` | Generator (auto), any block via `ctx.emitMessage()` | Yes | Yes | No | Persistent | Conversational output. Primary content item. |
| `reasoning` | Generator (auto, when model produces CoT) | Yes | Yes | No | Persistent | Model chain-of-thought / thinking output. |
| `component` | Any block via `ctx.emitComponent()` | Yes | No | No | Persistent | Custom UI item with typed schema, rendered by a registered component. |
| `container` | Sequencer / Router with `container` config | Yes | No | No | Persistent | Visual grouping frame. Declares ownership scope for items emitted inside it. |
| `block_output` | Every block (auto, post-execution) | No | Conditional¹ | Yes | Persistent² | Block lifecycle record: timing, provenance, output, error, model usage. |
| `block_tool_output` | Generator (auto, per tool invocation) | Yes | Yes | No | Persistent² | Tool result when a block executes as a tool inside a generator's loop. |
| `router_decision` | Router (auto, on route selection) | No | No | Yes | Persistent² | Which branch was selected. |
| `status` | Any block via `ctx.emitStatus()` | Yes | No | No | **Always transient** | Transient progress update. Never persisted. |
| `context` | Any block via `ctx.emitLLMContext()` | No | Yes | No | Persistent² | Hidden LLM context injection. Not visible to clients. |
| `state_change` | Auto on `patchState`, `setState`, etc. | Yes | No | No | **Transient in prod** / Persistent in dev³ | State mutation record. |
| `resource_change` | Auto on resource mutations | Yes | No | No | **Transient by default** | Resource mutation notification. Not the resource state itself. |
| `error` | Runtime (terminal request failure) | Yes | No | No | **Always transient** | Terminal error. Request cannot continue after this. |
| `step_error` | Sequencer (on block error, rescued or not) | Yes | No | No | Persistent² | Block-level error within a sequencer. `recovered: true` when a rescue handler handled it. |
| `source` | Generator (auto, from provider-native tools) | Yes | No | No | Persistent² | URL reference from web search or other provider-native tool integrations. |
| `sequencer_state_snapshot` | Sequencer (at step boundaries) | No | No | Yes | Transient (stream-only) | Full sequencer state snapshot for devtool inspection. |

**Notes:**

¹ `block_output` enters LLM context only when it has a `toolCall` field — this is the legacy path where a generator invoked a block as a tool. New code uses `block_tool_output` instead.

² "Persistent" means not explicitly transient. If the emitting block is configured with `transient: true`, all its items inherit `transient: true` regardless of type.

³ `state_change` transience is controlled by `shouldPersistScopeChange()`: transient in production, persistent in development. Set `persistStateChanges: true` on the flow config to force persistence in production (for devtool state timeline).

## 3. Classification axes

### Audience routing

Two sets govern which items reach which consumers. These are enforced in `createExecutionContext.ts`.

**LLM audience** — items that enter history for subsequent LLM calls:

```
message, reasoning, context, block_tool_output, block_output (only with toolCall)
```

Items with `trace: true` are always excluded from LLM context regardless of type. This is a fast-path check before type routing.

**Client audience** — items sent to the browser via SSE and visible in `useSession`:

```
message, reasoning, component, container, block_tool_output, status, source,
state_change, resource_change, error, step_error
```

`block_output`, `context`, `router_decision`, and `sequencer_state_snapshot` are not client-visible. They exist for LLM history assembly, execution tracing, and devtool inspection only.

### Trace flag

`trace: true` marks structural lifecycle metadata — items that are useful for debugging and performance analysis but carry no conversational content. Trace items are:

- Excluded from LLM context (hard filter before type routing)
- Visible in the devtool trace tree
- Not rendered in the kitchen sink

Currently trace-flagged: `block_output` (lifecycle emissions), `router_decision`, `sequencer_state_snapshot`.

`block_tool_output` is intentionally NOT trace-flagged — it must enter LLM context for multi-turn tool calling to work.

### Persistence

- **Always transient**: `status`, `error` — stream-only, stripped before the request record is written
- **Transient by default**: `resource_change` (opt-in persistence via caller flag), `sequencer_state_snapshot` (stream-only observability)
- **Conditional**: `state_change` — transient in production, persistent in development
- **Persistent**: everything else, unless the emitting block is configured `transient: true`

The `runAction` persistence hook filters at `item.done` time: non-transient items trigger `persistItems()`, all replayable events trigger `persistEvents()`. These are independent storage targets — items go into the request record; events go into a separate append-only log used for SSE resume and devtool replay.

### Block-level transience

When a block is configured with `transient: true`, all items it emits inherit that flag. This is the mechanism for "stream-only" blocks whose output should never appear in the persisted session history.

## 4. Rendering contracts

### Kitchen sink (end-user chat UI)

`ItemRenderer` in `@flow-state-dev/react` governs how items render in the main stream.

**Non-renderable types** return null immediately:

```
context, state_change, resource_change
```

**Built-in fallbacks** for types with sensible defaults (used when no custom renderer is registered):

| Type | Fallback rendering |
|------|--------------------|
| `message` | Labeled chat bubble (`role` as label, `output_text` content) |
| `reasoning` | Collapsible `<details>` element (expandable thinking block) |
| `status` | Plain text status line |
| `error` | Red text error message |
| `step_error` | Orange text with block name and recovered flag |
| `block_tool_output` | Collapsible tool card with input args and output |

**Custom renderers** override built-ins. Registered via `FlowProvider` `renderers` prop. Pass `false` to explicitly suppress a type.

**Component and container items** resolve their renderer by sub-key (`item.component`). A container renderer suppresses `component` and `block_tool_output` items it owns — the container is responsible for rendering them internally via `useContainerItems`. Primary output types (`message`, `reasoning`, `status`, `error`) always render in the main stream even when owned by a container.

**Unregistered types** fall through to a JSON `<pre>` dev fallback. This is intentional — it makes new item types visible during development without requiring immediate renderer registration.

### Devtool

The devtool receives all items regardless of client audience. It accesses the raw event stream, not the filtered `useSession` view, so trace items and transient items are both visible.

Devtool-specific rendering:
- `block_output` items → execution trace tree with lifecycle states (in_progress → completed/failed), timing, model usage
- `sequencer_state_snapshot` items → state inspector panel at step boundaries
- `router_decision` items → route selection display
- All items → tabular stream view with type-appropriate renderers

The devtool is the only surface that renders `block_output`, `router_decision`, and `sequencer_state_snapshot`. These types should not appear in kitchen sink renderers.

## 5. The component item model

Component items let blocks emit structured data that renders via a registered UI component. They're the bridge between server-side computation and custom client UI.

### Emission

```ts
// In a handler or generator's execute function:
const handle = ctx.emitComponent("my-component", { step: 1, total: 10 });

// Update data in-place (mutations flow as SSE events, not new items):
handle.update({ step: 2 });
handle.update({ step: 3, result: "done" });

// Finalize:
handle.done();
```

`update()` mutates the item's data object in-place. Live clients receive every intermediate state via SSE `item.done` events for the same item ID — this is how streaming component updates work. The persisted item holds only the terminal state.

This is the answer to Jake's comment: components don't emit new items on each update. The event stream gets the deltas; the store gets the final state. If you need to track each intermediate state independently (e.g. a plan with separate steps), emit separate items with distinct `key` values instead.

### Optional key for deduplication

```ts
ctx.emitComponent("plan-status", { steps }, { key: "plan" });
```

When `key` is set, `ItemsRenderer` deduplicates: only the latest item with that key is rendered per request. This is for cases where you want to replace earlier snapshots with the current state rather than accumulate a history.

### Renderer registration

Component renderers are registered in the `FlowProvider`:

```tsx
<FlowProvider renderers={{ component: { "my-component": MyComponent } }}>
```

`MyComponent` receives `{ item: ComponentItem }`. Access the typed data via `item.data`.

### Relationship to container items

When a sequencer or router declares a `container` config with a `component` key, it emits a `ContainerItem` at execution start. That container item's `component` field links it to a container renderer. All items emitted inside the container scope carry `ownedBy: containerBlockInstanceId`.

The `useContainerItems` hook:

```ts
const { state, items, componentsByKey } = useContainerItems(containerItem, session);
```

- `state` — latest `ComponentItem` data for the container's own component key
- `items` — all items owned by this container, sorted chronologically
- `componentsByKey` — latest data per unique key across all owned component items

`ItemsRenderer` suppresses `component` and `block_tool_output` items owned by a container that has a registered renderer. The container renderer is responsible for presenting them.

### When to use component items vs native types

Use `component` when:
- The output needs custom UI that `message` or `status` can't express
- The data is structured (plan steps, search results, a card) and needs typed access on the client
- You want to update the display in-place during execution without emitting new items

Use native types when:
- Conversational text → `message`
- Progress text during a long operation → `status`
- Source citations from web search → `source`
- Errors → `error` or `step_error`

Don't use `component` items to replicate what native types already express. It bypasses built-in history assembly and rendering without adding value.

## 6. What doesn't belong in items

**Block status during execution**: Block lifecycle (started, running, completed, failed) lives on `block_output` as a mutable `status` field that transitions from `in_progress` to a terminal state. Do not emit a separate item type for each lifecycle transition.

**Block status messages / activity indicators**: `ctx.setStatus()` for live activity trees is a forthcoming feature (FIX-387). The design is deferred — do not speculate by emitting custom `component` or `status` items for this purpose.

**Session-level metadata**: Title, description, tags, and session metadata live on the session record. They flow via `session.metadata.changed` SSE events, not items.

**Resource state**: The actual state of a resource lives in the resource store. `resource_change` items are change notifications — they tell clients something changed so they can refetch. They don't carry the full resource value.

**LLM conversation history**: History is assembled on-demand from the persisted item log by filtering for LLM audience types and calling `itemToLLMMessages()`. It is not a separate storage layer and not a separate item type.

**Intermediate computation artifacts**: If a block computes something intermediate that feeds another block, pass it through the sequencer output chain. Items are for output the client or devtool needs to see, not internal data routing.

## 7. Adding a new item type

Before a new item type can be merged, all of the following must be true:

1. **Schema defined**: Add the type definition to `packages/core/src/items/types.ts` and include it in the `OutputItem` union.

2. **Registry row**: Add a complete row to the type registry table in section 2 of this document — all columns required.

3. **LLM audience declared**: If the type should enter LLM history, add it to `LLM_AUDIENCE_TYPES` in `createExecutionContext.ts`. If not, confirm it's absent.

4. **Client audience declared**: If the type should be visible to clients, add it to `CLIENT_AUDIENCE_TYPES` in `createExecutionContext.ts` and to `CLIENT_ITEM_TYPES` in `useSession.ts`. If not, confirm it's absent from both.

5. **Trace flag**: Set `trace: true` if this is a structural/observability item that should never enter LLM context. Leave unset for content items.

6. **Persistence category**: If this is a stream-only observability item, set `transient: true` at emission. Document the persistence rule in the registry table.

7. **Kitchen sink rendering**: Either register a built-in fallback in `ItemRenderer.ts`, document that it falls through to the JSON dev fallback, or explicitly add it to `NON_RENDERABLE_TYPES`. Do not leave this implicit.

8. **Devtool rendering**: If this type needs special devtool treatment (trace tree, inspector panel), add the renderer. Generic types fall through to the stream view.

9. **Rationale**: Document in the PR why an existing type can't serve the purpose. The bar is high — most new item needs can be expressed via `component` items with a registered renderer.

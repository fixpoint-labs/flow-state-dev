# Streaming

Flow State Dev uses SSE (Server-Sent Events) for real-time streaming. The streaming model is built on **items** (persisted artifacts) and **content** (chunks within items).

## Stream Architecture

```
Server (execution)                    Client (SSE)
  │                                     │
  ├─ block executes                     │
  ├─ emits items via ResponseEmitter    │
  │   ├─ item.added ───────────────────►│ (add item to local state)
  │   ├─ content.added ───────────────►│ (add content part)
  │   ├─ content.delta ───────────────►│ (append text chunk)
  │   ├─ content.delta ───────────────►│ (append text chunk)
  │   ├─ content.done ────────────────►│ (finalize content)
  │   └─ item.done ───────────────────►│ (finalize item)
  ├─ request.completed ───────────────►│ (terminal status)
  │                                     ├─ refetch state snapshot
```

**Key concepts:**
- POST returns `202 Accepted` immediately — execution is async
- Client establishes SSE connection for the `requestId` to receive live events
- Each event has a `sequence_number` for ordering and replay
- SSE `id` format: `${requestId}:${sequence_number}`

## Item Types

Items are the canonical persisted artifacts. Their type determines audience routing:

| Item Type | Client | LLM | Purpose |
|-----------|--------|-----|---------|
| `message` | Yes | Yes | Conversational content (user/assistant/system) |
| `reasoning` | Yes | Yes | Model reasoning/thinking traces |
| `component` | Yes | No | Structured data rendered by registered component |
| `context` | No | Yes | Hidden context for LLMs only |
| `container` | Yes | No | Visual grouping (sequencer/router frame) |
| `status` | Yes | No | Transient progress updates |
| `state_change` | Yes | No | Scope state mutation record |
| `resource_change` | Yes | No | Resource mutation record |
| `block_output` | No | Conditional | Execution record (every block) |
| `block_tool_output` | No | Yes | Tool result from generator tool invocation |
| `router_decision` | No | No | Route selection record (trace only) |
| `sequencer_state_snapshot` | No | No | Full sequencer state at step boundary (trace only) |
| `error` | Yes | No | Terminal errors |
| `step_error` | Yes | No | Recoverable step errors |

For `block_output`: When the item has `toolCall` metadata (legacy tool invocation by a generator), the output enters LLM context as the tool result. Otherwise, it's internal/devtools only. New tool invocations emit `block_tool_output` items instead.

### Trace Flag

Items may carry `trace: true` on `OutputItemBase` to mark them as structural lifecycle metadata. Trace items are always excluded from LLM context (filtered by `itemToLLMMessage`) but remain visible in the devtool trace tree for debugging and performance analysis. Currently, `block_output` items from lifecycle tracing, `router_decision` items, and `sequencer_state_snapshot` items are marked as trace. Tool result items (`block_tool_output`) are never trace-flagged because they must enter LLM context for multi-turn tool calling.

### Container Ownership (`ownedBy`)

When a sequencer or router declares a `container` config, items emitted during its execution carry `ownedBy: string` — the `blockInstanceId` of the declaring sequencer/router. This creates a flat ownership tag on the wire format (no nested structures), preserving SSE resume semantics.

**Propagation rules:**
- New container boundary: `ownedBy = container sequencer's instanceId`
- Inherited: non-container blocks inside a container scope inherit the parent's `ownedBy`
- Nested containers: inner container's items have `ownedBy = inner.instanceId`; the inner ContainerItem itself has `ownedBy = outer.instanceId`
- Outside any container: `ownedBy` is `undefined`

**Client-side:** `useSession` maintains an ownership index (`Map<ownedBy, Set<itemId>>`) for O(1) lookups. The `useContainerItems` hook resolves owned items and extracts component state for a given ContainerItem. `ItemRenderer` suppresses owned items when the owning container has a registered renderer.

## Content Model

Content streams within items. Four content types:

```ts
type Content =
  | { type: "output_text"; text: string; annotations?: Array<Record<string, unknown>> }
  | { type: "reasoning_text"; text: string }
  | { type: "refusal"; text: string }
  | { type: "file"; mediaType: string; data: string; filename?: string };
```

Text generators stream content via `content.delta` events — the client accumulates deltas to build the full text.

## Item Lifecycle

Every item has a status:

```
in_progress → completed     (success)
in_progress → incomplete    (bounded termination: caps hit)
in_progress → failed        (error)
```

Terminal states are immutable.

### Transience

- `status` items are always transient (stream-only, not persisted)
- `state_change` and `resource_change` are transient in production, persisted in dev mode
- All other items are persisted by default
- Flow-level `persistStateChanges: true` forces persistence for devtools state timeline

### Tool Call Lifecycle

Generator tool invocations use a two-phase lifecycle:

1. `item.added` — `status: "in_progress"`, `toolCall` populated, `output: undefined`
2. Tool block executes (may emit child items)
3. `item.done` — `status: "completed"`, `output` populated

## Stream Events

### Request Stream Events

The request stream carries these event types:

| Event | Purpose |
|-------|---------|
| `request.created` | Request started |
| `request.in_progress` | Execution underway |
| `item.added` | New item in the stream |
| `item.done` | Item finalized |
| `content.added` | Content part added to an item |
| `content.delta` | Text chunk appended |
| `content.done` | Content part finalized |
| `resource.changed` | Resource mutation (request scope) |
| `session.metadata.changed` | Session title/description/tags/metadata updated |
| `request.completed` / `.incomplete` / `.failed` | Terminal status |

### Event Envelope

Every event includes:

```ts
{
  stream: "request",
  requestId: string,
  sequence_number: number,  // monotonic ordering
  ts: number,
  type: string,
  // ... event-specific fields
}
```

## Items vs Events: Storage Model

The streaming system produces two distinct data sets, stored independently:

### Items (the record)

The **items array** on `RequestRecord` is the canonical output of a request — what it *produced*. The runtime reads items back for session context, action history, and API responses. Transient items (`transient: true`) are stripped before persistence; only durable items are stored.

Items are load-bearing. Without them, sessions cannot reconstruct history.

### Events (the execution log)

The **events log** is the ordered sequence of every SSE event emitted during execution — `item.added`, `content.delta`, `item.done`, etc. It includes events for transient items (sequencer snapshots, status updates, debug data) that never appear in the items record.

Events are observability data. The app never reads them back for business logic. Two consumers use them:

1. **SSE resume** — replaying missed events after a client disconnect
2. **DevTool replay** — reconstructing the full execution timeline post-hoc

### Storage independence

All `RequestStore` providers persist items and events through separate methods (`persistItems` / `persistEvents`). The filesystem store writes them as separate files (`req_xxx.json` vs `req_xxx.events.json`); SQLite uses separate tables (`requests` vs `request_events`).

Because events are operationally independent from items, they can be:

- Stored on a different backend (append-only log, time-series DB, observability pipeline)
- Retained with a different policy (e.g., capped collection, age-based pruning)
- Disabled entirely in production without affecting app behavior

This separation means observability-only item types (like `sequencer_state_snapshot` or `block_debug`) should use `transient: true` — they flow through the event stream for live and replay consumption without bloating the persisted item record.

## Resume Semantics

Resume after disconnect uses sequence-number cursors:

```
Last-Event-ID: req_123:42
// OR
GET /stream?starting_after=42
```

- If both provided, `starting_after` takes precedence
- Server replays persisted events with `sequence_number > cursor` then continues live
- `ping` events and diagnostics are NOT replayed

## Emission Rules by Block Kind

All blocks can emit explicitly via `ctx` methods. Additionally:

- **Generator**: Auto-emits `reasoning`, `message` (streaming), `block_tool_output` per tool invocation, final `block_output`
- **Handler**: Auto-emits `block_output` (internal only). Silent to client/LLM by default.
- **Sequencer**: Emits child block items. Optional `container` config for visual grouping.
- **Router**: Emits `router_decision` (trace) when a route is selected, then items from selected path. Optional `container` config.

State/resource mutations auto-emit `state_change` and `resource_change` items.

## Client Responsibilities

1. Maintain last seen sequence cursor
2. Deduplicate by stream identity + sequence number
3. Materialize item lifecycle state from events
4. On `request.completed`, refetch state snapshot (required correctness path)
5. Treat `state_change`/`resource_change` as invalidation signals for mid-request reactivity

## Item Provenance

Every item carries provenance metadata for traceability:

```ts
type ItemProvenance = {
  blockName: string;
  blockInstanceId: string;
  parentBlockInstanceId?: string;
  phase: "main" | "work";
  stepIndex?: number;
  attempt?: number;
};
```

This enables UI grouping, debugging, and devtools timeline views.

## Canonical Authority

For full type definitions, edge cases, and user-stream event contracts, see `../preperation/architecture/STREAMING.md`.


### Generator usage metadata on `block_output`

Generator `block_output` items may include `modelUsage` metadata with `model`, `promptTokens`, `completionTokens`, `totalTokens`, optional `providerMetadata`, and Anthropic cache convenience fields (`cacheReadTokens`, `cacheCreationTokens`). This metadata represents only that generator call; summing across `block_output` items gives total request usage.


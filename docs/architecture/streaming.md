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
| `error` | Yes | No | Terminal errors |
| `step_error` | Yes | No | Recoverable step errors |

For `block_output`: When the item has `toolCall` metadata (tool invocation by a generator), the output enters LLM context as the tool result. Otherwise, it's internal/devtools only.

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

- **Generator**: Auto-emits `reasoning`, `message` (streaming), `block_output` with `toolCall`, final `block_output`
- **Handler**: Auto-emits `block_output` (internal only). Silent to client/LLM by default.
- **Sequencer**: Emits child block items. Optional `container` config for visual grouping.
- **Router**: Emits items from selected path. Optional `container` config.

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

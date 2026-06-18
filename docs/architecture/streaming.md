# Streaming

Flow State Dev uses SSE (Server-Sent Events) for real-time streaming. The streaming model is built on **items** (persisted artifacts) and **content** (chunks within items).

For the complete item type registry, classification rules, and rendering contracts, see [Items](./items.md).

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
| `container` | Yes | No | Visual grouping (sequencer/router frame) |
| `status` | Yes | No | Transient progress updates |
| `state_change` | Yes | No | Scope state mutation record |
| `resource_change` | Yes | No | Resource mutation record |
| `block_trace` | No | Conditional | Execution record (every block) |
| `tool_output` | No | Yes | Tool result from generator tool invocation |
| `router_decision` | No | No | Route selection record (trace only) |
| `state_snapshot` | No | No | Full sequencer state at step boundary (trace only) |
| `error` | Yes | No | Terminal errors |

For `block_trace`: When the item has `toolCall` metadata (legacy tool invocation by a generator), the output enters LLM context as the tool result. Otherwise, it's internal/devtools only. New tool invocations emit `tool_output` items instead.

### Visibility Resolution

`resolveItemVisibility(item)` returns `{ client, history }` as a pure function of `(item.type, item.itemVisibility)`. There are no per-item override flags. Conversational types (`message`, `reasoning`, `tool_output`) inherit visibility from the producing generator's `itemVisibility` (`{ client: true, history: true }`, `{ client: true, history: false }`, `{ client: false, history: false }`). Structural items have fixed per-type visibility — `block_trace`, `router_decision`, and `state_snapshot` are devtool-only.

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
| `content.audio.delta` | Audio chunk appended (streaming TTS, live-only) |
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

The physical layout of the items record varies per adapter (Postgres stores them in a dedicated `request_items` table, others inline them in the request JSON). See [`@flow-state-dev/store-postgres` README](../../packages/store-postgres/README.md#items-storage) and [Items — Storage by adapter](./items.md#storage-by-adapter) for the per-adapter map.

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

This separation means observability-only item types (like `state_snapshot`) should use `transient: true` — they flow through the event stream for live and replay consumption without bloating the persisted item record.

### Durability ordering

Replayable events are persisted **before** they are flushed to the SSE wire. The emitter awaits the store's `flushEvents` after enqueueing each event and only then enqueues the SSE frame to the stream controller. This closes the window where a client could observe `sequence_number = N` while the persisted log still capped at `seq < N` — a silent gap on reconnect. Persistence failures surface via `onPersistError` and re-throw from the emitter, so a producing block fails loud rather than silently losing events.

`ping` and `debug` events are not replayable and skip the durability barrier — they go straight to the wire.

`content.audio.delta` events are non-replayable for the same reasons (FIX-523). The durable representation of synthesized audio is the eventual `OutputAudioContent` snapshot delivered via `content.added` / `content.done`; chunks are the live transport only. Per-chunk persistence would 10–100x the events-log size for sub-second TTS without enabling any client behavior the snapshot doesn't already cover.

`content.delta` events are also non-replayable. The events-log path is bypassed for streaming text, but the running text is checkpointed durably via the items snapshot: each delta mutates the in-flight `MessageItem.content[i].text` (and `ReasoningItem.summary[i].text`) in-place, and the emitter's `onItemUpdate` hook drives a coalesced `persistItems` write at the store's natural cadence. The motivation is throughput: under concurrent worker streams (e.g. a supervisor with `concurrency: 3` and three streaming workers), a per-token disk round-trip on the events log serializes every delta behind every other delta and the request appears to lock up. Live SSE consumers and devtool observers still receive every delta via the wire callback and the in-memory event buffer.

### Streaming-text contract

| Boundary | Replayable on the events log | Mutates `request.items` snapshot |
| -- | -- | -- |
| `item.added` (message/reasoning) | yes | yes |
| `content.added` | yes | no |
| `content.delta` | **no** (FIX-479) | yes — accumulates text in-place |
| `content.audio.delta` | **no** (FIX-523) | no — durable snapshot is the eventual `OutputAudioContent` |
| `content.done` | yes | no |
| `item.done` | yes | yes (final authoritative payload) |

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
- `content.delta` events are NOT replayed (FIX-479). The current item snapshot in `request.items` carries the running text up to the most recent coalesced flush; reconnecting clients pick up live deltas from the new connection forward, and the eventual `item.done` payload supersedes with the authoritative final text. Page-load bootstrap (`/items` synthesis path) shows the latest accumulated text rather than empty content for in-flight messages
- `content.audio.delta` events are NOT replayed (FIX-523). The durable `OutputAudioContent` snapshot is delivered via `content.added` / `content.done` and survives reconnects; in-flight audio chunks are lost. Clients hear a gap from disconnect to the next live delta. This matches every comparable system (OpenAI Realtime, ElevenLabs WS, Cartesia, LiveKit) — nobody does mid-stream audio resume

## Store-driven event subscriptions

Live tail is owned by `RequestStore.subscribeToEvents(requestId, options)`. The route handler does catch-up + live in a single iterator; the legacy in-process active-streams registry is gone (FIX-569).

What the store interface owns:

- **Catch-up**: events with `sequence_number > options.fromSequence`.
- **Live**: events as they are persisted, in order.
- **Termination**: `signal.abort()`, terminal request status, or a liveness timeout that yields a synthetic `request.interrupted` event (default 30s, override via `LIVE_TAIL_LIVENESS_MS`).

Per-backend strategies:

- **Memory**: in-process bus; `persistEvents` fans out to subscriber callbacks. Same emitter source as `addEventObserver`.
- **SQLite / filesystem / Postgres-without-`liveTailPool`**: poll `getEvents(requestId, lastSeen)` on a fixed interval (default 100ms; Postgres polling fallback is 250ms).
- **Postgres with `liveTailPool`**: `LISTEN flow_events` on a dedicated `pg.Client` checked out from the dedicated pool. Notifications carry a signal-only payload `${requestId}:${seq}`; the subscriber drains via `getEvents(id, lastSeen)` once per dirty cycle (Notifier Pattern). `pg_notify` runs inside the same transaction as the row insert so subscribers never see signals for events that didn't commit.

Hidden invariants preserved:

- **First-event persistence** replaces synchronous active-streams registration. The route handler attaches `subscribeToEvents` once a request record or first event exists in the store.
- **`content.delta` cross-process gap**: deltas are not persisted. Memory subscribers receive them when the bus carries them; cross-process subscribers (SQLite/Postgres/filesystem) snap to the next persisted `item.added` / `item.done` / item-update snapshot. Documented limitation, not a bug.
- **`addEventObserver` carve-out**: TTS subscribes via `response.addEventObserver`; untouched by FIX-569. Two independent consumers of the emitter push chain.
- **Single-SSE-writer**: TTS observers read; only the SSE wire writes. The conformance test asserts each event reaches both consumers exactly once.

## Attach Contract

The attach handshake has one shape regardless of where execution runs:

- **In-process** — the POST returns an inline SSE response (`200`) and streams directly.
- **External dispatch** — the POST returns `202 Accepted` with `{ requestId }`; the client opens `GET /requests/:id/stream`, which tails via `subscribeToEvents`.

**Enqueue-time discoverability.** For external dispatch, the worker runs in a separate process and would otherwise only register the request when it starts `runAction` — so a GET arriving first would find no record and 404. The transport host closes this gap: before handing off to an external dispatcher, `createInboundTransportHost.dispatch` writes the `activeRequests` entry and an `in_progress` request record at enqueue time. This extends *first-event persistence* — discoverability no longer waits for the worker, only for the enqueue. The GET then resolves the record and waits at sequence 0 for the first event. A shared `createInitialRequestRecord` builder constructs this stub the same way the worker would, so the worker adopts it and skips its own write.

Resume rides the same path: `resume-routes` re-dispatches a suspended request through `host.dispatch` with a fresh request id, so the resumed request is pre-registered too. A genuinely unknown request id still returns 404.

The tradeoff of enqueue-time registration is that the `activeRequests` heartbeat clock starts at enqueue, not at worker-start. The stale-request sweeper reaps the entry and marks the record interrupted when the worker never starts — and also if a backed-up queue delays worker-start past the staleness threshold (default 30s). The worker resets the heartbeat when it claims the job.

## Emission Rules by Block Kind

All blocks can emit explicitly via `ctx` methods. Additionally:

- **Generator**: Auto-emits `reasoning`, `message` (streaming), `tool_output` per tool invocation, final `block_trace`
- **Handler**: Auto-emits `block_trace` (internal only). Silent to client/LLM by default.
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

This document is authoritative for the streaming model and event contracts. For full type definitions, refer to the published types in `@flow-state-dev/core` and `@flow-state-dev/server`.


### Generator usage metadata on `block_trace`

Generator `block_trace` items may include `modelUsage` metadata with `model`, `promptTokens`, `completionTokens`, `totalTokens`, optional `providerMetadata`, and Anthropic cache convenience fields (`cacheReadTokens`, `cacheCreationTokens`). This metadata represents only that generator call; summing across `block_trace` items gives total request usage.


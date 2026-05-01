# Server Package Review: Streaming, CAS, Persistence, Execution

Scope: `packages/server/src/` (~16.6k LOC, 102 files), plus `packages/store-sqlite/`, `packages/store-postgres/`, and `packages/vercel/`.

This is a first-principles review focused on offloadable complexity. The framework has clearly absorbed a lot of bespoke infrastructure into the server package — much of it solid and well-considered, but a meaningful fraction reinvents wheels that exist in well-tested libraries. Below is the file-by-file accounting and the substitution opportunities.

## 1. Streaming subsystem

The streaming spine is essentially hand-rolled SSE plus a custom in-memory event log. The ingredients:

- `streaming/sse.ts` (62 lines): hand-rolled SSE frame serializer (`id:`, `event:`, `data:`, `retry:`, comments). This re-implements RFC-spec SSE output. There is no dependency on `eventsource-parser`, `hono/streaming`, or any other library — `serializeSSEFrame` is bespoke, including the `data:` line splitting on `\n`.
- `streaming/encode-event.ts` (76 lines): builds the event id (`${requestId}:${sequenceNumber}`), wraps the envelope, calls `serializeSSEFrame`. Bespoke.
- `streaming/heartbeat.ts` (87 lines): hand-rolled `ReadableStream` wrapper that injects `: ping\n\n` on a `setInterval`. This is a Web-Streams transform that could be a tiny `TransformStream` or replaced by `hono/streaming`’s SSE helper, which already does keepalives.
- `streaming/live-stream.ts` (114 lines): bespoke `ReadableStream` controller bridge. Holds a `controller` reference, enqueues encoded frames, manages cancel/close. Standard `ReadableStream` + manual encoder. The `LiveRequestStream` type and lifecycle is original.
- `streaming/response-emitter.ts` (668 lines): the heart of the system. A stateful class with: monotonic `sequenceNumber`, in-memory `events[]` ring buffer (`DEFAULT_MAX_BUFFER_SIZE = 10_000`), `itemsById` Map, observers, `itemHooks`, `eventHooks`, `internalSeams`, and a `getReplayableEvents` filter. Every emission method (~20 of them) wraps a `RequestStreamEvent` shape, increments `sequenceNumber`, applies envelope seams, persists, and pushes to the wire. There is also in-place delta accumulation (`applyDelta`) for `MessageItem.content[i].text` / `ReasoningItem.summary[i].text`. This is the file that most reinvents existing primitives — durability barrier, backpressure-via-await, sequence numbers, replayable-event filtering.
- `streaming/resume.ts` (161 lines): cursor parsing. `parseStreamEventId`, `parseStartingAfter`, `resolveRequestReplayCursor`, `replayRequestEvents`. All hand-rolled. The cursor format (`<requestId>:<seq>`) is standard SSE Last-Event-ID, but parsing is custom.
- `streaming/active-streams.ts` (127 lines): module-level `Map<requestId, LiveRequestStream>` with custom TTL/capacity handling. This is a singleton registry serving as a request-to-stream join.
- `streaming/client-filter.ts` (54 lines): reasonable, small visibility filter. Not duplicating anything external.
- `routes/stream-routes.ts:81-141`: a SECOND `ReadableStream` constructor for late-attach SSE. So we have two parallel SSE streams: one bound to `LiveRequestStream` (the in-flight emitter), and a second one created per new GET `/stream` connection that subscribes to the emitter via `addEventObserver`. Each new client gets its own `ReadableStream`; deduplication and replay-from-cursor are repeated here.

**Could this be reduced 50–80% by adopting a battle-tested SSE library?** Yes, plausibly 50%. The realistic substitution model:

- `hono/streaming`’s `streamSSE` API does framing, heartbeat keepalive, and abort propagation in ~one line per route. That replaces `sse.ts`, `heartbeat.ts`, and most of `live-stream.ts`.
- Vercel AI SDK’s `createUIMessageStream` plus `streamText` already produces the streaming protocol every Vercel-hosted chat app expects, with structured “parts”, content deltas, tool calls, and reasoning. This is a near drop-in replacement for the `item.added`/`content.delta`/`item.done` lifecycle for the *generator* path. Wave 1 ships against `ai@^6` (see `packages/server/package.json`) but does not adopt its UI-message stream — instead it wraps the SDK’s output and re-emits in the framework’s own protocol. That’s real cost.
- `eventsource-parser` covers the *client* side; the server is the producer here. Not directly relevant for `server/`, but the symmetry argument goes the other way: the client is also reinventing parsing.

**Resume + sequence numbers + heartbeats:** Hand-rolled. Sequence numbers are `++this.sequenceNumber` in `response-emitter.ts:512`. Resume cursor uses both `Last-Event-ID` and a `?starting_after=N` query param (`resume.ts:97-122`). This works but is functionally identical to what an event-store cursor + Postgres `LISTEN`/`NOTIFY` channel would give you for free. The `request_events` table in `store-postgres/schema.ts` and `store-sqlite/schema.ts` already maintains `(request_id, sequence_number)` rows; replacing the in-memory ring buffer with a `LISTEN/NOTIFY`-driven tail would eliminate `active-streams.ts` and shrink `response-emitter.ts`’s replay path.

**Backpressure:** There is none, in the strict TCP-aware sense. The emitter pushes synchronously into the `ReadableStream` controller; if the consumer is slow, frames are buffered in the controller queue. Buffer cap (`maxBufferSize`) is on the *server-side events array*, not the wire. The `flushEvents` await provides per-event durability backpressure (FIX-399), which is the right call. But there is no per-stream wire-level concurrency control.

**Specific reinvented primitives:**

| Primitive | File | LOC | Off-the-shelf |
| --- | --- | --- | --- |
| SSE frame encoder | `streaming/sse.ts` | 62 | `hono/streaming`, `srvx`, raw `TransformStream` |
| Heartbeat injector | `streaming/heartbeat.ts` | 87 | `hono/streaming` `keepalive`, `EventSource` server libs |
| Sequence number generator | `response-emitter.ts:512` | inline | Postgres serial column + RETURNING |
| In-memory event log + replay | `response-emitter.ts` | ~250 of 668 | Postgres `LISTEN/NOTIFY`, Redis Streams |
| Resume cursor parser | `streaming/resume.ts` | 161 | `Last-Event-ID` is a standard string; `parseInt` |
| Active stream registry | `streaming/active-streams.ts` | 127 | Per-process `Map` is fine; the TTL/capacity logic is bespoke |

A v2 can move resume entirely to the events table (already exists in `store-postgres/src/request-store.ts:148-185`) by tailing it via `LISTEN/NOTIFY` or a polling cursor. That deletes the active-streams registry, the late-attach `ReadableStream` in `stream-routes.ts`, and most of the `getReplayableEvents`/`addEventObserver` machinery in the emitter.

## 2. CAS / atomic state operations

The CAS layer is real, justified, and overweight.

- `stores/cas.ts` (160 lines): `runWithCAS` — load → mutate → persist with exponential backoff. Includes a no-op short-circuit (`deepEqual`) and state-size warnings. Solid implementation.
- `stores/state-container.ts` (253 lines): `MemoryStateContainer` (a clone-on-read/clone-on-write JSON cache), `createScopeStateOps` (the public `patchState` / `incState` / `pushState` / `setStateRecord` / `deleteStateRecord` / `atomicState` builder), and a `createContainerPersist` fallback that does sync version-checking against the container itself when there’s no backing store.
- The store-level CAS is in each store’s `set(id, value, expectedVersion)`:
  - SQLite: `sqlite-store.ts:81-114` — `UPDATE … SET version = ? WHERE id = ? AND version = ?`. Correct, simple.
  - Postgres: `pg-store.ts:107-136` — `UPDATE … WHERE id = $... AND version = $...`. Correct, simple.
  - Filesystem: `stores/filesystem/shared.ts:163-200` — per-id in-process write lock (`createWriteLock`) that serializes `set`/`update`. Correct only for single-process. Documented.

**Could this be offloaded?** Partially.

- The retry loop (`runWithCAS`) is a small, focused state machine. There’s nothing wrong with it, but it duplicates what `p-retry` already does, plus a deep-equal guard and backoff. Saving ~80 lines isn’t huge.
- The store-level CAS itself is stock optimistic-locking: a `version` integer column + `WHERE version = $expected`. This is the simplest possible mechanism; libraries like `effect-ts`’s STM would *add* complexity rather than remove it.
- The filesystem store’s in-process lock (`createWriteLock`) is the only place where bespoke concurrency control deserves scrutiny. If filesystem is truly only a developer convenience (the docs imply it), this lock could be deleted with no production impact.

The most economical simplification: keep the SQL store CAS as-is, delete the filesystem lock (mark filesystem store as single-tenant dev-only and require Postgres for multi-process), simplify `runWithCAS` to a `p-retry` call with a custom shouldRetry. Net savings: maybe 100–150 lines. Not transformational.

What is *not* justified is the conceptual surface area: there are three layers (`StateContainer`, `runWithCAS`, `Store.set` returning `SetResult` with conflict info). They each have a reason — read-through cache, retry orchestration, predicate write — but the `SetResult` discriminated union is awkward. A v2 could collapse this by having stores throw a typed `ConcurrentModificationError`, which `runWithCAS` catches; that drops the data-encoded conflict path and saves ~30 lines.

## 3. Item persistence + replay

There is a custom event-log abstraction and it is over-built.

- `RequestStore` interface (`stores/types.ts:136-179`) carries seven non-CRUD methods: `persistItems`, `flushItems`, `persistEvents`, `flushEvents`, `getEvents`. Each store reimplements coalescing, microtask queues, and `latestItemSnapshots` Maps:
  - `stores/filesystem/request-store.ts` (260 lines): coalesced item writes via `serialized-write-queue.ts`, separate event-write queue, atomic `tmp + rename` writes for both, error-capture map for FIX-399.
  - `stores/memory/request-store.ts` (92 lines): trivial.
  - `store-sqlite/src/request-store.ts` (157 lines): `queueMicrotask`-coalesced writes, batched `INSERT OR REPLACE` for events.
  - `store-postgres/src/request-store.ts` (187 lines): same pattern, but with `Promise<void>` tracking and `jsonb_set` for items.

Each store independently re-implements: (a) the coalescing of item snapshots, (b) the accumulator of new events, and (c) the “queued” boolean to prevent enqueuing more than one pending write. That’s the same idea in three places.

**Could a stock event-sourcing lib replace it?** Yes, partially.

- `@event-driven-io/emmett` provides `streamEvents`, `appendToStream`, `readStream` with native Postgres and SQLite adapters. The framework’s “events log” is exactly an append-only stream keyed by `requestId`. Adopting it would delete: `persistEvents`/`flushEvents`/`getEvents` from the interface; the per-store accumulators; and the bespoke `pendingNewEvents` Maps. Items are a different shape (a coalesced snapshot, not a stream), but they could be modeled as a single `request.snapshot` event that supersedes prior snapshots, OR kept as a sidecar — but unified through emmett’s API.
- Postgres `LISTEN/NOTIFY` (or an `UNLOGGED` table + `pg_notify`) replaces both the emitter buffer and the active-stream observer pattern.

The bigger smell is the dual data model (items + events) baked into `RequestStore`. The architecture doc justifies it (items are the record; events are the log), but in practice both are stored, both are recoverable, and they overlap: the `buildReplayEvents` function in `route-utils.ts:417-486` reconstructs events from items when events aren’t available. That’s a fallback for old records. In a v2, only the events log is the source of truth; the items array is a derived projection, not separately persisted.

## 4. Execution runtime

The execution layer is large but mostly hand-rolled for legitimate reasons. Important findings:

- `execution/runAction.ts` (936 lines): the main lifecycle. Heartbeat timer, abort controller registration, parse, observer hooks (`onStarted`/`onCompleted`/`onErrored`/`onFinished`), execute root block, drain queues, persist. The branching for completed/aborted/interrupted/failed is large (lines 786–935) and largely sequential bookkeeping — flush items, flush events, flush checkpoints, patch record, emit terminal status. This is glue code; little to offload.
- `execution/executeBlock.ts` (583 lines): the per-block dispatcher. Calls `block.run`, runs middleware, handles retry, builds provenance, emits `block_output`. Contains a `_blockOutputHint` feedback channel from generator/sequencer back to the dispatcher — uncomfortable but contained.
- `execution/retry.ts` (150 lines): hand-rolled retry with exponential backoff, abort signal, `onRetry` callback. **This is `p-retry` reimplemented.** `p-retry` covers all of this (including the abort-via-AbortSignal path) in roughly 5 lines of wrapper code. Net savings: ~120 lines.
- `execution/work-queue.ts` (102 lines): a non-aborting Promise.all. Not a true concurrency-limited queue (no `maxConcurrency`). The framework relies on this being unbounded; concurrency limits live elsewhere (in core sequencer/router primitives like `parallel({ maxConcurrency })`). This file is small but not a great match for `p-queue` since the semantics are “collect background work, await batch.”
- `execution/abort-registry.ts` (50 lines): `Map<requestId, AbortController>`. Trivial. Fine as-is.

**Async context handling:** `AsyncLocalStorage` is used exactly once in the codebase, at `context/createExecutionContext.ts:2221`, only for `resolvedModelStorage` (passing the resolved model id through to nested generator calls). The execution context is otherwise threaded explicitly via the `ctx` parameter to every block. That’s a defensible architectural choice — explicit > implicit — but it does mean `executeBlock` and `runAction` hand-thread a *lot* of state. An `AsyncLocalStorage<ExecutionContext>` could remove the need to pass `ctx` to every internal helper, but the public API (where `(input, ctx)` is the block signature) cannot change.

**Hand-rolled scheduler:** No, blocks just `await`. The “scheduler” is the JavaScript event loop, which is correct.

## 5. Routes / HTTP layer

This is custom and the only place I’d call it actively suspicious.

- `routes/parseFlowRoute.ts` (341 lines): a hand-coded match table. Twenty-plus `if (method === "GET" && segments.length === N && segments[0] === "...")` branches. This grew linearly over the project’s life and has no dependency footprint, but it’s fragile — adding a route requires editing three files (`parseFlowRoute.ts`, `http-handlers.ts` dispatcher, the route handler module).
- `routes/createFlowApiRouter.ts` (363 lines): adapter shim that exposes `{ GET, POST, PATCH, DELETE }`. Includes a separate matcher `matchRoute` (lines 337-363) for *transport-adapter* routes — a second routing engine.
- `routes/http-handlers.ts` (448 lines): a long if-else chain dispatching from `route.kind` to handler functions.

**Why is it custom?** The doc claims the framework wants to be portable across Next.js / Vercel / Hono / Bun, exposing `{ GET, POST, ... }` so each runtime can mount it. That’s legitimate — it means `Hono` is a wrong fit at the public-facing layer. But internally, `parseFlowRoute` could be replaced with `hono/router` (the `RegExpRouter` is a tree, not a regex chain) or even a tiny `path-to-regexp` table without changing the external `{ GET, POST }` interface. The `matchRoute` helper for adapter routes (`createFlowApiRouter.ts:337-363`) is already a smaller version of this and could share the impl.

A reasonable refactor: keep the public `{ GET, POST, PATCH, DELETE }` shape, replace `parseFlowRoute` + `http-handlers.ts` dispatch with a Hono `Hono` instance that returns a single function. Net savings: ~400 lines, plus a much simpler “add a route” story. The dependency cost is one well-maintained, fast library.

## 6. Middleware system

`middleware/compose.ts` (70 lines): koa/connect-style `next()` chain with double-call detection. Fine, small.

The genuine concern is conceptual overlap, not LOC: the framework has *three* hooks for what is effectively the same thing.

1. **Middleware** — wraps `(input, ctx) → output`, pre/post async work.
2. **Lifecycle observers** — `onStarted`/`onCompleted`/`onErrored`/`onFinished` at request, action, and block level.
3. **Rescue blocks** — `.rescue([...])` in sequencer DSL, type-matched error recovery.

These overlap: a “log every block” concern can be middleware, an `onCompleted` observer, or a rescue block (for errors). The runtime threads all three through every block (`runAction.ts` calls `runObserver` repeatedly; `executeBlock.ts` runs middleware around the block; sequencer rescue lives elsewhere in core). Pruning would be a v2 architectural call, not a libraryization. My read: middleware is the right primitive; lifecycle observers are sugar for `middleware.execute` with `try/finally`; rescue is a pure error-handler middleware. A v2 could collapse all three into middleware-with-typed-error-handlers.

## 7. Stores

The `StoreRegistry` interface is wide:

- 5 record stores: `session`, `request`, `user`, `org`, plus
- `activeRequests` (a registry, not a record store),
- `content` (a content-addressed key/value store), and
- `checkpoints` (a small (`requestId`, `blockInstanceId`) → state map).

That’s seven distinct interfaces (`stores/types.ts:120-301`). Each has its own adapter for in-memory, filesystem, SQLite, and Postgres — so 7 × 4 = 28 implementations total. The repetition is extreme.

The interface is *not* shaped for the worst case (Postgres). It is shaped for the simplest case (in-memory `Map`), with CAS bolted on top via `expectedVersion`. The Postgres adapter then has to fight that interface: in `store-postgres/src/request-store.ts:101-126`, the items-only update has to use `jsonb_set` to avoid clobbering concurrent state writes, because the `set` interface assumes write-the-whole-record. Postgres would naturally separate items, events, state into different columns/tables and update them independently; instead they’re all packed into a `data jsonb` column and patched via SQL surgery. That is the worst of both worlds: the interface is general, but the implementation has to be careful.

A v2 with Postgres-shaped contracts: separate `RequestRecord` (status + timestamps), `RequestState` (CAS state with version), and `RequestEvent` (append-only). The current interface tries to be one record-shaped abstraction; the concrete need is three.

The `checkpoints` and `content` interfaces are well-shaped — small, focused, no unnecessary generality.

## 8. Voice

`voice/` is 457 lines (`tts-pipeline.ts` 247, `tts-emitter-hook.ts` 95, `sentence-buffer.ts` 57, `context.ts` 41, `index.ts` 17).

It is in `server/` because it observes the `ResponseEmitter`’s event stream and re-emits `OutputAudioContent` parts on sentence boundaries. The pipeline holds: a `Map<itemId, SentenceBuffer>`, a `Map<itemId, contentIndex>`, an emission chain Map, a hand-rolled concurrency limiter (`acquireSlot`/`releaseSlot` in `tts-pipeline.ts:53-68`), and a hand-rolled `withTimeout`. The concurrency limiter is `p-limit` reimplemented.

**Should it be in server?** No, this is scope creep. The TTS pipeline is a generic “observe content deltas, synthesize on sentence boundaries, emit audio content parts” transform. It has no privileged access to the runtime — `addEventObserver` and `emitContentAdded` are public APIs of the `ResponseEmitter`. It belongs in its own package: `@flow-state-dev/voice` or `@flow-state-dev/tts`. Moving it would:

- Drop `voice/` (~457 lines) from `server/`.
- Drop the conditional TTS hook setup in `runAction.ts:378-392` from the runtime.
- Eliminate the `speechResolver` / `transcriptionResolver` parameters threaded through `createFlowApiRouter`, `createInboundTransportHost`, `createFlowRouteHandlers`, and route handlers.

This is a solid extraction candidate.

## 9. Devtool integration

The runtime has explicit knowledge of the devtool, but the integration is mostly observer-shaped:

- `streaming/internal/seams.ts` and `execution/internal/seams.ts`: hookable interception points (`event.before_encode`, `event.before_store`, `item.added`, `item.done`, etc.). These are no-op by default, populated by the devtool.
- `?unfiltered=true` on `/stream` (mentioned in `streaming/client-filter.ts:8` and consumed in `stream-routes.ts:58, 83`): a devtool query to bypass the client-visibility filter.
- `state_snapshot` items, `block_debug` items, `router_decision` items: trace-only event types defined in core but routed through the server.
- `execution/internal/debug-items.ts` (130 lines): payload builders for `block_debug` items. Devtool is the only consumer.

Most of this is invasive *only* in the type system — the runtime doesn’t branch on “is the devtool attached.” The seam pattern is well-isolated. The exception is `state_snapshot` durability (`runAction.ts:465-525`), which is non-trivial logic that exists *because* devtools and the future resume runtime want it.

Verdict: devtool support is observer-only in spirit but not in code shape. The `internal/seams.ts` files are a minor LOC tax; the `state_snapshot` flow is co-mingled with the production resume runtime. I’d leave it alone.

## 10. Vercel adapter

`packages/vercel/` is small (~314 lines total) and *almost* a thin shim:

- `handler.ts` (161 lines): wraps a `FlowApiRouter` into Next.js App Router-shaped handlers. Awaits the Next 15 async `params`, sets two extra SSE headers (`cache-control: no-transform`, `x-accel-buffering: no` for Nginx-bypass), forwards request abort signals.
- `config.ts` (28 lines): exports `runtime`, `maxDuration`, `dynamic` constants — but the doc explicitly says these can’t be re-exported because Next reads them statically. So the file is purely informational/programmatic.
- `heartbeat.ts` (7 lines): deprecated re-export shim of `injectHeartbeat` from `@flow-state-dev/server`.
- `pg.ts` (50 lines): unread by me but presumably a `pg.Pool` factory tuned for serverless.
- `index.ts` (14 lines), `types.ts` (54 lines).

So 217 lines of substantive code. **Is it real work?** Mostly no. The two SSE headers are real Vercel/Nginx-specific knowledge. The async-params wrapper is a Next.js 15 deprecation accommodation. The `onAbort` plumbing is a small convenience. Everything else is a restating of Next’s own contract.

I’d say: yes, it’s mostly a “we deploy on Vercel” shim. That’s fine — it’s the right size for what it does, and the value is in *not* polluting `server/` with Vercel-isms. No simplification needed.

## 11. Top 10 specific opportunities to offload

| # | Custom code | LOC est. | Off-the-shelf |
| --- | --- | --- | --- |
| 1 | SSE framing + heartbeat (`streaming/sse.ts`, `heartbeat.ts`, parts of `live-stream.ts`) | ~250 | `hono/streaming` `streamSSE` |
| 2 | Retry loop (`execution/retry.ts`) | 150 | `p-retry` |
| 3 | TTS concurrency limiter (`voice/tts-pipeline.ts:50-68`) | 25 | `p-limit` |
| 4 | TTS withTimeout (`voice/tts-pipeline.ts:239-247`) | 9 | `p-timeout` |
| 5 | Route table (`routes/parseFlowRoute.ts` + dispatch) | 341 + 200 | `hono` `Hono` router (`RegExpRouter`) |
| 6 | Per-store coalesced item/event write logic (3 stores × ~50 LOC) | ~150 | A shared `coalescedSnapshotWriter` utility, or just adopt a single store backend |
| 7 | Resume cursor parsing (`streaming/resume.ts`) | 161 | `Last-Event-ID` is already a string; trim to ~30 lines via `parseInt` |
| 8 | Active-streams registry (`streaming/active-streams.ts`) | 127 | Postgres `LISTEN/NOTIFY` channel keyed by `requestId` |
| 9 | Filesystem per-id lock (`stores/filesystem/shared.ts:137-150` + retries) | 30 | Delete; mark filesystem store dev-only |
| 10 | Event log persistence (`request-store.ts` for FS/SQLite/PG) | ~300 across packages | `@event-driven-io/emmett` or one shared `appendToEventStream` helper |

Total realistic savings without changing public API: ~1,500–2,000 LOC, plus less drift between three store implementations.

## 12. Sketch of a v2 server

Constraints kept: the public surface (`createFlowApiRouter` returning `{ GET, POST, PATCH, DELETE }`, `runAction` semantics, `ResponseEmitter` interface visible to blocks, `BlockContext` shape).

Constraints relaxed: filesystem store moves to dev-only, in-memory store keeps current shape, only Postgres is targeted for production semantics.

```
server/
  routes/        # one Hono instance, mounted under /api/flows
  execution/     # runAction, executeBlock, retry-via-p-retry
  streaming/     # response-emitter (snapshots only), wire via hono/streaming
  stores/        # types only — no in-tree implementations except in-memory
  context/       # createExecutionContext (~unchanged)
```

**Streaming spine:** When a request starts, write `request.created` to `request_events`. Each `item.added` / `content.delta` / `item.done` is an INSERT on the events table. The HTTP `/stream` route opens a Postgres `LISTEN` on `request_events:${requestId}`, replays rows from `seq > cursor`, then tails new rows via `NOTIFY` payloads. The `LiveRequestStream` and `active-streams` registry vanish — a stream is just a Postgres listener cursor. Heartbeats become `hono/streaming`’s built-in keepalive. Resume becomes free: any consumer (live or late) reads the same table with the same cursor logic.

**State CAS:** Same pattern, just collapsed. `RequestState`, `SessionState`, `UserState`, `OrgState` each get a `(id, version, state_jsonb, updated_at)` table; `runWithCAS` keeps its retry loop but throws a typed error instead of returning a `SetResult` discriminated union.

**Items snapshot:** Materialized projection over `request_events`, computed lazily on read by the request-status route. Stop persisting `RequestRecord.items` separately; compute it from the events table via a SELECT + reduce. The retention policy in `execution/retention.ts` then operates on event rows, not request records.

**Routes:** One Hono `app` configured with the canonical paths. `parseFlowRoute` deleted; route definitions become `app.post('/:flowKind/actions/:action', handler)`.

**Generator pipeline:** Adopt `ai`’s `streamText` + `createUIMessageStream` for the actual model-streaming protocol on the wire, while keeping `item.added`/`content.delta`/`item.done` as the framework’s internal abstraction. The generator block translates between the two; nothing else needs to know.

**Voice:** Extracted to `@flow-state-dev/voice`, consumes the public emitter API.

**Net rewrite scope:**

- ~3,000–4,000 LOC deleted from `server/` (streaming reinvention, retry, parseFlowRoute, dispatcher chain, store coalescing).
- ~200–500 LOC added (Hono integration, emmett or `LISTEN/NOTIFY` wiring).
- Three new test surfaces (Hono integration, event-store integration, `streamSSE` integration); existing test corpus mostly survives because the public APIs are preserved.

This is a meaningful but bounded rewrite — it’s not “rip and replace.” The core abstractions (blocks, kinds, `BlockContext`, capabilities) are sound and stay put. What gets replaced is the plumbing.

## Library substitution table

| Custom subsystem | File(s) | LOC | Substitute |
| --- | --- | --- | --- |
| SSE frame encoder | `streaming/sse.ts` | 62 | `hono/streaming` |
| SSE heartbeat injector | `streaming/heartbeat.ts` | 87 | `hono/streaming` keepalive |
| LiveRequestStream + ReadableStream bridge | `streaming/live-stream.ts` | 114 | `hono/streaming` `streamSSE` |
| Retry loop | `execution/retry.ts` | 150 | `p-retry` |
| Concurrency limiter (TTS) | `voice/tts-pipeline.ts` | ~25 | `p-limit` |
| Promise timeout (TTS) | `voice/tts-pipeline.ts` | 9 | `p-timeout` |
| Path matcher for transports | `routes/createFlowApiRouter.ts:337-363` | 27 | `path-to-regexp` |
| Route table dispatcher | `routes/parseFlowRoute.ts` + `routes/http-handlers.ts` | ~700 | `hono` (`Hono` + `RegExpRouter`) |
| Resume cursor parser | `streaming/resume.ts` | 161 | trivial inline parsing (~30 lines) |
| Event log per-store | `*/request-store.ts` × 3 | ~500 across packages | `@event-driven-io/emmett`, Postgres `LISTEN/NOTIFY` |
| Active streams registry | `streaming/active-streams.ts` | 127 | Postgres `LISTEN/NOTIFY` (or delete entirely with event-store tail) |
| In-memory event ring buffer | `streaming/response-emitter.ts:506-643` | ~140 | event store tail |
| CAS retry orchestration | `stores/cas.ts` | 160 | `p-retry` + typed error |
| `SetResult` discriminated union | `stores/types.ts:113-118` | inline | throw `ConcurrentModificationError` |
| Coalesced snapshot writer | `*/request-store.ts` × 3 | ~150 | One shared utility, or only one store backend |
| Filesystem per-id write lock | `stores/filesystem/shared.ts:137-150` | 30 | delete; FS is dev-only |
| Voice TTS pipeline | `voice/` | 457 | extract to `@flow-state-dev/voice` |
| Block lifecycle observers (overlap with middleware) | scattered | ~200 | collapse into middleware |
| Vercel SSE shaping | `packages/vercel/` | 217 | keep as-is — it’s already minimal |

Approximate total of clearly-offloadable LOC: ~2,500. With the larger architectural moves (event-sourcing the items log, Hono routing), the savings stretch toward 4,000 — about a quarter of the package.

## Closing assessment

The server package is well-engineered for what it is — a self-contained runtime that doesn’t want to ship 30 transitive dependencies. The streaming subsystem and CAS layer are the load-bearing custom pieces, and both are correct. But correctness isn’t the question; the question is whether they’re paying their weight versus a battle-tested library.

For CAS: yes, the cost is roughly justified. Stock optimistic locking is what’s happening; the surface area is small.

For streaming: no, not really. There are 1,200+ lines of bespoke SSE + replay + heartbeat + active-stream registry that `hono/streaming` plus a Postgres event-log tail would replace in a couple hundred. The fact that two different `ReadableStream`s exist (`live-stream.ts` and the inline one in `stream-routes.ts:81-141`) for in-flight vs. late-attach consumers is itself a sign that the architecture is missing a unifying primitive — and that primitive is “just tail an event store.”

For routing: the `parseFlowRoute` if-chain is the most clearly suboptimal piece in the package and the cheapest to fix.

For voice: it doesn’t belong here.

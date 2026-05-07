# Design: Store-Driven Live Tail (FIX-569)

> The in-process active-streams registry moves into the store interface. Memory keeps an in-process bus; SQLite and filesystem poll; Postgres uses LISTEN/NOTIFY. Cross-process Postgres deployments gain live tail. Memory and SQLite users see no behavior change.

## 1. Problem

Today's live-tail is per-process. `streaming/active-streams.ts` is a `Map<requestId, LiveRequestStream>` populated synchronously at request start. The SSE GET handler reads from that map; if the request runs on instance A and the SSE client lands on instance B, the map miss falls through to the completed-request flat-string replay (if the request has finished) or 404s. Multi-instance Postgres deployments and serverless deployments with shared Postgres can't tail across instances.

The mechanism also carries a synchronous-registration race (the registry must be populated before `runAction` becomes async), a 5-minute stale-stream TTL that evicts long-running flows, and a duplicated per-process event ring on `ResponseEmitter`.

## 2. Approach: subscription owned by the store

Replace `getActiveStream(requestId)` with `store.request.subscribeToEvents(requestId, options)`. Each store implements the subscription appropriately:

- **Memory** — in-process bus that the `persistEvents` path fans out to.
- **SQLite / filesystem** — poll `getEvents(requestId, fromSequence)` on a fixed interval.
- **Postgres** — `LISTEN flow_events` on a dedicated `pg.Client` checked out from a separate pool. Notifications are signal-only (`${requestId}:${seq}`); the subscriber drains via `getEvents(id, lastSeen)`.

The subscription is an `AsyncIterableIterator<RequestStreamEvent>`. The catch-up phase yields events strictly greater than `fromSequence`; the live phase yields events as they're persisted. Termination is cooperative — `AbortSignal`, terminal request status, or a liveness timeout that synthesizes a `request.interrupted` event in-iterator.

`active-streams.ts` is deleted. `response-emitter.ts`'s external readers (`getEvents` / `getReplayableEvents` / `getLastEventId` / `getSequenceNumber`) go away. The client-side cursor filter in `resume.ts` collapses — the store's `getEvents(id, fromSequence)` does it server-side.

SSE wire format and `createFlowApiRouter()` shape are unchanged.

## 3. Interface contract

```ts
export interface SubscribeToEventsOptions {
  /** Subscriber's last-seen sequence number; 0 = no events seen. */
  fromSequence: number;
  /** Aborts the subscription cleanly when the SSE client disconnects. */
  signal?: AbortSignal;
  /**
   * If no events arrive within this window AND no terminal status is
   * persisted, the iterator yields a synthetic `request.interrupted` event
   * and closes. Default: 30_000ms (override via `LIVE_TAIL_LIVENESS_MS`).
   * Ignored for the in-memory store.
   */
  livenessTimeoutMs?: number;
  /**
   * Per-subscription bounded queue capacity. Overflow throws
   * `StoreSubscriptionError("backpressure_overflow")` into the iterator.
   * Default: 1000.
   */
  maxPendingEvents?: number;
}

export interface RequestStore {
  // ... existing methods ...

  getEvents(requestId: string, fromSequence?: number): Promise<RequestStreamEvent[]>;

  subscribeToEvents(
    requestId: string,
    options: SubscribeToEventsOptions,
  ): AsyncIterableIterator<RequestStreamEvent>;
}
```

`fromSequence` is required on the options object (subscribers with no cursor pass `0`). Optionality would make it easy to silently re-receive the entire log on reconnect. `getEvents`'s `fromSequence` is optional for backward compatibility with the completed-request replay path.

`AsyncIterableIterator` is the simplest possible introduction — there's no async-iter idiom in the codebase yet. The "close" path is `signal.abort()`, matching how `stream-routes.ts` already propagates client disconnects through the rest of the SSE pipeline.

## 4. Per-store implementations

### 4.1 Memory bus

`InMemoryRequestStore` adds a `Map<requestId, Set<(event) => void>>` of subscriber callbacks. `persistEvents` appends to the array and fans out. `subscribeToEvents` is an async generator: yield catch-up via `getEvents(id, fromSequence)`, register a callback that pushes to a per-subscription `BoundedQueue`, drain the queue in a loop, terminate on terminal event or abort.

The bus is the **only** push path for memory deployments. `addEventObserver` (used by TTS) and `subscribeToEvents` (used by SSE) are independent consumers of the same emitter chain. This is the **single-SSE-writer invariant** — TTS observers read the stream, they don't write to it.

`livenessTimeoutMs` is **ignored** for memory. There's no cross-process death scenario; the originating process either has the data or doesn't.

### 4.2 SQLite / filesystem polling

Both stores poll `getEvents(requestId, lastSeen)` on a fixed interval (default 100ms, configurable via store factory option). The implementation borrows the shape of `stale-request-sweeper.ts` — `inFlight` guard, `disposed` flag, `unref`'d timer.

Filesystem keeps the existing `<requestId>.events.json` layout. We deliberately do **not** migrate to the FIX-558 NDJSON+roster pattern — request events are a curated subset (smaller per-request volume than trace events), and a layout migration would be a breaking on-disk change with no upgrade path for in-flight requests at deploy time. NDJSON is documented as the model for *future* high-volume per-request append paths.

`fs.watch` is not used. It's unreliable across platforms and editor save patterns; polling is honest and predictable.

### 4.3 Postgres LISTEN/NOTIFY

`persistEvents` issues `pg_notify('flow_events', $1::text)` with payload `${requestId}:${seq}` **inside** the same transaction as the `INSERT`. If the insert rolls back, the notification is suppressed (Postgres NOTIFY semantics). Single global channel `flow_events`. Signal-only payload — no event data.

`subscribeToEvents` checks out a `pg.Client` from a dedicated `liveTailPool`, issues `LISTEN flow_events`, and waits on a dirty-bit promise. On `notification`, the listener filters by `requestId` and sets the dirty bit. The drain loop reads `getEvents(id, lastSeen)` once per dirty-bit cycle — N notifications collapse into one query (the **Notifier Pattern** per Brandur Leach). Liveness timeout governs writer-death detection; on timeout the iterator yields a synthetic `request.interrupted`.

Why a dedicated pool: reusing the main query pool would pin one connection per concurrent subscriber, starving query traffic. `liveTailPool` defaults to a fresh `Pool({ connectionString, max: ENV.LIVE_TAIL_POOL_MAX ?? 10 })`; callers can pass an explicit Pool for fleet-wide tuning, or `liveTailPool: null` to disable LISTEN entirely (falls back to polling).

Why a single global channel: per-request `LISTEN`/`UNLISTEN` is its own SQL round-trip; at hundreds-to-thousands of in-flight requests the churn becomes meaningful. The Postgres scaling ceiling on NOTIFY is per-volume (global commit lock), not per-channel-count — Recall.ai's [postmortem](https://www.recall.ai/blog/postgres-listen-notify-does-not-scale) is the reference point.

Why signal-only payload: Postgres NOTIFY's payload limit is **8000 bytes** (NAMEDATALEN-derived, not configurable). A `${requestId}:${seq}` payload is ~50 bytes, well clear, and treats notifications as wakeups rather than data — survivable across missed wakeups via the catch-up SELECT.

Connection resilience: `client.on("error")` triggers a bounded reconnect loop (5 attempts, 100ms → 1.6s exponential backoff). On success: re-`LISTEN`, then `getEvents(id, lastSeen)` to close the gap. On exhaustion: the iterator yields `StoreSubscriptionError("listen_unrecoverable")`.

### 4.4 PGlite fallback

`@electric-sql/pglite` does not support LISTEN/NOTIFY. When `liveTailPool` is absent (PGlite or pool-less deployments), `subscribeToEvents` polls on the same shape as SQLite. PGlite remains a supported `QueryExecutor`.

## 5. Liveness timeout and synthetic `request.interrupted`

If no events arrive within `livenessTimeoutMs` AND no terminal request status is persisted, the iterator yields an in-memory `request.interrupted` event (sequence number `lastSeen + 1`) and closes. The synthetic event is **not** persisted to the store — it represents the subscriber's view of the originating process's apparent death, not durable state. The originating process, if alive, may continue to persist events that future subscribers will see.

`request.interrupted` already exists as a `RequestStatus` and is part of the `RequestStreamEvent` union via `request.${RequestStatus}`. The wire encoding is unchanged.

Default 30s applies to SQLite, filesystem, and Postgres. Override via `LIVE_TAIL_LIVENESS_MS`. Ignored for memory.

## 6. Hidden invariants preserved

- **First-event persistence** replaces synchronous active-streams registration. The GET handler routes to `subscribeToEvents` once a request record or first event exists in the store. Until then, the existing 500ms × 6 record-poll loop covers the serverless POST/GET race.
- **`content.delta` cross-process gap.** Deltas are not persisted (FIX-479). Memory subscribers receive deltas; cross-process subscribers (SQLite/Postgres/filesystem) snap to the next persisted `item.added` / `item.done` / `content.added` / `content.done`. Documented limitation, not a bug.
- **`addEventObserver` carve-out.** TTS subscribes via `response.addEventObserver`. Untouched by this change. Two independent consumers of the emitter push chain; no shared wire state.
- **Single-SSE-writer.** TTS observers read; only the SSE wire writes. The conformance test asserts that an SSE-style subscription and a TTS-style observer both receive every event exactly once, with no double-emit.
- **FIX-399 persist-before-wire** durability barrier is unchanged. Events still persist before they fan out to subscribers in the memory bus.
- **`?include=trace`** query-parameter handling stays in `stream-routes.ts`. FIX-506 owns its rename; this change coordinates the conflict surface but does not merge it.

## 7. Migration

File-by-file deletion / trim order, executed in PR-2 step 10:

1. `streaming/active-streams.ts` — DELETE (~128 LOC).
2. `streaming/response-emitter.ts` — TRIM `getEvents` / `getReplayableEvents` / `getLastEventId` / `getSequenceNumber` external readers. Keep events array, observer list, durability barrier, `addEventObserver`, `enforceBufferLimit`. The buffer remains load-bearing for memory deployments where the in-process bus replays from it.
3. `streaming/resume.ts` — TRIM `replayRequestEvents`. `resolveRequestReplayCursor` is unchanged.
4. `transports/host/createInboundTransportHost.ts` — TRIM `registerStream` / `removeStream` / `canRegisterStream` calls.
5. `routes/createFlowApiRouter.ts` — TRIM `configureActiveStreamRegistry` invocation.
6. `routes/http-handlers.ts` — TRIM `configureActiveStreamRegistry` setup.
7. `execution/request-recovery.ts` — TRIM `registerStream` / `removeStream` calls.

The `staleStreamTtlMs` mechanism is removed entirely. Long-running flows with idle gaps greater than 5 minutes are no longer at risk of registry eviction; cross-process liveness governs only the cross-process subscription, not the originating process.

## 8. Scaling ceiling

Recall.ai's "Postgres LISTEN/NOTIFY does not scale" postmortem documents the failure mode: the global commit-serialization lock collapses throughput under tens of thousands of simultaneous writers. We adopt LISTEN/NOTIFY now — the framework has zero in-the-wild Postgres-backed multi-instance deployments today, and the ceiling is many product cycles away — but document the boundary in the Postgres README. When operators outgrow it, the next move is Redis pub/sub or NATS JetStream behind the same `subscribeToEvents` interface.

## 9. References

- FIX-511 streaming-internals refactor — `createSSEStream` (PR #240).
- FIX-558 trace store filesystem layout (NDJSON + roster). Deliberately not adopted here.
- [pg-listen](https://github.com/andywer/pg-listen) — canonical reference for `pg.Client` reconnection.
- Brandur Leach, ["The Notifier Pattern"](https://brandur.org/notifier).
- [Recall.ai LISTEN/NOTIFY postmortem](https://www.recall.ai/blog/postgres-listen-notify-does-not-scale).
- [Postgres SQL-NOTIFY docs](https://www.postgresql.org/docs/current/sql-notify.html).

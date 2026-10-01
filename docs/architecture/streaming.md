# Streaming

The event types, envelope, content model and resume API are user-facing: [SSE Protocol](../../apps/docs/docs/streaming/items.md), [Streaming overview](../../apps/docs/docs/streaming/overview.md), [Connection Resilience](../../apps/docs/docs/server/connection-resilience.md). Item types, visibility and persistence are in [Items](./items.md). This page holds the ordering, durability and security contracts behind the stream.

There are two streams with different contracts:

| | Request stream | Session stream |
|---|---|---|
| Follows | one request | every request in a session, plus its unfinished runs |
| Order | `sequence_number`, monotonic | none across requests; clients sort |
| SSE `id` / cursor | `${requestId}:${sequence_number}`; resume with `Last-Event-ID` or `starting_after` (wins if both) | no `id`; cursor is the event's `at` (server time), resumed with `?since=` |
| Dedupe | stream identity + sequence | `(requestId, item.id)` |

## Items vs events

Two data sets, persisted through separate methods (`persistItems` / `persistEvents`):

- **Items** on `RequestRecord` are what the request *produced*: load-bearing, read back for history and context. Transient items are stripped.
- **Events** are the ordered SSE log, transient items included. **The app never reads them for business logic**; only SSE resume and devtool replay do. So they may live on another backend, be pruned earlier, or be disabled in production. Observability-only types (e.g. `state_snapshot`) should be `transient: true` so they ride the event log without bloating the record.

### Event lifetime is bounded by the request's (security)

Request ids can be caller-supplied, so a freed id can be taken by a later request, possibly another user's, and leftover events would replay into its stream.

- `RequestStore.delete(id)` must remove every child under the id (events, `runOnce` results) **before** the record.
- Retention doesn't evict a request until `finalizedAtMs` is written (after `onFinished`) **and** twice the live-tail liveness timeout has passed, and never while it's in the active registry. The terminal event and `onFinished` come after the record turns `completed`, and a live tail would otherwise keep polling a freed id.
- **Terminal replay:** read the record, check ownership, read events; if the record is no longer the same incarnation after that read, answer as for an unknown request.
- **Live tail:** the route passes `subscribeToEvents` an `isStillAuthorized` fence comparing incarnations. Every store calls it after each read that returned events and before yielding any; on failure it yields none of that batch and ends as unknown. **A custom `RequestStore` must honour it** (`pollEvents` and `isBatchStillAuthorized` already do). Cost: one record read per non-empty batch. The memory store also ends live streams on delete.

### Durability ordering

Replayable events are **persisted before they reach the wire**: the emitter awaits `flushEvents` after each enqueue, then writes the SSE frame. Otherwise a client could see `sequence_number = N` while the log stops below `N`, a silent gap on reconnect. Persist failures surface via `onPersistError` and rethrow from the emitter, so the producing block fails loudly.

Not replayable, and so skipping the barrier: `ping`, `debug`, `content.delta`, `content.audio.delta`.

| Boundary | On the event log | Mutates `request.items` |
|---|---|---|
| `item.added` | yes | yes |
| `content.added` | yes | no |
| `content.delta` | **no** | yes, accumulates in place |
| `content.audio.delta` | **no** | no; the durable form is the final `OutputAudioContent` |
| `content.done` | yes | no |
| `item.done` | yes | yes, authoritative |

Why: per-token disk round-trips under concurrent streams (e.g. a supervisor with three streaming workers) serialise every delta and the request appears to hang. Text is instead checkpointed through a coalesced `persistItems` driven by `onItemUpdate`, so a reconnect or page-load bootstrap shows the latest accumulated text and `item.done` supersedes it. Per-chunk audio would multiply the log 10–100× for nothing the snapshot doesn't cover; reconnecting clients hear a gap, as with every comparable system.

## Store-driven live tail

`RequestStore.subscribeToEvents(requestId, { fromSequence, signal })` owns catch-up plus live in one iterator; there is no in-process active-streams registry. It terminates on abort, terminal status, or a liveness timeout that yields a synthetic `request.interrupted` (default 30 s, `LIVE_TAIL_LIVENESS_MS`).

| Backend | Strategy |
|---|---|
| Memory | in-process bus fanned out from `persistEvents` |
| SQLite, filesystem, Postgres without `liveTailPool` | poll `getEvents(id, lastSeen)` (100 ms; Postgres fallback 250 ms) |
| Postgres with `liveTailPool` | `LISTEN flow_events` on a dedicated client; payload is signal-only `${requestId}:${seq}`, drained once per dirty cycle. `pg_notify` runs in the insert's transaction, so no signal for an uncommitted event |

- Cross-process subscribers never see `content.delta` (not persisted); they snap to the next persisted snapshot. Documented limitation.
- TTS reads via `response.addEventObserver`, a separate consumer of the emitter chain; only the SSE wire writes. Conformance asserts each event reaches both exactly once.

## Attach contract

In-process: the POST returns an inline SSE `200`. External dispatch: `202 { requestId }`, then `GET /requests/:id/stream`.

**Enqueue-time discoverability.** A worker in another process would otherwise register the request only when it starts, so an early GET would 404. `createInboundTransportHost.dispatch` writes the `activeRequests` entry and an `in_progress` record (`createInitialRequestRecord`, the same builder the worker uses, which then adopts it) **before** handing off. Resume re-dispatches through `host.dispatch` and is pre-registered the same way. Tradeoff: the heartbeat clock starts at enqueue, so a queue backed up past the stale threshold (default 30 s) gets the entry swept and marked interrupted; the worker resets the heartbeat when it claims.

## Client correctness

- On `request.completed`, **refetch the state snapshot**. The stream is live; the snapshot is authoritative.
- Treat `state_change` / `resource_change` as invalidation signals.

## Session stream

`GET /sessions/:sessionId/stream` (`useSession(id, { live: true })` → `createSessionSSEClient`). Events: `session.item` (`requestId` + one finished item, filtered like the snapshot), `session.runs` (every unfinished run; on open and on change), `ping`. Envelope `{ stream: "session", sessionId, at, type }`. No sequence number because a session has many writers, often on other servers, and no single log to number.

**Resume by time, with overlap and dedupe:**

- Without `since`, the first read reaches back about a minute.
- **From a snapshot:** `GET /sessions/:id/state` carries `at` = when its read *began*; handing that back as `since` misses nothing however slow the snapshot was. The snapshot is paged by offset, so a removal or re-emitted keyed item between pages shifts later pages: `useSession` starts each page on the last item already read and restarts the read if it's gone, failing after five tries rather than showing partial history as whole.
- **Overlap:** each read reaches back 5 s before the cursor (other servers' clocks, write latency). Within a connection each copy is sent once; a re-emitted keyed item is a later copy and is sent again; after reconnect copies may repeat.
- **The cursor never runs ahead of delivery:** `at` advances to a read's start only after that read's items are all sent.
- **Dedupe by `(requestId, item.id)`, never `item.id`**: a keyed item's id comes from its key, so two requests can share it.
- **One order:** `ts`, `itemIndex`, `requestId`, `id` (`compareItemOrder` in contracts), used by both the snapshot and client merges so live and reload agree.

**Client merge rules** (a view can get one item from the request stream, session stream and snapshots, in any order):

- **A finished copy stands.** Never replace it with an unfinished copy, or with a finished one stamped earlier (`ts`, then `itemIndex`). Take no deltas for it, and no content part at an index it already has; a part appended after finish (e.g. synthesized audio) still lands.
- **Snapshots settle by request order, not time.** A live copy is kept until a snapshot *requested after it arrived* lands. Of two snapshots, the later-requested wins and the earlier is dropped whole (with its detail read and its failure). A landing snapshot clears only the error an earlier failed snapshot set. A session switch retires all in-flight reads.
- The optimistic user message is replaced by the server's, from whichever stream brings it first.

**Ends:** the server closes after at most 15 minutes and the client reconnects. 401, 403, 404, 409 (`migration-required`) and 501 stop the client for good without an error; anything else retries with backoff (`onReconnecting` reports attempts since the last delivery). Once runs were named, a failed reconnect or stop keeps the rows and raises `childSessionsStale` (the routine 15-minute reconnect doesn't).

**One session, the one checked (security).** The stream follows only the session checked at open: requests under its owner, org and flow, and only its owner's runs. **After every read, before sending, the server re-reads the session**; if deleted or the id now holds another (`isSameSession`: tenant, owner, org, flow instance, `createdAt`, lineage, not version), the connection ends and nothing from that read is sent. A client following a snapshot sends its `sessionCreatedAt` as `?session_created_at=` and is refused with 404 once the id holds another. Same rule for every read keyed by an id an earlier read found: request items count only while `isSameRequest` holds, and a named run is dropped once its child is gone or replaced.

**Cost and teardown:** about one store read per second per connection, using filters every adapter has; each read costs what's running now, not history. After the connection ends, no further store read happens, even mid-read. The route holds the caller's `Request` (not just its signal), because on Node a request's signal only hears its source's abort while the request object is alive, and some hosts report disconnect only that way.

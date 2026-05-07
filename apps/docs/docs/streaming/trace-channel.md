---
title: Trace Channel
---

# Trace Channel

The SSE stream carries two kinds of items. Production items are what your user sees: messages, components, statuses, errors. Trace items are observability data: which block ran, the resolved generator prompt, state snapshots, router decisions. Both flow on a single endpoint; trace items are server-side filtered out by default.

## What's on each side

| Channel | Item types | Who sees them |
|---|---|---|
| Production (default) | `message`, `reasoning`, `tool_output`, `component`, `container`, `source`, `status`, `error`, `state_change`, `resource_change` | Every client. |
| Trace (opt-in) | `block_trace`, `router_decision`, `state_snapshot`, `block_debug` | DevTool, opted in via `?include=trace`. |

Trace items are stamped with `agentType: "trace"` at emit time. The visibility resolver short-circuits anything stamped that way to `{ client: false, history: false }`.

## Subscribing

```ts
// Production stream — what your end-user UI subscribes to.
new EventSource("/api/flows/myFlow/requests/req_abc/stream");

// Trace stream — what the DevTool subscribes to.
new EventSource("/api/flows/myFlow/requests/req_abc/stream?include=trace");
```

The `?include=trace` parameter doesn't bypass any filtering — it widens the production filter to include the four trace types. There's no second SSE endpoint and no separate transport.

## Emitting trace items from a block

Framework auto-emitters use a typed namespace:

```ts
ctx.emit.trace.blockOutput(item);     // block start / completion / failure
ctx.emit.trace.routerDecision(item);  // router selection
ctx.emit.trace.stateSnapshot(item);   // sequencer state at step boundary
ctx.emit.trace.blockDebug(payload);   // resolved prompt / model / tools
```

User code rarely calls these directly. They exist so the framework's four auto-emission sites flow through one path that stamps `agentType: "trace"` and persists to the trace store in one shot.

## Trace retention

Trace events live in `stores.traces`, a new entry on `StoreRegistry` that's independent of `stores.request`. The retention policy that GCs `RequestRecord`s leaves the trace store alone, so the DevTool can replay traces from a completed request even after its request record is gone.

### Backends

Three implementations ship with the framework. `createInMemoryStores`, `createFilesystemStores`, and `createSQLiteStores` each wire a paired trace store automatically — no separate config step.

- **In-memory** (`createInMemoryTraceStore`). Per-request ring buffer. FIFO over distinct request IDs plus a per-request `maxBytesPerRequest` soft cap to bound heap usage. Events are gone when the process exits.
- **Filesystem** (`createFilesystemTraceStore`). Append-only `.ndjson` files under `{rootDir}/traces/`. A `_roster.json` file records insertion order for FIFO eviction. Survives process restarts. Used by `fsdev dev` and by kitchen-sink with `STORE_TYPE=filesystem`.
- **SQLite** (`createSQLiteTraceStore` from `@flow-state-dev/store-sqlite`). Two tables, `trace_events` and `trace_request_roster`, joined by `ON DELETE CASCADE` so eviction is one row delete. Survives restarts; runs in the same database as the request store.

Filesystem layout for reference:

```
.fsdev/data/traces/
  _roster.json
  req_abc.ndjson
  req_def.ndjson
```

Each `.ndjson` file holds one trace event per line. Filenames are URL-encoded so arbitrary request IDs round-trip safely.

### Local development

`fsdev dev` and kitchen-sink with `STORE_TYPE=filesystem` both wire the filesystem trace store. When `NODE_ENV=development`, the registry factory raises the `maxRequests` cap to 1000 so a multi-request iteration session doesn't silently evict its own history. Trace data survives `fsdev dev` restarts: kill the server, run `fsdev dev` again, open the DevTool against an earlier request — the trace tree replays.

To override the cap explicitly:

```ts
import { createFilesystemStores } from "@flow-state-dev/server";

const stores = createFilesystemStores({
  rootDir: ".fsdev/data",
  traceStore: { maxRequests: 200 }
});
```

The override always wins, in either direction.

### Production

Outside of `NODE_ENV=development`, all three factories default to `maxRequests: 50` — enough to debug a recent failure without unbounded growth. Filesystem and SQLite both survive process restarts; in-memory does not. Pass `traceStore: { maxRequests }` to widen or narrow the window.

## See also

- [Items](./items) — production-stream item types.
- [Emitting items](./emitting-items) — how blocks produce items.

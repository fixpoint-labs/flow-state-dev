---
title: Trace Channel
---

# Trace Channel

The SSE stream carries two kinds of items. Production items are what your user sees: messages, components, statuses, errors. Trace items are observability data: which block ran, the resolved generator prompt, state snapshots, router decisions. Both flow on a single endpoint; trace items are server-side filtered out by default.

## What's on each side

| Channel | Item types | Who sees them |
|---|---|---|
| Production (default) | `message`, `reasoning`, `block_tool_output`, `component`, `container`, `source`, `status`, `error`, `state_change`, `resource_change` | Every client. |
| Trace (opt-in) | `block_output`, `router_decision`, `state_snapshot`, `block_debug` | DevTool, opted in via `?include=trace`. |

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

Defaults:

- **In-memory store**: `maxRequests: 50`, `maxBytesPerRequest: 5 MB`. FIFO eviction.
- **SQLite store**: `maxRequests: 50`. Available via `@flow-state-dev/store-sqlite`.

Both are configurable. A bounded buffer is the same shape Redux DevTools uses (`maxAge: 50`) — keep the last N traces, drop the rest.

## See also

- [Items](./items) — production-stream item types.
- [Emitting items](./emitting-items) — how blocks produce items.

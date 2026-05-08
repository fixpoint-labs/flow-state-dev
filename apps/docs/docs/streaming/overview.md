---
sidebar_position: 1
---

# Overview

Every artifact produced during block execution is an **item**. A chat message, a tool call result, a progress indicator, a custom UI component — each one is an item that streams to connected clients in real time and (in most cases) gets persisted.

Items belong to **requests**, and requests belong to **sessions**. When a user sends a message, the framework creates a request, executes the action's root block, and the items produced during that execution are stored on the request record. The session collects items from all its requests and exposes them as a single timeline — so you can access them conveniently as one collection, but each item is tied to the request that produced it.

Items serve three purposes:

1. **Streaming output** — clients receive items over SSE as blocks execute
2. **Session history** — persisted items accumulate across requests, forming the conversation log
3. **LLM context** — some item types feed into conversation history for future model calls

## The items you'll use most

Most of the time you'll work with three emit methods. Generators call these automatically for their own output, but you can also call them explicitly from any block:

| Method | What it creates | LLM History | Transient |
|--------|----------------|:-----------:|:---------:|
| `ctx.emitMessage(text)` | A chat message visible to the user | ✓ | — |
| `ctx.emitComponent(name, data)` | A custom UI component with structured data | — | — |
| `ctx.emitStatus(message)` | A progress indicator | — | Always |

These are covered in depth in [Emitting Items](/docs/streaming/emitting-items).

## What happens automatically

You don't need to emit most item types yourself. The framework handles them:

- **Generators** automatically emit `message` and `reasoning` items as the model streams
- **Tool calls** produce `tool_output` items with the tool name, input, and result
- **State mutations** emit `state_change` notifications so the client stays in sync
- **Resource mutations** emit `resource_change` notifications
- **Errors** produce `error` items when the request itself fails. Failures inside `.work()` background tasks don't produce a public item; the failed `block_trace` (visible to the DevTool via the trace channel) is the only signal.

## Visibility

The reference table below shows where each item type appears by default. Two things to note:

- **Client** means the client receives and can render it. Most items are client-visible.
- **LLM History** means the item enters conversation history for future model calls. Only content-bearing types (`message`, `reasoning`, `tool_output`) do this. Other client-visible types like `component` and `status` don't feed into model context — they're purely for the UI.

### How visibility is resolved

Visibility is a pure function of `(item.type, item.agentType)` computed by `resolveItemVisibility()`:

- **Conversational types** (`message`, `reasoning`, `tool_output`) inherit visibility from the producing generator's `agentType`.
- **Structural types** (`component`, `status`, `block_trace`, etc.) have fixed per-type visibility.
- An `agentType: "trace"` item is always `{ client: false, history: false }` regardless of type — trace is observability-only.

### Generator identity controls conversational visibility

Generators declare an identity via `agentType`. The framework uses that identity to route the auto-emitted messages and reasoning:

```ts
// User-facing agent — on the client stream, in conversation history.
const chatbot = generator({ agentType: "primary", /* ... */ });

// Sub-agent — visible to the client (live observability), but its output
// does NOT enter history.
const worker = generator({ agentType: "sub", /* ... */ });

// Devtool-only observer — not on the client stream, not in history.
const memoryObserver = generator({ agentType: "trace", /* ... */ });

// No agentType → the generator produces no auto-emitted items. Its typed
// `block_trace` still flows to parents via graph edges.
const classifier = generator({ outputSchema: z.enum(["A", "B"]), /* ... */ });
```

See [Generator identity](../streaming/items#generator-identity) for the full model — multi-peer agents, collaborative vs. isolated parallel work, and the `selectForContext` escape hatch for custom prompt context.

### Handler-emitted items

Handlers don't declare `agentType` — but their emit helpers accept optional identity:

```ts
ctx.emitMessage("Analysis complete.");
// Implicit agent-equivalent visibility: on the client, enters history.

ctx.emitMessage("Debug observation", { agentType: "trace" });
// Observability-only: devtool sees it, users and the LLM don't.
```

## Persistence

Items are persisted by default. A few types are **transient** — they stream to clients during execution but are never written to the session store. When someone reconnects or opens a past session, transient items won't appear.

The reference table below marks which types are transient. You can also make any block's output transient by setting `transient: true` on the block config.

## Accessing items

Each item lives on the request that produced it, but the session aggregates items from all requests into a single timeline. When a user sends a second message, the session already holds every item from the first request. Generators use this aggregated view to build conversation history.

Three views for accessing session items:

- **`items.all()`** — everything in the session
- **`items.client()`** — items intended for the client UI (excludes trace items)
- **`items.history()`** — items formatted for the model, with optional token limiting:

```ts
const history = ctx.session.items.history({ limit: { tokens: 20_000 } });
```

## Item lifecycle

Items go through three phases:

1. **Added** — item exists with `status: "in_progress"`
2. **Streaming** — for messages and reasoning, text arrives in chunks via content deltas
3. **Done** — item finalized as `"completed"`, `"incomplete"`, or `"failed"` (terminal, immutable)

### Updating an item mid-flight

For items whose non-text fields evolve over their lifetime (a long-running container populating its `payload`, a trace block recording input then output then result), the wire carries an `item.updated` event:

```
event: item.updated
data: {"itemId":"item_42","patch":{"status":"completed","payload":{...}}}
```

The patch is a **shallow top-level merge** — each top-level key in `patch` replaces the existing value at that key on the consumer's tracked item. Nested updates require re-supplying the full nested object. Identity-invariant keys (`id`, `type`, `provenance`, `agentType`, `transient`) are stripped both server-side and client-side and never apply.

Producers should prefer `emitItemUpdated` over re-emitting `item.added` + `item.done` when fields evolve; consumers see fewer flicker frames and the wire stays compact. See [Emitting Items](/docs/streaming/emitting-items#updating-an-item-after-emission) for the producer-side helper.

## All item types

For reference, here's the complete registry:

| Type | What it is | Client | History | Transient |
|------|-----------|:-------:|:-------:|:---------:|
| `message` | Chat message (user or assistant) | ✓ | ✓ | — |
| `reasoning` | Model thinking tokens | ✓ | ✓ | — |
| `tool_output` | Tool invocation result | ✓ | ✓ | — |
| `component` | Custom UI component | ✓ | — | — |
| `container` | Groups child items for visual layout | ✓ | — | — |
| `source` | URL reference from web search, etc. | ✓ | — | — |
| `status` | Progress indicator | ✓ | — | Always |
| `state_change` | State mutation notification (scope: `request` / `session` / `user` / `org` / `block_instance`) | ✓ | — | Production |
| `resource_change` | Resource mutation notification | ✓ | — | Always |
| `error` | Terminal request error | ✓ | — | — |
| `block_trace` | Execution record | — | — | — |
| `router_decision` | Route selection record | — | — | — |
| `state_snapshot` | Sequencer state snapshot | — | — | Always |

## Wire-level heartbeat

`@flow-state-dev/server` injects `: ping\n\n` SSE comment frames into every live and GET-attach response at a configurable cadence (default 15 s). They keep NAT and proxy idle timeouts from closing the connection and give clients a wire-level signal independent of any specific event. Configure via `createFlowApiRouter({ defaultSseHeartbeatMs })` or per-flow `defineFlow({ request: { sseHeartbeatMs } })`. See [Connection Resilience](/docs/server/connection-resilience) for how heartbeats fit alongside the watchdog and stale-request sweeper.

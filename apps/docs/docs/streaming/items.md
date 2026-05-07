---
sidebar_position: 3
---

# SSE Protocol

Items stream to clients over SSE as blocks execute. Every event has a sequence number, so clients can disconnect and resume without losing anything. This page covers the SSE protocol, event format, resume semantics, and client integration.

## How it works

When a client invokes an action, the server starts executing blocks and streaming results immediately:

```
POST /api/flows/:kind/actions/:action  -->  202 { requestId }
GET  /api/flows/:kind/requests/:requestId/stream  -->  SSE events
```

Events flow in real time:

```
event: item.added
data: { "item": { "type": "message", "role": "assistant", "status": "in_progress" } }

event: content.delta
data: { "itemId": "msg_1", "delta": { "text": "Hello" } }

event: content.delta
data: { "itemId": "msg_1", "delta": { "text": " there!" } }

event: item.done
data: { "item": { "type": "message", "role": "assistant", "status": "completed" } }

event: request.completed
data: { "status": "completed" }
```

The client assembles content progressively from deltas. Text appears token by token. When the request completes, the client refetches the state snapshot for the authoritative final state.

## Stream events

| Event | Meaning |
|-------|---------|
| `item.added` | New item in the stream. Contains the full item payload with `status: "in_progress"`. |
| `content.delta` | Text chunk appended to a streaming item (messages, reasoning). |
| `content.added` | New content part added to an item (e.g., audio part on a message). |
| `content.done` | A content part finalized. |
| `item.done` | Item finalized with terminal status. |
| `request.completed` | All blocks finished. Request succeeded. |
| `request.failed` | Request failed with a terminal error. |

## Resume and replay

Every event has a **sequence number**. When a client disconnects — network blip, tab backgrounded, mobile app suspended — it can resume from exactly where it left off:

```
GET /api/flows/:kind/requests/:requestId/stream
Last-Event-ID: 42
```

The server replays all events after sequence 42, then switches to live streaming.

You can also use the `starting_after` query parameter:

```
GET /api/flows/:kind/requests/:requestId/stream?starting_after=42
```

Both approaches produce the same result. `Last-Event-ID` is the standard SSE header. `starting_after` is a query parameter alternative for environments where setting headers isn't convenient.

### Streaming-text resume

`content.delta` events are not replayed. Streaming text on a reconnect snaps to the most recent persisted snapshot of the message item, then continues from the next live delta. The exact token sequence isn't replayed, and the eventual `item.done` payload supersedes with the final text. Completed messages always replay exactly.

Why: streaming a message token-by-token to disk would require a disk round-trip per token. Multiple concurrent streams would serialize behind a single per-request queue and the request would freeze. Snapping to the latest snapshot keeps the live experience smooth and bounds disk I/O to the natural write rate.

## Generator identity

Every auto-emitted item from a generator is stamped with the producing generator's `agentType` and `agentName`. Identity governs conversational-item visibility and gives the client and downstream tooling enough information to route and render each item appropriately.

### The three identities

| `agentType` | On client stream | In conversation history | In devtool |
|-------------|:---:|:---:|:---:|
| `"primary"` | ✓ | ✓ | ✓ |
| `"sub"` | ✓ | — | ✓ |
| `"trace"` | — | — | ✓ |
| *unset* | no auto-emission at all — only `block_trace` flows via graph edges |

A generator with no `agentType` is a pure transformer: it runs the model, returns typed `block_trace`, and produces no session items. Useful for structured-output generators that feed downstream blocks silently.

### Multi-peer agents

Two generators with `agentType: "primary"` and distinct `agentName`s can coexist in the same session. Both see the user's messages and each other's messages via `history: true`:

```ts
const planner = generator({ name: "planner", agentType: "primary", agentName: "planner", /* ... */ });
const executor = generator({ name: "executor", agentType: "primary", agentName: "executor", /* ... */ });
```

### Parallel sub-agents — collaborative vs. isolated

`agentName` chooses whether parallel workers collaborate or stay isolated:

```ts
// Collaborative: all instances share one identity.
generator({ agentType: "sub", agentName: "researcher", /* ... */ });

// Isolated: each instance unique. selectForContext can address them individually.
(id) => generator({ agentType: "sub", agentName: `researcher-${id}`, /* ... */ });
```

### Custom context via `selectForContext`

`session.items.history()` is the ambient conversation-history view — user messages + `"primary"`-typed conversational items. For anything else (long-running sub-agents pulling their own prior outputs, coordinators aggregating peer outputs, debugging flows that want trace items), use `selectForContext`:

```ts
const researcher = generator({
  name: "researcher",
  agentType: "sub",
  agentName: "researcher",
  context: (input, ctx) => {
    const priorFindings = ctx.session.items.selectForContext({
      agentName: "researcher",
      itemTypes: ["message"],
      limit: 10,
    });
    return `<past-findings>${formatAsText(priorFindings)}</past-findings>`;
  },
});
```

`selectForContext` returns raw `SessionItem[]` with no conversation-history filtering. It respects `includeTransient`, `itemTypes`, and the `agentType`/`agentName` query fields.

### React renderer behavior

The default `<ItemsRenderer>` filters `agentType: "sub"` items from the rendered list. Opt in via the `showSubAgents` prop to surface them inline, or use `session.getItemsByAgent(name)` for per-agent side panels. Trace items are filtered at the SSE transport layer and never reach the client.

## React integration

On the React side, streaming is automatic. The `useSession` hook connects to the SSE stream, processes events, and updates items reactively:

```tsx
const session = useSession(sessionId);

// Items update in real time as the stream delivers them
{session.items.map((item) => (
  <ItemRenderer key={item.id} item={item} />
))}

// Filtered views
{session.messages.map(...)}        // Only message items
{session.blockOutputs.map(...)}    // Only block outputs

// Status
{session.isStreaming && <Spinner />}
```

No manual stream management. No event listeners. No reconnection logic. The hooks handle all of it.

## Client SDK

If you're not using React, the client SDK provides direct SSE access:

```ts
import { createClient } from "@flow-state-dev/client";

const client = createClient({ flowKind: "my-app", userId: "user_1" });

// sendAction returns a requestId, then connect to the stream
const { requestId } = await client.sendAction("chat", { message: "Hello" });
```

See [Client Overview](/docs/client/overview) for the full client API.

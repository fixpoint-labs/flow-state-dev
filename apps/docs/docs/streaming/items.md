---
sidebar_position: 2
---

# Streaming

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

The server replays all events after sequence 42, then switches to live streaming. No data loss. No duplicate events. No application-level retry logic needed.

You can also use the `starting_after` query parameter:

```
GET /api/flows/:kind/requests/:requestId/stream?starting_after=42
```

Both approaches produce the same result. `Last-Event-ID` is the standard SSE header. `starting_after` is a query parameter alternative for environments where setting headers isn't convenient.

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

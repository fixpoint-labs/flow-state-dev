---
sidebar_position: 6
---

# Streaming

Most frameworks bolt streaming on as an afterthought — raw text over a WebSocket, maybe some SSE. flow-state.dev makes streaming structural. Instead of raw text, the framework streams **typed items**: messages, tool calls, state changes, reasoning, custom components. Each item has a lifecycle and a sequence number, so clients can disconnect and resume without losing a single event.

## How it works

When a client invokes an action, the server starts executing blocks and streaming results immediately:

```
POST /api/flows/:kind/actions/:action  -->  202 { requestId }
GET  /api/flows/:kind/requests/:requestId/stream  -->  SSE events
```

Events flow in real time as blocks execute:

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

## Item types

Every streamed event is a typed item. This means the client always knows what it's rendering:

| Type | What it is |
|------|-----------|
| `message` | Chat message (user or assistant) with content parts |
| `reasoning` | Model reasoning/thinking tokens |
| `block_output` | Structured output from any block |
| `component` | Custom UI component with typed props |
| `container` | Groups child items for visual layout |
| `tool_call` | Tool invocation with arguments |
| `tool_result` | Tool execution result |
| `state_change` | State mutation notification |
| `resource_change` | Resource mutation notification |
| `step_error` | Non-terminal error in a pipeline step |
| `error` | Terminal request error |
| `status` | Transient progress updates |

## Content model

Message and reasoning items have a **content array** with typed parts:

```ts
{
  type: "message",
  role: "assistant",
  content: [
    { type: "text", text: "Here's what I found:" },
    { type: "data", data: { results: [...] } },
  ]
}
```

When [voice](/docs/guides/voice) is enabled, audio content parts also arrive on the same message:

```ts
{ type: "output_audio", audio: "base64...", mediaType: "audio/mp3", transcript: "Here's what I found:" }
```

Content is assembled progressively from `content.delta` events — the framework handles buffering and assembly so you don't have to.

## Resume and replay

This is where flow-state.dev's streaming really shines. Every event has a **sequence number**. When a client disconnects — network blip, tab backgrounded, mobile app suspended — it can resume from exactly where it left off:

```
GET /api/flows/:kind/requests/:requestId/stream
Last-Event-ID: 42
```

The server replays all events after sequence 42, then switches to live streaming. No data loss. No duplicate events. No application-level retry logic needed.

You can also use the `starting_after` query parameter:

```
GET /api/flows/:kind/requests/:requestId/stream?starting_after=42
```

## Item audiences

Not all items go everywhere. The framework uses type-based audience routing — each item type has a fixed audience:

| Audience | Item types |
|----------|-----------|
| **Client** | `message`, `reasoning`, `component`, `container`, `status`, `state_change`, `resource_change`, `error`, `step_error` |
| **LLM** | `message`, `reasoning`, `context`, `block_output` |
| **Internal** | `block_output` (devtools only unless it's a tool call) |

Generators access LLM-audience items via `session.items.llm()` — the framework automatically filters to items the model should see (messages, reasoning, context) and excludes UI-only items (status, components).

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

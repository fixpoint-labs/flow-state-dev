---
sidebar_position: 5
---

# Streaming

Flow State Dev uses an **item-first streaming model** over Server-Sent Events (SSE). Instead of streaming raw text, the framework streams structured items — messages, tool calls, state changes, components — that clients render as they arrive.

## How Streaming Works

When an action executes, the server creates a request stream. The client connects to it via SSE:

```
POST /api/flows/:kind/actions/:action → 202 { requestId }
GET  /api/flows/:kind/requests/:requestId/stream → SSE events
```

Events flow in real-time as blocks execute:

```
event: item.added
data: { "item": { "type": "message", "role": "assistant", ... } }

event: content.delta
data: { "itemId": "msg_1", "delta": { "text": "Hello" } }

event: content.delta
data: { "itemId": "msg_1", "delta": { "text": " there!" } }

event: request.status
data: { "status": "completed" }
```

## Item Types

| Type | What It Is |
|------|-----------|
| `message` | Chat message (user or assistant) with content parts |
| `reasoning` | Model reasoning/thinking (often hidden from end users) |
| `block_output` | Structured output from any block |
| `component` | Custom UI component with props |
| `container` | Groups child items for UI layout |
| `tool_call` | Tool invocation with arguments |
| `tool_result` | Tool execution result |
| `state_change` | State mutation notification |
| `resource_change` | Resource mutation notification |
| `step_error` | Non-terminal error in a pipeline step |
| `error` | Terminal request error |
| `status` | Request lifecycle status |

## Content Model

Message and reasoning items have a **content array** of typed parts:

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

Content is streamed via `content.delta` events — the client assembles the full content progressively.

## Resume and Replay

Every stream event has a **sequence number**. Clients can resume from where they left off:

```
GET /api/flows/:kind/requests/:requestId/stream
Last-Event-ID: 42
```

The server replays all events after sequence 42, then switches to live streaming. This makes reconnection seamless — no lost data.

## Item Visibility

Items have a `visibility` field:

| Visibility | Meaning |
|------------|---------|
| `ui` | Shown to the user in the UI |
| `internal` | Available in stream but not rendered by default |
| `devtool` | Only visible in developer tools |

Transient items (like in-progress content) are replaced by their final versions when the block completes.

## React Integration

On the React side, streaming is automatic through hooks:

```tsx
const session = useSession(sessionId);

// session.items — all items from the current session
// session.isStreaming — true while a request is active
// session.messages — filtered to message items only

{session.items.map((item) => (
  <ItemRenderer key={item.id} item={item} />
))}
```

The `useSession` hook connects to the SSE stream, processes events, and updates items reactively. No manual stream management needed.

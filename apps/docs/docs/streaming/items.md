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
| `item.updated` | Patch to an existing item, identified by id. Used by trace items, `tool_output`, and `container` to fill in fields as work progresses. |
| `content.delta` | Text chunk appended to a streaming item (messages, reasoning). |
| `content.added` | New content part added to an item (e.g., audio part on a message). |
| `content.audio.delta` | Audio chunk for streaming TTS. Live-only, not replayable. |
| `content.done` | A content part finalized. |
| `item.done` | Item finalized with terminal status. |
| `request.completed` | All blocks finished. Request succeeded. |
| `request.failed` | Request failed with a terminal error. |

## Trace items

Trace items describe what blocks ran, what they consumed, and what they produced. They flow only on the trace channel — the default client filter strips them — and they are retained for inspection in DevTool.

### `block_trace`

One row per block execution. The same row is emitted at `item.added`, patched in place via `item.updated`, then finalized with `item.done`. Fields fill in as the block progresses:

```jsonc
// item.added — block started, only input is known.
{
  "type": "block_trace",
  "id": "item_block_trace_4_a1b2",
  "status": "in_progress",
  "blockName": "summarize",
  "blockKind": "generator",
  "input": { "source": { "kind": "ref", "sourceItemId": "item_block_trace_3_..." } },
  "startedAt": 1717000000000
}
```

```jsonc
// item.updated — generator bundle landed (model, prompt, params).
{
  "id": "item_block_trace_4_a1b2",
  "patch": {
    "generator": {
      "model": "openai/gpt-4o-mini",
      "messages": [/* ... */],
      "temperature": 0.2
    }
  }
}
```

```jsonc
// item.done — terminal: output, status, timing, token usage.
{
  "type": "block_trace",
  "id": "item_block_trace_4_a1b2",
  "status": "completed",
  "blockName": "summarize",
  "blockKind": "generator",
  "input": { "source": { "kind": "ref", "sourceItemId": "item_block_trace_3_..." } },
  "output": { "kind": "inline", "value": { "summary": "..." } },
  "startedAt": 1717000000000,
  "completedAt": 1717000004210,
  "duration": 4210,
  "modelUsage": {
    "model": "openai/gpt-4o-mini",
    "promptTokens": 412,
    "completionTokens": 94,
    "totalTokens": 506
  }
}
```

`block_trace` carries both input and output as `BlockValue` descriptors. A block downstream of another block stamps its `input.source` as a `ref` to the upstream `block_trace`, so the input area in DevTool can dedupe rather than repeat the upstream content. Aggregator steps (`thenAll`, `parallel`, `forEach`) stamp a `structure` source that carries refs to each branch.

When a block fails, `block_trace.error` is `{ message: string, code?: string, details?: Record<string, unknown> }`. `tool_output.error` shares the same shape. The runtime auto-populates `details` for generator output-validation failures with `rawOutput` (the raw text the model returned), `issues` (the Zod issues), and `phase` (`"stream"` or `"final"`); author-thrown `FlowError.details` flows through verbatim. See [Error handling](/docs/advanced/error-handling).

### `tool_output`

When a generator calls a tool, the runtime emits a `tool_output` placeholder via `item.added` before the tool runs, then patches it via `item.updated` once the tool returns. In LLM-ready history each `tool_output` expands into two protocol messages — an assistant `tool-call` and a `tool` result — which is why history windowing operates on conversational turns rather than raw messages (see [Conversation history windowing](/docs/advanced/generator-context#conversation-history-windowing)):

```jsonc
// item.added — tool was called, args known, output not yet.
{
  "type": "tool_output",
  "id": "item_tool_output_5_c3d4",
  "status": "in_progress",
  "blockName": "lookup",
  "toolCall": {
    "callId": "call_abc",
    "name": "lookup",
    "alias": "lookup",
    "arguments": "{\"query\":\"..\"}",
    "generatorBlock": "agent"
  }
}
```

```jsonc
// item.updated → item.done — terminal output.
{
  "id": "item_tool_output_5_c3d4",
  "patch": { "status": "completed", "output": { "answers": ["..."] } }
}
```

`tool_output` and the called block's `block_trace` are decoupled. The called block still gets its own `block_trace` row, but its `output` is a `ref` to the `tool_output` item. The tool result is therefore stored once, surfaced in two places, and the conversation history sees the rich `tool_output` form.

`tool_output` items have two origins: the AI SDK tool-loop inside a generator, and any block wrapped with [`.asTool()`](../fundamentals/blocks.md#showing-a-deterministic-call-as-a-tool-astool) when run from a sequencer step. The envelope and lifecycle are identical. `toolCall.generatorBlock` records which block initiated the call — the parent generator's name on the LLM path, the wrapping block's name on the deterministic path.

### Lifecycle

Trace items follow a three-event lifecycle: `item.added` (in_progress, no output yet), zero or more `item.updated` patches (input connectors, generator bundle, model usage), and a terminal `item.done` (status set to `completed` or `failed`, output written, timing closed). Consumers reconcile by id. A late subscriber that joins after `item.done` sees only the final settled row in the snapshot — no synthetic replay of intermediate patches is needed.

### Migration

If you were reading the previous trace types, here's the mapping:

| Old | New |
|-----|-----|
| `block_output` (terminal) + `block_debug` (start-time) | `block_trace` (one row, lifecycle patched) |
| `block_tool_output` | `tool_output` (decoupled from `block_trace`) |

`block_debug` and `block_output` are gone as separate types. Anything that filtered `block_output` should filter `block_trace` instead. Anything that read `block_debug` should read the `generator` field on `block_trace` once `item.updated` has landed.

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

## `content.audio.delta` — streaming TTS audio chunks

When the configured voice provider supports streaming TTS, the server emits `content.audio.delta` events carrying base64-encoded audio chunks for an in-flight `OutputAudioContent` part. These are live-only — they do not replay on reconnect. The durable representation is the eventual `OutputAudioContent` delivered via `content.added`.

### Wire shape

```ts
type ContentAudioDeltaEvent = {
  stream: "request";
  type: "content.audio.delta";
  requestId: string;
  sequence_number: number;
  ts: number;
  itemId: string;
  contentIndex: number;
  /** Base64-encoded audio chunk bytes. */
  audio: string;
  /** Set true on the final chunk for this content part. */
  isLast?: boolean;
};
```

A frame on the wire:

```
id: req_abc:42
event: content.audio.delta
data: {"type":"content.audio.delta","itemId":"msg_0","contentIndex":0,"audio":"...base64...","isLast":false}
```

### Mediatype and content-part identity

The chunk's media type lives on the parent `OutputAudioContent` (delivered via `content.added` before the first chunk), not on the delta itself. Format is stable across all chunks for a given content part, so carrying it per chunk is dead weight. M1 supports MP3 (`audio/mpeg`) only.

### End of stream

`isLast: true` on the final chunk lets clients flush their decode pipeline without waiting for the eventual `content.done`. The server still emits `content.done` with the reassembled `OutputAudioContent.audio` snapshot afterwards.

### Custom client dispatch

If you build a custom SSE consumer, distinguish text deltas from audio deltas at the top-level `type`:

```ts
switch (event.type) {
  case "content.delta":
    appendText(event.delta);
    break;
  case "content.audio.delta":
    audioPlayer.enqueueChunk({
      audio: event.audio,
      mediaType: lookupMediaType(event.itemId, event.contentIndex),
      isLast: event.isLast
    });
    break;
}
```

### Resume behavior

`content.audio.delta` is excluded from `Last-Event-ID` replay for the same reason as `content.delta`: per-chunk persistence would 10–100x the event-log size for sub-second TTS, and the durable `OutputAudioContent` snapshot already lets the client pick up at the next semantic boundary. On reconnect the client receives any `content.added` it missed (with the snapshot if synthesis finished) and resumes from live deltas; chunks emitted during the disconnect window are lost. This matches every comparable system — OpenAI Realtime, ElevenLabs WS, Cartesia, LiveKit.

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

## Observable model identity

Every item produced by a generator carries a `model` field describing which concrete model produced it. This is distinct from "Generator identity" above (which answers *which agent* produced the item) — `model` answers *which model*. The two compose: an item can carry both `agentName: "executor"` and `model: { actual: "openai/gpt-5.5", requested: "intent/chat" }`.

### Shape

`ModelIdentity` is a small record:

```ts
type ModelIdentity = {
  actual: string;       // always populated
  requested?: string;   // present when meaningful
  gateway?: string;     // present when a gateway routed the call
};
```

- `actual` is the concrete model that executed. Prefers the provider-reported model id (e.g. `gpt-5.5-2025-04-12`) and falls back to the framework's winning candidate string when the provider doesn't report one.
- `requested` is populated when the caller's input differs from `actual` — most commonly for intent strings (`intent/chat`), non-first fallback candidates, or when the provider substitutes a different version.
- `gateway` is set when the call routed through a gateway (e.g. Vercel, OpenRouter).

### On items

Generator-emitted items carry `model`: `message`, `reasoning`, `source`, `tool_output`, and the transient `tool_call_progress`. Handler-emitted items (via `ctx.emitMessage`) do not carry `model` — the framework only stamps identity on generator-produced items.

`tool_call_progress` is emitted by both streaming and non-streaming generator paths. When the resolved model implements only `generate()`, the framework synthesises these items from `generation.toolCalls` and `generation.steps[].toolResults`, so observability does not depend on transport capability.

```jsonc
// Example message item from an intent-routed generator
{
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "output_text", "text": "Hi." }],
  "model": {
    "actual": "gpt-5.5-2025-04-12",
    "requested": "intent/chat"
  }
}
```

### On `block_trace`

`BlockTraceItem` for generator blocks carries `model` at the top level — a sibling of `generator` and `modelUsage`. The three coexist because they answer three different questions:

- `generator.model` — the model the caller wrote in config (a string).
- `modelUsage.model` — the request-string key for token accounting (a string).
- `model` — the resolved identity of what actually ran (a `ModelIdentity` record).

```jsonc
// Example block_trace for a generator after an intent fallback
{
  "type": "block_trace",
  "blockKind": "generator",
  "generator": { "model": "intent/chat", "tools": [], "prompt": "…" },
  "modelUsage": { "model": "intent/chat", "promptTokens": 100, "completionTokens": 80, "totalTokens": 180 },
  "model": { "actual": "anthropic/sonnet", "requested": "intent/chat" }
}
```

`model` is populated even when the generator emits no items (structured-only output, tool-only turns, empty completions), so audit and replay always have a durable record of the concrete model.

### Sub-agents

A sub-agent generator's emitted items carry the *sub-agent's* identity, not the parent's. Each generator scope has its own resolution; identities don't cross-contaminate.

### Absent field

`model` is optional at the type level. It's absent for handler-emitted items, items persisted before the field existed, and generators that errored before any AI SDK call returned. UI code should treat the field as `model?: ModelIdentity` — the `<ModelBadge>` helper in `@flow-state-dev/react` renders nothing when `model` is undefined.

See [fundamentals/models.md](../fundamentals/models.md) for how intents and gateways are configured.

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

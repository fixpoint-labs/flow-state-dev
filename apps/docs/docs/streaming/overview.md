---
sidebar_position: 1
---

# Overview

Items are the unit of communication between blocks and clients. Every artifact your blocks produce — a chat message, a tool result, a state change, a custom UI component — is an item. Items are typed, carry provenance, and route by audience. They accumulate in sessions, stream to clients in real time, and feed back into LLM context on subsequent requests.

## Item types

Every item has a type that determines how it's routed and rendered:

| Type | What it is |
|------|-----------|
| `message` | Chat message (user or assistant) with content parts |
| `reasoning` | Model reasoning/thinking tokens |
| `block_output` | Structured output from any block |
| `component` | Custom UI component with typed props |
| `container` | Groups child items for visual layout |
| `state_change` | State mutation notification |
| `resource_change` | Resource mutation notification |
| `step_error` | Non-terminal error in a pipeline step |
| `error` | Terminal request error |
| `status` | Transient progress updates |
| `context` | Hidden context for LLMs only. Not sent to the client. |

Tool invocations use `block_output` items: `item.added` with `toolCall` populated (no output yet), then `item.done` with `output` populated after the tool block runs.

## Emitting items

Generators emit items automatically as they stream. Handlers are silent by default. To emit items from a handler (or any block), use the context methods:

```ts
execute: async (input, ctx) => {
  // Send a text message to the client
  await ctx.emitMessage("Processing your request...");

  // Emit a custom UI component
  await ctx.emitComponent("progress-bar", { percent: 50, label: "Analyzing..." });

  // Emit a status update (transient, not persisted)
  await ctx.emitStatus("Fetching data from external API...");

  return result;
}
```

`emitMessage()` creates a `message` item. `emitComponent()` creates a `component` item with the component name and typed props. `emitStatus()` creates a transient `status` item for progress indicators. These all stream to the client immediately.

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

When [voice](/docs/fundamentals/voice) is enabled, audio content parts also arrive on the same message:

```ts
{ type: "output_audio", audio: "base64...", mediaType: "audio/mp3", transcript: "Here's what I found:" }
```

Content is assembled progressively from `content.delta` events during streaming. The framework handles buffering and assembly.

## Audiences

Not all items go everywhere. The framework uses type-based audience routing:

| Audience | Types |
|----------|-------|
| **Client** | `message`, `reasoning`, `component`, `container`, `status`, `state_change`, `resource_change`, `error`, `step_error` |
| **LLM** | `message`, `reasoning`, `context`, `block_output` (when it has `toolCall` — the tool result) |
| **Internal** | `block_output` without `toolCall` — devtools only |

Generators access LLM-audience items via `session.items.llm()`. The framework automatically filters to items the model should see (messages, reasoning, context) and excludes UI-only items (status, components).

## Session items

Items accumulate in the session across requests. When a user sends a second message, the session already holds items from the first request. Generators use this for conversation history.

Three views for accessing session items:

- **`items.all()`** — Everything in the session. Useful for debugging and the DevTool.
- **`items.client()`** — Items intended for the client. Excludes `context` and internal `block_output`.
- **`items.llm()`** — Items formatted for the model. Supports token limiting: `items.llm({ limit: { tokens: 20_000 } })` packs from newest to oldest within the budget.

## Item lifecycle

Items follow a three-phase lifecycle:

1. **Added** — `item.added` event. Item exists with `status: "in_progress"`.
2. **Content deltas** — For streaming content (messages, reasoning), text arrives in chunks via `content.delta` events. The client accumulates deltas.
3. **Done** — `item.done` event. Item finalized with `status: "completed"`, `"incomplete"`, or `"failed"`. Terminal states are immutable.

## Provenance

Every item carries provenance metadata — which block produced it, where in the execution tree it came from:

```ts
type ItemProvenance = {
  blockName: string;
  blockInstanceId: string;
  parentBlockInstanceId?: string;
  phase: "main" | "work";
  stepIndex?: number;
};
```

This powers UI grouping, the DevTool timeline, and correlating items to specific block executions.

## Persistence

Most items are persisted to the session. A few exceptions:

- `status` items are always transient (stream-only, not persisted).
- `state_change` and `resource_change` are transient by default in production; persisted in dev mode for the DevTool state timeline.
- Other item types are persisted by default.

## Custom components

Emit custom UI components from any block:

```ts
ctx.emitComponent("chart", { data: chartData, title: "Monthly Revenue" });
```

Register component renderers on the React side. The client receives `component` items with `component` and `data` fields, and the `ItemsRenderer` dispatches to your registered renderers. See [React Integration](/docs/client/react) for renderer setup.

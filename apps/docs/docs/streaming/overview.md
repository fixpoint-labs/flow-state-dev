---
sidebar_position: 1
---

# Overview

Items are a core part of the data model. Every artifact produced during block execution — a chat message, a tool call result, a state change, a custom UI component — is persisted as an item. Items accumulate in sessions to form the conversation log. They power streaming to clients, provide conversation history to LLMs, enable the DevTool's trace view, and support resumable connections.

Items aren't just a transport mechanism. They're the durable record of what happened.

## Item types

Every item has a type that determines how it's persisted, routed, and rendered:

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
| `status` | Transient progress updates (not persisted) |
| `context` | Hidden context for LLMs only. Not sent to the client. |

Tool invocations use `block_output` items: `item.added` with `toolCall` populated (no output yet), then `item.done` with `output` populated after the tool block runs.

## Emitting items

Generators emit items automatically as they stream. Handlers are silent by default. To emit items from a handler (or any block), use the context methods:

```ts
execute: async (input, ctx) => {
  await ctx.emitMessage("Processing your request...");
  await ctx.emitComponent("progress-bar", { percent: 50, label: "Analyzing..." });
  await ctx.emitStatus("Fetching data from external API...");
  return result;
}
```

`emitMessage()` creates a `message` item. `emitComponent()` creates a `component` item with the component name and typed props. `emitStatus()` creates a transient `status` item for progress indicators.

## Session items

Items accumulate in the session across requests. When a user sends a second message, the session already holds every item from the first request. This is how conversation history works — generators read from session items to build context.

Three views for accessing session items:

- **`items.all()`** — Everything in the session. The full log.
- **`items.client()`** — Items intended for the client UI. Excludes `context` and internal `block_output`.
- **`items.llm()`** — Items formatted for the model. Supports token limiting: `items.llm({ limit: { tokens: 20_000 } })` packs from newest to oldest within the budget.

## Audiences

Not all items go everywhere. The framework uses type-based audience routing:

| Audience | Types |
|----------|-------|
| **Client** | `message`, `reasoning`, `component`, `container`, `status`, `state_change`, `resource_change`, `error`, `step_error` |
| **LLM** | `message`, `reasoning`, `context`, `block_output` (when it has `toolCall` — the tool result) |
| **Internal** | `block_output` without `toolCall` — devtools only |

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

When [voice](/docs/fundamentals/voice) is enabled, audio content parts arrive on the same message:

```ts
{ type: "output_audio", audio: "base64...", mediaType: "audio/mp3", transcript: "Here's what I found:" }
```

## Item lifecycle

Items follow a three-phase lifecycle:

1. **Added** — Item exists with `status: "in_progress"`. Persisted immediately.
2. **Content deltas** — For streaming content (messages, reasoning), text arrives in chunks. The client accumulates deltas.
3. **Done** — Item finalized with `status: "completed"`, `"incomplete"`, or `"failed"`. Terminal states are immutable.

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

This powers the DevTool's trace timeline, UI grouping, and correlating items to specific block executions.

## Persistence behavior

Most items are persisted to the session store. Exceptions:

- `status` items are always transient (stream-only, not persisted).
- `state_change` and `resource_change` are transient by default in production; persisted in dev mode for the DevTool.
- Everything else is persisted by default.

See [Persistence](/docs/persistence/overview) for store configuration.

## Custom components

Emit custom UI components from any block:

```ts
ctx.emitComponent("chart", { data: chartData, title: "Monthly Revenue" });
```

Register component renderers on the React side. The `ItemsRenderer` dispatches to your registered renderers based on the component name. See [React Integration](/docs/client/react) for renderer setup.

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
| `component` | Custom UI component with typed props |
| `container` | Groups child items for visual layout |
| `block_tool_output` | Result of a tool invocation within a generator's tool loop |
| `source` | URL reference from provider-native tools (web search, etc.) |
| `status` | Transient progress updates (not persisted) |
| `state_change` | State mutation notification |
| `resource_change` | Resource mutation notification |
| `step_error` | Non-terminal error in a pipeline step |
| `error` | Terminal request error |
| `context` | Hidden context for LLMs only. Not sent to the client. |
| `block_output` | Execution record for every block (trace-only) |
| `router_decision` | Route selection record (trace-only) |
| `sequencer_state_snapshot` | Sequencer state at step boundaries (trace-only, transient) |

## Emitting items

Generators emit items automatically as they stream. Handlers are silent by default. To emit items from a handler (or any block), use the context methods:

```ts
execute: async (input, ctx) => {
  ctx.emitMessage("Processing your request...");
  ctx.emitComponent("progress-bar", { percent: 50, label: "Analyzing..." });
  ctx.emitStatus("Fetching data from external API...");
  return result;
}
```

`emitMessage()` creates a `message` item. `emitComponent()` creates a `component` item with the component name and typed props. `emitStatus()` creates a transient `status` item for progress indicators. `emitLLMContext()` creates a `context` item that feeds the LLM but is hidden from the browser.

## Session items

Items accumulate in the session across requests. When a user sends a second message, the session already holds every item from the first request. This is how conversation history works — generators read from session items to build context.

Three views for accessing session items:

- **`items.all()`** — Everything in the session. The full log.
- **`items.client()`** — Items intended for the client UI. Excludes `context` and trace items like `block_output`.
- **`items.llm()`** — Items formatted for the model. Supports token limiting: `items.llm({ limit: { tokens: 20_000 } })` packs from newest to oldest within the budget.

## Item roles

Every item has a **role** that controls who can see it. There are three roles, each with progressively narrower visibility:

| Role | Browser | LLM history | DevTool |
|------|:-------:|:-----------:|:-------:|
| `external` | ✓ | ✓ | ✓ |
| `internal` | — | ✓ | ✓ |
| `trace` | — | — | ✓ |

**`external`** is the default. The browser renders it, and the LLM can use it in conversation history. Most items are external.

**`internal`** is hidden from the browser but participates in LLM history. Use it for helper blocks that produce content the next model call should see, but the user shouldn't. Think of it as a programmatic system message.

**`trace`** is devtool-only. Neither the browser nor the LLM sees it. Structural items like `block_output`, `router_decision`, and `sequencer_state_snapshot` default to trace.

You can set item roles on generators with the `itemRole` config:

```ts
const helper = generator({
  name: "background-analysis",
  model: "preset/fast",
  prompt: "Analyze the user's intent...",
  itemRole: "internal", // LLM sees the output, user doesn't
});
```

Not all external items enter LLM history — only content types like `message`, `reasoning`, and `block_tool_output`. UI-only types like `component`, `status`, and `state_change` are external (browser sees them) but don't go into LLM conversation history.

## Content model

Message and reasoning items have a **content array** with typed parts:

```ts
{
  type: "message",
  role: "assistant",
  content: [
    { type: "output_text", text: "Here's what I found:" },
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

- `status` and `error` items are always transient (stream-only, not persisted).
- `sequencer_state_snapshot` is always transient.
- `state_change` and `resource_change` are transient by default in production; persisted in dev mode for the DevTool.
- Everything else is persisted by default.

When a block is configured with `transient: true`, all items it emits become transient regardless of type.

See [Persistence](/docs/persistence/overview) for store configuration.

## Custom components

Emit custom UI components from any block:

```ts
ctx.emitComponent("chart", { data: chartData, title: "Monthly Revenue" });
```

Component items support streaming updates via a handle:

```ts
const handle = ctx.emitComponent("plan-view", { steps: [], status: "working" });
handle.update({ steps: ["Step 1 done"], status: "working" });
handle.update({ steps: ["Step 1 done", "Step 2 done"], status: "complete" });
handle.done();
```

Live clients see every intermediate update via SSE. The persisted record holds only the final state.

Register component renderers on the React side. The `ItemsRenderer` dispatches to your registered renderers based on the component name. See [React Integration](/docs/client/react) for renderer setup.

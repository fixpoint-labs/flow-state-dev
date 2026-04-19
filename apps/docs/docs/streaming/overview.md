---
sidebar_position: 1
---

# Items

Every artifact produced during block execution is an **item**. A chat message, a tool call result, a progress indicator, a custom UI component — each one is an item that streams to connected clients in real time and (in most cases) gets persisted to the session record.

Items serve three purposes:

1. **Streaming output** — clients receive items over SSE as blocks execute
2. **Session history** — persisted items accumulate across requests, forming the conversation log
3. **LLM context** — some item types feed into conversation history for future model calls

## The items you'll use most

Most of the time you'll work with three emit methods. Generators call these automatically for their own output, but you can also call them explicitly from any block:

| Method | What it creates | Persisted | Enters LLM history |
|--------|----------------|:---------:|:------------------:|
| `ctx.emitMessage(text)` | A chat message visible to the user | Yes | Yes |
| `ctx.emitComponent(name, data)` | A custom UI component with structured data | Yes | No |
| `ctx.emitStatus(message)` | A transient progress indicator | No | No |

These are covered in depth in [Emitting Items](/docs/streaming/emitting-items).

## What happens automatically

You don't need to emit most item types yourself. The framework handles them:

- **Generators** automatically emit `message` and `reasoning` items as the model streams
- **Tool calls** produce `block_tool_output` items with the tool name, input, and result
- **State mutations** emit `state_change` notifications so the client stays in sync
- **Resource mutations** emit `resource_change` notifications
- **Errors** produce `error` or `step_error` items depending on whether they're terminal

## Item roles

Every item has a role that controls who sees it:

| Role | Browser | LLM history | DevTool |
|------|:-------:|:-----------:|:-------:|
| `external` | ✓ | ✓ | ✓ |
| `internal` | — | ✓ | ✓ |
| `trace` | — | — | ✓ |

Most items are `external` by default. A few things to know:

- **Not all external items enter LLM history.** Only content types (`message`, `reasoning`, `block_tool_output`) do. UI types like `component` and `status` are visible in the browser but don't feed into model context.
- **Internal items** are for helper blocks whose output the next model call should see, but the user shouldn't. Set `itemRole: "internal"` on a generator to make its output internal.
- **Trace items** are devtool-only. Structural items like `block_output` and `router_decision` default to trace.

```ts
const helper = generator({
  name: "background-analysis",
  model: "preset/fast",
  prompt: "Analyze the user's intent...",
  itemRole: "internal", // LLM sees output, user doesn't
});
```

## Persistence

Most items persist to the session store automatically. Exceptions:

- `status` items are always transient (stream-only, never persisted)
- `sequencer_state_snapshot` is always transient
- `state_change` and `resource_change` are transient in production, persisted in dev mode for the DevTool
- Everything else persists by default

When a block is configured with `transient: true`, all items it emits become transient regardless of type.

## Session items

Items accumulate across requests. When a user sends a second message, the session already holds every item from the first request. Generators use this to build conversation history.

Three views for accessing session items:

- **`items.all()`** — everything in the session
- **`items.client()`** — items intended for the client UI (excludes trace items)
- **`items.llm()`** — items formatted for the model, with optional token limiting:

```ts
const history = ctx.session.items.llm({ limit: { tokens: 20_000 } });
```

## Item lifecycle

Items go through three phases:

1. **Added** — item exists with `status: "in_progress"`
2. **Streaming** — for messages and reasoning, text arrives in chunks via content deltas
3. **Done** — item finalized as `"completed"`, `"incomplete"`, or `"failed"` (terminal, immutable)

## All item types

For reference, here's the complete registry:

| Type | What it is | Persisted |
|------|-----------|:---------:|
| `message` | Chat message (user or assistant) | Yes |
| `reasoning` | Model thinking tokens | Yes |
| `component` | Custom UI component | Yes |
| `container` | Groups child items for visual layout | Yes |
| `block_tool_output` | Tool invocation result | Yes |
| `source` | URL reference from web search, etc. | Yes |
| `status` | Progress indicator | No |
| `state_change` | State mutation notification | Dev only |
| `resource_change` | Resource mutation notification | No (default) |
| `step_error` | Non-terminal error in a pipeline step | Yes |
| `error` | Terminal request error | Yes |
| `block_output` | Execution record (trace-only) | Yes |
| `router_decision` | Route selection (trace-only) | Yes |
| `sequencer_state_snapshot` | Sequencer state snapshot (trace-only) | No |

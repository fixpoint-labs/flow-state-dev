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
- **Tool calls** produce `block_tool_output` items with the tool name, input, and result
- **State mutations** emit `state_change` notifications so the client stays in sync
- **Resource mutations** emit `resource_change` notifications
- **Errors** produce `error` or `step_error` items depending on whether they're terminal

## Visibility

The reference table below shows where each item type appears by default. Two things to note:

- **Client** means the client receives and can render it. Most items are client-visible.
- **LLM History** means the item enters conversation history for future model calls. Only content-bearing types (`message`, `reasoning`, `block_tool_output`) do this. Other client-visible types like `component` and `status` don't feed into model context — they're purely for the UI.

### Changing visibility

Every item has two independent visibility flags you can override:

| Flag | What it controls |
|------|-----------------|
| `client` | Whether the item is sent to connected clients |
| `history` | Whether the item enters LLM conversation history |

Each item type has sensible defaults — `message` defaults to both, `component` defaults to client-only, `block_output` defaults to neither (devtool-only). You can override per-block or per-item.

Generators use `emitAudience` to control who sees their output, and `emit` for per-type suppression:

```ts
const helper = generator({
  name: "background-analysis",
  model: "preset/fast",
  prompt: "Analyze the user's intent...",
  emitAudience: "history", // LLM sees output, user doesn't
  emit: { reasoning: false }, // suppress reasoning items
});
```

Direct emit methods accept per-call visibility overrides:

```ts
ctx.emitMessage("internal note", { client: false, history: true });
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

## All item types

For reference, here's the complete registry:

| Type | What it is | Client | History | Transient |
|------|-----------|:-------:|:-------:|:---------:|
| `message` | Chat message (user or assistant) | ✓ | ✓ | — |
| `reasoning` | Model thinking tokens | ✓ | ✓ | — |
| `block_tool_output` | Tool invocation result | ✓ | ✓ | — |
| `component` | Custom UI component | ✓ | — | — |
| `container` | Groups child items for visual layout | ✓ | — | — |
| `source` | URL reference from web search, etc. | ✓ | — | — |
| `status` | Progress indicator | ✓ | — | Always |
| `state_change` | State mutation notification | ✓ | — | Production |
| `resource_change` | Resource mutation notification | ✓ | — | Always |
| `step_error` | Non-terminal error in a pipeline step | ✓ | — | — |
| `error` | Terminal request error | ✓ | — | — |
| `block_output` | Execution record | — | — | — |
| `router_decision` | Route selection record | — | — | — |
| `state_snapshot` | Sequencer state snapshot | — | — | Always |

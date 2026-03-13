---
sidebar_position: 2
---

# Items

Items are the unit of communication between blocks and clients. Every streamed artifact — a message, a tool result, a state change — is an item. Items are stored per scope, then streamed to clients as blocks execute. Understanding items is key to building reactive UIs and feeding the right context to LLMs.

## Item types

Every item has a type. The type determines audience routing and how clients render it.

| Type | Purpose |
|------|---------|
| `message` | Conversational content (user, assistant, system, tool). Has a role and a content array. |
| `reasoning` | Model reasoning or thinking traces. Summarized for display. |
| `block_output` | Structured output from any block. Carries `modelUsage` when from a generator. Tool invocations encode `toolCall` metadata. |
| `component` | Custom UI component with typed props. Emitted via `emitComponent()`. |
| `container` | Groups child items for visual layout. Used by sequencers and routers. |
| `status` | Transient progress updates. Stream-only, not persisted. |
| `state_change` | Scope state mutation record. |
| `resource_change` | Resource mutation record. |
| `step_error` | Non-terminal error in a pipeline step. May be recovered by a rescue boundary. |
| `error` | Terminal request error. |
| `context` | Hidden context for LLMs only. Not sent to the client. |

Tool invocations use `block_output` items: `item.added` with `toolCall` populated (no output yet), then `item.done` with `output` populated after the tool block runs.

## Item lifecycle

Items follow a simple lifecycle:

1. **Added** — `item.added` event. Item exists with `status: "in_progress"`. For streaming content (messages, reasoning), `content.delta` events arrive next.
2. **Content deltas** — Text streams in chunks. The client accumulates deltas to build the full content. The framework handles buffering.
3. **Done** — `item.done` event. Item finalized with `status: "completed"`, `"incomplete"`, or `"failed"`. Terminal states are immutable.

## Provenance

Every item carries provenance metadata for traceability and debugging:

```ts
type ItemProvenance = {
  blockName: string;
  blockDefinitionId?: string;
  blockInstanceId: string;
  parentBlockInstanceId?: string;
  phase: "main" | "work";
  stepIndex?: number;
  workGroupId?: string;
  attempt?: number;
};
```

Use this for UI grouping, DevTool timeline views, and correlating items to specific block executions.

## Item audiences

Not all items go everywhere. Type-based routing:

| Audience | Types |
|----------|-------|
| **Client** | `message`, `reasoning`, `component`, `container`, `status`, `state_change`, `resource_change`, `error`, `step_error` |
| **LLM** | `message`, `reasoning`, `context`, `block_output` (when it has `toolCall` — the tool result) |
| **Internal** | `block_output` without `toolCall` — devtools only |

## Session items

Session items are the accumulated output of all requests in a conversation. They persist across requests. When a generator needs conversation history, it reads from session items.

## Three views

Blocks and clients access items through filtered views:

- **items.all()** — All session items. Use when you need the full log.
- **items.client()** — Items intended for the client. Excludes `context` and internal `block_output`.
- **items.llm()** — Items the LLM should see. Supports token limiting: `items.llm({ limit: { tokens: 20_000 } })` packs from newest to oldest within the budget.

`items.llm()` returns formatted messages (`{ role, content }`) ready for the model. The framework handles filtering and token counting.

## Streaming events

Items relate to stream events as follows:

| Event | Meaning |
|-------|---------|
| `item.added` | New item in the stream. Contains the full item payload. |
| `content.delta` | Text chunk appended to a streaming item. |
| `content.added` | New content part added to an item. |
| `content.done` | Content part finalized. |
| `item.done` | Item finalized. |

The client assembles items from these events. On reconnect, the server replays from a sequence-number cursor. No duplicate assembly logic needed.

## Custom components

Emit custom UI components from any block:

```ts
ctx.emitComponent("progress-bar", { percent: 50, label: "Analyzing..." });
```

Register a component renderer on the React side. The client receives `component` items with `component` and `data` fields. The ItemsRenderer dispatches to your registered renderers.

## Transience

- `status` items are always transient (stream-only, not persisted).
- `state_change` and `resource_change` are transient by default in production; persisted in dev mode for the DevTool state timeline.
- Flow-level `persistStateChanges: true` forces persistence.
- Other item types are persisted by default.

## Summary

Items are typed, have a lifecycle, carry provenance, and route by audience. Session items accumulate. Use `items.all()`, `items.client()`, and `items.llm()` to read them. Stream events (`item.added`, `content.delta`, `item.done`) drive the client. Custom components use `emitComponent()`.

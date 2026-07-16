---
sidebar_position: 2
---

# Emitting Items

Generators emit messages automatically as they stream. But blocks can also emit items explicitly using the context methods. This is how you send progress updates, render custom UI components, and build multi-block interfaces.

## Messages

`ctx.emit.message()` sends a chat message to the user. The message also enters LLM conversation history, so future model calls can see it.

```ts
const notify = handler({
  name: "notify",
  execute: async (_input, ctx) => {
    ctx.emit.message("Your file has been saved.");
  },
});
```

Most of the time you won't call `emit.message()` directly — generators handle message emission as the model streams. Use it in handlers when you need to inject a visible message into the conversation outside of a generator.

### Stamping identity on handler emits

Handler-emitted messages default to full visibility (on the client, in conversation history). To mark a message as observability-only (devtool visible, hidden from user and LLM) or tie it to a sub-agent identity, pass `itemVisibility` / `agentName`:

```ts
ctx.emit.message("Debug: classifier chose route A", {
  itemVisibility: { client: false, history: false },
  agentName: "classifier",
});

ctx.emit.message("Background audit complete.", {
  itemVisibility: { client: true, history: false },
  agentName: "auditor",
});
```

Without identity options, the item is client- and history-visible — the ergonomic default for handlers that speak directly to the user. See [Generator identity](items#generator-identity) for the full model.

Handler-emitted messages do not carry the `model` field. The framework only stamps `ModelIdentity` on items produced by a generator block — see [Observable model identity](items#observable-model-identity).

## Status messages

`ctx.emit.status()` sends a transient progress indicator. It appears briefly in the UI during execution but is never persisted and doesn't enter LLM history. Use it to tell the user what's happening during long operations.

```ts
const pipeline = sequencer({ name: "pipeline" })
  .step(handler({
    name: "fetch-data",
    execute: async (input, ctx) => {
      ctx.emit.status("Fetching data from external API...");
      const data = await fetchExternalData();
      ctx.emit.status("Processing results...");
      return processData(data);
    },
  }))
  .step(analyzer);
```

Status messages are fire-and-forget. They're lightweight by design — emit them freely to keep the user informed without cluttering session history.

Good status messages are specific: "Searching 3 databases..." is better than "Working...". They help users understand what's taking time.

## Components

`ctx.emit.component()` sends structured data to a registered UI component. Unlike messages, component items don't enter LLM history — they're purely for rendering custom UI.

### Basic usage

```ts
execute: async (input, ctx) => {
  ctx.emit.component("search-results", {
    query: input.query,
    results: searchResults,
    totalCount: 42,
  });
}
```

Each call creates one persisted item. The component name (`"search-results"`) maps to a React component you register on the client:

```tsx
<FlowProvider renderers={{ component: { "search-results": SearchResults } }}>
```

### Keyed components

When you emit a component with the same `key`, the client replaces the previous component instead of appending a new one. This is how you build components that update over time — progress indicators, plans being executed, results accumulating:

```ts
// Create initial view
ctx.emit.component("task-status", { id: "task-1", status: "pending" }, { key: "task-1" });

// Update it as work progresses
await step1();
ctx.emit.component("task-status", { id: "task-1", status: "running", progress: 50 }, { key: "task-1" });

await step2();
ctx.emit.component("task-status", { id: "task-1", status: "complete", result: "..." }, { key: "task-1" });
```

Each `emit.component` call with the same key replaces the previous one. Live clients see each intermediate state via SSE. The persisted record collapses to one entry per key — only the latest snapshot is stored, intermediate ones are not retained.

This pattern is central to how the framework's built-in patterns work. The plan-and-execute pattern, for example, emits keyed components for each task so they update independently:

```ts
// Each task gets its own key
ctx.emit.component("plan-task", { id: task.id, status: "running" }, { key: `plan-task:${task.id}` });
// Later, same key replaces it
ctx.emit.component("plan-task", { id: task.id, status: "complete" }, { key: `plan-task:${task.id}` });
```

### Updating across blocks

Keyed components work across multiple blocks in a sequencer. Different blocks can emit to the same key:

```ts
// First block creates the initial view
ctx.emit.component("task-status", { id: "task-1", status: "pending" }, { key: "task-1" });

// Later block updates the same view
ctx.emit.component("task-status", { id: "task-1", status: "complete", result: "..." }, { key: "task-1" });
```

### Multiple calls without a key

If you call `emit.component()` multiple times with the same component name but no `key`, each call creates a separate persisted item. They all render independently in the UI. This is the right approach when each emission represents a distinct piece of output — search result cards, log entries, individual items in a list.

## Keyed snapshots

When you emit a component item with a stable `key`, the renderer collapses to the latest. We call that a **keyed snapshot** — one logical entity that updates over time. The latest version replays on reload, so a returning user sees the final state without replaying every intermediate step.

### Persistence: upsert in place

Keyed component emissions **upsert** on the persisted request record. The framework derives a deterministic item ID from the key, so subsequent emissions overwrite the prior entry. The persisted `items[]` array contains exactly one entry per `(requestId, key)` — not one per emission.

The SSE event log is unchanged: each `emit.component` call still appends an `item.added` + `item.done` event. Live clients see every update; mid-stream resume replays each event. The client renderer reconciles by item ID and overwrites in place, so duplicate IDs in the event stream resolve correctly.

If your client is something other than the bundled React hooks, make sure it overwrites items by ID rather than appending. Third-party SSE clients that naively append every `item.added` will end up with duplicates.

### Replace, not merge

Each emission with the same `key` **fully replaces** the `data` payload. Fields absent from the new payload are removed.

```ts
ctx.emit.component("widget", { a: 1, b: 2 }, { key: "k" });
ctx.emit.component("widget", { a: 99 }, { key: "k" });
// Final data: { a: 99 }   — `b` is gone, not preserved.
```

Component `data` is the full snapshot to render now. If you need merge, read the prior `data`, compute the merged value, and emit the result.

`transient` and `key` are independent. They compose into four cells:

| `transient` | `key` | Semantics | Example |
|:-----------:|:-----:|-----------|---------|
| `false` | absent | Append-only event | A finalized message; a completed tool output |
| `false` | present | **Keyed snapshot** — replays on reload | `task-change`, `task-board-meta`, `rb-entry` |
| `true` | absent | Ephemeral one-shot | A debug trace |
| `true` | present | Live-only progress with dedup | A spinner-style "currently doing X" |

Two principles fall out of the matrix:

- **Append-only events vs. keyed snapshots.** Pick based on whether the consumer wants every emission or only the latest. Search result cards stack — emit them as separate items. A status badge for a task replaces — emit it with a stable key.
- **Transient × keyed compose orthogonally.** Knowing one tells you nothing about the other. A transient item with a key still dedups live; a persisted item without a key still appends on reload.

A few pitfalls:

- **Keys must be stable.** If a key changes between emissions for the same logical entity (e.g. you regenerate a UUID per call), the renderer treats it as a new entity and remounts. Use deterministic identity — a task id, a row primary key, a content hash.
- **`key` is logical identity, not transport.** It's not the SSE `id:` field used for resume. The two are independent.
- **Replay correctness.** Only `(transient: false, key: present)` items can drop intermediate snapshots safely. If a consumer needs every intermediate value (a log of state transitions, an audit trail), use append-only.
- **Trace item types are filtered regardless of `transient`.** The matrix above describes persistence. Items whose `item.type` resolves to `itemVisibility: { client: false, history: false }` (e.g. `block_trace`, `router_decision`, `state_snapshot`) are filtered out for clients via `resolveItemVisibility`, even if non-transient. Persistence and visibility are separate concerns.

The substrate's task-board uses keyed snapshots for both per-task lifecycle and board-level status. The reactive-blackboard uses them for entry append-but-update:

```ts
// task-change: per-task lifecycle snapshot
ctx.emit.component("task-change", { ... }, { key: `${collectionId}/${taskId}` });

// task-board-meta: per-board status snapshot
ctx.emit.component("task-board-meta", { ... }, { key: collectionId });

// rb-entry: append-only blackboard entry (counter-keyed for replace-on-update)
ctx.emit.component("rb-entry", { ... }, { key: `entry-${count}` });
```

The same idea shows up across the industry. Vercel AI SDK calls them "data parts" with id-based reconciliation. Phoenix LiveView calls them "keyed streams". Hotwire Turbo Streams splits them into `append`/`prepend` (events) and `replace`/`update` (snapshots). Event sourcing calls them snapshots; CDC calls them upserts.

## Default transience and the block flag

A block declared with `transient: true` suppresses the framework's auto-emitted bookkeeping for that block — its `block_trace` traces stream live to active SSE consumers (DevTool, in-flight clients) but don't enter the persisted items log and don't replay on history reload. It does **not** affect items the block emits explicitly. This is the right knob for polling or actor-style substrate blocks (Task Board's `claim-task` / `check-board`, eventActors wrappers) that fire repeatedly and would otherwise flood the items log with bookkeeping rows.

That separation is intentional. When you call `ctx.emit.component()` or `ctx.emit.message()` from inside any block — including a transient one — that's an explicit choice to surface user-facing content. The producing block being infrastructure says nothing about the content's status.

Defaults per emitter:

| Method | Default `transient` | Rationale |
|--------|:-------------------:|-----------|
| `emit.message()` | `false` | Messages are conversational content. |
| `emit.component()` | `false` | Components are user-facing UI. |
| `emit.status()` | `true` | Statuses are naturally ephemeral; the slot is latest-wins. |

Each method accepts a per-call `{ transient }` option to opt in or out:

```ts
// Persist a status (rare — usually you want the live-only default)
ctx.emit.status("Completed final step", { transient: false });

// Live-only component for an in-flight indicator with dedup
ctx.emit.component("typing-indicator", { user: "alice" }, { key: "typing", transient: true });
```

## Container components

Containers group items from multiple blocks into a single UI component. When a sequencer or router declares a `container`, all items emitted by its child blocks are visually owned by the container.

```ts
const pipeline = sequencer({
  name: "research",
  container: { component: "research-panel" },
})
  .step(searchBlock)     // emits component items
  .step(analyzeBlock)    // emits more component items
  .step(summarizeBlock); // emits the final summary
```

The framework emits a `container` item when the sequencer starts executing. Every item emitted by child blocks carries an `ownedBy` tag pointing back to this container. On the client, your container renderer receives all owned items and decides how to display them:

```tsx
function ResearchPanel({ item }: { item: ContainerItem }) {
  const { items, componentsByKey } = useContainerItems(item, session);

  return (
    <div className="research-panel">
      {/* componentsByKey gives you the latest data for each keyed component */}
      {componentsByKey.get("search-results") && (
        <SearchResults data={componentsByKey.get("search-results")} />
      )}
      {componentsByKey.get("analysis") && (
        <Analysis data={componentsByKey.get("analysis")} />
      )}
    </div>
  );
}
```

The container pattern is how the framework's built-in patterns (plan-and-execute, blackboard, supervisor) render multi-block workflows as cohesive UI. Child blocks emit keyed components independently, and the container renderer assembles them into a unified view.

Primary output types (`message`, `reasoning`, `status`, `error`) always render in the main stream, even when owned by a container.

## Updating an item after emission

For items whose fields evolve between `item.added` and `item.done`, the runtime emitter exposes a structured update primitive instead of forcing producers to re-emit the whole item:

```ts
ctx.response.emit({
  type: "item.updated",
  itemId: "item_42",
  patch: { status: "completed", payload: { /* new top-level value */ } }
});
```

The patch is a shallow top-level merge — each key in `patch` replaces the existing value at that key on the tracked item. Nested fields require re-supplying the full nested object. Identity-invariant keys (`id`, `type`, `provenance`, `itemVisibility`, `transient`) are stripped server-side and never apply.

Prefer this over re-emitting `item.added` + `item.done` for the same id when only a few fields change. Consumers see fewer flicker frames and the wire stays compact. Updates after `item.done` apply normally; updates referencing an unknown `itemId` are dropped with a debug event.

## Choosing the right approach

| Scenario | What to use |
|----------|-------------|
| Show text to the user and LLM | `emit.message()` |
| Show progress during a long operation | `emit.status()` |
| Render custom UI from a single block | `emit.component()` |
| Update a component as work progresses | Keyed components: same `key`, multiple `emit.component()` calls |
| Build a composite UI from multiple child blocks | Container component on the sequencer |
| Append multiple independent items (log entries, cards) | `emit.component()` without a key, one call per item |
| Show a deterministic block call as a tool pill | Wrap the block with [`.asTool()`](../fundamentals/blocks.md#showing-a-deterministic-call-as-a-tool-astool) in the sequencer step |

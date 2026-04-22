---
sidebar_position: 2
---

# Emitting Items

Generators emit messages automatically as they stream. But blocks can also emit items explicitly using the context methods. This is how you send progress updates, render custom UI components, and build multi-block interfaces.

## Messages

`ctx.emitMessage()` sends a chat message to the user. The message also enters LLM conversation history, so future model calls can see it.

```ts
const notify = handler({
  name: "notify",
  execute: async (input, ctx) => {
    ctx.emitMessage("Your file has been saved.");
    return input;
  },
});
```

Most of the time you won't call `emitMessage()` directly — generators handle message emission as the model streams. Use it in handlers when you need to inject a visible message into the conversation outside of a generator.

### Stamping identity on handler emits

Handler-emitted messages default to agent-equivalent visibility (on the client, in conversation history). To mark a message as observability-only (devtool visible, hidden from user and LLM) or tie it to a sub-agent identity, pass `agentType` / `agentName`:

```ts
ctx.emitMessage("Debug: classifier chose route A", {
  agentType: "trace",
  agentName: "classifier",
});

ctx.emitMessage("Background audit complete.", {
  agentType: "sub-agent",
  agentName: "auditor",
});
```

Without identity options, the item is client- and history-visible — the ergonomic default for handlers that speak directly to the user. See [Generator identity](items#generator-identity) for the full model.

## Status messages

`ctx.emitStatus()` sends a transient progress indicator. It appears briefly in the UI during execution but is never persisted and doesn't enter LLM history. Use it to tell the user what's happening during long operations.

```ts
const pipeline = sequencer({ name: "pipeline" })
  .then(handler({
    name: "fetch-data",
    execute: async (input, ctx) => {
      ctx.emitStatus("Fetching data from external API...");
      const data = await fetchExternalData();
      ctx.emitStatus("Processing results...");
      return processData(data);
    },
  }))
  .then(analyzer);
```

Status messages are fire-and-forget. They're lightweight by design — emit them freely to keep the user informed without cluttering session history.

Good status messages are specific: "Searching 3 databases..." is better than "Working...". They help users understand what's taking time.

## Components

`ctx.emitComponent()` sends structured data to a registered UI component. Unlike messages, component items don't enter LLM history — they're purely for rendering custom UI.

### Basic usage

```ts
execute: async (input, ctx) => {
  ctx.emitComponent("search-results", {
    query: input.query,
    results: searchResults,
    totalCount: 42,
  });
  return input;
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
ctx.emitComponent("task-status", { id: "task-1", status: "pending" }, { key: "task-1" });

// Update it as work progresses
await step1();
ctx.emitComponent("task-status", { id: "task-1", status: "running", progress: 50 }, { key: "task-1" });

await step2();
ctx.emitComponent("task-status", { id: "task-1", status: "complete", result: "..." }, { key: "task-1" });
```

Each `emitComponent` call with the same key replaces the previous one. Live clients see each intermediate state via SSE. All versions are persisted, but the UI shows just the most recent one for each key.

This pattern is central to how the framework's built-in patterns work. The plan-and-execute pattern, for example, emits keyed components for each task so they update independently:

```ts
// Each task gets its own key
ctx.emitComponent("plan-task", { id: task.id, status: "running" }, { key: `plan-task:${task.id}` });
// Later, same key replaces it
ctx.emitComponent("plan-task", { id: task.id, status: "complete" }, { key: `plan-task:${task.id}` });
```

### Updating across blocks

Keyed components work across multiple blocks in a sequencer. Different blocks can emit to the same key:

```ts
// First block creates the initial view
ctx.emitComponent("task-status", { id: "task-1", status: "pending" }, { key: "task-1" });

// Later block updates the same view
ctx.emitComponent("task-status", { id: "task-1", status: "complete", result: "..." }, { key: "task-1" });
```

### Multiple calls without a key

If you call `emitComponent()` multiple times with the same component name but no `key`, each call creates a separate persisted item. They all render independently in the UI. This is the right approach when each emission represents a distinct piece of output — search result cards, log entries, individual items in a list.

## Container components

Containers group items from multiple blocks into a single UI component. When a sequencer or router declares a `container`, all items emitted by its child blocks are visually owned by the container.

```ts
const pipeline = sequencer({
  name: "research",
  container: { component: "research-panel" },
})
  .then(searchBlock)     // emits component items
  .then(analyzeBlock)    // emits more component items
  .then(summarizeBlock); // emits the final summary
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

## Choosing the right approach

| Scenario | What to use |
|----------|-------------|
| Show text to the user and LLM | `emitMessage()` |
| Show progress during a long operation | `emitStatus()` |
| Render custom UI from a single block | `emitComponent()` |
| Update a component as work progresses | Keyed components: same `key`, multiple `emitComponent()` calls |
| Build a composite UI from multiple child blocks | Container component on the sequencer |
| Append multiple independent items (log entries, cards) | `emitComponent()` without a key, one call per item |

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
    ctx.emitMessage("Your file has been saved.").done();
    return input;
  },
});
```

The returned handle supports streaming for longer content:

```ts
const handle = ctx.emitMessage("Starting analysis");
handle.appendDelta("...found 3 issues");
handle.appendDelta("...all resolved");
handle.done();
```

Live clients see each delta appear in real time. The persisted record holds the final accumulated text.

Most of the time you won't call `emitMessage()` directly — generators handle message emission as the model streams. Use it in handlers when you need to inject a visible message into the conversation outside of a generator.

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

Status messages are fire-and-forget. No handle, no `.done()` call. They're lightweight by design — emit them freely to keep the user informed without cluttering session history.

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
  }).done();
  return input;
}
```

Each call creates one persisted item. The component name (`"search-results"`) maps to a React component you register on the client:

```tsx
<FlowProvider renderers={{ component: { "search-results": SearchResults } }}>
```

### Streaming updates

For components that change over time — progress indicators, plans being executed, results accumulating — use the handle's `update()` method:

```ts
const handle = ctx.emitComponent("progress", { percent: 0, label: "Starting" });

await step1();
handle.update({ percent: 33, label: "Step 1 complete" });

await step2();
handle.update({ percent: 66, label: "Step 2 complete" });

await step3();
handle.update({ percent: 100, label: "Done" });
handle.done();
```

`update()` mutates the item's data in-place. Live clients see each intermediate state via SSE. Only the final state (after `done()`) is persisted. There is no history of intermediate updates stored — if you need that, emit separate items instead.

### Keyed components

When you emit a component with the same `key`, the client replaces the previous component instead of appending a new one. This is useful when multiple blocks update the same view:

```ts
// First block creates the initial view
ctx.emitComponent("task-status", { id: "task-1", status: "pending" }, { key: "task-1" }).done();

// Later block updates the same view
ctx.emitComponent("task-status", { id: "task-1", status: "complete", result: "..." }, { key: "task-1" }).done();
```

The client only renders the latest component for each key within a request. Both items are persisted, but the UI shows just the most recent one.

This pattern is central to how the framework's built-in patterns work. The plan-and-execute pattern, for example, emits keyed components for each task so they update independently:

```ts
// Each task gets its own key
emitComponent("plan-task", { id: task.id, status: "running" }, { key: `plan-task:${task.id}` }).done();
// Later, same key replaces it
emitComponent("plan-task", { id: task.id, status: "complete" }, { key: `plan-task:${task.id}` }).done();
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
| Render custom UI from a single block | `emitComponent().done()` |
| Update a component as work progresses within one block | `handle.update()` then `handle.done()` |
| Update a view across multiple blocks in a sequencer | Keyed components: same `key`, multiple `emitComponent()` calls |
| Build a composite UI from multiple child blocks | Container component on the sequencer |
| Append multiple independent items (log entries, cards) | `emitComponent()` without a key, one call per item |

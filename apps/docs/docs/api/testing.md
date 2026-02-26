---
sidebar_position: 5
---

# Testing API

`@flow-state-dev/testing` — Deterministic test harnesses for blocks, flows, and generators.

## Test Harnesses

### `testBlock(block, options)`

Test any block in isolation.

```ts
import { testBlock } from "@flow-state-dev/testing";

const result = await testBlock(myBlock, {
  input: { message: "hello" },
  session: { state: { count: 0 } },
  generators: {
    "chat-gen": { output: "Hi!" },
  },
});

result.output;          // Block output
result.items;           // Emitted items
result.session.state;   // Final session state
```

### `testSequencer(sequencer, options)`

Test a sequencer pipeline.

```ts
import { testSequencer } from "@flow-state-dev/testing";

const result = await testSequencer(pipeline, {
  input: { message: "hello" },
  session: { state: {} },
  generators: { /* ... */ },
});
```

### `testRouter(router, options)`

Test a router block.

```ts
import { testRouter } from "@flow-state-dev/testing";

const result = await testRouter(myRouter, {
  input: { mode: "chat", message: "hello" },
  generators: { /* ... */ },
});
```

### `testFlow(options)`

Test a complete flow action execution.

```ts
import { testFlow } from "@flow-state-dev/testing";

const result = await testFlow({
  flow: myFlow,
  action: "chat",
  input: { message: "hello" },
  userId: "testuser",
  seed: {
    session: {
      state: { mode: "chat" },
      resources: { plan: { steps: [], status: "draft" } },
    },
  },
  generators: {
    "chat-gen": { output: "Hi!" },
  },
  models: {
    "gpt-5-mini": { output: "Fallback" },
  },
  unmockedGeneratorPolicy: "error",  // "error" | "passthrough"
});
```

## Generator Mocks

### `mockGenerator(options)`

Create a scripted generator mock.

```ts
import { mockGenerator } from "@flow-state-dev/testing";

const mock = mockGenerator({
  name: "chat-gen",
  output: { response: "Mocked" },
  items: [
    { type: "message", role: "assistant", content: [{ type: "text", text: "Mocked" }] },
  ],
});
```

### `createMockModelResolver(options)`

Create a mock model resolver for testing.

```ts
import { createMockModelResolver } from "@flow-state-dev/testing";

const resolver = createMockModelResolver({
  models: {
    "gpt-5-mini": { output: "Mock response" },
  },
});
```

## Assertion Helpers

### `testItems(items)`

Wrap items for fluent assertions.

```ts
import { testItems } from "@flow-state-dev/testing";

const items = testItems(result.items);

items.messages();       // MessageItem[]
items.blockOutputs();   // BlockOutputItem[]
items.ofType("tool_call");  // Items of specific type
```

### `snapshotTrace(result)`

Generate a trace summary for debugging.

```ts
import { snapshotTrace } from "@flow-state-dev/testing";

const trace = snapshotTrace(result);
// Summary of steps, items, and state changes
```

## Context

### `createTestContext(options?)`

Create an isolated runtime context for manual testing.

```ts
import { createTestContext } from "@flow-state-dev/testing";

const ctx = createTestContext({
  session: { state: { count: 0 } },
});
```

## Mock Resolution Order

Generator mocks are resolved in this order:
1. By generator block name (`generators` option)
2. By model ID (`models` option)
3. `unmockedGeneratorPolicy` determines behavior when no mock matches

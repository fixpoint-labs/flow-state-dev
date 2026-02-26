---
sidebar_position: 6
---

# Testing

Flow State Dev includes a dedicated testing package with deterministic test harnesses for blocks, flows, and generators.

## Test Harnesses

### Testing a Block

```ts
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";

const counter = handler({
  name: "counter",
  execute: async (input, ctx) => {
    await ctx.session.incState({ count: 1 });
    return { counted: true };
  },
});

const result = await testBlock(counter, {
  input: { message: "hello" },
  session: { state: { count: 0 } },
});

expect(result.output).toEqual({ counted: true });
expect(result.session.state.count).toBe(1);
```

### Testing a Flow

```ts
import { testFlow } from "@flow-state-dev/testing";
import myFlow from "./flow";

const result = await testFlow({
  flow: myFlow,
  action: "chat",
  input: { message: "hello" },
  userId: "testuser",
  generators: {
    "chat-gen": { output: { response: "Hi there!" } },
  },
});

expect(result.items).toContainEqual(
  expect.objectContaining({ type: "message" })
);
```

### Testing a Sequencer

```ts
import { testSequencer } from "@flow-state-dev/testing";

const result = await testSequencer(pipeline, {
  input: { message: "hello" },
  session: { state: { mode: "chat" } },
  generators: {
    "chat-gen": { output: { response: "Hi!" } },
  },
});
```

## Mocking Generators

Generators call LLMs, which aren't deterministic. The testing package provides scripted mocks:

```ts
import { mockGenerator } from "@flow-state-dev/testing";

const mock = mockGenerator({
  name: "chat-gen",
  output: { response: "Mocked response" },
  items: [
    { type: "message", role: "assistant", content: [{ type: "text", text: "Mocked response" }] },
  ],
});
```

In test harnesses, mock generators by name:

```ts
const result = await testBlock(myBlock, {
  input: { message: "hello" },
  generators: {
    "chat-gen": { output: { response: "Mocked!" } },
  },
});
```

## Seeding State

All test harnesses support seeding scope state and resources:

```ts
const result = await testFlow({
  flow: myFlow,
  action: "run",
  input: { prompt: "hello" },
  userId: "testuser",
  seed: {
    session: {
      state: { mode: "agent" },
      resources: {
        plan: { steps: ["step1"], status: "active" },
      },
    },
    user: {
      state: { preferredModel: "gpt-4o-mini" },
    },
  },
});
```

## Item Assertions

Use `testItems` for assertions on emitted items:

```ts
import { testItems } from "@flow-state-dev/testing";

const items = testItems(result.items);

// Check item types
expect(items.messages()).toHaveLength(2);
expect(items.blockOutputs()).toHaveLength(1);
expect(items.ofType("tool_call")).toHaveLength(3);
```

## Key Principles

- **Deterministic** — Generator mocks ensure reproducible tests
- **Isolated** — Each test harness creates an isolated runtime context with in-memory stores
- **Framework-contract focused** — Test harnesses validate the same contracts the runtime enforces
- **No network required** — Everything runs in-process with mocked LLM responses

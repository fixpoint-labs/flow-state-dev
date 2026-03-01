---
sidebar_position: 7
---

# Testing

LLMs aren't deterministic. But your tests should be. flow-state.dev ships a dedicated testing package that lets you write fully deterministic tests for blocks, pipelines, and complete flows — no real LLM calls, no network, no flaky tests.

## Test harnesses

### Testing a block

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

### Testing a flow end-to-end

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

const items = testItems(result.items);
expect(items.messages()).not.toHaveLength(0);
expect(result.status).toBe("completed");
```

### Testing a sequencer

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

## Mocking generators

The testing package replaces real LLM calls with scripted responses. You control exactly what the generator returns:

```ts
import { mockGenerator } from "@flow-state-dev/testing";

// Simple: just the output
const mock = mockGenerator({
  name: "chat-gen",
  output: { response: "Mocked response" },
});

// With items: control what gets emitted to the stream
const mock = mockGenerator({
  name: "chat-gen",
  output: "Mocked response",
  items: [
    { type: "message", role: "assistant", content: [{ type: "text", text: "Mocked response" }] },
  ],
});

// Scripted sequence: different responses for successive calls
const mock = mockGenerator({
  name: "chat-gen",
  script: [
    { text: "First response" },
    { text: "Second response" },
  ],
});
```

In test harnesses, pass mocks by generator name:

```ts
const result = await testBlock(myPipeline, {
  input: { message: "hello" },
  generators: {
    "chat-gen": { output: "Mocked!" },
    "summary-gen": { output: "Brief summary." },
  },
});
```

## Seeding state and resources

All test harnesses support seeding scoped state and resources to set up the scenario you want to test:

```ts
const result = await testFlow({
  flow: myFlow,
  action: "run",
  input: { prompt: "hello" },
  userId: "testuser",
  seed: {
    session: {
      state: { mode: "agent", messageCount: 5 },
      resources: {
        plan: { steps: ["step1"], status: "active" },
      },
    },
    user: {
      state: { preferredModel: "gpt-4o-mini" },
    },
  },
  generators: {
    "agent-gen": { output: "Done!" },
  },
});
```

## Item assertions

Use `testItems` for expressive assertions on emitted items:

```ts
import { testItems } from "@flow-state-dev/testing";

const items = testItems(result.items);

expect(items.messages()).toHaveLength(2);
expect(items.blockOutputs()).toHaveLength(1);
expect(items.byType("tool_call")).toHaveLength(3);
expect(items.byType("state_change")).not.toHaveLength(0);
```

## What makes this different

- **Deterministic** — Generator mocks produce the same output every time. No flaky tests from LLM variance.
- **Isolated** — Each test harness creates a fresh runtime context with in-memory stores. No shared state between tests.
- **Full-contract testing** — Test harnesses enforce the same validation, lifecycle, and execution contracts as the production runtime. If it passes in tests, it'll behave the same way in production.
- **No network** — Everything runs in-process. No HTTP servers, no SSE connections, no external dependencies.

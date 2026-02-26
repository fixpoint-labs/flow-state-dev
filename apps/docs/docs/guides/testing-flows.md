---
sidebar_position: 4
---

# Testing Flows

How to write deterministic tests for your flows and blocks using `@flow-state-dev/testing`.

## Setup

```bash
pnpm add -D @flow-state-dev/testing vitest
```

## Testing Blocks

### Handler

```ts
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";

const validator = handler({
  name: "validator",
  inputSchema: z.object({ email: z.string() }),
  outputSchema: z.object({ valid: z.boolean() }),
  execute: async (input) => ({
    valid: input.email.includes("@"),
  }),
});

test("validates email format", async () => {
  const result = await testBlock(validator, {
    input: { email: "user@example.com" },
  });
  expect(result.output.valid).toBe(true);
});
```

### Generator (with mocks)

Generators call LLMs, so tests use scripted mocks:

```ts
import { testBlock } from "@flow-state-dev/testing";

test("chat generator produces response", async () => {
  const result = await testBlock(chatGen, {
    input: { message: "Hello" },
    generators: {
      "chat": { output: "Hi there!" },
    },
  });
  expect(result.output).toBe("Hi there!");
});
```

### Sequencer

```ts
import { testSequencer } from "@flow-state-dev/testing";

test("pipeline processes message", async () => {
  const result = await testSequencer(pipeline, {
    input: { message: "Hello" },
    session: { state: { messageCount: 0 } },
    generators: {
      "chat": { output: "Hi!" },
    },
  });
  expect(result.session.state.messageCount).toBe(1);
});
```

## Testing Flows (End-to-End)

`testFlow` tests the full action execution path:

```ts
import { testFlow } from "@flow-state-dev/testing";
import myFlow from "../flow";

test("chat action works end-to-end", async () => {
  const result = await testFlow({
    flow: myFlow,
    action: "chat",
    input: { message: "What is AI?" },
    userId: "testuser",
    generators: {
      "chat": { output: "AI is artificial intelligence." },
    },
  });

  // Check emitted items
  expect(result.items).toContainEqual(
    expect.objectContaining({ type: "message", role: "user" })
  );

  // Check final state
  expect(result.session.state.messageCount).toBe(1);
});
```

## Seeding State

Pre-populate scope state and resources:

```ts
const result = await testFlow({
  flow: myFlow,
  action: "run",
  input: { prompt: "Continue" },
  userId: "testuser",
  seed: {
    session: {
      state: { mode: "agent", step: 3 },
      resources: {
        plan: { steps: ["step1", "step2"], status: "active" },
      },
    },
    user: {
      state: { preferredModel: "gpt-4o" },
    },
  },
  generators: {
    "agent": { output: { action: "complete" } },
  },
});
```

## Mock Generator Options

### Simple output mock

```ts
generators: {
  "chat": { output: "Hello!" },
}
```

### Mock with items

```ts
generators: {
  "chat": {
    output: "Hello!",
    items: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello!" }],
      },
    ],
  },
}
```

### Mock by model ID (fallback)

```ts
models: {
  "gpt-5-mini": { output: "Default response" },
}
```

Generator mocks are resolved by block name first (`generators`), then model ID (`models`).

## Item Assertions

```ts
import { testItems } from "@flow-state-dev/testing";

const items = testItems(result.items);

expect(items.messages()).toHaveLength(2);      // user + assistant
expect(items.blockOutputs()).toHaveLength(1);
expect(items.ofType("tool_call")).toHaveLength(0);
```

## Snapshot Traces

For debugging complex pipelines:

```ts
import { snapshotTrace } from "@flow-state-dev/testing";

const trace = snapshotTrace(result);
// Returns a summary of steps, items, and state changes
```

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

## Running Evals

Evals are different from unit tests. A unit test asserts exact behavior with mocked generators. An eval runs your block or flow against a dataset and measures quality with scorers.

### Block eval

```ts
import { evalBlock, exactMatch, schemaValid } from "@flow-state-dev/testing";
import { z } from "zod";

test("classifier accuracy", async () => {
  const report = await evalBlock(classifier, {
    dataset: [
      { id: "pos-1", input: { text: "Great product!" }, expected: { sentiment: "positive" } },
      { id: "neg-1", input: { text: "Awful experience" }, expected: { sentiment: "negative" } },
      { id: "neu-1", input: { text: "It arrived on Tuesday" }, expected: { sentiment: "neutral" } },
    ],
    scorers: [
      exactMatch("sentiment"),
      schemaValid(z.object({ sentiment: z.enum(["positive", "negative", "neutral"]) })),
    ],
    concurrency: 3,
  });

  expect(report.passed).toBe(true);
  expect(report.summary["exactMatch(sentiment)"].passRate).toBeGreaterThanOrEqual(0.8);
});
```

### Flow eval

```ts
import { evalFlow, contains } from "@flow-state-dev/testing";

test("chat flow quality", async () => {
  const report = await evalFlow(chatFlow({ id: "eval" }), {
    action: "chat",
    dataset: [
      { input: { message: "What is TypeScript?" }, expected: { topic: "typescript" } },
      { input: { message: "How do I test?" }, expected: { topic: "testing" } },
    ],
    scorers: [contains("TypeScript")],
    userId: "eval-user",
  });

  expect(report.passed).toBe(true);
});
```

### Using mocked generators in evals

For deterministic eval runs (CI, regression tests), pass generator mocks through `blockOptions` or `flowOptions`:

```ts
const report = await evalBlock(myGenerator, {
  dataset: cases,
  scorers: [exactMatch()],
  blockOptions: {
    generators: {
      "my-gen": { output: { result: "mocked" } },
    },
  },
});
```

### Loading datasets from files

Inline datasets work for small sets. For larger ones, load from JSON or CSV:

```ts
import { loadDataset, fromCsv } from "@flow-state-dev/testing";

// JSON: expects an array of { input, expected?, id? } objects
const cases = await loadDataset("./fixtures/eval-cases.json");

// CSV: you provide the mapping from row columns to typed objects
const cases = await fromCsv("./fixtures/cases.csv", {
  input: (row) => ({ text: row.prompt }),
  expected: (row) => ({ category: row.label }),
  id: (row) => row.case_id,
});
```

JSON datasets optionally validate against a Zod schema:

```ts
import { z } from "zod";

const cases = await loadDataset("./fixtures/cases.json", {
  schema: z.object({
    input: z.object({ text: z.string() }),
    expected: z.object({ sentiment: z.string() }),
  }),
});
```

### Composing scorers

Use `allOf` and `anyOf` to combine scorers into composite checks:

```ts
import { allOf, anyOf, exactMatch, contains, threshold } from "@flow-state-dev/testing";

const strict = allOf(
  exactMatch("category"),
  threshold("confidence", 0.8),
);

const lenient = anyOf(
  exactMatch("category"),
  contains("relevant"),
);
```

### Reading the report

The `EvalReport` is JSON-serializable, so you can write it to disk or pipe it into CI tooling:

```ts
const report = await evalBlock(myBlock, { dataset, scorers });

// Per-case details
for (const result of report.results) {
  if (!result.passed) {
    console.log(`FAIL ${result.caseId}:`, result.scores);
  }
}

// Aggregate stats per scorer
for (const [name, summary] of Object.entries(report.summary)) {
  console.log(`${name}: mean=${summary.mean} passRate=${summary.passRate}`);
}

// Write to disk for CI
await fs.writeFile("eval-report.json", JSON.stringify(report, null, 2));
```

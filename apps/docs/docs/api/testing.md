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

## Eval Harness

### `evalBlock(block, config)`

Run a block against a dataset and score the results.

```ts
import { evalBlock, exactMatch } from "@flow-state-dev/testing";

const report = await evalBlock(myBlock, {
  dataset: [
    { id: "case-1", input: { text: "hello" }, expected: { label: "greeting" } },
  ],
  scorers: [exactMatch("label")],
  concurrency: 3,          // parallel case execution (default: 1)
  blockOptions: { /* TestBlockOptions minus input */ },
  signal: abortController.signal,
});
```

**Config:**

| Field | Type | Description |
|-------|------|-------------|
| `dataset` | `EvalCase[]` | Array of `{ id?, input, expected?, metadata? }` |
| `scorers` | `Scorer[]` | Scorer functions to grade each result |
| `concurrency` | `number` | Max parallel cases (default: 1) |
| `blockOptions` | `Partial<TestBlockOptions>` | Passed through to `testBlock` (generators, state seeds, etc.) |
| `signal` | `AbortSignal` | Cancellation signal |

### `evalFlow(flow, config)`

Run a flow action against a dataset and score the results.

```ts
import { evalFlow, exactMatch } from "@flow-state-dev/testing";

const report = await evalFlow(myFlow({ id: "eval" }), {
  action: "chat",
  dataset: cases,
  scorers: [exactMatch()],
  userId: "eval-user",
  concurrency: 2,
  flowOptions: { /* TestFlowOptions minus flow/action/input/userId */ },
});
```

**Config:**

| Field | Type | Description |
|-------|------|-------------|
| `action` | `string` | Flow action to execute |
| `dataset` | `EvalCase[]` | Array of test cases |
| `scorers` | `Scorer[]` | Scorer functions |
| `concurrency` | `number` | Max parallel cases (default: 1) |
| `userId` | `string` | User ID for flow execution (default: `"eval-user"`) |
| `flowOptions` | `Partial<TestFlowOptions>` | Passed through to `testFlow` |
| `signal` | `AbortSignal` | Cancellation signal |

### `EvalReport`

Both `evalBlock` and `evalFlow` return an `EvalReport`:

```ts
interface EvalReport {
  passed: boolean;                          // true if every case passed
  results: EvalCaseResult[];                // per-case details
  summary: Record<string, ScorerSummary>;   // aggregate stats per scorer
  timing: { totalMs: number; meanPerCaseMs: number };
}

interface EvalCaseResult {
  caseId: string;
  input: unknown;
  output: unknown;
  expected: unknown;
  error?: { message: string; name: string };
  scores: Record<string, ScoreResult>;
  passed: boolean;
  durationMs: number;
}

interface ScorerSummary {
  mean: number;      // average score across cases
  min: number;
  max: number;
  stddev: number;    // population standard deviation
  passRate: number;  // fraction of cases that passed (0-1)
}
```

## Scorers

All scorers implement this interface:

```ts
type Scorer<TOutput> = {
  name: string;
  threshold?: number;
  score: (args: {
    output: TOutput;
    expected?: Partial<TOutput>;
    input: unknown;
  }) => ScoreResult | Promise<ScoreResult>;
};

interface ScoreResult {
  score: number;    // 0-1 normalized
  passed: boolean;
  reason?: string;  // human-readable explanation on failure
}
```

### `exactMatch(field?)`

Deep equality on the full output, or on a specific field if provided.

```ts
exactMatch()          // compares entire output to expected
exactMatch("label")   // compares output.label to expected.label
```

### `schemaValid(schema)`

Validates output against a Zod schema. Score: 1 if valid, 0 if not. The `reason` includes the Zod error path.

```ts
schemaValid(z.object({ name: z.string(), age: z.number() }))
```

### `contains(substring)`

Checks if the stringified output contains a substring. Case-insensitive.

```ts
contains("error")    // passes if JSON.stringify(output) contains "error"
```

### `jsonPath(path, expected)`

Extracts a value via dot-notation path and compares it to `expected`.

```ts
jsonPath("response.items.0.name", "alice")
```

### `threshold(field, min, max?)`

Checks if a numeric field meets a minimum (and optional maximum).

```ts
threshold("confidence", 0.8)       // >= 0.8
threshold("score", 0, 1)           // between 0 and 1 inclusive
```

### `custom(name, fn)`

Escape hatch for arbitrary scoring logic.

```ts
custom("lengthCheck", ({ output }) => ({
  score: output.length > 10 ? 1 : 0,
  passed: output.length > 10,
  reason: output.length <= 10 ? "Too short" : undefined,
}))
```

### `allOf(...scorers)`

All child scorers must pass. Score = minimum of children.

```ts
allOf(exactMatch("label"), threshold("confidence", 0.8))
```

### `anyOf(...scorers)`

At least one child scorer must pass. Score = maximum of children.

```ts
anyOf(exactMatch("label"), contains("relevant"))
```

### `analyzerScorer(config)`

LLM-as-judge scorer. Bridges `utility.analyzer` into the `Scorer` interface so you can use the framework's analyzer block for subjective evaluation alongside code-based scorers.

```ts
import { analyzerScorer } from "@flow-state-dev/testing";

const report = await evalBlock(myGenerator, {
  dataset: cases,
  scorers: [
    schemaValid(outputSchema),
    analyzerScorer({
      criteria: [
        "Response directly answers the user question",
        "Response does not hallucinate facts not present in the context",
        "Tone is professional and concise",
      ],
      model: "claude-haiku",     // optional: cheaper model for grading
      scoreMapping: "mean",      // "mean" | "min" | { strategy: "weighted", weights }
      threshold: 0.7,            // pass/fail cutoff (default: 0.5)
    }),
  ],
});
```

**Config:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `criteria` | `string[]` | — | Evaluation criteria passed to the analyzer |
| `model` | `string` | analyzer default | Model for grading (use a cheaper model than the one under test) |
| `scoreMapping` | `ScoreMapping` | `"mean"` | How to collapse per-criteria scores into one 0-1 value |
| `name` | `string` | `"analyzerScorer"` | Scorer name in the report |
| `threshold` | `number` | `0.5` | Pass/fail cutoff |

**Score mapping strategies:**

- `"mean"` — Average of all criteria scores. Good default.
- `"min"` — Worst criteria wins. Use when any single failure should fail the case.
- `{ strategy: "weighted", weights: { "accuracy": 3, "style": 1 } }` — Weighted average. Criteria not in `weights` default to weight 1.

### Convenience Scorers

Pre-built `analyzerScorer` variants for common evaluation concerns:

```ts
import { analyzerScorer } from "@flow-state-dev/testing";

analyzerScorer.relevance()     // Output addresses the input query
analyzerScorer.factuality()    // Output contains only factual claims
analyzerScorer.coherence()     // Output is coherent and well-structured
analyzerScorer.safety()        // Output contains no harmful content
```

Each accepts optional config overrides:

```ts
analyzerScorer.relevance({ model: "claude-haiku", threshold: 0.8 })
```

## Dataset Utilities

### `loadDataset(path, options?)`

Load eval cases from a JSON file. Expects an array of objects with at least an `input` field.

```ts
import { loadDataset } from "@flow-state-dev/testing";

const cases = await loadDataset("./fixtures/cases.json");

// With Zod validation
const cases = await loadDataset("./fixtures/cases.json", {
  schema: z.object({
    input: z.object({ text: z.string() }),
    expected: z.object({ label: z.string() }),
  }),
});
```

Auto-generates `id` fields for cases that don't have one (`case-0`, `case-1`, etc.).

### `fromCsv(path, mapping)`

Parse a CSV file into typed eval cases. The first row is treated as headers.

```ts
import { fromCsv } from "@flow-state-dev/testing";

const cases = await fromCsv("./fixtures/cases.csv", {
  input: (row) => ({ text: row.prompt }),
  expected: (row) => ({ label: row.category }),
  id: (row) => row.case_id,   // optional
});
```

Handles quoted fields with commas and escaped quotes (`""`). Does not handle multi-line quoted fields.

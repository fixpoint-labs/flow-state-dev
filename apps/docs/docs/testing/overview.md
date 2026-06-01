---
sidebar_position: 1
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

## Evals

Unit tests tell you if your code is correct. Evals tell you if your AI is any good.

The testing package includes an eval harness that runs blocks or flows against a dataset and scores the results. You define the cases, pick the scorers, and get back a report with per-case results and aggregate statistics.

### Evaluating a block

```ts
import { evalBlock, exactMatch, contains } from "@flow-state-dev/testing";

const report = await evalBlock(classifier, {
  dataset: [
    { input: { text: "I love it" }, expected: { sentiment: "positive" } },
    { input: { text: "Terrible" }, expected: { sentiment: "negative" } },
  ],
  scorers: [exactMatch("sentiment")],
  concurrency: 3,
});

report.passed;    // true if every case passed every scorer
report.summary;   // { "exactMatch(sentiment)": { mean, min, max, stddev, passRate } }
```

### Evaluating a flow

Same idea, but runs the full flow action:

```ts
import { evalFlow, exactMatch } from "@flow-state-dev/testing";

const report = await evalFlow(myFlow({ id: "eval-run" }), {
  action: "classify",
  dataset: cases,
  scorers: [exactMatch()],
  userId: "eval-user",
});
```

### Built-in scorers

Eight code-based scorers ship out of the box. No LLM calls required.

- **`exactMatch(field?)`** — Deep equality on the full output or a specific field.
- **`schemaValid(schema)`** — Validates output against a Zod schema. The failure reason includes the Zod error path.
- **`contains(substring)`** — Checks if the stringified output contains a substring. Case-insensitive.
- **`jsonPath(path, expected)`** — Extracts a value via dot-notation path and compares it.
- **`threshold(field, min, max?)`** — Checks if a numeric field is within bounds.
- **`custom(name, fn)`** — Escape hatch for arbitrary scoring logic.
- **`allOf(...scorers)`** — Composite: all child scorers must pass.
- **`anyOf(...scorers)`** — Composite: at least one child scorer must pass.

### LLM-as-judge scoring

Code-based scorers work when you can define pass/fail with logic: schema validation, exact matches, substring checks. But some qualities — relevance, coherence, factual accuracy — resist programmatic evaluation.

`analyzerScorer` bridges the framework's `utility.analyzer` block into the scorer interface. It runs an LLM to grade each output against criteria you define, then maps the per-criteria scores to a single 0-1 value.

```ts
import { evalBlock, analyzerScorer, schemaValid } from "@flow-state-dev/testing";

const report = await evalBlock(myGenerator, {
  dataset: cases,
  scorers: [
    // Code-based: did it produce valid JSON?
    schemaValid(outputSchema),
    // LLM-as-judge: is the content any good?
    analyzerScorer({
      criteria: [
        "Response directly answers the user question",
        "Response does not hallucinate facts",
        "Tone is professional and concise",
      ],
      model: "claude-haiku",   // cheaper model for grading
      scoreMapping: "mean",    // average across criteria
    }),
  ],
});
```

Four convenience variants cover common concerns without spelling out criteria:

```ts
analyzerScorer.relevance()    // Does the output address the input?
analyzerScorer.factuality()   // Does it stick to the facts?
analyzerScorer.coherence()    // Is it well-structured?
analyzerScorer.safety()       // Is it free of harmful content?
```

The `scoreMapping` option controls how per-criteria scores collapse into one number: `"mean"` (default) averages them, `"min"` takes the worst, and `{ strategy: "weighted", weights: {...} }` lets you weigh criteria differently.

### Datasets from files

Load test cases from JSON or CSV instead of inlining them:

```ts
import { loadDataset, fromCsv } from "@flow-state-dev/testing";

// JSON array of { input, expected, id? } objects
const cases = await loadDataset("./fixtures/sentiment.json");

// CSV with a mapping function
const cases = await fromCsv("./fixtures/cases.csv", {
  input: (row) => ({ text: row.text }),
  expected: (row) => ({ sentiment: row.label }),
});
```

## What makes this different

- **Deterministic** — Generator mocks produce the same output every time. No flaky tests from LLM variance.
- **Isolated** — Each test harness creates a fresh runtime context with in-memory stores. No shared state between tests.
- **Full-contract testing** — Test harnesses enforce the same validation, lifecycle, and execution contracts as the production runtime. If it passes in tests, it'll behave the same way in production.
- **No network** — Everything runs in-process. No HTTP servers, no SSE connections, no external dependencies.

To execute a flow in a background job or scheduled task outside the test harness, see [Calling a flow without a transport](../advanced/manual-flow-execution.md).

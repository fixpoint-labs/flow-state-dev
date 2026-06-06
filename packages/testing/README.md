# @flow-state-dev/testing

Deterministic test utilities for Flow State Dev runtime contracts.

## Installation

```bash
pnpm add -D @flow-state-dev/testing
```

This package provides:
- isolated runtime harness creation (`createTestContext`)
- block/flow test helpers (`testBlock`, `testSequencer`, `testRouter`, `testFlow`)
- eval harness (`evalBlock`, `evalFlow`) with built-in and custom scorers
- LLM-as-judge scoring (`analyzerScorer`) via `utility.analyzer`
- item assertion helpers (`testItems`)
- snapshot trace summaries (`snapshotTrace`)
- scripted generator mocks (`mockGenerator`)
- model-resolver mock adapter (`createMockModelResolver`)

## Public API

- `createTestContext(options?)`
- `testBlock(block, options)`
- `testSequencer(sequencer, options)`
- `testRouter(router, options)`
- `testFlow(options)`
- `testItems(items)`
- `snapshotTrace(result)`
- `mockGenerator(options)`
- `createMockModelResolver(options)`

## Quick usage

```ts
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";

const block = handler<{ amount: number }, { ok: boolean }>({
  name: "increment",
  execute: async (input, ctx) => {
    await ctx.session.incState({ count: input.amount });
    return { ok: true };
  },
});

const result = await testBlock(block, {
  input: { amount: 1 },
  session: { state: { count: 0 } },
});
```

### Seeding scope state and resources

`testFlow` and `testBlock` use nested scope seeds:

```ts
const result = await testFlow({
  flow,
  action: "run",
  input: { message: "hello" },
  userId: "devuser",
  seed: {
    session: {
      state: { mode: "chat" },
      resources: {
        artifacts: { byId: {}, order: [] },
      },
    },
    user: {
      state: { preferredModel: "openai/gpt-5.4-mini" },
    },
  },
});
```


### Seeding sequencer context in block tests

`testBlock` and `testSequencer` accept `sequencer` to mock the nearest enclosing sequencer (`ctx.sequencer`) and capture sequencer instance state mutations in `result.stateChanges` with `scope: "block_instance"`.

```ts
const result = await testSequencer(mySequencer, {
  input: { value: 1 },
  sequencer: {
    // defaults to the tested block name when omitted
    name: "research",
    state: { progress: 0 },
  },
});

expect(result.state.sequencer.progress).toBeGreaterThanOrEqual(0);
expect(result.stateChanges.some((change) => change.scope === "block_instance")).toBe(true);
```

## Eval Harness

Run blocks or flows against a dataset and score the results:

```ts
import { evalBlock, exactMatch, analyzerScorer } from "@flow-state-dev/testing";

const report = await evalBlock(classifier, {
  dataset: [
    { input: { text: "I love it" }, expected: { sentiment: "positive" } },
    { input: { text: "Terrible" }, expected: { sentiment: "negative" } },
  ],
  scorers: [
    exactMatch("sentiment"),
    analyzerScorer({
      criteria: ["Output is relevant to the input"],
      model: "anthropic/claude-haiku",
    }),
  ],
  concurrency: 3,
});
```

### LLM-as-Judge via `analyzerScorer`

`analyzerScorer` bridges `utility.analyzer` into the `Scorer` interface for subjective evaluation:

```ts
analyzerScorer({
  criteria: ["Accurate", "Concise", "Professional tone"],
  model: "claude-haiku",       // cheaper model for grading
  scoreMapping: "mean",        // "mean" | "min" | { strategy: "weighted", weights }
  threshold: 0.7,              // pass/fail cutoff
})
```

Convenience variants for common concerns:

```ts
analyzerScorer.relevance()     // Output addresses the input
analyzerScorer.factuality()    // Only factual claims
analyzerScorer.coherence()     // Well-structured output
analyzerScorer.safety()        // No harmful content
```

## Benchmarking patterns

An eval scores one block or flow. A benchmark compares whole coordination patterns against each other and a single-generator baseline, on the same tasks and the same model, so the only variable is the coordination shape. Each task carries a locked rubric; a blinded judge (a distinct model) scores every output against it, with `k` repetitions and a credibility flag so a delta inside the noise isn't reported as a win.

`comparePatterns` takes the registry as its first argument (so this package never imports `@flow-state-dev/patterns`), resolves the pattern names, appends the baseline, and runs:

```ts
import { comparePatterns, renderScorecard } from "@flow-state-dev/testing";
import { defaultBenchmarkRegistry } from "@flow-state-dev/patterns";

const report = await comparePatterns(
  defaultBenchmarkRegistry,
  ["supervisor", "debate"],
  {
    tasks,
    model: "openai/gpt-5.4-mini",
    judgeModel: "anthropic/claude-haiku-4-5",
    runs: 3,
  },
);

console.log(renderScorecard(report, "table"));
```

Other entry points: `runBenchmark` for explicit subjects, `baselineSubject` for the control, `defineBenchmark` for the `fsdev benchmark` discovery shape. See the [Benchmarks docs](https://flow-state.dev/docs/testing/benchmarks) for the full surface.

## Scripts

- `pnpm --filter @flow-state-dev/testing build`
- `pnpm --filter @flow-state-dev/testing typecheck`
- `pnpm --filter @flow-state-dev/testing test`

### Predicate-driven mock generators

Concurrent patterns (supervisor's worker pool, parallel plan-and-execute steps) call the same generator block with different inputs. Plain script entries are consumed in order — fragile when call ordering isn't guaranteed. Predicate entries match against the input and remain matchable on every call:

```ts
mockGenerator({
  name: "worker",
  script: [
    { when: (input) => JSON.stringify(input).includes("Task A"), then: { text: "Did A" } },
    { when: (input) => JSON.stringify(input).includes("Task B"), then: { text: "Did B" } },
    { when: () => true, then: { text: "Default" } }, // catch-all
  ],
});
```

Plain steps and predicate entries mix freely. Predicates win when they fire; otherwise the next plain step is consumed.

When a returned step has `toolCalls` but no `text` / `structuredOutput`, the mock model resolver invokes each tool's `execute` closure and pulls the next script step — mirroring the AI SDK's internal multi-step loop.

### Tool-call observability

The resolved model exposes both `generate()` and `stream()`, matching the production `GeneratorModel` contract. The framework routes mock-driven tests through the streaming branch, so a script with `toolCalls` now produces `tool_call_progress` items on the response stream — the same items real flows emit. Tests built around `result.items` see the same shape end users observe.

If you previously relied on the absence of `tool_call_progress` items from a mock (or wrapped the resolver to synthesise a `stream()` yourself), the wrapper is no longer needed and assertions may need updating to expect the items.

### Sharing stores across runs

`testFlow` accepts an optional `stores: StoreRegistry`. Pass the same registry to two calls and the second resumes from the first run's session, journal, and resource state:

```ts
import { createInMemoryStores } from "@flow-state-dev/server";

const stores = createInMemoryStores();
await testFlow({ flow, action, userId, sessionId: "s1", stores, /* ... */ });
await testFlow({ flow, action, userId, sessionId: "s1", stores, /* ... */ });
```

Seeding is idempotent — already-present users/sessions/orgs aren't re-`set`, so the second run preserves the first run's mutations.

## Notes

- Utilities are intentionally framework-contract focused, not app-specific.
- `testSequencer` step/work traces are inferred from emitted item provenance in Phase 1.
- Generator mocks are resolved by generator block name first (`generators`) and model id second (`models`).
- `testFlow` accepts `generators`, `models`, `unmockedGeneratorPolicy`, and an optional `stores` registry.

## Architecture Reference

- [Blocks](https://flow-state.dev/docs/fundamentals/blocks) — block kinds, BlockContext
- [Error Handling](https://flow-state.dev/docs/advanced/error-handling) — retry, rescue, error model
- [State and Scopes](https://flow-state.dev/docs/fundamentals/state-and-scopes) — scope hierarchy, state ops

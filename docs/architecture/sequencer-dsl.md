# Sequencer DSL Reference

The sequencer is the primary composition primitive in Flow State Dev. It provides a fluent DSL for chaining blocks into pipelines with branching, parallelism, error recovery, and background work.

## Creating a Sequencer

```ts
import { sequencer } from "@flow-state-dev/core";

const pipeline = sequencer({
  name: "my-pipeline",
  inputSchema: z.object({ message: z.string() }),
});
```

The sequencer itself is a block — it has `inputSchema`, `outputSchema`, and can be used anywhere a block is expected.

Sequencer config also supports instance state:

- `stateSchema`: Zod schema for mutable sequencer instance state
- `defaultState`: optional explicit initial state (applied before schema defaults)

```ts
const research = sequencer({
  name: "research",
  inputSchema: z.object({ topic: z.string() }),
  stateSchema: z.object({
    progress: z.number().default(0),
    phase: z.string().default("draft"),
  }),
  defaultState: { phase: "planning" },
});
```

Blocks inside the sequencer can declare `sequencerStateSchema` to type `ctx.sequencer`, and can also resolve named ancestors via `ctx.getTarget(name)`.

## Method Reference

### `then(block)` — Sequential Step

Execute a block, passing the previous output as input.

```ts
pipeline
  .then(processBlock)
  .then(saveBlock);
```

With a connector to transform input:

```ts
pipeline.then(
  (output, ctx) => ({ query: output.text }),
  searchBlock
);
```

Inline block definition:

```ts
pipeline.then(handler, {
  name: "validate",
  outputSchema: z.string(),
  execute: async (input, ctx) => input.toUpperCase(),
});
```

### `thenIf(condition, block)` — Conditional Step

Execute only when condition returns true. Output type is union of current and step output.

```ts
pipeline.thenIf(
  (input, ctx) => ctx.session.state.needsReview,
  reviewBlock
);
```

### `map(fn)` — Transform Value

Transform the current value without a block.

```ts
pipeline.map((value, ctx) => ({ summary: value.text, count: value.items.length }));
```

### `parallel(steps)` — Concurrent Execution

Execute named steps concurrently. Output is an object with results keyed by step name.

```ts
pipeline.parallel({
  analysis: analysisBlock,
  summary: summaryBlock,
  tags: { connector: (input) => input.text, block: tagBlock },
}, { maxConcurrency: 3 });

// Output: { analysis: ..., summary: ..., tags: ... }
```

### `forEach(block)` — Iterate Array

Execute a block for each element. Input must be array-like.

```ts
pipeline
  .map((input) => input.items)   // Extract array
  .forEach(processItemBlock, { maxConcurrency: 5 });

// Output: ProcessedItem[]
```

With a connector to extract the array:

```ts
pipeline.forEach(
  (input) => input.items,
  processItemBlock,
  { maxConcurrency: 5 }
);
```

Dynamic block per item:

```ts
pipeline.forEach((item, index, ctx) => {
  return item.type === "urgent" ? urgentBlock : normalBlock;
});
```

### `forEachBackground(block)` — Fire-and-Forget Fan-Out

Dispatch each element to a block as background work. The parent sequencer continues immediately without waiting for iterations to complete. Each iteration runs as a sidechain with `.work()` lifetime semantics.

```ts
pipeline
  .map((input) => input.subscribers)
  .forEachBackground(notifyBlock, { concurrency: 8 });

// Output: Subscriber[] (original array — NOT the block results)
```

With a connector:

```ts
pipeline.forEachBackground(
  (input) => input.channels,
  broadcastBlock,
  { concurrency: 4 }
);
```

Dynamic block per item:

```ts
pipeline.forEachBackground((item, index, ctx) => {
  return item.urgent ? urgentNotify : normalNotify;
});
```

**Key differences from `forEach`:**

| | `forEach` | `forEachBackground` |
|---|---|---|
| **Timing** | Blocks until all iterations complete | Dispatches and continues immediately |
| **Return type** | `T[]` (array of block outputs) | Pass-through (original input unchanged) |
| **Failure handling** | Any iteration failure aborts the parent | Failures are isolated — one failing iteration doesn't stop others or the parent |
| **Use case** | Transform a collection | Broadcast/fan-out (notifications, cache warming, analytics) |

**Options:**

| Option | Default | Effect |
|--------|---------|--------|
| `concurrency` | 16 | Maximum number of iterations running simultaneously |

**Lifecycle:** Background iterations are auto-awaited when the sequencer finishes (same as `.work()` tasks). Parent flow cancellation cancels in-flight iterations via the abort signal.

### `doUntil(condition, block)` — Loop Until True

Execute block repeatedly until condition returns true.

```ts
pipeline.doUntil(
  (value, ctx) => value.confidence > 0.9,
  refineBlock
);
```

### `doWhile(condition, block)` — Loop While True

Execute block repeatedly while condition returns true.

```ts
pipeline.doWhile(
  (value, ctx) => value.remaining > 0,
  processNextBatch
);
```

### `loopBack(stepName, opts)` — Jump to Named Step

Jump back to a previously named step. **Always bounded** with `maxIterations`.

```ts
pipeline
  .then(generateBlock)  // step name comes from block.name
  .then(validateBlock)
  .loopBack("generate-block", {
    when: (value, ctx) => !value.isValid,
    maxIterations: 3,
  });
```

### `work(block)` — Background Work

Queue non-aborting side-chain execution. The main pipeline continues immediately.

```ts
pipeline
  .then(mainProcessing)
  .work(analyticsBlock)       // runs in background
  .work(notificationBlock)    // runs in background
  .then(nextStep);            // continues immediately
```

With a connector:

```ts
pipeline.work(
  (output) => ({ event: "processed", data: output }),
  analyticsBlock,
  { name: "log-analytics" }
);
```

**Alias: `.background()`** — identical to `.work()`, reads more naturally in fan-out contexts:

```ts
pipeline
  .then(mainProcessing)
  .background(analyticsBlock)
  .background(notificationBlock)
  .then(nextStep);
```

**Key:** Work failures do NOT abort the main chain. They emit `step_error` items.

**Auto-await:** When the sequencer's main chain finishes, any outstanding work tasks are automatically awaited before the sequencer returns. This ensures the request stream stays open until all background work completes. Before the auto-await, the sequencer emits a `StatusItem` with message `"finishing"` — clients can use this signal to know the main chain's output is ready and it's safe to accept new user input (see `isFinishing` on `SessionView` / `UseRequestStreamResult`).

### `workIf(condition, block)` — Conditional Background Work

Queue a background sidechain only when a condition is truthy. Complete no-op when falsy — no items emitted, no cost incurred.

```ts
pipeline
  .then(mainProcessing)
  .workIf(
    (ctx) => ctx.session.state.features.memory,
    memoryObserveBlock
  )
  .then(nextStep);  // continues immediately regardless of condition
```

The condition is evaluated once per execution before dispatching. It receives the full `BlockContext` so it can read live session/request state.

**Static boolean:** Passing `true` is equivalent to `.work(block)`. Passing `false` makes the step a permanent no-op (useful during development).

```ts
// Feature-flagged background work
pipeline.workIf(ENABLE_ANALYTICS, analyticsBlock);
```

With a connector:

```ts
pipeline.workIf(
  (ctx) => ctx.session.state.observeEnabled,
  (output) => ({ event: "processed", data: output }),
  analyticsBlock,
  { name: "conditional-analytics" }
);
```

When the condition is falsy, the connector is never called.

### `waitForWork(opts)` — Converge Work Queue

Wait for all queued work to complete at a specific point in the pipeline. This is useful when a later step depends on work task results. If you don't need the results mid-pipeline, the auto-await at the end of the sequencer handles it automatically.

```ts
pipeline
  .work(taskA)
  .work(taskB)
  .waitForWork({ failOnError: false });  // wait, but don't fail on work errors
```

| Option | Effect |
|--------|--------|
| `failOnError: false` (default) | Wait for work; failures are non-terminal |
| `failOnError: true` | Promote any work failure to terminal request error |
| `timeoutMs` | Maximum wait time |

### `tap(block)` — Side Effect

Execute a block for its side effects without changing the main payload.

```ts
pipeline
  .tap(logBlock)           // log but don't change output
  .then(nextStep);         // receives original output, not log result

// With a function instead of a block
pipeline.tap(async (value, ctx) => {
  await ctx.session.patchState({ lastProcessed: Date.now() });
});
```

### `tapIf(condition, block)` — Conditional Side Effect

```ts
pipeline.tapIf(
  (value, ctx) => value.score < 0.5,
  alertLowScoreBlock
);
```

### `rescue(handlers)` — Error Recovery

Catch errors from prior steps and route to recovery blocks.

```ts
pipeline
  .then(riskyBlock)
  .rescue([
    { when: [NetworkError], block: retryWithBackupBlock },
    { when: [ModelError], block: fallbackModelBlock },
    { block: genericRecoveryBlock },  // catch-all
  ]);
```

**Behavior:**
- Handlers match by error type, checked in order
- Success converts the segment back to successful chain state
- Failure propagates to the next handler or bubbles up
- Only handles errors from steps **before** the rescue in the chain

### `thenAll(blocks, options?)` — Parallel Array Execution

Run an array of blocks concurrently with the same input. Returns results as an ordered array.

```ts
pipeline.thenAll([
  analysisBlock,
  summaryBlock,
  { connector: (input) => input.text, block: tagBlock },
], { maxConcurrency: 3 });

// Output: [analysisResult, summaryResult, tagResult]
```

Like `Promise.all` — if any block throws, the entire step fails. Results are ordered by array index regardless of completion order.

**Difference from `.parallel()`:** `.parallel()` returns a named object `{ key: result }`. `.thenAll()` returns an ordered array `[result, ...]`. Use `.parallel()` when you need named access to results. Use `.thenAll()` when you have a dynamic list of blocks or prefer array indexing.

### `thenAny(blocks)` — First Successful Result (Sequential)

Try blocks sequentially in order. Return the first successful result; skip remaining blocks.

```ts
pipeline.thenAny([
  primaryProvider,
  fallbackProviderA,
  fallbackProviderB,
]);

// Output: result from primaryProvider if it succeeds,
//         otherwise fallbackProviderA, otherwise fallbackProviderB
```

Blocks are attempted one at a time in array order. On the first success, the result becomes the step output and remaining blocks are never executed. If all blocks fail, throws an `AggregateError` with all individual errors.

### `race(blocks, options?)` — First Successful Result (Concurrent)

Run blocks concurrently, resolve with the first one that succeeds. Abort the rest.

```ts
pipeline.race([
  expensiveDeepAnalysis,
  quickHeuristicAnalysis,
], { maxConcurrency: 4 });

// Output: result from whichever block succeeds first
```

All blocks start concurrently (bounded by `maxConcurrency` if specified). The first block to complete successfully wins. Remaining blocks are signaled for cancellation via abort signal. If all blocks fail, throws an `AggregateError` with all individual errors.

### `exitIf(condition)` — Conditional Early Exit

Exit the sequencer chain early when a condition is met. The current value becomes the sequencer output.

```ts
pipeline
  .then(generateBlock)
  .then(validateBlock)
  .exitIf((value, ctx) => value.confidence > 0.95)
  .then(refineBlock)   // skipped if confidence is high enough
  .then(finalizeBlock); // also skipped
```

The exit proceeds to auto-await of any outstanding `.work()` tasks before returning. Does not skip rescue handlers for errors that occurred before the exit.

### `branch(branches)` — Conditional Multi-Path

Execute the first branch whose condition is true.

```ts
pipeline.branch({
  urgent: [
    (input) => input,
    (input, ctx) => input.priority === "high",
    urgentBlock,
  ],
  normal: [
    (input) => input,
    (input, ctx) => input.priority !== "high",
    normalBlock,
  ],
});
```

Each branch is a tuple: `[connector, condition, block]`.

## Resource Collection

Sequencers automatically collect `declaredResources` from all child blocks added through the DSL chain. Every method that accepts a block — `then`, `thenIf`, `parallel`, `forEach`, `forEachBackground`, `doUntil`, `doWhile`, `work`, `workIf`, `background`, `tap`, `tapIf`, `rescue`, `branch`, `thenAll`, `thenAny`, `race` — merges that block's declared resources into the sequencer's accumulated set.

```ts
const pipeline = sequencer({ name: "pipeline" })
  .then(blockWithSessionResources)     // collects session resources
  .parallel({
    a: blockWithUserResources,         // collects user resources
    b: blockWithProjectResources,      // collects project resources
  })
  .rescue([{ block: recoveryBlock }]); // collects rescue block resources

// pipeline.declaredResources contains the merged union of all child resources
```

Nested sequencers bubble their collected resources upward — a sequencer used as a step in another sequencer contributes all of its accumulated resources.

**Conflict detection:** If two child blocks declare different `defineResource()` references for the same resource name in the same scope, the sequencer throws a build-time error. Same reference = no conflict.

## Schema Propagation

- `outputSchema` on the sequencer config is a declaration of intent
- The runtime `outputSchema` always reflects the chain's actual last step
- `.validate()` throws at build time if declared schema conflicts with actual output
- `inputSchema` is inferred from the first block when not explicitly set

## Container Config

Sequencers can emit visual grouping items:

```ts
sequencer({
  name: "chat-pipeline",
  inputSchema: chatInputSchema,
  container: {
    component: "chat-container",
    label: "Processing chat message",
  },
});
```

This emits a `container` item that wraps child items for UI grouping.

## Canonical Authority

For full type signatures and all overload variants, see `../preperation/architecture/BLOCKS.md` (section 6).

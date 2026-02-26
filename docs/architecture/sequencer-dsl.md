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

**Key:** Work failures do NOT abort the main chain. They emit `step_error` items.

### `waitForWork(opts)` — Converge Work Queue

Wait for all queued work to complete.

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

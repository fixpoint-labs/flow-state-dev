---
sidebar_position: 2
---

# Control Flow

Common composition patterns using the sequencer DSL.

## Basic Pipeline

Chain blocks sequentially:

```ts
const pipeline = sequencer({
  name: "process",
  inputSchema: z.object({ message: z.string() }),
})
  .then(validateBlock)
  .then(chatGen)
  .then(saveBlock);
```

## Input Transformation

Use a connector function to transform input between blocks:

```ts
pipeline.then(
  (output, ctx) => ({ query: output.text }),  // connector
  searchBlock                                  // block
);
```

## Conditional Steps

Execute a block only when a condition is true:

```ts
pipeline.thenIf(
  (input, ctx) => ctx.session.state.needsReview,
  reviewBlock
);
```

## Parallel Execution

Run multiple blocks concurrently with named results:

```ts
pipeline.parallel({
  analysis: analysisBlock,
  summary: summaryBlock,
  tags: { connector: (input) => input.text, block: tagBlock },
}, { maxConcurrency: 3 });

// Output: { analysis: ..., summary: ..., tags: ... }
```

### Parallel with Array Output

When you have a list of blocks rather than named steps, use `.thenAll()`. All blocks receive the same input. Results come back as an ordered array matching the input order, regardless of which block finishes first.

```ts
pipeline.thenAll([
  analysisBlock,
  summaryBlock,
  { connector: (input) => input.text, block: tagBlock },
], { maxConcurrency: 3 });

// Output: [analysisResult, summaryResult, tagResult]
```

This works like `Promise.all`. If any block throws, the entire step fails.

Use `.parallel()` when you want named access to results (`output.analysis`). Use `.thenAll()` when you have a dynamic list of blocks or prefer array indexing (`output[0]`).

## Sequential Fallback

`.thenAny()` tries blocks one at a time, in order. It returns the result of the first block that succeeds. Remaining blocks are never executed.

```ts
pipeline.thenAny([
  primaryProvider,
  fallbackProviderA,
  fallbackProviderB,
]);
```

If `primaryProvider` succeeds, its result becomes the step output and the fallbacks are skipped. If it throws, `fallbackProviderA` runs. If that throws too, `fallbackProviderB` gets its turn. If every block fails, the step throws an `AggregateError` containing all individual errors.

This is useful for provider failover, graceful degradation, or any case where you have ordered preferences and want to try each one until something works.

## Racing

`.race()` starts all blocks concurrently. The first one to succeed wins. The rest are signaled for cancellation via the abort signal.

```ts
pipeline.race([
  expensiveDeepAnalysis,
  quickHeuristicAnalysis,
], { maxConcurrency: 4 });
```

If `quickHeuristicAnalysis` finishes first with a valid result, that becomes the output and `expensiveDeepAnalysis` is aborted. If all blocks fail, throws an `AggregateError`.

### thenAny vs race

The key difference is execution strategy:

| | `thenAny` | `race` |
|--|-----------|--------|
| **Execution** | Sequential: try A, then B, then C | Concurrent: start all at once |
| **When to use** | Ordered fallback chain where you prefer earlier options | Competitive execution where you want the fastest result |
| **Resource cost** | Lower — only runs what's needed | Higher — runs all blocks in parallel |
| **Cancellation** | Never starts blocks after first success | Aborts in-flight blocks after first success |

Use `thenAny` when the blocks have a meaningful priority order. Use `race` when you want the fastest answer regardless of source.

## Early Exit

`.exitIf()` terminates the sequencer chain when a condition is met. The current value becomes the sequencer's output. Steps after the `exitIf` are skipped entirely.

```ts
pipeline
  .then(generateBlock)
  .then(validateBlock)
  .exitIf((value, ctx) => value.confidence > 0.95)
  .then(refineBlock)     // skipped if confidence is high enough
  .then(finalizeBlock);  // also skipped
```

The condition receives the current pipeline value and the block context. It can be async:

```ts
pipeline.exitIf(async (value, ctx) => {
  const cached = await lookupCache(value.key);
  return cached !== null;
});
```

When an exit triggers, any outstanding `.work()` tasks are still auto-awaited before the sequencer returns. The exit skips remaining chain steps but does not skip background work cleanup.

You can place multiple `exitIf` calls in a chain. Each acts as a checkpoint:

```ts
pipeline
  .then(quickCheck)
  .exitIf((v) => v.trivial)       // fast path for trivial inputs
  .then(deepAnalysis)
  .exitIf((v) => v.confident)     // skip refinement if already confident
  .then(refineBlock)
  .then(finalizeBlock);
```

## Iteration

Process array items:

```ts
pipeline
  .map((input) => input.items)     // Extract array
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

## Loops

### Loop Until Condition

```ts
pipeline.doUntil(
  (value, ctx) => value.confidence > 0.9,
  refineBlock
);
```

### Loop While Condition

```ts
pipeline.doWhile(
  (value, ctx) => value.remaining > 0,
  processNextBatch
);
```

### Loop Back to Named Step

```ts
pipeline
  .then(generateBlock)  // step name from block.name
  .then(validateBlock)
  .loopBack("generate-block", {
    when: (value, ctx) => !value.isValid,
    maxIterations: 3,
  });
```

## Background Work

Queue non-blocking side effects:

```ts
pipeline
  .then(mainProcessing)
  .work(analyticsBlock)       // Runs in background
  .work(notificationBlock)    // Runs in background
  .then(nextStep);            // Continues immediately
```

Work failures do NOT abort the main chain. They emit `step_error` items.

### Conditional Background Work

`.workIf()` dispatches a background sidechain only when a condition is truthy. When falsy, it's a complete no-op — no block execution, no items emitted.

```ts
pipeline
  .then(mainProcessing)
  .workIf(
    (ctx) => ctx.session.state.features.memory,
    memoryObserveBlock
  )
  .then(nextStep);  // continues immediately regardless of condition
```

The condition receives the `BlockContext`, so it can check session state, feature flags, or any runtime value. It also accepts a static boolean for compile-time toggling:

```ts
pipeline.workIf(ENABLE_ANALYTICS, analyticsBlock);
```

See [Side Chains](/docs/advanced/sequencer-side-chains) for the full story on `.work()`, `.workIf()`, and `.forEachBackground()`.

### Wait for Work

```ts
pipeline
  .work(taskA)
  .work(taskB)
  .waitForWork({ failOnError: false });  // Wait, don't fail on work errors
```

## Side Effects

Execute a block without changing the main payload:

```ts
pipeline
  .tap(logBlock)         // Log but don't change output
  .then(nextStep);       // Receives original output
```

Conditional side effects:

```ts
pipeline.tapIf(
  (value, ctx) => value.score < 0.5,
  alertLowScoreBlock
);
```

## Error Recovery

Catch errors and route to recovery blocks:

```ts
pipeline
  .then(riskyBlock)
  .rescue([
    { when: [NetworkError], block: retryWithBackupBlock },
    { when: [ModelError], block: fallbackModelBlock },
    { block: genericRecoveryBlock },  // catch-all
  ]);
```

Rescue handlers match by error type (checked in order). Success converts back to the normal chain.

## Branching

Execute the first branch whose condition matches:

```ts
pipeline.branch({
  urgent: [
    (input) => input,
    (input) => input.priority === "high",
    urgentBlock,
  ],
  normal: [
    (input) => input,
    (input) => input.priority !== "high",
    normalBlock,
  ],
});
```

Each branch is a tuple: `[connector, condition, block]`.

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

Run multiple blocks concurrently:

```ts
pipeline.parallel({
  analysis: analysisBlock,
  summary: summaryBlock,
  tags: { connector: (input) => input.text, block: tagBlock },
}, { maxConcurrency: 3 });

// Output: { analysis: ..., summary: ..., tags: ... }
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

## Concurrent Collection

### thenAll — Collect All Results

Run an array of blocks concurrently with the same input. Results come back as an ordered array, matching the input order. If any block throws, the entire step fails.

```ts
pipeline.thenAll([
  analysisBlock,
  summaryBlock,
  { connector: (input) => input.text, block: tagBlock },
], { maxConcurrency: 3 });

// Output: [analysisResult, summaryResult, tagResult]
```

This is the array counterpart to `.parallel()`. Use `.parallel()` when you want named access to results (`{ analysis: ..., summary: ... }`). Use `.thenAll()` when you have a dynamic list or prefer array indexing.

### thenAny — Sequential Fallback

Try blocks one at a time in order. Return the first successful result. Remaining blocks are never executed.

```ts
pipeline.thenAny([
  primaryProvider,
  fallbackProviderA,
  fallbackProviderB,
]);
```

If `primaryProvider` succeeds, the other two never run. If it fails, `fallbackProviderA` runs next. If all blocks fail, throws an `AggregateError` containing every individual error.

This is useful for provider fallback chains, tiered strategies, or any situation where you want to try options in priority order.

### race — Concurrent Competition

Run blocks concurrently. The first block to succeed wins. Remaining blocks are aborted.

```ts
pipeline.race([
  expensiveDeepAnalysis,
  quickHeuristicAnalysis,
], { maxConcurrency: 4 });
```

Both blocks start at the same time. Whichever finishes successfully first becomes the step output. The loser receives an abort signal. If all blocks fail, throws an `AggregateError`.

**Key difference from `thenAny`:** `race` starts everything concurrently and takes the fastest success. `thenAny` tries sequentially and takes the first success. Use `race` when speed matters. Use `thenAny` when order matters (e.g., prefer the primary provider, fall back to secondary only if it fails).

## Early Exit

Stop the sequencer chain before reaching the end:

```ts
pipeline
  .then(generateBlock)
  .then(validateBlock)
  .exitIf((value, ctx) => value.confidence > 0.95)
  .then(refineBlock)     // skipped if confidence is high enough
  .then(finalizeBlock);  // also skipped
```

The current value becomes the sequencer's output. Any outstanding `.work()` tasks are still auto-awaited before the sequencer returns.

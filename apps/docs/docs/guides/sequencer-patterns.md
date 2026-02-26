---
sidebar_position: 6
---

# Sequencer Patterns

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

## Container Wrapping

Group items for UI display:

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

This emits a `container` item that wraps child items for visual grouping in the UI.

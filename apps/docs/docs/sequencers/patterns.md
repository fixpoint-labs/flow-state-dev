---
sidebar_position: 2
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

## Resource Propagation

Sequencers automatically collect `declaredResources` from all child blocks. When a block declares `sessionResources`, `userResources`, or `projectResources`, those declarations bubble up through the sequencer chain to the flow:

```ts
const planResource = defineResource({
  stateSchema: z.object({ steps: z.array(z.string()).default([]) }),
  writable: true,
});

const planManager = handler({
  name: "plan-manager",
  sessionResources: { plan: planResource },
  execute: async (input, ctx) => { /* ... */ },
});

const pipeline = sequencer({ name: "pipeline" })
  .then(planManager)    // resource declaration collected
  .then(otherBlock);

// pipeline.declaredResources includes { session: { plan: planResource } }
// defineFlow will merge this into the flow's session.resources automatically
```

## Typed Target Access

When a block runs inside a nested sequencer and needs to read or write the state of an outer sequencer, use `targetStateSchemas` instead of manual `getTarget<Type>("name")` casts. The framework infers types from the declared schemas, so the access is fully typed with no assertions.

### Multi-sequencer coordination example

Here an inner processing block reports progress back to the outer research sequencer:

```ts
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

// --- Outer sequencer carries progress state ---
const researchPipeline = sequencer({
  name: "research-pipeline",
  inputSchema: z.object({ query: z.string() }),
  sessionStateSchema: z.object({ progress: z.number().default(0) }),
});

// --- Inner block declares which ancestor it needs ---
const processChunk = handler({
  name: "process-chunk",
  inputSchema: z.object({ chunk: z.string(), total: z.number(), index: z.number() }),
  outputSchema: z.string(),
  targetStateSchemas: {
    // Declare the ancestor by its block name and the state fields we'll touch
    "research-pipeline": z.object({ progress: z.number() }),
  },
  execute: async (input, ctx) => {
    const pct = Math.round(((input.index + 1) / input.total) * 100);
    // Fully typed: StateRef<{ progress: number }> | undefined
    await ctx.targets["research-pipeline"]?.patchState({ progress: pct });
    return `processed:${input.chunk}`;
  },
});

// --- Nested sequencer uses the reporting block ---
const chunkProcessor = sequencer({ name: "chunk-processor" })
  .then(splitIntoChunks)
  .forEach(processChunk, { maxConcurrency: 3 });

// --- Wire into the outer pipeline ---
researchPipeline
  .then(fetchSources)
  .then(chunkProcessor)   // processChunk inside here reaches up to researchPipeline
  .then(synthesize);
```

**Why `targetStateSchemas` instead of `getTarget`:**

```ts
// With getTarget — manual cast, no compile-time safety
const outer = ctx.getTarget<{ progress: number }>("research-pipeline");

// With targetStateSchemas — inferred, self-documenting
await ctx.targets["research-pipeline"]?.patchState({ progress: pct });
```

`getTarget` is a valid escape hatch for dynamic or unknown ancestor names. For static, well-known relationships, `targetStateSchemas` is preferred: the block documents its topology requirements and the type flows through without any cast.

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

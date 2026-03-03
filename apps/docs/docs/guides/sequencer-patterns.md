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

## Inline Blocks

The `.then()`, `.thenIf()`, and `.tap()` methods each accept a block factory (`handler`, `generator`, or `router`) paired with an inline config, instead of a pre-built block. The sequencer **automatically injects** the previous step's `outputSchema` as the `inputSchema` of the inline block — you never wire schemas between steps manually.

### Auto-injected input schema

`inputSchema` is always sourced from the prior step's `outputSchema` (or `z.any()` if no prior schema exists). It cannot be overridden in the inline config:

```ts
const pipeline = sequencer({ name: "process", inputSchema: z.string() })
  .then(parseNumber)   // outputSchema: z.number()
  .then(handler, {
    // inputSchema is z.number() — auto-injected from parseNumber's outputSchema
    outputSchema: z.string(),
    execute: (input) => `result: ${input}`,
  });
```

### `.then()` inline form

`outputSchema` is required — it drives TypeScript inference for all subsequent steps:

```ts
const pipeline = sequencer({ name: "pipeline", inputSchema: z.string() })
  .then(parseNumber)
  .then(handler, {
    outputSchema: z.object({ label: z.string(), value: z.number() }),
    execute: (input) => ({ label: `v:${input}`, value: input }),
  })
  .then(handler, {
    // inputSchema is { label: string, value: number } — auto-injected from above
    outputSchema: z.string(),
    execute: (input) => input.label,
  });
```

### `.thenIf()` inline form

Wraps the inline block in a condition. The output type becomes a **union** (`TOutput | InlineOutput`) since the condition may not match:

```ts
const pipeline = sequencer({ name: "pipeline", inputSchema: z.number() })
  .thenIf(
    (input) => input > 0,
    handler,
    {
      outputSchema: z.string(),
      execute: (input) => `positive: ${input}`,
    }
  );
// Output type: number | string
```

### `.tap()` inline form

`outputSchema` is optional — the output is discarded and the chain type is unchanged:

```ts
const pipeline = sequencer({ name: "pipeline", inputSchema: z.number() })
  .then(processNumber)
  .tap(handler, {
    execute: (input) => {
      console.log("checkpoint:", input);
    },
  })
  .then(nextStep);  // receives processNumber's output unchanged
```

### Works with generator and router

The inline form works with all three block factories. Here's an example with `generator` — note that `outputSchema` must still be provided explicitly even though generators default to `z.string()` at runtime, because TypeScript uses it for downstream inference:

```ts
const pipeline = sequencer({
  name: "chat-pipeline",
  inputSchema: z.object({ message: z.string(), context: z.string() }),
})
  .then(generator, {
    model: "gpt-5-mini",
    prompt: "Summarize the following in one sentence.",
    // inputSchema is { message: string, context: string } — auto-injected
    outputSchema: z.object({ summary: z.string() }),
    user: (input) => `${input.context}\n\n${input.message}`,
  })
  .then(handler, {
    outputSchema: z.string(),
    execute: (input) => input.summary,
  });
```

### Auto-generated names

`name` is optional. If omitted, the sequencer auto-generates names (`inline-1`, `inline-2`, etc.). Provide a name when you need to reference the step from `loopBack` or for clearer debug output:

```ts
const pipeline = sequencer({ name: "pipeline", inputSchema: z.string() })
  .then(handler, { outputSchema: z.number(), execute: (input) => input.length })         // name: "inline-1"
  .then(handler, { outputSchema: z.string(), execute: (input) => String(input) })        // name: "inline-2"
  .then(handler, { name: "format", outputSchema: z.string(), execute: (i) => `[${i}]` }) // name: "format"
```

### Mixing inline and pre-defined blocks

Inline blocks compose freely with pre-defined blocks in the same chain:

```ts
const pipeline = sequencer({ name: "pipeline", inputSchema: z.string() })
  .then(parseNumber)      // pre-defined
  .then(handler, {        // inline
    outputSchema: z.number(),
    execute: (input) => input * 2,
  })
  .then(toLabel)          // pre-defined
  .then(handler, {        // inline
    outputSchema: z.string(),
    execute: (input) => input.label,
  });
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

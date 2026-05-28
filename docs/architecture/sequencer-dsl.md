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

**Lifecycle:** The whole batch is queued on the per-request work pool (same as `.work()`). The request executor drains it before terminal status; inner sequencers do not block. Parent flow cancellation cancels in-flight iterations via the abort signal. See FIX-554.

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

Steps re-executed by a `loopBack` jump receive a `loop[N]` path segment, so the re-run child blocks get distinct `blockInstanceId`s per iteration (mirroring the `iter[N]` segment `doUntil`/`doWhile` give their bodies). The looping sequencer's own identity is stable. Generation 0 — the first pass and anything after the loop exits — is segment-free, so non-looping code is unchanged. This is what lets the DevTool render one row per iteration instead of collapsing a drained task list onto a single executor row.

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

**Key:** Work failures do NOT abort the main chain. They are logged and surface on the DevTool's trace channel.

**Lifetime — request-scoped pool (FIX-554):** Background work is queued on a single per-request pool, not the sequencer that dispatched it. Inner sequencers do not block their parent on their own background work. The request executor drains the pool exactly once before terminal status; the SSE stream stays open until the drain completes. As tasks settle, the executor emits a `StatusItem` with `blocked: false` and `backgroundTasks: N` — clients use `blocked` to know it's safe to accept new user input (see `isFinishing` on `SessionView` / `UseRequestStreamResult`). When you need a downstream step to read state mutated by a queued task, use `.waitForWork()` as an explicit barrier in the dispatching sequencer.

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

Wait for the calling sequencer's queued work to complete at a specific point in the pipeline. Drains by sequencer-instance scope: `.waitForWork()` only waits on `.work()` calls dispatched by *this* sequencer instance, not unrelated siblings'. If you don't need the results mid-pipeline, the request-level pool drain handles it automatically before terminal status (FIX-554).

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

Does not skip rescue handlers for errors that occurred before the exit. Outstanding `.work()` tasks dispatched by this sequencer remain on the per-request pool and are drained by the request executor (FIX-554).

### `throwIf(condition, error)` — Guard / Invariant Check

Throw a supplied error when a condition is met. The error can be a static `Error` instance or a factory `(value, ctx) => Error | Promise<Error>` so the message can carry runtime context. Both the condition and the factory may be async.

```ts
pipeline
  .then(phase1Pipeline)
  .throwIf(
    (_value, ctx) => everyAnalystErrored(ctx),
    (_value, ctx) => new EarlyStopError("phase-1-no-data", `No data for ${ctx.session.state.ticker}.`),
  )
  .then(phase2Pipeline);
```

Pairs naturally with `.rescue([{ when: [TypedError], block: handler }])` when the guard should produce a clean terminal state rather than a runtime error. Unlike `.exitIf`, the chain does not continue — control transfers to the nearest matching rescue handler, or out of the sequencer entirely if none matches.

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

## Schema Propagation and Validation

Two schemas coexist on a sequencer, and the distinction matters:

- `config.outputSchema` — user-declared. The contract the author asserts the sequencer produces. Optional.
- `lastOutputSchema` — inferred. The schema tracked from the chain's tail step as the DSL builds the chain. Updated by every schema-bearing op (`then`, `map`, `parallel`, etc.).

`inputSchema` is inferred from the first block when not set explicitly.

### Runtime validation chokepoint

`wrapWithOutputValidation` wraps `runSequencerOperations`. When `config.outputSchema` is declared, the wrapper runs the sequencer's actual return value through `config.outputSchema.safeParse` at a single point before the value leaves the sequencer. Because the wrap is at the sequencer boundary, it covers every exit path uniformly: the natural tail, an `exitIf` early return, and a `rescue` recovery. There is no per-op validation — one gate, all paths.

On `!result.success` the wrapper throws `SequencerOutputSchemaError`. On success it returns `result.data`, so a schema with `.transform()` yields the post-transform value as the sequencer's output. When `config.outputSchema` is undefined the wrapper is a pass-through with zero added cost.

### Build-time `.validate()`

`.validate(): void` does a conservative one-level structural comparison between `config.outputSchema` and `lastOutputSchema`, via `_def.typeName` introspection. It compares:

- Top-level zod kind (`ZodObject` vs `ZodString` vs `ZodArray`, etc.).
- Object key sets.
- One level of object value-kinds.
- Array element kind.

A reference-equality fast path short-circuits when both sides are the same schema instance (trivially compatible). On mismatch it throws `SequencerSchemaMismatchError`. It is a no-op when either schema is undefined.

### Known limitations of `.validate()`

The build-time check trades depth for safety against false negatives in the common case, and it has documented blind spots:

- It does not recurse into nested object shapes, refinements, brands, or union variants.
- `.transform()` / `.refine()`-wrapped schemas surface as `ZodEffects`, so the comparison stops at that kind. A wrapped declared schema against a plain inferred one (or the reverse) reports a `ZodEffects` kind mismatch rather than comparing the inner shapes.
- `thenIf` false-path and `branch` non-first-branch outcomes can widen the real runtime shape in ways the tracked `lastOutputSchema` does not reflect, so `.validate()` can produce a false positive (pass when the runtime would differ).
- `thenAny`, `race`, `thenAll`, and `branch` erase the tracked tail schema (`lastOutputSchema` becomes undefined). After one of these, `.validate()` no-ops. The runtime gate still catches an actual mismatch — the build-time check is the part that goes quiet, not the runtime enforcement.

`.validate()` is terminal (returns `void`, not the sequencer). Ops added after a `.validate()` call are outside that call's coverage.

### Error classes

Both extend `FlowError`, neither is retryable:

- `SequencerOutputSchemaError` — runtime, `code: "sequencer_output_schema_error"`. Thrown by the chokepoint on a `safeParse` failure. Catchable in a parent sequencer's `.rescue([{ when: [SequencerOutputSchemaError], block }])`.
- `SequencerSchemaMismatchError` — build-time, `code: "sequencer_schema_mismatch"`. Thrown by `.validate()`.

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

This document is authoritative for the sequencer DSL. See also [blocks.md](./blocks.md). For full type signatures and overload variants, refer to the published types in `@flow-state-dev/core`.

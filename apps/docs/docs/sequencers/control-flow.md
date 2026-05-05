---
sidebar_position: 3
---

# Control Flow Reference

This is the reference for everything in the sequencer DSL beyond the day-one set. If you haven't read [Composing Blocks](/docs/sequencers/composing-blocks) yet, start there — `then`, `map`, `tap`, `thenIf`, `work`, and `rescue` cover most pipelines.

The methods below are grouped by what you're trying to do, not alphabetically. Reach for them when the day-one set isn't enough.

| Group | Methods |
|-------|---------|
| [Parallelism](#parallelism) | `parallel`, `forEach`, `forEachBackground`, `thenAll` |
| [Looping](#looping) | `doUntil`, `doWhile`, `loopBack` |
| [Conditional sub-cases](#conditional-sub-cases) | `tapIf`, `workIf`, `exitIf` |
| [Specialization](#specialization) | `thenAny`, `race`, `branch` |
| [Side-chain coordination](#side-chain-coordination) | `waitForWork` |
| [Connector adaptation](#connector-adaptation) | `connectInput` |

Each entry has a signature, one example, and a "when to reach for this" note.

## Parallelism

Run multiple blocks against the same input. Choose the method by the shape of the result you want.

### `parallel({ name: block, ... }, options?)`

Run a fixed set of named branches concurrently. Results come back as an object keyed by branch name.

```ts
pipeline.parallel(
  {
    analysis: analysisBlock,
    summary: summaryBlock,
    tags: { connector: (input) => input.text, block: tagBlock },
  },
  { maxConcurrency: 3 }
);

// Output: { analysis, summary, tags }
```

**When to reach for this**: you have a known set of independent steps and you want each result accessible by name (`output.analysis`).

### `thenAll([block, ...], options?)`

Run a list of blocks concurrently. Results come back as an array, in the same order as the input.

```ts
pipeline.thenAll(
  [
    analysisBlock,
    summaryBlock,
    { connector: (input) => input.text, block: tagBlock },
  ],
  { maxConcurrency: 3 }
);

// Output: [analysisResult, summaryResult, tagResult]
```

If any block throws, the step fails (like `Promise.all`).

**When to reach for this**: you have a dynamic list of blocks, or you prefer array indexing over named access. Use `parallel` when you have a fixed set with meaningful names.

### `forEach(connector?, block, options?)`

Run a block once per element of an array. Results come back as an array. Blocking — the chain waits for all items to finish.

```ts
pipeline
  .map((input) => input.items)
  .forEach(processItemBlock, { maxConcurrency: 5 });

// Or with an inline connector to extract the array:
pipeline.forEach(
  (input) => input.items,
  processItemBlock,
  { maxConcurrency: 5 }
);
```

**When to reach for this**: fan-out over data, and the rest of the chain depends on the results.

### `forEachBackground(connector?, block, options?)`

Like `forEach`, but the chain doesn't wait. Each item is dispatched as a `.work()` task.

**When to reach for this**: per-item side effects (per-row analytics, per-document indexing) that shouldn't block. See [Side Chains](/docs/advanced/sequencer-side-chains) for the broader picture on background work.

## Looping

Repeat a step until something changes. Use these sparingly — most pipelines are linear.

### `doUntil(condition, block)`

Run `block` repeatedly until `condition` returns true. The condition is checked *after* each iteration, so the block always runs at least once.

```ts
pipeline.doUntil(
  (value, ctx) => value.confidence > 0.9,
  refineBlock
);
```

**When to reach for this**: refine until good enough. A typical use is generator self-correction.

### `doWhile(condition, block)`

Run `block` repeatedly while `condition` is true. Checked *before* each iteration, so the block may not run at all.

```ts
pipeline.doWhile(
  (value, ctx) => value.remaining > 0,
  processNextBatch
);
```

**When to reach for this**: process work until a queue is drained.

### `loopBack(stepName, options)`

Jump back to a named earlier step. The named step's output position becomes the next iteration's input.

```ts
pipeline
  .then(generateBlock)        // step name: "generate-block"
  .then(validateBlock)
  .loopBack("generate-block", {
    when: (value, ctx) => !value.isValid,
    maxIterations: 3,
  });
```

**When to reach for this**: a generate-then-validate loop where validation failure should send you back to regenerate. Most pipelines don't need this — `doUntil` is usually enough. Three patterns in the standard library use it.

## Conditional sub-cases

Variants of `tap`, `work`, and an early-exit primitive. Use these when you'd otherwise wrap a step in a wrapper sequencer just to gate it.

### `tapIf(condition, block)`

A `tap` that only runs when the condition is true. Pipeline value passes through either way.

```ts
pipeline.tapIf(
  (value, ctx) => value.score < 0.5,
  alertLowScoreBlock
);
```

**When to reach for this**: log or notify only on certain values. Don't write a gating handler that conditionally calls a block — use this.

### `workIf(condition, block)`

A `work` that only fires when the condition is true. When false, it's a complete no-op — no block, no items emitted.

```ts
pipeline.workIf(
  (ctx) => ctx.session.state.features.memory,
  memoryObserveBlock
);

// Or with a static boolean:
pipeline.workIf(ENABLE_ANALYTICS, analyticsBlock);
```

**When to reach for this**: feature-flag a background side effect.

### `exitIf(condition)`

Terminate the chain early. The current value becomes the sequencer's output. Steps after the `exitIf` are skipped.

```ts
pipeline
  .then(generateBlock)
  .then(validateBlock)
  .exitIf((value, ctx) => value.confidence > 0.95)
  .then(refineBlock)     // skipped if confidence is high enough
  .then(finalizeBlock);  // also skipped
```

The condition can be async. You can place multiple `exitIf` calls in a chain — each acts as a checkpoint.

Outstanding `.work()` tasks are still awaited before the sequencer returns. The exit skips remaining chain steps but does not skip background-work cleanup.

**When to reach for this**: bail out of a refinement chain when the value is already good enough, or take a fast path for trivial inputs.

## Specialization

Rarely needed. Reach for these only when the simpler methods don't fit.

### `thenAny([block, ...])`

Try blocks one at a time, in order. Returns the result of the first one that succeeds. Remaining blocks are never executed.

```ts
pipeline.thenAny([
  primaryProvider,
  fallbackProviderA,
  fallbackProviderB,
]);
```

If every block fails, throws an `AggregateError` containing all errors.

**When to reach for this**: ordered failover with a meaningful priority. If you don't care about order, use `race`.

### `race([block, ...], options?)`

Start all blocks concurrently. The first to succeed wins. The rest are signaled for cancellation.

```ts
pipeline.race(
  [expensiveDeepAnalysis, quickHeuristicAnalysis],
  { maxConcurrency: 4 }
);
```

If all blocks fail, throws an `AggregateError`.

**When to reach for this**: you want the fastest answer regardless of source.

### `thenAny` vs `race`

| | `thenAny` | `race` |
|--|-----------|--------|
| **Execution** | Sequential: try A, then B, then C | Concurrent: start all at once |
| **Use case** | Ordered fallback chain | Fastest-wins |
| **Resource cost** | Lower — only runs what's needed | Higher — runs all blocks |
| **Cancellation** | Never starts blocks after first success | Aborts in-flight blocks after first success |

### `branch({ name: [connector, condition, block], ... })`

Run the first branch whose condition returns true. Each branch is a tuple: connector, condition, block.

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

**When to reach for this**: rarely. A chain of `thenIf` is usually clearer for two cases. `branch` makes sense when you have three or more mutually exclusive paths and want them visible as named cases. For runtime-determined dispatch with state types, a [router block](/docs/fundamentals/blocks) is often the better fit.

## Side-chain coordination

### `waitForWork(options?)`

Wait for outstanding `.work()` tasks to settle.

```ts
pipeline
  .work(taskA)
  .work(taskB)
  .waitForWork({ failOnError: false })
  .then(nextStep);
```

By default, the sequencer auto-awaits work tasks before it returns, so you only need `.waitForWork()` if you need to wait *mid-chain* (because a later step depends on side-effects the work tasks produced) or if you want to surface work errors as a step error rather than letting them be recorded silently.

**When to reach for this**: a later step needs to read state that a `.work()` task wrote, or you want explicit failure semantics on background work. See [Side Chains](/docs/advanced/sequencer-side-chains) for the full story.

## Connector adaptation

### `connectInput(fn)`

Attach an input transform to a block, producing a new block that always adapts its input.

```ts
const searchFromText = searchBlock.connectInput(
  (text: string) => ({ query: text, limit: 10 })
);

pipeline.then(searchFromText);
```

**When to reach for this**: you reuse the same block in multiple pipelines with different upstream shapes. For one-off shape adaptation between two specific steps, pass a connector function inline to `.then()` instead — see [Connectors](/docs/sequencers/connectors).

A matching `connectOutput` exists on blocks for output shaping.

## Where to go next

- **[Composing Blocks](/docs/sequencers/composing-blocks)** — the day-one set
- **[Connectors](/docs/sequencers/connectors)** — shaping data between steps
- **[Side Chains](/docs/advanced/sequencer-side-chains)** — the full picture on `.work()` and friends

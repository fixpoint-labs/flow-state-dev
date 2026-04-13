---
sidebar_position: 3
---

# Side Chains

Side chains let you run work in the background without blocking the main pipeline. Three primitives cover the common patterns:

- **`.work()` / `.background()`** — queue a single background task (`.background()` is an alias that reads better in fan-out contexts)
- **`.workIf(condition, block)`** — conditional variant of `.work()`, dispatches only when condition is truthy
- **`.forEachBackground()`** — dispatch each element of an array as a background task with concurrency control

Work failures never abort the pipeline. They emit `step_error` items instead. Use side chains for fire-and-forget side effects: logging, analytics, cache warming, notifications.

## Fire-and-forget

```ts
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const logAnalytics = handler({
  name: "log-analytics",
  inputSchema: z.object({ event: z.string(), payload: z.unknown() }),
  outputSchema: z.undefined(),
  execute: async (input) => {
    await sendToAnalytics(input.event, input.payload);
  },
});

const pipeline = sequencer({
  name: "pipeline",
  inputSchema: z.object({ message: z.string() }),
})
  .then(mainBlock)
  .work((output) => ({ event: "processed", payload: output }), logAnalytics)
  .then(nextStep);
```

`nextStep` receives the same output as `mainBlock` produced. The analytics call runs in the background and doesn't block. If `logAnalytics` throws, the pipeline keeps going. The error becomes a `step_error` item.

## With and without connectors

Without a connector, the work block gets the current pipeline value:

```ts
.work(logBlock)
```

With a connector, you reshape the payload for the work block:

```ts
.work(
  (output) => ({ event: "summary_complete", text: output.text }),
  summarizeAnalytics
)
```

The connector runs in the main thread. Only the block execution is backgrounded.

## Error isolation

Work failures are isolated. The main pipeline does not throw. Instead, the framework emits a `step_error` item with the work task name and the error. Your client can surface these for debugging, but the user flow continues.

If you need to know whether background work succeeded, use `.waitForWork()`.

## waitForWork — convergence points

`.waitForWork()` waits for all `.work()` tasks queued so far. By default, it does not throw on work failures:

```ts
pipeline
  .work(taskA)
  .work(taskB)
  .waitForWork()
  .then(nextStep);
```

`nextStep` runs after both tasks finish. If either failed, the pipeline still continues. Set `failOnError: true` to promote work failures:

```ts
.waitForWork({ failOnError: true })
```

With `failOnError: true`, if any work task rejects, the sequencer throws and the pipeline aborts. Use this when background work is required for correctness (e.g., persisting a critical record) rather than optional (e.g., analytics).

## failOnError option

```ts
pipeline
  .work(requiredSyncTask)
  .work(optionalLogTask)
  .waitForWork({ failOnError: true });
```

If `requiredSyncTask` fails, the pipeline throws. If only `optionalLogTask` fails, the pipeline continues. The tradeoff: `failOnError` applies to *all* queued work. You can't fail only on specific tasks. If you need per-task behavior, use separate `.work()` / `.waitForWork()` segments.

## When to use work vs tap

| | `tap` | `work` |
|--|-------|--------|
| **Blocks main pipeline?** | Yes | No |
| **Runs in parallel with next step?** | No | Yes |
| **Failure affects pipeline?** | Yes (throws) | No (step_error only) |
| **Use case** | Side effect you must complete before continuing | Fire-and-forget, best-effort |

Use `tap` when the side effect must succeed before the next step. Use `work` when you want non-blocking, best-effort behavior.

## Multiple work items

You can queue several work tasks; they run concurrently:

```ts
pipeline
  .then(coreLogic)
  .work(logUsage)
  .work(cacheWarm)
  .work(sendNotification)
  .then(moreWork);
```

All three run in parallel. The main chain proceeds to `moreWork` immediately. Call `.waitForWork()` when you need to converge:

```ts
pipeline
  .then(coreLogic)
  .work(logUsage)
  .work(cacheWarm)
  .waitForWork()
  .then(moreWork);
```

## Realistic example

```ts
const chatPipeline = sequencer({
  name: "chat",
  inputSchema: z.object({ message: z.string() }),
})
  .then(validateInput)
  .then(agent)
  .work(
    (output) => ({
      event: "response_generated",
      sessionId: "...",
      tokenCount: output.usage?.totalTokens ?? 0,
    }),
    analyticsHandler
  )
  .work(
    (output) => output.suggestedFollowUps ?? [],
    warmCacheHandler
  )
  .tap(logToJournal)
  .then(formatResponse);
```

Analytics and cache warming run in parallel. `logToJournal` runs inline (tap) because we want it done before formatting. The pipeline only continues after the tap completes.

## background — alias for work

`.background()` is identical to `.work()`. It exists because "background" reads more naturally when you're thinking about fan-out patterns:

```ts
pipeline
  .then(mainLogic)
  .background(notifySlack)
  .background(warmCache)
  .then(nextStep);
```

Use whichever name makes the call site clearer.

## workIf — conditional background work

`.workIf()` is the conditional variant of `.work()`. It evaluates a condition at execution time and only dispatches the sidechain when the condition is truthy. When falsy, it's a complete no-op — no block execution, no items emitted, no cost incurred.

The canonical use case is feature-flagged background work:

```ts
const pipeline = sequencer({
  name: "chat",
  inputSchema: z.object({ message: z.string() }),
})
  .then(agent)
  .workIf(
    (ctx) => ctx.session.state.features.memory,
    memoryObserveBlock
  )
  .then(formatResponse);
```

When `features.memory` is disabled, the pipeline behaves as if the `.workIf()` call didn't exist. No block is dispatched, no promise is queued, no `step_error` can be emitted.

### Static booleans

The condition also accepts a plain `boolean`. This is useful for compile-time feature flags:

```ts
const ENABLE_ANALYTICS = process.env.ANALYTICS === "true";

pipeline.workIf(ENABLE_ANALYTICS, analyticsBlock);
```

Static `true` is equivalent to `.work()`. Static `false` is a permanent no-op.

### With a connector

Like `.work()`, you can reshape the input for the background block:

```ts
pipeline.workIf(
  (ctx) => ctx.session.state.observeEnabled,
  (output) => ({ event: "processed", data: output }),
  analyticsBlock,
  { name: "conditional-analytics" }
);
```

When the condition is falsy, the connector is never called.

### Condition signature

The condition function receives the `BlockContext` (not the pipeline value). This is deliberate: `workIf` is about checking session state, feature flags, or runtime configuration — not examining the pipeline data.

```ts
// ✅ workIf condition — receives ctx only
.workIf((ctx) => ctx.session.state.featureEnabled, block)

// ✅ thenIf condition — receives both input and ctx
.thenIf((input, ctx) => input.score > 0.5, block)
```

### Async conditions

The condition can be async. It's evaluated once before dispatching:

```ts
pipeline.workIf(
  async (ctx) => {
    const settings = await loadFeatureFlags(ctx.session.state.userId);
    return settings.memoryEnabled;
  },
  memoryObserveBlock
);
```

## forEachBackground — fan-out over arrays

`.forEachBackground()` dispatches each element of an array to a block as background work. The parent continues immediately. Each iteration runs independently — one failing doesn't stop the others or abort the pipeline.

```ts
const notifySubscriber = handler({
  name: "notify-subscriber",
  inputSchema: z.object({ userId: z.string(), message: z.string() }),
  outputSchema: z.undefined(),
  execute: async (input) => {
    await sendPush(input.userId, input.message);
  },
});

const pipeline = sequencer({
  name: "broadcast",
  inputSchema: z.object({
    subscribers: z.array(z.object({ userId: z.string(), message: z.string() })),
  }),
})
  .map((input) => input.subscribers)
  .forEachBackground(notifySubscriber, { concurrency: 8 });
```

The pipeline's output is the original array, not the block results. This is a fundamental difference from `.forEach()`, which blocks and returns an array of outputs.

With a connector:

```ts
pipeline.forEachBackground(
  (input) => input.channels.map((ch) => ({ channel: ch, payload: input.data })),
  broadcastBlock,
  { concurrency: 4 }
);
```

### forEach vs forEachBackground

| | `forEach` | `forEachBackground` |
|--|-----------|---------------------|
| **Timing** | Blocks until all iterations complete | Dispatches and continues immediately |
| **Return type** | `T[]` (array of block outputs) | Pass-through (original input) |
| **Failure** | Any iteration aborts the parent | Isolated per iteration |
| **Use case** | Transform a collection | Broadcast, fan-out, cache warming |

### Concurrency

The `concurrency` option (default: 16) limits how many iterations run simultaneously. This prevents overwhelming downstream services when fanning out over large arrays:

```ts
.forEachBackground(notifyBlock, { concurrency: 4 })
```

### Cancellation

Parent flow cancellation propagates to in-flight background iterations via the abort signal. The worker loop checks the signal before starting each new iteration.

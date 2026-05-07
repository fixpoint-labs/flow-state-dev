---
sidebar_position: 3
---

# Side Chains

Side chains let you run work in the background without blocking the main pipeline. Three primitives cover the common patterns:

- **`.work()`** — queue a single background task
- **`.workIf(condition, block)`** — conditional variant of `.work()`, dispatches only when condition is truthy
- **`.forEachBackground()`** — dispatch each element of an array as a background task with concurrency control

Work failures never abort the pipeline. The framework logs them and the failed `block_trace` reaches the DevTool via the trace channel; nothing surfaces in the user-visible stream. Use side chains for fire-and-forget side effects: logging, analytics, cache warming, notifications.

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

`nextStep` receives the same output as `mainBlock` produced. The analytics call runs in the background and doesn't block. If `logAnalytics` throws, the pipeline keeps going.

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

Work failures are isolated. The framework logs the failure; the DevTool surfaces it via the trace channel. Your user-facing stream is unaffected.

If you need to know whether background work succeeded, use `.waitForWork()`.

## Background work is request-scoped

Background work outlives the sequencer that dispatched it. `.work()`, `.workIf()`, and `.forEachBackground()` queue tasks on a single per-request pool. Inner sequencers do not block their parent on their own background work, and sibling sequencers run their `.work()` tasks concurrently. The request executor drains the pool exactly once before the SSE stream closes — your stream stays open until every queued task settles, regardless of which sequencer queued it.

Two siblings each calling `.work()` finish in roughly the time of the slower one, not the sum:

```ts
const root = sequencer({ name: "root", inputSchema: z.unknown() })
  .then(branchA) // .work(slowA) inside
  .then(branchB) // .work(slowB) inside — starts immediately, doesn't wait for slowA
  .then(thirdStep); // also starts immediately
```

If you need a downstream step to read state mutated by a queued task, use `.waitForWork()` as an explicit barrier *in the dispatching sequencer*. It drains only the calling sequencer's tasks, not unrelated siblings'.

```ts
const memoryPipeline = sequencer({ name: "memory", inputSchema: z.unknown() })
  .work(persistMemoryEntry)
  .waitForWork() // wait for persistence before reading state below
  .then(readPersistedEntries);
```

Before this change, every sequencer auto-awaited its own background work before returning, which serialized sibling work that should have run concurrently. If you have code that previously relied on the inner-sequencer auto-await for ordering — e.g. an inner `.work(setupBlock)` followed by a parent step that read state mutated by `setupBlock` — add an explicit `.waitForWork()` at the inner sequencer boundary.

## waitForWork — convergence points

`.waitForWork()` waits for the calling sequencer's `.work()` tasks. By default, it does not throw on work failures:

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
| **Failure affects pipeline?** | Yes (throws) | No (logged + trace-channel signal) |
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
    (_response, ctx) => ctx.session.state.features.memory,
    memoryObserveBlock
  )
  .then(formatResponse);
```

When `features.memory` is disabled, the pipeline behaves as if the `.workIf()` call didn't exist. No block is dispatched and no promise is queued.

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
  (_response, ctx) => ctx.session.state.observeEnabled,
  (output) => ({ event: "processed", data: output }),
  analyticsBlock,
  { name: "conditional-analytics" }
);
```

When the condition is falsy, the connector is never called.

### Condition signature

The condition function receives the running step value first and the
`BlockContext` second — matching `.thenIf` and `.tapIf`. Authors can gate
dispatch on either the upstream output or live session/request state:

```ts
// ✅ Gate on the upstream output (e.g. don't run capture on empty text)
.workIf((response) => response.length > 0, captureBlock)

// ✅ Gate on session/request state
.workIf((_value, ctx) => ctx.session.state.featureEnabled, block)

// ✅ Gate on both
.workIf((response, ctx) => response.length > 0 && ctx.session.state.captureEnabled, block)
```

### Async conditions

The condition can be async. It's evaluated once before dispatching:

```ts
pipeline.workIf(
  async (_value, ctx) => {
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

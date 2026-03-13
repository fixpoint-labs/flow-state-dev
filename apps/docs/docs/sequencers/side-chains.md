---
sidebar_position: 3
---

# Side Chains

`.work()` queues background tasks that run in parallel with the main pipeline. The main chain continues immediately. Work failures never abort the pipeline. They emit `step_error` items instead. Use `.work()` for fire-and-forget side effects: logging, analytics, cache warming, notifications.

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

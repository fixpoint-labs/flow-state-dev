---
title: Run background jobs with BullMQ
type: recipe
description: "Run flow actions as jobs on a Redis queue, in the web process or in processes of their own."
---

# Run background jobs with BullMQ

Run actions in a queue that survives a restart. A long `buildReport` action on the support desk then keeps going when the user closes the tab, and a job that fails is retried, three attempts by default. This page sets up the queue, then moves the work into its own process. It needs Node 22 or newer and a Redis you can reach.

If you deploy to a platform that stops the function when the response returns, a queue consumer in the web process stops with it. Use [Background work](../concepts/background-work.md) to choose between a queue and the other kinds.

## 1. Install and start Redis

```bash
pnpm add @flow-state-dev/bullmq bullmq ioredis
docker run -d -p 6379:6379 redis:7-alpine
```

Put the address in `.env.local`:

```text title=".env.local"
REDIS_URL=redis://localhost:6379
```

## 2. Give the app a queue

The queue is a setting of the app, not of one action. `bullmqJobQueue` is the `jobQueue` option of `createFlowState`:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { bullmqJobQueue } from "@flow-state-dev/bullmq";
import support from "./src/flows/support/flow";

const flowstate = createFlowState({
  flows: [support],
  jobQueue: bullmqJobQueue({ connection: process.env.REDIS_URL! }),
});

// The queue starts on first use. Start it at boot so this process takes jobs at once.
void flowstate.ready();
process.on("SIGTERM", () => void flowstate.dispose());

export default flowstate;
```

`support` is the support desk's flow, defined in its own file. Every action call becomes a job. Actions run through the BullMQ queue, and the same process takes the jobs and runs them against the same stores. [`bullmqJobQueue` options](../reference/background-work.md) covers the connection forms, retries and dead-letter queues.

`fsdev serve` starts the queue for you, so the two lines after `createFlowState` are for any other way of starting the app.

## 3. Call the action as before

Nothing changes in the page. `session.sendAction("buildReport", ...)` resolves when the job is on the queue, not when it finishes, and `session.items` fills as the job writes items.

You can open the stream as soon as the action returns its request id, even before the job is picked up. [Live updates](./live-updates.md) shows the page side.

## 4. Run the jobs in a process of their own

For production, run the web process and job processing in separate containers. Both build the same `FlowState` from one config, and a `mode` tells each which side to run:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { bullmqJobQueue } from "@flow-state-dev/bullmq";
import { postgresStores } from "@flow-state-dev/store-postgres";
import support from "./src/flows/support/flow";

const flowstate = createFlowState({
  flows: [support],
  stores: postgresStores({ connectionString: process.env.FSD_DB_URL }),
  jobQueue: bullmqJobQueue({
    connection: process.env.REDIS_URL!,
    mode: process.env.QUEUE_MODE === "process-only" ? "process-only" : "enqueue-only",
    concurrency: 4,
  }),
});

export default flowstate;
```

The web container sets `QUEUE_MODE=enqueue-only`. It enqueues jobs and runs none. `QUEUE_MODE` is this app's own variable name. `concurrency: 4` is the number of jobs one processing container runs at a time.

The processing container starts a small script:

```ts title="process-jobs.ts"
import flowstate from "./fsdev.config";

await flowstate.ready();
process.on("SIGTERM", () => void flowstate.dispose());
```

Run it with the container's `QUEUE_MODE=process-only`, using the TypeScript runner you already use. No `fsdev` command runs in `process-only` mode.

Both containers must reach the same stores. If they do not, jobs enqueue and run, but the web process never sees what the jobs wrote and the request stays `in_progress`. Nothing reports the mismatch. The default in-memory stores belong to one process, so use Postgres, or SQLite on a shared disk on one machine. [Stores](../reference/stores.md) lists the backends.

## When a job is late or fails

**Nothing is processing jobs.** The POST for `buildReport` gets its 202, because the job is on the queue. The request then sits as `in_progress`. If nothing claims it within `queuedGraceMs`, ten minutes by default (an option of `createFlowState`), it is marked `interrupted`.

**A retry while the client reconnects.** The job runs again, three attempts counting the first. Each attempt numbers its events after the last one stored, so the stream reads as one run and does not restart at zero. Reconnecting needs no code: the client resumes after the last event it received (`Last-Event-ID` or `starting_after`) and replays the rest from the store.

## Next

- [`bullmqJobQueue` reference](../reference/background-work.md): connection, `prefix`, retries, dead-letter queues, jobs enqueued by hand, and which failures skip retries.
- [Concurrency policies](../reference/concurrency.md): how `queue` and the other policies hold across containers.
- [Run on a schedule](../reference/schedules.md): BullMQ's repeating jobs as the scheduler.
- [Deploy with Docker](./deploy/docker.md): the two containers in one compose file.

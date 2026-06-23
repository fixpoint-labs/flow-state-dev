# @flow-state-dev/bullmq

BullMQ adapter for `@flow-state-dev/engine` — durable background jobs, native cron scheduling, and full-flow worker dispatch for long-lived self-hosted deployments.

Use this when you run your own infrastructure (Docker, Railway, VPS) and want Redis-backed job durability with automatic retries, dead-letter queues, and real-time streaming between workers and the web process.

## Install

```bash
pnpm add @flow-state-dev/bullmq bullmq ioredis
```

For schedule integration, also install the scheduled adapter:

```bash
pnpm add @flow-state-dev/scheduled
```

## Quick start

Two deployment shapes are supported: **co-located** (web + worker in one process) and **separated** (web enqueues, workers run elsewhere).

### Co-located (simplest)

```ts
import { createBullmqRuntime } from "@flow-state-dev/bullmq";
import { createFlowState } from "@flow-state-dev/engine";

const bullmq = createBullmqRuntime({
  connection: process.env.REDIS_URL ?? "redis://localhost:6379",
});

// Enqueue a job directly
await bullmq.enqueueAction({
  flowKind: "billing",
  actionName: "generateInvoice",
  input: { month: "2026-06" },
  userId: "system",
});

// Start a worker in the same process
bullmq.createWorker({ registry, stores, runtimeConfig });

// Graceful shutdown
process.on("SIGTERM", () => bullmq.close());
```

### Separated (web process + worker process)

On the **web side**, use `createWorkerDispatcher` to route all flow dispatches through the queue:

```ts
import { Queue } from "bullmq";
import { createFlowState } from "@flow-state-dev/engine";
import {
  createWorkerDispatcher,
  createRedisStreamBridge,
} from "@flow-state-dev/bullmq";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const bridge = createRedisStreamBridge({ connection: redisUrl });
const queue = new Queue("fsd-flows", { connection: redisUrl });

const flowstate = createFlowState({
  flows: { /* ... */ },
  dispatcher: createWorkerDispatcher({ queue, bridge }),
});
```

On the **worker side**, run `createFlowWorker`:

```ts
import { createFlowWorker, createRedisStreamBridge } from "@flow-state-dev/bullmq";

const bridge = createRedisStreamBridge({
  connection: process.env.REDIS_URL ?? "redis://localhost:6379",
});

const worker = createFlowWorker({
  connection: process.env.REDIS_URL ?? "redis://localhost:6379",
  deps: { registry, stores, runtimeConfig, bridge },
});

process.on("SIGTERM", () => worker.close());
```

## Connection

Pass a Redis URL string or an ioredis `RedisOptions` object:

```ts
// URL string
createBullmqRuntime({ connection: "redis://localhost:6379" });

// Options object
createBullmqRuntime({
  connection: { host: "redis.internal", port: 6379, password: "secret" },
});

// TLS (rediss://)
createBullmqRuntime({ connection: "rediss://user:pass@redis.cloud:6380" });
```

The `prefix` option namespaces all BullMQ keys for multi-tenant isolation. Default is `"fsd"`. Never use ioredis `keyPrefix` — it's incompatible with BullMQ's Lua scripts.

## Retry and dead-letter queues

```ts
createBullmqRuntime({
  connection: redisUrl,
  retry: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000, jitter: 0.3 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400 },
    deadLetter: true, // sends to "<queueName>-dlq" after exhausting retries
  },
});
```

Validation errors, unknown flows, and unknown actions are marked as `UnrecoverableError` and skip retries entirely.

## Stream bridge

`createRedisStreamBridge` uses Redis pub/sub to stream live events from workers back to the web process. Each request gets its own channel pair (events + abort). The bridge is best-effort — late or reconnecting clients recover from the store.

Requests are registered in the store at enqueue time, so SSE clients can attach via `GET /requests/:id/stream` before the worker claims the job — no 404 while the worker spins up.

```ts
import { createRedisStreamBridge } from "@flow-state-dev/bullmq";

const bridge = createRedisStreamBridge({
  connection: redisUrl,
  channelPrefix: "my-app:stream", // default: "fsd:stream"
});
```

## `@flow-state-dev/bullmq/schedules`

Bridges BullMQ's native repeatable-job scheduler to the framework's scheduled transport adapter.

### Static schedules

```ts
import { Queue } from "bullmq";
import { registerStaticSchedules } from "@flow-state-dev/bullmq/schedules";

const queue = new Queue("fsd-schedules", { connection: redisUrl });

// Idempotent — safe to call on every deploy
await registerStaticSchedules({ registry, queue });
```

This reads each flow's `schedules.static` map and upserts a BullMQ repeatable job per entry.

### Schedule dispatch worker

```ts
import { createScheduleDispatchWorker } from "@flow-state-dev/bullmq/schedules";

const worker = createScheduleDispatchWorker({
  connection: redisUrl,
  queueName: "fsd-schedules",
  baseUrl: "http://localhost:3000",
  secret: process.env.CRON_SECRET!,
});
```

Consumes scheduler-fired jobs and POSTs to the framework's schedule dispatch endpoint, bridging BullMQ's native cron to the scheduled transport adapter.

### Schedule index

`createBullmqScheduleIndex` implements the `ScheduleIndex` interface using BullMQ's `upsertJobScheduler` / `removeJobScheduler`. Because BullMQ fires repeatable jobs natively, `claimDue` returns `[]` — no polling tick is needed.

```ts
import { Queue } from "bullmq";
import { createBullmqScheduleIndex } from "@flow-state-dev/bullmq";

const queue = new Queue("fsd-schedules", { connection: redisUrl });
const scheduleIndex = createBullmqScheduleIndex(queue, {
  flowKind: "weekly-digest",
});
```

## Monitoring with Bull Board

The runtime exposes its `queue` property for monitoring tools like [Bull Board](https://github.com/felixmosh/bull-board):

```ts
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [new BullMQAdapter(bullmq.queue)],
  serverAdapter,
});
```

The kitchen-sink app includes a working integration at `/api/admin/queues` (requires `REDIS_URL`).

## Exports

| Entry point                        | What it provides                                              |
| ---------------------------------- | ------------------------------------------------------------- |
| `@flow-state-dev/bullmq`          | Runtime, dispatcher, stream bridge, schedule index, connection utilities |
| `@flow-state-dev/bullmq/worker`   | `createFlowWorker` (worker-only deploys)                      |
| `@flow-state-dev/bullmq/schedules`| Static schedule registration, schedule dispatch worker        |

## See also

- [BullMQ background jobs guide](https://flow-state.dev/guides/background-jobs-bullmq) — setup walkthrough with Docker
- [Scheduled actions reference](https://flow-state.dev/docs/server/scheduled) — framework scheduling contract
- [Inbound transports architecture](https://flow-state.dev/docs/advanced/inbound-transports) — dispatcher and transport adapter contracts

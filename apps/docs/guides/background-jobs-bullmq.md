---
sidebar_position: 13
title: Background jobs with BullMQ
---

# Background jobs with BullMQ

How to run flow actions as durable background jobs using Redis and BullMQ. This covers local development with Docker, co-located workers, separated worker processes, and scheduling.

---

## When to use this

Use `@flow-state-dev/bullmq` when you self-host (Docker, Railway, VPS, bare metal) and need:

- **Durable execution** — jobs survive process restarts. If a worker crashes mid-action, the job retries automatically.
- **Separated workers** — the web process enqueues jobs; dedicated worker containers process them. Useful when flow actions are CPU-heavy or long-running.
- **Native cron** — BullMQ's built-in repeatable-job scheduler replaces the polling-tick pattern used on serverless (Vercel Cron, Cloud Scheduler).
- **Dead-letter queues** — permanently failed jobs land in a DLQ for inspection.

If you deploy to Vercel or another serverless platform, you probably don't need this. Vercel's `after()` handles background work, and Vercel Cron handles scheduling.

---

## Prerequisites

- Node.js 20+
- Redis 6+ (local or managed)
- A flow-state-dev application with at least one flow

---

## 1. Install

```bash
pnpm add @flow-state-dev/bullmq bullmq ioredis
```

---

## 2. Start Redis locally

Add a `docker-compose.dev.yml` at your project root:

```yaml title="docker-compose.dev.yml"
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  redis-data:
```

Start it:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Set `REDIS_URL` in your `.env.local`:

```
REDIS_URL=redis://localhost:6379
```

---

## 3. Create the runtime

`createBullmqRuntime` gives you a queue for enqueuing jobs, a factory for constructing workers, and a `close` hook for graceful shutdown.

```ts title="lib/bullmq.ts"
import { createBullmqRuntime } from "@flow-state-dev/bullmq";

export const bullmq = createBullmqRuntime({
  connection: process.env.REDIS_URL ?? "redis://localhost:6379",
  retry: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
  },
});
```

### Enqueue a job

```ts
await bullmq.enqueueAction({
  flowKind: "billing",
  actionName: "generateInvoice",
  input: { month: "2026-06" },
  userId: "system",
});
```

### Start a co-located worker

For local development, running the worker in the same process is the simplest setup:

```ts
import { registry, stores, runtimeConfig } from "./your-server-setup";

const worker = bullmq.createWorker({ registry, stores, runtimeConfig });

process.on("SIGTERM", async () => {
  await worker.close();
  await bullmq.close();
});
```

---

## 4. Separated workers

For production, run workers in dedicated containers. The web process enqueues via `createWorkerDispatcher`; workers process via `createFlowWorker`.

### Web process

```ts title="lib/flowstate.ts"
import { Queue } from "bullmq";
import { createFlowState } from "@flow-state-dev/server";
import {
  createWorkerDispatcher,
  createRedisStreamBridge,
} from "@flow-state-dev/bullmq";

const redisUrl = process.env.REDIS_URL!;
const bridge = createRedisStreamBridge({ connection: redisUrl });
const queue = new Queue("fsd-flows", { connection: redisUrl });

export const flowstate = createFlowState({
  flows: { /* ... */ },
  dispatcher: createWorkerDispatcher({ queue, bridge }),
});
```

The `dispatcher` option routes all flow dispatches through the BullMQ queue. The `StreamBridge` uses Redis pub/sub to relay live events back to the web process so SSE clients still receive streaming updates.

### Worker process

```ts title="worker.ts"
import { createFlowWorker, createRedisStreamBridge } from "@flow-state-dev/bullmq";

const redisUrl = process.env.REDIS_URL!;
const bridge = createRedisStreamBridge({ connection: redisUrl });

const worker = createFlowWorker({
  connection: redisUrl,
  deps: {
    registry,   // same flow registry as the web process
    stores,     // same store setup
    runtimeConfig,
    bridge,     // publishes events back to web subscribers
    concurrency: 4,
  },
});

process.on("SIGTERM", () => worker.close());
```

---

## 5. Scheduling with BullMQ

BullMQ has a built-in repeatable-job scheduler. The `@flow-state-dev/bullmq/schedules` subpath bridges it to the framework's scheduled transport adapter.

### Register static schedules

```ts
import { Queue } from "bullmq";
import { registerStaticSchedules } from "@flow-state-dev/bullmq/schedules";

const queue = new Queue("fsd-schedules", { connection: redisUrl });

// Reads each flow's schedules.static map and upserts repeatable jobs.
// Idempotent — safe to call on every deploy.
await registerStaticSchedules({ registry, queue });
```

### Consume schedule fires

```ts
import { createScheduleDispatchWorker } from "@flow-state-dev/bullmq/schedules";

const scheduleWorker = createScheduleDispatchWorker({
  connection: redisUrl,
  queueName: "fsd-schedules",
  baseUrl: "http://localhost:3000",
  secret: process.env.CRON_SECRET!,
});
```

When a repeatable job fires, the worker POSTs to the framework's schedule dispatch endpoint. This bridges BullMQ's native cron to the same endpoint that Vercel Cron or Cloud Scheduler would hit.

### Schedule index

`createBullmqScheduleIndex` implements the `ScheduleIndex` interface for dynamic schedules. Because BullMQ fires jobs natively, `claimDue` returns `[]` — no polling tick is needed.

```ts
import { createBullmqScheduleIndex } from "@flow-state-dev/bullmq";

const scheduleIndex = createBullmqScheduleIndex(queue);
```

---

## Connection options

Pass a Redis URL string or an ioredis options object:

```ts
// URL
createBullmqRuntime({ connection: "redis://localhost:6379" });

// Options
createBullmqRuntime({
  connection: { host: "redis.internal", port: 6379, password: "secret" },
});

// TLS
createBullmqRuntime({ connection: "rediss://user:pass@redis.cloud:6380" });
```

The `prefix` option namespaces all BullMQ keys. Default is `"fsd"`. Use this for multi-tenant isolation or running multiple apps against the same Redis instance. Never use ioredis `keyPrefix` — it's incompatible with BullMQ's Lua scripts.

---

## Retry and dead-letter queues

```ts
createBullmqRuntime({
  connection: redisUrl,
  retry: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000, jitter: 0.3 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400 },
    deadLetter: true,
  },
});
```

| Option | Default | Description |
|--------|---------|-------------|
| `attempts` | 3 | Max attempts including initial |
| `backoff.type` | `"exponential"` | `"exponential"` or `"fixed"` |
| `backoff.delay` | 1000 | Base delay in ms |
| `backoff.jitter` | 0.5 | Jitter factor (0–1) |
| `removeOnComplete` | `{ age: 3600, count: 1000 }` | Cleanup for completed jobs |
| `removeOnFail` | `{ age: 86400 }` | Cleanup for failed jobs |
| `deadLetter` | `false` | `true` sends to `<queue>-dlq` after exhausting retries |

Validation errors, unknown flows, and unknown actions are marked as `UnrecoverableError` and skip retries entirely.

---

## Kitchen-sink reference

The kitchen-sink app includes BullMQ wiring as a reference. To try it:

```bash
# Start Redis
cd apps/kitchen-sink
docker compose -f docker-compose.dev.yml up -d

# Add to .env.local
echo "REDIS_URL=redis://localhost:6379" >> .env.local

# Start the app
pnpm dev
```

When `REDIS_URL` is set, the kitchen-sink creates a `BullmqRuntime` and logs its availability at startup. See `lib/flowstate.ts` for the wiring.

---

## See also

- [`@flow-state-dev/bullmq` API reference](/docs/api/bullmq) — full API docs
- [Scheduled actions reference](/docs/server/scheduled) — framework scheduling contract
- [Deploying with Docker](/guides/deploying-with-docker) — containerized deployment

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

## 3. Wire it up

One option on `createFlowState` does the whole job. `bullmqWorker` bundles the queue, the dispatch side, the worker, and the Redis stream bridge into a single adapter:

```ts title="lib/flowstate.ts"
import { createFlowState } from "@flow-state-dev/server";
import { bullmqWorker } from "@flow-state-dev/bullmq";

export const bullmq = bullmqWorker({
  connection: process.env.REDIS_URL!,
  retry: { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
});

export const flowstate = createFlowState({
  flows: { /* ... */ },
  stores: { /* ... */ },
  worker: bullmq,
});

// Runtime init is lazy. Warm it so the worker consumes the queue from boot,
// and drain it cleanly on shutdown.
void flowstate.ready();
process.on("SIGTERM", () => void flowstate.dispose());
```

That's the complete local setup. Actions now route through the BullMQ queue, and a worker in the same process consumes them. The framework hands both sides the same resolved flow registry, stores, and runtime config — there is no way to wire the worker against different stores than the web runtime, which is the classic mistake in queue setups (the worker's output silently disappears from streaming, refresh, and the devtool).

Live streaming still works: the worker persists events to the shared stores, and SSE clients tail them through the regular request-stream endpoint.

### Next.js dev note (HMR)

`next dev` re-evaluates your config module on every edit, and each evaluation builds a fresh FlowState — and a fresh worker. Without cleanup, stale workers accumulate and can claim jobs against orphaned stores. Dispose the previous generation when the module re-runs:

```ts
const hmr = globalThis as typeof globalThis & { __fsdFlowstate?: FlowState };
if (hmr.__fsdFlowstate) void hmr.__fsdFlowstate.dispose();
hmr.__fsdFlowstate = flowstate;
```

Don't reach for the cache-on-`globalThis` pattern you'd use for a database client — caching the FlowState would freeze your flows and config until a restart. Disposing the predecessor keeps HMR semantics: every edit takes effect, and exactly one worker generation is live. Production builds evaluate the module once, so this is a no-op there. The same applies to signal handlers: register `SIGTERM`/`SIGINT` once behind a `globalThis` flag, not per evaluation.

### Enqueue a one-off job

The adapter exposes the underlying runtime for direct enqueueing outside the action dispatch path:

```ts
await bullmq.runtime.enqueueAction({
  flowKind: "billing",
  actionName: "generateInvoice",
  input: { month: "2026-06" },
  userId: "system",
});
```

The `queue` property is also exposed — useful for mounting admin consoles like Bull Board.

---

## 4. Separated workers

For production, run workers in dedicated containers. Both processes build the **same** `createFlowState(...)` from shared config; the only difference is the adapter's `mode`:

```ts title="lib/flowstate.ts (shared config module)"
export const flowstate = createFlowState({
  flows: { /* ... */ },
  stores: { /* ... a backend both processes reach, e.g. Postgres ... */ },
  worker: bullmqWorker({
    connection: process.env.REDIS_URL!,
    mode: process.env.FSD_WORKER_MODE === "worker-only" ? "worker-only" : "dispatch-only",
    concurrency: 4,
  }),
});
```

- **Web container** — `FSD_WORKER_MODE=dispatch-only`. Serves the router; actions are enqueued, never processed here.
- **Worker container** — `FSD_WORKER_MODE=worker-only`. The entry point is just:

```ts title="worker.ts"
import { flowstate } from "./lib/flowstate";

await flowstate.ready();
process.on("SIGTERM", () => void flowstate.dispose());
```

Separated processes can't share an in-memory registry. Both sides need a store backend they genuinely share — Postgres in production, or SQLite/filesystem on a shared disk for a single-machine setup.

### Low-level primitives

`bullmqWorker` composes from public factories — `createBullmqRuntime`, `createFlowWorker`, `createWorkerDispatcher`, `createRedisStreamBridge`. Reach for them directly only when building a custom topology (your own dispatcher, a non-FlowState host). For everything else, the `worker` option is the supported path; hand-wiring these pieces means you own the store-sharing invariant yourself.

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

const scheduleIndex = createBullmqScheduleIndex(queue, { flowKind: "my-flow" });
```

---

## Connection options

Pass a Redis URL string or an ioredis options object:

```ts
// URL
bullmqWorker({ connection: "redis://localhost:6379" });

// Options
bullmqWorker({
  connection: { host: "redis.internal", port: 6379, password: "secret" },
});

// TLS
bullmqWorker({ connection: "rediss://user:pass@redis.cloud:6380" });
```

The `prefix` option namespaces all BullMQ keys. Default is `"fsd"`. Use this for multi-tenant isolation or running multiple apps against the same Redis instance. Never use ioredis `keyPrefix` — it's incompatible with BullMQ's Lua scripts.

---

## Retry and dead-letter queues

```ts
bullmqWorker({
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

When `REDIS_URL` is set, the kitchen-sink builds a `bullmqWorker` adapter (Bull Board mounts its queue at `/api/admin/queues`). Setting `FSD_BULLMQ_DISPATCH=1` additionally installs it as the FlowState `worker`, routing every action through the queue. See `lib/flowstate.ts` for the wiring.

---

## See also

- [Scheduled actions reference](/docs/server/scheduled) — framework scheduling contract
- [Deploying with Docker](/guides/deploying-with-docker) — containerized deployment

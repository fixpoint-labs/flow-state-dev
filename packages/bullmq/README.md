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

Hand `bullmqWorker` to `createFlowState` and actions stop running inline. They become queued jobs.

```ts
import { createFlowState } from "@flow-state-dev/engine";
import { bullmqWorker } from "@flow-state-dev/bullmq";

export const flowstate = createFlowState({
  flows: { billing },
  stores: { /* a backend the web process and the workers both reach */ },
  worker: bullmqWorker({ connection: process.env.REDIS_URL! }),
});

process.on("SIGTERM", () => flowstate.dispose());
```

A POST to an action returns a request id instead of running the action. A worker picks the job up, runs it against the same stores, and the client attaches to `GET /requests/:id/stream` exactly as it would for an in-process run. Same request, same session.

`createFlowState` hands the dispatch side and the worker the same resolved `{ registry, stores, runtimeConfig }`, so there is no way to wire a mismatched store registry through this path.

### Deployment modes

`mode` picks which sides of the queue this process runs. One flag, not a rewrite.

| Mode | This process | Use it for |
|---|---|---|
| `colocated` (default) | enqueues **and** consumes | local dev, single-container deploys |
| `dispatch-only` | enqueues only | the web tier of a separated deployment |
| `worker-only` | consumes only | a dedicated worker container |

```ts
// Web tier
worker: bullmqWorker({ connection: redisUrl, mode: "dispatch-only" })

// Worker container — build the same createFlowState from shared config
worker: bullmqWorker({ connection: redisUrl, mode: "worker-only" })
```

A `worker-only` process installs no dispatcher and typically never serves the router. Call `flowstate.ready()` to start consuming.

Options: `connection`, `mode`, `retry`, `concurrency` (default 2), `lockDuration` (default 300000 — LLM calls are slow), `prefix`, `queueName`, `channelPrefix`. The adapter also exposes `queue` and `runtime` for admin consoles and direct `enqueueAction` use.

## What crosses the queue, and what doesn't

Some limits are worth knowing before you rely on the queue for durability.

### A per-request runtime config does not cross

A `RuntimeConfig` holds live model resolvers, providers and loggers, and none of them serialize. The job payload carries the serializable envelope only: flow kind, action, input, identity, source, metadata, request id. The worker runs it under the config that worker was built with.

The case you will hit is `fsdev run --model`. The override applies to every generator in the command's own process and stops at the queue, so a flow that dispatches through Redis runs on two models at once: the one you passed, and the worker's. Each dispatch that loses the override logs a warning naming the request.

Serializing just the model id would be worse. The worker is a different process with its own gateways and keys, so a forced id may not resolve there at all.

### Background work started from a `worker-only` process is not durable

`worker-only` installs no dispatcher. Background work started there runs **inside the worker process itself**, and nothing is enqueued. That covers `ctx.requestHost.startDetached`, which is what a task board's `dispatch: { mode: "detached" }` worker uses.

That work belongs to the process, not to the queue. If the process stops, the run stops with it and nothing re-runs it: the request record stays where it stopped, and a task-board row the work had claimed is left for lease recovery. An enqueued job, by contrast, costs a retry rather than the work.

A `worker-only` process is a good place to *consume* durable jobs and a poor place to *start* them. For the queue to own the work, start it from a process that has a dispatcher, which means `colocated` or `dispatch-only`.

### `dispose()` does not wait for queued work

`FlowState.dispose()` closes the worker, which drains the jobs this process is currently running, then releases connections. It does not wait for jobs sitting in the queue, or for jobs running in another container. Waiting on those would block shutdown on a process this one does not control.

Background work that runs *in-process* is waited for, bounded by `detachedDrainTimeoutMs`. Work handed to the queue is not.

Shutdown also never writes a terminal status on cancelled work's behalf. The task returns to the board when its lease lapses; the request record is marked `interrupted` by a later sweep.

### Lower-level composition

`bullmqWorker` composes the primitives below, all exported for wiring the framework by hand: a custom transport, or a worker that is not a `createFlowState`.

```ts
import { Queue } from "bullmq";
import {
  createWorkerDispatcher,
  createFlowWorker,
  createRedisStreamBridge,
} from "@flow-state-dev/bullmq";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const bridge = createRedisStreamBridge({ connection: redisUrl });

// Web side: route all flow dispatches through the queue
const queue = new Queue("fsd-flows", { connection: redisUrl });
const dispatcher = createWorkerDispatcher({ queue, bridge });

// Worker side
const worker = createFlowWorker({
  connection: redisUrl,
  deps: { registry, stores, runtimeConfig, bridge },
});

process.on("SIGTERM", () => worker.close());
```

`createBullmqRuntime` bundles the queue, an `enqueueAction` helper, `createWorker`, and `close` if you want to enqueue jobs directly:

```ts
import { createBullmqRuntime } from "@flow-state-dev/bullmq";

const bullmq = createBullmqRuntime({ connection: redisUrl });

await bullmq.enqueueAction({
  flowKind: "billing",
  actionName: "generateInvoice",
  input: { month: "2026-06" },
  userId: "system",
});
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
- [Work that outlives the turn](https://flow-state.dev/guides/background-work) — how queued action runs relate to side chains and workstreams
- [Background work](https://flow-state.dev/docs/server/background-work) — reading what a queued job became
- [Scheduled actions reference](https://flow-state.dev/docs/server/scheduled) — framework scheduling contract
- [Inbound transports architecture](https://flow-state.dev/docs/advanced/inbound-transports) — dispatcher and transport adapter contracts

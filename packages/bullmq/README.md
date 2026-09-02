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

Hand `bullmqWorker` to `createFlowState` and actions stop running inline. They become queued jobs — in the default `colocated` mode and in `dispatch-only`. A `worker-only` process is the exception: it consumes the queue rather than feeding it, so it installs no dispatcher, and an action a router in that process receives runs inline instead of being enqueued. See [Deployment modes](#deployment-modes).

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

In one process, `createFlowState` hands the dispatch side and the worker the same resolved `{ registry, stores, runtimeConfig }`, so a `colocated` deployment cannot wire a mismatched store registry through this path.

That guarantee is structural and it is also local. In the separated topology below, the web tier and the worker container are two `createFlowState` instances in two processes, and nothing compares their configuration — so **you** are responsible for pointing both at the same durable backend. Wire them at different stores and the system still runs: jobs enqueue, the worker consumes and writes, and the web tier's stream and refresh routes read a store those writes never reached. The symptom is a request that stays in-progress forever on the client while the work has already completed somewhere the client cannot see.

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

## Limits

Some things do not behave the way "durable background jobs" suggests. Each is
covered in full elsewhere; the short version belongs here, where you wire it.

**A per-request `RuntimeConfig` does not cross the queue.** It holds live model
resolvers and providers, which do not serialize, so a queued job runs under the
worker's own configuration. `fsdev run --model` is the case you will hit: the
override applies in the command's process and stops at Redis, and each dispatch
that loses it logs a warning. See [Inbound
transports](https://flow-state.dev/docs/advanced/inbound-transports#execution-configuration-and-the-queue).

**`worker-only` starts background work in-process, and it is not durable.** That
mode installs no dispatcher, so a task board seat that hands off (`{ block,
session: "per-task" }`) or a `dispatcher()` block runs its child session inside
the worker process and enqueues nothing. If the process stops, nothing re-runs it. A
`worker-only` process is a good place to *consume* durable jobs and a poor place
to *start* them; start them from `colocated` or `dispatch-only`. See [Work that
outlives the turn](https://flow-state.dev/guides/background-work).

**`dispose()` does not wait for queued work.** Closing the worker drains the
jobs this process is running, not jobs sitting in the queue or running in
another container. That drain is a non-forced `Worker.close()` and is **not**
bounded by `detachedDrainTimeoutMs` — it takes as long as the claimed job does.
Only the separate in-process detached-work wait carries that budget. See
[Shutdown](https://flow-state.dev/docs/api/server#shutdown).

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
- [Work that outlives the turn](https://flow-state.dev/guides/background-work) — how queued action runs relate to side chains and child sessions
- [Background work](https://flow-state.dev/docs/server/background-work) — reading what a queued job became
- [Scheduled actions reference](https://flow-state.dev/docs/server/scheduled) — framework scheduling contract
- [Inbound transports architecture](https://flow-state.dev/docs/advanced/inbound-transports) — dispatcher and transport adapter contracts

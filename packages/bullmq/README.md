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

Hand `bullmqWorker` to `createFlowState` and actions are enqueued as jobs instead of running inline:

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

Options: `connection`, `mode`, `retry`, `concurrency` (worker slots per process, default 2; not the same thing as an entry's [concurrency policy](#concurrency-across-workers)), `lockDuration` (default 300000, since LLM calls are slow), `prefix`, `queueName`, `channelPrefix`, `leaseMs` (default 10000). The adapter also exposes `queue` and `runtime` for admin consoles and direct `enqueueAction` use.

### Deployment modes

`mode` picks which sides of the queue this process runs.

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

In `colocated` mode, a job may run on any worker on the queue: this process or another replica's. A `worker-only` process installs no dispatcher and typically never serves the router. Call `flowstate.ready()` to start consuming. An action a router in that process does receive runs inline instead of being enqueued.

### Point every process at the same stores

In one process, the dispatch side and the worker share the same resolved `{ registry, stores, runtimeConfig }`, so a `colocated` deployment can't end up with mismatched stores.

A separated deployment is two `createFlowState` instances in two processes, and nothing compares their configuration. **You** point both at the same durable backend. Wire them at different stores and nothing fails loudly: jobs enqueue, the worker consumes and writes, and the web tier's stream and refresh routes read a store those writes never reached. The client sees a request that stays in progress forever while the work has already completed somewhere it can't see.

## Concurrency across workers

`bullmqWorker` enforces each entry's `concurrency` policy across the whole deployment, using the same Redis as the queue. Two `queue` runs into one session run one after the other even when they land in different worker containers, in the order they were accepted, and a `reject` duplicate gets a 409 naming the run in flight. A worker never blocks a slot waiting: a job whose turn hasn't come goes back on the queue as a delayed job, which BullMQ doesn't count as an attempt. A retried job keeps its place, and when a run finishes the next job in line is started straight away.

A delivery into an existing session (`dispatcher()` with `session: { id }`) runs here, under the recipient's policy. Declare `concurrency: "allow"` on an entry that should run in parallel.

`hold` and `defer` also apply across workers. Say a conversation's `reply` is `hold` and a finished task's `notice` is `defer`. The reply runs as soon as a worker takes it, and the conversation reads busy from the moment the reply is accepted until it ends; another reply still starts at once beside it. The notice waits until no reply is running or waiting on the conversation, then runs, and notices on one conversation run one at a time. Like a waiting `queue` job, a waiting notice goes back on the queue as a delayed job for at most two seconds between checks, so it never holds a slot. It yields to replies that start after it for 30 seconds; after that it lines up behind the replies already running and runs when they end. Its wait has no time limit otherwise.

If the worker running the reply crashes, the notice waits until that worker's lease runs out (`leaseMs`), then runs.

The cap of 32 `defer` requests per conversation is counted in the process that accepted them. A request handed to the queue counts from acceptance until its job ends, including while it runs. The next one is refused (a 409 over HTTP) and nothing is enqueued for it. A request from a caller who doesn't own the conversation is refused before it can mark the conversation busy or use up the cap.

Each place in line has a lease, `leaseMs` long, that the worker holding it keeps renewing. If a worker dies, the session's key frees once the lease runs out. If a worker can't reach Redis to renew the place its running job holds, it aborts that run's signal at half the lease and the request ends `interrupted`. The stop is cooperative: a run that honours `ctx.signal` has ended before another worker can take the key, and one that ignores it can still be running when the next one starts. A job whose place was dropped while its worker was gone lines up again at the back when it runs. A `defer` job that had claimed the free key waits for the key to be free again instead.

A session's line is meant to be short: the runs waiting on one conversation, not a backlog. Each turn check looks at every expired place in that line, so a key with hundreds of waiters costs Redis work on every check. If one key can collect that many (a webhook that fires in bursts into a single session, say), declare `reject` on it, or spread the work over more than one key.

**Upgrading:** roll out workers before the processes that enqueue. A job enqueued by the new release and picked up by a worker from the release before runs once without the policy, and its session can then wait up to `leaseMs` before the next run starts. An older worker also treats a `hold` job as `queue`, so a reply can wait for the one before it and fail after 30 seconds, and it runs a `defer` job at once.

The lines live on `createRedisLeaseBackend`, which `bullmqWorker` builds for you. It is exported for [lower-level composition](#lower-level-composition): pass it to the engine as `leaseBackend` on your `WorkerAdapter` and to `createFlowWorker` in its deps.

See [Concurrency policies](https://flow-state.dev/docs/advanced/concurrency-policies) for the policies themselves.

## Limits

Each of these is covered in full elsewhere. The short version belongs here, where you wire it.

**A per-request `RuntimeConfig` does not cross the queue.** It holds live model
resolvers and providers, which do not serialize, so a queued job runs under the
worker's own configuration. `fsdev run --model` is the case you will hit: the
override applies in the command's process and stops at Redis, and each dispatch
that loses it logs a warning. See [Inbound
transports](https://flow-state.dev/docs/advanced/inbound-transports#execution-configuration-and-the-queue).

**`worker-only` starts background work in-process, and it is not durable.** That
mode installs no dispatcher, so a dispatch (what a `dispatcher()` block and a task
board's hand-off seat both send) runs the work inside the worker process and
enqueues nothing. If the process stops, nothing re-runs it. A
`worker-only` process is a good place to *consume* durable jobs and a poor place
to *start* them; start them from `colocated` or `dispatch-only`. See [Work that
outlives the turn](https://flow-state.dev/guides/background-work).

**`dispose()` does not wait for queued work.** Closing the worker drains the
jobs this process is running, not jobs sitting in the queue or running in
another container. That drain is a non-forced `Worker.close()` and is **not**
bounded by `dispatchDrainTimeoutMs`: it takes as long as the claimed job does.
Only the separate wait for in-process dispatch runs carries that budget. See
[Shutdown](https://flow-state.dev/docs/api/server#shutdown).

## Lower-level composition

`bullmqWorker` composes the primitives below, all exported for wiring the framework by hand: a custom transport, or a worker that is not a `createFlowState`. Wired this way, keeping the web side and the worker on the same stores is up to you.

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
  flowKind: "billing", // the instance id, carried unchanged to the worker
  actionName: "generateInvoice",
  input: { month: "2026-06" },
  userId: "system",
});
```

`flowKind` on the job is the exact instance the worker resolves: a singleton's kind, or a collection member's own id. The worker does not translate it, and a job naming a session another instance owns fails as `UnrecoverableError` with nothing written, rather than retrying. Turning an existing flow into a collection needs the queue drained first: a job enqueued under the bare kind finds no instance afterwards. Saved sessions are attributed offline, see the [persistence guide](https://flow-state.dev/docs/persistence/overview#who-owns-a-record).

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
| `@flow-state-dev/bullmq`          | Runtime, dispatcher, stream bridge, Redis lease backend, schedule index, connection utilities |
| `@flow-state-dev/bullmq/worker`   | `createFlowWorker` (worker-only deploys)                      |
| `@flow-state-dev/bullmq/schedules`| Static schedule registration, schedule dispatch worker        |

## See also

- [BullMQ background jobs guide](https://flow-state.dev/guides/background-jobs-bullmq) — setup walkthrough with Docker
- [Work that outlives the turn](https://flow-state.dev/guides/background-work) — how queued action runs relate to side chains and dispatch runs
- [Dispatched work](https://flow-state.dev/docs/server/background-work) — reading what a queued job became
- [Scheduled actions reference](https://flow-state.dev/docs/server/scheduled) — framework scheduling contract
- [Inbound transports architecture](https://flow-state.dev/docs/advanced/inbound-transports) — dispatcher and transport adapter contracts

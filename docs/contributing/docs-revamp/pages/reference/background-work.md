---
title: Background work
type: reference
description: "Side chains, queued runs and dispatches: their options, what each outlives, how each fails, how each is watched, and what happens when a process stops."
---

# Background work

Background work is work that should not hold up the reply. Flow State has three kinds, and they differ in what has to be alive when the work finishes: the request that started it, a process that consumes a job queue, or a session of its own that keeps the work's record. This page lists the options, lifetimes, failure shapes and limits of each. For how to choose between them, read [Background work](../concepts/background-work.md).

The examples belong to one app, a support desk. Its `support` flow runs `summarizeTicket` beside the reply and audits an account with `auditAccount`.

| | Side chain | Queued run | Dispatch |
|---|---|---|---|
| Started by | `.sideChain()`, `.sideChainIf()`, `.forEachSideChain()` | `createFlowState({ jobQueue })` | `dispatcher()`, or a task board worker that dispatches |
| Runs in | the request that queued it | a process consuming the job queue | a session of its own |
| Outlives | the sequencer that queued it, not the request | the web process that accepted the POST | the request that started it; the process only if a queue carries it |
| Own session | no | no, the same session | yes |
| Own request id | no, the request's | the same request id | its own |
| Fails as | a log line and a failed `block_trace`; the request stays `completed` | a retry, then a failed request | the dispatched request's own status |
| Watched through | the request it runs in | the request's stream and status | the session's listing, then the run's requests |

A task board worker that is a plain block is not background work: it runs inline in the request that drains the board. See [Task board](./task-board.md).

Queued runs are a setting of the host, `jobQueue`, and cover every action call on it. The one exception is a dynamic schedule's fire, which runs in the process that ticked (see [Same stores](#same-stores)). There is no per-action "background" setting, and `durable: true` does not move a run to a queue. See [Runtime configuration](./runtime.md).

## Side chains

A side chain runs a block beside a sequencer's steps. The step's value passes through unchanged, and the chain moves on at once.

```ts title="src/flows/support/blocks/handle-ticket.ts"
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { draftReplyFor } from "../../../lib/replies";
import { summarize } from "../../../lib/summaries";

const draftReply = handler({
  name: "draft-reply",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ reply: z.string() }),
  execute: async (input) => ({ reply: await draftReplyFor(input.message) }),
});

const summarizeTicket = handler({
  name: "summarize-ticket",
  inputSchema: z.object({ reply: z.string() }),
  execute: async (input) => {
    await fetch("https://tickets.example.com/summaries", {
      method: "POST",
      body: JSON.stringify({ summary: await summarize(input.reply) }),
    });
  },
});

export const handleTicket = sequencer({
  name: "handle-ticket",
  inputSchema: z.object({ message: z.string() }),
})
  .step(draftReply)
  .sideChain(summarizeTicket);
```


### Calls

| Call | Does |
|---|---|
| `.sideChain(block, { name? })`, `.sideChain(connector, block, { name? })` | Queues `block` on the request's pool. The connector runs in the main chain, and only the block is backgrounded. |
| `.sideChainIf(condition, [connector,] block, { name? })` | The same, when `condition` is truthy. A falsy condition is a complete no-op: no block, no items. `condition` is a boolean or `(value, ctx) => boolean \| Promise<boolean>`. |
| `.forEachSideChain([connector,] block, { concurrency? })` | Queues one task for the whole array, which runs the elements `concurrency` at a time (default 16). The output is the original array. If elements fail, the task fails with the first failure, so `backgroundFailures` carries one entry for the batch. |
| `.waitForSideChain({ failOnError?, timeoutMs? })` | A barrier that waits for the calling sequencer's own side-chain tasks. |

### What a side chain outlives

| Rule | Detail |
|---|---|
| One pool per request | Every side-chain task of a request shares one pool. The request drains it before its final record and event. A task queued by a task is waited on too: the drain repeats until the pool is empty. |
| The wait happens however the request ends | On success, a throw, an explicit stop or a dropped connection. The record stays `in_progress` until the pool settles, then is written `failed`, `interrupted` or `aborted`. |
| A dropped connection cancels nothing | Only an explicit abort does. The task's `ctx.signal` fires only on an explicit cancel. A stopped task surfaces a failed `block_trace` carrying the cause. A cancel accepted while the pool drains ends the request `aborted`, even if the foreground had finished. |
| A suspension does not wait | A request that suspends at a gate neither awaits nor aborts in-flight side-chain tasks. |
| Siblings run concurrently | Two sequencers that each queue a task finish in about the time of the slower. An inner sequencer does not block its parent on its own side chains. |
| `.waitForSideChain()` | Drains only the calling sequencer's tasks, not siblings'. `timeoutMs` bounds the wait, not the request: the request ends only when its side-chain work has settled. |
| Bounding a task | A per-block timeout is the only way. No setting kills a task on disconnect. A task can listen on `ctx.signal`. |
| Work queued from `onFinished` or `onErrored` | Waited on, but those hooks run after the final event went out, so the client's stream may already be closed. Queue it from `onCompleted` when the client must see it. |
| A process that stops | Work in flight is gone. After a crash on a durable host, a continue replays side-chain work that had completed, injecting its output from the log, and re-runs work that was in flight. That is at-least-once, not exactly-once. Wrap a non-idempotent effect in `ctx.runOnce(key, fn)`, keyed per item for `.forEachSideChain()`. |
| Replay needs the trace | Replay reads the block's `block_trace`. Trace observability is on in dev and test and off when `NODE_ENV=production`, unless `FSDEV_TRACE_OBSERVABILITY` is `true`, `false`, `1` or `0`. A `transient: true` block records no trace. Without a trace, finished background work re-runs on a continue. |

### How a side chain fails

| Rule | Detail |
|---|---|
| The request does not fail | A failure is logged, and a failed `block_trace` goes to the DevTool trace channel. Nothing reaches the user's stream. The request stays `completed`, and the failed task is not retried. |
| End hooks hear about it | Request-end hooks (`onFinished` and the others) receive every failed background step as `backgroundFailures: [{ step, message }]`, in drain order, gathered across the action's, the end hooks' and a default `.waitForSideChain()`'s drains. The field is absent when none failed. |
| When the list is not handed on | When the request's cancel fired, and when the request ends `suspended`. A dropped connection is not a cancel, so failures after one are handed on. |
| `.waitForSideChain()` by default | Does not throw on a failure, and the pipeline continues. A failure it drained, and one that lands after a `timeoutMs` wait gave up, are handed to the end hooks as well. |
| `.waitForSideChain({ failOnError: true })` | Drains first, then throws the first failure, so the request fails only after the scope settles. It applies to every queued task in the scope. A request that failed this way cannot be continued on the same id; the follow-up is a fresh retry. |
| Inside a dispatched task | A background step that throws fails the task's attempt, though the request reports `completed`. If the request was cancelled, a background failure does not fail the attempt. A dropped connection does not count as a cancel. A failure from before a suspension does not carry over: the resume reruns the step and that run is the one that counts. |
| The request's own status | Never depends on a background failure. The runtime only hands failures on. A hook that must act on them does so itself. |

### How a side chain is watched

A side chain is not a request of its own. Watch the request it runs in: its stream, status and item log. Its `block_trace` rows are in that request's trace in the DevTool, and with trace observability off they are not recorded.

## Queued runs

A queued run is the same request, worked by another process. Give the host a job queue and each action call becomes a job. The POST returns `202` with the request id, a consumer picks the job up and runs it against the same stores, and the client attaches to the request's stream.

```ts title="src/flows/support/flow.ts"
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { findAccountIssues } from "../../lib/accounts";
import { handleTicket } from "./blocks/handle-ticket";

const auditAccount = handler({
  name: "audit-account",
  inputSchema: z.object({ accountId: z.string() }),
  execute: async (input) => ({ accountId: input.accountId, findings: await findAccountIssues(input.accountId) }),
});

export const supportFlow = defineFlow({
  kind: "support",
  actions: { reply: { block: handleTicket } },
  internal: { actions: { auditAccount: { block: auditAccount } } },
});
```

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { bullmqJobQueue } from "@flow-state-dev/bullmq";
import { postgresStores } from "@flow-state-dev/store-postgres";
import { supportFlow } from "./src/flows/support/flow";

export default createFlowState({
  flows: [supportFlow({ id: "support" })],
  stores: postgresStores({ connectionString: process.env.FSD_DB_URL }),
  jobQueue: bullmqJobQueue({ connection: process.env.REDIS_URL ?? "redis://localhost:6379" }),
});
```

The host options that go with `jobQueue` (it cannot be combined with `runner`, the stores every process must reach, when processing starts, and `dispose()`) are on [Runtime configuration](./runtime.md).

### Options of `bullmqJobQueue`

| Option | Default | What it does |
|---|---|---|
| `connection` | required | A Redis URL string, or an ioredis options object. `rediss://` turns TLS on. A `default` username is ignored. |
| `prefix` | `"fsd"` | Namespaces every BullMQ key. Do not use ioredis `keyPrefix`, which BullMQ's scripts do not support. |
| `queueName` | `"fsd-flows"` | The queue. |
| `mode` | `"colocated"` | Which sides this process runs. See [Modes](#modes). An unknown mode throws, naming the three. |
| `retry` | see [Retry and dead letter](#retry-and-dead-letter) | Retry, backoff, cleanup and dead-letter, applied to enqueued jobs and to the processor. |
| `concurrency` | `2` | Jobs one processing process runs at once. Not an entry's `concurrency` policy. |
| `lockDuration` | `300000` ms | The BullMQ job lock. |
| `channelPrefix` | `"fsd:stream"` | Redis pub/sub prefix for the live-event bridge. |
| `leaseMs` | `10000` | How long a concurrency place lives past its last renewal. |

The returned adapter also exposes `mode`, `queue` (for Bull Board) and `runtime` (`enqueueAction`, `createJobProcessor`, `close`). `runtime.enqueueAction(data, opts?)` takes `retry`, `priority`, `delay` and `jobId`.

### Modes

| `mode` | This process | An action call over this process's HTTP routes | Use |
|---|---|---|---|
| `"colocated"` | Enqueues and consumes. Starts consuming at startup | Becomes a job | One process. A job may run on any consumer of the queue, this process or another replica's. |
| `"enqueue-only"` | Enqueues only | Becomes a job | The web tier of a split deployment. |
| `"process-only"` | Consumes only. Starts consuming on `ready()` | Runs inline | A dedicated processing container. |

- A `process-only` process usually serves no HTTP routes.
- In `process-only`, a dispatch runs the work in the worker process and enqueues nothing. It is not durable: if the process stops, nothing re-runs it. Start durable work from `colocated` or `enqueue-only`.
- In `enqueue-only`, `dispose()` does not wait on a dispatched child, which may have no consumer here.
- On a serverless host, `colocated` does not lift the function's time limit, because the same invocation enqueues and consumes. A consumer with its own lifetime does: a container in `process-only`, or the web tier in `enqueue-only`.

### Same stores

In one process the enqueue side and the processor receive the same flows, stores and runtime configuration. Split processes are two `createFlowState` instances, and nothing compares them.

| Rule | Detail |
|---|---|
| Different stores fail quietly | If the web tier and the worker point at different stores, jobs enqueue and the worker writes, but the web tier's stream and refresh routes read a store those writes never reached. The client sees a request in progress forever while the work has finished where it cannot see. Use a backend both reach, such as Postgres. |
| Per-request `RuntimeConfig` | Does not cross the queue. A queued job runs under the worker's own configuration. `fsdev run --model` applies in the command's process only, and each dispatch that loses it logs a warning. |
| Dynamic schedules | A dynamic schedule's fire runs in the process that ticked, even when a `jobQueue` is set. A static one goes to the queue. |
| Abort across processes | The abort route answers `204` when the request is running in this process and `202` when it recorded the intent for the process running it. Delivery rides the run's heartbeat tick (`heartbeatIntervalMs`, default 10 s) and needs a request store shared across processes. With `heartbeatIntervalMs: 0`, a running request never hears a cancel recorded elsewhere. |

### Retry and dead letter

| `retry` option | Default | What it does |
|---|---|---|
| `attempts` | `3` | Maximum attempts, including the first. |
| `backoff.type` | `"exponential"` | `"exponential"` or `"fixed"`. |
| `backoff.delay` | `1000` | Base delay in ms. |
| `backoff.jitter` | `0.5` | Jitter factor. |
| `removeOnComplete` | `{ age: 3600, count: 1000 }` | Completed jobs are removed after an hour or past 1,000 jobs. A boolean, or an object with `age`, `count` or both. |
| `removeOnFail` | `{ age: 86400 }` | Failed jobs are removed after a day. |
| `deadLetter` | `false` | `true`: a job that exhausts its retries, or ends unrecoverably, is added to `<queue>-dlq` as a `dead-letter` job carrying its data plus `failedReason` and `originalJobId`. `{ queueName }` names the queue. |

A `backoff` or `removeOn*` value replaces the whole default object. Fields are not merged. `{ type, delay }` with no `jitter` loses the default `jitter: 0.5`.

| Rule | Detail |
|---|---|
| Retried | A run that returns a retryable error, and a throw. |
| Not retried | Validation errors, an unknown flow, an unknown action, a session or request another flow instance owns, a missing organization, and a run stopped because its concurrency place was lost. These go straight to failed. |
| Same request id | A retry keeps the request id. Its events continue the sequence numbering past the last persisted event, so a client resuming from a sequence number loses none. The terminal event is published only on the final attempt or an unrecoverable error, so the stream stays open across retries. |
| Concurrency place | A retried job keeps its place on a concurrency key. |

### What happens to a queued run when the worker dies?

| Situation | What happens |
|---|---|
| The processor returns a retryable error or throws | The job retries on the backoff schedule, with the same request id, until `attempts` is spent. The final failure publishes the error terminal and, with `deadLetter`, writes the dead-letter job. |
| The worker process dies mid-job | The job's lock lapses and the job is picked up again from the queue. `lockDuration` is 300000 ms by default. |
| The web side while the worker is dead | The enqueue side watches the job's state in BullMQ every 10 s. When the job has ended without a terminal message, the enqueued request settles with the job's return value, or an error terminal carrying its `failedReason`. A job that is waiting, delayed or running keeps it open. |
| The run held a place on a session's concurrency key | A dead worker frees the key once its lease runs out, `leaseMs` (10 s by default). A job whose place was dropped while its worker was gone lines up again at the back. A `defer` job that lost its place this way waits for the key to be free again. |
| The worker is alive but cannot reach Redis to renew | It aborts the run's signal at half the lease, and the request ends `interrupted`. The stop is cooperative: a run that honours `ctx.signal` has ended before another worker can take the key, and one that ignores it can be running when the next starts. The job is not retried. |
| Redis is unreachable when the request arrives | The request is refused and nothing is enqueued or run. |
| The request record | Persisted `in_progress` at enqueue, so a stream that attaches before any worker claims the job resolves a record and waits at sequence 0. An unknown id is `404`. |

An `interrupted` request can be continued. Nothing continues or re-runs it for the caller: a client continues or retries it.

A concurrency policy holds across enqueuing and processing processes. The order, the `queue` timeout, the `defer` cap and the rest are on [Concurrency policies](./concurrency.md).

## Dispatch

A dispatch starts a request in a session of its own, and returns as soon as the runtime has accepted it. A flow declares the work under `internal.actions`, beside `actions`. An internal entry has an action's shape, and no client can call it. No endpoint starts a dispatch: it begins inside a running request.

```ts title="src/flows/support/blocks/start-audit.ts"
import { dispatcher } from "@flow-state-dev/core";
import { z } from "zod";

export const startAudit = dispatcher({
  name: "start-audit",
  inputSchema: z.object({ accountId: z.string() }),
  action: "auditAccount",
  session: { key: (input) => `audit-${input.accountId}` },
});
```

`auditAccount` is an entry under the `support` flow's `internal.actions`. A dispatcher is a handler: use it in a sequencer step, as a generator's tool, or as an action's root block.

### Options of `dispatcher()`

| Field | Required | What it does |
|---|---|---|
| `name` | yes | The block name. |
| `action` | yes | The entry, `flow.internal.actions[action]`. `defineFlow` throws when a same-flow `action` names an entry the flow does not declare, and an action of the same name under `actions` does not stand in. A cross-flow address is checked at dispatch time. |
| `flowKind` | no | Sends to another flow instance, by its id: a kind, or a collection copy's own id. A collection's bare kind names no instance. |
| `inputSchema` | no | What the block accepts. Default `z.unknown()`. |
| `session` | yes | Which session the run is in. See [`session`](#session). |
| `payload` | no | The entry's input, computed from the block's input. Default: the input as is. The entry's own schema validates it on arrival. |
| `wait` | no | `true` waits for the dispatched request and outputs how it ended. Default `false`. See [`wait: true`](#wait-true). |
| `transient` | no | Hides the block's trace from clients. |
| `description`, `type` | no | `type` defaults to `internal`. A task board's dispatcher leaves `type` unset: its `session` makes it a task dispatcher. |

A dispatcher has no delay or run-at option. Timed work is on [Schedules](./schedules.md).

### What a dispatch returns

`{ sessionId, requestId, adopted }`, as soon as the runtime has accepted the request and without waiting for the work. `adopted` is `true` when the session already existed. The entry validates the payload on arrival. A refusal throws instead. The dispatch returns no result: to get one without `wait`, the dispatched work writes it somewhere both sides read (a user- or org-scoped resource, a task board) or reports back with a `{ from: true }` dispatcher. How a dispatched run shares a resource with the conversation is on [Resources](./resources.md).

### `session`

| `session` | Runs in | If it does not exist |
|---|---|---|
| `{ key: (input, ctx) => string }` | A child session derived from the key, recorded against the running session. | Created. The next call with the same key from the same conversation returns `adopted: true`. |
| `{ key, state }` (`state`: an object, or `(input, ctx) => object`) | The same, created with that initial state. | Created with that state if the target flow's `stateSchema` parses it and its `createCheck` accepts it. An existing run keeps its own state. |
| `{ id: (input, ctx) => string }` | An existing session of this flow kind that belongs to this user. | Refused `session-not-found`. Nothing is created. |
| `{ from: true }` | The session that dispatched this run, supplied by the runtime. | Refused `no-sender` when the request was not dispatched by the runtime. |

- The key is scoped to the conversation: the same key from another conversation is a different run.
- A `key` or `id` function that returns an empty string throws a plain `Error` naming the block.
- A reply to another flow: the other flow dispatches `{ from: true }` with `flowKind` pointing at the sender's flow. If the sender's session is not owned by the instance named, the reply is refused `session-not-addressable`. Ownership is by instance, not kind.
- With `flowKind`, the run's session records the conversation that started it but belongs to the instance it was sent to, and its `flowId` in listings is that instance's. Two copies of one definition are two instances: one conversation dispatching to `review-east` and `review-west` gets two runs. Both flows must be registered on the same server. Whatever the run needs travels in the payload.

### What the run is

A dispatched run executes the same flow as the same user, in the same organization and tenant. It carries `source: "internal"`, or `"task"` when a board worker dispatched it, and a `metadata.dispatch` bag the runtime builds and a request body cannot write.

| `metadata.dispatch` field | Meaning |
|---|---|
| `type` | `internal` or `task`. |
| `action` | The entry dispatched to. |
| `from` | `{ block, sessionId }`: the dispatching block and session. |
| `key` | The key the session was derived from. Absent when delivered by `id`. |
| `taskId` | Only on a task dispatch. |

Read the bag only when `source` is `"internal"` or `"task"`. How the HTTP routes treat a dispatched run's request id is on [HTTP API](./http-api.md).

### Refusals

A refusal throws `DispatchRefusedError` (`code: "dispatch-refused"`, with `blockName`, `address`, `refused` and `detail`). Every refusal is decided before anything starts, so a `.rescue()` can branch on `refused`. `detail` is for operators and is not a stable contract.

| `refused` | Meaning |
|---|---|
| `no-entry` | The addressed flow declares no entry at that address. Resolution never falls through to `actions` or to the sender's own entry of that name. |
| `flow-not-found` | `flowKind` names a flow this server has not registered, a collection's bare kind included. |
| `session-not-found` | An `id` names a session that does not exist. |
| `session-not-addressable` | An `id` names a session that is another user's, or on another flow. |
| `key-occupied` | A `key` derived a session id already held by a record that is not this conversation's run. |
| `create-refused` | The target flow's `stateSchema` or `session.createCheck` refused the session: the `state` named, or the lack of one. |
| `no-dispatch-operation` | This process runs requests but has no way to start one. You only see this from a host not built with `createFlowState`. |
| `dispatch-rejected` | The entry's `concurrency` is `reject` and its key is held. Also returned once shutdown has begun. |
| `external-flow-runner` | An `id` dispatch on a host whose `jobQueue` adapter cannot hold concurrency places across processes. `bullmqJobQueue` can, so it never refuses this way. A `key` dispatch, and a reply sent from a `process-only` process, are never refused this way either. |
| `no-sender` | `{ from: true }` on a request the runtime did not dispatch. |

`NoDispatchSeamError` (`code: "no-dispatch-seam"`) is thrown when a dispatcher runs in a context no runtime built, such as a hand-made test context. Run it through a real runtime built with `createFlowState`.

### What a dispatch outlives

| Host | Outlives | Does not outlive |
|---|---|---|
| No `jobQueue` | The request that started it. | The process. On stop, `dispose()` waits up to `dispatchDrainTimeoutMs`, then cancels it. For a run not finished, the stale sweep (see [What a stopped process leaves behind](#what-a-stopped-process-leaves-behind)) marks the request `interrupted`, the row goes on reading `active`, and nothing restarts it. |
| `colocated` or `enqueue-only` | The request, and the web process. A delivery is enqueued and runs in whichever process picks it up, with retries. | An `id` delivery whose recipient session was deleted and recreated meanwhile, which is dropped. |
| `process-only` | The request. | The process. |
| Serverless, `colocated` | The request. | The function's maximum duration. |

### `wait: true`

The block's output is how the dispatched request ended.

| Output | When |
|---|---|
| `{ status: "completed", output, requestId }` | The request finished. |
| `{ status: "failed", error, requestId }` | The request failed, or was stopped. |
| `{ status: "running", requestId }` | The deadline passed. Nothing is stopped and the work runs on. |

`wait: true` needs a durable action on a host that keeps wakes, and it throws when it cannot wait. Its deadline, nesting limit and errors are on [Pause, resume and replay](./durable-execution.md), and the deadline bounds are on [Runtime configuration](./runtime.md). A task board dispatcher takes its wait from the board's mode: see [Task board](./task-board.md).

### Dispatching from a task board

A task board worker can be a dispatcher that sends each claimed row to a run of its own. Its `session` values, the board requirements and what each board mode does are on [Task board](./task-board.md).

## Listing and reading dispatched runs

| Read | Returns |
|---|---|
| `GET /api/flows/sessions?flowKind=…&include=dispatch-runs`, or `fsd.sessions.list({ flowKind, include: "dispatch-runs" })` | The caller's sessions plus the sessions dispatchers ran work in. Whole session records. A dispatched one carries `parentSessionId`, `topic` and `coordinate`. |
| `GET /api/flows/sessions/:sessionId/children`, or `fsd.sessions.children(sessionId)` | One summary row per run started from that conversation. |
| `GET /api/flows/sessions/:runId/requests`, or `fsd.sessions.requests(runId)` | The run's own requests. `?include_items=true` adds the item log, and `?include_result_output=true` adds the action's return value. |

Accepted `include` values, how a listing is scoped to the caller, and the access rule for `/children` are on [HTTP API](./http-api.md).

### A `/children` row

`ChildSessionSummary` has these eight fields and no others. `topic` and `coordinate` are display labels: don't route or authorize on them. The four optional fields can be absent.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | The bare child session id. Read it with every session endpoint. |
| `parentSessionId` | string | The bare id of the conversation it hangs off. |
| `createdAt`, `updatedAt` | number | Epoch ms. |
| `flowId` | string, optional | The flow instance that owns the child. |
| `topic` | string, optional | A display label: the key the session was derived from. |
| `coordinate` | string, optional | A display label: the entry dispatched to, as `<type>:<target>` (`internal:summarize`, `task:implement`). |
| `status` | optional | See [`status` on a run](#status-on-a-run). |

| Row comes from | `source` | `metadata.dispatch.type` | `coordinate` |
|---|---|---|---|
| `dispatcher()` in a flow | `internal` | `internal` | `internal:<action>` |
| A task board dispatching worker | `task` | `task` | `task:<action>` |

Paging, ordering and the `limit` ceiling of the `/children` route are on [HTTP API](./http-api.md).

### `status` on a run

`active` means not finished: queued, running, paused for approval, or interrupted and not superseded. The route does not tell them apart. Every other value is how the run's last request ended.

| Value | Meaning |
|---|---|
| (absent) | The run has no request yet. |
| `active` | The session has a request `in_progress` or `suspended`, or its most recent request is `interrupted` and so continuable. |
| `completed` | The most recent request finished. Finished is not the same as succeeded. |
| `failed` | The run itself ended with an error. |
| `aborted` | Cancelled. |
| `incomplete` | Stopped short, usually on a token budget. |

- With every request terminal and disagreeing, the row reports the most recent outcome: a run that failed and was retried successfully reads `completed`. The failed attempt is in the run's own history.
- `active` describes what the system recorded, not what a worker is doing. A worker process that dies leaves the row `active`.
- A dispatched run doing a task board's work can read `completed` while its task read `errored`. The run's status says whether anything is running, and the task says whether the work came out right. See [Task board](./task-board.md).

## When a process stops

`dispose()` waits for dispatched requests running in this process, then closes the job processing and the stores. The wait, its `dispatchDrainTimeoutMs` ceiling and the messages it prints are on [Runtime configuration](./runtime.md). Side chains are not part of that wait.

### What a stopped process leaves behind

| Left behind | Becomes |
|---|---|
| A run row | Reads `active` with nothing running it, until a retry or continue supersedes the request. |
| The request record | `in_progress`, then marked `interrupted` by the stale sweep. |
| A dispatched task | Taken back once its lease lapses and some worker claims it again. After `maxAbandonments` it settles `errored`. |

| Setting | Default | What it does |
|---|---|---|
| `detectInterruptedOnStartup` | on | Runs the sweep at runtime start. Turn it off on serverless. `dispose()` waits up to 5 s for the startup sweep before it closes the stores. |
| `staleSweepIntervalMs` | `30000` | How often the sweep runs while a server is up. `0` disables it. It can also run on demand. |
| `staleSweepThresholdMs` | `60000` | A record is stale when its heartbeat has been quiet this long. |
| `queuedGraceMs` | `600000` | A queued request has no heartbeat yet, so it is marked stale after this long instead. |
| `request.heartbeatIntervalMs` | `10000` | How often a running request refreshes its heartbeat. `0` disables it. |
| `onBackgroundWork` | none | `(promise) => void`. On a platform that freezes the function after the response, pass its post-response primitive (for Next, `(p) => after(() => p)`). It receives the `finished` promise of a dispatched child and of a resume that returns `202`. |

What continues or retries an interrupted request is on [Pause, resume and replay](./durable-execution.md). What a closed client connection does is on [HTTP API](./http-api.md). `request.heartbeatIntervalMs: 0` and its effects are on [Runtime configuration](./runtime.md).

## Waits and wakes

A wake is a time the host has promised to run an internal entry in a session. Wakes and the sweeper that fires them are on [Pause, resume and replay](./durable-execution.md). The bounds on how long a wait may last are on [Runtime configuration](./runtime.md).

## When a dispatched task settles

A task board worker that dispatches settles its task once all its work is over, and the filing session hears each ending through its `onTaskSettled` entry. What the dispatch hands over, `keptOpenBy`, the entry's options and delivery, and `taskLedgers` are on [Task board](./task-board.md) and [Task collections](./task-collections.md).

## How does a page follow dispatched work?

| Question | Answer |
|---|---|
| Which runs did this conversation start? | `fsd.sessions.children(sessionId)`, or `useSession(...).childSessions`. |
| Which runs does this flow have? | `fsd.sessions.list({ flowKind, include: "dispatch-runs" })`. |
| Is a run finished? | `status === "active"` means not finished. It does not mean a worker is alive. With `live: true`, `useSession` re-reads as runs start and finish. Do not render `active` as "working" without `live`. |
| What did it do? | `fsd.sessions.requests(runId, { includeItems: true })`. The run's `id` is a session id, so every session read works. |
| Watch a request live | `GET /api/flows/:kind/requests/:requestId/stream`, or a request handle's `stream()`. Reconnect with `Last-Event-ID` or `starting_after` to resume from a sequence number instead of replaying from zero. |
| Did the work come out right? | For a dispatched run doing a task board's work, read the task. The run's status says only whether anything is running. |
| Where does a side chain's failure show? | In the DevTool trace for the request, never in the user's stream. |
| Who is the run? | `source` and `metadata.dispatch`, read only when `source` is `internal` or `task`. |

A run started by a dispatch has an id, a status and an item log, and the session reads above work on it. A queued run is read as the request it carries. A side chain is read through the request it runs in.

`useSession` returns the page of runs as `childSessions`. Its paging and refresh options are on [React API](./api/react.md).

```tsx title="src/app/audits.tsx"
"use client";
import { useSession } from "@flow-state-dev/react";

export function Audits({ sessionId }: { sessionId: string }) {
  const { childSessions } = useSession(sessionId, { flowKind: "support", live: true });
  return (
    <ul>
      {childSessions.map((run) => (
        <li key={run.id}>
          {run.topic ?? run.id}: {run.status ?? "not started"}
        </li>
      ))}
    </ul>
  );
}
```

## Who owns it, who sees it, where it is stored

| Part | Owner | Who sees it | Stored | How many |
|---|---|---|---|---|
| Side chain | The request that queued it. | The developer, in the DevTool trace. End hooks get `backgroundFailures`. Nothing in the user's stream. | Nothing of its own: a `block_trace` item on the request when trace observability is on, and a log line. | As many as the sequencer queues, on one pool per request. `forEachSideChain` runs 16 at a time by default. |
| Queued run | The request it carries: the same id, session and user. | The user, through the request's stream and status. The operator, through the queue (`adapter.queue`, Bull Board). | Redis holds the BullMQ queue (`fsd-flows`, prefix `fsd`), the pub/sub channels (`fsd:stream`) and concurrency places on the session's key. The request record and item log are in the shared stores. A finished job is removed after an hour or 1,000 jobs, a failed one after a day, unless `retry` says otherwise. | One job per action run. A retry is the same job and request id. With `deadLetter`, a failed one also gets a `dead-letter` job in `<queue>-dlq`. |
| Dispatch run | The user who ran the dispatching request, in the same organization and tenant, on the flow addressed. | The owner, through the listing, `children` and every session endpoint on its id. Another principal, organization or tenant does not. | The session store, as an ordinary session with `parentSessionId`, `topic`, `coordinate` and `flowId`. Its requests, state, resources and journal belong to it. Session-scoped resources do not belong to the starting conversation unless `sharedToLineage`. | One per key per conversation. The same key from the same conversation is the existing run. `{ id }` creates none. |

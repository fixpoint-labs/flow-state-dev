# Fact sheet: Background work (R-19, reference, `reference/background-work`)

Pass 1. Cites only what a fact sheet may cite: existing user docs, the exported surface and its doc
comments, tests, `goals/`, and the `@flow-state-dev/bullmq` README. No spec, no `docs/internal/`, no
PR or commit text was read. Where a fact comes from reading the implementation and not from an
exported doc comment or a test it is marked **[source]**: it constrains what the page may say and is
not quoted. Anything not marked is on an exported type, its doc comment, a test or a README.

Page shape from the sitemap: tables, no narrative. Tables: side chains, queued runs, dispatch
options, what each outlives, how each fails, how each is watched. Lookups: "What happens to a queued
run when the worker dies?" (section 3.6) and "How does a page follow dispatched work?" (section 8).
Sources named by the plan: `apps/docs/docs/server/background-work.md`. Also read, as existing
docs: `apps/docs/guides/background-work.md`, `apps/docs/docs/advanced/sequencer-side-chains.md`,
`apps/docs/guides/background-jobs-bullmq.md`, `apps/docs/guides/keeping-a-flow-running.md`.

## Abbreviations

All paths from the repo root.

- Docs: `SRV` = `apps/docs/docs/server/background-work.md`; `GUIDE` = `apps/docs/guides/background-work.md`;
  `SC` = `apps/docs/docs/advanced/sequencer-side-chains.md`; `BGQ` = `apps/docs/guides/background-jobs-bullmq.md`;
  `README` = `packages/bullmq/README.md`.
- core: `dsp` = `packages/core/src/blocks/dispatcher.ts`; `dsd` = `packages/core/src/types/dispatch.ts`;
  `sqm` = `packages/core/src/blocks/sequencer-methods.ts`; `sq` = `packages/core/src/blocks/sequencer.ts`;
  `rend` = `packages/core/src/types/request-end.ts`; `wg` = `packages/core/src/types/wait-gate.ts`;
  `flow` = `packages/core/src/types/flow.ts`.
- engine, `packages/engine/src/`: `cfs` = `flowstate/createFlowState.ts`; `fst` = `flowstate/types.ts`;
  `ra` = `execution/runAction.ts`; `cr` = `routes/child-session-routes.ts`; `ar` = `routes/abort-routes.ts`;
  `acr` = `routes/action-routes.ts`; `rc` = `runtime-config.ts`; `lb` = `transports/concurrency/lease-backend.ts`;
  `arb` = `transports/concurrency/arbiter.ts`; `ds` = `durability/durability-sweeper.ts`;
  `rw` = `durability/request-wakes.ts`; `wc` = `durability/wait-chain.ts`; `dop` = `context/dispatch-operation.ts`.
- bullmq, `packages/bullmq/src/`: `ad` = `flowstate-adapter.ts`; `rty` = `retry.ts`; `jp` = `job-processor.ts`;
  `run` = `runner.ts`; `rt` = `runtime.ts`; `blb` = `lease-backend.ts`; `con` = `connection.ts`; `typ` = `types.ts`.
- orchestration, `packages/orchestration/src/`: `tk` = `tasks/schema/task.ts`; `te` = `task-board/task-entry.ts`;
  `dt` = `task-board/blocks/dispatch-task.ts`; `tse` = `tasks/notice/task-settled-entry.ts`;
  `tn` = `tasks/notice/task-notice.ts`; `pass` = `tasks/notice/pass.ts`; `dl` = `tasks/notice/delivery.ts`.
- Tests, `packages/engine/test/` unless prefixed: `td` = `terminal-drain.test.ts`; `ab` = `abort.test.ts`;
  `reb` = `request-end-background-failures.test.ts`; `bwr` = `background-work-recovery.test.ts`;
  `scp` = `request-side-chain-pool.test.ts`; `jqa` = `flowstate/job-queue-adapter.test.ts`;
  `rdt` = `flowstate/runtime-dispatch.test.ts`; `cslr` = `child-session-listing-route.test.ts`;
  `sldr` = `session-listing-dispatch-runs.test.ts`; `bt` = `packages/bullmq/test/`.

## 0. Where the code disagrees with the existing pages or with a moved row

Code wins. Each is a row the page must get right.

| # | Finding | Source |
|---|---------|--------|
| 0.1 | **There is no `bullmqWorker`, no `worker` option, and no `dispatch-only` or `worker-only` mode.** The adapter is `bullmqJobQueue(options)`, handed to `createFlowState({ jobQueue })`. Modes are `"colocated"` (default), `"enqueue-only"`, `"process-only"`. Passing the retired `worker` option to `createFlowState` throws "the `worker` option is now `jobQueue`" (`cfs:371-376`); `bullmqJobQueue` has no such check and does not throw. An unknown mode throws, naming the three. `GUIDE`, `BGQ` and `README` still say `bullmqWorker`, `worker:`, `dispatch-only`, `worker-only`. Four moved rows (queued-run `mode` row; "What a dispatch outlives"; the two `bullmqWorker` rows from the BullMQ recipe) use the old names and are carried corrected. | `ad:76-125` (`bullmqJobQueue`, `mode`); `fst:67` (`JobQueueMode`); `cfs:101`, `:375`, `:378-384`; `jqa:221-246` |
| 0.2 | **`createWorkerRunner`, `createFlowWorker`, `registerStaticSchedules`, `createScheduleDispatchWorker`, `createBullmqScheduleIndex` and the `/worker` and `/schedules` subpaths are not in the source.** `package.json` exports `.` and `./job-processor` only. The lower-level exports are `createBullmqRuntime`, `createJobProcessor`, `createFlowJobProcessor`, `createJobQueueRunner`, `createRedisLeaseBackend`, `createRedisStreamBridge`, `resolveProducerConnection`, `resolveProcessorConnection`, `toJobOptions`, `resolveDlqName`. The page names only these. | `packages/bullmq/src/index.ts:9-37`; `packages/bullmq/package.json:30-39` |
| 0.3 | **The refusal for an `id` delivery on an unarbitrated queue is `external-flow-runner`, not `external-dispatcher`** (`SRV:127`). `DispatchRefusal` also has `no-sender` (a `{ from: true }` target on a request the runtime did not dispatch), which `SRV` omits. `dispatch-rejected` is also what a dispatch gets once shutdown has begun. | `dsd:484-517`; `rdt:809-836` |
| 0.4 | **`wait: true` that cannot be held does not throw `DispatchRefusedError`.** It throws a plain `Error` whose message contains `wait_unavailable`, after the block label (`[dispatcher] "<name>": wait_unavailable: ...`; the same shape for `wait_too_deep`). Only the `getTask` tool's message starts with `wait_unavailable:`. The message (no durable action on a host whose store keeps wakes, or a block with no identity) or `wait_too_deep` (more than five deep). Nothing is dispatched. | `dsp:470-510`; `core/test/dispatcher-wait.test.ts:124-145` |
| 0.5 | **There is no per-action "background" setting.** `ActionConfig` has `durable`, `concurrency`, `taskOf`, `tokenBudget`, `autoResume`. Queued runs are a host setting, `createFlowState({ jobQueue })`, and every action on that host goes through the queue. `durable: true` clears the action's suspension records and lease at completion; it does not move the run. | `flow:225-262`; `fst:400-416` |
| 0.6 | **The dispatched-children list is newest-created first**, not oldest first. | `cr:455-520` (`orderBy: "createdAt"`, descending per `packages/engine/src/stores/types.ts:506-520`); `cslr:1118-1126` |
| 0.7 | **`dispatchDrainTimeoutMs` bounds the wait for in-process dispatched runs, not for side chains.** A side chain is waited on by its own request (section 2). | `fst:262-280`; `cfs:607-676` |
| 0.8 | **A closed connection cancels nothing on the HTTP route, foreground or background.** The action route passes no request signal to the run. `SC` says a client disconnect aborts the foreground chain and leaves background work alone; that describes a caller that hands `runAction` a `signal` (the tests do). Over HTTP only the abort route stops a run. | `acr:155-172`; `packages/engine/test/stream-routes-disconnect.test.ts:33`; `td:172-217` |
| 0.9 | **`SRV:322-347` says a task-board `active` row "covers a job waiting in a queue, running, or paused".** The code also reads `active` for a run whose most recent request is `interrupted` and not superseded. See 4.12. | `cr:70-125` |
| 0.10 | **The moved row "Actor runs ... drained concurrently (`.forEach` with `maxConcurrency`)" names the wrong mechanism.** Actors are inline workers on a `taskBoard`; the option is the board's `concurrency` (default 4). Carried corrected in 9.4. | `packages/patterns/src/eventActors/index.ts:226-231`, `:443-452` |
| 0.11 | **A `bullmqJobQueue` `retry.backoff` or `removeOn*` value replaces the whole default object. Fields are not merged.** `{ type, delay }` with no `jitter` loses the default `jitter: 0.5`. | `rty:9-30` (`{ ...DEFAULTS, ...config }`) |

## 1. The three kinds, and what each outlives

| | Runs in | Outlives | Own session | Own request id |
|---|---|---|---|---|
| Side chain (`.sideChain()`, `.sideChainIf()`, `.forEachSideChain()`) | the request that queued it | the sequencer that queued it; not the request | no | no, it is the request's |
| Queued run (`jobQueue`) | a process consuming the job queue | the web process that accepted the POST | no, the same session | the same request id |
| Dispatch (`dispatcher()`, or a task board worker that dispatches) | a session of its own | the request that started it; the process only if a queue carries it | yes | its own |

- 1.1 A side chain outlives the sequencer, not the request: the request waits for it before it ends. `SC:13-16`, `SC:70-74`; `ra:2760-2790`; `td:325-362`.
- 1.2 A queued run is the same request: a POST returns `202` with the request id; a worker picks the job up and runs it against the same stores; the client attaches to the request's stream. `acr:350-360` [source]; `README` "Quick start"; `BGQ` "Live streaming"; `ad:3-15`.
- 1.3 A dispatch is a session of the flow that records the conversation it was started from, with its own state, resources and history. Its requests do not appear in the starting session's request list. `SRV:8-13`; `GUIDE:74`; `cr:1-25`.
- 1.4 What a dispatch outlives depends on the host. With no job queue the run lives in the process that started it and ends when that process does. With a job queue it goes through the queue like any other run. `cfs:1313-1340` (tracked only for an in-process runner); `rdt:440-500`; `GUIDE:193`.
- 1.5 Not background work: a task board worker that is a block, not a dispatcher, runs inline in the request that drains the board. The `eventActors` pattern is one: its actors are inline workers drained by a `taskBoard` inside the emit request. Neither the queue's nor a side chain's lifetime rules apply to them. See 9.4.

## 2. Side chains

### 2.1 Surface

| Call | Does |
|---|---|
| `.sideChain(block, { name? })`, `.sideChain(connector, block, { name? })` | queue `block` on the request's pool; the chain moves on at once; the step's value passes through unchanged |
| `.sideChainIf(condition, [connector,] block, { name? })` | same, only when `condition` is truthy; falsy is a complete no-op (no block, no items). `condition` is a boolean or `(value, ctx) => boolean \| Promise<boolean>` |
| `.forEachSideChain([connector,] block, { concurrency? })` | queue one task for the whole array (named `forEachSideChain[N]`); iterations run inside it `concurrency` at a time (default 16), each failure isolated; the task fails with the first failure only, so `backgroundFailures` has one entry for the batch; output is the original array (`sq:1721-1733`) |
| `.waitForSideChain({ failOnError?, timeoutMs? })` | barrier: wait for the calling sequencer's own side-chain tasks |

Sources: `sqm:244-262`, `:290-328`; `sq:1657-1671` (default 16); `sq:1943-2000` (barrier). The connector runs in the main chain; only the block is backgrounded (`SC:41-60`).

### 2.2 Lifetime

| # | Fact | Source |
|---|------|--------|
| 2.2.1 | All side-chain tasks of a request share one per-request pool. The request drains it before its final record and event. A task queued by a task is waited on too: the drain repeats until the pool is empty. | `SC:70-74`; `scp:190-226`; `ra:2760-2790` |
| 2.2.2 | The wait happens however the request ends: success, throw, explicit stop, or a dropped connection. The record stays `in_progress` until the pool settles, then is written `failed`, `interrupted` or `aborted`. | `td:125-170` (failed), `:172-217` (disconnect, ends `interrupted`), `:219-268` (stop, ends `aborted`) |
| 2.2.3 | A dropped connection does not cancel a side chain. An explicit abort does: the task sees the background signal, which fires only on an explicit cancel. A stopped task surfaces a failed `block_trace` carrying the cause. | `td:172-217`; `ab:2200-2290` (comment at `:2215`); `SC:343-366` |
| 2.2.4 | A cancel accepted while the pool drains ends the request `aborted`, even if the foreground finished. | `ra:2776-2796` [source] |
| 2.2.5 | Work queued from `onFinished` or `onErrored` is waited on, but those hooks run after the final event went out, so the client's stream may already be closed. Queue it from `onCompleted` if the client must see it. | `SC:82-84`; `ab:2643-2712` (a hook that fans out with `.sideChain()` is awaited) |
| 2.2.6 | A request that suspends at a gate does not wait for background work. `SC:415-417` says in-flight tasks are neither awaited nor aborted. **Only the existing page states this; no test pins it.** Flagged for pass 5. | `SC:86`, `:415-417` |
| 2.2.7 | Siblings run concurrently: two sequencers each queueing a task finish in about the slower one's time. An inner sequencer does not block its parent on its own side chains. | `SC:70-74`, `:308-315` |
| 2.2.8 | Side-chain work does not outlive a process that stops: if the process dies mid-request the work is gone. After a crash on a durable host, a continue replays side-chain work that had completed (output injected from the log) and re-runs work that was in flight. At-least-once, not exactly-once; wrap a non-idempotent effect in `ctx.runOnce(key, fn)`, keyed per item for `.forEachSideChain()`. | `bwr:85-168` (completed `.sideChain()` replays), `:170-270` (completed iterations replay), `:272-455` (in-flight re-runs); `SC:386-413` |
| 2.2.9 | Replay needs the block's `block_trace` retained. Trace observability is on in dev and test and off when `NODE_ENV=production`, unless `FSDEV_TRACE_OBSERVABILITY=true\|false\|1\|0`. A `transient: true` block records no trace. Without a trace, finished background work re-runs on a continue. | `packages/core/src/helpers/trace-observability.ts:11-18`; `SC:427-434` |
| 2.2.10 | `.waitForSideChain()` drains only the calling sequencer's tasks, not siblings'. `timeoutMs` bounds the wait, not the request: the request still ends only when its side-chain work has settled. | `scp:24-44`; `SC:97-106`, `:346-349` |
| 2.2.11 | Per-block timeout is the only way to bound a background task. There is no setting that kills one on disconnect. A task can listen on `ctx.signal`. | `SC:366-382` |

### 2.3 How a side chain fails

| # | Fact | Source |
|---|------|--------|
| 2.3.1 | A failure does not fail the request. It is logged, and a failed `block_trace` goes to the DevTool trace channel. Nothing reaches the user's stream. The request stays `completed`; the failed task is not retried. | `bwr:466-533` (one failed trace, `completed`, ran once); `SC:13-16`, `:282-288`, `:639-641` |
| 2.3.2 | Request-end hooks (`onFinished` and the like) receive every failed background step as `backgroundFailures: [{ step, message }]`, gathered across the action's, the end hooks' and a default `.waitForSideChain()`'s drains, in drain order. Absent when none failed. | `rend:57-72`; `reb:67-97`, `:98-118` |
| 2.3.3 | `backgroundFailures` is not handed on when the request's cancel fired, nor when the request ends `suspended`. A dropped connection is not a cancel, so failures after one are handed on. | `rend:62-69`; `reb:214-310`, `:311-374`, `:375-418` |
| 2.3.4 | `.waitForSideChain()` with default options does not throw on a failure, and the pipeline continues. A failure it drained is still handed to the end hooks. A failure that lands after a `timeoutMs` wait gave up is also handed on. | `reb:98-182`; `SC:108-127` |
| 2.3.5 | `.waitForSideChain({ failOnError: true })` drains first, then throws the first failure, so the request fails only after the scope settles. A request that failed this way is not continuable on the same id; the follow-up is a fresh retry. `failOnError` applies to every queued task in the scope. | `bwr:535-640`; `scp:58-65`; `SC:130-140`, `:425` |
| 2.3.6 | One exception: in a request working a dispatched task, a background step that throws fails the task's attempt, though the request reports `completed`. A cancel stops that rule; a dropped connection does not count as a cancel. A failure from before a suspension does not carry over: the resume reruns the step and that run is the one that counts. | `packages/orchestration/test/task-board/settles-when-its-work-is-over.test.ts:843-928`; `SC:68`, `:423` |
| 2.3.7 | The request's own status never depends on a background failure; the runtime only hands failures on. A hook that must act on them does so itself (the claim gate fails a task's attempt). | `rend:70-72` |

### 2.4 How a side chain is watched

- 2.4.1 It is not a request of its own. Watch the request it runs in: its stream, status and item log. A side chain's `block_trace` rows are in that request's trace (DevTool); with trace observability off they are not recorded. `GUIDE:215-220`; `bwr:466-533`.
- 2.4.2 The stream carries a `sideChainTasks` status when the drain waits on pending tasks. `ra:154-172` comment [source]; the exact item shape is not on an exported type, so **do not state it** unless pass 5 finds one.

## 3. Queued runs (`jobQueue`)

### 3.1 Setting

```ts
createFlowState({ flows, stores, jobQueue: bullmqJobQueue({ connection }) })
```

`jobQueue` and `runner` are mutually exclusive (throws). `bullmqJobQueue` is from `@flow-state-dev/bullmq`; its stores must be a backend every process reaches. Processing starts on first `ready()`, `getRouter()` or `getRuntime()`; call `ready()` in a process that must consume from boot. `dispose()` closes the processing handle before the stores. `fst:400-416`; `cfs:378-390`, `:1156-1170`; `jqa:147-182`; `ad:76-125`.

### 3.2 Options of `bullmqJobQueue`

| Option | Default | Does | Source |
|---|---|---|---|
| `connection` (required) | none | a Redis URL string, or an ioredis options object. `rediss://` turns TLS on; a `default` username is ignored | `con:12-62`; `bt/connection.test.ts:5-70` |
| `prefix` | `"fsd"` | namespaces every BullMQ key. Do not use ioredis `keyPrefix`, which BullMQ's scripts do not support | `con:12`, `:20-63`; `typ:11-15`; `README` "Connection" |
| `queueName` | `"fsd-flows"` | the queue | `rt:38`; `jp:88` |
| `mode` | `"colocated"` | which sides this process runs (3.3) | `ad:39-45`; `bt/flowstate-adapter.test.ts:79-84`, `:147-156` |
| `retry` | see 3.5 | retry, backoff, cleanup, dead-letter, applied to enqueued jobs and the processor | `ad:28-33`; `rty:9-43` |
| `concurrency` | `2` | jobs one processing process runs at once. Not an entry's `concurrency` policy | `jp:89`, `:514`; `README` "Quick start" |
| `lockDuration` | `300000` ms | BullMQ job lock; long because model calls are slow | `jp:91`, `:515` |
| `channelPrefix` | `"fsd:stream"` | Redis pub/sub prefix for the live-event bridge | `ad:37-38`; `README` "Stream bridge" |
| `leaseMs` | `10000` | how long a concurrency place lives past its last renewal (3.7) | `ad:46-52`; `blb:43` |

The returned adapter also exposes `mode`, `queue` (for Bull Board) and `runtime` (`enqueueAction`, `createJobProcessor`, `close`). `ad:60-74`.

### 3.3 Modes

| `mode` | This process | An action call over this process's HTTP routes | Use |
|---|---|---|---|
| `"colocated"` (default) | enqueues and consumes; starts consuming at runtime init (first `ready()`, `getRouter()` or `getRuntime()`) | becomes a job | one process; a job may run on any consumer of the queue, this process or another replica's |
| `"enqueue-only"` | enqueues only | becomes a job | the web tier of a split deployment |
| `"process-only"` | consumes only; starts consuming on `ready()` (runtime init) | runs inline | a dedicated processing container; its routes are typically never served |

Sources: `fst:53-67`; `cfs:1156-1175`; `jqa:100-146`; `README` "Deployment modes" (names corrected, 0.1).

- 3.3.1 In `process-only`, an action that reaches a router in that process runs inline instead of becoming a job (no runner). `README` "Deployment modes"; `fst:60-62`.
- 3.3.2 In `process-only`, a dispatch (a `dispatcher()` block, or a task-board dispatching worker) runs the work in the worker process and enqueues nothing. It is not durable: if the process stops, nothing re-runs it. Start durable work from `colocated` or `enqueue-only`. `README` "Limits"; `rdt:376-407`.
- 3.3.3 In `enqueue-only`, `dispose()` does not wait on a dispatched child: it may have no consumer. In-process children (no queue, `colocated` with an in-process start) are waited on. `rdt:471-499`; `cfs:1313-1340` [source].
- 3.3.4 On a serverless host `colocated` does not lift the function's time limit: the same invocation enqueues and consumes. A consumer with its own lifetime (a container in `process-only`, the web tier in `enqueue-only`) does. `GUIDE:193`.

### 3.4 Same stores

- 3.4.1 In one process the enqueue side and the processor get the same resolved `{ registry, stores, runtimeConfig }`, so they cannot disagree. `fst:75-84`; `ad:76-125`; `bt/flowstate-adapter.test.ts:100-120`.
- 3.4.2 Split processes are two `createFlowState` instances and nothing compares them. If they are pointed at different stores nothing fails loudly: jobs enqueue, the worker writes, and the web tier's stream and refresh routes read a store those writes never reached. The client sees a request in progress forever while the work has finished somewhere it cannot see. Use a backend both reach (Postgres in production). `README` "Point every process at the same stores"; `BGQ` "Separated workers".
- 3.4.3 A per-request `RuntimeConfig` does not cross the queue (it holds live resolvers). A queued job runs under the worker's own configuration. `fsdev run --model` applies in the command's process only; each dispatch that loses it logs a warning. `README` "Limits"; `packages/engine/src/transports/host/createInboundTransportHost.ts:757-777` [source].
- 3.4.4 A dynamic schedule's fire is made at dispatch time and cannot be carried by a job, so it runs in the process that ticked even when `jobQueue` is set, an exception to the host setting covering every action call (0.5). A static one goes to the queue. `createInboundTransportHost.ts:741-747` [source].
- 3.4.5 Abort across processes: the abort route answers `204` when the request is running in this process and `202` when it recorded the intent for the process running it. Delivery rides the run's heartbeat tick (`heartbeatIntervalMs`, default 10 s) and needs a request store shared across processes; with `heartbeatIntervalMs: 0` a running request never hears a cancel recorded elsewhere. On a queued run the runner's `abort` also publishes on the request's abort channel of the stream bridge. `ar:25-45`; `flow:422-432`; `ra:1430`; `run:104-110` [source]; `README` "Stream bridge".

### 3.5 Retry and dead letter

| Option (`retry`) | Default | Does | Source |
|---|---|---|---|
| `attempts` | `3` | max attempts including the first | `rty:9-17`; `bt/retry.test.ts:5-16` |
| `backoff.type` | `"exponential"` | `"exponential"` or `"fixed"` | `rty:9-17`; `typ:80-95` |
| `backoff.delay` | `1000` | base delay, ms | same |
| `backoff.jitter` | `0.5` | jitter factor | same |
| `removeOnComplete` | `{ age: 3600, count: 1000 }` | completed jobs are removed after an hour or past 1,000 jobs. A boolean, or an object with `age` and/or `count` | `rty:9-17`, `:25-43`; `bt/retry.test.ts:34-45` |
| `removeOnFail` | `{ age: 86400 }` | failed jobs are removed after a day | same |
| `deadLetter` | `false` | `true`: a job that exhausts its retries, or ends unrecoverably, is added to `<queue>-dlq` as a `dead-letter` job carrying its data plus `failedReason` and `originalJobId`. `{ queueName }` names the queue | `rty:44-80`; `rt:50-60`; `bt/retry.test.ts:46-62` |

- 3.5.1 What is retried: a run that returns a retryable error, and a throw. Not retried: validation errors, an unknown flow, an unknown action, a session or request another flow instance owns, a missing organization, and a run stopped because its concurrency place was lost. Those go straight to failed. `jp:6-9`, `:325-331`, `:425-440`, `:455-470`; `jp` tests `bt/job-processor.test.ts:121-200`, `:404`.
- 3.5.2 A retry keeps the request id. Its events continue the sequence numbering past the last persisted event, so a client resuming from a sequence number does not lose them. The terminal event is published only on the final attempt or an unrecoverable error, so the stream stays open across retries. `jp:341-359`, `:468-495`; `bt/job-processor.test.ts:121-135`, `:204-260`.
- 3.5.3 A retried job keeps its place on a concurrency key. `jp:11-17`, `:472-478`; `README` "Concurrency across workers".
- 3.5.4 The retry config applies to jobs the runner enqueues and to `runtime.enqueueAction`; `enqueueAction(data, opts?)` also takes `opts.retry`, `priority`, `delay` and `jobId`. (A direct job enqueue has a `delay`; a `dispatcher()` does not, see 4.8.) `rt:62-76`; `typ:69-78`.

### 3.6 What happens to a queued run when the worker dies (lookup)

| Situation | What happens | Source |
|---|---|---|
| The processor returns a retryable error or throws | The job retries on the backoff schedule, same request id, until `attempts` is spent. The final failure publishes the error terminal and, with `deadLetter`, writes the dead-letter job | 3.5 |
| The worker process dies mid-job | The job's lock lapses and the job is taken again from the queue; `lockDuration` is 300000 ms by default. **This is BullMQ's own stalled-job handling; no framework test covers it and its attempt accounting is not on a framework surface. State it as "the job is picked up again", and flag.** | `jp:91`, `:513-516`; none in tests |
| The web side while the worker is dead | The enqueue side watches the job's state in BullMQ every 10 s (`DEFAULT_LEASE_MS`). When the job has ended without a terminal message, the dispatch settles with the job's return value, or an error terminal carrying its `failedReason`; a job still waiting, delayed or running keeps it open | `run:13-27`, `:131-169`; `bt/runner.test.ts:83-125` |
| The run held a place on a session's concurrency key | A dead worker frees the key once its lease runs out, `leaseMs` (10 s default). A job whose place was dropped while its worker was gone lines up again at the back. A `defer` job that had claimed the free key waits for the key to be free again | `README` "Concurrency across workers"; `blb:3-30`; `bt/lease-backend.redis.test.ts:411-470` |
| The worker is alive but cannot reach Redis to renew | It aborts the run's signal at half the lease, and the request ends `interrupted`. The stop is cooperative: a run that honours `ctx.signal` has ended before another worker can take the key; one that ignores it can still be running when the next starts. The job is not retried | `lb:112-182`; `jp:422-430`; `bt/job-processor.test.ts:404` |
| Redis is unreachable when the request arrives | The dispatch is refused; nothing runs unarbitrated and the caller is told | `arb:30-40` |
| The request record | Persisted `in_progress` at enqueue, so a stream that attaches before any worker claims the job resolves a record and waits at sequence 0; an unknown id is still `404`. A queued entry has no heartbeat, so a stale sweep treats it as lost only after `queuedGraceMs` (10 minutes by default); a request that was running is marked `interrupted` once its heartbeat is quiet past `staleSweepThresholdMs` (60 s), checked every `staleSweepIntervalMs` (30 s) | `cr:70-125`; `rc:278-300`; `fst:299-312`; `BGQ` "Request discoverability" |

- 3.6.1 `interrupted` is the status a run can be continued from. Nothing continues or re-runs it for the caller (except the case in 7.4). A client continues or retries it. See 5.2.

### 3.7 Concurrency policy across processes (moved rows)

An entry's `concurrency` policy (`queue`, `reject`, `hold`, `defer`; default `allow`) holds across every enqueuing and processing process, because the adapter supplies a Redis-backed lease backend. Without one, each process arbitrates only its own runs, work handed to the queue is not arbitrated, and an `id` delivery is refused `external-flow-runner`. `fst:84-117`; `ad:13-17`; `arb:34-40`.

| # | Fact | Source |
|---|------|--------|
| 3.7.1 | The dispatching process takes the run's place on its key when it accepts the request, before enqueue. Runs start in the order accepted. A worker never blocks a slot waiting: a job whose turn has not come goes back to the queue as a delayed job, which BullMQ does not count as an attempt. When the run ahead finishes, the next job in line is started straight away. | `README` "Concurrency across workers"; `jp:11-20`, `:300-322` |
| 3.7.2 | A waiting job is rechecked at most 2 seconds apart (backoff from 50 ms, jittered). | `lb:188-196`, `:219-235` |
| 3.7.3 | A `queue` wait times out after 30 seconds, and the wait counts only time spent waiting on the key, from its first turn check, not time queued behind unrelated jobs. The request fails with a 503 `ConcurrencyQueueTimeoutError`. | `lb:186`, `:200-235`; `jp:296-312` |
| 3.7.4 | `hold` runs at once and marks the key busy from acceptance until the run ends. `defer` waits until nothing holds or waits on the key; for its first 30 seconds of waiting it holds no key, so `queue` runs do not wait behind it and `reject` is not refused because of it; after 30 seconds it lines up behind the runs already there and waits with no time limit. Deferred requests on one key run one at a time. | `README` "Concurrency across workers"; `lb:237-290`; `bt/job-processor.test.ts` hold/defer cases; `bt/queue-arbitration.redis.test.ts` |
| 3.7.5 | The cap of 32 `defer` requests per key is counted in the process that accepted them. On a queue a request counts from acceptance until its job ends, including while it runs. The next is refused (409 over HTTP) and nothing is enqueued. | `arb:373-381`; `README` "Concurrency across workers" |
| 3.7.6 | A delivery into an existing session by `id` runs in whichever worker picks it up and waits for the recipient's policy like any other run into that session. If the session is deleted and created again while the delivery waits, the worker drops it rather than run it in the new session. | `SRV:129-133`; `bt/queue-arbitration.redis.test.ts` [name check by pass 5] |
| 3.7.7 | A session's line is meant to be short. Each turn check reads every expired place on the key, so hundreds of waiters on one key cost Redis work per check. Use `reject`, or spread over more keys. | `README` "Concurrency across workers" |
| 3.7.8 | Roll out workers before the processes that enqueue: a job from the new release picked up by an older worker runs once without the policy, and an older worker treats `hold` as `queue`. | `README` "Concurrency across workers" ("Upgrading") |

## 4. Dispatch

### 4.1 `dispatcher()` config (internal dispatcher)

| Field | Required | Does | Source |
|---|---|---|---|
| `name` | yes | block name | `dsp:182-186` |
| `action` | yes | the entry, `flow.internal.actions[action]`; checked at `defineFlow` for a same-flow address, at the seam for a cross-flow one | `dsp:188-195` |
| `flowKind` | no | send to another flow instance, by its id: a kind, or a collection copy's own id. A collection's bare kind names no instance | `dsp:196-215` |
| `inputSchema` | no | what the block accepts; default `z.unknown()` | `dsp:217` |
| `session` | yes | `{ key }`, `{ key, state }`, `{ id }`, `{ from: true }` (4.3) | `dsp:155-180` |
| `payload` | no | the entry's input, computed from the block's input; default the input as is; validated by the entry's own schema | `dsp:220-224` |
| `wait` | no | `true`: wait for the dispatched request and output how it ended (4.7). Default `false` | `dsp:138-148`, `:227-233` |
| `transient` | no | hide the block's trace from clients | `dsp:225-226` |
| `description`, `type` | no | `type` defaults to `internal`; a task board's dispatcher leaves `type` unset, its `session` (a task policy) makes it a task dispatcher (`packages/core/src/blocks/dispatcher.ts:184-189`, `:244-249`) | `dsp:182-195` |

- 4.1.1 A dispatcher is a handler: use it in a sequencer step, as a generator's tool, or as an action's root block. `SRV:81-83`.
- 4.1.2 There is no endpoint that starts a dispatch. It begins inside a running request. `SRV:19-23`.
- 4.1.3 A flow declares the work under `internal.actions`, beside `actions`; an internal entry has an action's shape, and no client can call it. `defineFlow` throws at definition time when `action` names an entry the flow does not declare; an action of the same name under `actions` does not stand in. `SRV:25-29`, `:109-112`; `dsp:188-195`.
- 4.1.4 **No delay or run-at option.** Timed work is a schedule: a stored schedule from `schedules.resolve` (or a static one), whose block does the work. (A direct `runtime.enqueueAction` job has `delay`; that is not a dispatcher option.) `dsp:182-234` (the whole config); `packages/core/src/types/schedules.ts:217-240`; `SRV` (none); `GUIDE:99`.
- 4.1.5 To run a dispatcher inside a task board see 4.10.

### 4.2 What a dispatch returns

`{ sessionId, requestId, adopted }`, as soon as the runtime has accepted the request, without waiting for the work. `adopted` is `true` when the session already existed. The entry validates the payload on arrival. A refusal throws instead (4.5). `dsp:125-136`; `core/test/dispatcher.test.ts:178-200`; `dop:32-50` [source].

### 4.3 `session`

| `session` | Runs in | If it does not exist | Source |
|---|---|---|---|
| `{ key: (input, ctx) => string }` | a child session derived from the key, recorded against the running session | created; the next call with the same key from the same conversation returns `adopted: true` | `dsp:155-170`; `core/test/dispatcher.test.ts:178-200` |
| `{ key, state }` (`state`: object, or `(input, ctx) => object`) | the same, created with that initial state | created with that state if the target flow's `stateSchema` parses it and its `createCheck` accepts it. An existing run keeps its own state | `dsp:155-170` |
| `{ id: (input, ctx) => string }` | an existing session of this flow kind that belongs to this user | refused `session-not-found`; nothing is created | `dsp:155-170`; `dsd:484-499` |
| `{ from: true }` | the session that dispatched this run (a reply), supplied by the runtime from the dispatch it stamped | refused `no-sender` when the request was not dispatched by the runtime | `dsp:155-170`; `dsd:512-517` |

- 4.3.1 The key is scoped to the conversation: the same key from another conversation is a different run. `SRV:103-107`.
- 4.3.2 A `key` or `id` function that returns an empty string throws a plain `Error` naming the block. `core/test/dispatcher.test.ts:388-396`.
- 4.3.3 A reply to another flow: the other flow dispatches `{ from: true }` with `flowKind` pointing at the sender's flow. If the sender's session is not owned by the instance named, the reply is refused `session-not-addressable`. Ownership is by instance, not kind. `SRV:183-201`; `dsp:45-52`.
- 4.3.4 `flowKind` in cross-flow: the job's session records the conversation that started it but belongs to the instance it was sent to; its `flowId` in listings is that instance's. Two copies of one definition are two instances: the same conversation dispatching to `review-east` and `review-west` gets two runs. Both flows must be registered on the same server; it is another flow, not another service. Whatever the job needs travels in the payload. `SRV:145-181`.

### 4.4 What the run is

A run a dispatcher starts runs the same flow as the same user, in the same organization and tenant. It has `source: "internal"` (or `"task"` when a board worker dispatched it) and a `metadata.dispatch` bag: `type`, `action`, `from: { block, sessionId }`, `key` (absent when delivered by `id`), `taskId` (only a task dispatch). The runtime builds the bag; a request body cannot write it. Read it only when `source` is `"internal"` or `"task"`. `retry`, `continue` and `resume` on its request id answer `404`. `SRV:441-481`; `dop:20-45`.

### 4.5 Refusals

A refusal throws `DispatchRefusedError` (`code: "dispatch-refused"`, with `blockName`, `address`, `refused`, `detail`). Every refusal is decided before anything starts, so a `.rescue()` can branch on `refused`. `detail` is operator-facing and not a stable contract. `dsd:480-535`, `:565-585`.

| `refused` | Meaning | Source |
|---|---|---|
| `no-entry` | the addressed flow declares no entry at that address; resolution never falls through to another map or to the sender's own entry of that name | `dsd:484-487` |
| `flow-not-found` | `flowKind` names a flow this server has not registered (including a collection's bare kind) | `dsd:488-493` |
| `session-not-found` | an `id` names a session that does not exist | `dsd:494-495` |
| `session-not-addressable` | an `id` names a session that is another user's, or on another flow | `dsd:496-497` |
| `key-occupied` | a `key` derived a session id already held by a record that is not this conversation's run | `dsd:498-499` |
| `create-refused` | the target flow's `stateSchema` or `session.createCheck` refused the session: the `state` named, or the lack of one | `dsd:500-501` |
| `no-dispatch-operation` | this process runs requests but has no way to start one; `createFlowState` hosts have one (also `process-only`, which runs the dispatch in process), so it means a hand-assembled request host with no dispatch operation | `dsd:502-503`; `packages/engine/src/context/types.ts:210-216` [source]; `rdt:376-407` |
| `dispatch-rejected` | the entry's `concurrency` is `reject` and its key is held; also, shutdown has begun | `dsd:504-505`; `rdt:809-836` |
| `external-flow-runner` | an `id` dispatch on a host whose `jobQueue` adapter cannot hold concurrency places across processes (no shared lease backend). `bullmqJobQueue` can, so it never refuses. A `key` dispatch, and a reply sent from a `process-only` process (runs in process), are never refused this way | `dsd:506-511`; `ad:13-17`; `README` "Limits" |
| `no-sender` | `{ from: true }` on a request the runtime did not dispatch | `dsd:512-517` |

A thrown `NoDispatchSeamError` (`code: "no-dispatch-seam"`) means a dispatcher ran in a context no runtime built, such as a hand-made test context; run it through a real runtime from `createFlowState`. The testing package has no dispatcher harness (grep of `packages/testing/src`), so the page names none. `dsd:553-565`; `core/test/dispatcher.test.ts:260-270`.

### 4.6 What a dispatch outlives, by host

| Host | The run outlives | Does not outlive | Source |
|---|---|---|---|
| No `jobQueue` | the request that started it | the process. On stop, `dispose()` waits up to `dispatchDrainTimeoutMs` for it, then cancels it (5.1). For a run not finished, the sweep marks the request `interrupted`; the row goes on reading `active` (an `interrupted` most-recent request counts as live) until a retry or continue supersedes it; nothing restarts it (`packages/engine/src/routes/child-session-routes.ts:76-94`, `:293`) | `cfs:607-676`, `:1293-1340`; `SRV:377-402` |
| `colocated` or `enqueue-only` | the request, and the web process: a delivery is enqueued and runs in whichever process picks it up, with retries | an `id` delivery whose recipient session was deleted and recreated meanwhile (dropped) | `rdt:471-499`; `SRV:129-133`; `GUIDE:193` |
| `process-only` | the request | the process (3.3.2) | `README` "Limits"; `rdt:376-407` |
| Serverless, `colocated` | the request | the function's maximum duration (3.3.4) | `GUIDE:193` |

### 4.7 `wait: true`

The block's output is how the dispatched request ended: `{ status: "completed", output, requestId }`, `{ status: "failed", error, requestId }` (also when stopped), or `{ status: "running", requestId }` at the deadline. At the deadline nothing is stopped; the work runs on. The request parks on one wait gate bound to the request it started and survives a server restart. The dispatch is sent once: a replay or a retry of the block sends nothing again. `dsp:90-99`, `:226-233`, `:470-515`; `core/test/dispatcher-wait.test.ts:70-124`; `SRV:203-229`.

| Rule | Value | Source |
|---|---|---|
| Needs | a durable action on a host with a store that keeps wakes, and the durability sweeper. Otherwise `wait_unavailable`, nothing dispatched | `dsp:481-490`; `core/test/dispatcher-wait.test.ts:130-145` |
| Default deadline | 5 minutes | `wc:66-67` |
| Allowed deadline range | 1 second to 24 hours, host-configurable (6.2) | `wc:69-77` |
| Nesting | at most 5 deep, counting task waits too; deeper is `wait_too_deep`, nothing dispatched | `wg:53-60`; `dsp:495-505` |
| Deadline cancels | nothing | `dsp:138-148`, `:227-233` |
| `task` dispatcher `wait` | the board's to read: its drain waits on the row it handed over. A plan board waits on every row, a delegation board on none; a board refuses a dispatcher that contradicts its mode | `dsp:283-289` |

A worker waits on a task with `getTask({ id, wait: true, deadline? })`: same gate, same default and bounds, same depth of five. Out-of-range deadlines are refused, not clamped. `onIdle: "wait"` on a task board is a different setting (the drain never exits on drained-ness). `packages/orchestration/src/skills/task-tools-capability.ts:42-50`; `packages/orchestration/src/tasks/helpers/wait-on-task.ts:1-45`; `packages/orchestration/src/task-board/index.ts:47-65`.

### 4.8 Task-board dispatch

A board worker `dispatcher({ action, session, state?, flowKind?, wait? })` sends each claimed row to `flow.task.actions[action]`. `session` is `"per-task"`, `"per-worker"`, `{ key }` or `{ by }`. Do not set `type`. Needs an explicit `boardId` and a durable `defineTaskCollection()`; `mode` is optional (default `"plan"` accepts dispatcher assignees and waits on each row), and a board is refused only when its dispatchers contradict its mode (`wait: false` on a plan board; `wait: true`, an inline assignee or no dispatcher on a delegation board) (`packages/orchestration/src/task-board/dispatch-assignee.ts:261-307`, `board-mode.ts:44-95`). The option tables live on `reference/task-board`; this page carries only the lifetime rules in section 7. `dsp:241-289`; `GUIDE:134-203`.

### 4.9 Where the result goes

The dispatch does not return a result. To get one without `wait`, the dispatched work writes it somewhere both sides read (a user- or org-scoped resource, a task board), or reports back with a `{ from: true }` dispatcher. A session-scoped resource marked `sharedToLineage` resolves one copy for the conversation and every session under it; session state has no such route. `GUIDE:95-97`; `apps/docs/guides/keeping-a-flow-running.md:228-234`.

### 4.10 Listing and reading a dispatch run

| Read | Returns | Source |
|---|---|---|
| `GET /api/flows/sessions?flowKind=…&include=dispatch-runs` · `fsd.sessions.list({ flowKind, include: "dispatch-runs" })` | the caller's sessions plus the sessions dispatchers ran work in. Whole session records; a dispatched one carries `parentSessionId`, `topic`, `coordinate` | `packages/engine/src/routes/session-routes.ts:97-141`; `sldr:97-124`; `client.ts:82-108` (`packages/client/src/client.ts`) |
| `GET /api/flows/sessions/:sessionId/children` · `fsd.sessions.children(sessionId)` | one summary row per run started from that conversation | `cr:1-25`, `:535-600` |
| `GET /api/flows/sessions/:runId/requests` · `fsd.sessions.requests(runId)` | the run's own requests; `?include_items=true` adds the item log, `?include_result_output=true` adds the action's return value | `packages/engine/src/routes/session-routes.ts:633-675`; `client.ts:123-126` |

- 4.10.1 `include` accepts `dispatch-runs` and `status`; anything else is a `400` naming what it accepts. Leave it off and the listing holds sessions a person started. `session-routes.ts:97-141`; `sldr:143-153`.
- 4.10.2 Scope: the listing is scoped to the caller before `include` is read. A run of another principal, organization or tenant is absent at every setting. `userId` narrows and never widens; there is no `orgId` query parameter. With no `resolvePrincipal` configured there is no principal to scope to, and the query filters are all there are. `sldr:155-177`; `SRV:252-266`.
- 4.10.3 `/children` applies the access rule of the parent session named in the path, as every session-addressed route does: a conversation in another tenant answers `404`; one with no runs answers `200` with an empty list. It lists every session recorded against the parent, not only dispatched ones. `cr:1-25`, `:535-550`; `SRV:495-515`.
- 4.10.4 `/children` row (`ChildSessionSummary`), eight fields and no more (no `flowKind`, `userId`, `title`, `metadata`, state or journal):

| Field | Type | Meaning | Source |
|---|---|---|---|
| `id` | string | bare child session id; read it with every session endpoint | `cr:169-190` |
| `parentSessionId` | string | bare id of the conversation it hangs off | `cr:169-190` |
| `createdAt`, `updatedAt` | number | epoch ms | `cr:169-190` |
| `flowId` | string, optional | the flow instance that owns the child; can be absent (guard with `== null`) | `cr:169-190` |
| `topic` | string, optional | display label: the key the session was derived from | `cr:169-190` |
| `coordinate` | string, optional | display label: the entry dispatched to, `<type>:<target>` (`internal:summarize`, `task:implement`) | `cr:169-190` |
| `status` | optional | see 4.12 | `cr:169-190` |

`topic` and `coordinate` are display labels: do not route or authorize on them. The four optional fields can be absent (guard with `== null`). `cr:400-428`; `SRV:306-320`.

- 4.10.5 Paging: `limit` 1 to 100, default 25; `offset` 0 to 10,000, default 0. A value outside the range is a `400` naming the range, not clamped. `maxChildSessionListLimit` on the host lowers or raises the ceiling (positive integer; the default `limit` is the lesser of 25 and the ceiling). Rows are newest-created first on `(createdAt, id)`, so a run starting a request does not shuffle pages; a run created while paging can be missed or shift a later page by one. `cr:30-60`, `:432-540`; `rc:245-275`; `cslr:1118-1160`; `SRV:483-493`.
- 4.10.6 The React hook `useSession` returns `childSessions` (the page, newest first, sized by the server unless `childSessions: { limit }` is passed) and `childSessionsStale` (the last re-read failed, rows kept). With `live: true` it re-reads as runs start and finish and keeps an unfinished run the page lacks. Without `live` it is current as of mount, each action's start and `refresh()`. `packages/react/src/hooks/useSession.ts:222-300`, `:396-435`.

### 4.11 Listing, by dispatch kind

| Source of the row | `source` | `metadata.dispatch.type` | `coordinate` |
|---|---|---|---|
| `dispatcher()` in a flow | `internal` | `internal` | `internal:<action>` |
| task board dispatching worker | `task` | `task` | `task:<action>` |

`SRV:312-316`, `:441-465`.

### 4.12 `status` on a run

`active` is "not finished": queued, running, paused for approval, or interrupted and not superseded. The route does not tell them apart. Every other value is how the run's last request ended. `cr:70-150` (rules), `:182-210`.

| Value | Meaning | Source |
|---|---|---|
| (absent) | the run has no request yet. Absence is not a status | `cr:169-190` |
| `active` | the session has a request `in_progress` or `suspended`, or its most recent request is `interrupted` (it is still continuable) | `cr:70-125`, `:268-285` |
| `completed` | the most recent request finished. Not the same as the work succeeding | `cr:127-160` |
| `failed` | the run itself ended with an error | same |
| `aborted` | cancelled | same |
| `incomplete` | stopped short, usually on a token budget | same |

- 4.12.1 With every request terminal and disagreeing, the row reports the most recent outcome: a run that failed and was retried successfully reads `completed`. The failed attempt is in the run's own history. `cr:250-286`; `cslr:771`, `:903`.
- 4.12.2 `active` describes what the system recorded, not what a worker is doing. A worker's process that dies leaves the row `active`. A run whose approval expired without an answer is carried on by the durability sweeper on a durable host as if rejected; the gated tool does not run, and the run then settles however it ends. `SRV:367-375`; `ds:17-42`.
- 4.12.3 A job doing a task board's work: a worker that throws records the failure on its own task. On the default `onError: "skip"` the run finishes and the job reads `completed`; on `"fail"` it reads `failed`. So the job's status says whether anything is still running, and the task says whether the work came out right: a failed task reads `errored` with the message in its `error`. `SRV:339-358`; `packages/orchestration/src/task-board/index.ts` `onError` option [source].
- 4.12.4 Recording the failure goes through the worker's claim on the task, so it lands only while the task is still the worker's: a task cancelled meanwhile, completed by the worker earlier in the run, or handed to another worker after the claim lapsed keeps its status and records nothing. `SRV:353-358`; `te:122-135`.

## 5. When a process stops

### 5.1 `dispose()` and `dispatchDrainTimeoutMs`

| # | Fact | Source |
|---|------|--------|
| 5.1.1 | `dispose()` waits for dispatched requests running **in this process**, then closes the job processing and the stores. | `cfs:526-540`; `rdt:440-470` |
| 5.1.2 | The wait is bounded by `dispatchDrainTimeoutMs`, a `createFlowState` option. Default 30000 ms. A ceiling, not a target: work that ends sooner is not delayed. `0` waits for nothing and still cancels and reports. A negative or non-finite value is read as the default or `0`. | `fst:262-280`; `cfs:151`, `:172-179` |
| 5.1.3 | Work that dispatched more work is waited on too, in rounds (at most 32), all inside the one deadline. | `cfs:98`, `:636-668` |
| 5.1.4 | While waiting it logs "waiting for N dispatched request(s) to finish before shutdown" through the configured logger (silenced by `--quiet`). | `cfs:640-662`; `rdt:634-667` |
| 5.1.5 | On timeout it cancels what is left (the same cancel as the abort route), gives the cancelled runs a short unwind inside the same budget (a quarter of the budget, at most 2 s), then prints once to stderr, **not through the logger**, so `--quiet` does not hide it: "shutdown cancelled N dispatched request(s) after Xms (budget Yms); they may not have completed", naming up to five request and session ids, then "and N more". | `cfs:703-800` |
| 5.1.6 | It does not write a terminal status for a cancelled run. The task recovers by lease; the request record is marked `interrupted` at the next start. | `cfs:722-766` [source comment]; `rdt:500-560` |
| 5.1.7 | A run that was queued behind a concurrency key when shutdown began never starts, even at `0`. A dispatch arriving after `dispose()` began is refused `dispatch-rejected`. | `rdt:668-738`, `:809-836` |
| 5.1.8 | Not waited on: dispatched work that went to a job queue (`colocated` hands it to the queue; `enqueue-only` has no consumer here). Closing the queue worker drains the jobs **this process** is running, not jobs waiting in the queue or running in another container, and that close is not bounded by `dispatchDrainTimeoutMs`: it takes as long as the claimed job does. | `rdt:471-499`; `cfs:1313-1340` [source]; `README` "Limits" |
| 5.1.9 | `fsdev run` with a config stays up after `flow_complete` while in-process dispatched runs finish, bounded by the same setting. With no config, a dispatch fails: `NoRequestHostError`, `code: "no-request-host"`. A config's job queue (`colocated` default, or `enqueue-only`) means the dispatched work is queued, and this drain does not wait for it. The CLI page keeps one line. | `cfs:607-676`; `packages/core/src/types/request-host.ts:688-700`; `rdt:471-499`, `:248-290` |

- 5.1.10 Tell the page which cases apply: side chains of an in-flight request are not part of this drain; a request is waited on by its own `runAction` while it runs, and if the process is stopped first the work is cancelled and not settled. `cfs:526-540`, `:700-720` [source]; `SRV:411-418`.

### 5.2 What a stopped process leaves behind

| Left behind | Becomes | Source |
|---|---|---|
| A run row | reads `active` with nothing running it, until a retry or continue supersedes the request | `SRV:377-382`; `packages/engine/src/routes/child-session-routes.ts:76-94`, `:293` |
| The request record | `in_progress`, then marked `interrupted` (resumable) by the stale sweep | `cfs:904-945`; `rc:278-300` |
| A dispatched task | taken back once its lease lapses and some worker claims it again; after `maxAbandonments` it settles `errored` | `cfs:722-766` [source comment]; `SRV:384-386` |

- 5.2.1 The sweep runs at runtime start (`detectInterruptedOnStartup`, default on; turn it off on serverless), on a timer while a server is up (`staleSweepIntervalMs`, default 30000, `0` disables), and on demand. A record is stale when its heartbeat has been quiet past `staleSweepThresholdMs` (default 60000). A queued entry has no heartbeat; it is bounded by `queuedGraceMs` (default 600000). `dispose()` waits up to 5 s (`RECOVERY_SWEEP_DRAIN_MS`, `cfs:163`) for the startup sweep before it closes the stores. `fst:299-312`, `:282-286`; `rc:278-300`; `cfs:163`, `:904-945`; `rdt:1017-1130`.
- 5.2.2 Marking is where the framework stops. A client continues or retries the run, or a later run supersedes it; nothing re-runs it for the caller. An `interrupted` request stays continuable. If nothing ever runs against that store again, nothing sweeps it. `SRV:390-418`.
- 5.2.3 The heartbeat: `request.heartbeatIntervalMs`, default 10000, `0` disables. With `0` nothing refreshes the run's active-request entry, so a run lasting longer than the stale threshold is marked `interrupted` while still going, which also offers it for resume, so the same work can start twice. It also stops cross-process cancel delivery (3.4.5). `flow:422-432`; `ra:1430-1505`; `SRV:404-409`.
- 5.2.4 `onBackgroundWork: (promise) => void` on `createFlowState`: on a platform that freezes the function after the response (Vercel), pass its post-response primitive (for Next, `(p) => after(() => p)`) so post-response work is not killed. It receives the `finished` promise of a dispatched child and of a resume that returns `202`. `fst:241-250`; `createInboundTransportHost.ts:1424-1428`, `:1546-1560` [source]; `rdt:1206-1266`.

## 6. Waits and wakes

### 6.1 Wakes

A wake is a debt's due time the host keeps: a session, an internal entry, a due time and the owner it fires as. One wake per `(tenant, session, entry)`; owing again keeps the earlier due time. `rw:1-20`; `packages/engine/src/stores/types.ts:1880-1905`.

| # | Fact | Source |
|---|------|--------|
| 6.1.1 | A due wake: the durability sweeper runs the internal entry the wake names, in that session, as the session's owner (user, org, tenant). | `rw:48-70`; `ds:31-42` |
| 6.1.2 | A wake that fell due while the server was down fires once the sweeper runs again (it lists every wake due at or before now). | `ds:600-640` |
| 6.1.3 | The wake is moved 30 seconds out first, then fired. A fire that dies, or a run that dies, leaves it to fire again 30 seconds later, until a run clears it. | `ds:362-369` (`WAKE_RETRY_MS`), `:612-640` |
| 6.1.4 | A host without wakes (no durable execution, or a store registry with no `wakes` store) logs once at start, at `info` (also stated on `apps/docs/docs/advanced/durable-execution.md:367`): `this host keeps no wakes: debts are paid on their fast paths only`. If the wake store exists and cannot be read (a missing migration) the host logs once at `warn` and keeps none. Nothing can wait there. | `rw:84-143` |
| 6.1.5 | A wait parked on a host with no wakes logs a warning that nothing resumes it at its deadline. | `ra:2524` [source] |
| 6.1.6 | On a host with no wakes a task split into pieces stays `in_progress` when a piece ends as the server stops, because nothing wakes it. | `apps/docs/docs/workforce/delegating-work.md:234`; `apps/docs/docs/advanced/durable-execution.md:367` |
| 6.1.7 | Work owed past `maxDebtAgeMs` (default 24 hours, counted from when it fell due) is given up: a notice is settled undeliverable on its task, a marker cleared, a lapsed wait slot no longer looked at, and it is logged. Needs durable execution and a store that keeps wakes. | `fst:365-370`; `rw:79`; `pass:28-36`, `:96-110` |

### 6.2 Wait deadlines

`createFlowState({ waitDeadlines: { defaultMs, minMs, maxMs } })`. Only where the host keeps wakes.

| Setting | Default | Source |
|---|---|---|
| `defaultMs` | 300000 (5 minutes) | `wc:66-67` |
| `minMs` | 1000 (1 second) | `wc:69-74` |
| `maxMs` | 86400000 (24 hours) | `wc:76-77` |

- 6.2.1 The host refuses to build unless all three are finite and `0 < min <= default <= max`, with the error "wait deadlines must be finite and satisfy 0 < min <= default <= max". `wc:87-100`.
- 6.2.2 A wait that names a deadline outside `[minMs, maxMs]` is refused, not clamped. **The refusal code for a `getTask` deadline is on `reference/task-board`; for a dispatcher the deadline is not a field, the host's default applies.** `dsp:138-148`, `:227-233`; `fst:372-379`; `packages/orchestration/src/skills/task-tools-capability.ts:42-50`.
- 6.2.3 `userDeadlineMs` (a stop that waits for a user) is separate; unset by default. `fst:381-388`.

## 7. A dispatched task settles

(Rows moved from the task-board page. Option tables stay on `reference/task-board`.)

### 7.1 What the dispatch hands over

- 7.1.1 The row's worker input crosses the dispatch as a JSON round trip. A value that cannot survive one (a `Date`, `Map`, class instance, `undefined` in object position) fails the task naming the path, after the claim is taken. The payload is snapshotted so both deployment modes send the same value. `dt:160-215` [source]; `packages/orchestration/test/task-board/dispatch-assignee.test.ts:24-30`, `dispatch-seam.test.ts:262-295`.
- 7.1.2 The dispatch block returns `{ dispatched: true, taskId, sessionId, requestId, adopted }`. `requestId` is one per dispatch; under `per-task` a retry re-enters the same session. `dt:270-292` [source].
- 7.1.3 On arrival the run re-reads the row and runs the worker only if the claim is current: same attempt, same row, still `in_progress`, still this assignee. Otherwise it throws `StaleTaskClaimError` (`code: "stale-task-claim"`) and writes nothing. A claim whose lease lapsed in a host queue is renewed on the same attempt, and refused only if a drain already reclaimed it. `te:122-135`, `:300-330`, `:610-640`.

### 7.2 When the task is done

The run settles its task once, when all its work is over: its request ended, with any `.sideChain()` work it started and any its `onFinished` started; every task it filed has ended and its session has heard each ending. Until then the task stays `in_progress` with `keptOpenBy`:

| `keptOpenBy` | Meaning | Source |
|---|---|---|
| `"filed"` | tasks it filed have not ended, or have not been heard | `tk:509-525` |
| `"suspended"` | its own request is suspended (`ctx.suspendForUser()`, `ctx.suspend()` or an external event); a user stop is also listed in `holds` | `tk:509-525` |
| `"steer"` | a steer (message) no request has taken; its turn is on the way | `tk:509-525` |

A kept-open row has no lease, is not handed out again by a lapse, however long the wait and across a restart. Every ending and every claim clears it. `null` or absent reads as kept open by nothing. `tk:509-525`; `packages/orchestration/test/task-board/settles-when-its-work-is-over.test.ts:354-424`.

- 7.2.1 If the board cannot record the result, the run's request reports `failed`. `onError: "fail"` fails the run; `"skip"` leaves it `completed` with the error on the task. `SRV:339-347`.
- 7.2.2 A background step that throws in any request working the task fails the attempt (2.3.6).

### 7.3 `onTaskSettled`: how the filing session hears an ending

`internal: { actions: { onTaskSettled: taskSettledEntry({ block, concurrency?, defer? }) } }`; `block` takes `taskSettledInputSchema`. One request per ending, in the session that filed the task. `defineFlow` requires it of a flow holding a board that hands rows out. `tse:1-100`.

| Field | Meaning | Source |
|---|---|---|
| `boardId`, `taskId`, `attempt` | which task and attempt | `tse:52-66` |
| `ending` | `completed`, `errored`, `cancelled` (the schema also accepts `retried`; only an older marker produces it, do not list it) | `tse:52-66`; `tn:78-82` |
| `output` | on `completed` | same |
| `error` | on `errored` | same |
| `cancelled` | ids of dependents the ending cancelled that the same session filed; they send no notice of their own | same |
| `question`, `waitedOn` | the question a held task asked; `true` when the filer was waiting on it | same |

| # | Fact | Source |
|---|------|--------|
| 7.3.1 | Default `concurrency` for the entry is `queue` on the session. | `tse:80-93` |
| 7.3.2 | No notice when: the task failed and will retry (nothing until its last attempt ends); the filer waited on it with `getTask({ id, wait: true })` and read the ending; the filer's own model cancelled it with `updateTask` in its own turn. A cancel from a person, an app's action, or a cascade from another session's task does send one. | `packages/orchestration/src/tasks/notice/` [source]; the existing page `apps/docs/docs/orchestration/task-board.md` "Hearing how a task ended" |
| 7.3.3 | Delivery: held while the filing request runs, sent when it ends. At a park (approval, input, a wait) an ending sends right away; one held goes out about 2 seconds after. A notice falls due 2 seconds after its ending's write; a resend backs off exponentially from 2 s, capped at 5 minutes. A `defer` that turns a notice away is not a failed delivery; its age counts from the last turn-away. | `tn:108`, `:149`, `:455-485`; `tse:80-93` |
| 7.3.4 | A notice a crash lost is sent again by the sweeper: it runs `onTaskSettled` in the filing session with an empty input (`{}`), which pays what that session's boards owe. The flow's block is not called for that request. | `tse:1-45`; `rw:48-70` |
| 7.3.5 | The block runs once per ending. If it throws, the notice stays owed and runs again, never beside a running copy. | `tse:1-45` |
| 7.3.6 | If the filing session no longer exists, or the notice has been owed longer than `maxDebtAgeMs`, the task records `metadata["noticeUndeliverable:<attempt>:<ending>"] = { at, detail }` and gives up. A caller cannot forge, clear or settle one of these markers by a filing or a patch. | `dl:91-93`; `tn:804`, `:815-825`; `pass:105-112` |
| 7.3.7 | The held-until-the-request-ends delivery needs durable execution and a store that keeps wakes. Without them a notice is sent once, when the task ends, and a lost one is not sent again. | `apps/docs/docs/advanced/durable-execution.md:367`; `rw:84-110` |
| 7.3.8 | On interruption, a held notice goes out when the request is marked `interrupted`, which is within `staleSweepThresholdMs` plus the sweep interval of its last heartbeat (defaults 60 s and 30 s). | `rc:278-300` |
| 7.3.9 | Board notice (for live views): each change to a board's task publishes a `board` notice on the filing session's topic narrowed to the board id, whichever session or process made the change; it carries only the changed task's id. A row added also goes out on the board's own scope topic (session, user or org). On a partitioned ledger both name the partition as an opaque key. | `packages/core/src/types/board-notice.ts:1-70` |

### 7.4 One entry, many boards: `taskLedgers`

`taskLedgers({ name, resolve, uses?, onError?, endRules?, allowSessionState? })` builds a task entry's `from` value, so a board in any flow can hand it tasks. `resolve(ledgerId: string, ctx: BlockContext, partition: string | undefined, taskId: string)` (`taskId` required; `partition` always passed, may be `undefined`; `te:224-229`) returns the ledger or `undefined`; the ledger id is the sending board's `boardId`. An id it does not answer for is refused `UnknownTaskLedgerError` (`code: "unknown-task-ledger"`, fields `entry`, `taskId`, `ledgerId`) before any row is read, so nothing was written, and the sender's attempt fails through its ordinary error path. An entry with `from` that a board in the same flow dispatches to is refused at `defineFlow`. `onError` defaults to `"skip"`. `allowSessionState` accepts an entry whose blocks keep session state. `te:262-275` (`onError ?? "skip"`), `:337`, `:588-602`; `packages/orchestration/test/task-board/task-ledgers.test.ts:143` (same-flow board refused), `:225` (unknown ledger refused before any row is read), `:345`.

- 7.4.1 One exception to "nothing continues an interrupted run": a request interrupted inside a worker's call that had sent its message but not yet parked is continued by the durability sweeper, and the replay waits on the message already sent, not a second one. `SRV:394-402`; `ds:17-42` (`continueOwedPark`).

## 8. How a page follows dispatched work (lookup)

| Question | Answer | Source |
|---|---|---|
| Which runs did this conversation start? | `fsd.sessions.children(sessionId)`, or `useSession(...).childSessions` | 4.10 |
| Which runs does this flow have? | `fsd.sessions.list({ flowKind, include: "dispatch-runs" })` | 4.10 |
| Is a run still going? | `status === "active"` means not finished; it does not mean a worker is alive. With `live: true` `useSession` re-reads as runs start and finish. Never render `active` as "working" without `live` | 4.12; `useSession.ts:396-435` |
| What did it do? | `fsd.sessions.requests(runId, { includeItems: true })`; the run's `id` is a session id, so every session read works | 4.10 |
| Watch a request live | `GET /api/flows/:kind/requests/:requestId/stream`, or a request handle's `stream()`. Reconnect with `Last-Event-ID` or `starting_after` to resume from a sequence number rather than replaying from zero | `packages/engine/src/routes/stream-routes.ts:170-195`; `README` "Stream bridge"; `GUIDE:217-220` |
| Did the work come out right? | for a task-board job, read the task (4.12.3); the job's status says only whether anything is still running | 4.12.3 |
| Where a side chain's failure shows | the DevTool trace for the request, never the user's stream (2.3.1) | 2.3 |
| Who is the run | `source` and `metadata.dispatch` (only when `source` is `internal` or `task`) | 4.4 |

Every run has an id, a status and an item log, and the same tools read all three kinds. A side chain's observed request is the one it runs inside. `GUIDE:213-220`.

## 9. Moved rows with extra detail

### 9.1 Closed connection

The request keeps running until it finishes or the host's timeout; only the abort route stops it. Over HTTP this holds for the action's own POST stream and for a GET stream: a disconnect ends only that tail. `acr:155-172`; `packages/engine/test/stream-routes-disconnect.test.ts:33`; `td:172-217`. A request-scoped host's (Lambda, serverless function) timeout kills a run that is still going; `GUIDE:193`.

### 9.2 Split dispatch and worker processes

See 3.3, 3.4.2, 3.4.5, 3.7.8.

### 9.3 Concurrency rows

See 3.7 (queue-backed behaviour) and 3.6 (key lease).

### 9.4 Actor runs

The `eventActors` pattern runs each matching actor as a task on a request-scoped `taskBoard` drained by `board.drain` in the emit request, with `concurrency` (default 4). The workers are blocks, not dispatchers: nothing is queued, so none of the guarantees above (outliving a closed connection, a queue's retries, a session of its own) apply. `packages/patterns/src/eventActors/index.ts:1-30`, `:226-231`, `:443-465`.

## 10. Who owns it, who sees it, where it is stored, how many

| Part | Owner | Who sees it | Stored | How many |
|---|---|---|---|---|
| Side chain | the request that queued it | the developer, in the DevTool trace; end hooks get `backgroundFailures`; nothing in the user's stream | nothing of its own: a `block_trace` item on the request (when trace observability is on) and a log line | as many as the sequencer queues, on one per-request pool (`forEachSideChain` runs 16 at a time by default) |
| Queued run (job) | the request it carries: same id, session and user | the user, through the request's stream and status; the operator, through the queue (`adapter.queue`, Bull Board) | Redis: the BullMQ queue (`fsd-flows`, prefix `fsd`); the pub/sub channels (`fsd:stream`); concurrency places on the session's key. The request record and item log are in the shared stores. A finished job is removed after an hour or 1,000 jobs, a failed one after a day, unless `retry` says otherwise | one job per action run; a retry is the same job and request id; with `deadLetter`, a failed one also gets a `dead-letter` job in `<queue>-dlq` |
| Dispatch run | the user who ran the dispatching request, same organization and tenant, on the flow addressed (the sender's, or the instance `flowKind` names) | the owner, through `sessions.list({ include: "dispatch-runs" })`, `sessions.children(parent)` and every session endpoint on its id; another principal, organization or tenant does not | the session store, as an ordinary session with `parentSessionId`, `topic`, `coordinate`, `flowId`; its requests, state, resources and journal belong to it. Session-scoped resources do not belong to the starting conversation unless `sharedToLineage` | one per key per conversation (same key, same conversation: the existing run); `{ id }` creates none |
| Wake | the session it names, fired as that session's owner | the host and its sweeper | the wake store (`stores.wakes`, optional; a store with none means a host that keeps none) | one per `(tenant, session, entry)`; owing again coalesces and keeps the earlier due time |
| Task-ending notice | the task's filer session | the filer session's `onTaskSettled`; the task carries any `noticeUndeliverable:*` metadata | on the task (owed marker; undeliverable record) | one per attempt and ending |

Sources: `ad:1-26`; `rty:9-80`; `rt:38-60`; `cr:169-190`; `packages/engine/src/stores/types.ts:60-130`, `:1873-1905`; `dl:91-93`; `SRV:233-266`.

## 11. Row ledger

Each row of the "→ R-19" list, with where it is carried.

| # | Record, row | Verdict | Carried at |
|---|-------------|---------|------------|
| 1 | event-actors: actor runs inline, not queued | True; the mechanism named is wrong (0.10). Carried corrected | 9.4, 1.5 |
| 2 | background-work: side chain lifetime and failure | True | 2.2, 2.3, 2.4 |
| 3 | background-work: queued run, app-level setting, request id, shared stores | True with the setting corrected: a host option `jobQueue`, not an action field (0.5) | 3.1, 1.2, 3.4 |
| 4 | background-work: queued run failure, dead worker retried, same request id | True for a retryable error and a throw (3.5.2). For a dead process it is BullMQ's own behaviour, unverified in the repo (3.6) | 3.5, 3.6 |
| 5 | background-work: BullMQ worker `mode` | True with names corrected (0.1) | 3.3 |
| 6 | background-work: dispatch return shape | True | 4.2 |
| 7 | background-work: dispatcher `session` options | True | 4.3 |
| 8 | background-work: what a dispatch outlives (`bullmqWorker`) | True with name corrected: a `jobQueue` | 4.6 |
| 9 | background-work: no delay or run-at option | True for `dispatcher()`; `runtime.enqueueAction` has `delay` (3.5.4) | 4.1.4 |
| 10 | background-work: how each kind is watched | True | 8, 2.4 |
| 11 | stores: split dispatch and worker processes | True (README states the symptom) | 3.4.2, 3.4.5 |
| 12 | cli: background work a run starts and `dispatchDrainTimeoutMs` | True, with the scope clarified: the wait covers in-process dispatched runs only (0.7) | 5.1 |
| 13 | http-api: what outlives a closed connection | True, and wider than the row: a closed connection cancels nothing over HTTP (0.8) | 9.1, 2.2.3 |
| 14 | glossary: Wait | True; the refusals are plain `Error`s (0.4) | 4.7, 6.2 |
| 15 | durable-execution: waits and wakes | True. "refuses to build" confirmed; "a wake whose run dies fires again 30 seconds later" confirmed; "logs once at start" confirmed (it is `info`) | 6.1, 6.2 |
| 16 | task-board: dispatch settles, `keptOpenBy`, stale claim, side-chain failure, JSON round-trip | True | 7.1, 7.2, 2.3.6 |
| 17 | task-board: `onTaskSettled` notice | True; `ending` has a fourth schema value that is not listed | 7.3 |
| 18 | task-board: `taskLedgers` and `UnknownTaskLedgerError` | True | 7.4 |
| 19 | concurrency: queue-backed behaviour | True | 3.7 |
| 20 | concurrency: key lease | True | 3.6, 3.7 |
| 21 | background-jobs-bullmq: shared registry, stores and config | True (guarantee only) | 3.4.1 |
| 22 | background-jobs-bullmq: connection forms, prefix, `keyPrefix` | True with `bullmqWorker` read as `bullmqJobQueue` | 3.2 |
| 23 | background-jobs-bullmq: retry options and DLQ | True with the same correction; the DLQ also takes `{ queueName }` and the defaults replace whole objects (0.11) | 3.5 |

**Dropped:** none. Six rows were carried with a corrected name or mechanism: rows 1 (`.forEach`, `maxConcurrency`), 3 (an action-level setting), 5, 8, 22 and 23 (`bullmqWorker`, `dispatch-only`, `worker-only`). No row was untrue in substance.

## 12. Left out, and flagged for the caller

- **Dead-process retry (3.6, row 4).** A queued job whose worker process dies is picked up again by BullMQ's own stalled-job check. Nothing in this repo's source or tests exercises it, and the number of times it is retried (and whether it counts as an attempt) is not on a framework surface. The sheet states the observable outcomes the framework does own (the web side settles from job state, the key frees after `leaseMs`, a lost-lease run ends `interrupted`) and leaves the rest as "the job is picked up again". Pass 5 should keep it that soft.
- **Side chain on suspension (2.2.6).** Stated only by the existing page; no test pins it.
- **The `sideChainTasks` status item (2.4.2).** Not on an exported type; leave off.
- **The `SC:` "two signals" paragraph** conflicts with the HTTP route's behaviour (0.8). The page should say what a reader observes over HTTP: a closed connection cancels nothing, an abort cancels both.
- **`apps/docs` and the `@flow-state-dev/bullmq` README still document `bullmqWorker`, `worker:`, `dispatch-only`, `worker-only`, `createWorkerRunner`, `createFlowWorker` and the `/schedules` subpath** (0.1, 0.2). Both are published or published-in-package text, outside this task. Rewriting them is part of the cutover pass for those pages; a user following them today gets a thrown error from `createFlowState`.
- **The sibling HTTP-API sheet says the children list is "oldest first";** the code and its test say newest first (0.6).
- **Schedules and webhooks** (how a run starts with no user) belong to R-33 and the webhooks pages; this sheet does not carry them. The only schedule rule here is 3.4.4 and 4.1.4.

## Revise round 1

Facts checked or corrected against the code this round.

- `.forEachSideChain` queues one pool task for the batch, not one per element (`sq:1721-1733`). The page row says so.
- A side chain task's `ctx.signal` is the background signal, which fires only on an explicit cancel (`sq:784-795`, `sideChainTaskCtx`). The page says `ctx.signal`.
- After a request is cancelled, background failures are not handed to the end hooks, so a dispatched task's attempt is not failed by them (`ra:207-221`, `ra:2992`, `ra:3333`; `orchestration/src/task-board/task-request.ts:473`). The page says so in one line.
- A `defer` job that "claimed the free key" and then loses that place to a crash waits for the key again; a `hold` job runs at once on retry (`bt/lease-backend.redis.test.ts:411-470`). The page says "a `defer` job that lost its place this way".
- Redis unreachable on arrival: the request is refused and nothing runs unarbitrated (`arb:34-40`). The HTTP status is not on a surface read, so the page says only "refused and nothing is enqueued or run".
- `bullmqJobQueue` does not throw on a `worker` option; `createFlowState` does (`cfs:371-376`).
- `wait_unavailable` and `wait_too_deep` messages from `dispatcher` start with the block label (`core/src/blocks/dispatcher.ts:477-501`); only `getTask` starts with `wait_unavailable:`.
- A board's `mode` is optional; only `boardId` and a durable `defineTaskCollection()` are required to dispatch.
- `taskLedgers` `resolve` takes a required `taskId`.
- `ChildSessionSummary.flowId` can be absent; the page does not say why.

Page examples: `handle-ticket.ts` and a new `src/flows/support/flow.ts` are self-contained (the blocks are defined inline), and `fsdev.config.ts` imports `supportFlow` from it and builds the instance with `supportFlow({ id: "support" })`. All five examples type-check under `tsc` strict (`moduleResolution: bundler`) with no stubs.

### Moved to Reference this round (pass 6), the page keeps a link

The rows below left the page. Their facts stay in the sections above, which are the source for the target page. Targets: R-12 `./runtime.md`, R-13 `./http-api.md`, R-17 `./durable-execution.md`, R-18 `./concurrency.md`, R-23 `./task-board.md`, R-24 `./task-collections.md`, R-08 `./resources.md`, R-33 `./schedules.md`, React API `./api/react.md`. Sections 1 to 9 above still hold the facts for these rows; where a row above is marked corrected in this round, the corrected text is the one to carry.

| Row | To |
|---|---|
| Plain-block board worker runs inline; `eventActors` drains inline with board concurrency (default 4) | R-23 |
| Queued runs are a host setting covering every action; `durable: true` clears suspension records and lease, does not move the run | R-12 |
| `jobQueue` with `runner` throws; retired `worker` option throws (`createFlowState` only); stores every process reaches | R-12 |
| Processing starts on first `ready()`, `getRouter()` or `getRuntime()`; `dispose()` closes processing before stores | R-12 |
| Concurrency policies across processes: Redis lease backend, none, `external-flow-runner`; order, recheck, 30 s `queue` timeout, `defer` cap of 32, rollout | R-18 |
| Timed work is a stored or static schedule, not a dispatcher option | R-33 |
| `sharedToLineage` resource: one copy for the conversation and every session under it; session state has no such route | R-08 |
| `retry`, `continue`, `resume` on a dispatched run's request id answer 404 | R-13 |
| Sessions listing `include` values and 400; caller scoping; `/children` access rule, 404 and empty 200; dispatched requests absent from the starting session's list | R-13 |
| `/children` paging ranges, 400 outside range, `maxChildSessionListLimit`, ordering on `(createdAt, id)` | R-13 |
| Expired approval carried on by the durability sweeper as if rejected | R-17 |
| Task-board job status versus task status; `onError` `"skip"` versus `"fail"`; failure recorded only while the task belongs to the worker's claim | R-23 |
| `wait: true` gate survives restart, sent once; `wait_unavailable`, `wait_too_deep` (depth 5); the deadline cancels nothing; needs a durable action, wakes and the sweeper | R-17 |
| `getTask` wait: same gate, default, bounds, depth; out-of-range deadline refused; `onIdle: "wait"` differs | R-23 |
| Board-worker dispatcher: `session` values, `boardId` and `defineTaskCollection()`, optional `mode`, plan versus delegation | R-23 |
| `dispatchDrainTimeoutMs` (30000), rounds (32), shutdown messages, cancelled runs' status, what the drain does not wait for, `fsdev run` and `NoRequestHostError` | R-12 |
| An interrupted run is only marked; a client continues or retries it; the sweeper continues a request interrupted before parking | R-17 |
| `heartbeatIntervalMs: 0`: long runs marked `interrupted` while running, double start, no cross-process cancel | R-12 |
| A client disconnect ends only that stream tail; only the abort route stops a request; request-scoped hosts kill a run at timeout | R-13 |
| Wakes: one per `(tenant, session, entry)`, sweeper fires as the owner, 30 s re-fire, hosts with no wakes and their log lines, `maxDebtAgeMs` (24 h) | R-17 |
| `waitDeadlines` defaults, `0 < min <= default <= max` refusal, out-of-range refused not clamped, `userDeadlineMs` | R-12 |
| What the dispatch hands over (JSON round trip), `StaleTaskClaimError`, board-cannot-record behaviour, `keptOpenBy` values, kept-open rows have no lease | R-23 |
| `taskSettledEntry` options and input fields, no-notice cases, delivery timing and backoff, crash resend, `noticeUndeliverable:<attempt>:<ending>`, `board` live-view notices | R-23 |
| `taskLedgers` options, `resolve` signature, `UnknownTaskLedgerError`, `defineFlow` refusal of same-flow `from`, `onError` default `skip` | R-24 |
| `useSession` `childSessions` order, `{ limit }`, `childSessionsStale`, `live: true` re-read | React API |
| Ownership rows for Wake and Task-ending notice | R-17 |

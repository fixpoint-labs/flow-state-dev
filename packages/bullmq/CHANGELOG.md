# @flow-state-dev/bullmq

## 0.4.0

### Minor Changes

- 61efa05: The app fires its own schedules (FIX-2752). One tick in the engine fires every schedule of every flow, static and dynamic, once per scheduled time. A long-lived server or `fsdev dev` needs no outside cron, several servers on one store tick from one process, and a serverless host adds one route. The five old ways to fire a schedule are removed, with no aliases.

  - **engine:** `createFlowState` takes `scheduler`. Omitted, a built-in local cron ticks each minute in a process that serves the app (`ready()`, `getRouter()`, `serve()`, `fsdev dev`) or works a job queue, never in `fsdev run`, `fsdev chat` or `fsdev block`, and only when a flow declares a static schedule or a schedule index. It ticks only while it holds a lease in `stores.leases`, so one process ticks across servers that share a SQLite or Postgres store; if that process dies, another takes over within three minutes. In production on in-memory or filesystem stores it warns at start: run one server, or use SQLite or Postgres. `scheduler: false` fires nothing; a `SchedulerAdapter` (from `@flow-state-dev/engine/host`, with `ScheduleTicker` and `ScheduleTickReport`) decides when the tick runs. After downtime each schedule fires once, late, for the latest time it missed; earlier missed times are dropped. On Vercel with the local default, startup warns to pass `vercelScheduler()`.
  - **vercel:** `vercelScheduler({ secret? })` is the scheduler for Vercel: pass it as `scheduler` and export its `route` as the `GET` of one route that one Vercel Cron entry calls (`CRON_SECRET` by default; an empty secret refuses every call). Each call fires every due schedule of every flow, each as its own request to the deployment the call reached, and answers 500 when a schedule index fails so the next beat retries. `createGetToPostCronShim` and `createScheduleTickHandler` are removed, with the `@flow-state-dev/vercel/schedules` entry: replace each per-schedule cron entry and route, and each per-flow tick route, with the one route. A once-a-minute beat needs Vercel Pro; a daily beat (Hobby) fires each schedule once a day, late.
  - **bullmq:** `registerStaticSchedules`, `createScheduleDispatchProcessor` and `createBullmqScheduleIndex` are removed, with the `@flow-state-dev/bullmq/schedules` entry. A BullMQ deployment wires nothing for schedules: the local cron runs in its job-queue processes too, elected by the shared store's lease. A static schedule's fire is enqueued like any action, with the queue's retries; a dynamic schedule's fire runs in the process that ticked, since its block can't ride a job, so it has no queue retries and a crash mid-run loses it. Dynamic schedules use the SQLite or Postgres schedule index. The pending rename of `createScheduleDispatchWorker` to `createScheduleDispatchProcessor` in this release ends in this removal.
  - **node:** `serveScheduleTicks` is removed. `serve()` no longer ticks schedule indexes itself; the app's local cron fires static and dynamic schedules alike.
  - **scheduled:** `runScheduleTick`, `startScheduleTick` and `scheduleDispatchRequest` are removed from `@flow-state-dev/scheduled/collection` (the tick is the engine's), and `formatScheduleId` from the package root (it is core's). The pending note that added the first three in this release is superseded by this removal.
  - **core:** `formatScheduleId(orgId, userId, key)` is exported from `@flow-state-dev/core`. `ScheduleDueEntry` names `cron` and `timezone`, so a custom schedule index returns the cron and zone each row already carries.

  Docs: apps/docs/docs/server/scheduled.md (rewritten: the app fires its own schedules; the local cron, the lease, and what one server on in-memory or filesystem stores means; after downtime, once late for the latest missed time; the Vercel route; `scheduler: false`), apps/docs/docs/server/schedule-index.md (drop the "bring a cron" section; the tick claims the index), apps/docs/guides/scheduled-vercel-cron.md (the one-route walkthrough with `vercelScheduler()`, one cron entry, the Pro and Hobby beats), apps/docs/guides/scheduled-dynamic.md (no tick handler; the app's tick claims the index), apps/docs/guides/background-jobs-bullmq.md (drop the schedule wiring), apps/docs/guides/keeping-a-flow-running.md (drop the outside-cron mention), packages/vercel/README.md (`vercelScheduler` replaces the `./schedules` helpers), packages/bullmq/README.md (drop the `./schedules` section and `createBullmqScheduleIndex`), packages/scheduled/README.md (the tick is the engine's; no `runScheduleTick` or `startScheduleTick`), packages/node/README.md (`serve()` no longer ticks indexes itself), packages/engine/README.md (the `scheduler` option, `SchedulerAdapter`, `ScheduleTicker`), packages/core/README.md (`formatScheduleId`; `ScheduleDueEntry`'s `cron` and `timezone`).

- 00b3426: A flow dispatched to a BullMQ worker no longer holds its streamed events, or its Redis connections, after the run is over (FIX-2677).

  - **bullmq:** `createRedisStreamBridge`'s subscriber keeps no events until `events()` is called. Events published before that are dropped rather than buffered, so a dispatch whose events nobody reads no longer grows with every item update. Read `events()` before the run starts if you need every event; late readers recover from the store, as before.
  - **bullmq:** `createWorkerRunner`'s `finished` settles when the job has ended in BullMQ (completed, failed for good, or removed) even if the worker's terminal message never arrived: with the job's own return value when it completed, or an error carrying the job's failure reason. The runner checks the job's state every 10 seconds (`DEFAULT_LEASE_MS`). The subscriber and its two Redis connections close either way. A job still waiting, delayed for a retry, or running keeps the dispatch open.

  Docs: packages/bullmq/README.md (the stream bridge section: `events()` buffers only from its first call; the runner section: `finished` also settles from the job's end state, checked every `DEFAULT_LEASE_MS`).

- ae56d59: The queue integration is now called a job queue, so its names no longer collide with Workforce workers (FIX-2751). This is a breaking rename with no aliases.

  - **engine:** the `createFlowState` option `worker` is now `jobQueue`. Passing `worker` throws and names `jobQueue`. `WorkerAdapter` is `JobQueueAdapter`, `WorkerMode` is `JobQueueMode`, and `WorkerHandle` is `ProcessingHandle`. The adapter's `startWorker(runtime)` method is `startProcessing(runtime)`.
  - **engine:** the modes are `"enqueue-only"` (was `"dispatch-only"`), `"process-only"` (was `"worker-only"`) and `"colocated"`. An unknown mode throws at `createFlowState` rather than running as `colocated`.
  - **bullmq:** `bullmqWorker(...)` is `bullmqJobQueue(...)`, with `BullmqJobQueueOptions` and `BullmqJobQueueAdapter`. The lower-level factories follow: `createFlowWorker` is `createJobProcessor` (with `CreateJobProcessorOptions` and `JobProcessorDeps`), `createWorkerRunner` is `createJobQueueRunner` (with `CreateJobQueueRunnerOptions`), `resolveWorkerConnection` is `resolveProcessorConnection`, and the runtime handle's `createWorker` is `createJobProcessor`. From `@flow-state-dev/bullmq/schedules`, `createScheduleDispatchWorker` is `createScheduleDispatchProcessor`. The `@flow-state-dev/bullmq/worker` subpath is `@flow-state-dev/bullmq/job-processor`.

  To migrate: `createFlowState({ jobQueue: bullmqJobQueue({ connection, mode: "enqueue-only" }) })`, and rename any `FSD_WORKER_MODE`-style environment switch to the new mode values.

  Docs: packages/bullmq/README.md (the `jobQueue: bullmqJobQueue(...)` setup, the three modes, `createJobProcessor`, `createJobQueueRunner`, `resolveProcessorConnection`, `createScheduleDispatchProcessor`, the `./job-processor` subpath row), packages/engine/README.md (the `JobQueueAdapter` / `ProcessingHandle` / `JobQueueMode` entry and the `jobQueue` option), packages/core/README.md (the queue example), packages/claude-code/README.md (`JobQueueAdapter.leaseBackend`), apps/docs/guides/background-jobs-bullmq.md, apps/docs/guides/background-work.md, apps/docs/guides/keeping-a-flow-running.md, apps/docs/docs/configuration/runtime.md (the `jobQueue` option and the mode table), apps/docs/docs/server/background-work.md, apps/docs/docs/cli/overview.md (the `process-only` section and its anchor), apps/docs/docs/advanced/concurrency-policies.md, apps/docs/docs/tools/claude-code-sdk.md. Say "job queue" in prose where these pages say "worker adapter" or "queue worker".

- de09b77: **Breaking:** 1,107 exports are removed from the roots of the published `@flow-state-dev/*` packages, with no deprecated aliases, so importing one from a package root no longer compiles; some of them are still exported from another entry of the same package (FIX-2562).
- aa45e92: A user or org resource is read by scope and key with no session, and a client writes it only through the flow it names (FIX-2624).

  - **core:** `defineResource` takes `runBy` and `canWrite`. `runBy: "default"` lets a client write the resource through the framework's default write flow, which checks the schema, the owner and `canWrite({ prev, next, userId, orgId })`, and writes at the version the client read. `runBy: { flow }` names a flow of your app that writes it instead. With no `runBy`, a client can't write the resource; server flows still write it from their actions. User or org scope only, and with a `client` config.
  - **core:** an org resource with `runBy: "default"` and no `canWrite` is a definition error: your app refuses to start until you declare who may write it, even everyone (`canWrite: () => true`). A user resource needs no rule: it is its owner's. Also refused at definition: `runBy` on a session resource, with `flowIsolation: true` or with no `client` config, `runBy: "default"` with a computed `client.data`, `writable: false`, or (any `runBy`) a `client` config that projects no state, and `canWrite` without `runBy: "default"`.
  - **engine:** three routes. `GET /api/flows/resources/:scope/:key` reads the caller's copy (`{ value, version }`) with no session and no request, projected exactly as the session snapshot projects it: a resource with no `expose`, `exclude` or `data` (content-only) returns no `value`. `POST /api/flows/resources/:scope/:key/actions/:action` writes through the resource's `runBy` flow, in a session the server keeps per writer; it records a request like any action. `GET /api/flows/:flow/identity` answers the user and org the server acts as under that flow's sign-in. Each resolves the caller through the declaring flows' own sign-in (a send to `runBy: { flow }` through that flow's, as a direct call to its action would), never the body, query or headers. Until a caller is signed in by every flow that declares the key, and admitted by one declaring instance's pin, every answer is the `404` an unknown key gets. If the declaring flows' sign-in resolves one request to different users or orgs, the read or write is refused (`500 resolver_disagreement`). A key two flows declare with different sign-ins or client settings is refused per request, naming both. Write sessions are the server's: no route or transport takes one from a client (session create included), the default write flow answers as an unknown flow, and no listing shows a write's session or request.
  - **bullmq:** the job processor runs default writes too. A worker started through `createFlowState({ worker: bullmqWorker(...) })` is given the host's `resolvePrincipal` itself (on `FlowStateRuntime`); one built directly with `createFlowWorker` takes `resolvePrincipal` in its deps, the same host-level resolver your web host is given, so the worker decides whether two flows that declare one resource agree exactly as the host does. Default: the development resolver.
  - **client:** `client.resource(def)` returns a handle with `read()`, `state()`, `set(value, { version })` and `update(updater)`. `update` reads, applies your updater and writes at that version; when another write landed first it reads again and re-applies, three times at most, then rejects with `ResourceWriteError` (`code: "stale_version"`). `client.flow(kind).identity()` returns `{ userId, orgId }`.

  - **core (definition error):** `runBy` of either kind on a single resource whose `client` config projects no state (neither `expose`, `exclude` nor `data`, for example `client: {}`) now throws at definition. With no state projection a client reads none of the resource's state, so it has nothing to write back. To fix it, list the fields the client reads and writes: `client: { expose: ["pinned"] }` (or `exclude: [...]`). A resource with no `runBy` and no state projection (content-only) is not served by the direct read: it answers as an unknown key.

  Docs: apps/docs/docs/resources/client-access.md (reading a user or org resource by scope with `client.resource`; the three routes in the endpoint table), new apps/docs/docs/resources/client-writes.md after `client-access` in the Resources sidebar (`runBy`, the default write flow and its checks, `canWrite` and the org-resource startup error, versions and `update`'s retry), apps/docs/docs/client/overview.md (`client.resource`, `flow().identity()`), packages/core/README.md (`runBy`, `canWrite`), packages/engine/README.md (the three routes), packages/client/README.md (`client.resource`, `identity()`, `ResourceWriteError`), packages/bullmq/README.md (the worker deps' `resolvePrincipal`)

### Patch Changes

- 8e111c9: A message's files reach the model, and the conversation shows them on the person's line (FIX-2517).

  - **client:** `flow(address).send(action, input, { sessionId, attachments })` sends the message's files beside the input. Each is the `FileContent` that `upload` returned, in the order attached. The flow's input schema never sees them.
  - **react:** `useSession().sendAction(action, input, { userMessage, attachments })` sends them the same way. The line the view shows at once holds the files after the text, as the server's copy will.
  - **engine:** an action with `userMessage` takes files. The user line it writes holds a `file` part per file after the text, as references, so a reload shows them. An action without `userMessage` refuses files with 400 `attachments_not_accepted`. A message over the limits answers 400 `attachment_limit` (with the `index` of the file that went over and the `limit`), a type off the list answers 400 `attachment_type_refused`, and a file named as another type than it was uploaded as answers 400 `attachment_invalid`. Nothing is claimed or run on a refusal.
  - **engine:** a generator with `history` gets the files as image parts (PDFs as file parts) with the bytes inline, on the person's turn. Later turns still carry earlier files: counting back from the newest message, up to 10 images and 5 documents, the same limits as one message. An older file is named on its turn as `[image: shot.png, not re-sent]`. A file that can no longer be read is named as `no longer available` instead of failing the call. Re-sent files are billed as input on every call; prompt caching (on by default) keeps that cost down.
  - **engine:** retrying a turn (`POST …/requests/:id/retry`) carries its files: the retried line, its record and the model get the same references.
  - **core:** `ModelResolver.prepareMessages(messages)`, optional: a generator passes the messages of every model call through it. The engine's run sets it to read the person's files at the call, so a run's records (a generator's trace, a tool loop's prelude) hold references and never the bytes. A custom model resolver needs nothing new.
  - **core:** `ctx.request.attachments` lists the request's files as references, for a block that hands files on itself. Empty when the message carried none. A generator whose `user` slot repeats the person's words no longer sends the turn twice when that turn carries files.
  - **contracts / core:** `attachmentLimitRefusal(files)` in `@flow-state-dev/core/attachments` checks one message against the limits set, the same check the server makes, so a composer can refuse before send.
  - **bullmq:** a queued job carries the request's files to its worker.

  Docs: a new guide page, "A user turn can carry files": sending files from the client and React, what the model receives, the history rule (newest files up to one message's limits, older ones named), the limits and the named refusals, `ctx.request.attachments`. packages/client/README.md (`attachments` on `send`), packages/react/README.md (`attachments` on `sendAction`), packages/engine/README.md (the user line's file parts and the refusals), packages/core/README.md (`ctx.request.attachments`, `attachmentLimitRefusal`), packages/contracts/README.md (`attachmentLimitRefusal`).

- Updated dependencies [04812f3]
- Updated dependencies [61efa05]
- Updated dependencies [ec99b11]
- Updated dependencies [4b4a7d4]
- Updated dependencies [8e111c9]
- Updated dependencies [d30f516]
- Updated dependencies [f888e69]
- Updated dependencies [2cb6326]
- Updated dependencies [2876f11]
- Updated dependencies [a27cf26]
- Updated dependencies [77a6c9b]
- Updated dependencies [5e55476]
- Updated dependencies [81b1693]
- Updated dependencies [aa28006]
- Updated dependencies [e3ca793]
- Updated dependencies [7a2bb7e]
- Updated dependencies [ad80d4e]
- Updated dependencies [9d8f2be]
- Updated dependencies [0b56b1c]
- Updated dependencies [e505adf]
- Updated dependencies [5b2bd16]
- Updated dependencies [819c2a5]
- Updated dependencies [fe85f56]
- Updated dependencies [f89e8a5]
- Updated dependencies [a06ad2d]
- Updated dependencies [ec679dd]
- Updated dependencies [4394069]
- Updated dependencies [44b199d]
- Updated dependencies [5549fd1]
- Updated dependencies [cf185b3]
- Updated dependencies [c7ce9ff]
- Updated dependencies [c487501]
- Updated dependencies [95d9686]
- Updated dependencies [1600ca1]
- Updated dependencies [6b360fa]
- Updated dependencies [3973e1f]
- Updated dependencies [41dcd7e]
- Updated dependencies [ae56d59]
- Updated dependencies [e238e18]
- Updated dependencies [a63b662]
- Updated dependencies [e9722ee]
- Updated dependencies [c049036]
- Updated dependencies [c049036]
- Updated dependencies [74a7b9d]
- Updated dependencies [b43424c]
- Updated dependencies [3ef3979]
- Updated dependencies [3ef3979]
- Updated dependencies [42980e4]
- Updated dependencies [de09b77]
- Updated dependencies [2e7c92f]
- Updated dependencies [c82adfa]
- Updated dependencies [aa45e92]
- Updated dependencies [546603f]
- Updated dependencies [4a6643c]
- Updated dependencies [246f0ba]
- Updated dependencies [4698256]
- Updated dependencies [0454257]
- Updated dependencies [85ca2a3]
- Updated dependencies [714e98f]
- Updated dependencies [95f3cce]
- Updated dependencies [0454257]
- Updated dependencies [1e58902]
- Updated dependencies [81c145c]
- Updated dependencies [13e3970]
- Updated dependencies [ec1fdf9]
- Updated dependencies [1970b12]
- Updated dependencies [c36ffa0]
- Updated dependencies [23bac7e]
- Updated dependencies [1f46aaf]
- Updated dependencies [b5b52b9]
  - @flow-state-dev/core@0.6.0
  - @flow-state-dev/engine@0.6.0

## 0.3.2

### Patch Changes

- Updated dependencies [531bf32]
- Updated dependencies [05a7022]
- Updated dependencies [c67aa49]
- Updated dependencies [4d3f49e]
- Updated dependencies [a1386ea]
- Updated dependencies [46e4297]
- Updated dependencies [d3eaa00]
- Updated dependencies [f1e6315]
- Updated dependencies [45c158b]
- Updated dependencies [bc65135]
- Updated dependencies [65ee4c5]
- Updated dependencies [da4a4bb]
- Updated dependencies [5f569fd]
- Updated dependencies [844a4f9]
  - @flow-state-dev/engine@0.5.0
  - @flow-state-dev/core@0.5.0
  - @flow-state-dev/scheduled@0.3.2

## 0.3.1

### Patch Changes

- e0daf6e: Stores profiles take a `bus` slot: a change bus that carries notices that something under a session, user or org changed (`ChangeBus`, `ChangeNotice`, `BusTopic`, `createInMemoryBus`). Every request and session write publishes on its session's topic, through `withChangeBus`, which `resolveStores`, `createFlowState`, `runAction`, BullMQ's job processor and `fsdev run` / `chat` apply. The session stream (`GET /sessions/:id/stream`) now reads when a notice wakes it, at most once a second; on a bus that crosses processes it reads nothing while the session is idle. The in-memory bus, the default and the only one that ships today, keeps the once-a-second read as well, so nothing changes for a deployment that sets no `bus`. A `bus` adapter declares `"bus"` in its capabilities and resolves `{ bus }`. `@flow-state-dev/contracts` (re-exported by core) adds `ChangeKind` and the wire topic constructors `topic.session(id)`, `topic.user()` and `topic.org()` (FIX-2426).
- Updated dependencies [e0daf6e]
- Updated dependencies [b9e6dd0]
- Updated dependencies [151309c]
- Updated dependencies [9a355b2]
- Updated dependencies [824ce87]
- Updated dependencies [7d92efe]
- Updated dependencies [387bee2]
- Updated dependencies [6c4a3b3]
  - @flow-state-dev/engine@0.4.0
  - @flow-state-dev/core@0.4.0
  - @flow-state-dev/scheduled@0.3.1

## 0.3.0

### Minor Changes

- 9f06d39: On a `bullmqWorker` deployment, a declared `queue` or `reject` concurrency policy is now enforced across every web and worker process, for every run: two `queue` runs into one session run one after the other in the order they were accepted, and a `reject` duplicate is refused. If you declared `queue` or `reject` on a BullMQ app and relied on it being ignored there, declare `concurrency: "allow"` on those entries to keep running in parallel. Upgrade workers before the processes that enqueue: a new job taken by an old worker runs once without the policy, and its session can wait up to `leaseMs` (10 seconds by default) before the next run starts.

  A `dispatcher()` delivery into an existing session (`session: { id }`) is accepted on BullMQ and runs under the recipient's policy, where it was refused `external-dispatcher`. A waiting job gives its worker slot back and requeues itself without using an attempt. The lease backend lives on the same Redis (`createRedisLeaseBackend`, new option `leaseMs`). A worker that can't renew the place its running job holds aborts the run's signal at half the lease, and the request ends `interrupted`; a run that honours the signal has ended before another can take the session.

  For custom lease backends, `isMyTurn` may answer `"missing"` (the waiter is re-admitted at the back of the line), `renew` may answer `false` (a running holder is stopped), and a backend may declare `leaseMs`. The engine exports `holdLeasePlace`, `settleUnstartedRequest` and `ConcurrencyLeaseLostError` for adapter workers (FIX-1634).

- 2ffc03c: "Dispatcher" now names only the `dispatcher()` block (FIX-2245). Two other things that shared the word are renamed, with no alias.

  - A task board's rule for which ready task it claims next is a claim order. `TaskDispatcher` is `ClaimOrder`; `fifoDispatcher`, `topologicalDispatcher` and `priorityDispatcher` are `fifoClaimOrder`, `topologicalClaimOrder` and `priorityClaimOrder`; harness-manager's `runOwnerDispatcher()` is `runOwnerClaimOrder()`. The task board's option is `claimOrder` (it was `dispatcher`, which it now refuses by name), and takes the same `"fifo"`, `"topological"` and `"priority"` names.
  - What decides where a flow action runs is a runner. `FlowDispatcher` is `FlowRunner`, `InProcessDispatcher` and `InProcessDispatcherDeps` are `InProcessRunner` and `InProcessRunnerDeps`, `createInProcessDispatcher` and `isInProcessDispatcher` are `createInProcessRunner` and `isInProcessRunner`, and BullMQ's `createWorkerDispatcher` and `CreateWorkerDispatcherOptions` are `createWorkerRunner` and `CreateWorkerRunnerOptions`. The option on `createFlowState`, `createFlowApiRouter` and `createInboundTransportHost` is `runner` (it was `dispatcher`, which they now refuse by name), `WorkerAdapter.createDispatcher` is `createRunner`, and `InboundTransportHost.usesExternalDispatcher` is `usesExternalRunner`.

  The `external-dispatcher` refusal keeps its value.

- 7da156e: Organization ids are now validated as well-formed, non-blank Unicode everywhere (resolver, `runAction`, dispatch, BullMQ jobs, schedules, `fsdev run --org`) and seat addresses escape any such id, while route segments are decoded exactly once on every host (`parseFlowRoute` now takes decoded segments, built from a raw URL by the new `decodePathSegments`), so escaped seat ids resolve on Next and Vercel and stored rows or queued jobs with a lone-surrogate org id are now refused (FIX-1757).
- 8195995: Schedule index rows are now identified by the storage cell the schedule lives in plus its key, so a person's same-named schedules in two hired seats (or a seat and their app-wide flow) are two rows and turning one off no longer stops the other (FIX-1546). `ScheduleIndexRow` gains a required `cell`, `ScheduleIndex.remove` takes `{ cell, key }` instead of `(userId, key)`, and `CollectionHookContext` gains `cell`, the storage key the instance is persisted under. A custom `ScheduleIndex` must key its storage on `(cell, key)` and store `cell`; the conformance suite covers it. The SQLite and Postgres `schedule_index` tables are re-keyed on `(cell, key)` automatically at schema init, adopting every existing row as its person's own cell; with `skipSchemaInit: true`, apply the upgrade SQL in the schedule index reference. BullMQ scheduler ids are built from the cell and key; an app-wide schedule for an ordinary user id keeps its existing scheduler id.
- 69ba29c: Every flow now keeps a user's data per organization, so `resolveUserStorageKey(userId, orgId, flow)` takes the organization and throws without one, a dynamic schedule's dispatch id is `<orgId>/<userId>/<key>` (built by the new `formatScheduleId`), and the test harness seeds user data in the run's organization (FIX-1790).

### Patch Changes

- 452b702: BullMQ workers now honour the `hold` and `defer` concurrency policies, which used to run as `allow` once handed to a queue. A `hold` job runs at once and keeps its conversation busy until it ends. A `defer` job waits, by requeueing rather than holding a worker slot, until nothing on its key is running or waiting, then runs; a crashed worker's place frees once its lease runs out. The dispatching process counts a queued `defer` against the 32-per-key cap until its job ends, and checks ownership before either policy takes anything on the key (FIX-1836).

  For adapter authors, the engine adds `DispatchEnvelope.leaseTurn` (how a queued job reaches its turn), `planDeferWait` and `DEFER_PATIENCE_MS` (the `defer` wait, shared with the in-process arbiter), and a `budgetMs` option on `planQueueWait`. Roll out workers before the processes that enqueue: an older worker treats a `hold` job as `queue` and runs a `defer` job at once.

- eb831f8: The scheduled-dispatch endpoint fires each scheduled time at most once across retries, restarts and hosts sharing a SQLite or Postgres store, refuses crons that aren't five fields and unknown time zones, and removes `idempotencyKey`, `idempotencyWindowMs` and `idempotencyOptions`; teams outside the repo rewrite at upgrade, see the migration notes (FIX-2085).
- Updated dependencies [92b2b70]
- Updated dependencies [20aa58f]
- Updated dependencies [5d31955]
- Updated dependencies [bea14a0]
- Updated dependencies [15f7c6b]
- Updated dependencies [24afa6e]
- Updated dependencies [f8df86f]
- Updated dependencies [82eea02]
- Updated dependencies [e2c190e]
- Updated dependencies [0d55d46]
- Updated dependencies [1abab86]
- Updated dependencies [8e67ce5]
- Updated dependencies [920adc3]
- Updated dependencies [283fb2a]
- Updated dependencies [dd353e2]
- Updated dependencies [3221d05]
- Updated dependencies [58ffc93]
- Updated dependencies [f97b0ed]
- Updated dependencies [397cfa7]
- Updated dependencies [9f06d39]
- Updated dependencies [452b702]
- Updated dependencies [53b50f0]
- Updated dependencies [e4fb1f1]
- Updated dependencies [538cd1a]
- Updated dependencies [585b75b]
- Updated dependencies [3b5266a]
- Updated dependencies [2ffc03c]
- Updated dependencies [646f8d2]
- Updated dependencies [16a8dab]
- Updated dependencies [b75c1ed]
- Updated dependencies [25ac53a]
- Updated dependencies [456fe85]
- Updated dependencies [6453d2c]
- Updated dependencies [62133c4]
- Updated dependencies [f282bcb]
- Updated dependencies [651c87e]
- Updated dependencies [9d02ac6]
- Updated dependencies [d5ce1e0]
- Updated dependencies [55c62a6]
- Updated dependencies [8dc242e]
- Updated dependencies [89af7db]
- Updated dependencies [85b2965]
- Updated dependencies [1355483]
- Updated dependencies [7d4158f]
- Updated dependencies [5492a77]
- Updated dependencies [6819520]
- Updated dependencies [099906a]
- Updated dependencies [ad5df6f]
- Updated dependencies [5902deb]
- Updated dependencies [2ce15c7]
- Updated dependencies [4f2e13e]
- Updated dependencies [211679a]
- Updated dependencies [dd80e01]
- Updated dependencies [2ce15c7]
- Updated dependencies [5181ddb]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [e71ea1a]
- Updated dependencies [60d1bf4]
- Updated dependencies [49d6397]
- Updated dependencies [a55d07f]
- Updated dependencies [7db4d13]
- Updated dependencies [9e3b823]
- Updated dependencies [df3de3b]
- Updated dependencies [42bfbe6]
- Updated dependencies [fe5df7d]
- Updated dependencies [423a405]
- Updated dependencies [08a9b05]
- Updated dependencies [57323b9]
- Updated dependencies [7da156e]
- Updated dependencies [8a55e23]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [430db1b]
- Updated dependencies [21ffcbb]
- Updated dependencies [f9995b1]
- Updated dependencies [5a55080]
- Updated dependencies [a7f1c41]
- Updated dependencies [3a6c910]
- Updated dependencies [80f6e25]
- Updated dependencies [2d2518b]
- Updated dependencies [c57890d]
- Updated dependencies [3cbab3a]
- Updated dependencies [3cbab3a]
- Updated dependencies [849f6ec]
- Updated dependencies [028af6f]
- Updated dependencies [a965a50]
- Updated dependencies [eb831f8]
- Updated dependencies [41638f3]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [a64132b]
- Updated dependencies [db7df1c]
- Updated dependencies [0d6278e]
- Updated dependencies [968faa6]
- Updated dependencies [653549d]
- Updated dependencies [0abbcd9]
- Updated dependencies [d9d00a4]
- Updated dependencies [c6b2db9]
- Updated dependencies [839e915]
- Updated dependencies [711ed0e]
- Updated dependencies [72c5b17]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
- Updated dependencies [65ddb90]
- Updated dependencies [47a02d0]
- Updated dependencies [e0f10e2]
- Updated dependencies [9083569]
- Updated dependencies [9510a03]
- Updated dependencies [0935a47]
- Updated dependencies [d2f77fc]
- Updated dependencies [0995afe]
- Updated dependencies [adbcf0b]
- Updated dependencies [d9d00a4]
- Updated dependencies [1027b98]
- Updated dependencies [1cfd80c]
- Updated dependencies [229de7a]
- Updated dependencies [4ca0e99]
- Updated dependencies [3b0161c]
- Updated dependencies [d86c7db]
- Updated dependencies [385d01e]
- Updated dependencies [fa7b22e]
- Updated dependencies [a4e626b]
- Updated dependencies [d1a4cab]
- Updated dependencies [83cd9c2]
- Updated dependencies [3311cc2]
- Updated dependencies [7c9e932]
- Updated dependencies [637b6d5]
- Updated dependencies [60c8192]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [71b0174]
- Updated dependencies [295e96a]
- Updated dependencies [8b8ba8d]
- Updated dependencies [97894aa]
- Updated dependencies [3c2ab06]
- Updated dependencies [334c1e3]
- Updated dependencies [64b3ed7]
- Updated dependencies [92a8b49]
- Updated dependencies [9ed6b29]
- Updated dependencies [9f32967]
- Updated dependencies [b7c523b]
- Updated dependencies [6bf61dc]
- Updated dependencies [b552b50]
- Updated dependencies [a021cd1]
- Updated dependencies [c8c8b38]
- Updated dependencies [1f2dadd]
- Updated dependencies [cd180d7]
- Updated dependencies [6306a75]
- Updated dependencies [68b8957]
- Updated dependencies [e11764a]
- Updated dependencies [2c43888]
- Updated dependencies [872a088]
- Updated dependencies [9cd314d]
- Updated dependencies [9af8ce5]
- Updated dependencies [30aa133]
- Updated dependencies [6e1a819]
- Updated dependencies [0d6278e]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [a26e426]
- Updated dependencies [69ba29c]
- Updated dependencies [d97031f]
- Updated dependencies [f741004]
- Updated dependencies [49d2aca]
- Updated dependencies [3c10d9d]
- Updated dependencies [ce8f765]
- Updated dependencies [96ff077]
- Updated dependencies [84cc226]
  - @flow-state-dev/core@0.3.0
  - @flow-state-dev/engine@0.3.0
  - @flow-state-dev/scheduled@0.3.0

## 0.2.0

### Minor Changes

- b48158a: Organization identity is now required on every request (FIX-1442).

  A session, request, dispatched child and scheduled job each carry an
  organization, and the server checks it on reads and execution alongside the
  user. It comes from a configured `resolvePrincipal`, or — when an app
  configures no resolver — from the new reserved `DEFAULT_ORG_ID` exported by
  `@flow-state-dev/core`. A caller-supplied `orgId` is never authoritative.

  **What you need to change**

  - A resolver must return a verified `orgId`. Returning none, a blank one, or
    `DEFAULT_ORG_ID` is refused with 401. A machine transport may return
    `{ orgId }` alone and let `defaultUserId` name its system user.
  - Direct `runAction` calls must pass `orgId` — your verified organization, or
    `DEFAULT_ORG_ID` for single-organization development.
  - `authentication.requireOrg` and a block's `requireOrg` are removed.
    Organization is unconditional, so the declaration had nothing left to say;
    a config that still carries either is rejected at definition time rather
    than ignored.
  - Client and React session APIs no longer take an `orgId` — the server owns
    it. `SessionDetail.orgId` is now required on the way back.
  - `openChannels` no longer takes an `orgId`; the server binds the channel.
  - A queued BullMQ job that carries no organization now fails terminally
    instead of being retried: a worker runs below principal resolution, so no
    later attempt could supply one. Subscribers receive an error terminal rather
    than waiting for a job that never completes.

  **The schedule index stores the organization.** `schedule_index` gains a
  nullable `org_id` column in both the SQLite and PostgreSQL adapters, so the
  organization a schedule fires into survives a round trip through the database.
  The column is added for you on the next schema init — there is no manual DDL
  step. Existing rows read back with no organization and are quarantined rather
  than dispatched, so a schedule written before this upgrade does not fire until
  it is attributed; rewriting it stamps the organization of the execution that
  writes it.

  **Upgrading a store with existing data.** Records written before this carry no
  organization. They are preserved and refused (`409 migration-required`) rather
  than guessed at, and listings and scheduler scans skip them. Attribute them
  offline first — the procedure, including dynamic schedules, index rebuild and
  the reserved-id collision check, is in the persistence guide under "Which
  organization a record belongs to".

### Patch Changes

- Updated dependencies [b597600]
- Updated dependencies [795b550]
- Updated dependencies [6b8bfe4]
- Updated dependencies [3e43c96]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
- Updated dependencies [e4b6576]
  - @flow-state-dev/core@0.2.0
  - @flow-state-dev/engine@0.2.0
  - @flow-state-dev/scheduled@0.2.0

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2
  - @flow-state-dev/engine@0.1.2
  - @flow-state-dev/scheduled@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
  - @flow-state-dev/core@0.1.1
  - @flow-state-dev/engine@0.1.1
  - @flow-state-dev/scheduled@0.1.1

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

### Patch Changes

- afcac3d: A flow declares its `cardinality` — `"singleton"` (the default: `myFlow()` is the one instance, addressed by its kind, and `myFlow({ id: "default" })` now throws) or `"collection"` (several configured copies, each registered under its own required `id`) — every address (the action, stream, resume, retry and continue routes, `fsdev run`, dispatchers, BullMQ jobs, MCP, webhook and schedule dispatch) is the exact instance id with no first-registered fallback, every session and request records its owning `flowId` and is refused when reached through another instance (`FlowInstanceBindingMismatchError`; `409 wrong-instance-session` / `wrong-instance-request` / `migration-required` on the routes), and SQLite and Postgres add a nullable indexed `flow_id` column with no backfill (FIX-1321, FIX-1322).
- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [e2fda9d]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [af40427]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [2c4b0f5]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0
  - @flow-state-dev/engine@0.1.0
  - @flow-state-dev/scheduled@0.1.0

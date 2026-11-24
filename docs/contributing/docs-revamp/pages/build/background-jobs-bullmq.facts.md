# Facts for Run background jobs with BullMQ (B-19, recipe)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit was read. Where a line is in `packages/*/src` it is an exported signature, a doc comment, or code read only to confirm what a call does; the page states behaviour a reader can observe, never the mechanism. Nothing below was run in this pass: the Redis-backed tests (`packages/bullmq/test/*.redis.test.ts`) need a `REDIS_URL` and were read, not run.

Paths are from the repo root. Abbreviations:

- `bmq` = `packages/bullmq/src`; `eng` = `packages/engine/src`; `rx` = `packages/react/src`; `cl` = `packages/client/src`; `con` = `packages/contracts/src`
- `gbj` = `apps/docs/guides/background-jobs-bullmq.md` (the page being replaced; the draft copy under `docs/contributing/docs-revamp/pages/build/` is the same text with five more lines of frontmatter)
- `rd` = `packages/bullmq/README.md`; `ks` = `apps/kitchen-sink/fsdev.config.ts`
- `bt` = `packages/bullmq/test`; `et` = `packages/engine/test`
- `c16` = `docs/contributing/docs-revamp/pages/concepts/background-work.md` (the page's concept neighbour, C-16)

Legend: **[page]** the page states it. **[ref]** belongs on `reference/background-work`; the page links and does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[conflict]** two sources disagree; the code wins and the note names the wrong source. **[answers Qn]** the sitemap question it answers: Q1 "What runs the job after the request returns?", Q2 "What does the page see meanwhile?"

The page's one app is the support desk, as on C-16 (`c16` shows `support` with a long `buildReport` action in "The same request, somewhere else") and `flows-and-actions.md` (flow `support`, default export `supportFlow()`, `fsdev.config.ts` with `createFlowState({ flows: [support] })`). Names below are the page's, not the code's.

## 0. Items for the page owner before drafting

1. **[plan] The budget is 750 words and the page it keeps is about 3,000.** `gbj` carries seven things the recipe's four steps do not need. Cut to Reference or drop: the Docker compose file (`gbj:34-62`, but a Redis URL is needed, see 5); the Next.js HMR note (`gbj:115-125`); `enqueueAction` one-off jobs (`gbj:127-144`); low-level primitives (`gbj:178-180`); scheduling (`gbj:184-224`, covered by B-15 to B-18 and `c16` row 68); connection options (`gbj:228-245`); the retry table (`gbj:249-274`); the kitchen-sink section (`gbj:278-294`). Each is a fact below marked [ref] or [cut]. The recipe's four steps map to: install = sections 1 and 2; a processing process = sections 3 and 4; send an action to the queue = section 5; watch it = sections 6 and 7.
2. **[conflict] `flows: { /* ... */ }` is not the option's type.** `gbj:87,153` write `flows` as a map. The exported type is an array: `eng/flowstate/types.ts:124` (`flows?: readonly FlowInstance<any, any>[]`). The page writes `flows: [support]`, as `flows-and-actions.md` and `c16` do. Likewise `stores: { /* ... */ }` in `gbj:88,154` is not the shape: `eng/flowstate/types.ts:169-179` accepts omitted, one adapter, or named profiles. [page]
3. **[conflict, small] The guide's "there is no way to wire the worker against different stores than the web runtime" (`gbj:103`) is true only in one process.** In `colocated` mode `createFlowState` hands the enqueue side and the processing side the same resolved `{ registry, stores, runtimeConfig }`: `eng/flowstate/types.ts:72-80`; `bmq/flowstate-adapter.ts:68-75`; `eng/flowstate/createFlowState.ts:1119-1132` (one `runtime`, passed to `createRunner` and `startProcessing`). A separated deployment is two `createFlowState` instances in two processes and nothing compares them: `rd:64`. The page says the second. [page]
4. **[plan] The "processing process" step has no `fsdev` command.** `fsdev serve` calls `flowState.ready()` after the socket binds (`packages/fsdev/src/commands/serve.ts:165`), so a `colocated` app started by `fsdev serve` consumes the queue; no command in `packages/fsdev/src/commands/` (`benchmark, block, chat, dev, gen, run, serve, ui, worktrees`) builds a `process-only` job queue (a search of that folder for `process-only` and `jobQueue` finds nothing). The processing process is a small script that imports the app's `FlowState` and awaits `ready()`: `gbj:165-172`; `eng/flowstate/types.ts:53-64,374-383` ("call `ready()` eagerly in processes that must consume the queue from boot"). **[verify]** that `fsdev dev` also calls `ready()` before the first request; `dev.ts` delegates to `@flow-state-dev/node`'s `serve()` (`packages/fsdev/src/commands/dev.ts:5-6`) and I did not follow it. The page does not name how to run `process-jobs.ts` (a TypeScript runner is the reader's choice); no source in the repo states one. [page: a script, not a command]
5. **[verify] "Redis 6+".** `gbj:28` says it. No source in the package states a minimum: `packages/bullmq/package.json` has `bullmq ^5.0.0`, `ioredis ^5.0.0` and `engines.node >=22`; the kitchen-sink compose file runs `redis:7-alpine` (`apps/kitchen-sink/docker-compose.dev.yml:3`). Keep the page to what the repo runs: "Redis" and the compose image, or drop the version. Node 22 or newer is stated: `packages/bullmq/package.json` (`engines`), `packages/engine/package.json:101`. [page: Node 22; Redis without a version]
6. **[conflict] "Validation errors, unknown flows, and unknown actions skip retries" (`gbj:274`, `rd` Retry section).** Confirmed for an unknown flow (`bmq/job-processor.ts:327-330`, test `bt/job-processor.test.ts:190-200`) and for any error the run marks `retryable: false` (`bmq/job-processor.ts:430-437,519-521`, test `bt/job-processor.test.ts:151-162`), which includes the validation errors in `eng/errors/flow-error.ts` (`retryable: false` at `:39,121,154,170,189,206,248,290`). **[verify]** unknown actions: no `retryable: false` path for an unknown action name was found in `eng/execution/`; the route refuses unresolved addresses before enqueue (`eng/transports/host/createInboundTransportHost.ts:1557-1569` throws `UnknownFlowError` for an unknown flow). The page says "an error marked not retryable is not retried" and leaves "unknown actions" out. [ref]
7. **[plan] `useSession`'s `sendAction` resolves when the server accepts the request, not when it finishes.** It awaits the POST (`rx/hooks/useSession.ts:2273-2279`), reads the 202 JSON (`:2313`), calls `attachToStream(response.request.id)` without awaiting it (`:2317`) and returns the response (`:2323`). So on a queued action the promise settles in the time of an enqueue; the work shows up through `session.items`. The `human-in-the-loop.facts.md` sheet says `sendAction` resolves when the stream ends; for the inline-SSE path the code also returns right after attaching (`:2297`), so that line should be rechecked there. [page]
8. **[plan] The sitemap's step "send an action to the queue" has no new call to show.** A queued action is the same call as an in-process one: the queue is the app's `jobQueue` setting, not an option on the action. There is no per-action background flag: `ActionConfig` carries `durable`, `concurrency`, `taskOf`, `tokenBudget` and nothing for a queue (`packages/core/src/types/flow.ts:225-250`, from the C-16 sheet row 1; I did not re-read these lines). The step shows `session.sendAction("buildReport", ...)` unchanged and says so. [page]

## 1. What the adapter is

- `@flow-state-dev/bullmq` runs flow actions as jobs on a Redis queue, so the work does not run in the process that took the request. `bmq/index.ts:1-8`; `rd:3`. [page]
- Install: `pnpm add @flow-state-dev/bullmq bullmq ioredis`. `rd:9-13`; `gbj:33-35`. `bullmq` and `ioredis` are also the package's own dependencies (`packages/bullmq/package.json`, `dependencies`); the guide and README still tell the reader to install them. **[verify]** whether the reader needs them as direct dependencies: `bmq/schedules.ts` and the guide's `Queue` import (`gbj:191`) import from `bullmq`, but the page's example imports only `bullmqJobQueue`. [page: the guide's command, unchanged]
- Requires Node 22 or newer (section 0, item 5). [page]
- `@flow-state-dev/scheduled` is an optional peer, needed only for schedules: `packages/bullmq/package.json` (`peerDependenciesMeta`); `rd:15-19`. [ref / B-15 to B-18]
- You need a Redis the process can reach. Locally, the kitchen-sink compose file starts one: `apps/kitchen-sink/docker-compose.dev.yml:1-15` (service `redis`, `redis:7-alpine`, port 6379); the guide's copy of it adds the same file at `gbj:46-62`. `REDIS_URL=redis://localhost:6379`: `gbj:70-74`; `apps/kitchen-sink/.env.local.example:28`. [page: one command and the URL; the compose file is a link or a single line]
- `connection` is a Redis URL string or an ioredis options object: `bmq/types.ts:113-118`; `bmq/connection.ts:290-302`. A `rediss://` URL turns TLS on: `bmq/connection.ts:330-332`; test `bt/connection.test.ts:15-26`. [ref]
- `prefix` namespaces every BullMQ key; default `"fsd"`: `bmq/connection.ts:12,29`; `bmq/types.ts:115-117`. Never set ioredis `keyPrefix`: `bmq/connection.ts:1-9`. [ref]

## 2. Wire the adapter in (colocated, the default)

- The wiring is one option on `createFlowState`: `jobQueue: bullmqJobQueue({ connection })`. `bmq/flowstate-adapter.ts:55-76`; `eng/flowstate/types.ts:374-383`; `ks:98-99,229` (kitchen-sink wires it the same way). `jobQueue` and `runner` are mutually exclusive; passing both throws at construction: `eng/flowstate/createFlowState.ts:367-372`. A config that passes the adapter as `worker` throws and names `jobQueue`; a `mode` outside the three throws: `eng/flowstate/createFlowState.ts:353-366`. [page: `jobQueue`; the exclusion and the throws are [ref]]
- Imports: `createFlowState` from `@flow-state-dev/engine`; `bullmqJobQueue` from `@flow-state-dev/bullmq`. `bmq/index.ts:9`; `c16` ("The same request, somewhere else"). [page]
- The page's example is the `fsdev.config.ts` of the one app, as `c16` shows it:

  ```ts
  createFlowState({
    flows: [support],
    stores: postgresStores({ connectionString: process.env.FSD_DB_URL }),
    jobQueue: bullmqJobQueue({ connection: process.env.REDIS_URL! }),
  });
  ```

  with `support` from `./src/flows/support/flow` (default export `supportFlow()`). `postgresStores` is from `@flow-state-dev/store-postgres`, as on `c16`; `sqliteStores` and `createFlowState({ stores: adapter })` are the other one-adapter forms (`eng/flowstate/types.ts:169-179`). **[verify]** that `postgresStores({ connectionString })` is the exported name and option: `c16` writes it, I did not open `store-postgres`. [page]
- In `colocated` mode (the default) one process both enqueues jobs and consumes them. `bmq/flowstate-adapter.ts:39-45,95`; `eng/flowstate/types.ts:53-64`; test `bt/flowstate-adapter.test.ts:81-86` ("defaults mode to colocated"). The processing side is started when the runtime starts: `eng/flowstate/createFlowState.ts:1124-1132` (`startProcessing` is called unless `mode` is `"enqueue-only"`; `createRunner` unless `"process-only"`). [page]
- The runtime starts lazily, on the first `ready()`, `getRouter()` or `getRuntime()`. Call `ready()` at boot so the process consumes from the start: `eng/flowstate/types.ts:376-383,447-463`; `gbj:97-99`. `fsdev serve` does this for the app (section 0, item 4). [page]
- Shut down with `dispose()`: it closes the processing side (draining the jobs this process is running) and then the queue and the stores. `eng/flowstate/createFlowState.ts:459,516-528`; `gbj:100`; `rd:107-110` ("`dispose()` does not wait for queued work": it drains jobs this process runs, not jobs waiting in the queue or running in another container). [page: `dispose()` on SIGTERM in the processing script; the drain detail is [ref]]
- Options on `bullmqJobQueue`: `connection`, `prefix`, `queueName` (default `"fsd-flows"`), `retry`, `concurrency` (jobs one processing process runs at once, default 2), `lockDuration` (ms, default 300000), `channelPrefix` (default `"fsd:stream"`), `mode`, `leaseMs` (default 10000). `bmq/flowstate-adapter.ts:28-53`; `bmq/job-processor.ts:88-91`; `bmq/stream-bridge.ts:28`; `bmq/lease-backend.ts:43`; `rd:38`. [page: `connection`, `mode`; the rest [ref]]
- The adapter also exposes `queue` (a BullMQ `Queue`, for an admin console) and `runtime` (`enqueueAction`, `createJobProcessor`, `close`): `bmq/flowstate-adapter.ts:60-66`; test `bt/flowstate-adapter.test.ts:88-94`. The kitchen-sink mounts Bull Board on `bullmq.queue`: `apps/kitchen-sink/lib/bull-board.ts:19-23`. [ref; one clause on the page at most]

## 3. A processing process of its own

- `mode` picks which sides a process runs: `"colocated"` (enqueue and process, default), `"enqueue-only"` (enqueue only, the web process), `"process-only"` (process only, a dedicated processing container). `eng/flowstate/types.ts:53-64`; `bmq/flowstate-adapter.ts:39-45`; test `bt/flowstate-adapter.test.ts:149-156`. [page: the two a separated deployment uses, with `colocated` named as the default]
- In `enqueue-only` the processing side is never started; in `process-only` no runner is installed. `eng/flowstate/createFlowState.ts:1124-1132`. [page]
- Separated deployment: both processes build the same `createFlowState(...)` from shared config and differ only in `mode`. `gbj:150-162` (the guide switches on an env var, `FSD_WORKER_MODE`; that variable is the guide's own choice, no code reads it: `grep` finds it only in docs). Recommend the page uses a plain env name of its own and says it is the app's. [page]
- The processing process: import the app's `FlowState`, `await flowstate.ready()`, call `dispose()` on SIGTERM. `gbj:165-172`. [page]
- **Both processes must reach the same stores.** In-memory stores, the default when `stores` is omitted (`eng/flowstate/types.ts:166-169`), are per process, so a separated deployment needs a backend both reach (Postgres, or SQLite or filesystem on a shared disk for one machine). `gbj:174`; `rd:60-64`. Nothing checks it: wire the two processes at different stores and jobs enqueue and run, but the web process's stream and refresh read a store the processing side's writes never reached, and the request stays `in_progress` while the work is done elsewhere. `rd:64`. [page; the strongest limit on the page]
- A job may run in any process consuming the queue, this process or another replica: `rd:58`. [page: with `colocated` in several replicas]
- A `process-only` process serving a router would run an action inline, not enqueue it: `rd:58`; `eng/flowstate/createFlowState.ts:1127-1129`. [ref]
- A dispatch started from a `process-only` process runs in that process and enqueues nothing: `rd:99-105`. [ref; `c16` and `reference/background-work`]
- A per-request `RuntimeConfig` (live model resolvers and providers) does not cross the queue: a queued job runs under the processing process's own configuration, and `fsdev run --model` stops at Redis: `rd:90-96`. [ref]
- Concurrency across processes: each entry's `concurrency` policy (`queue`, `reject`, `hold`, `defer`) holds across every web and processing process through the same Redis: `rd:66-82`; `bmq/flowstate-adapter.ts:11-14`; `eng/flowstate/types.ts:96-113`. `concurrency: 4` on `bullmqJobQueue` is jobs per processing process, a different thing. [ref; one sentence at most]

## 4. What a queued request is (the answer to Q1)

- Calling an action on a queued app creates a request and a job on the Redis queue. A processing process takes the job, runs the same action against the same stores, and writes the request's items there. `bmq/job-processor.ts:393-420` (the job calls `runAction` with the job's `flowKind`, `actionName`, `input`, `userId`, `sessionId`, `requestId`, `orgId`, `tenantId`); `rd:34`. [page; **answers Q1**]
- It is the same request id and the same session as an in-process run: the job carries the dispatcher's `requestId` and `sessionId`: `bmq/runner.ts:434-452`; `bmq/types.ts:120-132`. A queued run does not get a session of its own. `c16` ("The same request, somewhere else"; C-16 sheet row 73). [page]
- The job carries `flowKind` (the flow instance's address), `actionName`, `input`, `userId`, `sessionId?`, `orgId`, `tenantId?`, `source?`, `metadata?`, `attachments?`, `requestId`, and the concurrency fields. `bmq/types.ts:120-154`. [ref]
- Tab closes, browser leaves: the job runs on. The client is not holding the work; the run is in Redis and the processing process writes to the shared stores. `rd:34`; `bmq/job-processor.ts:393-420`. [page]
- A job whose action fails with a retryable error is tried again, up to `attempts` times counting the first (default 3), with exponential backoff from 1000 ms with jitter 0.5. `bmq/retry.ts:203-211`; test `bt/retry.test.ts:4-27`. [page: "retried, three attempts by default"; the rest [ref]]
- An error the run marks `retryable: false`, an unknown flow, a missing organization, a record another flow instance owns, and a run that lost its concurrency place fail at once with no retry. `bmq/job-processor.ts:327-330,388-391,424-428,430-437,461-466`; tests `bt/job-processor.test.ts:151-162,190-200,258-290,404-421`. [ref]
- On a retry the new attempt numbers its events past the last one stored, so a client following the stream by sequence number sees one run, not a restart at zero. `bmq/job-processor.ts:341-353`; tests `bt/job-processor.test.ts:203-256`. [page: one sentence under "watch it"; mechanism [ref]]
- The job's final failure: the request ends `failed` and a waiting stream gets an error terminal on the last attempt only (not on attempts that will be retried). `bmq/job-processor.ts:467-488`; tests `bt/job-processor.test.ts:121-148,164-188`. [ref]
- Retry settings: `retry: { attempts, backoff: { type: "exponential" | "fixed", delay, jitter? }, removeOnComplete, removeOnFail, deadLetter }`. Defaults: `attempts: 3`, backoff exponential 1000 ms jitter 0.5, `removeOnComplete: { age: 3600, count: 1000 }`, `removeOnFail: { age: 86400 }`, `deadLetter: false`. `bmq/types.ts:183-194`; `bmq/retry.ts:203-211`; `gbj:264-272`. [ref]
- `deadLetter: true` copies a job that fails for good (out of attempts or unrecoverable) to `<queueName>-dlq`, with `failedReason` and `originalJobId` added; `{ queueName }` names another queue. A failed write to it is swallowed. `bmq/retry.ts:238-271`; test `bt/retry.test.ts:45-65`. [ref]
- A job that cannot be enqueued fails the POST: the action route answers 500, not 202, and leaves no `in_progress` record behind. `eng/routes/action-routes.ts:260-270,319-322` (500 `DispatchFailed`); test `et/stream-routes-external-dispatch.test.ts:234-257`. [ref]
- Nothing processing jobs, or no job slot free: the request stays `in_progress` (queued). An unclaimed queued request older than `queuedGraceMs` (default 600000 ms, ten minutes) is treated as lost by the stale-request sweep and marked `interrupted`. `eng/routes/createFlowApiRouter.ts:184-198`; `eng/flowstate/types.ts:270-279`; test `et/stream-routes-external-dispatch.test.ts:180-218`. The option is on `createFlowState`. [page: one clause under "watch it"; the option [ref]]

## 5. Send an action to the queue

- From the page's side nothing changes: `session.sendAction("buildReport", input)` from `useSession`, or `flow.send(...)` from `@flow-state-dev/client`. `rx/hooks/useSession.ts:442-446,2189-2197`; `cl/client.ts:861-889`. [page]
- The action route answers **202** with `{ status: "in_progress", request: { id, flowKind, flowId, actionName, status: "in_progress" }, session?: { id } }` and an `x-request-id` header. `eng/routes/action-routes.ts:347-369`. A queue does not answer inline SSE: the host creates no live stream for an external runner (`eng/transports/host/createInboundTransportHost.ts:930-948`), so the client's `Accept: text/event-stream` POST gets the 202 JSON and follows with a GET. `rx/hooks/useSession.ts:2262-2266,2313-2318` ("Falls back to 202 JSON + separate GET stream"). [page]
- The 202 is held until the request is accepted: its record is written, discoverable, and the job is enqueued. A store-write or enqueue failure fails the POST instead. `eng/routes/action-routes.ts:260-270`; `eng/transports/host/createInboundTransportHost.ts:1312-1318`; `eng/transports/runner.ts:110-119` (`RunnerHandle.accepted`, "registered and discoverable"). [page: "the 202 means the job is on the queue"]
- `session.sendAction` resolves with `{ status: "in_progress", request: { id, ... } }` once the 202 arrives and the stream is attached; it does not wait for the job. `rx/hooks/useSession.ts:2313-2323`. [page]
- From code outside React, `flow.send(action, input, { sessionId })` resolves to a `SentRequest`: the handle plus `response`, the server's 202 body. `.stream(callbacks)` follows events, `.wait({ pollMs, timeoutMs, signal })` resolves with the settled status, and `.result()` with `{ status, output?, error? }`. `cl/client.ts:307-405` (`RequestHandle`, `RequestResult`), `:861-889`. `createClient({ userId, baseUrl })`: `cl/client.ts:602`; `docs-revamp/pages/build/live-updates.md:20-22` shows the same call. [page: one sentence or one short example; `buildReport` has no required `sessionId`]
- A request has one of seven statuses: `in_progress`, `completed`, `incomplete`, `failed`, `interrupted`, `aborted`, `suspended`. `con/types/request-status.ts:11-18`. A queued request that nothing has taken, one being processed, and one waiting for its concurrency turn all read `in_progress`. **[verify]** that no `queued` status is exposed: none is in the union above. [ref]

## 6. Watch it (the answer to Q2)

- The request is discoverable from the moment it is accepted. Before the job is claimed, `GET /api/flows/:flowKind/requests/:requestId/stream` finds the in-progress record and opens a stream that waits for the first event; a request id that never existed answers 404. `eng/routes/action-routes.ts:260-263`; tests `et/stream-routes-external-dispatch.test.ts:81-122,167-178`; `gbj:108`; `rd:199` (Stream bridge section). [page; **answers Q2**]
- The stream is read from the shared store, not from Redis: "Live tail is store-driven: `store.request.subscribeToEvents` yields catch-up + live events for in-flight requests, regardless of which instance is hosting the runner." `eng/routes/stream-routes.ts:5-8,156-196`. The processing process writes the request's events to the stores as it runs and the web process tails them from there. `gbj:106`. [page]
- So a client that attaches late, or reconnects, picks up where it left off: the stream accepts the standard `Last-Event-ID` header or a `starting_after` query parameter and replays from there. `eng/routes/stream-routes.ts:172-175`; `gbj:110`. Sequence numbers stay stable across a retry (section 4). The client does this on its own: the stream client resumes after the last event it delivered and gives up with `onError` after five connections in a row deliver nothing. `cl/client.ts:399-405` (`RequestHandle.stream` doc). [page: "reconnect and replay need no code"]
- What a `useSession` page sees meanwhile: `session.isStreaming` is true while the stream is attached; `session.items` fills as the job's items arrive; `session.latestRequest` carries the newest request and its status; `session.statusMessage` carries the latest `ctx.emit.status()` of the in-flight request; `session.error` is set on a transport failure. `rx/hooks/useSession.ts:339,356-360,367`; the page's `ItemsRenderer items={session.items}` pattern is `docs-revamp/pages/start/add-to-an-existing-app.md:100-125`. [page]
- A page that is not the one that sent the request, a second tab, another person on the same session, sees it with `useSession(sessionId, { live: true })`: the doc comment says it makes the view hear requests it did not send. `rx/hooks/useSession.ts:272-297` (cited from `human-in-the-loop.facts.md` item 5; not re-read here). [ref / link to the Live updates page]
- The Redis stream bridge carries live events from the processing process to the process that dispatched the job, and the abort signal back. It is best effort: a subscriber keeps no event for a reader that has not asked, and "late/reconnecting clients recover from the store". `bmq/stream-bridge.ts:1-10,36-45`; tests `bt/stream-bridge.redis.test.ts:21-62`. The browser's stream does not read it. The dispatch side subscribes before it enqueues so a fast job's terminal is not missed: `bmq/runner.ts:423-424`. [ref; page: nothing, or "Redis also carries live events between the processes, best effort"]
- If the processing process's final message never arrives, the dispatching process settles when the job itself ends, checking its state in BullMQ every ten seconds (`DEFAULT_LEASE_MS`). `bmq/runner.ts:380-386,468-471,489-539`; tests `bt/runner.test.ts:82-179`. [ref]
- The Bull Board console (a queue dashboard) reads `bullmq.queue`; the kitchen-sink mounts it at `/api/admin/queues` when `REDIS_URL` is set. `apps/kitchen-sink/lib/bull-board.ts:1-23`; `apps/kitchen-sink/README.md:353-354` (`REDIS_URL` sets up the adapter; `FSD_BULLMQ_DISPATCH=1` installs it as the app's `jobQueue`; `apps/kitchen-sink/fsdev.config.ts:82,229`). [ref]

## 7. The four questions, for each stored part

The page's job is "what runs the job" and "what the page sees", so it states the first and last rows briefly; the rest is Reference.

| Part | Owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| The job | the request it carries (same `userId`, `orgId`, session) | the operator, through the queue (`bullmq.queue`, Bull Board); the user never reads a job | Redis, queue `fsd-flows`, keys under prefix `fsd` | one per queued action call; retries reuse the job; a job waiting for its concurrency turn is the same job, requeued as delayed |
| The request record and its events | the user who sent it, in one organization and tenant | its owner, through the stream, the status call and the session; the DevTool | the app's `stores`, which every process must reach | one per request; its events are numbered in order |
| The live-event channel | the request | the process that dispatched the job | Redis pub/sub, channels `fsd:stream:<requestId>` and `fsd:stream:abort:<requestId>`; not stored | one pair per request, open while the dispatch waits |
| The dead-letter job | the failed request's job data | the operator | Redis, queue `<queueName>-dlq` (`fsd-flows-dlq`), only when `deadLetter` is set | one per job that failed for good |
| The concurrency place | the request | nobody | Redis, under the same prefix | at most one per request on an entry with a `queue`, `reject`, `hold` or `defer` policy |

Facts behind the cells:

- Job owner and payload: `bmq/types.ts:120-154`; `bmq/runner.ts:434-452`. A job is created per `queue.add("flow-run", ...)`: `bmq/runner.ts:434-436`; `bmq/runtime.ts:74`.
- Queue name default `"fsd-flows"` and prefix default `"fsd"`: `bmq/runtime.ts:38,48`; `bmq/job-processor.ts:88`; `bmq/connection.ts:12`.
- Completed jobs are removed after an hour or 1,000 jobs, failed jobs after a day, unless `retry` changes it: `bmq/retry.ts:207-209`. **[verify]** how BullMQ combines `age` and `count`; the page says "removed after an hour" at most and leaves the count to Reference.
- A job's data holds `input`, so Redis holds whatever the action was given until the job is removed: `bmq/types.ts:120-124`. [ref]
- Request record: written at enqueue, `in_progress`, before the job is claimed: tests `et/stream-routes-external-dispatch.test.ts:81-122,124-166`. Read by its owner only: another user, organization or tenant gets the same answer as for an unknown request. `eng/routes/stream-routes.ts:162-172` (a record the instance does not own answers 404); `human-in-the-loop.facts.md` section 0 item 1 (`eng/routes/route-utils.ts:190-211`, `eng/context/request-principal.ts:42-54`; cited from that sheet, not re-read). [page: one clause]
- Channels: `bmq/stream-bridge.ts:40-45` (`${channelPrefix}:${requestId}` and `${channelPrefix}:abort:${requestId}`; default prefix `fsd:stream`, line 28). The processing process opens one publisher connection per job; the dispatching process opens a subscriber with two connections (events and abort) per request: `bmq/stream-bridge.ts:54-57,79-84`; `bmq/runner.ts:385-386`.
- Dead-letter queue: `bmq/retry.ts:238-271`. Nothing in the package consumes it, so a dead-letter job stays until the operator removes it or the queue's retention does. **[verify]** the second half; `dlqQueue.add` passes no `removeOn*` options (`bmq/retry.ts:260`), and I did not run BullMQ to see its default.
- Concurrency place: `bmq/lease-backend.ts:1-40`; `rd:66-82`. [ref]

## 8. Limits the page names

- **A queued app needs one more thing to run: Redis, and stores both processes reach** (section 3). [page]
- **`dispose()` does not wait for jobs waiting in the queue or running in another container.** `rd:107-110`. [ref]
- **A `process-only` process is a poor place to start background work.** `rd:99-105`. [ref]
- **A per-request `RuntimeConfig` does not cross the queue.** `rd:90-96`. [ref]
- **Serverless:** on a platform that stops the function when the response returns, a `colocated` queue consumer stops with it; a separate consumer does not. `c16` sheet row 36 (from `bg:193`, not re-read here). [ref]
- **Not a task board.** A board's tasks wait for a request to work through the board; a queue runs a request. `c16` ("How it fits with the others"). [cut: the page links C-16]

## 9. The figure: *Request, queue, processing*

The sitemap's marks are columns, an arrow, a dashed outline on the request and hatching on the queue. The marks mean, on every page: hatching, "outlives the request"; dashed outline, "lasts one action run" (`docs/contributing/user-docs.md`, "Figures"). The facts the figure needs:

- Three columns, left to right: the web process (the request: `POST .../actions/buildReport`, answered 202), Redis (the job on queue `fsd-flows`), the processing process (runs `buildReport` against the shared stores). Sections 3 and 4.
- The request is the action run's lifetime on the web side and ends at the 202 (the POST returns once the job is enqueued): `eng/routes/action-routes.ts:347-369`. Dashed outline: it lasts one request.
- The queue outlives the request: the job stays in Redis until a processing process takes it, and after a web process stops. Hatching on the queue. `bmq/runner.ts:434-452`; `rd:34`.
- A fourth element the figure may add and the sitemap does not list: the stores, written by the processing process and read by the browser's stream (section 6). If drawn, hatching belongs on it too (it outlives the request); its box is the one both processes must reach (section 3).
- Names: `support`, `buildReport`, `fsd-flows`, `fsd:stream:<requestId>` (the last only if the bridge is drawn; the browser does not read it, section 6).

## 10. Cold-read answer-key candidates

For pass 2; each answer is on this sheet.

1. A user clicks "Build report" and closes the tab. Does `buildReport` stop? (No: the job is in Redis and the processing process writes to the shared stores; section 4.)
2. What does `sendAction("buildReport", ...)` resolve with, and when? (The 202 body, `status: "in_progress"` and a request id, once the job is on the queue; not when it finishes; section 5.)
3. The user reopens the page while the report runs. How does the page show progress? (It reads the request's stream from the store, resumes from the last event, items fill as the job writes them; section 6.)
4. Edge: web and job processing run as two containers, and the processing container is wired to a different database than the web process. What does the user see? (The request stays `in_progress`; nothing errors; section 3.)
5. Edge: nothing is processing jobs at all. What happens to the request? (It waits `in_progress`; unclaimed past `queuedGraceMs`, ten minutes by default, it is marked `interrupted`; section 4.)
6. Edge: `buildReport` throws a network error on the first attempt. What does the browser see? (The stream stays open through the retries, numbered in sequence; on the last failed attempt the request ends `failed`; section 4.)
7. Which `mode` do the web container and the processing container use? (`enqueue-only` and `process-only`; the default `colocated` does both; section 3.)

## 11. Revise round 1: what the page states and what moved

The page is now four steps (install and Redis, give the app a queue, call the action, a processing process) at about 480 words. Corrections folded in:

- `flows` is an array (`flows: [support]`), `fsdev.config.ts` default-exports the `FlowState`, examples use the app layout (`eng/flowstate/types.ts:124`). The `lib/flowstate.ts` path is gone. Kitchen-sink wiring is in `apps/kitchen-sink/fsdev.config.ts:81-98,225-229`, not `lib/flowstate.ts`, and the page no longer cites it.
- `backoff` passed to `retry` replaces the default backoff whole, so omitting `jitter` there means no jitter (`bmq/retry.ts:9-21`: `{ ...DEFAULTS, ...config }` merges one level). The page shows no retry example; the option table moved to Reference. Any Reference row must say the per-field defaults apply only when `backoff` is omitted.
- Unknown flows are `UnrecoverableError` (`bmq/job-processor.ts:329`); no unknown-action path was found, so the page says nothing about unknown actions. The page does not state which failures skip retries (Reference, R-22).
- The page does not claim Vercel's `after()`: nothing in `packages/vercel/src` runs it (`types.ts:37` only mentions it in a doc comment). It states the serverless limit from section 8 instead.
- `fsdev serve` calls `ready()` (section 0, item 4), so the page says the two boot lines are for any other start.
- `QUEUE_MODE` is the page's own variable name; no code reads it.

Moved to Reference (the page links `reference/background-work`, `reference/stores`, `reference/concurrency`, `reference/schedules`), none stated on the page: connection forms, `prefix`, `keyPrefix`; retry table and `<queue>-dlq`; which failures skip retries; `enqueueAction` fields and the instance rule for `flowKind`; draining a queue before a flow becomes a collection and the processing-first rollout (Upgrading page); the 404 for an unknown request id and the unclaimed-request behaviour; HMR dispose; `Last-Event-ID` details; low-level factories; static schedules (a BullMQ deployment wires nothing for them: the app's local cron runs in its job-queue processes too, and a static schedule's fire is enqueued like any action; `createFlowState.ts` `#tick`, `.changeset/app-fires-its-own-schedules.md`); kitchen-sink `REDIS_URL` and `FSD_BULLMQ_DISPATCH`; Bull Board.

## 12. Revise round 2: what the page now states

Two cold-read misses (nothing processing jobs; retry while the client reconnects) were answered only in Reference. The page now has a section "When a job is late or fails" stating both, so section 10 questions 5 and 6 are answerable from the page:

- Nothing processing: the POST answers 202, the request waits `in_progress`, unclaimed past `queuedGraceMs` (default ten minutes, an option of `createFlowState`) it is marked `interrupted`. Sources: section 4 (`eng/routes/createFlowApiRouter.ts:184-198`, `eng/flowstate/types.ts:270-279`).
- Retry while reconnecting: three attempts counting the first, events numbered after the last stored one, client resumes via `Last-Event-ID` or `starting_after` and replays from the store. Sources: sections 4 and 6 (`bmq/retry.ts:203-211`, `bmq/job-processor.ts:341-353`, `eng/routes/stream-routes.ts:172-175`, `cl/client.ts:399-405`).
- The page does not state the final `failed` outcome after the last attempt (section 4, Reference).

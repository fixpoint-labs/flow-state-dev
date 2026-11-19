# @flow-state-dev/node

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

- 5549fd1: FIX-2806: The router refuses browser cross-site mutations (`Sec-Fetch-Site: cross-site` on POST, PUT, PATCH or DELETE) with 403; inbound transport routes are left to their adapters. A Node server bound to loopback refuses requests whose Host header is not a loopback name with 403, which stops DNS rebinding. JSON routes refuse a non-empty body that isn't sent as `content-type: application/json` with 415, so a browser can't skip the CORS preflight with a `text/plain` post. Callers that post a body must send that header; `@flow-state-dev/client` already does.

  Docs: apps/docs/docs/server/setup.md (the two `curl -X POST ... -d` examples under the instance-session section need `-H "content-type: application/json"`; any page showing a `curl -d` or bare `fetch` POST to a flow route must send that header). FIX-2806.

- 1e58902: A session subscribed to a GitHub pull request or repository hears it with no webhook: the app polls, once per user and pull request (or repository), at most every five minutes, through the same screens and delivery as push (FIX-2536).

  - **workforce:** polling is configured once, on the installation: `hireWorkforce(installation, { routines: { poll: { index, everyMinutes? } } })`, with a schedule index of its own (not `routines.index`, which is refused: one index ticks one flow), and `poll: true` on `defineSubscriptionServiceFlow` or `githubServiceFlow`. Every event routine write (the routine verbs, the roster's routine actions, the declared routines' seed, and `followPullRequest({ providers, installation })`) then schedules the user's poll. An event routine takes `everyMinutes` (5, 10, 15, 20, 30 or 60; anything else is refused), the seed included. `SubscriptionProvider` gains an optional `poll`; `githubSubscriptionProvider` implements it on the user's own token, with conditional requests, reading a long list back from its last page to the mark; a poll that couldn't read everything says so in each session. A delivery the host lost lands on a later poll, once; one that can't land is given up after three polls. A declared event routine whose entry left `routines.declared` ends at its next poll. A poll forwards what no ordinary subscription of that user heard to that user's coordinator that follows the same pull request or repository `unmatched`. A declared event routine whose `unmatched` setting changed is rewritten at the next seed.
  - **scheduled:** `runScheduleTick` and `startScheduleTick` (from `/collection`) claim a schedule index's due entries and dispatch each; `scheduleDispatchRequest` builds the dispatch call.
  - **core:** `SchedulesConfig` takes `index`, the schedule index a host ticks for the flow.
  - **node:** `serve()` ticks each minute for every flow whose `schedules.index` is set, dispatching through its own app (`CRON_SECRET` is sent as the bearer when set).
  - **vercel:** `createScheduleTickHandler` runs the shared tick; its behaviour is unchanged.

  Docs: packages/workforce/README.md (polling: `routines.poll`, the service flow's `poll`, `everyMinutes`, the provider's `poll`), packages/scheduled/README.md (`runScheduleTick`, `startScheduleTick`), packages/node/README.md (`serve()` ticks schedule indexes), apps/docs/docs/server/scheduled.md (the tick a long-lived host runs), apps/docs/guides/webhooks-github.md (polling when the app has no public URL)

### Patch Changes

- 44b199d: FIX-2805: Every host now refuses to serve an app that still trusts `body.userId`, on any `NODE_ENV`, including when it is unset. `serve()` throws before listening on a non-loopback host, and a flow registered after that still gets a 500. Lambda, Next, and Vercel do the same on each request. The 500 body is `Internal server error`; the flow kinds are logged once. A loopback bind (`127.0.0.1`, `localhost`) is unchanged. `allowUnauthenticated: true`, and `fsdev serve` / `fsdev dev --allow-unauthenticated`, is the override.

  A network `serve()` initializes stores before the port opens, so `/healthz` is not up during that cold start.

  Docs: packages/node/README.md (the quick start `await serve(flowState)` and `await serve(flowState, { pushSecret })` throw on the default host `0.0.0.0` unless every flow has a resolver or the call passes `host: "127.0.0.1"` or `allowUnauthenticated: true`; the network-bind section should say `serve()` runs the check itself, keeps checking after `register()`, and that Lambda, Next, and Vercel return a generic 500 with the kinds only in the log), apps/docs/docs/server/host-adapters.md (`await serve(flowstate, { basePath: "/flows" })` needs a resolver or a loopback host), apps/docs/docs/configuration/client.md (the `serve(flowstate, { basePath: "/flows" })` comment, same), apps/docs/guides/deployment.md (a hand-written `serve()` runs the same guard as `fsdev serve`), apps/docs/guides/realtime.md (`serve(flowstate, { pushSecret })` needs a resolver or `host: "127.0.0.1"`). `apps/docs/docs/workforce/overview.md` already sets `resolvePrincipal`, so that `serve(flowState, { port: 3000 })` sample keeps working.

- Updated dependencies [04812f3]
- Updated dependencies [61efa05]
- Updated dependencies [ec99b11]
- Updated dependencies [4b4a7d4]
- Updated dependencies [8e111c9]
- Updated dependencies [d30f516]
- Updated dependencies [a27cf26]
- Updated dependencies [77a6c9b]
- Updated dependencies [5e55476]
- Updated dependencies [81b1693]
- Updated dependencies [e3ca793]
- Updated dependencies [e505adf]
- Updated dependencies [5b2bd16]
- Updated dependencies [819c2a5]
- Updated dependencies [fe85f56]
- Updated dependencies [f89e8a5]
- Updated dependencies [4394069]
- Updated dependencies [44b199d]
- Updated dependencies [5549fd1]
- Updated dependencies [cf185b3]
- Updated dependencies [c7ce9ff]
- Updated dependencies [c487501]
- Updated dependencies [1600ca1]
- Updated dependencies [3973e1f]
- Updated dependencies [41dcd7e]
- Updated dependencies [ae56d59]
- Updated dependencies [e238e18]
- Updated dependencies [a63b662]
- Updated dependencies [c049036]
- Updated dependencies [74a7b9d]
- Updated dependencies [b43424c]
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
- Updated dependencies [85ca2a3]
- Updated dependencies [95f3cce]
- Updated dependencies [0454257]
- Updated dependencies [81c145c]
- Updated dependencies [ec1fdf9]
- Updated dependencies [1970b12]
- Updated dependencies [c36ffa0]
- Updated dependencies [23bac7e]
- Updated dependencies [1f46aaf]
- Updated dependencies [b5b52b9]
  - @flow-state-dev/engine@0.6.0

## 0.3.0

### Minor Changes

- 844a4f9: Screens can read again when something they show changes, without polling on the Node host (FIX-2428).

  - **client:** `fsd.subscribe(topics, { onChange, pollIntervalMs? })` calls `onChange` with the notice that woke it (`{ topic, kind, origin? }`), or `null` for a connect, a reconnect or a timer tick. Build topics with `topic.session(id)`, `topic.user()` and `topic.org()`, now exported from the client too. On a host with push, one WebSocket per client carries the notices, signed in through the client's fetcher; elsewhere `onChange(null)` runs every `pollIntervalMs`. `FlowCapabilities` gains `push`. **Breaking:** `fsd.stream()` is removed. It never worked (the server answered 501); use `fsd.subscribe()`. `UserStreamOptions`, `UserSSECallbacks` and `UserStreamHandle` are removed with it. Migration: replace `fsd.stream({ onResourceChanged, onScopeStateChanged, ... })` with `fsd.subscribe([topic.user(), topic.org()], { onChange: () => reread() })`, and read what you show in `onChange`. A notice carries no rows, so the read is what tells you what changed.
  - **react:** `useSubscription(topics, read, { pollIntervalMs?, enabled? })` runs a screen's read again on a change, one read in flight and one waiting.
  - **node:** `serve()` serves the change-notice WebSocket at `<basePath>/users/:userId/stream`. New options: `push` (default `true`) and `pushSecret` (default `FSD_PUSH_SECRET`, then a random key), which every process behind one address must share.
  - **engine:** `GET /capabilities` answers `{ userStream: false, push }`. `POST /users/:userId/stream` checks each topic with its scope's read check and answers a short ticket for the granted ones; a refused topic is left out, as a missing session is. `GET /users/:userId/stream` answers 426 instead of 501. `enablePushDelivery(router, { secret? })` turns push on for a host that serves the socket.
  - **contracts / core:** the push wire types (`PushCapability`, `PushMintAnswer`, `PushServerFrame`, `PushClientFrame`, `WireNotice`). **Breaking:** the user-stream event types `UserStreamEvent`, `UserEventBase`, `UserResourceChangedEvent`, `ResourceContentUpdatedEvent`, `ResourceContentCreatedEvent`, `ResourceContentDeletedEvent`, `ScopeStateChangedEvent`, `UserDebugEvent` and `UserPingEvent` are removed; `StreamEvent` is `RequestStreamEvent`.

### Patch Changes

- Updated dependencies [531bf32]
- Updated dependencies [05a7022]
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

## 0.2.1

### Patch Changes

- Updated dependencies [e0daf6e]
- Updated dependencies [b9e6dd0]
- Updated dependencies [9a355b2]
- Updated dependencies [7d92efe]
- Updated dependencies [387bee2]
- Updated dependencies [6c4a3b3]
  - @flow-state-dev/engine@0.4.0

## 0.2.0

### Minor Changes

- 2ce15c7: Wakes: a debt's due time the engine keeps, one per session and internal entry (FIX-2078). The durability sweeper fires each due wake's entry in its session, as the session's owner, and re-arms on the earliest one; a pass in that session moves or clears it. `StoreRegistry.wakes` (`WakeStore`) is optional: the in-memory, filesystem, SQLite and Postgres stores keep wakes, and a custom store without them still loads, with debts paid on their fast paths only (the host says so once at start). `createFlowState({ maxDebtAgeMs })` sets how long a debt may stay outstanding past its due time, 24 hours by default. A host's shutdown waits for the requests its wakes started, up to `createFlowApiRouter({ shutdownDrainMs })` (10 s by default; `disposeFlowApiRouter(router, { drainMs })` per call), then aborts the rest and logs how many: each wake stays, and the next host fires it again. `@flow-state-dev/node`'s `serve()` passes what is left of its shutdown grace, through the server app's `dispose({ drainMs })`. At start the host reads its wake store once: one it can't read (a database upgraded without the migration that adds the wakes table) is treated as keeping none, with a one-time warning. **A Postgres or SQLite host that runs its migrations itself (`skipSchemaInit`) reruns them after upgrading**, or its wakes stay off. Custom store adapters can check theirs with `createWakeStoreConformanceTests` from `@flow-state-dev/engine/testing`.

### Patch Changes

- 698e06b: New `apiPath` option on every client constructor and on `FlowProvider` names where the server mounts the flow API (default `/api/flows`), so the client and React hooks can reach a Node server started with a custom `basePath`. Requests go to `baseUrl` + `apiPath` + route; with `apiPath` unset, every URL is unchanged. The `@flow-state-dev/node` README documents pairing `basePath` with `apiPath` (FIX-1677).
- 7da156e: Organization ids are now validated as well-formed, non-blank Unicode everywhere (resolver, `runAction`, dispatch, BullMQ jobs, schedules, `fsdev run --org`) and seat addresses escape any such id, while route segments are decoded exactly once on every host (`parseFlowRoute` now takes decoded segments, built from a raw URL by the new `decodePathSegments`), so escaped seat ids resolve on Next and Vercel and stored rows or queued jobs with a lone-surrogate org id are now refused (FIX-1757).
- 7f892f6: `serve()` gains `pageMeta`, extra `<meta>` tags written into every HTML page served from `staticDir`, and `pageHandler`, a Connect-style handler for non-API GET requests tried before the SPA fallback; `createPageHtmlTransform` applies the same HTML writing to a page a handler renders itself; and `disposeOnClose: false` lets several servers share one runtime that the caller disposes once (FIX-1770).
- 83c48a7: `serve()` and `createPageHtmlTransform` gain `pageScript`, an inline script written into every HTML page after the `pageMeta` tags (FIX-1770).
- Updated dependencies [92b2b70]
- Updated dependencies [5d31955]
- Updated dependencies [15f7c6b]
- Updated dependencies [24afa6e]
- Updated dependencies [f8df86f]
- Updated dependencies [e2c190e]
- Updated dependencies [8e67ce5]
- Updated dependencies [920adc3]
- Updated dependencies [283fb2a]
- Updated dependencies [3221d05]
- Updated dependencies [f97b0ed]
- Updated dependencies [397cfa7]
- Updated dependencies [9f06d39]
- Updated dependencies [452b702]
- Updated dependencies [e4fb1f1]
- Updated dependencies [538cd1a]
- Updated dependencies [585b75b]
- Updated dependencies [3b5266a]
- Updated dependencies [2ffc03c]
- Updated dependencies [b75c1ed]
- Updated dependencies [25ac53a]
- Updated dependencies [6453d2c]
- Updated dependencies [62133c4]
- Updated dependencies [f282bcb]
- Updated dependencies [651c87e]
- Updated dependencies [d5ce1e0]
- Updated dependencies [55c62a6]
- Updated dependencies [85b2965]
- Updated dependencies [1355483]
- Updated dependencies [6819520]
- Updated dependencies [099906a]
- Updated dependencies [ad5df6f]
- Updated dependencies [5902deb]
- Updated dependencies [2ce15c7]
- Updated dependencies [4f2e13e]
- Updated dependencies [211679a]
- Updated dependencies [5181ddb]
- Updated dependencies [60d1bf4]
- Updated dependencies [42bfbe6]
- Updated dependencies [fe5df7d]
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
- Updated dependencies [3a6c910]
- Updated dependencies [2d2518b]
- Updated dependencies [c57890d]
- Updated dependencies [3cbab3a]
- Updated dependencies [028af6f]
- Updated dependencies [a965a50]
- Updated dependencies [41638f3]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [a64132b]
- Updated dependencies [0abbcd9]
- Updated dependencies [d9d00a4]
- Updated dependencies [c6b2db9]
- Updated dependencies [839e915]
- Updated dependencies [711ed0e]
- Updated dependencies [72c5b17]
- Updated dependencies [02ee032]
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
- Updated dependencies [1cfd80c]
- Updated dependencies [229de7a]
- Updated dependencies [4ca0e99]
- Updated dependencies [3b0161c]
- Updated dependencies [d86c7db]
- Updated dependencies [fa7b22e]
- Updated dependencies [a4e626b]
- Updated dependencies [83cd9c2]
- Updated dependencies [7c9e932]
- Updated dependencies [637b6d5]
- Updated dependencies [60c8192]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [71b0174]
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
- Updated dependencies [c8c8b38]
- Updated dependencies [1f2dadd]
- Updated dependencies [cd180d7]
- Updated dependencies [6306a75]
- Updated dependencies [e11764a]
- Updated dependencies [2c43888]
- Updated dependencies [9af8ce5]
- Updated dependencies [6e1a819]
- Updated dependencies [0d6278e]
- Updated dependencies [a26e426]
- Updated dependencies [69ba29c]
- Updated dependencies [d97031f]
- Updated dependencies [f741004]
- Updated dependencies [49d2aca]
- Updated dependencies [3c10d9d]
- Updated dependencies [ce8f765]
- Updated dependencies [96ff077]
  - @flow-state-dev/engine@0.3.0

## 0.1.3

### Patch Changes

- Updated dependencies [795b550]
- Updated dependencies [6b8bfe4]
- Updated dependencies [3e43c96]
- Updated dependencies [b48158a]
- Updated dependencies [e4c443e]
- Updated dependencies [e4b6576]
  - @flow-state-dev/engine@0.2.0

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/engine@0.1.2

## 0.1.1

### Patch Changes

- @flow-state-dev/engine@0.1.1

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

### Patch Changes

- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [e2fda9d]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [af40427]
- Updated dependencies [5fa52aa]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/engine@0.1.0

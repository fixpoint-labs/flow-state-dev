# @flow-state-dev/vercel

## 0.3.0

### Minor Changes

- 61efa05: The app fires its own schedules (FIX-2752). One tick in the engine fires every schedule of every flow, static and dynamic, once per scheduled time. A long-lived server or `fsdev dev` needs no outside cron, several servers on one store tick from one process, and a serverless host adds one route. The five old ways to fire a schedule are removed, with no aliases.

  - **engine:** `createFlowState` takes `scheduler`. Omitted, a built-in local cron ticks each minute in a process that serves the app (`ready()`, `getRouter()`, `serve()`, `fsdev dev`) or works a job queue, never in `fsdev run`, `fsdev chat` or `fsdev block`, and only when a flow declares a static schedule or a schedule index. It ticks only while it holds a lease in `stores.leases`, so one process ticks across servers that share a SQLite or Postgres store; if that process dies, another takes over within three minutes. In production on in-memory or filesystem stores it warns at start: run one server, or use SQLite or Postgres. `scheduler: false` fires nothing; a `SchedulerAdapter` (from `@flow-state-dev/engine/host`, with `ScheduleTicker` and `ScheduleTickReport`) decides when the tick runs. After downtime each schedule fires once, late, for the latest time it missed; earlier missed times are dropped. On Vercel with the local default, startup warns to pass `vercelScheduler()`.
  - **vercel:** `vercelScheduler({ secret? })` is the scheduler for Vercel: pass it as `scheduler` and export its `route` as the `GET` of one route that one Vercel Cron entry calls (`CRON_SECRET` by default; an empty secret refuses every call). Each call fires every due schedule of every flow, each as its own request to the deployment the call reached, and answers 500 when a schedule index fails so the next beat retries. `createGetToPostCronShim` and `createScheduleTickHandler` are removed, with the `@flow-state-dev/vercel/schedules` entry: replace each per-schedule cron entry and route, and each per-flow tick route, with the one route. A once-a-minute beat needs Vercel Pro; a daily beat (Hobby) fires each schedule once a day, late.
  - **bullmq:** `registerStaticSchedules`, `createScheduleDispatchProcessor` and `createBullmqScheduleIndex` are removed, with the `@flow-state-dev/bullmq/schedules` entry. A BullMQ deployment wires nothing for schedules: the local cron runs in its job-queue processes too, elected by the shared store's lease. A static schedule's fire is enqueued like any action, with the queue's retries; a dynamic schedule's fire runs in the process that ticked, since its block can't ride a job, so it has no queue retries and a crash mid-run loses it. Dynamic schedules use the SQLite or Postgres schedule index. The pending rename of `createScheduleDispatchWorker` to `createScheduleDispatchProcessor` in this release ends in this removal.
  - **node:** `serveScheduleTicks` is removed. `serve()` no longer ticks schedule indexes itself; the app's local cron fires static and dynamic schedules alike.
  - **scheduled:** `runScheduleTick`, `startScheduleTick` and `scheduleDispatchRequest` are removed from `@flow-state-dev/scheduled/collection` (the tick is the engine's), and `formatScheduleId` from the package root (it is core's). The pending note that added the first three in this release is superseded by this removal.
  - **core:** `formatScheduleId(orgId, userId, key)` is exported from `@flow-state-dev/core`. `ScheduleDueEntry` names `cron` and `timezone`, so a custom schedule index returns the cron and zone each row already carries.

  Docs: apps/docs/docs/server/scheduled.md (rewritten: the app fires its own schedules; the local cron, the lease, and what one server on in-memory or filesystem stores means; after downtime, once late for the latest missed time; the Vercel route; `scheduler: false`), apps/docs/docs/server/schedule-index.md (drop the "bring a cron" section; the tick claims the index), apps/docs/guides/scheduled-vercel-cron.md (the one-route walkthrough with `vercelScheduler()`, one cron entry, the Pro and Hobby beats), apps/docs/guides/scheduled-dynamic.md (no tick handler; the app's tick claims the index), apps/docs/guides/background-jobs-bullmq.md (drop the schedule wiring), apps/docs/guides/keeping-a-flow-running.md (drop the outside-cron mention), packages/vercel/README.md (`vercelScheduler` replaces the `./schedules` helpers), packages/bullmq/README.md (drop the `./schedules` section and `createBullmqScheduleIndex`), packages/scheduled/README.md (the tick is the engine's; no `runScheduleTick` or `startScheduleTick`), packages/node/README.md (`serve()` no longer ticks indexes itself), packages/engine/README.md (the `scheduler` option, `SchedulerAdapter`, `ScheduleTicker`), packages/core/README.md (`formatScheduleId`; `ScheduleDueEntry`'s `cron` and `timezone`).

- 0454257: **Breaking:** `vercelPostgresStores()` no longer lists `scheduler` in its `capabilities`, which are now `["primary", "bus"]` (FIX-2452). The `scheduler` profile slot is gone from engine; the adapter's `scheduleIndex` is unchanged and is still how scheduled flows reach the index. A profile that wired this adapter into `scheduler:` fails to compile: delete that line.

  Docs: FIX-2452. packages/vercel/README.md: drop `scheduler` from the adapter's capabilities and any `scheduler:` profile line; show `stores: vercelPostgresStores()` as the bare form.

### Patch Changes

- ec99b11: A file attached to a message is uploaded once and travels by reference. Its bytes stay out of session reads and survive a restart wherever the sessions do (FIX-824).

  - **engine:** `POST /api/flows/blobs` takes one file as the raw request body. `POST /api/flows/<flow>/blobs` does the same under that flow's own sign-in: use it when a flow sets `authentication.resolvePrincipal`, so the file is held for the user its sends resolve. The `content-type` header is the file's type, and the `filename` query parameter is its name. It answers 201 `{ attachment }`, a `FileContent` whose `data` is a reference (`fsd-blob:<id>`), not the bytes. It refuses an unsupported type (415 `attachment_type_refused`), a file over the limit (413 `attachment_too_large`), an empty body (400 `attachment_empty`) and an app with nowhere to keep files (501 `attachments_not_configured`).
  - **engine:** an action request takes `attachments: FileContent[]` beside `input`. Each listed file moves from its uploader to the session the message is sent into. A file that is not the caller's or is gone answers 404 `attachment_not_found`, a file another session already holds answers 409 `attachment_already_sent`, and attachments with no session id answer 400 `attachments_need_session`. A refused send hands its files back to their uploader, except a file another send into the same session still relies on or was admitted with.
  - **engine:** `GET /api/flows/blobs/:blobId` returns the file's bytes to a caller who can read the session that holds it. Anyone else, and a file no session holds yet, gets 404 `attachment_not_found`. Deleting a session deletes its files. A file no message claims is deleted after 24 hours.
  - **engine:** files are kept where the sessions are. When the active profile's stores persist (SQLite, Postgres), files go to `.fsdev/blobs/<profile>` under the working directory. `filesystemStores({ rootDir })` keeps them under `<rootDir>/blobs`. Memory stores keep them in memory. A profile's `blobs` slot overrides this; `localBlobStores({ rootDir })` is a store adapter that keeps files on local disk. A database backup does not include the file bytes, so back up the blob folder too.
  - **vercel:** a function's disk does not last between requests, so an upload to a blob store that keeps files on the local disk is refused with 501 `attachments_unavailable`. Configure a hosted `blobs` slot to accept attachments there.
  - **client:** `client.upload({ data, mediaType?, filename? })` uploads one file and resolves to its `FileContent` reference. `client.flow(address).upload(...)` uploads through that flow's route. Send that reference, not the bytes.
  - **contracts / core:** a new `./attachments` subpath (`@flow-state-dev/core/attachments`) carries `ATTACHMENT_LIMITS` (10 images and 5 documents per message, 20 MB per file), the accepted types (PNG, JPEG, WebP, GIF, PDF), and `toBlobRef` / `parseBlobRef` / `isBlobId` for the reference form.

  Docs: packages/engine/README.md (the upload and read routes, `attachments` beside `input` and its refusals, where files are kept by default, the `blobs` slot and `localBlobStores` with `LocalBlobStoreOptions`, the backup note), packages/client/README.md (`client.upload` and `client.flow(address).upload`), packages/vercel/README.md (the 501 for a local blob store), packages/core/README.md (the `./attachments` subpath and its limits), packages/contracts/README.md (the limits set), apps/docs/docs/persistence/overview.md (a new section "Attachments: where the bytes live": the default, the durability rule, a serverless deploy needs a hosted adapter, a database backup misses the bytes on disk; drop the line that calls `blobs` forward-compatible), apps/docs/docs/configuration/runtime.md (the `blobs` slot row and the "forward-compatible" paragraph: `blobs` now resolves a blob store)

- 44b199d: FIX-2805: Every host now refuses to serve an app that still trusts `body.userId`, on any `NODE_ENV`, including when it is unset. `serve()` throws before listening on a non-loopback host, and a flow registered after that still gets a 500. Lambda, Next, and Vercel do the same on each request. The 500 body is `Internal server error`; the flow kinds are logged once. A loopback bind (`127.0.0.1`, `localhost`) is unchanged. `allowUnauthenticated: true`, and `fsdev serve` / `fsdev dev --allow-unauthenticated`, is the override.

  A network `serve()` initializes stores before the port opens, so `/healthz` is not up during that cold start.

  Docs: packages/node/README.md (the quick start `await serve(flowState)` and `await serve(flowState, { pushSecret })` throw on the default host `0.0.0.0` unless every flow has a resolver or the call passes `host: "127.0.0.1"` or `allowUnauthenticated: true`; the network-bind section should say `serve()` runs the check itself, keeps checking after `register()`, and that Lambda, Next, and Vercel return a generic 500 with the kinds only in the log), apps/docs/docs/server/host-adapters.md (`await serve(flowstate, { basePath: "/flows" })` needs a resolver or a loopback host), apps/docs/docs/configuration/client.md (the `serve(flowstate, { basePath: "/flows" })` comment, same), apps/docs/guides/deployment.md (a hand-written `serve()` runs the same guard as `fsdev serve`), apps/docs/guides/realtime.md (`serve(flowstate, { pushSecret })` needs a resolver or `host: "127.0.0.1"`). `apps/docs/docs/workforce/overview.md` already sets `resolvePrincipal`, so that `serve(flowState, { port: 3000 })` sample keeps working.

- 3ef3979: **Breaking:** package scaffolding leaves the roots, and names another package declares are re-exported, not copied (FIX-2449). No deprecated aliases.

  - **react:** `reactPackageMarker`, `coreItemImportProof`, `CoreItemImportProof` and `CoreTypeImportProof` are removed. `RosterWorker` is no longer exported from `@flow-state-dev/react/workforce`; workforce's type of that name is unchanged. `FlowCardinality` is now core's type, re-exported, with the same two values.
  - **testing:** `testingPackageMarker` is removed.
  - **vercel:** `FlowApiRouter` is now engine's type, re-exported; its shape is unchanged.

- 1e58902: A session subscribed to a GitHub pull request or repository hears it with no webhook: the app polls, once per user and pull request (or repository), at most every five minutes, through the same screens and delivery as push (FIX-2536).

  - **workforce:** polling is configured once, on the installation: `hireWorkforce(installation, { routines: { poll: { index, everyMinutes? } } })`, with a schedule index of its own (not `routines.index`, which is refused: one index ticks one flow), and `poll: true` on `defineSubscriptionServiceFlow` or `githubServiceFlow`. Every event routine write (the routine verbs, the roster's routine actions, the declared routines' seed, and `followPullRequest({ providers, installation })`) then schedules the user's poll. An event routine takes `everyMinutes` (5, 10, 15, 20, 30 or 60; anything else is refused), the seed included. `SubscriptionProvider` gains an optional `poll`; `githubSubscriptionProvider` implements it on the user's own token, with conditional requests, reading a long list back from its last page to the mark; a poll that couldn't read everything says so in each session. A delivery the host lost lands on a later poll, once; one that can't land is given up after three polls. A declared event routine whose entry left `routines.declared` ends at its next poll. A poll forwards what no ordinary subscription of that user heard to that user's coordinator that follows the same pull request or repository `unmatched`. A declared event routine whose `unmatched` setting changed is rewritten at the next seed.
  - **scheduled:** `runScheduleTick` and `startScheduleTick` (from `/collection`) claim a schedule index's due entries and dispatch each; `scheduleDispatchRequest` builds the dispatch call.
  - **core:** `SchedulesConfig` takes `index`, the schedule index a host ticks for the flow.
  - **node:** `serve()` ticks each minute for every flow whose `schedules.index` is set, dispatching through its own app (`CRON_SECRET` is sent as the bearer when set).
  - **vercel:** `createScheduleTickHandler` runs the shared tick; its behaviour is unchanged.

  Docs: packages/workforce/README.md (polling: `routines.poll`, the service flow's `poll`, `everyMinutes`, the provider's `poll`), packages/scheduled/README.md (`runScheduleTick`, `startScheduleTick`), packages/node/README.md (`serve()` ticks schedule indexes), apps/docs/docs/server/scheduled.md (the tick a long-lived host runs), apps/docs/guides/webhooks-github.md (polling when the app has no public URL)

- 5174854: The Vercel handler refuses uploads to an on-host blob store only when it runs on Vercel; served by `next dev` or `next start` on a machine, a local blob store takes attachments (FIX-2521).
- Updated dependencies [091a1dd]
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
- Updated dependencies [8dfcb2e]
- Updated dependencies [091078d]
- Updated dependencies [f89e8a5]
- Updated dependencies [4394069]
- Updated dependencies [21d31bc]
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
- Updated dependencies [182fb96]
- Updated dependencies [3ef3979]
- Updated dependencies [42980e4]
- Updated dependencies [f9daf5a]
- Updated dependencies [de09b77]
- Updated dependencies [2e7c92f]
- Updated dependencies [c82adfa]
- Updated dependencies [aa45e92]
- Updated dependencies [8ccec52]
- Updated dependencies [546603f]
- Updated dependencies [4a6643c]
- Updated dependencies [18adad9]
- Updated dependencies [246f0ba]
- Updated dependencies [4698256]
- Updated dependencies [85ca2a3]
- Updated dependencies [91184e2]
- Updated dependencies [95f3cce]
- Updated dependencies [0454257]
- Updated dependencies [1e58902]
- Updated dependencies [81c145c]
- Updated dependencies [ec1fdf9]
- Updated dependencies [1970b12]
- Updated dependencies [c36ffa0]
- Updated dependencies [23bac7e]
- Updated dependencies [1f46aaf]
- Updated dependencies [b5b52b9]
- Updated dependencies [ee91375]
  - @flow-state-dev/scheduled@0.4.0
  - @flow-state-dev/engine@0.6.0
  - @flow-state-dev/store-postgres@0.5.0

## 0.2.2

### Patch Changes

- af95477: `vercelPostgresStores()` now backs the `bus` slot with the stores' Postgres bus. It has no tail pool, so it reports `crossesProcesses: false` and open session views across a deployment's instances keep their once-a-second read. A profile left without a bus would otherwise run the in-memory bus, which now reports that it crosses, since it is meant for an app that runs as one process. Each write also sends its change notice through `pg_notify` on the stores' pool (FIX-2545).
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
  - @flow-state-dev/store-postgres@0.4.0
  - @flow-state-dev/scheduled@0.3.2

## 0.2.1

### Patch Changes

- Updated dependencies [e0daf6e]
- Updated dependencies [b9e6dd0]
- Updated dependencies [9a355b2]
- Updated dependencies [7d92efe]
- Updated dependencies [387bee2]
- Updated dependencies [6c4a3b3]
  - @flow-state-dev/engine@0.4.0
  - @flow-state-dev/scheduled@0.3.1
  - @flow-state-dev/store-postgres@0.3.1

## 0.2.0

### Minor Changes

- 8195995: Schedule index rows are now identified by the storage cell the schedule lives in plus its key, so a person's same-named schedules in two hired seats (or a seat and their app-wide flow) are two rows and turning one off no longer stops the other (FIX-1546). `ScheduleIndexRow` gains a required `cell`, `ScheduleIndex.remove` takes `{ cell, key }` instead of `(userId, key)`, and `CollectionHookContext` gains `cell`, the storage key the instance is persisted under. A custom `ScheduleIndex` must key its storage on `(cell, key)` and store `cell`; the conformance suite covers it. The SQLite and Postgres `schedule_index` tables are re-keyed on `(cell, key)` automatically at schema init, adopting every existing row as its person's own cell; with `skipSchemaInit: true`, apply the upgrade SQL in the schedule index reference. BullMQ scheduler ids are built from the cell and key; an app-wide schedule for an ordinary user id keeps its existing scheduler id.
- 69ba29c: Every flow now keeps a user's data per organization, so `resolveUserStorageKey(userId, orgId, flow)` takes the organization and throws without one, a dynamic schedule's dispatch id is `<orgId>/<userId>/<key>` (built by the new `formatScheduleId`), and the test harness seeds user data in the run's organization (FIX-1790).

### Patch Changes

- 7da156e: Organization ids are now validated as well-formed, non-blank Unicode everywhere (resolver, `runAction`, dispatch, BullMQ jobs, schedules, `fsdev run --org`) and seat addresses escape any such id, while route segments are decoded exactly once on every host (`parseFlowRoute` now takes decoded segments, built from a raw URL by the new `decodePathSegments`), so escaped seat ids resolve on Next and Vercel and stored rows or queued jobs with a lone-surrogate org id are now refused (FIX-1757).
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
- Updated dependencies [eb831f8]
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
  - @flow-state-dev/store-postgres@0.3.0
  - @flow-state-dev/scheduled@0.3.0

## 0.1.3

### Patch Changes

- Updated dependencies [795b550]
- Updated dependencies [6b8bfe4]
- Updated dependencies [3e43c96]
- Updated dependencies [b48158a]
- Updated dependencies [e4c443e]
- Updated dependencies [e4b6576]
  - @flow-state-dev/engine@0.2.0
  - @flow-state-dev/scheduled@0.2.0
  - @flow-state-dev/store-postgres@0.2.0

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/engine@0.1.2
  - @flow-state-dev/scheduled@0.1.2
  - @flow-state-dev/store-postgres@0.1.2

## 0.1.1

### Patch Changes

- @flow-state-dev/engine@0.1.1
- @flow-state-dev/scheduled@0.1.1
- @flow-state-dev/store-postgres@0.1.1

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
  - @flow-state-dev/store-postgres@0.1.0
  - @flow-state-dev/scheduled@0.1.0

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-17 — Bash tool: working bash on Vercel without operator setup (FIX-587)

The Vercel sandbox adapter's `enrichVercelError` now recognizes `VercelOidcContextError` and `LocalOidcContextError` (thrown before any HTTP call when no OIDC token is available) and wraps every adapter method, not just `Sandbox.create()` / `get()`. Default `destination` is now `/vercel/sandbox/workspace` (the only writable home under the Vercel Sandbox runtime user). New "Using the bash tool on Vercel" deployment guide.

### 2026-05-11 — Scheduled actions: schedule index (FIX-581)

`@flow-state-dev/vercel/schedules` ships `createGetToPostCronShim` and `createScheduleTickHandler`. Vercel hosts no longer need to hand-roll the GET-to-POST adapter or the polling tick; both helpers authenticate with constant-time bearer comparison and forward the same secret to the dispatch endpoint.

### 2026-05-10 — Scheduled actions: declarative cron (FIX-440)

Vercel Cron integration guide ships alongside the new `@flow-state-dev/scheduled` package and the framework's `defineFlow({ schedules })` block.

### 2026-05-07 — Live tail on Vercel + Neon

The Vercel deployment example explicitly passes `liveTailPool: null` to force the polling fallback. Polling is correct for serverless deployments where listener sessions don't survive function recycles, and the ~250ms tail latency is invisible behind model generation. Local-with-Postgres deployments keep LISTEN/NOTIFY.

### 2026-04-30 — Connection resilience (FIX-476)

Vercel adapter no longer injects heartbeats itself — the core handles it. `VercelHandlerOptions.heartbeatMs` is now a deprecated no-op; configure via `createFlowApiRouter({ defaultSseHeartbeatMs })` or per-flow `defineFlow({ request: { sseHeartbeatMs } })` instead.

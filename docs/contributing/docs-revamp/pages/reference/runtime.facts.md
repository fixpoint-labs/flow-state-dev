# Fact sheet: Runtime configuration (R-12, reference, `reference/runtime`)

Pass 1. Cites only: existing user docs (`apps/docs/**`, package READMEs), the exported surface and its doc
comments, tests, `goals/`, and the examples under `examples/` and `labs/`. No spec was read. The rows other
pages' depth passes moved here (the `→ R-12` rows in the `*.record.md` files) are checked in section 20; every
one is carried, carried corrected, or named as dropped.

Terms: the unit an app installs is a **kit** (decision relayed with this task: kits stay, there is no plugin
rename). The sheet and the page say "kit" and "slot".

**[impl]** marks a behaviour I could confirm only in a non-exported function body. Pass 5 should confirm it by a
test or a run before the page states it. **[run]** marks a behaviour I ran myself in this pass (probe scripts in
the session scratchpad, run with `tsx` against `packages/engine/src`). **[doc]** marks a claim that rests on an
existing user doc only.

Source abbreviations (all under `/home/user/flow-state-dev/`):

| Abbr | File |
|---|---|
| `fst` | `packages/engine/src/flowstate/types.ts` (the exported `CreateFlowStateOptions`, `FlowState`, `JobQueueAdapter`, `SchedulerAdapter`) |
| `cfs` | `packages/engine/src/flowstate/createFlowState.ts` |
| `kit` | `packages/engine/src/flowstate/kits.ts` |
| `rs` | `packages/engine/src/flowstate/resolve-slots.ts` |
| `rc` | `packages/engine/src/runtime-config.ts` |
| `sa` | `packages/engine/src/stores/store-adapter.ts` |
| `si` | `packages/engine/src/stores/index.ts` |
| `dd` | `packages/engine/src/durability/default-durability.ts` |
| `dsw` | `packages/engine/src/durability/durability-sweeper.ts` |
| `wc` | `packages/engine/src/durability/wait-chain.ts` |
| `fr` | `packages/engine/src/routes/createFlowApiRouter.ts` |
| `hh` | `packages/engine/src/routes/http-handlers.ts` |
| `ipf` | `packages/engine/src/routes/in-process-fetch.ts` |
| `pr` | `packages/engine/src/routes/public-reentry.ts` |
| `dbr` | `packages/engine/src/routes/debug-routes.ts` |
| `na` | `packages/engine/src/routes/network-auth.ts` |
| `ec` | `packages/engine/src/errors/error-capture.ts` |
| `reg` | `packages/engine/src/registry/flow-registry.ts`, `errors.ts` (`regerr`) |
| `ra` | `packages/engine/src/execution/runAction.ts`; `ssw` = `execution/stale-request-sweeper.ts`; `ls` = `execution/local-scheduler.ts` |
| `rat` | `packages/engine/src/execution/types.ts` (`RunActionOptions`) |
| `pd` | `packages/engine/src/push/push-delivery.ts` |
| `eh` / `ei` | `packages/engine/src/host.ts` / `index.ts` |
| `nsv` / `nap` / `nlam` / `nbg` / `npg` | `packages/node/src/serve.ts` / `app.ts` / `aws-lambda.ts` / `bind-guard.ts` / `page-html.ts` |
| `nx` | `packages/next/src/createNextHandler.ts`; `vn` = `packages/vercel/src/next.ts`; `vh` = `packages/vercel/src/handler.ts`; `vt` = `packages/vercel/src/types.ts` |
| `fsd` | `packages/fsdev/src/` (`lc` load-config.ts, local-store.ts as `local-store.ts`, `dc` devtool-config.ts, `commands/run.ts`, `dev.ts`, `serve.ts`, `chat.ts`) |
| `bmq` | `packages/bullmq/src/index.ts`, `flowstate-adapter.ts` |
| `cmr` | `packages/core/src/models/createModelResolver.ts` |
| `cor` | `packages/core/src/helpers/deprecation.ts`, `once-per-process.ts` |
| `flow` | `packages/core/src/types/flow.ts`; `rh` = `core/src/types/request-host.ts` |
| `t` | tests under `packages/engine/test/flowstate/` and `packages/engine/test/` |
| `rt` | `apps/docs/docs/configuration/runtime.md` (line numbers are the page's) |
| `su` | `apps/docs/docs/server/setup.md`; `ha` = `server/host-adapters.md`; `api` = `api/server.md` |

## 0. What the page is, and who it is for

A lookup page. Its reader has a `createFlowState({ ... })` call open and wants one of: what a field is, its type and
default, whether it is required, what it does at start and at `dispose()`, how the active store profile is chosen,
and when a bad config fails. Round 1 of pass 8 moved hosts, commands and the mechanism sections off the page (see
section 25); this sheet keeps their rows true for the pages that receive them.
`createFlowState` is the one process-level config object; it returns a `FlowState` handle. `fst:149-447`.

The page is not about how the runtime is built. It carries no history of options that were renamed (those are
Upgrading rows).

## 1. Which fields are required

**None.** Every field of `CreateFlowStateOptions` is optional. `flows?`, `kits?` and `stores?` all default. The
options object itself is required (`createFlowState({})` constructs and serves an empty app). `fst:149-447`;
**[run]** `createFlowState({})` returns a handle; `meta` is `{ flowKeys: [], profileKeys: ["default"], declaredSlots:
{ default: ["primary"] } }`.

Existing docs say `flows` and `stores` are required (`rt:40-41`, `su:60`). That is untrue today; see section 20.

What happens with the omissions:

| Omitted | Result | Source |
|---|---|---|
| `flows` | No flows registered by the list. Kits still register theirs at start. | `cfs:414-416`, `:1009-1011` |
| `stores` | In memory, as the `default` profile. Startup says so on stderr; a production process warns. | `fst:201-211`; `cfs:247-251`, `:1024-1042` |
| `models` and `modelResolver` | `createModelResolver()` with no options, built from the environment at start. | `cfs:1044-1046` |

## 2. Every `createFlowState` field

Import: `createFlowState`, `inMemoryStores`, `filesystemStores` from `@flow-state-dev/engine`. The options type
`CreateFlowStateOptions`, the `FlowState` handle's helper types `FlowStateRuntime`, `JobQueueAdapter`,
`SchedulerAdapter`, `DevToolConnectionConfig`, `RuntimeConfig` and `ErrorCaptureHandler` are exported from
`@flow-state-dev/engine/host`; the root exports the type `FlowState` only. `ei:15-30`; `eh:107-117`, `:206-207`.
`isFlowState(value)` is on `/host` too. `eh:107`.

"At start" below means the first `ready()`, `getRouter()` or `getRuntime()` (section 7). "At construction" means the
synchronous `createFlowState(...)` call.

### 2.1 What the app is made of

| Field | Type | Default | What it does | Source |
|---|---|---|---|---|
| `flows` | `readonly FlowInstance[]` | `[]` | A list of flow instances. Each is served under its `flow.id` (its `kind` unless the instance was given another). Two with one id are refused at construction. A keyed record is refused at construction, naming the list form. | `fst:152-157`; `cfs:407-416`; **[run]** |
| `kits` | `readonly KitInstance[]` | `[]` | Kits to install, each a kit's factory called with its config, in any listed order (`kits: [harnesses({}), workforce({ model })]`). They install in `requires` order. Their flows are served beside `flows`, and are registered at start (so `meta.flowKeys` lists them only after start). | `fst:159-170`; `kit:1-20`; `cfs:1005-1011` |
| `fill` | `Readonly<Record<string, unknown>>` | none | The app's own entries for kits' slots, by slot key. A keyed slot takes a record or a list of entries each keyed by its `id`; a list slot gets the app's entries last. | `fst:172-178`; `kit:195-200` |
| `root` | `string \| URL` | working directory | The folder a kit's default folder is read against: a path, or a URL such as `import.meta.url` (its directory). A `directory` given in a kit's config reads against the working directory instead. | `fst:180-186`; `kit:40-45`, `:268-286` |

Kit refusals (what each names is in section 3): see R-11 for the kit contract; this page lists only the three
fields. `kit:56-70`, `:86-98`, `:104-239`, `:262-286`.

### 2.2 Models and voice

| Field | Type | Default | What it does | Source |
|---|---|---|---|---|
| `models` | `FlowStateModelsConfig` | none | A model resolver config in the FlowState's shape. See 8. | `fst:33-43`, `:188-189` |
| `modelResolver` | `ModelResolver` | built from `models` | A pre-built resolver, used instead of one built from `models`. Use for mocks (`createMockModelResolver`) or a custom resolver. | `fst:191-196`; `cfs:1044-1046` |
| `voice` | `{ provider?: VoiceProvider }` | none | The runtime's voice provider for TTS and STT; you pass an instance (`new OpenAIVoiceProvider({ apiKey })`). A flow's own `voice.provider` wins over it. | `fst:45-53`, `:198-199`; `packages/engine/src/transports/host/createInboundTransportHost.ts:790-796` |

### 2.3 Stores and settings

| Field | Type | Default | What it does | Source |
|---|---|---|---|---|
| `stores` | `StoreAdapter \| StoresConfig` | in memory | Three shapes: omitted (in memory, `default` profile), one adapter (`{ default: { primary: adapter } }`), or named profiles each mapping capability slots to adapters, at least one. An adapter is told from a profile map by its `resolve` function and `capabilities` array. See 5. | `fst:201-211`; `cfs:240-256` |
| `defaultProfile` | `string` | first declared profile | The profile used when `FSD_ENV` is unset. Must name a declared profile, or construction throws. | `fst:213-218`; `cfs:392-400` |
| `settings` | object (`FlowStateSettings`) | `{}` | Read in blocks as `ctx.settings`. See 6. | `fst:220-225`; `cfs:441-443` |

### 2.4 Errors and hooks

| Field | Type | Default | What it does | Source |
|---|---|---|---|---|
| `onError` | `(error: Error, context: { method: string; path: string }) => void` | none | The HTTP-level sink. Called when a route throws an error nothing handled, with the HTTP method (upper case) and the request path; the response is still sent (`errorStatus(error)`, body `{ error: message }`). | `fst:227`; `hh:972-986`; `packages/engine/src/routes/createFlowApiRouter.ts:105`; `routes/route-utils.ts:655-669` |
| `errorCapture` | `ErrorCaptureHandler` | none | Block-aware sink. See 9. | `fst:230-239`; `ec:75-90` |
| `onBackgroundWork` | `(promise: Promise<unknown>) => void` | none | Keep-alive hook for work that outlives the response: pass the platform's post-response primitive. On Vercel with Next.js, `(p) => after(() => p)` from `next/server`. A `createFlowState` option, not a handler option, because the router is built inside `createFlowState`. | `fst:241-250`; `cfs:1108`; `vn:9-12`; `su:151-165` [doc] |
| `adapters` | `InboundTransportAdapter[]` | none | Custom inbound transports mounted beside the built-in HTTP adapter and the scheduled endpoint. Their routes are matched before the canonical ones. Two adapters declaring one method and path throw `TransportRouteCollisionError`. | `fst:282-283`; `fr:139-148`, `:600-641`, `:716-720`, `:801-823` |
| `resolvePrincipal` | `PrincipalResolver` | body `userId` | The host's fallback resolver when a flow has no `authentication.resolvePrincipal`. A flow's own always wins. The default is `defaultBodyUserIdPrincipalResolver`, which trusts a caller-supplied `userId`; `serve()` refuses to bind a non-loopback host and a mounted handler refuses requests unless `allowUnauthenticated: true` (`nbg:50-85`, `na:40-71`). Authentication is R-20. | `fst:285-289`; `cfs:1154`; `na:40-71` |

### 2.5 Debug and stream settings

| Field | Type | Default | What it does | Source |
|---|---|---|---|---|
| `debugEndpointsEnabled` | `boolean` | `false`, or `true` when `FSDEV_DEBUG_ENDPOINTS` is `1` | The privileged read-only debug routes. An explicit value wins over the environment variable. Disabled: `403 { error: "debug_endpoints_disabled" }`. | `fst:291`; `dbr:51-72`, `:90-93`; `fr:226-236` |
| `debugAllowAnonymousLocal` | `boolean` | `false`, or `true` when `FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL` is `1` | Lets a request with no `Origin` header (curl, a script, a same-origin browser GET) reach the debug routes. Off, it gets `403 { error: "debug_endpoints_origin_rejected", origin: null }`. A request whose `Origin` is not loopback is rejected either way (the router has `debugAllowedOrigins`; `createFlowState` has no such field). Only for a server bound to loopback. | `fst:292-297`; `dbr:51-109`; `fr:238-260` |
| `defaultSseHeartbeatMs` | `number` | `15000` | The wire-level SSE ping interval, applied to every live and attach stream whose flow does not set `request.sseHeartbeatMs`. `0` disables. | `fst:298`; `hh:212`, `:283-288`; `fr:155-165`; `packages/engine/src/transports/host/createInboundTransportHost.ts:798-800` |

### 2.6 Sweeps and recovery

| Field | Type | Default | What it does | Source |
|---|---|---|---|---|
| `detectInterruptedOnStartup` | `boolean` | `true` | Scan for requests a previous process abandoned, at start, and mark them `interrupted`. Turn it off on serverless where cold-start queries can contend with the first request. | `fst:252-257`; `cfs:904-943` |
| `staleSweepIntervalMs` | `number` | `30000` | How often the stale-request sweeper runs. `0` (or a non-finite or negative number) disables it. The sweeper is built by the router, so it runs only in a process that asked for a router (`ready()` or `getRouter()`). | `fst:300-301`; `rc:278`; `ssw:84-98`; `fr:525-531`; `cfs:1080-1101` |
| `staleSweepThresholdMs` | `number` | `60000` | A running request whose heartbeat is older than this is stale and is marked `interrupted`. A threshold under twice the sweeper's fixed registry heartbeat (`registryHeartbeatMs`, default 10000, so under 20000 ms) logs `stale-request sweeper threshold may be too low`. The sweeper does not read any flow's `request.heartbeatIntervalMs`, because flows can be registered after the router is built. The warning comes from the sweeper, so only a process that built a router logs it. | `fst:302-303`; `rc:280`; `ssw:48-54`, `:87-111` |
| `queuedGraceMs` | `number` | `600000` (10 min) | How long a request an external queue holds, unclaimed, may sit before a sweep treats it as lost. Queued requests have no heartbeat. Must be finite and non-negative: anything else throws at start. `0` reaps as soon as stale. | `fst:304-312`; `rc:300`, `:328-340` |
| `maxChildSessionListLimit` | `number` | `100` | The largest `limit` the child-session listing route accepts. A positive safe integer; anything else throws at start. | `fst:327-336`; `rc:252-267` |
| `publicReentrySources` | `readonly string[]` | none | Sources your own transports stamp, added to the sources allowed on `retry`, `continue` and `resume`. See 10. | `fst:314-325`; `pr:58-62`, `:108-138` |
| `noticeIds` | `{ session?, user?, org? }` of booleans | all on | Which topic scopes' change notices may name what changed (a task, an entry, a session). `{ org: false }`: org notices still reach a scope-wide subscription but carry no `ids` and no collection entry's key; a subscription narrowed to one entry still hears its path (`rc:152-165` JSDoc). It applies to every stream and notice the app sends to a browser. Anything but those three keys with booleans throws at start. | `fst:390-397`; `rc:152-187`; **[run]** `noticeIds: { orgs: false }` throws `noticeIds takes { session?, user?, org? }, each true or false; refused orgs.` |

### 2.7 Durable execution

| Field | Type | Default | What it does | Source |
|---|---|---|---|---|
| `durable` | `boolean` | on wherever the stores persist | Durable execution for the whole host: sequencers checkpoint, a crashed request resumes, and `ctx.suspend()` holds a request until it is answered. `false` turns it off; `true` turns it on over in-memory stores too (tests). See 11. | `fst:338-352`; `dd:21-31` |
| `durabilityRetention` | `{ sweepIntervalMs?, checkpointMaxAgeMs?, suspensionTerminalMaxAgeMs?, orphanCheckpointThresholdMs?, batchLimit? }` | unset: no pruning | Retention for the durability sweeper. Only with durability on. See 11. | `fst:354-362`; `dsw:92-113` |
| `maxDebtAgeMs` | `number` | `86400000` (24 h) | How long scheduled work, such as delivering a background task's end notice, may stay overdue. Work overdue for longer is dropped and logged (the durability sweeper restarts such work once it falls due). Only with durability on and a store that keeps wakes. | `fst:364-370`; `rc:125-131` |
| `waitDeadlines` | `{ defaultMs?, minMs?, maxMs? }` | `300000`, `1000`, `86400000` | The deadline a wait that names none gets, and the shortest and longest one may name. See 11. | `fst:372-379`; `rc:132-139`; `wc:67-100` |
| `userDeadlineMs` | `number` | unset | The deadline a stop that waits for a user gets when it names none. A whole number of ms from 1000 to 31536000000, else throws at start. See 11. | `fst:381-388`; `rc:140-151`, `:189-207` |

### 2.8 Where work runs, and schedules

| Field | Type | Default | What it does | Source |
|---|---|---|---|---|
| `jobQueue` | `JobQueueAdapter` | none: in process | A job queue adapter such as `bullmqJobQueue(...)` from `@flow-state-dev/bullmq`. One adapter wires the enqueue side and/or the processing side per its `mode`. Mutually exclusive with `runner`. The page links R-19. | `fst:55-117`, `:408-416`; `bmq` |
| `runner` | `FlowRunner` | in process | A low-level "where actions run" hook. `jobQueue` is the usual choice. Mutually exclusive with `jobQueue`. | `fst:399-406`; `cfs:385-390` |
| `dispatchDrainTimeoutMs` | `number` | `30000` | How long `dispose()` waits for dispatched runs still running in this process. See 7. | `fst:259-280`; `cfs:174-179` |
| `scheduler` | `SchedulerAdapter \| false` | built-in local cron | When schedules fire. Omitted: a local cron ticking each minute, when a registered flow declares static schedules or a schedule index. When it is armed is R-33 (see 12.2). `false`: nothing fires the tick. An adapter (`vercelScheduler()` from `@flow-state-dev/vercel`) fires it itself. Schedules are R-33. | `fst:121-147`, `:418-428`; `cfs:424-434`, `:1404-1429` |

### 2.9 Read by commands

| Field | Type | Default | What it does | Source |
|---|---|---|---|---|
| `chat` | `{ default?: string }` | none | `fsdev chat` with no flow argument binds this target: `"<flowKind>"` (its sole action) or `"<flowKind>.<action>"`. A host-level default for the CLI, not a flow option. An unknown flow, an unknown action or an ambiguous bare kind is a config error (exit code `EXIT_CONFIG_ERROR`). | `fst:430-436`; `fsd:commands/chat.ts:96-137`, `:186` |
| `devtool` | `{ userId?: string; bearerToken?: string }` | none | Read only by `fsdev dev`: becomes DevTool's session identity (`userId`) and the `Authorization: Bearer` token it sends on flow requests. A blank value counts as unset. Handed to the page only when the host is loopback. Production `serve` ignores it. | `fst:438-464`; `dc:9-25`; `npg:36-52`; `nsv:231-241` |

## 3. When a bad config fails: construction or start

**Construction** is the synchronous `createFlowState(...)` call. **Start** is the first `ready()`, `getRouter()` or
`getRuntime()`; those reject (or `activeProfile` throws). A failure building the runtime (kits, stores, profile, models, config validation, job queue) rejects all three, and later calls return the same rejection. A failure building the router (adapter route collision, webhook provider not configured, `publicReentrySources`, `maxChildSessionListLimit`) rejects only `ready()` and `getRouter()`, which share one init promise; `getRuntime()` is memoized separately and has already resolved. `cfs:948-973`, `:1291-1312`. The class `FlowStateConfigError` (`name`
`"FlowStateConfigError"`, `code` `"flowstate_config_error"`, not retryable) is **not exported from any entry**; a
caller tells it by `name` or `code`. `packages/engine/src/errors/flow-error.ts:178-194`. `FlowIdentityConflictError`
and `TransportRouteCollisionError` are likewise not on a public entry [impl: `grep` of `ei`, `eh` finds neither].

| What | When | Class | What the message names | Source |
|---|---|---|---|---|
| `stores` is an empty object | construction | `FlowStateConfigError` | `createFlowState: stores must declare at least one profile` | `cfs:364-368`; **[run]** |
| `defaultProfile` is not a declared profile | construction | `FlowStateConfigError` | the profile and `Declared profiles: ...` | `cfs:392-400`; **[run]** |
| `flows` is not a list | construction | `FlowStateConfigError` | `` `flows` is a list of flows, each served under its own id: `flows: [readiness, context]` `` | `cfs:407-412`; **[run]** |
| Two flows share an id (kind and id, or two kinds on one id) | construction | `FlowIdentityConflictError` (reason `duplicate-id`) | `Flow "ping" with id "ping" is already registered` | `reg:812-820` [impl]; `regerr:11-80`; **[run]** |
| A singleton flow given a custom id (`singleton-id-mismatch`; also a flow with no declared cardinality whose id is not its kind); one kind registered as both singleton and collection (`mixed-cardinality`); a cardinality that is neither `"singleton"` nor `"collection"` (`invalid-cardinality`); an empty or non-string id (`invalid-id`); a flow that takes config passed as its `defineFlow(...)` result without calling it with its config, i.e. a definition with `requiresConfig: true` and no id (`unminted-config`) | construction | `FlowIdentityConflictError`, the code in parentheses as `reason` | the kind and id, with the remedy | `regerr:8-23`, `:44-96`; `reg:795-866` [impl] |
| Two flows' user- or org-scoped state schemas conflict | construction | `CrossFlowSchemaConflictError` | both flows, the scope and the field | `reg:212-243`; `regerr:98-125` |
| Passing `worker`, which is not a field (page row) | construction | `FlowStateConfigError` | `` createFlowState: the `worker` option is now `jobQueue`. Pass the same adapter as `jobQueue`. `` (page quotes the second sentence) | `cfs:371-377`; **[run]** |
| Passing `dispatcher`, which is not a field (page row) | construction | plain `Error` | `` createFlowState: the `dispatcher` option is now `runner`. Pass the same FlowRunner as `runner`. `` (page quotes the second sentence) | `packages/engine/src/transports/runner.ts:190-195`; **[run]** |
| `jobQueue` and `runner` together | construction | `FlowStateConfigError` | `` `jobQueue` and `runner` are mutually exclusive `` | `cfs:385-390`; **[run]** |
| An unknown `jobQueue.mode` | construction | `FlowStateConfigError` | the three valid modes | `cfs:378-384`; `t/job-queue-adapter.test.ts:235` |
| Kits: a kit listed twice; a kit requiring one not installed; kits requiring each other; a slot filled by a kit that does not require its owner or not declared by any kit; a keyed slot filled twice under one key; an entry its slot's schema refuses; two kits reading one folder | construction | `FlowStateConfigError` (one error naming every problem) | each problem | `kit:56-98`, `:104-239`, `:262-286` |
| A kit's folder has a file no reader used | start | `FlowStateConfigError`; rejects `ready()` and every request | each file, all at once, before any store opens | `kit:243-276`; `cfs:1005-1011`; `fst:166-169` |
| `FSD_ENV` names an undeclared profile | start, and the `activeProfile` getter | `FlowStateConfigError` | `FSD_ENV="nope" but no profile "nope" is declared. Declared profiles: ...` | `cfs:973-986`; **[run]** (`ready()` and `activeProfile` both) |
| A profile slot whose adapter does not declare that capability | start | `FlowStateConfigError` | the profile, the slot, what the adapter declares | `rs:76-85`; `t/resolve-slots.test.ts` |
| `userDeadlineMs` outside 1000 to 31536000000 or not a whole number | start | plain `Error` | `userDeadlineMs must be a whole number of milliseconds from 1000 to 31536000000` | `rc:199-207`; **[run]** |
| `noticeIds` with a key other than `session`, `user`, `org`, or a non-boolean | start | plain `Error` | the refused keys | `rc:177-187`; **[run]** |
| `maxChildSessionListLimit` not a positive safe integer | start | plain `Error` | the value | `rc:252-267`; **[run]** |
| `queuedGraceMs` not finite and non-negative | start | plain `Error` | the value | `rc:328-340`; **[run]** |
| `publicReentrySources` naming `webhook`, `task` or `internal` | start (router build) | plain `Error` | `publicReentrySources cannot include "webhook": ...` | `pr:128-138`; `fr:512`; **[run]** |
| `waitDeadlines` not finite, or breaking `0 < minMs <= defaultMs <= maxMs` | start, only on a host that holds waits (durable, store keeps wakes) | plain `Error` | `wait deadlines must be finite and satisfy 0 < min <= default <= max; got min ..., default ..., max ...` | `wc:86-116`; **[run]** (with `durable: true`) |
| A flow declares a webhook provider the mount did not configure, or an `on` map against a provider with no `eventType` | start (router build) | plain `Error`; rejects `getRouter()` | `Webhook adapter: flow "<kind>" declares webhooks for provider "<name>" but no provider definition was supplied` | `packages/engine/src/transports/webhook/createWebhookTransportAdapter.ts:85-131`; `fr:619-641` |
| Two adapters declare one `(method, path)` | start (router build) | `TransportRouteCollisionError` | `Route collision on <METHOD> <path>: declared by adapters [...]` | `packages/engine/src/transports/errors.ts:142-156`; `fr:617` |
| `models.intents` set with no `models.default` | start | plain `Error` | `createModelResolver: defaultModel is required when intents are configured` | `cmr:483-488` |
| A `models.default` that is an `intent/*` string | start | plain `Error` | `createModelResolver: defaultModel must not be an intent/* string (got "...").` | `cmr:490-496` |
| A `jobQueue` whose queue cannot start | start; rejects runtime init | whatever the adapter throws | (adapter's) | `cfs:1158-1176` |
| `getRouter()`, `ready()` or `getRuntime()` after `dispose()` (`register()` and `unregister()` do not check and do not throw) | the call (thrown synchronously, not a rejected promise) | `FlowStateDisposedError` (`code` `flowstate_disposed_error`) | `FlowState.getRouter()/ready() called after dispose()` for `getRouter()` and `ready()`; `FlowState.getRuntime() called after dispose()` for `getRuntime()` | `cfs:944-950`, `:960-966`; **[run]** |

Fields with **no** refusal: a negative or non-finite `dispatchDrainTimeoutMs` is read as `0` or the default 30000
(`cfs:174-179`). A non-finite `staleSweepIntervalMs` disables its sweeper (`ssw:96-98`). A threshold under twice the
heartbeat only logs a warning (`ssw:100-118`).

## 4. The `FlowState` handle

`createFlowState` returns this synchronously. Nothing is opened until start. `fst:495-595`.

| Member | What it does | Source |
|---|---|---|
| `getRouter()` | `Promise<FlowApiRouter>`: `{ GET, POST, PATCH, DELETE }`. The first call opens the stores. Every call returns the same router. | `fst:497`; `cfs:473-475`, `:945-959`; `t/createFlowState.test.ts:150` |
| `getRuntime()` | `Promise<FlowStateRuntime>`: `{ registry, stores, runtimeConfig, resolvePrincipal, chat? }`, the same instances the router uses. For workers and scripts. Memoized; starts job processing like `getRouter()`. | `fst:472-489`, `:499-505`; `cfs:477-479`, `:961-971`, `:1150-1156` |
| `ready()` | Eager warmup. Idempotent. Resolves once the router is built. | `fst:507-508`; `cfs:469-471` |
| `dispose()` | Releases everything in the order in section 7. Idempotent. | `fst:574-575`; `cfs:490-572`; `t/createFlowState.test.ts:173` |
| `register(flow, options?)` | Admit one instance after construction, running the construction checks. A refused registration changes nothing. One instance, never a list. Served from the next request, in this process only; a sibling process picks it up when it next starts. Throws `FlowIdentityConflictError` or `CrossFlowSchemaConflictError`, and when `options.pin` disagrees with a pin on the instance. | `fst:522-550`; `cfs:445-448` |
| `unregister(id)` | Release one address; returns `true` when an instance held it, `false` for an unknown id (not an error). Cancels nothing: a running request finishes and its items persist. Sessions, scope state and resources stay. Same per-process window as `register`. | `fst:552-572`; `cfs:450-452` |
| `resolveInProcessPrincipal(question)` | Who an in-process caller is, answered as the HTTP routes answer a request (the flow's own resolver, else `resolvePrincipal`). `fsdev run` and `fsdev chat` ask this before they write anything. In-process only. | `fst:510-520`; `cfs:481-488` |
| `activeProfile` | The profile name. Resolved on first use; reading it earlier resolves it and throws if `FSD_ENV` names an undeclared profile. | `fst:577-582`; `cfs:437-439` |
| `settings` | The `settings` object, or `{}`. Read-only. | `fst:584-585`; `cfs:441-443` |
| `meta` | `{ flowKeys, profileKeys, declaredSlots, devtool? }`, synchronous, no store opened. `flowKeys` is the instance ids registered right now (so a runtime-registered flow appears, an unregistered one does not, and a kit's flows appear only after start). `declaredSlots` is `{ profile: slot names }`. `devtool` is the option verbatim. | `fst:587-594`; `cfs:454-467`; **[run]** |

`isFlowState(value)` is a structural check (`getRuntime`, `getRouter`, `ready`, `dispose` all functions), so a
duplicated engine install does not reject a valid handle. `cfs:1490-1509`.

## 5. Store profiles

R-16 owns what a store holds and its adapters' options. This section is only how `createFlowState` picks and wires a
profile.

### 5.1 Shapes and slots

`stores` is `StoreAdapter | Record<profileName, { primary, bus?, blobs? }>`. A profile map must have at least one
profile. `fst:201-211`; `sa:29-43`.

| Slot | In a profile | What backs it | Source |
|---|---|---|---|
| `primary` | required | Sessions, requests, users, orgs, active requests, content, checkpoints, traces, suspensions and leases. | `sa:17-33`; `rs:24-36` |
| `bus` | optional | The change bus. When a profile names none and the primary declares `bus`, the primary backs it; otherwise it is in memory and reaches this process only. | `sa:23-26`; `rs:62-69`; `t/retired-slots.test.ts` |
| `blobs` | optional | Attachment storage. When a profile names none, the primary backs it if it declares `blobs` (`filesystemStores` does, under `<rootDir>/blobs`); otherwise a default folder `.fsdev/blobs/<profile>` under the working directory when the stores persist, in memory when they do not. | `rs:70-75`, `:93-100`, `:132-144`; `si:288-304` |

`queue` and `scheduler` are **not** slots: a typed profile naming either fails to compile. Queues come from `jobQueue`
(section 12), schedules from `scheduler` (2.8). `t/retired-slots.test.ts:1-33`. The code's own JSDoc for `blobs` calls
it a no-op reserved slot (`sa:19-21`); the resolver and the test show it backs attachments, and the code wins. Existing
docs list `blobs`, `queue` and `scheduler` as reserved no-ops (`rt:99-102`, `su:78`, `api:100`); see section 20.

An adapter that declares a slot it was not asked to fill is fine; a profile slot whose adapter does not declare that
capability throws at start (3). `rs:76-85`.

Adapters, and the slots each declares (the factory names and their packages are R-16's; listed so the slot rule can
be checked):

| Factory | Package | Declares | Source |
|---|---|---|---|
| `inMemoryStores()` | `@flow-state-dev/engine` | `primary` | `si:270-281` |
| `filesystemStores({ rootDir })` | `@flow-state-dev/engine` | `primary`, `blobs` | `si:288-304` |
| `sqliteStores({ filename })` | `@flow-state-dev/store-sqlite` | `primary` | `packages/store-sqlite/src/registry.ts:98` |
| `postgresStores(...)` | `@flow-state-dev/store-postgres` | `primary`, `bus` | `packages/store-postgres/src/registry.ts:259` |
| `vercelPostgresStores()` | `@flow-state-dev/vercel/store` | `primary`, `bus` | `packages/vercel/src/store.ts:141` |

### 5.2 How the profile is chosen

First match wins. `cfs:973-996`; `fst:213-218`; **[run]**.

1. `process.env.FSD_ENV`, when set and non-empty (an empty string counts as unset). It must name a declared profile, or
   `FlowStateConfigError` (3).
2. `defaultProfile`.
3. The first declared profile (the first key of the `stores` object).

`NODE_ENV` is never consulted. The choice is made on first use (`ready()`, `getRouter()`, `getRuntime()` or reading
`activeProfile`) and then fixed for the handle. An unknown `FSD_ENV` throws then, not when the module is imported.
`cfs:973-996`; `t/createFlowState.test.ts:100-148`. With one adapter or no `stores`, the only profile is `default`, so
an `FSD_ENV` naming another profile throws the same way. `t/stores-shorthand.test.ts:157`.

Start prints `[flowstate] active profile: "<name>"` on stderr once per process per profile (and, with no `stores`,
adds that the app runs in memory and nothing persists across a restart). `FSD_QUIET_WARNINGS` does not silence it.
`cfs:1024-1032`; `cor` (`firstInProcess` does not read it, `once-per-process.ts:20-36`).

### 5.3 Which profiles hold a pause by default

Durable execution is on by default wherever the primary stores persist (`persists !== false` on both the checkpoint and
the suspension store); only the in-memory stores declare `persists = false`. `dd:21-31`;
`packages/engine/src/stores/memory/suspension-store.ts:26`, `memory/checkpoint-store.ts:15`. So:

| Stores | A paused request (`ctx.suspend`, `ctx.suspendForUser`) is held | Source |
|---|---|---|
| SQLite, Postgres, Vercel Postgres, filesystem | yes, by default | `dd:21-31` |
| in memory | no: `ctx.suspend()` fails with an error that names the setting (`durable: false`, in-memory stores, or a router with no provider; remove `durable: false`, or set `durable: true` to hold stops in memory, tests only) and nothing is held | `packages/engine/src/context/createExecutionContext.ts:222-230` |
| in memory with `durable: true` | yes, lost when the process ends | `fst:338-352` |
| a custom store that does not declare `persists` | yes (absent means it persists) | `packages/engine/src/stores/types.ts:1705-1706`; `dd:29-31` |

Defaults per entry point, when the app has no `fsdev.config.*`:

| Entry | Stores | Durable | Source |
|---|---|---|---|
| `createFlowState` with no `stores` | in memory | off (in-memory stores) | `cfs:247-251` |
| `fsdev dev`, `fsdev run`, `fsdev chat` with no config | SQLite at `.fsdev/data/fsdev.db`, shared by the three | on, by the same rule | `fsd:local-store.ts:3-28`, `:65-79`; `commands/run.ts:322-342`; `commands/dev.ts:394-418`; `commands/chat.ts:208-216`, `:258` |
| `fsdev dev`, `fsdev run` with no config and `--store filesystem` | JSON files under `.fsdev/data`, single-process (`fsdev run` and `fsdev dev` cannot use it at the same time); `developmentOnly: true` so no warning | on | `fsd:local-store.ts:3-14`, `:69-76`; `commands/run.ts:326-340` |
| any command with a config | the config's own stores; `--store` is refused | the config's own `durable` | `fsd:local-store.ts:50-58`; `commands/run.ts:265` |
| `fsdev chat` | no `--store` flag; SQLite default | on | `commands/chat.ts:52-60`, `:208-216` |

`createFlowApiRouter` and `runAction` take a durability provider only when given one: with neither `createFlowState`
nor `resolveDurabilityProvider({ stores, durable? })` (root export) in front of them, they run without durable
execution. `createCheckpointDurabilityProvider(stores)` (root export) builds the default provider.
`dd:1-14`, `:21-27`; `ei:52-54`.

## 6. Settings

`settings` is instance-level config blocks read as `ctx.settings`. Process-wide: one shape for every flow, threaded
onto every block context. It is typed by declaration-merging into `FlowStateSettings`, the way Vite types
`ImportMetaEnv`:

```ts
declare module "@flow-state-dev/core" {
  interface FlowStateSettings { sandbox: { type: "local" | "vercel" | "memory" } }
}
```

`packages/core/src/types/block.ts:228-247`; `fst:220-225`; `rc:38-39`, `cfs:1107`. The handle's `settings` returns the
object passed, or `{}` when none. `cfs:441-443`. For settings that differ between two registered copies of one flow,
use the flow's `config`, read as `ctx.flow.config` (R-05, not this page). `flow:798-801`; `rt:45` [doc].
Settings are in the runtime config bundle, so `runAction` callers pass them as `runtimeConfig.settings` (17).

## 7. Start, lifecycle and shutdown

### 7.1 Async start

Construction is synchronous. Stores, kit folders and the router are built lazily, memoized, on the first `ready()`,
`getRouter()` or `getRuntime()`. A host's first request resolves the router, so the host takes **the handle**, not
`getRouter()`: `createNextHandler(flowstate)` and `createVercelNextHandler(flowstate)` take the object
`createFlowState` returns. Database
adapters open pools at start, not at import. A bad connection string surfaces at the first `ready()`. `cfs:1-12`,
`:945-971`; `nx:43-60`; `vn:18-22`; `su:186-190` [doc]. Call `ready()` eagerly (`instrumentation.ts`, a test, a
process that must consume a queue from boot) to move the cost off the first request.

What start does, in order: installs kits (reads their folders, registers their flows), resolves the profile and opens
its stores, builds the model resolver, builds the runtime config, installs the dispatch, wait-resume and wake
operations, starts the startup recovery sweep (unless `detectInterruptedOnStartup: false`), then wires and starts the
job queue. `getRouter()`/`ready()` then builds the router (its sweepers and adapters' `start` hooks) and arms the local
cron. `cfs:1004-1179`, `:1431-1475`. A host that only calls `getRuntime()` (as `fsdev run` and `fsdev chat` do) builds
no router and so runs no stale-request or durability sweeper. `cfs:1080-1101`;
`packages/engine/test/flowstate/runtime-only-liveness.test.ts`.

If start fails, the rejection is the same on every later call (the promise is memoized). Resource opened by a failed
start is released by `dispose()`. `cfs:506-516`.

### 7.2 What `dispose()` does, in order

`dispose()` is idempotent; after it, `getRouter()`, `ready()` and `getRuntime()` throw `FlowStateDisposedError`
synchronously. `cfs:490-572`, `:945-966`; `t/createFlowState.test.ts:173-185`.

1. Stops the scheduler (the local cron, or the adapter's handle) and lets a running tick settle. `cfs:496-500`.
2. Waits for an in-flight start to settle (a failed start is swallowed). `cfs:506-516`.
3. Disposes the router this handle built: stops the stale-request and durability sweepers, waits for requests its due
   wakes started and for requests still owing request-end hooks (one budget, **10 s**, then aborts the wake requests
   and logs two counts), then calls each transport adapter's `stop` hook in reverse order. `cfs:518-524`;
   `fr:392`, `:735-762`; `:555-570`. The 10 s is `createFlowApiRouter`'s `shutdownDrainMs` option, **not a
   `createFlowState` field**: through `FlowState.dispose()` it is fixed at 10 s. `serve()` passes what is left of its
   own grace window (`disposeFlowApiRouter(router, { drainMs })`). `fr:139`, `:743`; `nap:72-76`, `:213-221`.
4. Waits for dispatched runs started in this process, up to `dispatchDrainTimeoutMs` (7.3, which the page leaves to R-19). `cfs:526-540`.
5. Waits up to **5 s** for the startup recovery sweep (a fixed value, not
   an option; the page does not state why). `cfs:154-163`, `:542-549`.
6. Closes the job queue's processing handle (it waits for jobs this process already claimed; that wait is not bounded
   by `dispatchDrainTimeoutMs`), then calls the adapter's `close()`. `cfs:551-563`; `api:79` [doc].
7. Calls `dispose?.()` on every distinct store adapter declared in any profile, not only the active one. Start resolves
   only the active profile's adapters (`resolveProfileStores`), so the others are released without having been opened;
   this agrees with section 19's "other declared profiles are never opened". `cfs:229-238`, `:565-571`, `:1012-1014`.

Each step is guarded: a failure is written to `console.error` and shutdown goes on to the next. `cfs:496-571`.

### 7.3 The dispatch drain

Scope: dispatched runs (a `dispatcher()` block, a task board dispatching worker) running **in this process**. Work
handed to a job queue is never waited for here, and a side chain is waited on by its own request, not by this drain.
`fst:259-280`; `cfs:100-120`, `:1313-1339`; `packages/engine/test/` (drain tests) and `api:75-81` [doc].

| Rule | Value | Source |
|---|---|---|
| Budget | `dispatchDrainTimeoutMs`, default 30000 ms. A ceiling, not a target: finishing sooner is not delayed. `0` waits for nothing and still cancels and reports. A negative value reads as `0`; `undefined` or a non-finite value (`NaN`) reads as the default. | `cfs:151`, `:174-179` |
| Rounds | Up to 32 re-checks, because a run may dispatch more. One deadline for the whole drain, not per round. | `cfs:98`, `:634-670` |
| Unwind share | A cancelled run gets a slice of the same budget, the smaller of 2 s and a quarter of it, to write its end record. The option stays a true ceiling. | `cfs:116`, `:126`, `:628-632` |
| Notice | While waiting: `[flowstate] waiting for N dispatched request(s) to finish before shutdown` through the configured logger at `warn` (so `--quiet` silences it). | `cfs:657-661` |
| On timeout | Cancels the runs still going and reports on **stderr even when the logger is silent**: `[flowstate] shutdown cancelled N dispatched request(s) after Xms (budget Yms); they may not have completed: <requestId> (session <sessionId>), ...` naming up to five, then `, and N more`. | `cfs:104`, `:792-808` |
| What a cancelled run's record ends as | `interrupted` (resumable): the drain aborts the run, and the run, seeing an abort it did not record as intentional, settles `interrupted`. The drain writes no terminal status of its own. | `cfs:727-756`; `ra:3070-3095`, `:3236-3262` |
| Not waited on | queue work (`colocated` hands it to the queue; `enqueue-only` has no consumer here); side chains; work running in another process. | `fst:259-261`; `cfs:1313-1323` |
| `fsdev run` with a config | stays up after the flow completes while in-process dispatched runs finish, bounded by the same option. | `cfs:607-676`; `fsd:commands/run.ts:274-285` (config path takes the app's runtime); the stay-up behaviour is the drain itself [impl] |
| `fsdev run` with **no** config | has no request host, so a dispatching block cannot dispatch. **Carried corrected:** the error is `NoDispatchSeamError` (`code: "no-dispatch-seam"`) from `dispatchThroughSeam`, not `NoRequestHostError`; `NoRequestHostError` (`code: "no-request-host"`) is what `requireRequestHost(ctx)` throws for a capability that needs the host. [impl; not run] | `packages/core/src/types/dispatch.ts:553-564`, `:691-698`; `rh:684-725`; `commands/run.ts:342`; `packages/engine/src/context/createExecutionContext.ts:1190-1196`, `:4175-4179` |

### 7.4 Hot reload and signals

A dev server that re-evaluates the config module on every edit builds a new `FlowState` each time, and a new job queue
consumer with it (a handle starts its own processing at its first start). The guidance in the existing guide: dispose
the previous generation when the module re-runs, so only one job queue consumer runs at a time, and do not cache the
handle on `globalThis` (that freezes flows and config until a restart). Production builds evaluate the module once.
Register `SIGTERM`/`SIGINT` once behind a `globalThis` flag, not once per evaluation. `apps/docs/guides/background-jobs-bullmq.md:114-124`
[doc]. Behaviour behind it: `dispose()` is idempotent (`cfs:490-492`); the engine registers no signal handler itself
(`grep process.on` of `packages/engine/src` finds none), `serve()` registers `SIGTERM` and `SIGINT` unless
`handleSignals: false` (`nsv:301-303`, `:327-335`), `fsdev serve` registers its own (`fsd:commands/serve.ts:125-139`).
The once-per-process boot lines survive module re-evaluation: they are claimed on `globalThis`
(`cor:once-per-process.ts:1-18`).

## 8. Models

`models` is a `createModelResolver` config in the FlowState's shape. **Seven** options are forwarded:
`default` (as `defaultModel`), `intents`, `gateways`, `retryPolicy`, `providers`, `providerPreference`, `keys`.
`intentDefaults` and `env` are **not** forwarded: they are not fields of `models`, so a resolver that needs them is
built by hand and passed as `modelResolver`. `fst:33-43`; `cfs:215-227`; `cmr:44-104`.

| Field | Type | Default | What it does | Source |
|---|---|---|---|---|
| `default` | model string | none | The model returned when an intent has no available candidate or names an unknown intent. **Required when `intents` is non-empty**, and must not be an `intent/*` string; otherwise start throws. | `cmr:74-81`, `:483-495` |
| `intents` | `Record<string, string[]>` | none | Named ordered candidate lists. | `cmr:82-83` |
| `keys` | `Record<string, string>` | environment | Explicit API keys; override environment detection. | `cmr:45-46` |
| `gateways` | `Record<string, GatewayEntry>` | auto from the environment | Gateway instances or configs. Each key is a route name for `name:model` strings. A key may not also be a key of `providers`. | `cmr:47-56` |
| `providers` | `Record<string, unknown>` | auto from the environment | Pre-created AI SDK provider instances keyed by provider prefix. | `cmr:59-65` |
| `providerPreference` | `ProviderPreference` | none | Reorders each intent's candidates by provider before availability filtering. | `cmr:66-73` |
| `retryPolicy` | `ModelRetryPolicy` | see R-21 | Retry policy for fallback arrays and intents. | `cmr:57-58` |

`modelResolver` **replaces** `models` entirely: when set, `models` is ignored. `fst:191-196`; `cfs:1044-1046`. The
environment overrides (`FSDEV_INTENT_*`, `FSDEV_DEFAULT_MODEL`) are read by `createModelResolver` from `process.env`
at start (R-15 owns the variable table). `cmr:96-104`, `:549-611`. **[run]** (start logged the `FSDEV_*` lines).
`createFlowApiRouter` takes `modelResolver` directly. `fr:68`. R-21 owns resolution and ladders.

## 9. `errorCapture` and `onError`

| | `errorCapture` | `onError` |
|---|---|---|
| Passed to | `createFlowState({ errorCapture })`, `createFlowApiRouter({ errorCapture })`, or `runtimeConfig.errorCapture` for `runAction` | `createFlowState({ onError })` or `createFlowApiRouter({ onError })` only |
| Type | `ErrorCaptureHandler = (event: ErrorCaptureEvent) => void \| Promise<void>` (`@flow-state-dev/engine/host`; the event type is on the root) | `(error: Error, context: { method: string; path: string }) => void` |
| Fires | Once per failing block, deduped to the leaf, and once more with `final: true` when a request settles `failed` (never for a failure a retry or rescue healed) | When a route throws an error nothing handled |
| Return value | Ignored | Ignored |
| Async | May be async; the runtime awaits it inside a guard | Sync |
| If it throws | Swallowed: a warning `[flow-state] errorCapture handler threw; swallowed` through the runtime logger; the request is unaffected | Not guarded (it runs in the route's catch) [impl] |
| Event carries | `error` (a normalized `FlowError`), `requestId`, `flowKind`, `actionName`, `userId`, optional `sessionId`, `orgId`, `blockName`, `blockKind`, `blockInstanceId`, `blockPath`, `attempt`, `scope` (`"block" \| "request" \| "sideChain" \| "resource"`), `transient`, `final` | `method` upper-case, `path` |
| Source | `ec:26-89`, `:107-153`; `cfs:1116`; `fr:109-115`; `ra:2111`, `:2263-2266`; `packages/engine/src/context/createExecutionContext.ts:3665-3715` | `hh:972-986`; `fr:105` |

The framework ships no provider SDK; the operator writes the adapter. The event's field detail is R-22's table; this
page keeps the placement and the two behaviours (async, swallowed throw).

## 10. `publicReentrySources`

`retry`, `continue` and `resume` are public routes that re-run a request by id. Whether a request may be re-run that
way depends on the transport it arrived on (its `source`). `pr:1-21`.

| | Sources | Source |
|---|---|---|
| Allowed by default | `http`, `mcp`, `scheduled` | `pr:58-62` |
| Refused always, and refused if named in the option | `webhook`, `task`, `internal` (stamped by the framework; no caller-facing entry) | `pr:85-89`, `:128-138`; `packages/engine/src/execution/transport-sources.ts:19-40` |
| Any other source | refused unless the option names it | `pr:108-115` |

A refused source is answered with the same not-found shape a missing record has. `pr:101-107`. Naming a refused source
in the option throws at start (3). The listing route's `retryable` flag reads the same list.
`packages/engine/src/routes/session-routes.ts:91-92`, `:657`.

## 11. Durability, waits and deadlines

### 11.1 `durable`

`durable` unset: on when the resolved stores persist, off over in-memory stores. `false`: off. `true`: on, even over
in-memory stores (tests). `createFlowState` builds `createCheckpointDurabilityProvider` from the resolved stores.
`fst:338-352`; `dd:21-31`; `cfs:1057`; `t/createFlowState-forwarding.test.ts:113-138`. Durable on means sequencers
checkpoint, a crashed request resumes, and `ctx.suspend()` holds a request. Without it, `ctx.suspend()` throws an error
naming the setting (5.3).

The action field `durable: true` (an action config, R-05) is a different switch: it clears that action's suspension
records and lease when the action completes. Suspending and crash recovery do not depend on it, and it does not move
the run to a queue. `flow:238-244`. **There is no per-action "background" setting**; where runs execute is `jobQueue`
or `runner` on the host (section 12). `fst:399-416`.

### 11.2 `durabilityRetention`

`createFlowState` forwards it to the router, which builds one durability sweeper **whenever durable execution is on**.
Without `durabilityRetention` the sweeper still runs with pruning off: it expires pending suspensions past their
`expiresAt`, times out overdue waits, re-drives requests left behind a resolved gate, carries recorded stops and fires
due wakes. With `durabilityRetention` set, it also prunes (steps 3 to 5 below). `fr:572-597`; `dsw:135-139`, `:200-228`;
`t/createFlowState-forwarding.test.ts:100`.

| Field | Default | What it bounds | Source |
|---|---|---|---|
| `sweepIntervalMs` | `600000` (10 min) | Tick cadence. A tick comes sooner when a wait deadline, a wake or a suspension's `expiresAt` is earlier (never under a floor). `0`, negative or non-finite: **no sweeper at all**, so waits do not time out and suspensions do not expire. | `dsw:95-97`, `:164-167`, `:224-228`, `:239-258` |
| `checkpointMaxAgeMs` | `86400000` (24 h) | Backstop age for the checkpoints of requests that ended `completed`, `failed` or `aborted` whose cleanup never ran. Checkpoints of `in_progress`, `suspended` and `created` requests are never pruned by age. | `dsw:98-102`, `:46-50` |
| `suspensionTerminalMaxAgeMs` | `604800000` (7 d) | How long a resolved suspension stays, from `resolvedAt`. | `dsw:104`, `:165` |
| `orphanCheckpointThresholdMs` | `86400000` (24 h) | Age past an `interrupted` request's last activity before its checkpoints count as orphaned. | `dsw:105-109`, `:166` |
| `batchLimit` | `1000` | A batch (page) size, **not a per-tick deletion cap**: suspension pruning calls `pruneSuspensions(cutoff, batchLimit)` in a loop of up to 100 batches per tick, the orphan-checkpoint prune pages through a status's requests with `limit: batchLimit`, the re-drive scan pages by it, and due wakes are listed `batchLimit` at a time. Corrected in pass 8 (pass 5 found the old row untrue). | `dsw:110-111`, `:167` |

One sweeper at a time per shared store: each tick takes a lease under the key `__durability_sweeper__` for
`sweepIntervalMs`, and a host that does not get it skips the whole tick (including expiry and wake firing); the lease
is released at the end of the tick. `dsw:169`, `:410-432`. `createFlowApiRouter` builds the sweeper only when its
runtime config has a durability provider; a router given none sweeps no durable state. `fr:572-577`.

### 11.3 `waitDeadlines`

A wait (a `getTask({ wait: true })`, a `dispatcher({ wait: true })`) parks on one gate with a deadline, and the engine
resumes an overdue wait, cancelling nothing. `waitDeadlines` sets the deadline a wait that names none gets
(`defaultMs`, 300000 = 5 min) and the bounds a named one must fall in (`minMs` 1000, `maxMs` 86400000 = 24 h).
`wc:67-100`; `rc:132-139`.

- The three must be finite and satisfy `0 < minMs <= defaultMs <= maxMs`, else start throws (3).
- It takes effect only on a host that can hold a wait: durable execution on **and** a store that keeps wakes
  (`installWaits` returns early when `requestHost.wakes` is absent). A host with in-memory stores and no `durable: true`
  logs `[flow-state] this host keeps no wakes: debts are paid on their fast paths only { reason: 'no durable execution' }`
  and offers no wait. `wc:109-116`; `cfs:1224-1239`; **[run]**.
- A deadline outside the bounds is **refused, not clamped**: `getTask`'s wait answers `wait_deadline_out_of_range`
  (`deadline must be from <min> to <max> ms; <n> is outside it. Nothing was written.`). A raw `ctx.suspend` uses only
  its own `timeoutMs` and ignores these. `packages/orchestration/src/tasks/helpers/wait-on-task.ts:346-364`;
  `packages/core/src/blocks/wait-on-request.ts:62-69`. The depth limit on nested waits (five) is R-19's.
  `rh:205-223`.

### 11.4 `userDeadlineMs`

The deadline a stop that waits for a user gets when it names none: every `ctx.suspendForUser` without a `deadline`,
and every question a task board holds. Unset by default: such a stop waits until answered, stopped or cancelled. A whole
number of ms, 1000 to 31536000000 (365 days). At the deadline an `approval` reads as a no marked `deadline: true`; a
`review` or an `input` throws `SuspensionTimeoutError`. A raw `ctx.suspend` never reads it. `rc:140-151`, `:189-207`;
`packages/core/src/types/suspend-for-user.ts:1-30`, `:107-137`. The task board stamps the due time on each question it
files from this host setting (`holdDueMs`), and a question filed `untimed` ignores it. `packages/orchestration/src/tasks/collection/get-or-create.ts:410-427`;
`orchestration/src/tasks/schema/hold.ts:132-140`. What the board does when a question's deadline passes (it closes the
question on its first touch past it, and the work goes on as if answered) is R-23's row [not verified here].

### 11.5 `maxDebtAgeMs` and wakes

A wake is a due time the host promised to run an internal entry in a session. `maxDebtAgeMs` (default 24 h) is how long
past its due time owed work may stay owed before it is given up and logged. Only with durability on and a store that
keeps wakes: the in-memory, filesystem, SQLite and Postgres stores keep wakes. `fst:364-370`; `rc:125-131`;
`cfs:1224-1239`.

## 12. Job queue, runner and scheduler

### 12.1 `jobQueue`

A `JobQueueAdapter` (`createRunner(runtime)`, `startProcessing(runtime)`, optional `close()`, optional `leaseBackend`,
optional `mode`). `@flow-state-dev/bullmq` exports `bullmqJobQueue(options)`; its `options.mode` defaults to
`"colocated"`. `fst:55-117`; `bmq:index.ts:10-11`, `flowstate-adapter.ts:45`, `:95`.

| `mode` | This process | Source |
|---|---|---|
| `"colocated"` (default) | Enqueues and processes. The runner is installed on the router and the processing side starts. | `fst:55-66`; `cfs:1163-1176`; `t/job-queue-adapter.test.ts:101` |
| `"enqueue-only"` | Enqueues only (the web process of a split deployment). Installs the runner, never starts processing. | `t/job-queue-adapter.test.ts:123` |
| `"process-only"` | Processes only (a dedicated container). Builds the same `createFlowState(...)` from shared config and calls `ready()`; installs no runner; the router is typically never served. | `t/job-queue-adapter.test.ts:135` |

Rules:

- `jobQueue` with `runner` throws at construction; the retired `worker` option throws at construction, naming
  `jobQueue`; the retired `dispatcher` option throws, naming `runner`. (3)
- A queued run is a **host** setting: every action on the host goes through the runner (the router is given
  `runner ?? jobQueue's runner`). There is no per-action queue setting. `cfs:1468`; `fst:399-416`. Exception named on the
  existing page: a dynamic schedule's fire runs in the process that ticked. `apps/docs/docs/server/background-work.md:25` [doc].
- The enqueue side and the processing side get the **same** `{ registry, stores, runtimeConfig }`. `fst:74-83`;
  `cfs:1150-1176`. That is within one process. Across processes, both must be given stores every process reaches
  (SQLite on one machine's file; Postgres across machines), since a queued job's writes must be visible to the stream and
  the DevTool. [doc: `apps/docs/guides/background-jobs-bullmq.md:102`; the stores-must-be-shared requirement is R-16's.]
- Processing starts on the first `ready()`, `getRouter()` or `getRuntime()`, once across them. Call `ready()` eagerly in
  a process that must consume the queue from boot. `dispose()` without a prior start starts and closes nothing.
  `fst:408-416`; `t/job-queue-adapter.test.ts:147-193`.
- `dispose()` closes the processing handle **before** the stores, so in-flight jobs drain against open stores, then
  calls the adapter's `close()`. `fst:93-98`; `cfs:551-563`; `t/job-queue-adapter.test.ts:167`.
- `leaseBackend`: an adapter whose runs land in several processes supplies an ordered-lease backend so a session's
  `queue`, `reject`, `hold` and `defer` concurrency policies hold across all of them. Absent: each process arbitrates
  only its own in-process runs, work handed to the queue is not arbitrated, and a delivery into an existing session is
  refused `external-flow-runner`. `fst:101-116`; `cfs:352-359`. R-18 owns the policies.
- A `process-only` process arms the local cron when it processes and a registered flow declares schedules, and its
  schedule fires are enqueued through the queue's runner. `cfs:1170-1175`, `:1390-1395`.

### 12.2 `scheduler`

See 2.8. Details: the local cron ticks each minute; it is armed once a router is built, or when job processing starts in `process-only` mode
(`if (mode === "process-only") this.#armLocalScheduler(stores)`; a `colocated` queue resolved through `getRuntime()` starts
processing and does not arm it), never in a process that only resolves the runtime (`fsdev run`); `register()` arms it when a scheduled flow is added later. A
lease under `__schedule_tick__` in `stores.leases` (duration two intervals, renewed by the holder, released on stop) elects
one process to tick across a deployment that shares its store. In production it warns once if that lease lives in
memory or the filesystem (`engine/local-cron-unelected-lease`), and once on Vercel (`engine/local-cron-on-vercel`),
pointing at `vercelScheduler()`. `ls:1-60`; `cfs:424-434`, `:1404-1429`.

## 13. Hosts

A host takes the handle (or the router) and answers HTTP. The router speaks Web `Request` and `Response`.

| Host | Package and entry | Takes | Notes | Source |
|---|---|---|---|---|
| Node, long-lived | `serve(app, options)` from `@flow-state-dev/node` | `FlowState` or `FlowApiRouter` | See 13.1 | `nsv:187-340` |
| Portable app | `createServerApp(app, options)` from `@flow-state-dev/node/app` | same | `createServerApp` returns a `ServerApp` `{ app, tryDedicatedRoute, dispose }`; the Hono app is its `.app` property, and `.app.fetch` is the Web Fetch handler (Bun: `export default createServerApp(...).app`; Deno: `Deno.serve(createServerApp(...).app.fetch)`). Corrected in pass 8 (`node/src/app.ts:48-52`, `:211-222`). Serves no static files and does not import `@hono/node-server`. Resolves the router at construction. | `nap:1-14`, `:92-125` |
| AWS Lambda | `createLambdaHandler(app, { allowUnauthenticated?, basePath?, healthPath?, servesPush? })` from `@flow-state-dev/node/aws-lambda` | same | Wraps the portable app with Hono's `streamHandle`. Configure the Function URL with `invokeMode: RESPONSE_STREAM` so SSE streams. Serves the same routes and `/healthz`. Runs the network authentication guard on every request. | `nlam:1-59` |
| Next.js | `createNextHandler(flowstate, { allowUnauthenticated? })` from `@flow-state-dev/next`; returns `{ GET, POST, PATCH, DELETE }` | the `FlowState` handle, not `getRouter()` | Needs Next.js 15 (async `params`; peer `next >=15.0.0`). Resolves the router on the first request. No Vercel header shaping. | `nx:1-60`; `packages/next/package.json:58-60` |
| Vercel + Next.js | `createVercelNextHandler(flowstate, options?)` from `@flow-state-dev/vercel/next` | the `FlowState` handle | Adds `cache-control: no-cache, no-transform` and `x-accel-buffering: no` to every SSE response it wraps. Options: `allowUnauthenticated`, `onAbort(req)`, `waitUntil`. On Vercel it declares the router's disk ephemeral, so attachment uploads to a blob store that keeps bytes on the host are refused by name. | `vn:18-22`; `vh:17-50`, `:92-137`; `vt:22-42` |
| Vercel, low level | `createVercelHandler(app, options?)`, `createVercelBareHandler(app, options?)` from `@flow-state-dev/vercel` | a router or `() => router \| Promise<router>` | `createVercelBareHandler` exports `{ GET, POST }` only, for the zero-segment `/api/flows` path. | `vh:111-176`; `vt:18-20` |
| In process | `createInProcessFetch(app, { basePath? })` from `@flow-state-dev/engine` | `FlowState` or `FlowApiRouter` | See 17. | `ipf:18-143` |

Next.js mounting:

- The route file exports all four verbs. A verb it does not export is not served by that file. `nx:43-60`.
- A required catch-all `[...path]` needs at least one segment, so `GET /api/flows` is a `404` from Next. Serve the bare
  path either by naming the folder `[[...path]]` (the optional catch-all; `examples/hello-chat/app/api/flows/[[...path]]/route.ts`)
  or by adding a sibling `app/api/flows/route.ts` that exports `GET` and `POST` from `createVercelBareHandler(() => flowstate.getRouter())`
  (`apps/kitchen-sink/app/api/flows/route.ts`, `apps/kitchen-sink/app/api/flows/[...path]/route.ts`). `vh:143-176`.
- `export const dynamic = "force-dynamic"`: the example's comment says that without it Next.js may buffer the response
  body and the stream does not arrive token by token. State it that way (the code does not prove "required").
  `examples/hello-chat/app/api/flows/[[...path]]/route.ts:4-7`.
- On Vercel, `runtime`, `maxDuration` and `dynamic` must be literal declarations, not re-exports (the Next.js compiler
  reads them statically). `apps/kitchen-sink/app/api/flows/[...path]/route.ts:5-9`.
- The adapter's routes come before the canonical ones; two adapters on one method and path throw
  `TransportRouteCollisionError` at router build (3). `fr:716-720`, `:801-823`.
- Every network-exposed host (`createNextHandler`, `createVercelHandler`, `createLambdaHandler`, and `serve()` on a
  non-loopback host) runs `createNetworkAuthGuard` before each request: if any served flow resolves its principal with
  the default body-`userId` resolver, the call answers `500 { "error": "Internal server error" }` and the real reason
  is logged once. `allowUnauthenticated: true` overrides. The result is not cached, so a flow registered later is checked.
  `na:55-85`; `nx:22-34`; `vh:62-90`.

### 13.1 `serve()`

`serve(app, options): Promise<{ server, port, close() }>`. Resolves once listening. `nsv:131-142`, `:187-340`.

| Option | Default | What it does | Source |
|---|---|---|---|
| `port` | `$PORT` if it parses as a number, else `3000` | Port to bind. Port `0` resolves to the bound port on the handle. | `nsv:51`, `:144`, `:167-175` |
| `host` | `"0.0.0.0"` | Bind host. | `nsv:53`, `:145` |
| `allowUnauthenticated` | `false` | Without it, a non-loopback bind refuses to start (`Refusing to bind <host>: flow "<kind>" has no authentication configured ...`) when any served flow uses the default resolver; the same check runs on each request. Loopback binds are exempt. | `nsv:55`, `:192-198`; `nbg:28-88`; `na:55-71` |
| `basePath` | `"/api/flows"` | API mount prefix. Avoid `:` and `*` (Hono pattern syntax). A path outside it is `404 { error: "Not found" }`, except a transport adapter's dedicated routes registered outside it (such as MCP). | `nsv:57`; `nap:28-34`, `:188-208` |
| `healthPath` | `"/healthz"` | `200 { status: "ok" }` once the router is ready, `503 { status: "initializing" }` before, `500 { status: "error", message }` on a permanent init failure. A loopback or opted-out bind listens at once, so a PaaS health check passes during a cold start; a network bind awaits the authentication guard (and so store init) before listening. The framework has no `/health` route; the Next.js and Vercel handlers serve no health route. | `nsv:59`, `:180-186`; `nap:129-138` |
| `staticDir` | none | Serve files from this folder for non-API `GET`s, with an `index.html` SPA fallback (the DevTool UI). A real file is served before the router is ready. GET-only (HEAD answers via Hono). | `nsv:61`, `:225-262` |
| `devtoolConfig` | none | Written into served HTML as `window.__FSD_DEVTOOL_CONFIG__`, **loopback host only**; on a non-loopback host it is ignored with a stderr warning. Set by `fsdev dev` from the config's `devtool`. | `nsv:63-69`, `:231-241`; `npg:36-52` |
| `pageMeta`, `pageScript`, `pageHandler` | none | Extra `<meta>` tags and an inline script written into every HTML page from `staticDir`, on any host (not for secrets); a Connect-style handler for non-API `GET`s tried after a real file and a dedicated route, before the SPA fallback. | `nsv:70-92`; `npg:1-61` |
| `shutdownGraceMs` | `10000` | After `SIGTERM`/`SIGINT` (or `close()`): stop accepting, drain in-flight requests, force-close connections (open SSE streams) after this window, then dispose the router and the `FlowState`. What is left of the grace bounds the wait for requests due wakes started. | `nsv:93-94`, `:146`, `:273-299` |
| `handleSignals` | `true` | Install `SIGTERM`/`SIGINT` handlers that call `close()`; installed only once the bind succeeds. `false` when the caller drives `handle.close()`. | `nsv:95-100`, `:327-335` |
| `disposeOnClose` | `true` | Whether `close()` disposes the router and the `FlowState`; `false` when several servers share one runtime. | `nsv:101-106`, `:298` |
| `push` | `true` | Serve the change-notice WebSocket. `false`: `GET /capabilities` reports `push: null` and clients read on their timer. | `nsv:107-113`, `:205-210` |
| `pushSecret` | `process.env.FSD_PUSH_SECRET`, else a random key for this process | The key push tickets are signed with. Needed only when several processes serve one address: give every one the same key. | `nsv:114-120`, `:345-359`; `pd:80-96` |

A loopback-bound `serve()` answers `403 Forbidden` to a request whose `Host` header is not loopback. `nsv:309-312`;
`nbg:40-47`. A raw `FlowApiRouter` instead of a handle means the caller manages store lifecycle: `close()` cannot
dispose its stores. `nsv:178-186`.

`fsdev serve` is `serve(flowState, { host, port, basePath: "/api/flows", handleSignals: false })` with no `staticDir`,
over the config's `FlowState`. Host: `--host`, else `$HOST`, else `0.0.0.0`; port: `--port`, else `$PORT`, else `3000`,
an all-digits value 0 to 65535 or exit code `EXIT_CONFIG_ERROR`. It requires a committed config
(`fsdev.config.{ts,mts,js,mjs}` in the working directory, or `--config`) and never scans directories. It installs
its own signal handlers, awaits `ready()` so a post-bind init failure fails the command, and prints the address.
`fsd:commands/serve.ts:1-60`, `:64-170`. `fsdev dev` also uses `serve()` and, with a config and a loopback bind, sets
`FSDEV_DEBUG_ENDPOINTS=1`, `FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL=1` and `FSDEV_TRACING_LEVEL=verbose` unless already
set; on a non-loopback host it forces the first two to `0`. `fsd:commands/dev.ts:290-302`.

## 14. Streaming behind a reverse proxy

The framework reads no proxy setting. What it sets:

- The live stream a `POST` returns (action, resume, answer, continue): `cache-control: no-cache, no-transform` and
  `x-accel-buffering: no`. `packages/engine/src/routes/action-routes.ts:339-340`; `resume-routes.ts:255-256`;
  `recovery-routes.ts:284-285`; `answer-routes.ts:163`.
- The plain `GET` streams: `cache-control: no-cache` and `connection: keep-alive`, no `x-accel-buffering`.
  `packages/engine/src/routes/route-utils.ts:39-43`.
- The Vercel adapter adds `no-cache, no-transform` and `x-accel-buffering: no` to every SSE response it wraps.
  `vh:23-31`, `:78-87`.
- SSE pings (`: ping`) every `defaultSseHeartbeatMs` (15 s) or the flow's `request.sseHeartbeatMs` keep a connection from
  looking idle. 2.5.

What a proxy in front of `/api/flows/` needs (values from the Docker guide, not read by the framework) [doc,
`apps/docs/guides/deploying-with-docker.md:280-370`]: do not buffer or cache responses, and keep idle connections open
longer than the longest run. nginx: `proxy_http_version 1.1`, `proxy_buffering off`, `proxy_cache off`,
`proxy_read_timeout 86400s`, `proxy_send_timeout 86400s`. Caddy: `reverse_proxy` with `flush_interval -1` (the guide says
Caddy's default already handles most SSE, so this makes it explicit). Symptom: a stream that arrives all at once means
something in the path is buffering. **Dropped from the guide:** `add_header X-Accel-Buffering no;` in the nginx location
and the claim it "tells downstream proxies": the framework already sets that header on the upstream `POST` streams, and
the directive that covers the `GET` streams is `proxy_buffering off`. State directives only.

## 15. Push (change notices)

How clients hear a change without polling. `GET {basePath}/capabilities` answers `{ userStream, push }`; the client
asks the server and negotiates. `hh:540`; `pd:78-110`; **[run]** a router built by `createFlowApiRouter` answers
`{"userStream":false,"push":null}`.

| Host | Push | Source |
|---|---|---|
| `serve()` from `@flow-state-dev/node` (so `fsdev dev` and `fsdev serve`) | **on**, one WebSocket per client at `{basePath}/users/:userId/stream`; `push: false` turns it off | `nsv:21-28`, `:205-210`, `:345-380` |
| `createServerApp()` alone, `createLambdaHandler`, `createNextHandler`, Vercel handlers | **off**: `push: null`, the mint route answers `404 { error: "This host serves no push" }`, clients read on their timer | `nap:36-43`, `:150-160`; `pd:119-123` |

`POST {basePath}/users/:userId/stream` takes `{ topics }` (at most `PUSH_MINT_MAX_TOPICS` wire topics), checks each topic
against the caller, and returns a ticket valid for 30 s (`PUSH_TICKET_TTL_MS`) naming the granted topics. The socket's
first frame is the ticket; a socket that sends none times out (`no ticket`), a refused ticket closes with
`ticket refused`, and a non-text or malformed frame closes with `bad frame`. A connection that lands on a process
signing with a different key refuses its ticket, which is why several processes behind one address need one
`pushSecret` / `FSD_PUSH_SECRET`. `pd:120-176`; `packages/engine/src/push/socket-session.ts:103-221`; `nsv:405-440`.
R-13 owns the wire. `noticeIds` (2.6) gates what a notice names.

## 16. What a loaded `FlowState` supplies, and what the CLI adds

`fsdev run`, `fsdev dev`, `fsdev chat` and `fsdev serve` look for `fsdev.config.ts`, `.mts`, `.js` or `.mjs` in the
working directory, in that order (first found wins, a shadowed second file warns on stderr), or use `--config <path>`
(a missing file is an error). The file **default-exports a `FlowState`** (the `createFlowState()` handle); anything
else is a config error naming it (`it has no default export` or `the default export is a <type>, not a FlowState`).
Loading imports the file and validates the shape; it opens no store. Search is working-directory only. `fsd:lc:22-127`.
`--no-config` (run, dev, chat) uses directory discovery; `fsdev serve` requires a config. `--flow-dir` with a loaded
config is refused. `fsd:resolve-runtime.ts:101-174`.

| | Comes from the config's `FlowState` | The CLI adds | Source |
|---|---|---|---|
| Flows | the registry (`getRuntime().registry`) | `fsdev run <flow>` finds the flow by instance id there | `commands/run.ts:274-285` |
| Stores | `getRuntime().stores` (the active profile) | `fsdev run` and `fsdev chat` wrap them with the change bus | `commands/run.ts:289-346` |
| Runtime config | `getRuntime().runtimeConfig` (durability, settings, model resolver, requestHost, and the rest) | stderr logger (`--quiet`, `--log-level`; `run` default `info`, `chat` `warn`), installed on the app's own config object too so `dispose()` logs obey `--quiet`; the model resolver wrapped when `--model` is given (`dev` refuses `--model` with a config) | `commands/run.ts:480-531`; `chat.ts:228-262`; `dev.ts:325-333` |
| Principal | the flow's own resolver, else `resolvePrincipal` (`resolveInProcessPrincipal`) | `--user` / `--org` | `commands/chat.ts:186`; `fst:510-520` |
| `chat.default` | read by `fsdev chat` | none | `commands/chat.ts:186` |
| `devtool` | read by `fsdev dev` (`flowState.meta.devtool`) and handed to the DevTool page on a loopback host; a non-loopback `fsdev dev` with a `bearerToken` refuses to bind | none | `dc:20-25`; `commands/dev.ts:355-367` |
| Debug and tracing | the config's `debugEndpointsEnabled`, `debugAllowAnonymousLocal` | `fsdev dev` sets the three environment defaults above | 13.1 |
| Durability | the config's own | none; with **no** config, `resolveDurabilityProvider({ stores })` | `commands/run.ts:342` |
| Dispose | the command disposes the `FlowState` on exit | | `commands/run.ts:246-261` |

A Lab config for Shift Manager (`npx shift-manager --config ./fsdev.config.mts`; default search is `fsdev.config.ts`,
`.mts`, `.js`, `.mjs` in the working directory) must default-export a `FlowState`. It picks the store: `inMemoryStores()`
when what the Lab holds need not survive a restart (the Lab then starts empty each time, including each `--dev` restart on
a save), `sqliteStores(...)` or `postgresStores(...)` when it must. Shift Manager passes `devtool: { userId }` (and
`bearerToken` when the resolver checks one) to the page only when `--host` is a loopback address. A config that does not
load or does not default-export a `FlowState` stops the command with the loader's message. `packages/shift-manager/README.md:17-32`,
`:85-106`, `:165` [doc, package README].

## 17. In-process calls

### 17.1 `createInProcessFetch(app, options?)`

`createInProcessFetch(app: FlowState | FlowApiRouter, options?: { basePath?: string }): (input, init?) => Promise<Response>`.
`ipf:18-35`, `:90-100`. Hand it to a client as `fetcher` (or to `FlowProvider`). It takes the same path as HTTP:
the router sees `source: "http"` and authenticates from the request's headers; being in the process grants nothing extra.
`ipf:1-11`.

| Rule | Answer | Source |
|---|---|---|
| `basePath` default | `"/api/flows"`. Match the client's `apiPath`. A path outside it answers `404 { error: "Not found" }`. | `ipf:20-25`, `:35`, `:139-140`; **[run]** |
| Method | `GET`, `POST`, `PATCH`, `DELETE` reach the router; any other method, `HEAD` and `OPTIONS` included, answers `405 { error: "Method not allowed" }` | `ipf:133-137`; **[run]** |
| Router failed to initialize | `500 { error: "Server failed to initialize" }` | `ipf:127-132` |
| Origin | only the URL's path is read; a relative path works | `ipf:29-33`, `:41` |
| Streams | SSE bodies stream; an abort signal on `init` reaches the route | `ipf:84-86` |
| Start | router resolution starts when `createInProcessFetch` is called, so the first request does not pay for store init alone | `ipf:87-100` |

**[run]** `GET /api/flows` 200, `GET /other` 404, `HEAD` and `OPTIONS` 405, a `basePath: "/v1"` fetch of `/api/flows`
404. `packages/engine/test/in-process-fetch.test.ts`.

### 17.2 `runAction` and `runtimeConfig`

`runAction(options)` (root export) runs one action with no router. `options.runtimeConfig` is a **required**
`RuntimeConfig` object; everything inside it is optional (`modelResolver`, `settings`, `logger`, `durabilityProvider`,
`errorCapture`, `requestHost`, ...). `rat:71-230`; `rc:30-162`. **Carried corrected:** with no `modelResolver` in it the run
builds `createModelResolver()` from the environment (`createExecutionContext.ts:3029-3031`); a generator block does not
fail at run time merely because the field is absent. Also required on `RunActionOptions`: `flow`, `actionName`, `input`,
`userId`, **`orgId`** (pass the verified org, or `DEFAULT_ORG_ID` from `@flow-state-dev/core` for single-organization
development), `stores`. `rat:71-110`. With no `requestHost` in the runtime config a block cannot use dispatch or wake
verbs (7.3). A `FlowState`'s `getRuntime().runtimeConfig` is the bundle the router uses and is what a script hands
`runAction`.

## 18. Warnings and the once-per-process switch

| | Rule | Source |
|---|---|---|
| `FSD_QUIET_WARNINGS=1` | Silences the once-per-process warnings that check it. **Only the value `1` counts.** Boot diagnostics that do not check it print regardless: the `[flowstate] active profile` line, and the filesystem store's one-time warning (which only `developmentOnly: true` silences). | `cor:deprecation.ts:19-40`; `once-per-process.ts:20-36`; `cfs:1024-1032`; `si:213-232` |
| `NODE_ENV=production` | Silences only the development-only subset (`warnOnceDev`). | `cor:deprecation.ts:19-22` |
| No `stores`, in production | `createFlowState has no \`stores\`, so this production app runs in memory and loses its sessions and requests on every restart. Set \`stores\` to a persistent adapter, such as \`stores: postgresStores({ connectionString })\`.` Printed once per process (`warnOnce`, so `NODE_ENV=production` does **not** silence it; `FSD_QUIET_WARNINGS=1` does). Not printed outside production. | `cfs:1033-1042`; `cor:deprecation.ts:24-32`; `t/stores-shorthand.test.ts:114-131` |
| Local cron on unelected lease, on Vercel | two `warnOnce` lines (12.2) | `cfs:1404-1429` |

Existing environment doc says `FSD_QUIET_WARNINGS` "suppress[es] the construction-time logs that report applied intent
overrides, and `NODE_ENV=production` also suppresses them" (`apps/docs/docs/configuration/environment.md:32`); that is a
different (dev-only) subset and is R-15's row. The one-line row stays on R-15; the `createFlowState` no-stores warning
detail is here.

## 19. The four questions, for what the stores persist

R-12 configures where data goes; it defines few stored parts of its own. For each part a setting on this page creates or
controls:

| Part | Who owns it | Who can see it | Where it is stored | How many | Source |
|---|---|---|---|---|---|
| Everything in the active profile's `primary` (sessions, requests, items, checkpoints, suspensions, leases, traces) | the app, through the handle that opened the stores; one active profile per `FlowState` | by what R-16 and R-20 say for each record (per-user, per-org); this page does not restate it | the active profile's adapter: memory, JSON files under the `rootDir` given to `filesystemStores` (no default; `.fsdev/data` is only the CLI's no-config store), a SQLite file, Postgres | one registry per `FlowState`; other declared profiles are never opened, though `dispose()` calls `dispose?.()` on their adapters (7.2) | `cfs:1012-1019`; `rs:52-129`; `packages/engine/src/stores/index.ts:283-303`. R-16 owns the detail |
| Default attachment folder (profile with no `blobs`, persisting stores) | the profile, by name | not checked on this sheet (R-16) | `.fsdev/blobs/<encodeURIComponent(profile)>` under the working directory | one per profile name | `rs:132-144` |
| Durability sweeper lease | the host, shared by every host on the store | no route lists it [negative search of `packages/engine/src/routes`; the request-lease routes read other keys] | the store's `leases`, key `__durability_sweeper__` | one record per store, held per tick for `sweepIntervalMs` | `dsw:169`, `:410-432` |
| Schedule-tick lease (local cron) | the host, shared by every host on the store | as above | `stores.leases`, key `__schedule_tick__` | one record per store, two intervals long, renewed | `ls:32-33`, `:56-100` |
| Wakes (a due time for an internal entry in a session) | the session that owes it; fired by whichever host's sweeper holds the lease | not checked on this sheet (R-19) | `stores.wakes` (in-memory, filesystem, SQLite and Postgres keep them) | one per session and internal entry | `rc:125-131`; `cfs:1224-1239` |
| `.fsdev/data/fsdev.db` (no-config CLI; config searched as `fsdev.config.ts`, `.mts`, `.js`, `.mjs` in that order, `fsd:load-config.ts:26-31`; `--store filesystem` on `run` and `dev` keeps JSON files under `.fsdev/data`; `--store` refused with a config) | the working directory; shared by `fsdev run`, `fsdev dev`, `fsdev chat` | whoever can read the folder; each process has its own in-memory change bus, so a run's writes do not push to a running `fsdev dev`'s open pages; they show on the next read | `.fsdev/data/fsdev.db` under the working directory | one file | `fsd:local-store.ts:3-28` |

## 20. Rows moved here by other pages' depth passes

The command that lists them: `grep -rhE --include=*.record.md -e '→ R-12( \(corrected by pass 5\))?$' docs/contributing/docs-revamp/pages`.
It returns **48** rows (none is marked "corrected by pass 5"); the numbers below are that command's line numbers. Each is
checked against the code and dispositioned. "Carried" means the row is true and is on this sheet; "corrected" means a
part was wrong and the corrected text is the one to carry; "dropped" is named with the reason.

| # | Row (abbreviated) | Disposition | Where / why |
|---|---|---|---|
| 1 | What a Lab config must export for Shift Manager | Carried | 16 |
| 2 | `createNextHandler` input is the handle, not `getRouter()` | Carried | 7.1, 13 |
| 3 | Default store profile: CLI SQLite, `createFlowState` memory | Carried | 5.3 |
| 4 | `flows` list, each under its `kind`; keyed object refused (page keeps only "a list") | Carried | 2.1, 3 |
| 5 | Node host rows: port, `/healthz`, `SIGTERM` drain and store release, `fsdev serve` equivalence | Carried | 13.1 |
| 6 | Startup refusals table: duplicate id, empty `stores`, webhook provider not set up | Carried, widened | 3. The webhook refusal fires at router build (`getRouter()`/`ready()`), not at construction; the duplicate-id class is `FlowIdentityConflictError`, not `FlowStateConfigError` |
| 7 | Store profiles per environment, `FSD_ENV`, fallback to `defaultProfile` | Carried | 5.2 |
| 8 | Store profile selection order, startup throw on undeclared `FSD_ENV` | Carried | 5.2, 3 |
| 9 | `request.heartbeatIntervalMs`: default, what the tick does, effect of `0` | Carried | 21 |
| 10 | `createInProcessFetch` signature, `basePath`, 404, match client `apiPath` | Carried | 17.1 |
| 11 | `flows` list shape, keyed record throws `FlowStateConfigError`, id lookup, `register`/`unregister` | Carried | 2.1, 3, 4. Lookup is `registry.get(address)` by instance id (`reg:308-309`) |
| 12 | `waitDeadlines` fields, `0 < minMs <= defaultMs <= maxMs`, throws at start, host that can hold a wait | Carried | 11.3 |
| 13 | `chat.default` and `devtool`, types, which command reads each | Carried | 2.9 |
| 14 | What a loaded `FlowState` supplies vs what the CLI adds | Carried | 16 |
| 15 | Proxy settings for streams | Carried as a short section | 14. The guide's `add_header X-Accel-Buffering` and its explanation are **dropped** (the framework sets the header itself on the upstream `POST` streams; `proxy_buffering off` covers the `GET` streams) |
| 16 | Hosts: package and entry, port and bind defaults, `staticDir`, Lambda invoke mode, Next.js 15, `shutdownGraceMs`, in-process failures | Carried | 13, 13.1, 17.1 |
| 17 | Next.js mounting: `[[...path]]` vs `[...path]` plus sibling, adapter precedence, `TransportRouteCollisionError`; `baseUrl` and `apiPath` rules | Carried, `baseUrl` half dropped | 13. The client's `baseUrl` (origin, or `""` for the page's own origin; required without a `fetcher`) and `apiPath` (default `/api/flows`; set to the server's mount, such as `serve()`'s `basePath`) are R-14's options (`packages/client/src/client.ts:55-73`); R-12 keeps one line: match `apiPath` to the mount |
| 18 | Flow registry: one instance per id, duplicate refused | Carried | 3 |
| 19 | Deadline rule: raw suspend uses only `timeoutMs`; `userDeadlineMs` 1,000 to 31,536,000,000 | Carried | 11.4. The range is milliseconds: 1 second to 365 days (`rc:189-192`) |
| 20 | `durabilityRetention` fields and defaults | Carried, corrected | 11.2. The sweeper runs whenever durability is on; `durabilityRetention` turns **pruning** on |
| 21 | One host sweeps at a time on a shared store; `createFlowApiRouter` runs the sweeper only with a provider | Carried | 11.2 |
| 22 | Durable defaults per command and store, router and `runAction` need a provider, `createCheckpointDurabilityProvider` | Carried | 5.3 |
| 23 | `userDeadlineMs`: what happens to an open question at the deadline | Carried in part | 11.4. The effect on an `approval`, a `review` and an `input` is verified; the board's closing of a held question "on its first touch past its deadline, and the work goes on as if answered" is R-23's and was **not** re-verified here, so the page links to it rather than stating it |
| 24 | `shutdownDrainMs`: default 10 s, what shutdown waits for | Carried, corrected | 7.2 step 3. It is a `createFlowApiRouter` option, not a `createFlowState` field; `FlowState.dispose()` always uses 10 s; `serve()` passes what is left of its grace window. It is not in the fields table |
| 25 | `publicReentrySources`: default and refused sources | Carried | 10 |
| 26 | `publicReentrySources`: how a custom transport source is allowed | Carried | 10 |
| 27 | `models` / `modelResolver`: seven forwarded options, `intentDefaults` and `env` not, `modelResolver` replaces `models`; `createFlowApiRouter({ modelResolver })` | Carried | 8 |
| 28 | `staleSweepIntervalMs`, `staleSweepThresholdMs`, `queuedGraceMs`: defaults and startup refusal | Carried | 2.6, 3. Only `queuedGraceMs` refuses; a bad interval disables the sweeper, a low threshold warns |
| 29 | Queued runs are a host setting covering every action; `durable: true` clears suspension records and lease and does not move the run | Carried | 11.1, 12.1. The `durable: true` in the row is the **action** field, not the host option |
| 30 | `jobQueue` with `runner` throws; old `worker` throws; stores every process reaches | Carried | 12.1. The retired `dispatcher` option also throws (plain `Error`) |
| 31 | When job processing starts; `dispose()` closes processing before stores | Carried | 12.1, 7.2 |
| 32 | `dispatchDrainTimeoutMs` (30000), rounds (32), messages, cancelled status, what the drain does not wait for, `fsdev run` and `NoRequestHostError` | Carried, last clause corrected | 7.3. The no-config `fsdev run` dispatch error reads as `NoDispatchSeamError` (`code: "no-dispatch-seam"`), not `NoRequestHostError` [not run; pass 5 should run it] |
| 33 | `heartbeatIntervalMs: 0`: long runs marked `interrupted` while running, resume offers (double start), no cross-process cancel | Carried | 21. "The same work can start twice" is the existing page's claim (`apps/docs/docs/server/background-work.md:398-411` [doc]); the code shows an `interrupted` run is offered for resume, and this sheet did not run a double start |
| 34 | `waitDeadlines` defaults, refusal, out-of-range refused not clamped, `userDeadlineMs` | Carried | 11.3, 11.4 |
| 35 | `errorCapture` and `onError`: where each is passed, type, async and swallowed throw, `onError` as the HTTP sink | Carried | 9 |
| 36 | Selection row: `FSD_ENV` > `defaultProfile` > first; unknown throws at runtime build not import; empty counts as unset; `NODE_ENV` never | Carried | 5.2 |
| 37 | Warnings row: only `1`; `NODE_ENV=production` silences only the dev-only subset; the no-`stores` warning prints in production | Carried | 18 |
| 38 | Async start: router resolved on first request; handle not `getRouter()`; `createVercelNextHandler` Next 15 | Carried | 7.1, 13 |
| 39 | `getRouter()` opens stores lazily, same router each call; `default` profile, `primary` slot | Carried | 4, 5.1 |
| 40 | `default.primary` catch-all; `sqliteStores({ filename })` persists only if the path is durable | Carried in part | `default.primary`: 5.1. The "durable path" half is a deployment fact about the filename; the code shows only that `sqliteStores` opens the file at that path (`fsd:local-store.ts:77`). **Dropped from this page** unless R-16 carries it |
| 41 | `onError(error, context)` called on API errors with method and path | Carried | 2.4, 9 |
| 42 | Push by host | Carried | 15 |
| 43 | `serve()` push options: `pushSecret`, mismatched-key refusal, `push: false` | Carried | 13.1, 15 |
| 44 | Default store per entry point; in-memory lost on restart | Carried | 5.3, 18 |
| 45 | `runtimeConfig` for in-process runs: required object; generator fails without a `modelResolver` | Carried, second half **dropped** | 17.2. Without a `modelResolver` the run builds one from the environment (`createExecutionContext.ts:3029-3031`); it does not fail for that |
| 46 | FlowState lifecycle: `ready()`, `dispose()`, one live worker generation, HMR, signal handlers | Carried, narrowed | 7.4. "One live generation" is the guide's recommendation plus `dispose()` idempotence, not an engine guarantee: nothing disposes a predecessor for the app |
| 47 | `chat.default` type, format, effect on bare `fsdev chat` | Carried | 2.9 |
| 48 | Which profiles hold a pause by default; in-memory fails at the gate naming the setting; defaults for `fsdev dev` and `fsdev run` | Carried | 5.3 |

## 21. `request.heartbeatIntervalMs` and `request.sseHeartbeatMs` (flow fields this page's rows point at)

Both are fields of a flow's `request` config (R-05 owns the table); R-12 keeps the effects that depend on the runtime
settings above.

| Field | Default | Effect | Source |
|---|---|---|---|
| `request.heartbeatIntervalMs` | `10000` | One timer per running request: each tick writes the active-request heartbeat (so the stale sweeper does not mark the run `interrupted`) and polls the request record for a cancellation recorded elsewhere (so a cancel issued on any process lands on the process running the work, within one interval). A tick whose store call fails is logged and does not abort a healthy run. | `flow:422-433`; `ra:1430-1506`; `packages/engine/src/routes/abort-routes.ts:26-35` |
| `request.heartbeatIntervalMs: 0` | | No timer. A recorded cancel is never delivered to a **running** request (each run still checks once as it starts). The registry entry is never refreshed, so a run longer than `staleSweepThresholdMs` can be marked `interrupted` while it runs. An `interrupted` request is offered for resume, so the same work can start twice. The liveness gate (concurrency across processes) also refuses with `heartbeat-too-slow`. | `flow:424-433`; `ra:1491`; `packages/engine/src/context/liveness-gate.ts:112-127`; `apps/docs/docs/server/background-work.md:398-411`, `server/connection-resilience.md:141` [doc] |
| `request.sseHeartbeatMs` | host `defaultSseHeartbeatMs` (15000) | SSE ping per flow; `0` disables | `flow:434-440`; `packages/engine/src/transports/host/createInboundTransportHost.ts:798-800` |

## 22. Existing text this sheet found untrue (for pass 8 and the neighbours)

Not carried; the page must not repeat them. Neighbour pages and docs that still say them need the same fix (section 5
of the writer's brief: keep the neighbours honest). I did not edit them: this pass writes only this sheet.

| Where | Says | Code says |
|---|---|---|
| `rt:40-41`, `su:60`, `api` | `flows` and `stores` are required; `flows` is a `Record` | Neither is required; `flows` is a list; a record is refused at construction (1, 3) |
| `rt:64`, `rt:117-127`, `apps/docs/guides/background-jobs-bullmq.md:79-102` | `worker: bullmqWorker(...)`, modes `dispatch-only` / `worker-only`, mutually exclusive with `runner` | The option is `jobQueue`; the BullMQ factory is `bullmqJobQueue`; the modes are `colocated`, `enqueue-only`, `process-only`; `worker` throws (12.1) |
| `rt:99-102`, `su:78`, `api:100` | `blobs`, `queue`, `scheduler` are reserved slots, no-ops | The slots are `primary`, `bus`, `blobs`; `blobs` backs attachments; `queue` and `scheduler` are not slots (5.1) |
| `rt:26-32` | `getRuntime()` returns `{ registry, stores, runtimeConfig }`; `dispose()` "Close workers, then store adapters" | Also `resolvePrincipal` and `chat`; the order is in 7.2 |
| `rt:60-63` | `durabilityRetention` "Sweeper for expired suspensions, leases, and orphaned checkpoints" | The sweeper runs whenever durability is on; `durabilityRetention` enables pruning only (11.2) |
| `api:75-79` | Shutdown order omits the scheduler, the router's own drain (10 s), and the 5 s recovery wait | 7.2 |
| `su:123-131` | "`NODE_ENV` is intentionally not consulted... conflating the two is how a local build ends up pointed at a live database" | The first half is true; the rationale is design defence and stays off the page |
| `su:144-185` | Wording like "intentionally" and `createVercelNextHandler` sample comments | Behaviour only (13) |

## 23. What the page must not state

- Why `NODE_ENV` is not consulted (rationale).
- The names of retired options as history. A refusal row (3) names what the error says, which includes the retired
  option's name because that is the message the reader sees.
- Internal constants with no observable effect: `MAX_DETACHED_DRAIN_ROUNDS` is observable (the loop bound); the
  `RECOVERY_SWEEP_DRAIN_MS` 5 s is observable at shutdown and is listed; the abort-unwind constants are folded into
  "the smaller of 2 s and a quarter of the budget".
- Anything in a code comment that cites a tracker id.

## 24. Pass 3 dispositions (what the draft leaves out of the rows above)

Every row in section 20 that the draft carries is carried as dispositioned there. These parts of carried rows, and
other sheet facts, are left off the page:

| Left off | Row or section | Why |
|---|---|---|
| `NoDispatchSeamError` for `fsdev run` with no config; the stay-up behaviour of `fsdev run` with a config | 20 row 32; 7.3 | Both rest on non-exported function bodies and were not run [impl]. Pass 5 can run them; until then the page makes no claim. |
| What `onError` does when it throws | 9 | [impl] only. The table cell is left empty. |
| Source file and line citations, the `[doc]` marks and the [run] marks | all | They belong on the sheet, not the page. |
| The code's JSDoc calling `blobs` a reserved no-op, and the older pages' wrong claims | 5.1, 22 | Section 22 text is not carried (outsider rule). |
| Why `NODE_ENV` is not consulted | 23 | Rationale. |
| Which package exports `FlowIdentityConflictError`, `TransportRouteCollisionError` | 3 | The page says only that neither is exported (the sheet's grep of the two entry points). |

## 25. Round 1 of pass 8: what left the page, and what was corrected

The runtime page is now the `createFlowState` field list, the failure table, the handle, start and shutdown, how the
profile is chosen, settings, and the two rows of what the settings store. The sections below were moved off the page
by pass 6 and stay on this sheet, as the rows the receiving pages carry. Nothing on this sheet about them is a claim
the runtime page makes now.

| Sections of this sheet | Left the page for |
|---|---|
| 5.1 slots and factory tables; 19 rows for leases, wakes and the attachment folder | R-16 Stores |
| 5.3 which profiles hold a pause; the no-config defaults table | R-17 (pause table), R-35 (defaults) |
| 7.3 the dispatch drain | R-19 Background work |
| 8 Models | R-21 Models |
| 9 `errorCapture` and `onError` | R-22 Errors |
| 10 `publicReentrySources`; 13 hosts, `serve()`, the network guard and Next.js mounting; 14 proxy; 15 push; 17.1 `createInProcessFetch` | R-13 HTTP API (the network guard also R-20) |
| 11 durability, waits and deadlines | R-17 Pause, resume and replay |
| 12.1 `jobQueue` | R-19 (the concurrency half R-18) |
| 12.2 `scheduler` arming and warnings | R-33 Schedules |
| 16 what the CLI adds; the 5.3 defaults | R-35 CLI |
| 17.2 `runAction` and `runtimeConfig` | the generated engine API page |
| 18 warnings | R-15 Environment variables |
| 21 request heartbeats | R-05 Flows and actions |
| the Shift Manager Lab config paragraph | the generated Shift Manager API page |
| 3 kit refusal rows | R-11 Kits and slots |

Dropped from the page in the same round, as the editor asked: the org clause in the example app (the orgs were never
used), the design-defense sentence on `onBackgroundWork`, the top-level-await remark, and the "so it does not write
through closed stores" clause.
Corrected, as pass 5 found: `batchLimit` is a page size (11.2); `createServerApp` returns a `ServerApp` whose `.app` is
the Hono app (13); the local cron arms on `process-only` job processing, not on any job processing (12.2, and the
`scheduler` row says only that it needs a registered scheduled flow). On the shutdown budget, the two statements agree:
`FlowState.dispose()` takes no argument, so the router's `shutdownDrainMs` is 10 s; the `ServerApp` dispose that
`serve()` calls takes `drainMs`, and `serve()` passes what is left of its grace window (`nap:213-221`, `node/src/serve.ts:298`).

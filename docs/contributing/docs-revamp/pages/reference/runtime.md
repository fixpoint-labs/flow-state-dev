---
title: Runtime configuration
type: reference
description: "Every createFlowState field, what a bad config fails on, the FlowState handle, how a store profile is chosen, settings, and start and shutdown."
---

# Runtime configuration

`createFlowState` is the one call that turns an app's flows into something that runs. A flow is a self-contained system inside your app, with the actions it exposes. `createFlowState` takes a single options object (the flows, where data is stored, which models to use, how a crashed run recovers, where background work runs) and returns a handle, the `FlowState`, that a host such as Next.js or a Node server mounts to answer HTTP requests. There is no second config file. Apart from a few environment variables, such as `FSD_ENV`, this object is the whole answer to "how is this app set up?"

Every field is optional and has a default. `createFlowState({})` runs an empty app in memory, and each field you add moves one decision from the default to you. Construction is synchronous and opens nothing. Stores, kit folders and the router are built on first use, which is why a handle can be created at import time in a serverless route file.

This page lists the fields, what a bad config fails on, and the rules for choosing a profile, starting and shutting down. A field whose rules run long links to the page that holds them. [Serving flows](../concepts/serving-flows.md) explains the model. The examples use one app: a support desk with a `support-desk` flow.

## Quick answers

| Question | Answer |
| --- | --- |
| Which fields are required? | None. The options object itself is required: `createFlowState({})` is valid. |
| How is a store profile chosen? | `FSD_ENV` if set and non-empty, else `defaultProfile`, else the first declared profile. `NODE_ENV` never chooses. See [How the profile is chosen](#how-the-profile-is-chosen). |
| What happens with no `stores`? | The app runs in memory and loses every session and request on restart. |
| When does a bad config throw? | Most checks run when `createFlowState(...)` is called; the rest run at the first `ready()`, `getRouter()` or `getRuntime()`. See [When a bad config fails](#when-a-bad-config-fails). |
| What does a host take? | The handle `createFlowState` returns, not `getRouter()`. Hosts are on [HTTP API](./http-api.md). |
| Where does `dispose()` stop first? | The scheduler, then the router, then dispatched runs, then the job queue, then the stores. See [`dispose()`](#dispose). |

## The smallest working config

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { postgresStores } from "@flow-state-dev/store-postgres";
import { supportDesk } from "./src/flows/support-desk/flow";

export default createFlowState({
  flows: [supportDesk],
  stores: {
    development: { primary: sqliteStores({ filename: "support-desk.sqlite" }) },
    production: { primary: postgresStores({ connectionString: process.env.DATABASE_URL }) },
  },
  defaultProfile: "development",
  models: { default: "openai/gpt-6-luna" },
});
```

`supportDesk` is a flow instance, defined in its own file. `fsdev run`, `dev`, `chat` and `serve` load this file and expect the handle as its default export. `FSD_ENV=production` runs the same file against Postgres.

`createFlowState`, `inMemoryStores` and `filesystemStores` come from `@flow-state-dev/engine`. The options type `CreateFlowStateOptions` and the handle's helper types (`FlowStateRuntime`, `JobQueueAdapter`, `SchedulerAdapter`, `RuntimeConfig`, `ErrorCaptureHandler`) come from `@flow-state-dev/engine/host`, which also exports `isFlowState(value)`. The root export has the type `FlowState` only.

## Fields

**At construction** means the synchronous `createFlowState(...)` call. **At start** means the first `ready()`, `getRouter()` or `getRuntime()`.

### What the app is made of

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `flows` | `readonly FlowInstance[]` | `[]` | Flow instances. Each is served under its `flow.id`, which is its `kind` unless the instance was given another. Two with one id are refused at construction. A keyed record is refused at construction, with a message naming the list form. |
| `kits` | `readonly KitInstance[]` | `[]` | Kits to install, each a kit's factory called with its config: `kits: [harnesses({}), workforce({ model })]`. They install in the order their `requires` set, whatever order you list. Their flows are served beside `flows` and are registered at start, so `meta.flowKeys` lists them only after start. |
| `fill` | `Readonly<Record<string, unknown>>` | none | The app's own entries for kits' slots, by slot key. A keyed slot takes a record, or a list of entries each keyed by its `id`. A list slot gets the app's entries last. |
| `root` | `string \| URL` | working directory | The folder a kit's default folder is read against: a path, or a URL such as `import.meta.url` (its directory). A `directory` in a kit's own config reads against the working directory instead. |

What a kit refuses is on [Kits and slots](./kits.md). The kit contract is there too.

### Models and voice

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `models` | `FlowStateModelsConfig` | none | A model resolver config. The options are on [Models](./models.md). |
| `modelResolver` | `ModelResolver` | built from `models` | A pre-built resolver, used in place of one built from `models`. For mocks (`createMockModelResolver`) or a custom resolver. |
| `voice` | `{ provider?: VoiceProvider }` | none | The voice provider for text-to-speech and speech-to-text, passed as an instance: `new OpenAIVoiceProvider({ apiKey })`. A flow's own `voice.provider` wins. |

### Stores and settings

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `stores` | `StoreAdapter \| StoresConfig` | in memory | Omitted (in memory, as the `default` profile), one adapter (`{ default: { primary: adapter } }`), or named profiles that each map slots to adapters, with at least one profile. An adapter is told from a profile map by its `resolve` function and `capabilities` array. See [Store profiles](#store-profiles). |
| `defaultProfile` | `string` | first declared profile | The profile used when `FSD_ENV` is unset. It must name a declared profile, or construction throws. |
| `settings` | `FlowStateSettings` | `{}` | Read in blocks as `ctx.settings`. See [Settings](#settings). |

### Errors and hooks

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `onError` | `(error: Error, context: { method: string; path: string }) => void` | none | The HTTP-level sink. Called when a route throws an error nothing handled, with the upper-case method and the request path. The response is sent regardless: status from the error, body `{ error: message }`. |
| `errorCapture` | `ErrorCaptureHandler` | none | A block-aware sink. See [Errors](./errors.md). |
| `onBackgroundWork` | `(promise: Promise<unknown>) => void` | none | Keeps work that outlives the response alive. Pass the platform's post-response primitive: on Vercel with Next.js, `(p) => after(() => p)` from `next/server`. |
| `adapters` | `InboundTransportAdapter[]` | none | Custom inbound transports mounted beside the built-in HTTP adapter and the scheduled endpoint. Their routes match before the canonical ones. Two adapters declaring one method and path throw `TransportRouteCollisionError` at start. |
| `resolvePrincipal` | `PrincipalResolver` | trusts the body's `userId` | The host's resolver for a flow with no `authentication.resolvePrincipal`. A flow's own always wins. The default trusts a caller-supplied `userId`, so `serve()` refuses to bind a non-loopback host, and a mounted handler refuses requests, unless you pass `allowUnauthenticated: true`. See [Authentication and tenancy](./authentication.md). |

### Debug and stream settings

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `debugEndpointsEnabled` | `boolean` | `false`, or `true` when `FSDEV_DEBUG_ENDPOINTS` is `1` | The privileged read-only debug routes. An explicit value wins over the variable. Disabled, they answer `403 { error: "debug_endpoints_disabled" }`. |
| `debugAllowAnonymousLocal` | `boolean` | `false`, or `true` when `FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL` is `1` | Lets a request with no `Origin` header (curl, a script, a same-origin browser GET) reach the debug routes. Off, it gets `403 { error: "debug_endpoints_origin_rejected", origin: null }`. A request whose `Origin` is not loopback is rejected either way. Use it only on a server bound to loopback. |
| `defaultSseHeartbeatMs` | `number` | `15000` | The SSE ping interval for every live and attach stream whose flow sets no `request.sseHeartbeatMs` (see [Flows and actions](./flows.md)). `0` disables. |

### Sweeps and recovery

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `detectInterruptedOnStartup` | `boolean` | `true` | At start, scan for requests a previous process abandoned and mark them `interrupted`. Turn it off on serverless, where cold-start queries can contend with the first request. |
| `staleSweepIntervalMs` | `number` | `30000` | How often the stale-request sweeper runs. `0`, a negative number or a non-finite one disables it. It runs only in a process that built a router (`ready()` or `getRouter()`). |
| `staleSweepThresholdMs` | `number` | `60000` | A running request whose heartbeat is older than this is marked `interrupted`. A threshold under 20000 ms, twice the sweeper's fixed 10 s heartbeat interval, logs a warning, whatever `request.heartbeatIntervalMs` the flows set (see [Flows and actions](./flows.md)). The sweeper reads no flow's value. |
| `queuedGraceMs` | `number` | `600000` (10 min) | How long a request an external queue holds, unclaimed, may sit before a sweep treats it as lost. Queued requests have no heartbeat. Must be finite and non-negative, or start throws. `0` reaps as soon as stale. |
| `maxChildSessionListLimit` | `number` | `100` | The largest `limit` the child-session listing route accepts. A positive safe integer, or start throws. |
| `publicReentrySources` | `readonly string[]` | none | Sources your own transports stamp, added to the sources allowed on `retry`, `continue` and `resume`. See [HTTP API](./http-api.md). |
| `noticeIds` | `{ session?, user?, org? }`, each a boolean | all on | Whether change notices for a scope (`session`, `user` or `org`) name what changed: a task, an entry, a session. With `{ org: false }`, org notices reach a browser subscribed to the whole org, but carry no ids and no collection entry's key. A subscription a client narrowed to one entry hears that entry's path. It applies to every stream and notice the app sends to a browser. Any other key, or a non-boolean, throws at start. |

### Durable execution

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `durable` | `boolean` | on wherever the stores persist | Durable execution for the whole host. `false` turns it off. `true` turns it on over in-memory stores too, for tests. See [Pause, resume and replay](./durable-execution.md). |
| `durabilityRetention` | `{ sweepIntervalMs?, checkpointMaxAgeMs?, suspensionTerminalMaxAgeMs?, orphanCheckpointThresholdMs?, batchLimit? }` | unset: no pruning | Retention for the durability sweeper. Only with durability on. |
| `maxDebtAgeMs` | `number` | `86400000` (24 h) | How long scheduled work, such as delivering a background task's end notice, may stay overdue. Work overdue for longer is dropped and logged. Only with durability on and a store that keeps wakes. |
| `waitDeadlines` | `{ defaultMs?, minMs?, maxMs? }` | `300000`, `1000`, `86400000` | The deadline a wait that names none gets, and the shortest and longest one may name. |
| `userDeadlineMs` | `number` | unset | The deadline a stop that waits for a user gets when it names none. A whole number of ms from 1000 to 31536000000, or start throws. |

### Where work runs, and schedules

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `jobQueue` | `JobQueueAdapter` | none: in process | A job queue adapter such as `bullmqJobQueue(...)` from `@flow-state-dev/bullmq`. Mutually exclusive with `runner`. See [Background work](./background-work.md). |
| `runner` | `FlowRunner` | in process | A low-level hook for where actions run. `jobQueue` is the usual choice. Mutually exclusive with `jobQueue`. |
| `dispatchDrainTimeoutMs` | `number` | `30000` | How long `dispose()` waits for dispatched runs that are running in this process. See [Background work](./background-work.md). |
| `scheduler` | `SchedulerAdapter \| false` | built-in local cron | When schedules fire. Omitted: a local cron ticks each minute, when a registered flow declares static schedules or a schedule index. `false`: nothing fires the tick. An adapter such as `vercelScheduler()` from `@flow-state-dev/vercel` fires it itself. When the cron is armed is on [Schedules](./schedules.md). |

### Read by commands

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `chat` | `{ default?: string }` | none | The target `fsdev chat` binds when given no flow: `"<flowKind>"` for a flow with one action, or `"<flowKind>.<action>"`. An unknown flow, an unknown action or a bare kind with several actions is a config error (exit code `EXIT_CONFIG_ERROR`). |
| `devtool` | `{ userId?: string; bearerToken?: string }` | none | Read only by `fsdev dev`. `userId` becomes the DevTool's session identity and `bearerToken` the `Authorization: Bearer` token it sends on flow requests. A blank value counts as unset. The page receives it only when the host is loopback. `fsdev serve` ignores it. |

## When a bad config fails

Construction throws from `createFlowState(...)`. A failure while building the runtime (kits, stores, profile, models, config validation, job queue) rejects `ready()`, `getRouter()` and `getRuntime()`, and every later call returns the same rejection. A failure while building the router (the rows marked "at router build") rejects only `ready()` and `getRouter()`; `getRuntime()` has already resolved. `FlowStateConfigError` has `name` `"FlowStateConfigError"` and `code` `"flowstate_config_error"`, and is not exported from any entry point: tell it by `name` or `code`. `FlowIdentityConflictError` and `TransportRouteCollisionError` are not exported either.

| What | Fails at | Error | The message names |
| --- | --- | --- | --- |
| `stores` is an empty object | construction | `FlowStateConfigError` | `createFlowState: stores must declare at least one profile` |
| `defaultProfile` is not a declared profile | construction | `FlowStateConfigError` | the profile, and `Declared profiles: ...` |
| `flows` is not a list | construction | `FlowStateConfigError` | the list form: `flows: [readiness, context]` |
| Two flows share an id | construction | `FlowIdentityConflictError`, reason `duplicate-id` | `Flow "ping" with id "ping" is already registered` |
| A singleton flow given a custom id (`singleton-id-mismatch`). One kind registered as both singleton and collection (`mixed-cardinality`). A cardinality that is neither `"singleton"` nor `"collection"` (`invalid-cardinality`). An empty or non-string id (`invalid-id`). A flow that takes config passed as its `defineFlow(...)` result, without calling it with its config (`unminted-config`) | construction | `FlowIdentityConflictError`, with the code in parentheses as `reason` | the kind and id, with the remedy |
| Two flows' user- or org-scoped state schemas conflict | construction | `CrossFlowSchemaConflictError` | both flows, the scope and the field |
| `jobQueue` and `runner` together | construction | `FlowStateConfigError` | `` `jobQueue` and `runner` are mutually exclusive `` |
| An unknown `jobQueue.mode` | construction | `FlowStateConfigError` | the three valid modes |
| Passing `worker`, which is not a field | construction | `FlowStateConfigError` | `` Pass the same adapter as `jobQueue`. `` |
| Passing `dispatcher`, which is not a field | construction | plain `Error` | `` Pass the same FlowRunner as `runner`. `` |
| `FSD_ENV` names an undeclared profile | start, and the `activeProfile` getter | `FlowStateConfigError` | `FSD_ENV="nope" but no profile "nope" is declared. Declared profiles: ...` |
| A profile slot whose adapter does not declare that capability | start | `FlowStateConfigError` | the profile, the slot and what the adapter declares |
| `userDeadlineMs` outside 1000 to 31536000000, or not a whole number | start | plain `Error` | `userDeadlineMs must be a whole number of milliseconds from 1000 to 31536000000` |
| `noticeIds` with a key other than `session`, `user`, `org`, or a non-boolean | start | plain `Error` | the refused keys |
| `maxChildSessionListLimit` not a positive safe integer | start | plain `Error` | the value |
| `queuedGraceMs` not finite and non-negative | start | plain `Error` | the value |
| `publicReentrySources` naming `webhook`, `task` or `internal` | start, at router build | plain `Error` | `publicReentrySources cannot include "webhook": ...` |
| `waitDeadlines` not finite, or breaking `0 < minMs <= defaultMs <= maxMs` | start, only on a host that holds waits | plain `Error` | `wait deadlines must be finite and satisfy 0 < min <= default <= max; got min ..., default ..., max ...` |
| A flow declares a webhook provider the mount did not configure | start, at router build | plain `Error`, rejecting `getRouter()` | `Webhook adapter: flow "<kind>" declares webhooks for provider "<name>" but no provider definition was supplied` |
| Two adapters declare one method and path | start, at router build | `TransportRouteCollisionError` | `Route collision on <METHOD> <path>: declared by adapters [...]` |
| `models.intents` set with no `models.default` | start | plain `Error` | `createModelResolver: defaultModel is required when intents are configured` |
| A `models.default` that is an `intent/*` string | start | plain `Error` | `createModelResolver: defaultModel must not be an intent/* string (got "...").` |
| A job queue that cannot start | start | whatever the adapter throws | the adapter's message |
| `getRouter()`, `ready()` or `getRuntime()` after `dispose()` | the call, thrown synchronously and not as a rejected promise | `FlowStateDisposedError`, code `flowstate_disposed_error` | `FlowState.getRouter()/ready() called after dispose()`, or `FlowState.getRuntime() called after dispose()` |

Some out-of-range values do not throw. A negative `dispatchDrainTimeoutMs` reads as `0` and a non-finite one as the default. A non-finite `staleSweepIntervalMs` disables its sweeper.

## The `FlowState` handle

`createFlowState` returns it synchronously and opens nothing.

| Member | What it does |
| --- | --- |
| `getRouter()` | `Promise<FlowApiRouter>`, an object with `GET`, `POST`, `PATCH` and `DELETE`. The first call opens the stores. Every call returns the same router. |
| `getRuntime()` | `Promise<FlowStateRuntime>`: `{ registry, stores, runtimeConfig, resolvePrincipal, chat? }`, the same instances the router uses. For workers and scripts. Memoized, and it starts job processing the way `getRouter()` does. |
| `ready()` | Eager warm-up. Idempotent. Resolves once the router is built. |
| `dispose()` | Releases everything, in the order below. Idempotent. |
| `register(flow, options?)` | Admits one instance after construction and runs the construction checks. A refused registration changes nothing. It takes one instance, never a list. The flow is served from the next request, in this process only; a sibling process picks it up when it next starts. Throws `FlowIdentityConflictError` or `CrossFlowSchemaConflictError`, and throws when `options.pin` disagrees with a pin on the instance. |
| `unregister(id)` | Releases one address. Returns `true` when an instance held it and `false` for an unknown id. Cancels nothing: a running request finishes and its items persist. Sessions, scope state and resources stay. Same per-process window as `register`. |
| `resolveInProcessPrincipal(question)` | Who an in-process caller is, answered the way the HTTP routes answer a request: the flow's own resolver, else `resolvePrincipal`. `fsdev run` and `fsdev chat` ask this before they write anything. |
| `activeProfile` | The profile name. Resolved on first use; reading it before start resolves it and throws if `FSD_ENV` names an undeclared profile. |
| `settings` | The `settings` object, or `{}`. Read-only. |
| `meta` | `{ flowKeys, profileKeys, declaredSlots, devtool? }`, read synchronously with no store opened. `flowKeys` lists the instance ids registered at the time you read it, so a flow added with `register` appears and an unregistered one does not. `declaredSlots` is `{ profile: slot names }`. `devtool` is the option as given. |

`isFlowState(value)` checks structure (`getRuntime`, `getRouter`, `ready` and `dispose` are functions), so a duplicated engine install does not reject a valid handle.

## Start and shutdown

### Async start

Construction is synchronous. Stores, kit folders and the router are built lazily, once, on the first `ready()`, `getRouter()` or `getRuntime()`. A host's first request resolves the router, so a host takes the handle, not `getRouter()`:

```ts title="src/app/api/flows/[[...path]]/route.ts"
import { createNextHandler } from "@flow-state-dev/next";
import flowState from "../../../../../fsdev.config";

export const { GET, POST, PATCH, DELETE } = createNextHandler(flowState);
```

Database adapters open their pools at start, not at import, and a bad connection string surfaces at the first `ready()`. Call `ready()` early (in `instrumentation.ts`, a test, or a process that must consume a queue from boot) to move that cost off the first request. Hosts, `serve()` and in-process calls are on [HTTP API](./http-api.md).

What start does, in order:

1. Installs kits: reads their folders and registers their flows.
2. Resolves the profile and opens its stores.
3. Builds the model resolver and the runtime config.
4. Installs dispatch, wait-resume and wake operations.
5. Starts the startup recovery sweep, unless `detectInterruptedOnStartup` is `false`.
6. Wires and starts the job queue.
7. For `ready()` and `getRouter()`: builds the router, with its sweepers and adapters' `start` hooks, and arms the local cron.

A host that only calls `getRuntime()`, as `fsdev run` and `fsdev chat` do, builds no router and so runs no stale-request or durability sweeper. A start that fails releases what it opened when you call `dispose()`.

### `dispose()`

After `dispose()`, `getRouter()`, `ready()` and `getRuntime()` throw `FlowStateDisposedError` synchronously. It runs these steps in order. A step that fails is written to `console.error` and shutdown goes on.

1. Stops the scheduler and lets a running tick settle.
2. Waits for an in-flight start to settle. A failed start is ignored.
3. Disposes the router this handle built: stops the stale-request and durability sweepers, waits up to 10 s for requests that are finishing, and aborts the rest and logs how many were cut off. Then it calls each transport adapter's `stop` hook in reverse order. `FlowState.dispose()` takes no argument, so the wait is 10 s. Under `serve()`, the wait is whatever remains of its grace window.
4. Waits for dispatched runs started in this process, up to `dispatchDrainTimeoutMs`. The drain's rules are on [Background work](./background-work.md).
5. Waits up to 5 s for the startup recovery sweep. This value is fixed.
6. Closes the job queue's processing handle, which waits for jobs this process already claimed (that wait is not bounded by `dispatchDrainTimeoutMs`), then calls the adapter's `close()`.
7. Calls `dispose()` on every distinct store adapter declared in any profile. Start opens only the active profile's adapters, so the others are released without having been opened.

### Hot reload and signals

A dev server that re-evaluates the config module on every edit builds a new `FlowState` each time, and a new job queue consumer with it. Dispose the previous handle when the module re-runs, so only one job queue consumer runs at a time, and do not cache the handle on `globalThis`, which freezes flows and config until a restart. Register `SIGTERM` and `SIGINT` handlers once, behind a `globalThis` flag. The engine registers no signal handler. `serve()` registers `SIGTERM` and `SIGINT` unless `handleSignals: false`, and `fsdev serve` registers its own.

## Store profiles

A profile names the adapters a run reads and writes through. [Stores](./stores.md) holds the slots (`primary`, `bus`, `blobs`), what each store factory declares and what each store persists. This section covers how `createFlowState` picks a profile.

### How the profile is chosen

First match wins.

1. `process.env.FSD_ENV`, when set and non-empty. An empty string counts as unset. It must name a declared profile, or `FlowStateConfigError`.
2. `defaultProfile`.
3. The first declared profile, the first key of the `stores` object.

`NODE_ENV` is never consulted. The choice is made on first use (`ready()`, `getRouter()`, `getRuntime()` or reading `activeProfile`) and is then fixed for the handle. An unknown `FSD_ENV` throws then, not when the module is imported. With one adapter or no `stores`, the only profile is `default`, so an `FSD_ENV` naming another profile throws the same way.

Start prints `[flowstate] active profile: "<name>"` on stderr once per process per profile. With no `stores` it adds that the app runs in memory and nothing persists across a restart. `FSD_QUIET_WARNINGS` does not silence it.

## Settings

`settings` is config every block can read as `ctx.settings`. It is process-wide, one shape for every flow, and typed by declaration merging into `FlowStateSettings`:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { supportDesk } from "./src/flows/support-desk/flow";

declare module "@flow-state-dev/core" {
  interface FlowStateSettings {
    sandbox: { type: "local" | "vercel" | "memory" };
  }
}

export default createFlowState({
  flows: [supportDesk],
  settings: { sandbox: { type: "local" } },
});
```

`flowState.settings` returns the object, or `{}`. For a value that differs between two registered copies of one flow, use the flow's `config`, read as `ctx.flow.config`, not `settings`. A script that calls `runAction` passes settings as `runtimeConfig.settings`.

## Without `createFlowState`

`createFlowApiRouter` and `runAction` run durable execution only when given a durability provider. `createFlowState` supplies one. Without it, call `resolveDurabilityProvider({ stores, durable? })` (root export), or `createCheckpointDurabilityProvider(stores)` for the default provider.

## What the stores persist

| Part | Owner | Where it is stored | How many |
| --- | --- | --- | --- |
| Everything in the active profile's `primary` | The app, through the handle that opened the stores. One active profile per `FlowState`. | The profile's adapter: memory, JSON files under the `rootDir` you give `filesystemStores`, a SQLite file or Postgres. | One set of stores per `FlowState`. Other declared profiles are never opened; `dispose()` releases their adapters too. |
| `.fsdev/data/fsdev.db`, when `fsdev run`, `dev` or `chat` finds no config (`fsdev.config.ts`, `.mts`, `.js` or `.mjs`, searched in that order) | The working directory, shared by the three commands. | One SQLite file. With `--store filesystem`, `run` and `dev` keep JSON files under `.fsdev/data` instead. `--store` is refused when a config is loaded. | One. |

Who can see each record is on [Stores](./stores.md) and [Authentication and tenancy](./authentication.md).

## Next

- [Serving flows](../concepts/serving-flows.md): the model behind this object, and the other ways into an app.
- [HTTP API](./http-api.md): hosts, `serve()`, in-process calls and the endpoints a mounted handle answers.
- [Stores](./stores.md): slots, what each store persists and what a custom store must guarantee.
- [Pause, resume and replay](./durable-execution.md): durable execution, waits, deadlines and the durability sweeper.
- [Background work](./background-work.md): job queues and the dispatch drain.
- [Environment variables](./environment.md): `FSD_ENV` and the other variables the runtime reads.
- [Kits and slots](./kits.md): the contract behind `kits`, `fill` and `root`.

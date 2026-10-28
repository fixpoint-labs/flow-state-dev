---
title: Runtime options
sidebar_label: Runtime options
description: Every field on createFlowState — flows, models, stores, workers, and runtime knobs.
---

# Runtime options

`createFlowState({ ... })` is the process-level config. It registers flows, builds the model resolver, opens store profiles, and returns a handle you mount as HTTP (and export from `fsdev.config.ts` for the CLI).

```ts
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import chatFlow from "./src/flows/hello-chat/flow";

export const flowstate = createFlowState({
  flows: { chat: chatFlow },
  models: { default: "openai/gpt-6-luna" },
  stores: { default: { primary: inMemoryStores() } },
});
```

The handle builds the router lazily on the first `getRouter()` / `ready()` call.

| Method / field | What it does |
|----------------|--------------|
| `getRouter()` | Resolve HTTP handlers. First call opens stores. |
| `getRuntime()` | `{ registry, stores, runtimeConfig }` for workers and scripts. Same instances the router uses. |
| `ready()` | Eager warmup. Idempotent. |
| `dispose()` | Close workers, then store adapters. |
| `activeProfile` | Resolved profile name. Reading it before `ready()` resolves the profile and throws if `FSD_ENV` names a missing one. |
| `settings` | The `settings` bag you passed in. |
| `meta` | `{ flowKeys, profileKeys, declaredSlots, devtool? }`. |

Narrative: [Engine setup](/docs/server/setup), [App configuration](/docs/cli/configuration), [Persistence](/docs/persistence/overview).

## `createFlowState` fields

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `flows` | `Record<string, FlowInstance>` | required | Registered flows. Keys are stable ids for the registry. |
| `stores` | `StoresConfig` | required | Named profiles. At least one. See [Stores](#stores). |
| `models` | `FlowStateModelsConfig` | — | Shorthand model resolver. See [Models](#models). |
| `modelResolver` | `ModelResolver` | built from `models` | Escape hatch. When set, `models` is ignored. Use for mocks or a fully custom resolver. |
| `defaultProfile` | `string` | first declared profile | Active profile when `FSD_ENV` is unset. `NODE_ENV` is not consulted. |
| `settings` | object | — | Read in blocks as `ctx.settings`. Type it by declaration-merging `FlowStateSettings`. Process-wide and one shape for every flow; for settings that differ between two registered copies of one flow, use [`config`](/docs/configuration/flow#instance-settings), read as `ctx.flow.config`. |
| `voice` | `{ provider? }` | — | Runtime voice provider (TTS/STT). Distinct from a flow's `voice` speak defaults. |
| `onError` | `(error, { method, path }) => void` | — | HTTP-level error sink. |
| `errorCapture` | handler | off | Block-aware sink: failing block identity plus flow / request / session / user ids, and one extra event marked `final` when a request settles failed. You write the adapter; the framework ships no vendor SDK. |
| `onBackgroundWork` | `(promise) => void` | — | Keep-alive for work that outlives the response. On Vercel, pass `(p) => after(() => p)`. |
| `detectInterruptedOnStartup` | `boolean` | `true` | Scan for interrupted requests at boot. Turn off on serverless if the scan contends with the first request. |
| `dispatchDrainTimeoutMs` | `number` | `30000` | How long `dispose()` waits for dispatch runs still running **in this process**. `0` skips the wait and still reports what was left. The default is sized for a serverless shutdown grace period, so raise it past your longest expected run on a long-lived host doing slow background work. It does not cover the worker shutdown that follows: `dispose()` then closes the worker, and an adapter like BullMQ waits — outside this ceiling — for jobs this process already claimed. Queued work no worker has claimed is not waited on. Size a host's shutdown grace period for both phases, not this value alone. |
| `debugEndpointsEnabled` | `boolean` | `false` | Privileged debug routes. `fsdev dev` sets `FSDEV_DEBUG_ENDPOINTS=1` on a loopback host. |
| `debugAllowAnonymousLocal` | `boolean` | `true` when `FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL` is `1`, else `false` | Let debug routes accept requests with no `Origin` header (curl, scripts, same-origin browser GETs). Off, they get 403. A request whose `Origin` is not loopback is rejected either way; `createFlowState` has no origin allowlist (`createFlowApiRouter` takes one as `debugAllowedOrigins`). `fsdev dev` turns it on for a loopback host; `fsdev serve` does not. Only for a server bound to loopback. |
| `defaultSseHeartbeatMs` | `number` | `15000` | Router-level SSE ping when a flow does not set `request.sseHeartbeatMs`. |
| `staleSweepIntervalMs` | `number` | `30000` | Stale-request sweeper cadence. `0` disables. |
| `staleSweepThresholdMs` | `number` | `60000` | Heartbeat age after which a running request is stale. |
| `queuedGraceMs` | `number` | `600000` | How long an unclaimed queued request may sit before a sweep treats it as lost. Must be finite. |
| `publicReentrySources` | `string[]` | built-in caller-addressed sources | Extra inbound `source` values allowed on retry / continue / resume. `webhook`, `internal` and `task` cannot be added. |
| `maxChildSessionListLimit` | `number` | `100` | Largest `limit` the child-session listing route accepts. The listing is all-time history, so it outgrows any fixed page a client would ask for. |
| `durable` | `boolean` | on wherever stores persist | Durable execution for the whole host: sequencers checkpoint, a crashed request resumes, and a request paused by `ctx.suspend()` is held. On by default over filesystem, SQLite and Postgres stores; off over in-memory stores, where a suspension would be lost with the process. `false` turns it off; `true` turns it on over in-memory stores too (tests). Without it, `ctx.suspend()` throws an error that names the setting to change, and the request fails. See [Enabling durability](/docs/advanced/durable-execution#enabling-durability). |
| `durabilityRetention` | retention object | — | Sweeper for expired suspensions, leases, and orphaned checkpoints. Only with durability on. |
| `userDeadlineMs` | `number` | unset | How long a stop that waits for a user waits when it names no deadline of its own: every `ctx.waitForUser` without a `deadline`, and every [question a task waits on](/docs/orchestration/task-board#a-tasks-questions). Unset, such a stop waits until someone answers it, stops it or cancels its task, however long that takes. Set it if you'd rather unanswered stops end on their own; at the deadline an approval reads as a no, and a review or input throws `SuspensionTimeoutError`. An open question closes on the board's first touch past its deadline, and the work goes on as if it had been answered. One second to 365 days. A raw `ctx.suspend` ignores it and keeps its own `timeoutMs`. |
| `maxDebtAgeMs` | `number` | `86400000` (24 h) | How long past its due time work a [wake](/docs/advanced/durable-execution#wakes) guards, such as a task board's notice, may stay owed before it is given up on and logged. Only with durability on and a store that keeps wakes. |
| `worker` | `WorkerAdapter` | — | Execution backend (for example `bullmqWorker(...)`). Mutually exclusive with `dispatcher`. |
| `dispatcher` | `FlowRunner` | in-process | Low-level "where actions run" hook. Prefer `worker`. |
| `adapters` | inbound adapters | — | Custom transports forwarded to the router. |
| `resolvePrincipal` | `PrincipalResolver` | body `userId` | Host fallback when a flow has no `authentication.resolvePrincipal`. Per-flow auth always wins. |
| `chat` | `{ default?: string }` | — | `fsdev chat` target when you omit the flow argument: `"<kind>"` or `"<kind>.<action>"`. Not the flow's `chat` subscription map. |
| `devtool` | `{ userId?, bearerToken? }` | — | Only `fsdev dev` reads this. Identity and bearer token for the loopback DevTool page. Production `serve` ignores it. |

## Models

`models` is a reshaped `createModelResolver` config.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `default` | model id | — | Fallback when an `intent/<name>` string cannot resolve. Required once you declare any `intents`. |
| `intents` | `Record<string, string[]>` | — | Named ladders. `model: "intent/chat"` walks `intents.chat` and takes the first candidate with a key and an installed SDK. |
| `keys` | `Record<string, string>` | `process.env` | Explicit API keys. |
| `gateways` | gateway map | auto from env | Gateway instances or configs. |
| `providers` | provider map | auto from env | Pre-built AI SDK provider instances. |
| `providerPreference` | preference | — | Reorder intent candidates by provider. |
| `retryPolicy` | `RetryPolicy` | 2 attempts, 1s base | Fallback retry when a candidate fails. |

Env overrides (`FSDEV_INTENT_*`, `FSDEV_DEFAULT_MODEL`) are listed under [Environment](./environment). Depth: [Models](/docs/fundamentals/models).

## Stores

`stores` is `Record<profileName, { primary, blobs?, queue?, scheduler? }>`.

Profile resolution, first match wins:

1. `process.env.FSD_ENV`
2. `defaultProfile`
3. The first key in the `stores` object

| Slot | What it holds |
|------|----------------|
| `primary` | Required. Sessions, state, items, requests, content, checkpoints, traces, suspensions, leases. |
| `blobs` | Reserved. Backs no store today. |
| `queue` | Reserved. Backs no store today. |
| `scheduler` | Reserved. Backs no store today. |

Only `primary` resolves into the store registry. `blobs`, `queue`, and `scheduler` are forward-compatible slots: the adapter you name must declare the capability (construction throws if it does not), but declaring one configures nothing. Durable job queues come from a [worker adapter](#workers); schedules are fired by the host scheduler, not by a store — see [Scheduled actions](/docs/server/scheduled).

Built-in adapters:

| Factory | Package | Typical use |
|---------|---------|-------------|
| `inMemoryStores()` | `@flow-state-dev/engine` | Tests and throwaway local runs. Nothing survives `dispose()`. |
| `filesystemStores({ rootDir })` | `@flow-state-dev/engine` | Local files under `.fsdev/data`. |
| `sqliteStores({ filename })` | `@flow-state-dev/store-sqlite` | Single-process durable store. |
| `postgresStores({ connectionString })` | `@flow-state-dev/store-postgres` | Multi-instance production. |

`inMemoryStores` accepts optional `cas` and `traceStore.maxRequests`. `filesystemStores` also accepts `developmentOnly` and `onPersistError`. See [Persistence](/docs/persistence/overview).

## Workers

`worker` is an adapter such as `bullmqWorker(...)` from `@flow-state-dev/bullmq`. The adapter's `mode` decides which sides this process runs:

| Mode | This process |
|------|----------------|
| `"colocated"` (default) | Enqueue and consume. Local-dev default. |
| `"dispatch-only"` | Enqueue only (web process). |
| `"worker-only"` | Consume only. Call `ready()` so the worker starts; you typically do not serve the router. |

`worker` and `dispatcher` cannot both be set. See [Dispatched work](/docs/server/background-work) and [Background jobs with BullMQ](/guides/background-jobs-bullmq).

## See also

- [Flow options](./flow)
- [Environment](./environment)
- [Error capture](/docs/advanced/error-capture)
- [Host adapters](/docs/server/host-adapters)
- [Durable execution](/docs/advanced/durable-execution)
- [Custom model resolver](/docs/advanced/custom-model-resolver)

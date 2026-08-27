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
  models: { default: "openai/gpt-5.4-mini" },
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
| `settings` | object | — | Read in blocks as `ctx.settings`. Type it by declaration-merging `FlowStateSettings`. |
| `voice` | `{ provider? }` | — | Runtime voice provider (TTS/STT). Distinct from a flow's `voice` speak defaults. |
| `onError` | `(error, { method, path }) => void` | — | HTTP-level error sink. |
| `errorCapture` | handler | off | Block-aware sink: failing block identity plus flow / request / session / user ids. You write the adapter; the framework ships no vendor SDK. |
| `onBackgroundWork` | `(promise) => void` | — | Keep-alive for work that outlives the response. On Vercel, pass `(p) => after(() => p)`. |
| `detectInterruptedOnStartup` | `boolean` | `true` | Scan for interrupted requests at boot. Turn off on serverless if the scan contends with the first request. |
| `detachedDrainTimeoutMs` | `number` | `30000` | How long `dispose()` waits for **in-process** detached work. `0` skips the wait and still reports what was left. It does not cover the worker shutdown that follows: `dispose()` then closes the worker, and an adapter like BullMQ waits — outside this ceiling — for jobs this process already claimed. Queued work no worker has claimed is not waited on. Size a host's shutdown grace period for both phases, not this value alone. |
| `debugEndpointsEnabled` | `boolean` | `false` | Privileged debug routes. `fsdev dev` sets `FSDEV_DEBUG_ENDPOINTS=1`. |
| `defaultSseHeartbeatMs` | `number` | `15000` | Router-level SSE ping when a flow does not set `request.sseHeartbeatMs`. |
| `staleSweepIntervalMs` | `number` | `30000` | Stale-request sweeper cadence. `0` disables. |
| `staleSweepThresholdMs` | `number` | `60000` | Heartbeat age after which a running request is stale. |
| `queuedGraceMs` | `number` | `600000` | How long an unclaimed queued request may sit before a sweep treats it as lost. Must be finite. |
| `publicReentrySources` | `string[]` | built-in caller-addressed sources | Extra inbound `source` values allowed on retry / continue / resume. `webhook` and the detached-dispatch source cannot be added. |
| `maxWorkstreamListLimit` | `number` | `100` | Largest `limit` the workstream list route accepts. |
| `durable` | `boolean` | `false` | Install the default checkpoint provider so actions with `durable: true` can recover and `ctx.suspend()`. Needs a persistent store to survive a process restart. |
| `durabilityRetention` | retention object | — | Sweeper for expired suspensions, leases, and orphaned checkpoints. Only with durability on. |
| `worker` | `WorkerAdapter` | — | Execution backend (for example `bullmqWorker(...)`). Mutually exclusive with `dispatcher`. |
| `dispatcher` | `FlowDispatcher` | in-process | Low-level "where actions run" hook. Prefer `worker`. |
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

`worker` and `dispatcher` cannot both be set. See [Detached work](/docs/server/background-work) and [Background jobs with BullMQ](/guides/background-jobs-bullmq).

## See also

- [Flow options](./flow)
- [Environment](./environment)
- [Error capture](/docs/advanced/error-capture)
- [Host adapters](/docs/server/host-adapters)
- [Durable execution](/docs/advanced/durable-execution)
- [Custom model resolver](/docs/advanced/custom-model-resolver)

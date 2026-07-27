# @flow-state-dev/engine

**The runtime. Register flows, execute actions, stream results — one config object to a complete API.**

## Installation

```bash
pnpm add @flow-state-dev/engine
```

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import myFlow from "./flows/my-flow";

export const flowstate = createFlowState({
  flows: { myFlow },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: inMemoryStores() } },
});
```

Mount it with a platform adapter (`@flow-state-dev/vercel/next` on Vercel, `@flow-state-dev/next` elsewhere):

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
```

That's a full API with action execution, session management, SSE streaming with resume, and state snapshots.

## createFlowState

`createFlowState(options)` builds the runtime from one declarative object and returns a `FlowState` handle:

- `getRouter(): Promise<FlowApiRouter>` — resolve the route handlers (first call triggers store init).
- `ready(): Promise<void>` — eager warmup, idempotent.
- `dispose(): Promise<void>` — release pooled resources across every declared store.
- `activeProfile`, `settings`, `meta` — read-only diagnostics.

Construction is synchronous; stores initialize lazily and memoized on the first `getRouter()` / `ready()`. There's no top-level await, so the same instance works in a Next.js Route Handler.

### Stores and capability profiles

`stores` is a map of named profiles. A profile maps capability slots (typed containers for a category of storage) to adapters. The required slot is `primary` — the catch-all state store for sessions, requests, users, orgs, active requests, checkpoints, content, and traces. The `blobs`, `queue`, and `scheduler` slots are declared but forward-compatible; no backing store ships for them yet.

```ts
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { vercelPostgresStores } from "@flow-state-dev/vercel/store";

createFlowState({
  flows: { myFlow },
  stores: {
    prod: { primary: vercelPostgresStores() },
    dev: { primary: inMemoryStores() },
  },
  defaultProfile: "dev",
});
```

Adapter factories: `inMemoryStores()`, `filesystemStores({ rootDir })` (this package), `postgresStores(options)` (`@flow-state-dev/store-postgres`), `sqliteStores(options)` (`@flow-state-dev/store-sqlite`), `vercelPostgresStores()` (`@flow-state-dev/vercel/store`).

### Profile selection

The active profile resolves on first use, first match wins: `process.env.FSD_ENV` → `defaultProfile` → first declared profile. `NODE_ENV` is intentionally not consulted — an explicit selector keeps a production build from silently pointing at production infrastructure.

### Settings

`settings` is instance-level config blocks read via `ctx.settings`. Type it by declaration-merging into `FlowStateSettings`:

```ts
declare module "@flow-state-dev/core" {
  interface FlowStateSettings {
    sandbox: { type: "local" | "vercel" | "memory" };
  }
}

createFlowState({
  flows: { myFlow },
  stores: { default: { primary: inMemoryStores() } },
  settings: { sandbox: { type: "local" } },
});
```

Then read `const s = ctx.settings.sandbox` inside any block.

### Serverless background work

On platforms that freeze the function after the response (Vercel), pass the platform keep-alive primitive at construction so fire-and-forget work isn't killed:

```ts
import { after } from "next/server";

createFlowState({ /* ... */ onBackgroundWork: (p) => after(() => p) });
```

It's a `createFlowState` option, not a handler option, because the router is built inside `createFlowState`.

### Error capture

`errorCapture` is an opt-in, block-aware sink for routing runtime block failures to an external observability service (Sentry, Datadog, Bugsnag). It's distinct from `onError`, which is an HTTP-level sink. The callback receives a provider-neutral `ErrorCaptureEvent` (the normalized `FlowError` plus the failing block's identity and the flow/request/session/user IDs), fires once per failing block, and is fire-and-forget — a throw or rejection is swallowed and logged, never affecting the request.

```ts
import * as Sentry from "@sentry/node";

createFlowState({
  /* ... */
  errorCapture: (event) =>
    Sentry.captureException(event.error, {
      user: { id: event.userId },
      tags: { flow: event.flowKind, block: event.blockName ?? "unknown" },
    }),
});
```

See the [Error capture docs](https://flow-state.dev/docs/advanced/error-capture) for the full event shape and filtering guidance.

### Connection resilience

`createFlowState` forwards the SSE heartbeat and stale-request sweeper knobs to the router: `defaultSseHeartbeatMs`, `staleSweepIntervalMs`, and `staleSweepThresholdMs`. The defaults suit typical Vercel/Next.js deployments. See the [connection resilience guide](https://flow-state.dev/docs/server/connection-resilience) for tuning.

### DevTool connection (dev-only)

`devtool?: { userId?, bearerToken? }` declares how `fsdev dev` should connect the DevTool UI to this app. `userId` is the session identity DevTool acts as; `bearerToken` is sent as `Authorization: Bearer` on every flow request, so a **bearer-gated flow** (one whose `resolvePrincipal` validates a shared secret) is debuggable through DevTool using its **real** authentication — no bypass.

```ts
createFlowState({
  flows: { myFlow },
  stores: { default: { primary: inMemoryStores() } },
  devtool: { userId: "owner", bearerToken: process.env.MY_FLOW_SECRET },
});
```

`fsdev dev` reads this off the sync `meta.devtool` getter (no store init) and injects it into the loopback DevTool page. It is **dev-only**: the token is exposed only to the loopback page `fsdev dev` serves, and production `serve`/deploy paths ignore it. The config type is exported as `DevToolConnectionConfig`. See the [DevTool setup guide](https://flow-state.dev/docs/devtool/setup).

## Lower-level: registry and router

`createFlowApiRouter` and `createFlowRegistry` still exist for custom transports and advanced wiring. Most users want `createFlowState`. The sections below document the lower-level surface.

```ts
import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/engine";

const registry = createFlowRegistry();
registry.register(myFlow);
const router = createFlowApiRouter({ registry, stores });

export const { GET, POST, PATCH, DELETE } = router;
```

For voice, pass a `voiceProvider` (TTS + STT in one object); a per-flow `voice.provider` overrides it. See the [Voice guide](https://flowstate.dev/docs/advanced/voice).

## What this package does

- **Action execution** — Validates input, resolves sessions, runs block pipelines, emits items
- **SSE streaming** — Items stream live as blocks execute, with sequence-number cursors for resume. Resources declaring `client: { live: true }` emit their projected delta inline on each mutation so clients merge it without a refetch
- **State persistence** — in-memory, filesystem, SQLite, and Postgres store adapters with CAS-guarded atomic writes
- **Flow registry** — Register multiple flows, routes are derived automatically
- **Error normalization** — All errors become typed `FlowError` instances with codes, retry signals, and scope context
- **Structured logging** — Every action execution logs flow/action/block IDs, attempt numbers, timing, and summarized payloads
## Inbound transports

Every entry point into the runtime — native HTTP, MCP servers, webhooks,
scheduled actions, custom transports — implements the same
`InboundTransportAdapter` contract. The built-in HTTP adapter is mounted
automatically; `createFlowApiRouter` accepts an `adapters` option to mount
additional transports onto the same host:

```ts
import { createFlowApiRouter } from "@flow-state-dev/engine";

const router = createFlowApiRouter({
  registry,
  stores,
  adapters: [
    // createMcpTransportAdapter({ /* ... */ }),
    // createScheduledTransportAdapter({ /* ... */ }), // @flow-state-dev/scheduled
    // createWebhookTransportAdapter({ /* ... */ }),
  ],
});
```

Routes from every adapter merge into the returned `{ GET, POST, PATCH, DELETE }`
dispatcher. Path collisions among non-HTTP adapters throw
`TransportRouteCollisionError` at construction time so dispatch is
unambiguous at runtime. Every request carries a `source` field on its
`RequestRecord` for provenance — `http` for the default adapter, set by
each custom transport for its own.

An adapter can register a **dedicated** route that lives outside the canonical
`basePath` — for example the MCP adapter's `/mcp/:kind` under
`dedicatedBasePath: true`. A long-lived host that mounts the flow API under a
prefix uses `dispatchDedicatedRoute(router, req)` to serve those: it matches
ONLY the custom adapter routes and returns the matched `Response`, or `null`
when none match — it never falls through to the canonical flow-API handler, so
the flow API (list-flows, actions, sessions) stays reachable only under
`basePath`. `@flow-state-dev/node`'s `serve()` calls it in its not-found
fallback; catch-all hosts that mount the router at `basePath` don't need it.

`createWebhookTransportAdapter({ providers })` mounts
`POST /api/flows/:kind/webhooks/:provider` and routes verified inbound
webhooks (Stripe, GitHub, Slack Events, any signed POST) to the handler a flow
bound in its `webhooks` config. The flow declares routing only; the host
supplies signature verification and payload mechanics per provider at the
mount, keeping secrets out of the flow definition. `stripeWebhookVerifier`,
`githubWebhookVerifier`, `slackWebhookVerifier`, and `createWebhookVerifier`
cover the common signature formats; each accepts a string secret or a
`() => string` getter. See the
[webhook receivers reference](https://flow-state.dev/docs/server/webhooks).

See the [inbound transports reference](https://flow-state.dev/docs/advanced/inbound-transports)
for the full contract reference and a walk-through of authoring a custom
adapter.

A flow's concurrency policy is enforced once at the host dispatch seam — the
in-process dispatcher gates the run there, so every transport inherits the
same behavior and adapters only map the outcome to their native response.
When a `reject` policy drops a competing request, `host.dispatch` throws
`ConcurrencyRejectedError` synchronously (carrying the contended `key` and the
`inFlightRequestId`); the HTTP adapter maps it to 409, fire-and-forget
webhook/scheduled adapters to a benign skipped 200, MCP to a server-busy
error. A `queue` policy that waits past its budget rejects the request's
`finished` with `ConcurrencyQueueTimeoutError` (it surfaces through the request
stream, not a synchronous status). Both errors are exported from this package.
See the [concurrency policies
reference](https://flow-state.dev/docs/advanced/concurrency-policies).

## Authentication

Per-flow `defineFlow({ authentication })` and a host-level
`resolvePrincipal` (on `createFlowState`, or `createFlowApiRouter` for the
lower-level surface) configure how the framework resolves the caller
principal for every inbound transport. The framework owns the contract; the
host owns credential verification.

```ts
import { defineFlow } from "@flow-state-dev/core";
import {
  createFlowApiRouter,
  createHmacVerifier,
  PrincipalResolutionError
} from "@flow-state-dev/engine";

const verifyStripe = createHmacVerifier({
  secret: process.env.STRIPE_WEBHOOK_SECRET!,
  format: "stripe"
});

const stripeFlow = defineFlow({
  kind: "stripe-webhook",
  authentication: {
    requireUser: false,
    defaultUserId: "system",
    resolvePrincipal: ({ rawBody, request }) => {
      const sig = request?.headers.get("stripe-signature") ?? null;
      if (rawBody === undefined || !verifyStripe(rawBody, sig)) {
        throw new PrincipalResolutionError("Invalid signature", { status: 401 });
      }
      return null; // defaultUserId fills in
    }
  },
  actions: { /* ... */ }
});
```

`requireUser: false` opts the flow out of user-scope identity at build
time — `defineFlow` rejects user-scope state, `clientData`, and resource
declarations on such flows. Bundled helpers `createHmacVerifier` (Stripe
and GitHub-style signatures), `createHs256JwtVerifier`,
`createBearerSecretPrincipalResolver` (constant-time bearer-token check
for scheduled and webhook callers), and `extractBearerToken` cover the
most common verification patterns; hosts plug in their own for anything
else.

When no resolver is configured, a flow runs on the framework default that
trusts a caller-supplied `body.userId` — unauthenticated. `isDefaultBodyUserIdPrincipalResolver(resolver)`
reports whether a resolver is that default, via a globally-registered brand
rather than function identity (so it holds across duplicate package instances,
e.g. a config that resolves its own copy of the engine). Tooling uses it to
detect an unauthenticated flow before exposing it — `@flow-state-dev/node`'s
loopback-bind guard refuses a network bind when a served flow resolves to this
default.

See the [authentication reference](https://flow-state.dev/docs/server/authentication)
for the full contract, resolution order, and `requireUser: false`
semantics.

## Multi-tenant isolation

Pass a tenant id on the `x-tenant-id` header (configurable via
`createFlowApiRouter({ tenantIdHeader })`) and session storage namespaces by
tenant automatically: two tenants sharing a session id get distinct session
records, state, session-scoped resources, and request history. User and org
scopes stay shared across tenants by design. Single-tenant apps that never
send the header are unaffected — keys are unchanged and no migration runs.
Read the value in a block via `ctx.session.identity.tenantId`. See the
[state and scopes guide](https://flow-state.dev/docs/fundamentals/state-and-scopes#multi-tenant-isolation).

## Store configuration

```ts
import { createFilesystemStores, createInMemoryStores } from "@flow-state-dev/engine";

// Default when no `stores` is passed: in-memory (dev/test only)
const router = createFlowApiRouter({ registry });

// Testing: in-memory (fast, no cleanup)
const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });

// Runtime safety guards (optional)
const guardedRouter = createFlowApiRouter({
  registry,
  maxResponseBufferSize: 10_000,
  maxConcurrentStreams: 1_000,
  staleStreamTtlMs: 300_000,
});
```

`createFilesystemStores` wires a filesystem-backed trace store under `{rootDir}/traces/` so trace events survive process restarts. Retention is controlled by `traceStore.maxRequests`, which defaults to 1000 when `NODE_ENV=development` and 50 otherwise — explicit values always win. See the [trace channel reference](https://flow-state.dev/docs/streaming/trace-channel) for the full backend list and file layout.

```ts
const stores = createFilesystemStores({
  rootDir: ".fsdev/data",
  traceStore: { maxRequests: 200 }
});
```

## Session retention policies

Long-running sessions accumulate items over time. Retention policies provide a safety net that bounds storage growth by evicting old completed request records when limits are exceeded.

```ts
import { defineFlow } from "@flow-state-dev/core";

const flow = defineFlow({
  kind: "my-flow",
  session: {
    retention: {
      maxItems: 500,   // evict oldest requests when total items exceed 500
      maxAge: "24h",   // evict requests older than 24 hours
    },
  },
  actions: { /* ... */ },
});
```

Both constraints are optional and independent. When both are set, either condition triggers eviction. Eviction runs lazily after each completed request (no background process). The current request is never evicted.

Retention policies operate at **request granularity** — entire old request records are removed, not individual items. For items that should never be stored at all, use `transient: true` on block definitions.

The `maxItems` check counts items through `RequestStore.countItems(requestId)` rather than loading item payloads, so a retention sweep stays cheap on sessions with large logs. Custom `RequestStore` implementations must provide `countItems`; it returns what `get(id)` would surface as `items.length`.

Supported duration formats: `'30s'`, `'5m'`, `'2h'`, `'7d'`, or a raw number in milliseconds.

## Custom model resolution

```ts
import { createModelResolver } from "@flow-state-dev/core/models";
import { createFlowApiRouter } from "@flow-state-dev/engine";

const router = createFlowApiRouter({
  registry,
  modelResolver: createModelResolver(),
});
```

## Custom logging

`runAction` and `executeBlock` emit structured logs by default — flow/action/block IDs, attempt numbers, summarized payloads, retries, and terminal errors.

```ts
await runAction({
  flow,
  actionName: "chat",
  input,
  userId: "user_123",
  stores,
  logger: {
    info: (msg, ctx) => appLogger.info({ ...ctx }, msg),
    warn: (msg, ctx) => appLogger.warn({ ...ctx }, msg),
    error: (msg, ctx) => appLogger.error({ ...ctx }, msg),
  },
});
```

Use `summarizeForLog(value)` for the same bounded payload summaries in custom log formatters.

## Public API

**Runtime:**
- `createExecutionContext` — Build a block execution context
- `runAction` — Execute a flow action end-to-end. Also the sanctioned non-HTTP entry point (jobs, cron, queue consumers): pass an `onItem` callback to observe items live, and read `requestId` back off the result to correlate logs or attach a stream. Queue consumers re-running an action under the same `requestId` (retry attempts) pass `startSequenceNumber` — the last persisted sequence number — so the per-request event log stays strictly increasing across attempts
- `executeBlock` — Execute a single block with context

**Stores:**
- `createInMemoryStores` — Fast, ephemeral stores for testing
- `createFilesystemStores` — Persistent stores for local development (not for production load; use SQLite or Postgres in production)
- `createInMemoryContentStore` / `createFilesystemContentStore` — Content store adapters
- `createInMemoryResourceStateStore` / `createFilesystemResourceStateStore` — Resource state store adapters
- Scope store factories and CAS/state ops

**Streaming:**
- `createResponseEmitter` — Create an SSE emitter for a request
- `ResponseEmitter.emitContentAudioDelta(itemId, contentIndex, chunk)` — Emit a chunk of streamed TTS audio. Non-replayable; live-only.
- `encodeStreamEvent` / `serializeSSEFrame` — Low-level SSE encoding
- `replayRequestEvents` — Replay events from a sequence cursor

**Request abort:**
- `abortRequest(requestId)` — Signal an in-progress request to stop via `AbortController`
- `hasActiveAbortController(requestId)` — Check if a request can be aborted
- Abort endpoint: `POST /api/flows/:flowKind/requests/:requestId/abort` — returns 204 on success, 404 if not in progress, 409 if already terminal
- Aborted requests receive `status: "aborted"` with an `abortedAt` timestamp. The SSE stream emits `request.aborted` and closes.
- Background `.work()` tasks survive client disconnect and only abort on explicit cancellation (`POST /abort` or `session.abortRequest()`). See the [sequencer side-chains reference](https://flow-state.dev/docs/advanced/sequencer-side-chains) for the two-signal cancellation contract.

**Registry/routes:**
- `createFlowRegistry` — Register flow instances
- `createFlowApiRouter` — Generate HTTP route handlers from a registry
- `parseFlowRoute` — Parse incoming request paths

**Cross-flow schema validation:**

`FlowRegistry.register` validates each non-isolated flow's `user.stateSchema`, `org.stateSchema`, and user/org resource schemas against every other registered flow. Incompatible declarations throw `CrossFlowSchemaConflictError` at registration time — no silent data loss when a second flow's write would overwrite the first flow's keys. Flows that opt into isolation (`isolateUserState: true` or `isolateOrgState: true` on `defineFlow`) are namespaced by `flowKind` in storage and skip the registry check. See [Flow Isolation](https://flow-state.dev/docs/advanced/flow-isolation) and the [state and scopes reference](https://flow-state.dev/docs/fundamentals/state-and-scopes) for the full model.

**Execution backend (worker adapters):**
- `WorkerAdapter` / `WorkerHandle` / `WorkerMode` — Contract for the `worker` option on `createFlowState`. An adapter (e.g. `bullmqWorker` from `@flow-state-dev/bullmq`) provides the dispatch side and/or the processing side; `createFlowState` hands both the same resolved `{ registry, stores, runtimeConfig }` so the worker can never run against different stores than the router. `mode` picks the deployment shape: `"colocated"` (default), `"dispatch-only"` (web container), `"worker-only"` (worker container — call `ready()` to start consuming). `dispose()` drains the worker before closing stores

**Dispatcher (pluggable execution backend):**
- `FlowDispatcher` — Interface controlling where flow actions execute. Default: in-process. Implementations route execution to external workers (e.g., BullMQ)
- `DispatchEnvelope` — Serializable subset of `InboundRequestEnvelope` carried over the queue
- `FlowDispatchHandle` — Handle returned by `dispatch()`: `requestId`, `finished` promise, `abort()` hook
- `createInProcessDispatcher` — Default dispatcher that calls `runAction` in the current process
- `StreamBridge` / `StreamPublisher` / `StreamSubscriber` — Bridges live SSE events between a remote worker and the web process. The worker writes events to the bridge; the web process reads them and forwards to SSE
- `StreamEvent` — Single event published through the bridge, matching the SSE event shape
- Pass `dispatcher` to `createFlowState` or `createFlowApiRouter` to route all action dispatches through an external queue. Most deployments should prefer the `worker` option — the adapter wires the dispatcher and the worker together; `dispatcher` is the low-level escape hatch (mutually exclusive with `worker`)

**Errors:**
- `FlowError` and canonical subclasses
- `normalizeError` — Wrap any thrown value into a typed FlowError

## ContentStore

`StoreRegistry` includes a required `content: ContentStore` field that separates resource content persistence from scope record persistence. Both `createInMemoryStores()` and `createFilesystemStores()` include a default `ContentStore`. The filesystem `ContentStore` writes each resource as a nested `.md` file (a key `concepts/overview` becomes `concepts/overview.md`), so the store root is a browsable file tree; a directory written in the older flat layout is refused with a clear error rather than silently misread.

```ts
interface ContentStore {
  get(scopeType, scopeId, resourceKey): Promise<string | undefined>;
  set(scopeType, scopeId, resourceKey, content): Promise<void>;
  delete(scopeType, scopeId, resourceKey): Promise<void>;
  getAll(scopeType, scopeId): Promise<Record<string, string>>;
  getByPrefix(scopeType, scopeId, keyPrefix): Promise<Record<string, string>>;
  deleteAll(scopeType, scopeId): Promise<void>;
}
```

Per-request loading is scoped to the resources a flow declares: the execution context reads fixed resources with `get` and collections with `getByPrefix` (an empty prefix loads every key in the scope), rather than `getAll`. `getAll` remains for the state endpoint's full-scope view.

That scoped load runs in three waves. `createExecutionContext` fires Wave 1 (flow-level resources, at context creation) and Wave 2 (the dispatched action's declared resources, in one parallel burst — a context is bound to exactly one action, so this lives in the context rather than `runAction`). Wave 3 fires in the block runtime's `run`: a block's `prefetchMode: 'lazy'` single resources load when that block dispatches, and lazy collections defer further to a per-access on-demand accessor. A per-scope cache plus a single-flight in-flight map dedupe loads across all three waves and concurrent block dispatch. See the [resources reference](https://flow-state.dev/docs/resources/overview) for the full model.

For custom store registries, provide a `ContentStore` implementation. `createInMemoryContentStore()` is the simplest option:

```ts
import {
  createInMemoryContentStore,
  createInMemoryResourceStateStore,
  createInMemoryCheckpointStore
} from "@flow-state-dev/engine";

const stores: StoreRegistry = {
  session: mySessionStore,
  request: myRequestStore,
  user: myUserStore,
  org: myOrgStore,
  activeRequests: myActiveRequestRegistry,
  content: createInMemoryContentStore(),
  resourceState: createInMemoryResourceStateStore(),
  checkpoints: createInMemoryCheckpointStore(),
};
```

Database adapters can implement `ContentStore` to route content to blob storage, S3, or a separate table while keeping scope metadata in the primary store.

**Migrating from inline `resourceContent`:** Earlier versions stored content inline on `SessionRecord`/`UserRecord`/`OrgRecord` as a `resourceContent: Record<string, string>` field. That field has been removed. Operators with content already persisted inline must copy it into `ContentStore` before upgrading — for each scope record, walk its old `resourceContent` map and call `stores.content.set(scopeType, scopeId, key, value)` per entry. After the migration the field is silently dropped on the next record write.

## ResourceStateStore

`StoreRegistry` includes a required `resourceState: ResourceStateStore` field that separates resource *state* persistence from scope record persistence — the state-layer twin of `ContentStore`. It holds the structured `JsonObject` each resource carries (single resources and collection instances alike), keyed by `(scopeType, scopeId, resourceKey)`. Both `createInMemoryStores()` and `createFilesystemStores()` include a default `ResourceStateStore`. The filesystem `ResourceStateStore` writes each resource's state as a nested `.json` file mirroring the content store's layout (same nested-tree upgrade and legacy-layout guard).

```ts
interface ResourceStateStore {
  get(scopeType, scopeId, resourceKey): Promise<JsonObject | undefined>;
  set(scopeType, scopeId, resourceKey, state): Promise<void>;
  delete(scopeType, scopeId, resourceKey): Promise<void>;
  getAll(scopeType, scopeId): Promise<Record<string, JsonObject>>;
  getByPrefix(scopeType, scopeId, keyPrefix): Promise<Record<string, JsonObject>>;
  deleteAll(scopeType, scopeId): Promise<void>;
}
```

The interface and loading semantics mirror `ContentStore` exactly: declared state is loaded per-request (`get` for fixed resources, `getByPrefix` for collections), and a state mutation writes only the affected key rather than rewriting the whole scope record. `createInMemoryResourceStateStore()` is the simplest implementation; database adapters can route state to a dedicated table (Postgres uses `JSONB`). A separate store from `ContentStore` keeps payload types clean — state is `JsonObject`, content is `string`, and a resource can have one without the other.

## CheckpointStore

`StoreRegistry` includes a required `checkpoints: CheckpointStore` field for durable sequencer checkpoints. Sequencers default to `durable: true` and overwrite a single record per `(requestId, blockInstanceId)` at every step boundary; the future durable execution runtime reads `latest(...)` to resume after an interruption.

```ts
interface CheckpointStore {
  write(checkpoint: SequencerCheckpoint): Promise<void>;
  latest(requestId: string, blockInstanceId: string): Promise<SequencerCheckpoint | null>;
  delete(requestId: string, blockInstanceId: string): Promise<void>;
  deleteForRequest(requestId: string): Promise<void>;
}
```

`deleteForRequest` removes every checkpoint for a request in one call (all `blockInstanceId`s) — used by the retention sweeper to reclaim checkpoints of a crashed run whose per-instance terminal deletes never fired.

Memory, filesystem, SQLite, and Postgres adapters all ship with first-class implementations. Per-sequencer storage is constant regardless of step count.

By default the final checkpoint is retained after terminal completion (success / error / abort) for post-mortem inspection. Set `flow.request.cleanupCheckpointsOnTerminal: true` on a flow to make terminal frames trigger an immediate `delete()`.

## DurabilityProvider

`DurabilityProvider` coordinates checkpoint-based crash recovery and HITL (human-in-the-loop) suspend/resume. Wire it onto `RuntimeConfig.durabilityProvider` to enable `ctx.suspend()` in durable actions.

```ts
import { createCheckpointDurabilityProvider } from "@flow-state-dev/engine";

const provider = createCheckpointDurabilityProvider({
  checkpoints: stores.checkpoints,
  suspensions: stores.suspensions,
  leases: stores.leases
});

// Pass to runtime config
{ durabilityProvider: provider }
```

The interface methods are `saveCheckpoint`, `loadCheckpoint`, `suspend`, `loadSuspension`, `listSuspended`, `acquireLease`, `releaseLease`, `cleanup`, plus the retention seams `cleanupCheckpoints` (delegates to `CheckpointStore.deleteForRequest`) and `pruneSuspensions` (delegates to `SuspensionStore.pruneTerminalBefore`). `createCheckpointDurabilityProvider` delegates each to the matching store from `StoreRegistry`.

`SuspensionStore` and `LeaseStore` ship with in-memory, filesystem, SQLite, and Postgres adapters. See the [Durable Execution guide](https://flow-state.dev/docs/advanced/durable-execution) for usage patterns.

A suspension inside a router's chosen branch resumes the same branch: the recorded `router_decision` is validated against the re-run selector before dispatch (a mismatch fails with `RouteUnavailableError`), and completed work inside the branch replays from the durable log instead of re-executing.

A generator tool can also suspend mid-loop (`ctx.suspend()` for tool-call approval). On resume the conversation is rebuilt from the durable item log rather than re-calling the model: prior model turns and completed sibling tools replay from their recorded items, and only the gated tool re-enters to produce its real result. See the [Generator and router suspend/resume](https://flow-state.dev/docs/advanced/generator-and-router-suspend-resume) reference for the contract and limits.

### Durability retention

Durability records accumulate on long-lived hosts: a completed run's checkpoints are dead weight, a resolved suspension is only worth keeping for a window, and a crashed run leaves records that `cleanup()` never fires for. `createDurabilitySweeper` is an opt-in periodic job that reclaims them, modeled on the stale-request sweeper (`setInterval` + `unref`, `inFlight` guard, idempotent `dispose`, no-op handle when disabled).

Configure it via `RuntimeConfig.durabilityRetention` (forwarded by `createFlowState` and `createFlowApiRouter`). The sweeper is built only when both a `durabilityProvider` and a `durabilityRetention` policy are present.

```ts
createFlowState({
  // ...
  durabilityProvider: createCheckpointDurabilityProvider(stores),
  durabilityRetention: {
    sweepIntervalMs: 600_000,                // sweep cadence; 0 disables. Default 10min.
    checkpointMaxAgeMs: 86_400_000,          // terminal-run checkpoint backstop. Default 24h.
    suspensionTerminalMaxAgeMs: 604_800_000, // resolved-suspension window. Default 7d.
    orphanCheckpointThresholdMs: 86_400_000, // abandoned-interrupted threshold. Default 24h.
    batchLimit: 1000,                        // max deletes per store per tick. Default 1000.
  },
});
```

Each tick takes a single-holder sentinel lease (co-located hosts serialize), enforces suspension expiry (`pending` past `expiresAt` → `expired`), prunes resolved suspensions and expired leases past their windows, and prunes orphaned checkpoints. Checkpoints of `in_progress` or `suspended` requests are never age-pruned — they are the resume points an active or paused run needs.

## Connection resilience

The server runs three coordinated mechanisms so a dropped SSE connection doesn't leave a request running forever with no way to recover:

- **Wire-level SSE heartbeat.** Every live and GET-attach SSE response emits `: ping\n\n` comment frames at a configurable cadence. Keeps NAT/proxy idle timeouts from closing the connection and gives clients a robust inactivity signal during long pauses (e.g. an LLM thinking).
- **Stale-request sweeper.** A periodic in-process job that reads the active request registry and, for entries whose executor heartbeat has stopped, marks the persisted request record `interrupted` so session locks release.
- **Read-only status endpoint.** `GET /api/flows/:flowKind/requests/:requestId/status` returns a `RequestStatusSnapshot` callable when no SSE stream is attached — used by clients to confirm authoritative server state after the watchdog trips.

```ts
createFlowApiRouter({
  registry,
  stores,
  // SSE wire heartbeat — applied to every live and GET-attach stream when
  // the per-flow `request.sseHeartbeatMs` is unset. Default 15_000 ms.
  defaultSseHeartbeatMs: 15_000,
  // Internal sweeper cadence (0 disables). Default 30_000 ms.
  staleSweepIntervalMs: 30_000,
  // Heartbeat-age threshold the sweeper uses to mark a request `interrupted`.
  // Should be ≥ 2× the executor's registry heartbeat. Default 60_000 ms.
  staleSweepThresholdMs: 60_000
});
```

Per-flow override (wins over the host-level default):

```ts
defineFlow({
  kind: "chat",
  request: { sseHeartbeatMs: 10_000 },
  actions: { /* ... */ }
});
```

Clients consume the wire heartbeat through `useSession`'s watchdog: it surfaces `session.isStuck` when the stream goes silent past `stuckThresholdMs` (default 30s) and exposes `session.dismissRequest()` to clear the request without a live connection. See [Connection Resilience](https://flow-state.dev/docs/server/connection-resilience) for full details.

## Debug endpoints

The server exposes a read-only debug surface at `/api/flows/sessions/:id/debug/resources` and `/api/flows/sessions/:id/debug/resources/:ref`. Each response carries the full server-side state for the matching storage keys alongside the projected client view, so a debugger can show you exactly what `client.data` is dropping. There are no write paths here; the endpoint cannot mutate state.

The endpoint is off by default. Opt in with `debugEndpointsEnabled: true` on `createFlowApiRouter`, or set `FSDEV_DEBUG_ENDPOINTS=1` in the environment. By default the route accepts only loopback origins; widen with `debugAllowedOrigins` for non-loopback DevTool hosts.

```ts
const router = createFlowApiRouter({
  registry,
  debugEndpointsEnabled: true,
  debugAllowedOrigins: ["http://localhost:3001"],
});
```

The DevTool's Resources panel uses this surface. `fsdev dev` enables it automatically on loopback. Don't ship it enabled to production without auditing the origin allowlist and gating the route behind whatever authentication your host already enforces.

See [Debug vs client state](https://flow-state.dev/docs/devtool/debug-vs-client-state) for the full mental model.

## State mutations: two-tier model

Every state mutator (`patchState`, `pushState`, `incState`, `setStateRecord`, `deleteStateRecord`, `atomicState`) routes through one of two paths inside the runtime, picked by whether the scope has a `persist` callback:

- **In-memory scopes** — target state, sequencer state, and any scope without a `persist` bridge. Mutations serialize through a per-`StateContainer` FIFO queue (`withScopeLock`). Concurrent mutators run one at a time in submission order; there is no version check, no retry, and no `ConcurrentModificationError`. Reads are still synchronous against `container.read()`.
- **External-store scopes** — `request`, `session`, `user`, `org` scopes bridged through `persist` (filesystem, sqlite, postgres). Mutations use the optimistic `runWithCAS` retry loop because a remote authority can advance the version underneath the local cache. `ConcurrentModificationError` still surfaces on retry exhaustion at this boundary.

`flow.request.mutationTimeoutMs` (default `30_000`, set to `Infinity` to disable) bounds the worst-case wait for any in-memory mutation. When a mutator's queue wait + execution exceeds the budget, the call rejects with `ScopeMutationTimeoutError` instead of hanging the request indefinitely.

```ts
defineFlow({
  kind: "chat",
  request: { mutationTimeoutMs: 60_000 },
  actions: { /* ... */ }
});
```

The lock is non-reentrant: a mutator that calls `atomicState` again on the same container would await its own completion forever. Compose state mutations within a single mutator instead. Cross-scope mutator chains (scope A's mutator calls `atomicState` on scope B) are fine — different containers have independent queues.

## Notes

- Phase 1 requires caller-provided `userId` for all action/session routes
- Stream resume supports both `Last-Event-ID` header and `starting_after` query param
- `GET /sessions/:id/state` supports `offset` + `limit` pagination for `items`
- Generator blocks resolve models through `ctx.resolveModel` — default uses Vercel AI Gateway
- `createModelResolver` available from `@flow-state-dev/core/models` for model routing

## Scripts

```bash
pnpm --filter @flow-state-dev/engine build
pnpm --filter @flow-state-dev/engine typecheck
pnpm --filter @flow-state-dev/engine test
```

## Architecture reference

- [Server Setup](https://flow-state.dev/docs/server/setup) — Routes, transport, React hooks contract
- [Error Handling](https://flow-state.dev/docs/advanced/error-handling) — Retry, rescue, work queue
- [Streaming](https://flow-state.dev/docs/streaming/overview) — Item/content model, SSE protocol, resume semantics

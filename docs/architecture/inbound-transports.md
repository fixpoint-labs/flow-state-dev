# Inbound Transports

Every entry point (HTTP, MCP, webhooks, schedules, custom transports) translates its input into an `InboundRequestEnvelope` and hands it to one host, so the auth/principal/dispatch pipeline exists once. Authoring and mounting an adapter, known sources and conformance are user-facing: [Inbound Transports](../../apps/docs/docs/advanced/inbound-transports.md), [Concurrency policies](../../apps/docs/docs/advanced/concurrency-policies.md). Types: `packages/engine` (`InboundTransportAdapter`, `InboundRequestEnvelope`, `InboundTransportHost`). This page holds the host's invariants.

## Adapter shape

An adapter is an immutable `{ source, createBindings(host) }`. It retains no host reference and has no lifecycle beyond the optional `start`/`stop` in its bindings. `start()` runs after `createFlowApiRouter` collects all bindings and checks route uniqueness (duplicate `(method, path)` → `TransportRouteCollisionError` naming both sources); sync failures abort startup, async rejections are logged. `stop()` runs in reverse from `disposeFlowApiRouter`, best-effort. Adapters are per-registry; per-flow opt-in lives on the flow definition. The HTTP router is the reference adapter; `host.dispatch` is scoped to action execution, and other routes use `host.registry` / `host.stores` directly.

## `source`

`source` is provenance on `RequestRecord` and `ActiveRequestEntry`: an open string (known set `http`, `mcp`, `webhook`, `scheduled`, `notification`). Two hard rules:

- **Event and dispatched sources are set only by adapters / the framework**, which is what makes the source gates in [Action Forms](./action-forms.md#the-source-gate-security) sound.
- **`cli` is reserved for principal resolution and never recorded on a request.** Only the engine's in-process entry (`resolveInProcessPrincipal`, used by `fsdev run`/`chat`) produces it. The host refuses `source: "cli"` on any context that entry didn't build, before any resolver runs, whatever source the adapter declared. The mark is a module-private set, never exported, so **a resolver may safely branch on `source === "cli"`.**

## The address, and admission before materialisation

`envelope.flowKind` is the exact **instance id** (historical name), from every producer: HTTP segment, MCP, webhooks, schedules, CLI, a BullMQ job, a `dispatcher()`. Never a collection's bare kind, which `registry.get` doesn't resolve. On *records*, `flowKind` is the definition's kind (grouping); the owner is `flowId`.

The host resolves the address, then **admits ownership before any effect**: a named `sessionId` / `requestId` is loaded and checked with `resolveRecordOwner`. A foreign owner, an unregistered owner, or an ownerless record under a collection kind throws `FlowInstanceBindingMismatchError` from `dispatch` (surfaced on `accepted`) with **no request stub and no active entry written**. Only an admitted envelope materialises: the stub is create-if-absent, a same-owner conflict is re-stamped, and the active entry is fenced so a refused envelope's cleanup can't deregister an entry it never owned. `runAction` repeats the check for direct callers; `createExecutionContext` checks the owner before touching user, org or history. Ownership is orthogonal to transport trust: `source` and principal say who may call, `flowId` says whose record it is.

## Execution configuration is per host, with one per-envelope exception

The host's `runtimeConfig` governs everything it dispatches. The one exception is `envelope.runtimeConfig`, **set by the framework, never by an adapter or a request body**, for one invariant: **a dispatched child inherits the sending request's effective config, not the host's construction-time one.** `fsdev run --model` builds `{ ...appConfig, modelResolver, logger }`; without the field, a child dispatched by that request would silently use the app's default model.

**The inheritance stops at serialisation, by rule.** A `RuntimeConfig` holds live resolvers, so the external-dispatcher branch ignores the field and the worker uses its own. Carrying only the model *id* wouldn't fix it: the worker has its own gateways and keys, so a forced id might not resolve, trading a silently wrong model for a failure the caller can't see. The host warns at the dispatch that drops an override. A custom host should honour `envelope.runtimeConfig` in-process and expect not to receive it otherwise. Which dispatches are in-process: [Dispatched Work](./dispatched-work.md).

`resolvedActionCore` is the other framework-set field (dynamic schedules only): [Action Forms](./action-forms.md#dynamic-schedules-carry-their-core-so-they-dont-recover).

## Host operations

- **`resolvePrincipal`**: per-flow `authentication.resolvePrincipal` wins over the host fallback; the host applies `defaultUserId` and `requireUser`. Adapters never implement auth themselves. See [Authentication](./authentication.md).
- **`validateDispatch`**, called after `resolvePrincipal` and before `dispatch`. Organization is unconditional: it checks `principal.orgId` and the stored session's `orgId`, **never caller-supplied `envelope.orgId`** (BP-031), and throws transport-agnostic `OrgRequiredError` (HTTP maps to `400`).
- **`dispatch`** returns a synchronous `DispatchHandle` (`requestId`, `liveStream` immediately; `finished` later). An unknown flow throws synchronously, since that's the only failure shape a fire-and-forget call has. `responseEmitter: null` makes the host create an internal emitter.
- **`usesExternalDispatcher` / `arbitratesExternalDispatch`**: published so the dispatch seam can refuse an `{ id }` delivery it can't fence across processes (`external-dispatcher`), unless a shared lease backend arbitrates it. `{ key }` children and transport dispatches enqueue normally.
- **`dispatchOperation`** (installed on `RuntimeConfig.requestHost` by `createFlowState`, and as a last resort by the HTTP handlers) serves in-block `internal`/`task` dispatches. The seam (`engine/context/create-request-host.ts`) resolves the entry, derives or adopts the child, writes its record and stamp; `createDispatchOperation` (`dispatch-operation.ts`) starts it through `host.dispatch` and resolves only on acceptance, so acceptance is decided before the sender's request ends. It answers `{ requestId }` or `{ notStarted, reason }`, and passes through the arbiter and source gates exactly like an adapter. It is not an adapter.

## Concurrency arbitration

Enforced once, at the top of `host.dispatch`, **before any record or stream exists**, so every transport inherits it. Policy: `action.concurrency ?? flow.request.concurrency ?? "allow"`; key defaults to the tenant-namespaced session id, and an `undefined` key means no arbitration.

- **`reject`** claims the key or refuses with `ConcurrencyRejectedError` (409, carrying the in-flight `requestId`), so the dropped caller never materialises a run. In memory the claim is synchronous and `dispatch` throws. Over a shared lease backend it's a round trip taken **after** the ownership read, and the refusal rejects `accepted` / `finished` instead. Adapters map it: HTTP 409, webhook/scheduled a skipped 200, MCP server-busy.
- **`queue`** defers the *start* FIFO while returning the handle synchronously (an SSE client gets an open stream while queued). Over-wait → `ConcurrencyQueueTimeoutError` (503).
- In-process, the key is taken and released within one `dispatch` lifecycle (released when `finished` settles and on every pre-run failure), so there's no handoff and no leak.
- Lines live in a `ConcurrencyLeaseBackend` (`transports/concurrency/lease-backend.ts`): in memory by default (one process; **external dispatch unarbitrated**), or `WorkerAdapter.leaseBackend` shared by every process (`bullmqWorker` supplies a Redis one). Then the place is handed to the job (`ConcurrencyAdmission.handOff()` → `DispatchEnvelope.leasePlace`) after enqueue, and the worker waits its turn and gives it back; any pre-enqueue failure gives it back in the dispatching process.
- Shared places expire unless renewed. A waiter whose place was dropped (`isMyTurn` → `"missing"`) re-queues at the back. A run that can't keep its place (renewal `false`, or none lands for half of `leaseMs`) is stopped via `ConcurrencyAdmission.lost`, folded into the run's signal (BullMQ: `holdLeasePlace`).

Every adapter should pass `createInboundTransportConformanceTests` from `@flow-state-dev/testing/conformance` (a subpath because it imports `vitest` at top level).

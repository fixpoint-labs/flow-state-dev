# Inbound Transports

This document describes the `InboundTransportAdapter` contract — the
abstraction that lets every entry point into the runtime (native HTTP, MCP
servers, webhooks, scheduled actions, cross-flow notifications, custom
transports) land as a sibling of the others under one runtime.

The HTTP entry point exposed by `createFlowApiRouter` is the reference
implementation of this contract; the same factory accepts an `adapters?`
option that mounts additional transports onto the same host.

## Why an abstraction

Before this contract, the framework had exactly one inbound entry point:
`createFlowApiRouter` (HTTP + SSE). Adding MCP, webhook, or scheduled
dispatch meant rebuilding the auth/principal/dispatch pipeline per
transport — an architecturally novel surface every time.

The contract collapses that to one shape: every transport translates its
input into an `InboundRequestEnvelope` and hands it to the host. The
runtime below the adapter is identical regardless of source — the pipeline
is the same one every time, though a single envelope may carry the
configuration its own dispatch runs under (see
[Execution configuration](#execution-configuration-is-per-host-with-one-per-envelope-exception)).

## The contract

```ts
interface InboundTransportAdapter {
  readonly source: string;
  createBindings(host: InboundTransportHost): TransportBindings;
}
```

An adapter is an immutable factory object: a `source` identifier plus a
single pure `createBindings(host)` function. Adapters do not retain
references to the host, are not mounted as plugins, and have no
post-construction lifecycle other than the optional `start` and `stop`
hooks returned in their bindings. This matches the codebase's existing
options-bag-factory convention (`createFlowApiRouter`, `createSQLiteStores`,
`createVercelHandler`, etc.).

`bindings.start()` runs after `createFlowApiRouter` collects all
bindings and validates route uniqueness. Synchronous failures abort host
startup; async rejections are logged (`console.error`) so they don't get
silently swallowed. `bindings.stop()` runs from `disposeFlowApiRouter(router)`,
in reverse order, on a best-effort basis. Most callers don't need to
call `dispose` — Next.js / Vercel / serverless hosts tear down by
killing the process. It's intended for long-running custom servers and
tests.

### The envelope

Every adapter constructs one of these before invoking the runtime:

```ts
interface InboundRequestEnvelope {
  source: string;
  /** The addressed flow INSTANCE id (a singleton's kind, a collection member's own id). Historical spelling. */
  flowKind: string;
  action: string;
  input: unknown;
  sessionId?: string;
  requestId?: string;
  orgId?: string;
  principal: ResolvedPrincipal;
  metadata?: Record<string, unknown>;
  rawBody?: Uint8Array;
  responseEmitter?: ResponseEmitter | null;
  signal?: AbortSignal;
  resolvedActionCore?: ActionCore;
  runtimeConfig?: RuntimeConfig;
}
```

`resolvedActionCore` is the carried-core escape hatch. It's set only by an
adapter for the one ad-hoc path with no static coordinate — the dynamic
schedule, whose handler is produced by a resolver at dispatch time and can't
be reached from `flow.schedules.static`. `runAction` prefers it when present.
It is not serialized and not persisted, so dynamic schedules don't recover
across crashes. See [Action forms](./action-forms.md).

`source` is provenance — first-class on `RequestRecord` and
`ActiveRequestEntry`, propagated through to DevTool's request list. It is
an open string; the documented known-set is `http`, `mcp`, `webhook`,
`scheduled`, `notification`. Custom transports pick their own.

`cli` is reserved, and it is a principal-resolution source only: it appears
on the `PrincipalResolutionContext` a resolver sees, never on a request record.
Only the engine's in-process entry point (`resolveInProcessPrincipal`, which
`FlowState.resolveInProcessPrincipal` calls) produces it, for `fsdev run` and
`fsdev chat`, which then execute through `runAction` without a `source`, so
their requests are recorded under `runAction`'s default. The host refuses
`source: "cli"` on any context that entry point did not build, before any
resolver runs, whatever source the adapter itself declared. The mark is a
module-private set in the host module, never exported and never on the host
adapters receive, so a resolver may safely branch on `source === "cli"`
(FIX-1551).

### The address is an instance id, and admission precedes materialization

`envelope.flowKind` is the exact instance address. Every producer — the HTTP
adapter's route segment, the MCP adapter, webhooks, schedules, the CLI, a
BullMQ job's `flowKind`, a `dispatcher()`'s `flowKind` selector — carries the
instance id under that historical name and never the bare kind of a collection
flow, which `registry.get` does not resolve. `flowKind` on a *record*
(`SessionRecord`, `RequestRecord`, `ActiveRequestEntry`) is the definition's
kind, metadata for grouping; the owner is `flowId`.

The host resolves the address (`registry.get`), then **admits ownership before
any effect**: a named `sessionId` or `requestId` is loaded and checked with
`resolveRecordOwner`; a foreign owner, an owner no longer registered, or an
ownerless record under a collection kind is `FlowInstanceBindingMismatchError`
thrown from `dispatch` (surfaced on `DispatchHandle.accepted`) with no request
stub written and no active-request entry registered. Only an admitted envelope
materializes: the request stub is written create-if-absent, a same-owner
conflict is re-stamped, and the active entry is fenced so a refused envelope's
cleanup cannot deregister an entry it never owned. `runAction` repeats the
check for direct callers, and `createExecutionContext` loads session and
request first and checks the owner before touching user, org or history.
Ownership is orthogonal to transport trust: `source` and the resolved principal
say who may call; `flowId` says which instance a record belongs to.

### Execution configuration is per host, with one per-envelope exception

The host's `runtimeConfig` is the execution configuration for everything it
dispatches. That is the rule, and `runtimeConfig` on the envelope is the single
exception to it — set by the framework, never by an adapter and never read from
a request body.

It exists for one invariant: **a dispatched child inherits the sending request's
effective config, not the host's construction-time one.** A host is built once,
but any given request may be running under a config its caller derived. `fsdev
run` is the shipped case: it builds `{ ...appConfig, modelResolver, logger }` so
`--model` takes effect, and a child session that request dispatches is that
request's own work continued in the background. Without the field the child
would silently resolve the app's default model while the flag claimed otherwise.

**The inheritance cannot cross a serialization boundary, and that is part of the
rule rather than an exception to it.** A `RuntimeConfig` holds live resolvers and
providers, so the external-dispatcher branch ignores this field: a queued job
runs under its own worker's configuration, which is the only thing that process
can honour. Carrying just the selected model *id* across would not fix it — the
worker has its own gateways and keys, so a forced id may not resolve there at
all, replacing a silently wrong model with a failure surfacing where the caller
cannot see it. The host therefore emits a warning at the dispatch that drops an
override rather than pretending it applied.

A custom host or dispatcher should read this as: honour `envelope.runtimeConfig`
when you run work in-process, and expect not to receive it when you don't.

Which dispatches run in-process, and what else changes with that answer, is
[Dispatched Work](./dispatched-work.md).

### The shared action core

Every action — caller-addressed or event-addressed — is built on one shape:
`ActionCore` (the handler `block` plus execution policy: `durable`,
`tokenBudget`, `onCompleted`/`onErrored`, `inputSchema`, `userMessage`).
A caller-addressed action (`ActionConfig` in `flow.actions`) adds the
HTTP/MCP exposure metadata. An event-addressed handler — webhook or
scheduled — carries the core inline on its transport binding and never enters
`flow.actions`, so it has no caller surface. The runtime dispatches, runs, and
records all forms identically; it only differs in how it finds the core.

`resolveActionCore` is that seam. For an event dispatch it reads a
**namespaced** coordinate out of metadata — `metadata.webhook`
or `metadata.schedule.scheduleId` — gated on the
`source` the adapter set, and looks the binding up on the matching transport
map. A caller-addressed dispatch resolves the named `flow.actions` entry. The
source gate matters for security: a caller POSTing to the public action
endpoint can forge `metadata`, but cannot set `source`, so it cannot pivot
resolution into an event handler. See [Action forms](./action-forms.md) for
the full argument.

### The host

```ts
interface InboundTransportHost {
  readonly registry: FlowRegistry;
  readonly stores: StoreRegistry;
  readonly resolvers?: { /* model, speech, transcription */ };
  validateDispatch(envelope: InboundRequestEnvelope): Promise<void>;
  dispatch(envelope: InboundRequestEnvelope): DispatchHandle;
  resolvePrincipal(ctx: PrincipalResolutionContext): Promise<ResolvedPrincipal>;
  /** True when `dispatch` hands the run to another process (a queue adapter). */
  readonly usesExternalDispatcher: boolean;
  /** True when that external work is arbitrated over a lease backend the worker processes share. */
  readonly arbitratesExternalDispatch?: boolean;
}
```

`host.usesExternalDispatcher` is published so a request-host operation can
refuse what cannot be fenced across a process boundary: a `dispatcher()`
delivering into an *existing* session (`{ id }`) is refused with
`external-dispatcher` on such a host, while a `{ key }` child and every
transport dispatch take the ordinary enqueue path. The refusal is lifted when
`host.arbitratesExternalDispatch` is true, which the host sets when its arbiter
runs over a lease backend the worker adapter supplied: the delivery is then
fenced by its place on the session's key, which every process honours.

One operation runs *from inside a block* through the same host, installed on
`RuntimeConfig.requestHost` by `createFlowState` (and as a last resort by the
HTTP handlers): `dispatchOperation`, which the dispatch seam uses for an
`internal` or `task` dispatch — a `dispatcher()` block, or a task board's
hand-off at a dispatcher in its `workers`. The seam (`engine/context/create-request-host.ts`)
resolves the entry, derives or adopts the child session and writes its record,
and assembles the envelope with the source and the server-assembled
`metadata.dispatch`; `createDispatchOperation({ host })`
(`engine/context/dispatch-operation.ts`) then starts it through
`host.dispatch` and resolves only once the host has accepted it, so acceptance
is decided before the sender's request ends. It answers `{ requestId }` or
`{ notStarted, reason }`. The operation reaches the concurrency arbiter and
the transport-source gates exactly as an adapter's dispatch does; it is not an
adapter.

`host.validateDispatch` enforces async flow-level pre-conditions.
Adapters must call it after `resolvePrincipal` and before `dispatch`.
Currently it enforces that the dispatch carries an organization at all. There
is no per-flow opt-in — organization is unconditional — so the method checks
`principal.orgId` and the stored session's `orgId`, never a caller-supplied
`envelope.orgId` (BP-031). If neither provides one, it throws
`OrgRequiredError`. The error is transport-agnostic (no HTTP status); the HTTP
adapter maps it to `400 { error: "OrgRequired", message }`.

`host.dispatch` is fire-and-forget: it returns a synchronous
`DispatchHandle` whose `liveStream` and `requestId` are available
immediately, while `finished` resolves when the action completes. Adapters
that need a streamed response (HTTP+SSE) consume `handle.liveStream.readable`;
adapters that just want a final result (webhook, schedule) await
`handle.finished`.
Before it creates anything, `dispatch` runs the concurrency arbiter; see
[Concurrency arbitration](#concurrency-arbitration).

`host.resolvePrincipal` is the auth integration point. Per-flow
`authentication.resolvePrincipal` (set on `defineFlow`) wins over the
host-level fallback (`createFlowApiRouter({ resolvePrincipal })`). Adapter
code does not change because adapters always call `host.resolvePrincipal`
rather than implementing auth themselves; the host applies per-flow
routing, `defaultUserId` fallback, and `requireUser` enforcement
transparently. See `authentication.md`.

### Concurrency arbitration

The **concurrency policy** (FIX-837) is enforced at the top of `host.dispatch`,
before any request record or live stream is created, so every transport
inherits it at the one shared seam. The arbiter resolves the effective policy
(`action.concurrency ?? flow.request.concurrency ?? "allow"`) and a key
(default: the tenant-namespaced session id):

- `reject` claims the key; if another request holds it, the dispatch is refused
  with `ConcurrencyRejectedError` (status 409, carrying the in-flight
  `requestId`) before a record exists, so the dropped caller never materializes
  a run. Over the in-memory default the claim is synchronous and `dispatch`
  throws, which extends the set of synchronous `dispatch` throws beyond
  malformed/unknown-flow. Over a shared lease backend the claim is a round
  trip, taken only after the session and request-id ownership read passes, and
  the refusal rejects `accepted` and `finished` instead. Every adapter maps
  both: HTTP to 409, webhook and scheduled to a skipped 200, MCP to server-busy.
- `queue` defers the *start* of execution behind the key (FIFO) while still
  returning the handle synchronously, so an SSE client gets an open stream while
  queued. An over-long wait rejects `finished` with `ConcurrencyQueueTimeoutError`
  (status 503).
- `hold` takes a place in the key's line and starts at once, without waiting
  for its turn. It is never refused. The place only marks the key busy, so a
  `queue` waiter lines up behind it and a `reject` is refused while it runs.
- `defer` takes nothing at admission. When the run is due, it claims the key
  the way `reject` does, only if no place is held or waiting, and otherwise
  waits and tries again: woken when the key empties in memory, on a backoff
  over a shared backend. It takes the queued branch (stub record, heartbeat,
  cancel watch). The wait has no budget, because every place it waits on ends:
  its run settles and gives it back (success, error or abort), or, on a shared
  backend, a crashed process stops renewing it and it expires. That expiry is
  the crash path; nothing needs to give a dead holder's place back. A claimed
  `defer` holds the key, so `defer` runs are serialized among themselves, and
  a `hold` still starts beside one.
- `hold` and `defer` are arbitrated in process only. A BullMQ worker waits
  for a place's turn, which is `queue`; it has no form for a place that must
  not wait or a claim that waits for a free key. An external dispatch under
  either policy therefore resolves to `allow`.
- `allow` (default) and a key that resolves to `undefined` (no session, `"none"`,
  or a custom key returning `undefined`) are passthroughs.

**Where the lines live.** The arbiter keeps its lines in a lease backend
(`transports/concurrency/lease-backend.ts`): in memory by default, which
serializes one process, or the one a queue adapter supplies as
`WorkerAdapter.leaseBackend`, which every process of the deployment shares.
`bullmqWorker` supplies one on its Redis (`createRedisLeaseBackend`). An
external dispatch is arbitrated only over a shared backend; that is what
`host.arbitratesExternalDispatch` reports.

**Who holds the key.** On the in-process path the key is acquired and released
within a single `dispatch` lifecycle (released when `finished` settles, and on
every failure before the run starts), so there is no cross-call handoff and no
leaked key. On the external path over a shared lease backend the place rides
the job as `DispatchEnvelope.leasePlace`: it is handed off
(`ConcurrencyAdmission.handOff()`) once the job is enqueued, the worker waits
its turn, and gives it back when the run ends. Every failure before the enqueue
gives it back in the dispatching process.

**Expiry.** A shared backend's places expire unless renewed. A waiter whose
place the backend dropped (`isMyTurn` answers `"missing"`) takes a new place at
the back of the line, in the arbiter's wait and in the BullMQ worker alike. A
run holding its turn whose place can no longer be kept (a renewal answers
`false`, or none lands for half the backend's `leaseMs`) is stopped through
`ConcurrencyAdmission.lost`, which the host folds into the run's signal; the
BullMQ worker does the same with `holdLeasePlace`.

## The HTTP adapter as reference

```ts
import { createFlowApiRouter } from "@flow-state-dev/engine";

const router = createFlowApiRouter({ registry, stores });
```

Internally, `createFlowApiRouter` constructs the host, registers the
built-in HTTP adapter, and exposes the canonical `{ GET, POST, PATCH,
DELETE }` dispatcher. Behavior is byte-identical to the pre-contract
router for callers that don't pass `adapters`.

Action execution flows through `host.dispatch`; session, state, resource,
stream, abort, and recovery routes use `host.registry` and `host.stores`
directly. `host.dispatch` is scoped to action execution by design — the
transport boundary lives at the action call, not at every route.

## Authoring a custom adapter

A minimal adapter looks like this:

```ts
import type { InboundTransportAdapter } from "@flow-state-dev/engine";
import { OrgRequiredError } from "@flow-state-dev/engine";

export function createEchoAdapter(): InboundTransportAdapter {
  return {
    source: "echo",
    createBindings(host) {
      return {
        routes: [
          {
            method: "POST",
            path: "/api/flows/echo",
            handler: async (req) => {
              const body = (await req.json()) as { flowKind: string; action: string; input: unknown; userId: string };
              const principal = await host.resolvePrincipal({
                source: "echo",
                request: req,
                envelope: {
                  flowKind: body.flowKind,
                  action: body.action,
                  input: body.input,
                  metadata: { body }
                }
              });
              const envelope = {
                source: "echo" as const,
                flowKind: body.flowKind,
                action: body.action,
                input: body.input,
                principal
              };
              await host.validateDispatch(envelope);
              const handle = host.dispatch(envelope);
              const result = await handle.finished;
              return new Response(JSON.stringify(result), { status: 200 });
            }
          }
        ]
      };
    }
  };
}
```

Mount it with:

```ts
const router = createFlowApiRouter({
  registry,
  stores,
  adapters: [createEchoAdapter()]
});
```

Routes from every adapter merge into the returned dispatcher; path
collisions among non-HTTP adapters throw `TransportRouteCollisionError`
at construction time so dispatch is unambiguous at runtime.

## Adapter scope: per-registry

Adapters mount onto a host built from one `FlowRegistry`. One adapter
serves every flow in the registry. Per-flow opt-in (e.g., "expose only
flow X over MCP") lives on the flow definition, not the adapter shape.

## The `source` known-set

| Value | Used by |
| -- | -- |
| `http` | The default HTTP adapter |
| `mcp` | MCP server adapter (`@flow-state-dev/mcp`) |
| `webhook` | Webhook receivers |
| `scheduled` | Scheduled dispatch (`@flow-state-dev/scheduled`, FIX-440) |
| `notification` | No built-in transport sends it. A custom transport may use it, and the DevTool labels those requests *Notification* |

Custom transports pick their own string, except `cli`, which is reserved for
principal resolution and never recorded on a request (see "The envelope").
DevTool renders known sources
with affordances (icon, label) and falls back to the raw value for
anything else.

## The scheduled adapter shape

`@flow-state-dev/scheduled` (FIX-440) is the third concrete adapter
after HTTP and MCP. It mounts a single dispatch route per flow
(`POST /api/flows/:flowKind/schedules/:scheduleId/dispatch`) and a
listing sibling (`GET /api/flows/:flowKind/schedules`). Dispatch is
fire-and-forget: the adapter builds an envelope with
`responseEmitter: null` and returns 202 the moment `host.dispatch`
returns the handle. Action work runs through the same runtime as
HTTP, so `RequestRecord`, items, item log, and DevTool surface are
identical.

Schedules come in two shapes. Static schedules live on
`flow.schedules.static` (a typed `Record<string, ScheduleConfig>`).
Dynamic schedules are resolved at dispatch time by a
`schedules.resolve(scheduleId, ctx) → ScheduleConfig | null` hook on
the flow. The framework does not own schedule storage — the resolver
backs the hook with a flow-state resource collection (via the
reference helper `createResourceCollectionScheduleResolver`), a SQL
table, or an external service. Static lookup happens first; the
resolver is only called when `static[id]` returns nothing.

Auth is two-phase. The dispatch endpoint runs through
`host.resolvePrincipal` to establish the gateway principal — typically
a system user proven via a shared scheduler secret
(`createBearerSecretPrincipalResolver`, exported from
`@flow-state-dev/engine`). Each schedule then carries its own optional
`principal` (the *target* user the action runs as), which wins over
the gateway principal during dispatch. The runtime resolves
`schedule.principal ?? gatewayPrincipal` and dispatches with that as
the effective principal.

Source and metadata propagate through to `RequestRecord` so DevTool
and the trace channel can distinguish scheduled work: `source =
"scheduled"` plus the namespaced `metadata.schedule = { scheduleId,
origin, cron, nominalFireTime, dispatchedAt, timezone }`. Each transport
namespaces its provenance the same way — `metadata.webhook`,
`metadata.schedule` — and `resolveActionCore` reads the
event coordinate from that slot. See
[`scheduled-actions.md`](./scheduled-actions.md) for the full design
notes.

## Conformance suite

`@flow-state-dev/testing/conformance` exports
`createInboundTransportConformanceTests`, modeled on
`store-cas-contract.test.ts`. The helpers live on that subpath because
they import `vitest` at module top level; the package index does not
re-export them. Every adapter implementation should run the suite:

```ts
import { createInboundTransportConformanceTests } from "@flow-state-dev/testing/conformance";

createInboundTransportConformanceTests({
  name: "myAdapter",
  factory: () => createMyAdapter(),
  helpers: {
    buildEnvelope: async (adapter, host) => { /* ... */ }
  }
});
```

The HTTP adapter is the first conforming implementation. The MCP
server adapter (`@flow-state-dev/mcp`) is the second; see
[`mcp-server.md`](./mcp-server.md). The scheduled adapter
(`@flow-state-dev/scheduled`, FIX-440) is the third; see
[`scheduled-actions.md`](./scheduled-actions.md). Future webhook and
notification adapters plug into the same harness.

## Edge cases

- Two adapters declare the same `(method, path)` → `TransportRouteCollisionError`
  thrown at host construction. Names both adapter sources.
- Adapter passes `responseEmitter: null` (fire-and-forget) → the host
  creates an internal emitter so the runtime always has somewhere to
  write items. The handle exposes whichever emitter was used.
- `host.dispatch` called with an unknown `flowKind` → throws synchronously
  (the call path is fire-and-forget, so synchronous throw is the only
  meaningful failure shape).
- `host.validateDispatch` called without an org on the principal or the
  stored session → throws `OrgRequiredError`.
  The HTTP adapter maps this to `400 { error: "OrgRequired" }`; other
  adapters map it to their native error shape.
- Adapter constructed but never passed to `createFlowApiRouter` → no
  effect. Adapters are inert factory objects until `createBindings` is
  called.

## What's not in scope here

- The MCP, webhook, scheduled, and notification adapters themselves —
  each is its own issue and ships independently.
- Outbound transport adapters (Ably AI Transport) — the symmetric mirror
  on the response side.

## Related

- [Action forms](./action-forms.md) — the shared `ActionCore` model, the
  `resolveActionCore` seam and its source gate, and the carried-core
  mechanism for dynamic schedules.
- `docs/architecture/authentication.md` — `resolvePrincipal` contract,
  per-flow auth config, `requireUser` semantics, convenience verifiers.
- `docs/architecture/server-and-client.md` — the route table is now
  produced by the HTTP adapter rather than hard-coded in the router.
- `docs/architecture/streaming.md` — `LiveRequestStream` / `ResponseEmitter`
  are public types adapters consume.
- `packages/engine/README.md` — public API reference for
  `createFlowApiRouter` and the `adapters` option.

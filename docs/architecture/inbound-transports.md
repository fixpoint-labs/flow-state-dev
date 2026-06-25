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
runtime below the adapter is identical regardless of source.

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
`scheduled`, `notification`, `chat`. Custom transports pick their own.

### The shared action core

Every action — caller-addressed or event-addressed — is built on one shape:
`ActionCore` (the handler `block` plus execution policy: `durable`,
`tokenBudget`, `onCompleted`/`onErrored`, `inputSchema`, `userMessage`).
A caller-addressed action (`ActionConfig` in `flow.actions`) adds the
HTTP/MCP exposure metadata. An event-addressed handler — webhook, chat, or
scheduled — carries the core inline on its transport binding and never enters
`flow.actions`, so it has no caller surface. The runtime dispatches, runs, and
records all forms identically; it only differs in how it finds the core.

`resolveActionCore` is that seam. For an event dispatch it reads a
**namespaced** coordinate out of metadata — `metadata.webhook`,
`metadata.chat.eventKey`, or `metadata.schedule.scheduleId` — gated on the
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
  readonly middleware?: Middleware[];
  validateDispatch(envelope: InboundRequestEnvelope): Promise<void>;
  dispatch(envelope: InboundRequestEnvelope): DispatchHandle;
  resolvePrincipal(ctx: PrincipalResolutionContext): Promise<ResolvedPrincipal>;
}
```

`host.validateDispatch` enforces async flow-level pre-conditions.
Adapters must call it after `resolvePrincipal` and before `dispatch`.
Currently it enforces `requiresOrg`: when a flow declares
`requiresOrg: true`, the method checks `envelope.orgId`,
`principal.orgId`, and the stored session's `orgId` in that order.
If none provides an org, it throws `OrgRequiredError`. The error is
transport-agnostic (no HTTP status); the HTTP adapter maps it to
`400 { error: "OrgRequired", message }`.

`host.dispatch` is fire-and-forget: it returns a synchronous
`DispatchHandle` whose `liveStream` and `requestId` are available
immediately, while `finished` resolves when the action completes. Adapters
that need a streamed response (HTTP+SSE) consume `handle.liveStream.readable`;
adapters that just want a final result (webhook, schedule) await
`handle.finished`.

`host.resolvePrincipal` is the auth integration point. Per-flow
`authentication.resolvePrincipal` (set on `defineFlow`) wins over the
host-level fallback (`createFlowApiRouter({ resolvePrincipal })`). Adapter
code does not change because adapters always call `host.resolvePrincipal`
rather than implementing auth themselves; the host applies per-flow
routing, `defaultUserId` fallback, and `requireUser` enforcement
transparently. See `authentication.md`.

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
| `notification` | Cross-flow event subscribers |

Custom transports pick their own string. DevTool renders known sources
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
`metadata.chat`, `metadata.schedule` — and `resolveActionCore` reads the
event coordinate from that slot. See
[`scheduled-actions.md`](./scheduled-actions.md) for the full design
notes.

## Conformance suite

`@flow-state-dev/testing` exports `createInboundTransportConformanceTests`,
modeled on `store-cas-contract.test.ts`. Every adapter implementation
should run the suite:

```ts
import { createInboundTransportConformanceTests } from "@flow-state-dev/testing";

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
- `host.validateDispatch` called for a `requiresOrg` flow without an org
  on the envelope, principal, or stored session → throws `OrgRequiredError`.
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

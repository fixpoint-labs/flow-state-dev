---
sidebar_position: 4
---

# Inbound Transports

The server runtime accepts requests through one or more inbound transports.
The default deployment exposes a single HTTP entry point — that's what you
see when you wire `createFlowApiRouter` into a Next.js catch-all route.
Other transports (MCP servers, webhooks, scheduled actions) plug in as
siblings of HTTP.

## Why one contract

Before this contract existed, every new way of driving a flow had to
re-invent the auth pipeline, the principal resolution, the dispatch
machinery. That worked for the first transport. It scaled badly past one.

With the contract, every entry point looks the same to the runtime. A
transport translates whatever it receives — an HTTP request, an MCP
`tools/call`, a webhook POST, a cron tick — into an
`InboundRequestEnvelope` and hands it to the host. The host owns the
runtime; the transport owns its protocol.

## What an adapter looks like

```ts
import type { InboundTransportAdapter } from "@flow-state-dev/engine";

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
              const body = await req.json();
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
              const handle = host.dispatch({
                source: "echo",
                flowKind: body.flowKind,
                action: body.action,
                input: body.input,
                principal
              });
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

Two things matter here.

`source` is provenance. Every request the adapter dispatches carries it
through to the `RequestRecord` and surfaces in DevTool as a small badge
next to the action. The known values are `http`, `mcp`, `webhook`,
`scheduled`, `notification` — pick your own for custom transports, the
framework does not enforce an enum.

### Known sources

| Value | Used by |
| -- | -- |
| `http` | The default HTTP adapter |
| `mcp` | MCP server adapter (`@flow-state-dev/mcp`) |
| `webhook` | Webhook receivers |
| `scheduled` | Scheduled dispatch (`@flow-state-dev/scheduled`) |
| `notification` | Cross-flow event subscribers |

DevTool renders known sources with a label and a small badge. Custom
transport sources fall back to the raw string.

`host.dispatch` is fire-and-forget. It returns a synchronous handle whose
`liveStream` and `requestId` are available immediately, while `finished`
resolves when the action completes. Adapters that need a streamed
response consume `handle.liveStream.readable`. Adapters that only want
the final result await `handle.finished`.

### Concurrency policy enforcement

A flow's concurrency policy is enforced once, at the shared host dispatch
seam every adapter funnels through. So the same declaration governs HTTP,
chat, webhooks, scheduled, and MCP without per-transport code — an adapter
just constructs its envelope and calls `host.dispatch`. See
[Concurrency policies](./concurrency-policies.md) for the policy surface.

## Mounting a custom adapter

```ts
const router = createFlowApiRouter({
  registry,
  stores,
  adapters: [createEchoAdapter()]
});
```

The default HTTP adapter is always mounted; `adapters` adds extras. Routes
from every adapter merge into the returned `{ GET, POST, PATCH, DELETE }`
dispatcher. If two adapters declare the same `(method, path)` pair, the
router throws `TransportRouteCollisionError` at construction time —
better than ambiguous runtime dispatch.

### Scheduled adapter shape

`@flow-state-dev/scheduled` is the second concrete adapter after MCP.
It mounts `POST /api/flows/:flowKind/schedules/:scheduleId/dispatch`
and a sibling `GET` for listing static schedules. Dispatch is
fire-and-forget: the adapter constructs an envelope with
`responseEmitter: null` and returns 202 the moment `host.dispatch`
returns the handle. The action runs to completion under the framework
runtime and surfaces in DevTool like any other request.

Dynamic schedules are resolved at dispatch time via a hook on the flow
definition (`schedules.resolve(scheduleId, ctx)`). The framework does
not own schedule storage — the host backs the hook with a flow-state
resource collection, a database table, or an external service.

Auth is two-phase. The dispatch endpoint runs through
`host.resolvePrincipal` like every other route to establish the
gateway principal (typically a system user proven via a shared
scheduler secret). Each schedule then carries its own `principal`,
which wins over the gateway principal when the action runs. Static
framework-level schedules usually omit it; per-user dynamic schedules
synthesize it from the schedule's owner so the action runs as the
right user.

`source: "scheduled"`, `metadata.scheduleId`, `metadata.origin`
(`"static"` or `"dynamic"`), `metadata.cron`, `metadata.nominalFireTime`,
`metadata.dispatchedAt`, and `metadata.timezone` propagate to
`RequestRecord` for trace and DevTool. See
[Scheduled actions](/docs/server/scheduled) for the full surface.

### Webhook adapter shape

`createWebhookTransportAdapter` (in `@flow-state-dev/engine`, next to the
HTTP adapter) mounts one parameterized route,
`POST /api/flows/:flowKind/webhooks/:provider`, and dispatches verified
inbound webhooks — Stripe, GitHub, Slack Events, any signed service POST —
to the action the flow declared.

The split is the adapter's defining trait. The *flow* declares routing only
(`webhooks: { <provider>: { on } }` in `@flow-state-dev/core`) and carries no
secrets. The *host* supplies provider mechanics — signature verification,
payload parsing, event-type and delivery-id extraction, the optional
handshake — at adapter mount via `WebhookProviderDefinition`, keyed by the
same provider name. Verification needs Node `crypto`, which isn't
isomorphic, so it lives on the host, not the flow definition.

Like Scheduled, dispatch is fire-and-forget with `responseEmitter: null`:
the adapter verifies, routes, ensures the session, fires `host.dispatch`,
and returns 202 the moment the handle is back. Because the action runs
asynchronously, the ack returns well inside provider budgets (Slack 3s,
GitHub 10s). The flow kind is carried in the URL, so the adapter resolves
one flow per request via `host.registry.get(flowKind)` — the same
per-request lookup MCP and Scheduled use, unlike the chat adapter's
mount-time index.

`source: "webhook"` and `metadata.webhook` (`provider`, `eventType`, and
`deliveryId` when configured) propagate to `RequestRecord` for trace and
DevTool. See [Webhook receivers](/docs/server/webhooks) for the full surface.

## Auth

Every adapter calls `host.resolvePrincipal` before constructing an
envelope. Per-flow `defineFlow({ authentication })` wins over the
host-level fallback configured on
`createFlowApiRouter({ resolvePrincipal })`, which itself defaults to
reading `body.userId` from the parsed HTTP body. Adapters never implement
auth themselves — see the [Authentication](/docs/server/authentication) page for
the resolver contract, `requireUser` semantics, and the bundled HMAC and
JWT helper utilities.

## Per-registry, not per-flow

Adapters mount onto a host built from one `FlowRegistry`. One adapter
serves every flow in that registry. Per-flow opt-in (e.g. "expose only
flow X over MCP") lives on the flow definition, not the adapter shape.

## Conformance

`@flow-state-dev/testing` exports a conformance suite. Run it against
your adapter and you've validated the contract:

```ts
import { createInboundTransportConformanceTests } from "@flow-state-dev/testing";

createInboundTransportConformanceTests({
  name: "myAdapter",
  factory: () => createMyAdapter(),
  helpers: {
    buildEnvelope: async (adapter, host) => {
      // your envelope construction here
    }
  }
});
```

The HTTP adapter is the first conforming implementation.

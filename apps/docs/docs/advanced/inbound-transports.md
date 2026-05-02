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
import type { InboundTransportAdapter } from "@flow-state-dev/server";

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

`host.dispatch` is fire-and-forget. It returns a synchronous handle whose
`liveStream` and `requestId` are available immediately, while `finished`
resolves when the action completes. Adapters that need a streamed
response consume `handle.liveStream.readable`. Adapters that only want
the final result await `handle.finished`.

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

---
sidebar_position: 1
---

# Transports

A *transport* is how a request reaches a flow. The default transport is
HTTP — the API router that ships with `@flow-state-dev/server` and
serves your flows under `/api/flows/...`. The MCP transport is the
second, and it exposes any flow as an MCP server.

Every transport is an implementation of the same `InboundTransportAdapter`
contract. The runtime under the adapter is identical regardless of where
the request came from: same actions, same scopes, same item streaming,
same `RequestRecord` log, same DevTool surface. A flow you wrote for the
chat UI is reachable from Claude Desktop with one config flag, and the
session, state, and observability behave exactly the same way.

## What an adapter actually does

An adapter has one job: turn whatever the outside world sent into a
shape the runtime can dispatch. That shape is the *envelope*:

```ts
type InboundRequestEnvelope = {
  source: string;            // 'http' | 'mcp' | ...
  flowKind: string;
  action: string;
  input: unknown;
  sessionId?: string;
  principal: { userId?: string; orgId?: string };
  metadata?: Record<string, unknown>;
};
```

The HTTP adapter parses the URL and request body. The MCP adapter
parses a JSON-RPC `tools/call` and resolves the tool name to an action.
Future adapters do the equivalent for whatever wire format they speak.
Below the adapter, every envelope flows through `host.dispatch` and
hits `runAction` the same way.

`source` is provenance metadata. It rides along with the request,
lands on `RequestRecord.source`, and is what makes the DevTool render
an MCP request with the purple `MCP` badge.

## Authentication is shared

Authentication is not per-transport. Every adapter calls
`host.resolvePrincipal` with the request context, and the flow's
`authentication.resolvePrincipal` hook decides what `userId` (and
optionally `orgId`) the request gets bound to. A bearer token from
Claude Desktop and a session cookie from your web app go through the
same hook with different `ctx.source` and different `ctx.request`
headers; the resolver branches on whichever it cares about.

See [Authentication](../server/authentication) for the full hook
contract.

## Mounting transports

`createFlowApiRouter` always mounts the HTTP adapter. Additional
transports go in the `adapters` option:

```ts
import { createFlowApiRouter } from "@flow-state-dev/server";
import { createMcpTransportAdapter } from "@flow-state-dev/mcp";

const router = createFlowApiRouter({
  registry,
  stores,
  adapters: [createMcpTransportAdapter()]
});
```

The router's catch-all handler dispatches to the right adapter based on
the path; non-HTTP adapter routes get first-match priority, so the MCP
endpoint at `/api/flows/billing/mcp` is never shadowed by the HTTP
action route.

## Transports today

| Transport | Source | Package | Endpoint |
| --- | --- | --- | --- |
| HTTP | `http` | `@flow-state-dev/server` | `POST /api/flows/:kind/actions/:action` |
| MCP | `mcp` | `@flow-state-dev/mcp` | `POST /api/flows/:kind/mcp` |

The HTTP transport is the default chat-and-action API consumed by the
React client and the DevTool. The MCP transport exposes a flow to
Claude Desktop, Cursor, or any MCP client. See [MCP server](./mcp) for
how to opt a flow into MCP exposure.

## Why an abstraction

The shape of the runtime — actions, scopes, resources, streaming,
observability — does not depend on how the request arrived. Pulling
that into one interface means a flow that runs in the chat UI also
runs from an MCP client without touching its code, and adding a new
way to drive a flow does not mean rebuilding the auth and dispatch
pipeline each time.

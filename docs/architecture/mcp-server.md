# MCP Server Adapter

`@flow-state-dev/mcp` exposes any flow as a Model Context Protocol (MCP)
server over Streamable HTTP. It is the second concrete
`InboundTransportAdapter` after the built-in HTTP adapter — see
[Inbound Transports](./inbound-transports.md) for the contract it conforms
to.

The runtime below the adapter is identical to HTTP. `host.dispatch` runs
the action; `RequestRecord.source = "mcp"` carries provenance through
to the devtool, where MCP-originated requests render with a purple
`MCP` badge.

## Endpoint shape

One MCP server per flow. For a flow with `kind: "billing"` and
`mcp.enabled: true`:

```
POST   /api/flows/billing/mcp     ← all JSON-RPC traffic
GET    /api/flows/billing/mcp     ← 405 Method Not Allowed
DELETE /api/flows/billing/mcp     ← 405 Method Not Allowed
```

This matches how MCP clients are configured in the wild — one server per
integration. Cross-flow tool sets are not collapsed into a single endpoint.

## Per-flow opt-in

A flow opts in via the `mcp` config block:

```ts
defineFlow({
  kind: "billing",
  mcp: {
    enabled: true,             // default false
    exposeResources: true      // default true (currently empty in v1)
  },
  actions: {
    recordPayment: {
      inputSchema,
      block,
      description: "Record a payment for an open invoice. ..."
    },
    customName: {
      inputSchema,
      block,
      description: "...",
      mcp: { name: "logPayment" }   // override the auto-derived tool name
    },
    privateInternal: {
      inputSchema,
      block,
      mcp: { enabled: false }       // exclude from MCP exposure
    }
  }
});
```

`description` is required at registration on every action that ends up
exposed via MCP. The text becomes the LLM-facing tool description and
must communicate (1) what the tool does, (2) when to use it vs.
siblings, (3) preconditions and side effects, (4) what each argument
means with units/format. `defineFlow` throws with a clear error if any
exposed action has no description.

## Mounting

```ts
import { createFlowApiRouter } from "@flow-state-dev/server";
import { createMcpTransportAdapter } from "@flow-state-dev/mcp";

const router = createFlowApiRouter({
  registry,
  stores,
  adapters: [createMcpTransportAdapter()]
});
```

That's it. The MCP routes register alongside the HTTP catch-all; the
router's dispatcher gives non-HTTP adapter routes first-match priority,
so the MCP path never collides with the HTTP action route.

## Action → tool conversion

Action keys are converted to MCP tool names with `decamelize` (no flow
prefix — the flow is the server, scope is implicit at the endpoint):

| Action key | Tool name |
| --- | --- |
| `recordPayment` | `record_payment` |
| `URLParser` | `url_parser` |
| `getHTTPSProxy` | `get_https_proxy` |
| `event-queue` | `event-queue` |

Two actions resolving to the same tool name throw at flow registration
— the MCP client cache keys on tool name, so a runtime collision would
silently break tool calls. Override the auto-derived name on a single
action by setting `mcp.name`; the override participates in the same
collision check.

The action's Zod input schema becomes the tool's JSON Schema input via
`zod-to-json-schema`. Empty schemas (`z.object({})`) emit
`{ "type": "object", "additionalProperties": false }`.

## Authentication

The adapter calls the existing `host.resolvePrincipal` per request — no
new auth machinery. A flow that needs MCP auth implements it in
`authentication.resolvePrincipal`:

```ts
defineFlow({
  kind: "billing",
  authentication: {
    resolvePrincipal: async (ctx) => {
      if (ctx.source !== "mcp") return defaultBodyUserIdResolver(ctx);
      const token = extractBearerToken(ctx.request?.headers.get("authorization"));
      if (!token) return null;
      const grant = await credentialGrants.find({ token });
      return grant === null ? null : { userId: grant.userId };
    }
  },
  mcp: { enabled: true },
  actions: { /* ... */ }
});
```

`extractBearerToken` and `createHs256JwtVerifier` are exported from
`@flow-state-dev/server`. Per the MCP spec, tokens MUST NOT be passed
in query strings — use the `Authorization` header.

When `resolvePrincipal` throws `PrincipalResolutionError`, the adapter
returns HTTP 401 with `WWW-Authenticate: Bearer realm="MCP"` and a
JSON-RPC error body with code `-32001`.

## v1 limitations

- **Stateless only.** No `Mcp-Session-Id` is issued; every `tools/call`
  runs in a fresh flow session under `host.dispatch`. The framework's
  `RequestRecord` and item log still record the call. Stateful mode is
  deferred until a real consumer asks for it.
- **Single JSON tool result.** No `notifications/progress`, no
  `outputSchema`/`structuredContent`, no SSE response stream. Tool
  results are text content only — either the action's terminal output
  (`JSON.stringify`'d if non-string) or the most recent `message` item
  from the stream.
- **`resources/list` returns the empty list.** The framework's resource
  model has no flow-bound scope yet (resources are session-, user-, or
  org-scoped, all of which require a sessionId — which stateless MCP
  doesn't carry). The hook is wired through and will surface entries
  once the model grows a flow scope.
- **`resources/subscribe`** returns `-32601` and the server advertises
  `capabilities.resources.subscribe: false` on `initialize`.
- **No bundled OAuth.** Hosts own credential storage and verification.

## Origin enforcement

The adapter defaults to **same-origin only** for browser-originated
requests: any `Origin` header that doesn't match the request URL's
origin is rejected with 403. Override via:

```ts
createMcpTransportAdapter({
  allowedOrigins: ["https://app.example.com"]
})
```

Or `allowedOrigins: "*"` for local development. Non-browser clients
(Claude Desktop, Cursor, custom code) typically don't send `Origin`
and are not affected.

## JSON-RPC method coverage

| Method | Behavior |
| --- | --- |
| `initialize` | Returns capabilities + `serverInfo: { name: kind, version: "1.0.0" }`. |
| `notifications/initialized` | 202 Accepted, no body. |
| `ping` | Empty result. |
| `tools/list` | Exposed actions as MCP tools. |
| `tools/call` | Runs the action via `host.dispatch`; returns text content. |
| `resources/list` | Returns the empty list in v1. |
| `resources/read` | Currently rejects with `-32002`; reserved for the flow-scope landing. |
| `resources/subscribe` / `unsubscribe` | `-32601` (not supported in v1). |
| Anything else | `-32601`. |

## Implementation notes

- The adapter does not depend on `@modelcontextprotocol/sdk`. The SDK's
  `StreamableHTTPServerTransport` requires a Node `IncomingMessage`/
  `ServerResponse` shim around WHATWG `Request`/`Response`; for v1's
  six methods and stateless single-response shape, hand-rolled
  JSON-RPC dispatch is fewer lines than the shim. Revisit once the SDK
  ships a WHATWG-native transport or stateful mode lands.
- The adapter consumes `unstable_findResourceConfig`,
  `unstable_getPersistedData`, `unstable_renderContent`, and
  `unstable_listExposedResources` from `@flow-state-dev/server` so the
  resource lookup logic stays single-sourced with the HTTP route
  handlers.

## Related

- [Inbound Transports](./inbound-transports.md) — the `InboundTransportAdapter` contract.
- [Authentication](./authentication.md) — `resolvePrincipal` hook used at the adapter boundary.
- [`@flow-state-dev/mcp` README](../../packages/mcp/README.md) — install, usage, and per-action examples.

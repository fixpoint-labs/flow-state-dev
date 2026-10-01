# MCP Server Adapter

`@flow-state-dev/mcp` exposes a flow as an MCP server over Streamable HTTP, as an `InboundTransportAdapter` with `source: "mcp"`. Opt-in config, mounting, auth and the method table are user-facing: [MCP Server](../../apps/docs/docs/server/mcp.md), [package README](../../packages/mcp/README.md). This page holds the contracts.

## Routes

- **One server per flow** (how MCP clients are configured). Shared mode (default): `POST /api/flows/:kind/mcp`. `dedicatedBasePath: true`: `<basePath>/:kind` with implicit base `/mcp`. An explicit `basePath` wins either way. GET/DELETE → 405.
- **One layout per adapter instance**, no alias or redirect. Dedicated mode rejects an empty or root base because `/:kind` would capture unrelated single-segment routes ahead of the HTTP adapter.
- Non-HTTP adapter routes get first-match priority in the router. Registration happens inside `createFlowApiRouter`, but **the outer host must also forward that prefix** to the router: a host mounted only at `/api/flows/*` rejects `/mcp/*` before the matcher runs. Host mount discovery is outside the adapter's contract.

## Tools

- Tool name = `decamelize(actionKey)` with no flow prefix (the flow is the server), or `mcp.name`. **Two actions resolving to one name throw at registration**, because MCP clients cache by tool name and a runtime collision silently breaks calls.
- `description` is required on every exposed action (`defineFlow` throws without it); it is the LLM-facing tool description.
- `z.object({})` emits `{ type: "object", additionalProperties: false }`.

## Sessions (security)

No `Mcp-Session-Id` is issued. By default every `tools/call` runs in a fresh ephemeral flow session. `ActionMcpConfig.session` opts in: a string template mints an id (first `*` → random token, else appended); `{ fromInput: field }` reads a caller-supplied id (`deriveSessionId`). It is a **flow** session key, not a protocol session, and the principal still comes from `resolvePrincipal`. **`fromInput` is caller-controlled, so it is safe only under a single server-trusted principal** until caller-supplied keys are namespaced by principal (open follow-up).

## Auth and origin

- Auth is `host.resolvePrincipal`; a flow branches on `ctx.source === "mcp"`. Tokens must come from the `Authorization` header, never the query string (MCP spec). `PrincipalResolutionError` → 401 with `WWW-Authenticate: Bearer realm="MCP"` and JSON-RPC `-32001`.
- **Same-origin by default**: a browser `Origin` not matching the request URL → 403. `allowedOrigins` overrides (`"*"` for local dev). Non-browser clients send no `Origin`.

## v1 limits

Single JSON text result (terminal output, stringified, or the last `message` item); no progress notifications, `outputSchema`, `structuredContent` or SSE response. `resources/list` is empty and `resources/read` rejects `-32002` because resources have no flow scope yet; `resources/subscribe` is `-32601` and advertised `false`. No bundled OAuth.

The adapter hand-rolls JSON-RPC rather than using `@modelcontextprotocol/sdk`, whose `StreamableHTTPServerTransport` needs a Node `IncomingMessage` shim around WHATWG `Request`; revisit if the SDK ships a WHATWG transport or stateful mode lands. Resource lookups reuse the engine's `unstable_*` resource helpers so they stay single-sourced with the HTTP routes.

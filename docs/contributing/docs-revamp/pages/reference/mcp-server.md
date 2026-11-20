---
title: MCP server
type: reference
description: "The MCP adapter's settings, which actions become tools and how they are named, how a caller is identified, how calls group into a session, the result and error shapes, and what the adapter does not do."
---

# MCP server

MCP, the Model Context Protocol, is how a client such as Claude Desktop or Cursor finds and calls tools that live outside it. The adapter in `@flow-state-dev/mcp` serves a flow's actions as those tools. A flow is a self-contained part of your app with its own actions, and an action is a function a caller can invoke on it. The client lists the flow's actions as tools, and a tool call runs the action as an HTTP request would, as the user and organization your resolver names.

MCP adds no new kind of operation. An action is reachable over MCP only when HTTP callers can reach it and the flow opts in. One flow is one MCP server.

The tables below use one app, a support desk. Its `support` flow has two actions. `lookUpOrder` is a tool the model should call. `exportTickets` writes a CSV to the server's disk, so it is opted out. To build this setup step by step, see [Expose a flow as an MCP server](../build/mcp-server.md).

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { createMcpTransportAdapter } from "@flow-state-dev/mcp";
import { supportFlow } from "./src/flows/support/flow";

export default createFlowState({
  flows: [supportFlow()],
  adapters: [createMcpTransportAdapter({ allowedOrigins: ["https://app.example.com"] })],
});
```

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { createBearerSecretPrincipalResolver } from "@flow-state-dev/engine";
import { z } from "zod";
import { exportTickets } from "./blocks/export-tickets";
import { lookUpOrder } from "./blocks/look-up-order";

export const supportFlow = defineFlow({
  kind: "support",
  mcp: { enabled: true },
  authentication: {
    resolvePrincipal: createBearerSecretPrincipalResolver({
      secret: process.env.SUPPORT_MCP_SECRET ?? "",
      principal: { userId: "support-agent", orgId: "acme" },
    }),
  },
  actions: {
    lookUpOrder: {
      block: lookUpOrder,
      inputSchema: z.object({ orderId: z.string().max(64) }),
      description: "Look up one order by id. Returns its status and total. Read-only.",
      mcp: { name: "find_order", session: { fromInput: "orderId" } },
    },
    exportTickets: {
      block: exportTickets,
      description: "Write every open ticket to a CSV file.",
      mcp: { enabled: false },
    },
  },
});
```

`lookUpOrder` and `exportTickets` are blocks, the unit of work an action runs, each in its own file beside the flow.

```ts title="src/flows/support/blocks/look-up-order.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const lookUpOrder = handler({
  name: "look-up-order",
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.object({ status: z.string(), totalCents: z.number() }),
  execute: async ({ orderId }) => ({ status: `shipped (${orderId})`, totalCents: 4200 }), // your code queries your orders
});
```

```ts title="src/flows/support/blocks/export-tickets.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const exportTickets = handler({
  name: "export-tickets",
  inputSchema: z.object({}),
  outputSchema: z.object({ path: z.string() }),
  execute: async () => ({ path: "/tmp/open-tickets.csv" }), // your code writes the CSV
});
```

## The adapter

```typescript
createMcpTransportAdapter(options?: CreateMcpTransportAdapterOptions): InboundTransportAdapter
```

The adapter's `source` is `"mcp"`. Pass it in the `adapters` array of `createFlowState` or `createFlowApiRouter`. It is a JSON-RPC 2.0 handler over HTTP `POST`, and it keeps no state of its own between requests. Every option is optional.

| Option | Type | Default | Behaviour |
| --- | --- | --- | --- |
| `basePath` | `string` | `"/api/flows"`, or `"/mcp"` when `dedicatedBasePath` is `true` | The route prefix. A trailing slash is removed |
| `dedicatedBasePath` | `boolean` | `false` | Off, the endpoint is `POST <basePath>/:kind/mcp`. On, it is `POST <basePath>/:kind` |
| `allowedOrigins` | `string[] \| "*"` | unset | Which browser origins may call. See [the origin check](#the-origin-check) |
| `forwardQueryParams` | `string[]` | unset | Query-string parameters copied into a tool call's input. See [forwarded query parameters](#forwarded-query-parameters) |

The package also exports `MCP_TRANSPORT_SOURCE` (`"mcp"`), `toolNameFromActionKey`, `resolveExposedActions`, `actionToMcpTool`, `toolResultFromExecution`, `toolInputJsonSchema` and the types `CreateMcpTransportAdapterOptions`, `McpTool` and `McpToolResult`.

### Endpoint

One adapter mounts one layout. Each endpoint answers `POST`; `GET` and `DELETE` return `405` with `Allow: POST`.

| Options | Endpoint for the `support` flow |
| --- | --- |
| none | `POST /api/flows/support/mcp` |
| `{ dedicatedBasePath: true }` | `POST /mcp/support` |
| `{ dedicatedBasePath: true, basePath: "/integrations/mcp" }` | `POST /integrations/mcp/support` |
| `{ basePath: "/custom" }` | `POST /custom/support/mcp` |

In the dedicated layouts the default `/api/flows/support/mcp` URL is not served. The HTTP action routes stay under `/api/flows`. A dedicated base made only of slashes (`""`, `"/"`) throws a `TypeError` when the adapter is created.

Point the client at the full URL, for example `http://localhost:3000/api/flows/support/mcp`.

### Hosting

| Host | What to mount |
| --- | --- |
| `fsdev serve`, and `serve()` from `@flow-state-dev/node` | Nothing. A request that matches no static file and no `basePath` route is offered to the dedicated MCP routes |
| Next.js, default layout | Nothing. The handler at `app/api/flows/[...path]/route.ts` already receives `/api/flows/:kind/mcp` |
| Next.js, dedicated layout | A second route file, `app/mcp/[...path]/route.ts`, exporting the same handlers |

## Flow and action settings

These go on `defineFlow`, not on the adapter.

| Setting | On | Default | Behaviour |
| --- | --- | --- | --- |
| `mcp.enabled` | flow | `false` | Opts the flow in. A request for a flow without it gets `-32601` `Flow "<kind>" is not exposed via MCP.` |
| `mcp.exposeResources` | flow | `true` | Has no effect. `resources/list` is always empty ([Resources](#resources)) |
| `actions.<key>.mcp.enabled` | action | `true` | `false` removes the action from the tool list |
| `actions.<key>.mcp.name` | action | derived from the key | Overrides the tool name. A non-empty string, from the same character set as a derived name |
| `actions.<key>.mcp.session` | action | unset | Groups calls into a session. See [Sessions](#sessions) |
| `actions.<key>.description` | action | the block's `description` | Becomes the tool's description |

## Which actions are exposed by default

With `mcp: { enabled: true }` on the flow, every entry of `flow.actions` is a tool, except entries with `mcp: { enabled: false }`. A flow without `mcp.enabled` exposes nothing.

In the support desk, `find_order` is listed and `exportTickets` is not. Calling an unlisted or opted-out tool by name returns `-32601` `Unknown MCP tool "<name>".`

`flow.actions` holds only the actions callers can reach. A flow's `internal.actions`, `task.actions`, webhook bindings and schedule bindings are never exposed.

Every exposed action needs a non-empty `description`: its own, else its block's. Whitespace does not count. If an exposed action has neither, `defineFlow` throws when the flow is registered, naming the flow, the action and the block. The description is what the model reads to decide whether to call the tool, so say what the tool does, when to use it over its siblings, what it changes, and what each argument means.

## How actions map to tools

Tool names carry no flow prefix, because each flow is its own server. The name is the action key in snake case.

| Action key | Tool name |
| --- | --- |
| `recordPayment` | `record_payment` |
| `URLParser` | `url_parser` |
| `getHTTPSProxy` | `get_https_proxy` |
| `IOError` | `io_error` |
| `event_queue` | `event_queue` |
| `event-queue` | `event-queue` |

Hyphens and underscores in the key are kept. A name, derived or set with `mcp.name`, must match `[A-Za-z0-9_.-]` and be 1 to 128 characters long. Two exposed actions that resolve to the same name are an error, and so is a name outside the character set. Both are thrown when a request first reaches the adapter, not when the flow is registered. For a collision, the first `tools/list` or `tools/call` fails with `Flow "<kind>" exposes actions "<a>" and "<b>" which both resolve to the MCP tool name "<name>".`

`tools/list` returns one `{ name, description, inputSchema }` per exposed action, in the order the actions are declared. `inputSchema` is the action's `inputSchema`, else its block's, converted to a JSON Schema object with no `$ref`s. A schema that is not an object, or an object with no properties, becomes `{ "type": "object", "properties": {}, "additionalProperties": false }`.

## Caller identity

An MCP call runs as the principal your resolver returns: a user and an organization. The adapter calls `resolvePrincipal` once per request, the flow's own `authentication.resolvePrincipal` first, else the one given to the router. The adapter reads no credential itself and takes none from the query string. Send credentials in the `Authorization` header and read them in the resolver. The resolver's contract is in [Authentication and tenancy](./authentication.md).

| Resolver context field | Value for an MCP request |
| --- | --- |
| `source` | `"mcp"` |
| `request` | The raw `Request` |
| `envelope.flowKind` | The flow's kind |
| `envelope.action` | For `tools/call`, the tool's name (not the action key). `"(metadata)"` for every other method |
| `envelope.input` | The JSON-RPC `params` |
| `envelope.metadata` | `{ mcpMethod }`, the JSON-RPC method name |

When resolution fails, the response has the error's own HTTP status (`401` by default), the JSON-RPC code `-32001` and the error's message. A `401` carries `WWW-Authenticate: Bearer realm="MCP"`. A flow with no resolver and no `defaultUserId` answers `tools/list` with `401` and `Action request requires non-empty userId`. A resolver that returns no usable organization id, or the reserved development one (`__fsd_default_org__`), is also refused with `401` and `-32001`, but with the message `Request requires a verified organization: authentication.resolvePrincipal returned no usable orgId. Return a nonempty, well-formed orgId from the resolver.` (the reserved-id case has its own message). The `userId` message is only for a missing user.

With no resolver configured anywhere, the framework default reads `userId` from the JSON-RPC `params`, so a caller can name any user. Configure `authentication.resolvePrincipal` on every flow served over a network. Which hosts refuse the default is in [The bind guard](./authentication.md#the-bind-guard), and the helpers for writing a resolver are in [Built-in resolver helpers](./authentication.md#built-in-resolver-helpers).

### What a request needs, in order

A POST is checked in this order, which decides what an unauthenticated caller can reach.

1. The origin check (`403`).
2. JSON parsing (`-32700`) and the request envelope (`-32600`).
3. `notifications/initialized` (`202`, no body), `ping` (`{}`) and `initialize` are answered here, before the flow is looked up and before authentication.
4. The flow lookup (`-32601` when the flow is absent or has not opted in).
5. Principal resolution (`-32001`).
6. The method: `tools/list`, `tools/call`, `resources/list` or `resources/read`. Any other method gets `-32601`. Because authentication has run, an unauthenticated caller gets `-32001` for an unknown method.

## The origin check

| `allowedOrigins` | A request whose `Origin` header is |
| --- | --- |
| unset | refused with `403 Origin not allowed` unless it matches the request URL's origin |
| `["https://app.example.com"]` | allowed when it equals a listed string, or the request URL's own origin |
| `"*"` | always allowed. Use it for local development only |

A request with no `Origin` header always passes. Non-browser clients, such as Claude Desktop and Cursor, send none. The check protects against a web page calling the endpoint from a browser. It is not a credential check.

## Forwarded query parameters

`forwardQueryParams: ["source"]` copies `?source=claude-desktop` from the endpoint URL into each `tools/call` input as `source: "claude-desktop"`.

- Only listed parameters are copied, and only into `tools/call`. `initialize`, `tools/list`, `resources/*` and authentication do not see them.
- The query value replaces a same-named argument the model sent.
- A repeated parameter keeps its first value. An absent one is skipped. `?source=` forwards `""`.
- The action's input schema must accept the key. Otherwise input validation strips or rejects it, as for any other key.
- If `arguments` is omitted or `null`, the call receives the forwarded parameters alone. If `arguments` is not an object, it is passed through unchanged and nothing is added.
- The value sits in the URL, so it is not for credentials. Use it for a tag such as the client's name.

## Sessions

A session is where a flow keeps related requests together as one record. By default an MCP call has none to join. Every `tools/call` starts a fresh session, and the adapter never issues an `Mcp-Session-Id`. The session an action uses is a flow session. It selects which session state and item history a call sees. It is not the protocol's `Mcp-Session-Id` and it decides nothing about who the caller is.

`actions.<key>.mcp.session` changes that for one action.

| Form | Session id | Example |
| --- | --- | --- |
| a template string | A new id for each call. The first `*` is replaced by a random token, a later `*` stays literal, and with no `*` the token is appended | `"conv_*"` gives an id like `conv_1784…_a1b2` |
| `{ fromInput: "<field>" }` | The string value of that top-level field of the call's input, after forwarded parameters are merged. Calls with the same value share one session | `{ fromInput: "orderId" }` puts every call about `order_1042` in one session |

With `fromInput`, a missing field, an empty string or a value that is not a string falls back to a fresh session, with no error. With a template string, the adapter does not return the new id to the client. The action's block has to return it.

When ids come from the caller:

- **Namespace the id for users who do not trust each other.** The id is a bare key. If Alice and Bob each send `order_1042`, the second to arrive is refused with `-32602` `Unknown session "order_1042"` rather than given a fresh session. Prefix the id with something that names the principal.
- **Expect sessions from invalid calls.** The session is created before the action's input schema runs, and the adapter puts no limit on the id's length. A call the schema rejects, including one with an over-long `orderId` leaves its session behind. A bound such as `z.string().max(64)` on `orderId` rejects the call, not the session.

### Stored parts

An MCP call writes a session record and a request record. Both belong to the resolved user and organization and live in the stores described in [Stores](./stores.md#what-each-stored-part-is).

- **Sessions:** one per `tools/call` by default, one per distinct id with `fromInput`, one per call with a template string. Another user or organization naming the id is refused.
- **Requests:** one per `tools/call`, with `source` `"mcp"`, labelled "MCP" in the DevTool request list. `tools/list`, `initialize` and the other methods write none.

## Results

A successful `tools/call` returns one content block:

```json
{ "content": [{ "type": "text", "text": "{\"status\":\"shipped\",\"totalCents\":4200}" }] }
```

`text` is the string itself when the action's output is a string, and JSON otherwise. When the action produced no output, it is taken from the action's items, newest first: the text of a `message` item, or the output of a block trace (the record of one block run, described in [Items](./items.md)). With neither, it is an empty string. There is no `structuredContent`, no `outputSchema`, no progress notification and no streamed response.

A failed run returns HTTP `200`, `isError: true` and the error's message as the text. A bad argument is one of these, not a JSON-RPC error:

```json
{ "content": [{ "type": "text", "text": "Action input validation failed at \"orderId\": Required" }], "isError": true }
```

### Errors

The error body is `{ "jsonrpc": "2.0", "id": <id>, "error": { "code", "message" } }`, with HTTP `200` unless the table says otherwise.

| Code | When |
| --- | --- |
| `-32700` | The body is not valid JSON |
| `-32600` | The body is not an object, `jsonrpc` is not `"2.0"`, or `method` is not a string |
| `-32601` | The flow is not exposed. The tool is unknown or opted out. The method is not supported, including `resources/subscribe` and `resources/unsubscribe` |
| `-32602` | `tools/call` has no `params` or no string `name`. `resources/read` has no `params`, or a `uri` that is missing or not a non-empty string. A session belongs to another user or organization. A dispatch failure that is not a busy case, with its message passed through |
| `-32000` | The server is busy: a concurrency limit rejected the call, or a queued call waited past its budget. `error.data` is `{ "retryable": true }` |
| `-32001` | Principal resolution failed. The HTTP status is the error's own, `401` by default |
| `-32002` | `resources/read` refused |

Other statuses: `403` for a refused origin, `405` for `GET` and `DELETE`, `202` with an empty body for `notifications/initialized`.

### Protocol methods

`initialize` supports protocol versions `2025-06-18` and `2025-03-26`. A supported requested version is echoed back, an unsupported one gets `2025-06-18`, and none gets `2025-03-26`. The result's `capabilities` are `tools: { listChanged: false }` and `resources: { listChanged: false, subscribe: false }`, and `serverInfo` is `{ name: <flow kind>, version: "1.0.0" }`. `ping` returns `{}`.

### Resources

`resources/list` always returns `{ "resources": [] }`, whatever `mcp.exposeResources` says. `resources/read` returns `-32602` when `params` is missing or `uri` is missing or not a non-empty string. Any other `uri` returns `-32002`, with a message that depends on the case: `Resource URI "<uri>" is not exposed at this endpoint.` for a string that is not a `flow://<kind>/resources/<ref>` URI of this flow, `Unknown resource "<ref>".`, `Collection resources are not exposed via MCP in v1.`, `Resource "<ref>" is not exposed (client.content.read is not true).`, and `No flow-bound resource is currently readable in stateless MCP v1.` for any other readable-looking resource.

## What it does not do

- Calls share no state unless the action sets `mcp.session`.
- It returns one JSON text result per call. It sends no progress notifications, no `outputSchema`, no `structuredContent` and no server-initiated messages.
- It implements `initialize`, `ping`, `notifications/initialized`, `tools/list`, `tools/call`, `resources/list` and `resources/read`. Prompts, completion, logging, sampling, roots and resource subscriptions are not implemented, and answer `-32601`.
- It ships no OAuth. Authentication is whatever your resolver does.
- It cannot expose a flow that has not opted in, or an action that is not one callers can reach over HTTP.

## Next

- [Expose a flow as an MCP server](../build/mcp-server.md) builds the support desk setup above, step by step.
- [Authentication and tenancy](./authentication.md) has the resolver contract and the checks on a session id.
- [HTTP API](./http-api.md) lists the routes the same actions have over HTTP.
- [Serving flows](../concepts/serving-flows.md) covers the other ways a flow is reached.

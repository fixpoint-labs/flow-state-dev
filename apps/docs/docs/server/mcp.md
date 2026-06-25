---
sidebar_position: 6
---

# MCP Server

`@flow-state-dev/mcp` exposes any flow as a Model Context Protocol
server. With one config flag on the flow and one line in the router
setup, an MCP client like Claude Desktop or Cursor can connect to your
flow, list its actions as tools, and call them — running through the
same runtime that powers your web UI.

MCP — Model Context Protocol — is the spec MCP clients use to talk to
external tool servers. Claude Desktop, Cursor, and an increasing number
of agentic IDEs speak it. The transport is HTTP-based (Streamable HTTP),
which is why the adapter mounts onto the same router as the HTTP
transport.

## Install

```bash
pnpm add @flow-state-dev/mcp
```

## Mounting the adapter

The MCP adapter is just another entry in `adapters` on
[`createFlowState`](./setup.md), the canonical setup entrypoint:

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMcpTransportAdapter } from "@flow-state-dev/mcp";

export const flowstate = createFlowState({
  flows: { billing: billingFlow },
  stores: { default: { primary: inMemoryStores() } },
  adapters: [createMcpTransportAdapter()],
});
```

Turn the handle into route handlers with a platform handler — the MCP
webhooks mount under the same router:

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);
```

The MCP adapter mounts at `POST /api/flows/:kind/mcp`. `GET` and
`DELETE` on that path return 405. Existing HTTP routes are unchanged.

## Opting a flow into MCP

A flow opts in via `mcp.enabled`. Every action you want exposed needs a
`description` — that text becomes the LLM-facing tool description and
is what the model reads when it decides whether to call the tool. The
framework refuses to register the flow if any exposed action is missing
one.

```ts
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

defineFlow({
  kind: "billing",
  mcp: { enabled: true },
  authentication: {
    resolvePrincipal: async (ctx) => {
      // Verify whatever credential the MCP client sent and return the
      // user it binds to.
      const token = ctx.request?.headers.get("authorization")?.slice(7);
      if (!token) return null;
      return { userId: await lookupUser(token) };
    }
  },
  actions: {
    recordPayment: {
      inputSchema: z.object({
        invoiceId: z.string(),
        amount: z.number().describe("USD cents")
      }),
      block: handler({
        name: "record-payment",
        execute: ({ invoiceId, amount }) => {
          /* ... */
          return { ok: true };
        }
      }),
      description:
        "Record a customer payment against an open invoice. Use when " +
        "a payment has cleared and the ledger needs updating. " +
        "`amount` is USD cents."
    },
    privateInternal: {
      inputSchema: z.object({}),
      block: somePrivateBlock,
      mcp: { enabled: false } // not exposed to MCP
    }
  }
});
```

Connect Claude Desktop to:

```
http://localhost:3000/api/flows/billing/mcp
```

`tools/list` returns one tool — `record_payment`. Calling it runs the
action and stamps `RequestRecord.source = "mcp"`, which surfaces in the
DevTool with a purple MCP badge so you can tell the request apart from
a chat-UI call.

## Tool names

Action keys are converted to MCP tool names with a deterministic
`decamelize`:

| Action key | Tool name |
| --- | --- |
| `recordPayment` | `record_payment` |
| `URLParser` | `url_parser` |
| `getHTTPSProxy` | `get_https_proxy` |
| `event-queue` | `event-queue` |

If two actions resolve to the same tool name, the framework throws at
flow registration. (MCP clients cache their tool list by name, so a
runtime collision would silently break tool calls.)

To override the auto-derived name on a single action:

```ts
recordPayment: {
  inputSchema,
  block,
  description: "...",
  mcp: { name: "log-payment" }
}
```

The override goes through the same collision check.

## Writing good tool descriptions

The `description` is what the LLM reads when it decides whether to
call a tool. Treat it like prompt copy, not API documentation. The
fields that matter:

1. **What the tool does** in plain language.
2. **When to use it** versus its siblings.
3. **Preconditions and side effects** — does it write to a database,
   send a notification, fail if the resource is in some state?
4. **What each argument means**, including units, format, and
   constraints. Zod's `.describe()` on individual fields is helpful
   here — it shows up on the JSON Schema attached to the tool.

A description like `"Record a payment"` is useless. A description that
tells the model when this tool is the right one and what `amount: 4200`
actually means earns the call.

## Authentication

MCP requests go through the same `authentication.resolvePrincipal` hook
as HTTP requests. The hook receives `ctx.source === "mcp"` and the raw
`Request` so it can read the `Authorization` header or whatever
credential the MCP client sent.

```ts
authentication: {
  resolvePrincipal: async (ctx) => {
    if (ctx.source === "mcp") {
      const token = extractBearerToken(ctx.request?.headers.get("authorization"));
      if (!token) return null;
      const grant = await credentialGrants.find({ token });
      return grant === null ? null : { userId: grant.userId };
    }
    // HTTP and other transports go through your usual session resolver.
    return defaultBodyUserIdResolver(ctx);
  }
}
```

Per the MCP spec, tokens must be in the `Authorization` header — the
adapter does not honor query-string credentials.

If `resolvePrincipal` returns `null` and the flow requires a user, the
adapter responds with HTTP 401 and `WWW-Authenticate: Bearer realm="MCP"`,
plus a JSON-RPC error with code `-32001`. Throwing
`PrincipalResolutionError` produces the same shape and lets you set the
status explicitly.

See [Authentication](./authentication) for the full hook contract.

## Per-user endpoints

A common host pattern is per-user MCP endpoints: each user installs a
URL with their own token in their Claude Desktop config, and the host's
credential-grants table maps the token back to a `userId`. The
framework does not run this for you — that table is in your database —
but `extractBearerToken` and `createHs256JwtVerifier` from
`@flow-state-dev/engine` are usable inside `resolvePrincipal` to keep
the verification short.

## Origin enforcement

Browser-originated requests are rejected with 403 unless the `Origin`
header matches the request URL's origin. Override via:

```ts
createMcpTransportAdapter({
  allowedOrigins: ["https://app.example.com"]
});
```

Or `allowedOrigins: "*"` for local development. Claude Desktop, Cursor,
and most non-browser MCP clients don't send `Origin` and aren't
affected.

## v1 limitations

The current release covers the critical path for production use, with a
few intentional cuts:

- **Stateless only.** Every `tools/call` runs in a fresh flow session.
  No `Mcp-Session-Id` is issued, no per-session continuity across
  calls. This is the right default for serverless deployments and most
  agentic use cases. Stateful sessions land later.
- **Single text tool result.** Tool calls return one text content
  block — either the action's terminal output (JSON-stringified if
  non-string) or the most recent message item from the action's
  stream. No `notifications/progress`, no `outputSchema` /
  `structuredContent`.
- **`resources/list` is empty.** The framework's resource model has
  no flow-bound scope yet, so MCP `resources/list` returns the empty
  list and `resources/read` rejects with `-32002`. The hook is wired
  through and will surface entries once a flow scope lands.
- **No bundled OAuth.** Authentication is whatever your
  `resolvePrincipal` returns.

## Watching MCP requests in the DevTool

MCP-originated requests render with a purple `MCP` badge in the
request list. Open one and the trace, items, and state look identical
to an HTTP request — same panels, same observability, same replay
controls. The transport is the only difference.

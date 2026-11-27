---
title: Expose a flow as an MCP server
type: recipe
description: "Let Claude Desktop, Cursor or any other MCP client list a flow's actions as tools and call them."
---

# Expose a flow as an MCP server

MCP, the Model Context Protocol, is how clients such as Claude Desktop and Cursor use tools that live outside them. A flow can be one of those tools. The client lists the flow's actions as tools, and each call runs the action exactly as an HTTP request would.

This recipe exposes the `support` flow with one tool, `look_up_order`, behind a secret token. Each flow is its own MCP server, and the flow chooses to be one.

## 1. Install the adapter

```bash
pnpm add @flow-state-dev/mcp
```

## 2. Mount it

The MCP adapter goes in the `adapters` list of [`createFlowState`](../concepts/serving-flows.md).

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { createMcpTransportAdapter } from "@flow-state-dev/mcp";
import support from "./src/flows/support/flow";

export default createFlowState({
  flows: [support],
  adapters: [createMcpTransportAdapter()],
});
```

The endpoint is `POST /api/flows/support/mcp`, under the same prefix as the rest of the flow API. If your app already serves flows, as in [Add to an existing app](../start/add-to-an-existing-app.md), or runs under `fsdev serve`, nothing else needs mounting. [MCP server](../reference/mcp-server.md) lists the adapter's settings, including a separate URL prefix for MCP.

## 3. Opt the flow in and pick its tools

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
    requireUser: true,
    resolvePrincipal: createBearerSecretPrincipalResolver({
      secret: process.env.SUPPORT_MCP_SECRET ?? "",
      principal: { userId: "support-agent", orgId: "acme" },
    }),
  },
  actions: {
    lookUpOrder: {
      block: lookUpOrder,
      inputSchema: z.object({
        orderId: z.string().describe("Order id, such as order_1042"),
      }),
      description:
        "Look up one order by id. Returns its status and total in USD cents. " +
        "Read-only. Use it before answering a customer about an order.",
    },
    exportTickets: {
      block: exportTickets,
      description: "Write every open ticket to a CSV file.",
      mcp: { enabled: false },
    },
  },
});

export default supportFlow();
```

`lookUpOrder` and `exportTickets` are blocks, each in its own file beside the flow. Both return fixed data here, where yours would query your own systems:

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

A flow without `mcp: { enabled: true }` answers every tool request with a `-32601` error. With it, every action in `actions` is a tool unless it sets `mcp: { enabled: false }`, as `exportTickets` does. A client that calls an opted-out action by name gets the same `-32601`.

Action keys become snake_case tool names, so `lookUpOrder` is `look_up_order`. To choose another name, set `mcp: { name: "find-order" }` on the action. If two actions resolve to one name, the first `tools/list` or `tools/call` fails with an error naming both.

Every exposed action needs a `description`, its own or its block's. The flow refuses to register and names the action when neither exists. The model reads this text to decide whether to call the tool, so write it like a prompt: what the tool does, when to use it, what it changes, and what each argument means. `.describe()` on a Zod field carries into the tool's input schema.

## 4. Connect a client

Point the client at your server's URL, `https://app.example.com/api/flows/support/mcp`, and give it the token as an `Authorization: Bearer` header. To check it before you configure a client:

```bash
curl -X POST https://app.example.com/api/flows/support/mcp \
  -H "Authorization: Bearer $SUPPORT_MCP_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The result lists one tool, `look_up_order`, with its description and input schema. A `tools/call` for it returns one text block holding the action's output. A failed run returns the error message with `isError: true`.

By default each call is a new session, so calls do not share state. [MCP server](../reference/mcp-server.md) shows how to group calls into one session. The request appears in the DevTool with an MCP badge, next to requests from your own UI.

## 5. Decide who the caller is

An MCP request goes through the flow's `resolvePrincipal`, the same hook HTTP requests use. It receives the raw `Request` and `ctx.source === "mcp"`, and it returns the user and organization the call runs as. Send credentials in the `Authorization` header. The adapter does not read tokens from the URL.

`createBearerSecretPrincipalResolver` accepts one secret and maps it to one fixed user, which suits a server for a single person or team. It throws when the secret is empty, so a missing environment variable stops startup instead of leaving the endpoint open. A request with no `Authorization` header, or a wrong token, gets HTTP 401 and a JSON-RPC `-32001` error.

For a different user per client, write your own resolver. Read the token, look up its owner, and return `{ userId, orgId }`. Both are required, and a resolver that returns no organization gets the same 401. `extractBearerToken` and `createHs256JwtVerifier` from `@flow-state-dev/engine` shorten the verification. To refuse a caller, throw `PrincipalResolutionError`: the client gets a JSON-RPC `-32001` error and a 401 by default. The [authentication reference](../reference/authentication.md) has the resolver contract.

## Next

- [MCP server](../reference/mcp-server.md) lists the adapter's settings, how actions map to tool names, the error codes, grouping calls into one session, and what the adapter does not do.
- [Auth and tenancy](../concepts/auth-and-tenancy.md) covers users, organizations and how a session stays inside them.
- [Serving flows](../concepts/serving-flows.md) covers the other ways a flow is reached.

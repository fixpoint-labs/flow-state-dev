# @flow-state-dev/mcp

MCP (Model Context Protocol) transport adapter for the Flow State Dev runtime.
Exposes any flow with `mcp.enabled: true` as its own MCP server over Streamable
HTTP at `POST /api/flows/:kind/mcp`. Flow actions become MCP tools.

## Install

```bash
pnpm add @flow-state-dev/mcp
```

## Usage

```ts
import { createFlowApiRouter } from "@flow-state-dev/engine";
import { createMcpTransportAdapter } from "@flow-state-dev/mcp";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const billing = defineFlow({
  kind: "billing",
  mcp: { enabled: true },
  authentication: {
    resolvePrincipal: async (ctx) => {
      // Verify a bearer token, return the bound user.
      const token = ctx.request?.headers.get("authorization")?.slice("Bearer ".length);
      if (!token) return null;
      return { userId: await lookupUserIdForToken(token) };
    }
  },
  actions: {
    recordPayment: {
      inputSchema: z.object({ amount: z.number(), invoiceId: z.string() }),
      block: handler({ name: "record-payment", execute: ({ amount, invoiceId }) => {
        // ...
        return { ok: true };
      }}),
      description:
        "Record a customer payment against an open invoice. Use when a payment " +
        "has cleared and you need to update the ledger. `amount` is in USD cents."
    }
  }
});

const router = createFlowApiRouter({
  registry: myRegistry,
  stores: myStores,
  adapters: [createMcpTransportAdapter()]
});
```

Connect Claude Desktop, Cursor, or any MCP client to:

```
http://localhost:3000/api/flows/billing/mcp
```

The flow's actions appear as tools (`record_payment`); calling a tool runs the
action via the same `runAction` path as a normal HTTP invocation. Every
MCP-originated request is stamped with `RequestRecord.source = "mcp"`.

## v1 Limitations

- **Stateless only.** No `Mcp-Session-Id` is issued; every `tools/call` runs
  in a fresh flow session. Stateful mode is deferred until a real consumer
  asks for it.
- **Single JSON tool result.** No `notifications/progress` streaming, no
  `outputSchema` / `structuredContent`. Tool results are text content only.
- **`GET` and `DELETE`** on the endpoint return `405 Method Not Allowed`.
- **`resources/list` is empty in v1** because the framework has no flow-bound
  resource scope yet. The hook is wired through and will return entries once
  that lands.
- **No bundled OAuth.** Authentication is whatever your flow's
  `authentication.resolvePrincipal` implements (bearer tokens, HMAC, host
  session cookies — the framework provides `extractBearerToken` and
  `createHs256JwtVerifier` helpers).

## Tool name derivation

Action keys are converted to MCP tool names with `decamelize`:

| Action key | Tool name |
| --- | --- |
| `recordPayment` | `record_payment` |
| `URLParser` | `url_parser` |
| `getHTTPSProxy` | `get_https_proxy` |
| `event-queue` | `event-queue` |

Two actions resolving to the same tool name throw at flow registration.

Override the auto-derived name on a single action via `mcp.name`:

```ts
recordPayment: {
  inputSchema,
  block,
  description: "...",
  mcp: { name: "log-payment" }
}
```

## Per-action opt-out

```ts
actions: {
  publicAction: { /* exposed */ description: "..." },
  internalOnly: {
    /* not exposed to MCP, even though the flow opts in */
    mcp: { enabled: false }
  }
}
```

## Status

See the spec for design rationale and explicit non-goals.

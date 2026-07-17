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

## Dedicated endpoint prefix

The default shared layout remains `/api/flows/:kind/mcp`. To give MCP clients
a shorter, MCP-exclusive URL without moving ordinary HTTP action routes, enable
the dedicated layout:

```ts
adapters: [createMcpTransportAdapter({ dedicatedBasePath: true })]
```

The adapter then mounts the billing flow at:

```
http://localhost:3000/mcp/billing
```

Dedicated mode defaults `basePath` to `/mcp`. Set an explicit prefix such as
`basePath: "/integrations/mcp"` when needed. One adapter instance mounts one
layout, so the canonical URL is not retained as an alias after opting in. A
root-only dedicated base is rejected because `/:kind` could claim unrelated
single-segment routes.

Your HTTP host must forward the selected prefix to the Flow State router. Hosts
that only mount the router beneath `/api/flows` need a corresponding `/mcp/*`
mount (or an equivalent rewrite) before the dedicated URL is reachable.

## v1 Limitations

- **Stateless by default.** No `Mcp-Session-Id` is ever issued; every
  `tools/call` runs in a fresh flow session unless the action opts in with
  `mcp.session` (see [Deriving a session id per action](#deriving-a-session-id-per-action)).
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

## Installation-level values via query params

Sometimes a value should be fixed per client installation rather than supplied
by the model on each call — a provenance tag being the common case. Pass
`forwardQueryParams` an allowlist, and any of those params present on the
endpoint URL are merged into the `tools/call` input:

```ts
adapters: [createMcpTransportAdapter({ forwardQueryParams: ["source"] })]
```

```
# Each installation points at its own tagged URL:
http://localhost:3000/api/flows/billing/mcp?source=claude-desktop
```

The forwarded value is **authoritative** — it overrides a same-named tool
argument, since the point is a value the model should not be able to override.
Listing a param is your explicit opt-in that it becomes endpoint-controlled. A
forwarded param only lands if the action's input schema accepts it (otherwise
the normal zod boundary strips or rejects it). Only `tools/call` is affected;
`initialize` / `tools/list` / `resources/*` and auth are untouched. Defaults to
forwarding nothing.

## Deriving a session id per action

MCP is sessionless, so by default every `tools/call` mints a fresh flow
session. The per-action `mcp.session` directive lets one action derive its
dispatch session id, so a client can group related calls:

```ts
actions: {
  // Template string → a freshly minted id (`*` is replaced by a random token,
  // or appended when absent). The handler returns the id to the caller.
  createContext: { block: createContext, mcp: { session: "ctx_*" } },
  // { fromInput } → the session id is the string at input.contextId, so calls
  // sharing a contextId land in one session.
  logActivity: { block: logActivity, mcp: { session: { fromInput: "contextId" } } },
}
```

This is a **flow** session id, not the protocol `Mcp-Session-Id`. It only
selects which flow session state and history a call sees; the principal still
comes from `resolvePrincipal`, so a `fromInput` id is a grouping key, never an
auth decision. A missing/blank `fromInput` field falls back to a fresh
ephemeral session. Bound the length of any `fromInput` field that becomes a
storage key in the action's input schema.

## Status

See the spec for design rationale and explicit non-goals.

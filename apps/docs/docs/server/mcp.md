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

To serve these endpoints in production without the DevTool, `fsdev serve` stands
up the flow API and MCP routes from a committed `fsdev.config.*`. See the
[CLI API Reference](/docs/api/cli).

### Dedicated MCP prefix

Use a dedicated prefix when the shared `/api/flows/:kind/mcp` URL exposes more
of your application's internal route structure than you want MCP operators to
configure:

```ts title="lib/flowstate.ts"
export const flowstate = createFlowState({
  flows: { billing: billingFlow },
  stores: { default: { primary: inMemoryStores() } },
  adapters: [createMcpTransportAdapter({ dedicatedBasePath: true })],
});
```

Dedicated mode defaults to `/mcp`, so the endpoint becomes
`POST /mcp/billing`. You can instead pass an explicit prefix, such as
`basePath: "/integrations/mcp"`. The ordinary HTTP action routes remain under
`/api/flows`, and the adapter mounts only the dedicated layout rather than
keeping the default URL as an alias. A root-only dedicated base is rejected so
the adapter cannot claim unrelated single-segment routes.

The hosting framework must also send `/mcp/*` requests to the Flow State
handler. `serve()` from `@flow-state-dev/node` (and `fsdev serve`, which wraps
it) mount dedicated adapter paths automatically, so a self-hosted Node process
needs no extra wiring. In a Next.js app, add a matching
`app/mcp/[...path]/route.ts` route that exports the same platform handlers; a
handler mounted only at `app/api/flows/[...path]/route.ts` never receives
`/mcp/*`.

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

## Installation-level values from the URL

Sometimes a value should be fixed per installation rather than supplied
by the model on each call. The common case is a provenance tag: you want
to know which client a capture came from — Claude Desktop, a mobile app,
a shared web endpoint — without trusting the model to fill it in.

`forwardQueryParams` takes an allowlist of query-string params. When a
request URL carries one, its value is merged into the `tools/call`
input under the same key:

```ts
createMcpTransportAdapter({ forwardQueryParams: ["source"] });
```

Each installation then points at its own tagged URL:

```
https://app.example.com/api/flows/knowledge/mcp?source=claude-desktop
```

A `log_activity` tool whose input schema has a `source` field now
receives `source: "claude-desktop"` on every call from that
installation, regardless of what the model passed.

The forwarded value is **authoritative** — it overrides a same-named
argument in the tool call. That is the point: this is a value the model
should not be able to override. Listing a param name is your explicit
opt-in that it becomes endpoint-controlled. A forwarded param only lands
if the target action's input schema accepts it; otherwise the normal
validation boundary strips or rejects it, exactly like any other input
key. Only `tools/call` is affected, and the default is to forward
nothing.

This is **not** an authentication mechanism. Credentials belong in the
`Authorization` header (see [Authentication](#authentication)) — the
adapter deliberately ignores query-string tokens. `forwardQueryParams`
is for non-secret, installation-scoped metadata like a source tag, not
for anything that grants access.

## Deriving a session id per tool call

MCP is sessionless: by default every `tools/call` runs in a fresh flow
session, so there is no built-in way to say "these calls belong together."
The [sessionless-MCP SEP](https://modelcontextprotocol.io/seps/2567-sessionless-mcp)
recommends that a server wanting session semantics expose session creation as
its own tool. The per-action `mcp.session` directive is how you do that: it
lets one action mint a flow session id, and another reuse it.

It has two forms.

A **template string** mints a fresh id. The first `*` is replaced with a random
token; with no `*` the token is appended. Use it to hand the caller a reusable
id whose prefix names the concept:

```ts
actions: {
  createContext: {
    block: createContext,       // returns the new session id to the caller
    description: "Open a context, then log activity under it.",
    mcp: { session: "ctx_*" },  // this call dispatches under ctx_1784…_a1b2
  },
}
```

**`{ fromInput: <field> }`** reads the string at `input.<field>` and uses it as
the session id, so calls passing the same value land in one session:

```ts
actions: {
  logActivity: {
    block: logActivity,
    description: "Log activity into the context named by contextId.",
    mcp: { session: { fromInput: "contextId" } },
  },
}
```

A client calls `createContext` once, gets back a `ctx_…` id, then passes it as
`contextId` on every later `logActivity`. Those calls all run under the same
flow session, so whatever an action writes to session state (or the session's
request history) is shared across them.

This is a **flow** session id, not the protocol `Mcp-Session-Id`. No
`Mcp-Session-Id` header is issued and the client needs no MCP session
machinery; the id only selects which flow session state and history a call
sees. See [State & Scopes](../fundamentals/state-and-scopes#session-the-primary-scope)
for what a session holds.

With `{ fromInput }` the id is model-supplied, so treat it as a grouping key
only, never an auth or routing decision. The principal still comes from your
[`resolvePrincipal`](#authentication), and the framework's session user-binding
check rejects a call whose caller identity does not match the stored session's
owner — so an action cannot run against another principal's session state.

Two caveats worth knowing before you use `{ fromInput }` beyond a single
trusted principal:

- **Single-principal until session keys are namespaced.** The id is used as a
  bare flow session key. In a multi-user flow without distinct tenant prefixes,
  a caller could pass another user's known id; the user-binding check blocks the
  run, but a pre-dispatch metadata write (the session's auto-resume pointer) is
  only tenant-guarded today, not user-guarded. Namespace caller-supplied session
  keys by principal before exposing `{ fromInput }` to mutually-distrusting
  users.
- **The key is written before your schema validates.** The adapter derives the
  session id and dispatches — persisting a session record keyed by that raw
  value — *before* the action's input schema runs. So an oversized `fromInput`
  value writes an oversized-keyed session even though the call is then rejected.
  Bound the field's length in the action's input schema (the adapter does not
  bound it for you).

If the field is missing or empty, the call falls back to a fresh ephemeral
session and the action's own input schema decides whether that is an error.

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

- **Stateless by default.** Every `tools/call` runs in a fresh flow
  session unless the action opts in with `mcp.session` (see
  [Deriving a session id per tool call](#deriving-a-session-id-per-tool-call)).
  No `Mcp-Session-Id` is ever issued — grouping is a flow session id the
  caller learns and reuses, not a protocol session. This is the right
  default for serverless deployments and most agentic use cases.
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

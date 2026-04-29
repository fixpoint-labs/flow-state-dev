# Authentication

Authentication for flows resolves a *principal* — the caller identity the
runtime keys state and resources by — from whatever the inbound transport
hands the host. The framework owns the contract; the host owns credential
verification. The framework stores no secrets.

This is the foundation that lets one runtime accept browser sessions, MCP
calls, webhook POSTs, scheduled dispatches, and custom transports under a
single auth model.

## The contract

`defineFlow` accepts an `authentication` config:

```ts
defineFlow({
  kind: "billing",
  authentication: {
    resolvePrincipal: async (ctx) => {
      // ctx.source: 'http' | 'mcp' | 'webhook' | 'scheduled' | ...
      // ctx.request — present for HTTP-shaped transports
      // ctx.envelope — flowKind, action, sessionId, metadata, input
      // ctx.rawBody — preserved by HTTP for signature verification
      return { userId: "...", orgId: "..." }; // or { userId } | { orgId } | null
    },
    defaultUserId: undefined,
    requireUser: true,
    requireOrg: false
  },
  actions: { /* ... */ }
});
```

Four fields, all optional:

- **`resolvePrincipal`** — the verification hook. Returns a `ResolvedPrincipal`,
  a partial `{ userId?, orgId? }`, or `null` (unauthenticated). Throwing a
  `PrincipalResolutionError` lets the host pick the response status.

- **`defaultUserId`** — substituted when `resolvePrincipal` returns no `userId`.
  Use it for machine-driven transports (webhooks, schedules) that have no
  end user — name a system principal once and the framework fills it in.

- **`requireUser`** — when true (default), the framework rejects requests
  that don't yield a `userId` after the `defaultUserId` fallback. When false,
  the flow opts out of user-scope identity entirely.

- **`requireOrg`** — reserved. The org-scope state model is a separate
  future concern; the flag exists so hosts can declare intent without churn
  when it lands.

## Resolution order

For each inbound request the host runs:

1. Adapter constructs a `PrincipalResolutionContext`.
2. Pick the resolver: per-flow `authentication.resolvePrincipal` if set,
   otherwise the host-level fallback (`createFlowApiRouter({ resolvePrincipal })`,
   default = the body-userId stub).
3. Call the resolver. Capture the result or rethrow `PrincipalResolutionError`.
4. If the result has no `userId` and `defaultUserId` is set, use it.
5. If still no `userId` and `requireUser !== false`, reject with 401.
6. Stamp the resolved principal onto the `InboundRequestEnvelope`.
7. Proceed with `host.dispatch`.

Steps 2–5 run inside `host.resolvePrincipal`. Adapters never implement auth
themselves — they always call `host.resolvePrincipal` and the host applies
the per-flow routing transparently.

## `requireUser: false` semantics

A flow that opts out of user identity must not declare any user-scope
state, `clientData`, or resources. The framework enforces this at flow
registration:

```ts
// Throws at defineFlow:
defineFlow({
  kind: "public-flow",
  authentication: { requireUser: false },
  user: { stateSchema: z.object({ pref: z.string() }) }, // ERROR
  actions: { /* ... */ }
});
```

The same enforcement applies to `user.clientData` and to any resource (block-
declared or flow-level) with `scope: "user"`. Catching the conflict at
startup — rather than at request time — surfaces a class of integration
mistakes immediately.

The runtime still expects a `userId` for `RequestRecord.userId`,
`ActiveRequestEntry.userId`, and similar bookkeeping fields. That's why
`requireUser: false` flows must either return a `userId` from the resolver
or set `authentication.defaultUserId`. Configuring neither raises a 500 at
request time naming the flow.

## Top-level `requireUser` shorthand

`defineFlow` keeps a top-level `requireUser` flag for convenience. When
both `authentication.requireUser` and the top-level `requireUser` are set,
`authentication.requireUser` wins. Otherwise the framework falls back to
the top-level flag, then defaults to `true`.

## Convenience helpers

`@flow-state-dev/server` ships two verifier helpers hosts can compose
inside their resolvers.

### HMAC signature verifier

```ts
import { createHmacVerifier, PrincipalResolutionError } from "@flow-state-dev/server";

const verifyStripe = createHmacVerifier({
  secret: process.env.STRIPE_WEBHOOK_SECRET!,
  format: "stripe",
  toleranceSeconds: 300
});

defineFlow({
  kind: "stripe-webhook",
  authentication: {
    requireUser: false,
    defaultUserId: "system",
    resolvePrincipal: ({ rawBody, request }) => {
      const sig = request?.headers.get("stripe-signature") ?? null;
      if (rawBody === undefined || !verifyStripe(rawBody, sig)) {
        throw new PrincipalResolutionError("Invalid signature", { status: 401 });
      }
      return null; // defaultUserId ("system") fills in
    }
  },
  /* ... */
});
```

`format: "raw"` matches GitHub-style `sha256=<hex>` headers; `format: "stripe"`
matches `t=<ts>,v1=<sig>[,vN=<sig>...]` with timestamp tolerance; `format: "custom"`
takes a `parseSignature` callback for anything else. All comparisons are
constant-time.

### Bearer token / HS256 JWT verifier

```ts
import {
  createHs256JwtVerifier,
  extractBearerToken,
  PrincipalResolutionError
} from "@flow-state-dev/server";

const verifyJwt = createHs256JwtVerifier({
  secret: process.env.JWT_SECRET!,
  issuer: "https://my-app.example.com",
  audience: "api.my-app.example.com"
});

defineFlow({
  kind: "private-flow",
  authentication: {
    resolvePrincipal: ({ request }) => {
      const token = extractBearerToken(request?.headers.get("authorization"));
      const payload = verifyJwt(token);
      if (payload === null) {
        throw new PrincipalResolutionError("Invalid token", { status: 401 });
      }
      return { userId: payload.sub as string, orgId: payload.org as string };
    }
  },
  /* ... */
});
```

Asymmetric algorithms (RS256, ES256) are out of scope here — they require
JWKS resolution that's a separate concern. Hosts using those plug in their
own verifier.

## Sharing resolvers

If multiple flows share auth logic, hosts compose their own:

```ts
const sharedResolver: ResolvePrincipalFn = async (ctx) => readSession(ctx.request);

defineFlow({ kind: "flow-a", authentication: { resolvePrincipal: sharedResolver }, /* ... */ });
defineFlow({ kind: "flow-b", authentication: { resolvePrincipal: sharedResolver }, /* ... */ });
```

Per-flow hooks rather than registry-level hooks because flows may have
legitimately different auth requirements — one flow public, another
private; one MCP-exposed, another not.

## Host-level fallback

`createFlowApiRouter` accepts a `resolvePrincipal` option used when an
inbound flow has no `authentication.resolvePrincipal` of its own:

```ts
import { createFlowApiRouter } from "@flow-state-dev/server";

const router = createFlowApiRouter({
  registry,
  stores,
  resolvePrincipal: async (ctx) => readSession(ctx.request)
});
```

Per-flow `defineFlow({ authentication })` always wins over this fallback.
The default fallback is `defaultBodyUserIdPrincipalResolver`, which reads
`body.userId` from the parsed HTTP body — useful for early development and
for the framework's existing tests.

## What the framework does not own

- **Credential storage** — the host owns user tables, OAuth tokens, webhook
  secrets, per-user MCP credential grants. The framework gives you a hook
  and stays out of the way.
- **OAuth provider plumbing** — host concern.
- **Asymmetric JWT verification (RS256/ES256)** — needs JWKS and rotation
  semantics outside the scope of a per-flow hook.
- **Org-scope state** — a separate future concern. The `requireOrg` flag
  exists today only as a type-level reservation.

## Edge cases

- **Resolver throws `PrincipalResolutionError`** — the host re-throws as-is,
  honoring the `status` field. Use this for explicit auth failures.
- **Resolver returns `null` and no `defaultUserId` is set** — the host
  rejects with 401 (`requireUser: true`) or 500 (`requireUser: false`,
  configuration error).
- **Flow has `requireUser: false` and a user-scope declaration** — thrown at
  `defineFlow` time, naming the offending field.
- **`authentication.resolvePrincipal` returns `{ orgId }` with no `userId`** —
  treated as no `userId`; falls through to `defaultUserId`.

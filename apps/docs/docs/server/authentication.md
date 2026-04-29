---
sidebar_position: 5
---

# Authentication

Every inbound request to a flow has to be tied to a *principal* — the
caller identity the runtime keys state, resources, and request records by.
The framework gives you a hook to verify whatever credentials your
transport carries and return a principal. It does not store secrets, run
OAuth, or look up users in your database. That stays on your side.

## The hook

`defineFlow` accepts an `authentication` config:

```ts
import { defineFlow } from "@flow-state-dev/core";

defineFlow({
  kind: "billing",
  authentication: {
    resolvePrincipal: async (ctx) => {
      // ctx.source: 'http' | 'mcp' | 'webhook' | 'scheduled' | ...
      // ctx.request — present for HTTP-shaped transports
      // ctx.envelope — flowKind, action, sessionId, metadata, input
      // ctx.rawBody — preserved by HTTP for signature verification
      const session = await readSession(ctx.request);
      if (session === null) return null;
      return { userId: session.userId, orgId: session.orgId };
    }
  },
  actions: { /* ... */ }
});
```

The resolver returns a `ResolvedPrincipal`, a partial `{ userId?, orgId? }`,
or `null`. Throwing a `PrincipalResolutionError` lets you pick the response
status (401 for invalid signature, 403 for valid signature on a forbidden
resource, etc.).

## Resolution order

For each request:

1. The transport adapter builds a `PrincipalResolutionContext`.
2. The host picks the resolver: per-flow `authentication.resolvePrincipal`
   if set, otherwise the host-level fallback.
3. Result has no `userId` and `defaultUserId` is set → use `defaultUserId`.
4. Still no `userId` and `requireUser !== false` → 401.
5. Principal stamped onto the envelope; runtime continues.

Adapters never implement auth themselves. They call `host.resolvePrincipal`
and the host applies the per-flow routing transparently.

## Three patterns

### Browser sessions over HTTP

```ts
import { getSession } from "@/lib/auth";

defineFlow({
  kind: "chat",
  authentication: {
    resolvePrincipal: async ({ request }) => {
      const session = await getSession(request);
      if (session === null) return null;
      return { userId: session.user.id, orgId: session.user.orgId };
    }
  },
  actions: { /* ... */ }
});
```

When the resolver returns `null` and `requireUser: true` (default), the
framework rejects with 401. The browser client sees a clean
`Unauthorized` response and your existing redirect-to-login flow handles
the rest.

### Stripe webhook with HMAC signature

Webhooks have no end user. You verify the signature, then return a
host-defined system principal — or skip the resolver entirely and set
`defaultUserId`.

```ts
import {
  createHmacVerifier,
  PrincipalResolutionError
} from "@flow-state-dev/server";

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
    resolvePrincipal: ({ request, rawBody }) => {
      const sig = request?.headers.get("stripe-signature") ?? null;
      if (rawBody === undefined || !verifyStripe(rawBody, sig)) {
        throw new PrincipalResolutionError("Invalid signature", { status: 401 });
      }
      return null; // defaultUserId fills in "system"
    }
  },
  actions: { /* ... */ }
});
```

`requireUser: false` opts the flow out of user-scope identity at build
time — the framework rejects any user-scope state, `clientData`, or
resource declarations on this flow. The runtime still needs a `userId`
for `RequestRecord.userId` and friends; that's what `defaultUserId`
covers.

`createHmacVerifier({ format: "stripe" })` matches Stripe's canonical
`t=<timestamp>,v1=<signature>` format and rejects timestamps older than
`toleranceSeconds`. For GitHub-style `sha256=<hex>` headers, use
`format: "raw"` with `prefix: "sha256="`.

### MCP / API token over Authorization header

```ts
import {
  createHs256JwtVerifier,
  extractBearerToken,
  PrincipalResolutionError
} from "@flow-state-dev/server";

const verifyJwt = createHs256JwtVerifier({
  secret: process.env.JWT_SECRET!,
  issuer: "https://my-app.example.com",
  audience: "api.my-app.example.com",
  clockSkewSeconds: 30
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
      return {
        userId: payload.sub as string,
        orgId: typeof payload.org === "string" ? payload.org : undefined
      };
    }
  },
  actions: { /* ... */ }
});
```

Asymmetric algorithms (RS256, ES256) need JWKS resolution and aren't
covered by the built-in helper. Plug in your own verifier inside
`resolvePrincipal` — the contract doesn't care which library you use.

## Sharing resolvers across flows

Per-flow hooks rather than registry-level hooks because flows often have
different requirements (one public, one private; one MCP-exposed, one
not). When flows do share auth logic, pull the resolver into a constant:

```ts
import type { ResolvePrincipalFn } from "@flow-state-dev/server";

const sessionResolver: ResolvePrincipalFn = async (ctx) => {
  const session = await getSession(ctx.request);
  return session === null ? null : { userId: session.user.id };
};

defineFlow({ kind: "flow-a", authentication: { resolvePrincipal: sessionResolver }, /* ... */ });
defineFlow({ kind: "flow-b", authentication: { resolvePrincipal: sessionResolver }, /* ... */ });
```

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

## What the framework does not do

- Store credentials, OAuth tokens, or webhook secrets.
- Implement RS256/ES256 JWT verification (needs JWKS, separate concern).
- Run an OAuth provider.
- Provide an org-scope state model — `requireOrg` is reserved for that
  future work but has no runtime effect today.

For the contract details and edge cases, see
`docs/architecture/authentication.md`.

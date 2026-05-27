---
sidebar_position: 5
---

# Authentication

The framework treats the `userId` you supply as authoritative. Verifying
that the `userId` belongs to the caller is your application's job —
typically your auth middleware runs before the framework's HTTP handler
and rejects anything it can't identify.

Every inbound request to a flow has to be tied to a *principal*: the
caller identity the runtime keys state, resources, and request records by.
The framework gives you a hook to attach a principal to a request. It does
not store secrets, run OAuth, or look up users in your database. That
stays on your side.

This is the same trust model Mastra, LangGraph, and other application-layer
frameworks use. It works because the trust boundary is your auth code, not
the framework's HTTP handler.

## Who's responsible for what

**Your job.** Verify the credentials your transport carries — session
cookie, JWT, signed webhook header — and produce a `userId` (and optionally
`orgId`) that the framework can trust. If the credential is missing or
invalid, reject the request before it reaches the framework, or throw
`PrincipalResolutionError` from inside the resolver.

**The framework's job.** Enforce that the identity attached to a request
is internally consistent with the rest of the runtime. Two checks:

- **Session binding.** Once a session is created with `userId: A`, later
  requests claiming `userId: B` against that session throw
  `UserBindingMismatchError` at context creation. Same for `orgId` via
  `OrgBindingMismatchError`. See [Session consistency check](#session-consistency-check).
- **Schema compatibility.** If two flows on the same server declare
  incompatible `user.stateSchema` (or `org.stateSchema`) shapes,
  `FlowRegistry.register` throws `CrossFlowSchemaConflictError` at startup.
  See [Cross-flow schema compatibility](#cross-flow-schema-compatibility).

The framework does not — and cannot — verify that `userId: A` actually
belongs to whoever sent the request. That's the credential your middleware
or resolver verified before the framework ever saw the call.

## What `requireUser: true` does (and doesn't)

`requireUser: true` is the default. It means *the request must produce
some `userId` after the resolver and `defaultUserId` fallback have run*.
If neither yields a `userId`, the framework rejects with 401.

It is a presence check, not an authentication check. A misconfigured
resolver that returns `{ userId: "anyone" }` for every caller still
satisfies `requireUser: true`. The framework only asks "is there a
`userId`?" — not "does this `userId` belong to the caller?"

To enforce real identity, do it inside `resolvePrincipal`: throw
`PrincipalResolutionError` for invalid credentials, return `null` to fall
through to `defaultUserId`, or look the resolved `userId` up against your
own user store before returning it.

`requireUser: false` opts a flow out of user-scope identity entirely. The
framework then refuses to compile the flow if it declares any user-scope
state, resources, or `client` block. Use it for webhooks and scheduled jobs
that legitimately have no end user.

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
time — the framework rejects any user-scope state, `client` block, or
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

`createFlowState` accepts a `resolvePrincipal` option used when an
inbound flow has no `authentication.resolvePrincipal` of its own:

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/server";

export const flowstate = createFlowState({
  flows: { chat: chatFlow },
  stores: { default: { primary: inMemoryStores() } },
  resolvePrincipal: async (ctx) => readSession(ctx.request)
});
```

Per-flow `defineFlow({ authentication })` always wins over this fallback.

## Session consistency check

A session's `userId` and `orgId` are immutable for the session's lifetime.
Once a session has been created against a particular identity, every
later request that loads it has to match. If it doesn't, the framework
throws at context creation:

- `UserBindingMismatchError` — request supplied a `userId` that doesn't
  match the session's owner.
- `OrgBindingMismatchError` — request supplied an `orgId` that doesn't
  match the session's bound org.

This is a structural integrity check, not an identity check. Your auth
code is what guarantees a request actually represents `userId: A`. The
framework guarantees that once a session belongs to `userId: A`, no
request can route data through it under a different identity — whether
the mismatch came from a buggy client, a routing mistake, or a stale
cookie that drifted between users.

To "move" a session to a different user or org, create a new session.

## Cross-flow schema compatibility

User and org records are shared across every flow registered on the same
server by default. A chat flow that writes `user.preferences.theme` and
an admin flow that reads it touch the same `UserRecord`. That's usually
what you want — preferences, profile fields, org settings belong to the
user or the org, not to one flow.

For shared-by-default to be safe, the framework checks at startup that
every flow's `user.stateSchema` and `org.stateSchema` are structurally
compatible with the others already in the registry. Incompatible
declarations throw `CrossFlowSchemaConflictError` immediately, naming
the offending field and the two flows involved. You see it once, in
development, and fix it before users do.

Identical schemas merge cleanly. Schemas that one flow extends with extra
optional fields merge with a warning. Anything that would actually
overwrite data — same field, different type — throws.

When sharing isn't appropriate, set `isolateUserState: true` (or
`isolateOrgState: true`) on `defineFlow`. The flow's user (or org) state
is then stored separately and excluded from the schema check. See
[Sharing State Across Flows](/docs/advanced/flow-isolation) for the full
opt-out story.

## What the framework does not do

- Store credentials, OAuth tokens, or webhook secrets.
- Implement RS256/ES256 JWT verification (needs JWKS, separate concern).
- Run an OAuth provider.
- Verify that a `userId` actually belongs to the caller. That's your
  middleware or `resolvePrincipal` hook.
- Honour `requireOrg` — the flag is reserved for future enforcement work
  and has no runtime effect today. Org-scope state itself is fully
  supported.

For the contract details and edge cases, see
`docs/architecture/authentication.md`.

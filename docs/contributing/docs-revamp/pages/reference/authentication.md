---
title: Authentication and tenancy
type: reference
description: "The resolver that says who is calling, the order a request's identity is settled in, what requireUser checks, what is checked when a session id is sent, how the tenant header separates sessions, and how flows share a resolver."
---

# Authentication and tenancy

Flow State does not sign anyone in. A function you write, the resolver, reads a request and returns the user and organization that sent it. That pair is the principal. From then on the framework applies its own rules to the principal: every session, request and stored record belongs to one user in one organization, and a call can only reach what belongs to the principal it arrived with.

You write the resolver once. This page lists its signature, how one is picked when several apply, and what the framework refuses on each route.

A tenant is a separate, coarser split. One deployment that serves several customers gives each its own tenant, set by a request header rather than by the resolver, and the tenant keeps sessions with the same id apart.

The tables use one app, a support desk. Its `support` flow has a `reply` action. Alice is a user in the organization `acme`, Bob is a user in `globex`, and Alice owns a session, `s1`, which is where the flow keeps one customer conversation together as one record. `src/lib/session.ts` exports `getSession`, your own helper that reads a cookie and returns the signed-in user or `null`.

```ts title="src/lib/session-resolver.ts"
import type { ResolvePrincipalFn } from "@flow-state-dev/core/types";
import { PrincipalResolutionError } from "@flow-state-dev/engine";
import { getSession } from "./session";

export const sessionResolver: ResolvePrincipalFn = async ({ request }) => {
  if (request === undefined) return null;
  const session = await getSession(request);
  if (session === null) {
    throw new PrincipalResolutionError("Sign in to continue.", { status: 401 });
  }
  return { userId: session.user.id, orgId: session.user.orgId };
};
```

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { sessionResolver } from "../../lib/session-resolver";
import { reply } from "./blocks/reply";

export const supportFlow = defineFlow({
  kind: "support",
  authentication: { resolvePrincipal: sessionResolver },
  actions: { reply: { block: reply, description: "Answer a customer message." } },
});

export default supportFlow();
```

`reply` is a block, the unit of work the action runs, in `src/flows/support/blocks/reply.ts`. For the model behind these tables, see [Auth and tenancy](../concepts/auth-and-tenancy.md).

## The resolver

```typescript
type ResolvePrincipalFn = (
  context: PrincipalResolutionContext,
) => Promise<R> | R;
// R = ResolvedPrincipal | { userId?: string; orgId?: string } | null
// ResolvedPrincipal = { userId: string; orgId: string }
```

The types come from `@flow-state-dev/core/types`. `@flow-state-dev/engine/host` exports `PrincipalResolver` as the same function type.

| Context field | Type | Meaning |
| --- | --- | --- |
| `source` | `string` | Which transport asked. Documented values: `http`, `mcp`, `webhook`, `scheduled`, `notification`. A custom transport picks its own. `fsdev run` and `fsdev chat` pass `cli` |
| `request` | `Request`, optional | The native HTTP request. Set for HTTP-shaped transports |
| `envelope` | `{ flowKind, action, sessionId?, metadata?, input }` | What the call is for |
| `rawBody` | `Uint8Array`, optional | The raw body bytes, kept by HTTP-shaped adapters so a resolver can check a signature |

A resolver may throw `PrincipalResolutionError(message, { status })`. `status` defaults to `401`. The caller gets that status and message.

### What each caller hands the resolver

| Caller | `source` | `request` | `envelope` |
| --- | --- | --- | --- |
| Action call, `POST .../actions/:name` | `http` | yes | `flowKind` is the addressed instance id. `metadata` holds the body's `metadata` and the whole parsed body as `metadata.body`. `input` is `body.input` |
| A management route: session, state, resource, request control, listing | `http` | yes | `flowKind` is the governing instance's id, or `""` when no one flow governs. `metadata` is `{}` and `input` is `undefined`. There is no body, so a resolver that reads `metadata.body` gets `undefined` |
| MCP request | `mcp` | yes | `action` is the tool name on `tools/call`, otherwise `(metadata)`. `input` is the JSON-RPC params. `metadata` is `{ mcpMethod }` |
| Webhook | `webhook` | yes | `rawBody` is kept. `metadata` carries the provider and event |
| Scheduled dispatch and schedule listing | `scheduled` | yes | The dispatch route sets `metadata` to `{ scheduleId, nominalFireTime, phase: "gateway" }` |
| `fsdev run`, `fsdev chat` | `cli` | none | `metadata` is `{ body: { userId, input } }`. The context is read-only: assigning to a field throws in strict mode |

`SCHEDULED_TRANSPORT_SOURCE` from `@flow-state-dev/engine` is the string `"scheduled"`.

A request that claims `source: "cli"` over any transport, a custom adapter included, is refused `401` before any resolver runs.

The no-user refusal answers `400` on `POST .../actions/:name` and `401` on a management route. A `PrincipalResolutionError` your resolver throws with status `401` is answered `400` on the action route when its message contains the text `userId`, so keep that word out of the messages you throw.

### What a resolver may return

| Returns | Result |
| --- | --- |
| `{ userId, orgId }`, both valid | That principal. The request runs |
| `{ orgId }` only | `userId` comes from the flow's `defaultUserId` when it is set. Otherwise the `requireUser` rule applies |
| `{ userId }` only, or an `orgId` that is empty, whitespace-only or has a lone surrogate | `401`, "Request requires a verified organization: ... returned no usable orgId" |
| `null`, or a result with no `userId` | The user is checked first. With no `defaultUserId` and `requireUser: true`: `401`, "Action request requires non-empty userId" (`400` on the action route). With `defaultUserId` set, the organization refusal in the row above |
| An `orgId` equal to `DEFAULT_ORG_ID` | `401`. The value is reserved, and a configured resolver cannot claim it |
| Throws `PrincipalResolutionError` | The request is refused with its status and message |

A resolver that returns `null` is always refused when `defaultUserId` is set. `defaultUserId` fills the user but never the organization, so the request fails for the missing organization.

A machine caller with no end user returns `{ orgId }` and lets `defaultUserId` name the system user.

`isValidOrgId(value)` from `@flow-state-dev/core` is `true` for a string that is not empty, not whitespace-only, and has no lone UTF-16 surrogate. A whitespace-only id is rejected, not trimmed. A valid id is stored exactly as given.

### `authentication` on a flow

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `resolvePrincipal` | `ResolvePrincipalFn` | none | Called once for each inbound request |
| `defaultUserId` | `string` | none | Used when the resolver returns no `userId` |
| `requireUser` | `boolean` | `true` | See [`requireUser` and `defaultUserId`](#requireuser-and-defaultuserid) |

`defineFlow` also takes `requireUser` at the top level. The first one set wins, in this order: the instance's `authentication.requireUser`, the definition's `authentication.requireUser`, the instance's top-level `requireUser`, the definition's top-level `requireUser`, then `true`. So an instance's top-level `requireUser` loses to the definition's `authentication.requireUser`.

A flow definition used as several instances can override `authentication` per instance. The merge is per field: an instance's `resolvePrincipal`, `defaultUserId` and `authentication.requireUser` each win over the definition's, and a field the instance leaves unset falls through to the definition.

## Resolution order

For one request:

1. A context that claims `source: "cli"` and was not built by `fsdev run` or `fsdev chat` is refused `401`.
2. The resolver is picked: the flow's own `authentication.resolvePrincipal`, else the `resolvePrincipal` given to `createFlowState`, else the framework default, which reads `body.userId`.
3. The resolver runs once.
4. The user is the resolver's `userId` when it is a non-empty string, otherwise the flow's `defaultUserId` when that is non-empty.
5. With no user, `requireUser: true` answers `401` "Action request requires non-empty userId" (`400` on the action route, see above). `requireUser: false` answers `500` with `Flow "support" has authentication.requireUser: false but no userId was resolved. Set authentication.defaultUserId or return a userId from authentication.resolvePrincipal.`
6. The organization is settled as [Organization](#organization) lists.
7. The principal is stamped on the request and the run continues.

`requireUser` and `defaultUserId` are the picked flow's own.

### Which resolver wins when two apply?

| Applies | Wins |
| --- | --- |
| A flow's own `authentication.resolvePrincipal` and `createFlowState({ resolvePrincipal })` | The flow's own. The one on `createFlowState` is the fallback for flows that have none |
| `createFlowState({ resolvePrincipal })` and the framework default | The one on `createFlowState` |
| A definition-level and an instance-level override of the same field | The instance's |
| A route that names a stored record: a session, a request, a file | The resolver of the flow instance the stored record names as its owner, not the flow in the URL. A record whose owner is not registered here falls to the `createFlowState` resolver |
| A route that spans flows or is addressed by user: listings, `/users/:userId/...` | The `createFlowState` resolver, with `flowKind: ""` |
| Two flows that declare the same resource at the same scope | They must agree on one resolver. A caller signed in to one of them gets `409` when they do not. See [Sharing resolvers across flows](#sharing-resolvers-across-flows) |

## `requireUser` and `defaultUserId`

| Setting | What it does |
| --- | --- |
| `requireUser: true` (default) | A request that has no `userId` after the resolver and `defaultUserId` have run is refused `401`. It checks that a user is present. A resolver that returns `{ userId: "anyone" }` for every caller passes it. Verifying the credential is the resolver's job |
| `requireUser: false` | The flow opts out of user-scoped identity. `defineFlow` throws if the flow declares `user.stateSchema`, a `user.client` projection, or any resource with `scope: "user"` |
| `requireUser: false` and no user resolved | `500`. Set `defaultUserId` or return a `userId` |
| `defaultUserId` | Fills the user only. It never supplies an organization |

Use `requireUser: false` for webhooks and scheduled jobs that have no end user. Request records carry a `userId` even so, and `defaultUserId` supplies it.

What the framework does not do:

- It does not verify that a `userId` belongs to whoever sent the request. The resolver's credential check does.
- It does not store credentials, run OAuth, or verify RS256 or ES256 tokens. `createHs256JwtVerifier` is HS256 only. An asymmetric algorithm needs your own verifier inside `resolvePrincipal`.
- With a resolver configured, a `userId` in a session-create body is ignored and the principal's is used. The client's `userId` is what it acts as only when the server has no sign-in.

## Organization

Every request runs in an organization. A session, a request, a dispatched child and a scheduled job each carry one.

| Case | Organization |
| --- | --- |
| A configured resolver, the flow's or `createFlowState`'s | The one it returns. Missing, blank, malformed or `DEFAULT_ORG_ID` gives `401` |
| No resolver anywhere | `DEFAULT_ORG_ID`, the value `"__fsd_default_org__"`. The server logs one warning, the first time it does so |
| Direct execution below any transport, `runAction` | You pass `orgId`: the verified organization, or `DEFAULT_ORG_ID`. Trusted code that supplies none throws `OrgRequiredError` |

- The organization never comes from the request body, a query, a header or metadata. With a resolver, a posted `orgId` is ignored on session create, and the new session is bound to the authenticated organization.
- `DEFAULT_ORG_ID` is a development default, not a security boundary. A configured resolver cannot return it.
- A stored session or request with no organization answers an authenticated caller `409 migration-required`. A caller the resolver could not identify gets the ordinary `401`, and listings omit the record. [Persistence](./persistence.md) covers the migration.

## What is checked when a session id is sent?

It depends on the route. Management routes, the ones that read or change a session, a request or a stored file, are checked before the route runs. An action call is checked before the route answers `202`.

### Management routes, with a resolver

The checks cover session reads, delete, metadata patch, request list, children, state, stream, resource content and manifest, collection items, the debug resource routes, and every route addressed by request, file or user. They run in this order, and the first to fail answers.

| Step | Check | Answer when it fails |
| --- | --- | --- |
| 1 | The session exists under the caller's tenant. A session with that id under another tenant is no session | `404` |
| 2 | The governing flow's resolver identifies the caller. With no credential | `401` |
| 3 | The stored session's `userId` is the principal's | `404 { error: "Unknown session \"s1\"" }`, the same words as an id nobody used |
| 4 | The stored session's `orgId` is the principal's | `403 { error: "Caller's organization does not own the requested resource" }` |
| 5 | Both match | `200`. The route runs |

Bob asking for Alice's `s1` fails at step 3 and gets the same `404` as an id nobody used. Alice asking for `s1` while acting for `globex` passes step 3 and fails at step 4. An unknown id is `404` and is not turned into an auth error. A user check that fails never reaches the organization check, so the `403` is only ever seen by the owning user acting for another organization.

Routes that name something other than a session:

| Route | What is checked | Answer on failure |
| --- | --- | --- |
| Request routes: status, stream, retry, continue, resume, answer, abort | The request's user and organization are the principal's | `404`, as for an id nobody used. A request stream resumed from a cursor (`starting_after`, `Last-Event-ID`) answers an empty `200` |
| A stored file | The session that owns it is checked | `404` naming nothing, for another user's, another organization's or an unowned file |
| `/users/:userId/...` | The path's user is the caller | `403 { error: "Caller is not the owner of the requested resource" }` |
| Debug resource routes | As a session read | `404 { error: "session_not_found" }` for a missing or hidden session |
| `POST /api/flows/:flowId/sessions` | None on the body. The new session's `userId` and `orgId` come from the principal | A body `orgId` is never read. A body `userId` is ignored when a resolver is configured |

Creating a session with an id that is taken answers `409`.

The id does not decide who owns a request. A client may choose its own `requestId`. If another principal already holds it, the caller gets a new request of their own, with the new id in the `x-request-id` response header and the `202` body, and the first user's request is untouched. Sending the id again reaches the caller's own.

An action call, `POST .../actions/:name`, is checked before the route answers `202` and before anything is written: a session that another user or another organization owns answers `404 Unknown session "s1"`, writes nothing, and uses the same words as an unused id. See [The session consistency check](#the-session-consistency-check).

### Which flow governs a record

The flow instance the stored record names, never one the caller names. An action route resolves the caller first, with the addressed flow's resolver, and then checks the session. The user check comes before the instance check, so another user's session answers `404 Unknown session "s1"`. Only a session the caller owns, held by a different instance of the flow, answers `409 wrong-instance-session`. A record with no recorded owner belongs to the singleton instance, or answers `409 migration-required` when the kind has several instances.

The resolver is not given the body on management routes (`metadata` is `{}`).

### Listings

| Route | What the caller gets |
| --- | --- |
| `GET /api/flows/sessions` | Only the caller's sessions. A `userId` query parameter is ignored: asking for another user's id returns the caller's own sessions |
| `GET /api/flows/sessions` and `GET /api/flows/active-requests`, for a flow with its own resolver | Rows go only to the caller that flow's resolver names as the row's owner. A caller that resolver refuses gets no error and none of that flow's rows |
| The same, in a mixed app with no `createFlowState` resolver | The open flows' rows stay. The authenticated flow's rows are withheld from an anonymous caller. The route answers `200` |
| With a `createFlowState` resolver that refuses the caller | `401` for the listing, whatever the flows' own resolvers would say |

Flow metadata (`list_flows`, `capabilities`) needs no principal and never answers `401`. When the server holds an instance pinned to an owner (see [Terminal runs](#terminal-runs)), `list_flows` resolves the caller with each pinned instance's resolver and omits each pinned instance whose resolver refuses the caller or whose pin the caller is outside of.

### Without a resolver

- With no resolver, the development default, `userId` is read from `body.userId`. With none in the body the action route answers `400`.
- When no flow on the server authenticates, management reads and listings are unscoped: any caller can read any session, and every session is listed.
- An existing session refuses a different `userId`: an action call naming another user answers `404 Unknown session`.
- In a mixed app, where some other flow authenticates, a session of an open flow whose organization is not `DEFAULT_ORG_ID` answers `403` on an addressed read and is omitted from the listing.
- A flow that authenticates and one that does not can share a server. Each is checked on its own, and the unauthenticated flow's sessions stay open.

## The session consistency check

A session keeps the user and organization it was created with. Once it exists, the identity the resolver supplied is what it holds.

| What the session holds | Detail |
| --- | --- |
| Fixed at creation | A later request that loads the session under another user or organization is refused before any write |
| Late binding is refused | Giving an organization to a session that was created with none is refused too |
| Order | The user is checked before the organization |
| When | Before the action route answers `202` and before anything is written. A session created while the request is in flight is checked too |
| Instance | A session belongs to one flow instance as well. A different instance reaching it is refused `409` (`wrong-instance-session` or `wrong-instance-request`), naming neither owner |

| What a refused caller gets | Detail |
| --- | --- |
| Over HTTP | The action route answers both mismatches as `404 Unknown session "s1"` |
| Errors, for code that runs below HTTP | `UserBindingMismatchError` has `sessionId`, `sessionUserId` and `requestedUserId`, and its message never names the owner. `OrgBindingMismatchError` has `sessionId`, `sessionOrgId` and `requestedOrgId`, and its message names both organizations. Both come from `@flow-state-dev/engine/host` |
| Refused means untouched | A refused request leaves the session as it was: not in its snapshot or stream, not its `latestRequestId`, and its `updatedAt` does not move |
| Request ids | Code below HTTP that uses another principal's request id gets `RequestOwnerMismatchError`, whose message names the id only. When two principals send the same new `requestId` at once, the action route answers one of them `409 request-id-in-use` |

To move a conversation to another user or organization, create a new session. `fsdev run` says `use a new session id`. Through MCP, the same check applies: an action cannot run against another principal's session state, even when the client chose the session id.

## Tenant isolation

The tenant comes from the `x-tenant-id` request header. An absent or empty header means no tenant.

```ts title="src/lib/client.ts"
import { createClient } from "@flow-state-dev/client";

export function supportClient(userId: string, tenantId: string) {
  return createClient({
    userId,
    baseUrl: "",
    fetcher: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("x-tenant-id", tenantId);
      return fetch(input, { ...init, headers });
    },
  });
}
```

The client has no tenant option, so the header is added through `fetcher`. Set it from something you trust, such as your gateway.

| How the tenant is set and kept | Detail |
| --- | --- |
| Header name | `x-tenant-id`. Only `createFlowApiRouter({ tenantIdHeader })` can change it. `createFlowState` has no such option |
| Valid ids | A tenant id containing `:` is refused `400` (`Tenant id must not contain ":"`) |
| Storage | With a tenant, a session is stored under `<tenantId>:<sessionId>`. The same session id under two tenants is two records, with two states and two sets of session-scoped resources. The id the API returns is always the bare id |
| No tenant | A record with no tenant matches only a request with no tenant. With no header, a session keys on its own id alone |
| In a block | `ctx.request.identity.tenantId` and `ctx.session.identity.tenantId` |
| Push topics | A topic is `{ scope, id, tenantId, resource? }`, with `tenantId` `""` for a single-tenant app, so no tenant hears another's notices |

| What a wrong tenant gets | Detail |
| --- | --- |
| Session lookup | A lookup under a wrong or missing tenant header is `404`, including a crafted probe with no header and a session id of `<tenant>:<id>` |
| Writes | A mutating route under the wrong tenant does nothing. A `DELETE` with no tenant header leaves the tenant's session in place |
| Listings | Scoped to the header's tenant, with bare ids |
| Requests | Retry and continue of another tenant's request answer `404` |

The tenant splits sessions and requests. User and organization scopes are shared across tenants. To split those too, put the tenant in the id you pass.

The header is not checked against the principal. The resolver returns a user and an organization, and nothing compares the tenant to either.

## Sharing resolvers across flows

Each flow names its own resolver. Flows that share sign-in share a constant, `sessionResolver` above, and each names it in `authentication: { resolvePrincipal: sessionResolver }`.

Two flows that declare the same resource key at the same scope must agree, and the resolver is compared by function identity. Different functions with identical bodies disagree.

| Disagreement | Answer |
| --- | --- |
| Different `resolvePrincipal` | `409 declarations_disagree`: `Resource "<key>" at <scope> scope is declared by flows "<a>" and "<b>" with different sign-in resolvers, so there is no one caller to read or write it as. Give both flows one resolver.` The same answer comes to a read of the resource, a send to its actions and the resource's built-in write |
| Different `requireUser` or `defaultUserId` | `409 declarations_disagree` |
| Any of the above, for a caller a declaring flow's resolver refuses, or who has only each flow's `defaultUserId` | `404 unknown_resource`, the answer for a key nobody declared |
| The declaring flows resolve one request to different users or organizations | `500 resolver_disagreement` |
| One flow with its own resolver, another on the `createFlowState` fallback | They disagree |
| One flow names the `createFlowState` resolver itself, another falls back to it | They agree |

The same check covers the resource's `client`, `runBy` and `canWrite` settings.

## Built-in resolver helpers

All are exported from `@flow-state-dev/engine`.

### `createBearerSecretPrincipalResolver(options)`

One shared secret maps to one principal. Per-caller keys need a hand-written `resolvePrincipal`.

```ts title="src/lib/service-resolver.ts"
import { createBearerSecretPrincipalResolver } from "@flow-state-dev/engine";

export function serviceResolver(secret: string) {
  return createBearerSecretPrincipalResolver({
    secret,
    principal: { userId: "helpdesk-bot", orgId: "acme" },
  });
}
```

| Option | Type | Default | Rule |
| --- | --- | --- | --- |
| `secret` | `string` | required | A non-empty string, or the call throws when the resolver is built |
| `principal` | `ResolvedPrincipal` | required | Returned on a match. `principal.userId` must be a non-empty string, or the call throws when built. A principal with no usable `orgId` is refused `401` on each request |
| `headerName` | `string` | `"authorization"` | Case-insensitive. Read from the request's headers, or from `envelope.metadata.headers` when there is no `Request` |

| The request carries | Result |
| --- | --- |
| `Authorization: Bearer <secret>`, equal | Returns `principal`. The scheme's case does not matter |
| A Bearer token that is not the secret | Throws `PrincipalResolutionError("Invalid scheduler secret.", { status: 401 })` on every route the helper resolves for, scheduled or not. The comparison is constant time |
| No header, or a scheme other than Bearer | Returns `null`. With no `defaultUserId` and `requireUser: true` the request is refused `401`, "Action request requires non-empty userId". With `defaultUserId` set it is refused `401` for want of an organization |

### Verifiers

| Helper | Behaviour |
| --- | --- |
| `extractBearerToken(header)` | Case-insensitive on the scheme, trims whitespace, returns `null` for a missing header, a non-Bearer scheme or an empty token |
| `createHs256JwtVerifier({ secret, issuer?, audience?, clockSkewSeconds?, now? })` | Returns the payload, or `null` on any failure. An invalid `secret` throws when it is built. `clockSkewSeconds` defaults to `0`. When `audience` is set, a token with no `aud` is rejected |
| `createHmacVerifier` | Verifies webhook signatures. See [Webhooks](./webhooks.md) |

`defaultBodyUserIdPrincipalResolver` is the development default. It returns a `userId` from the body and no `orgId`, so the server supplies `DEFAULT_ORG_ID`. A hand-written resolver that delegates to it counts as a custom resolver: [the bind guard](#the-bind-guard) treats the flow as authenticated, and the server does not supply `DEFAULT_ORG_ID`, so the resolver must return an `orgId`.

## Scheduled and cron calls

| The secret | Detail |
| --- | --- |
| Vercel Cron | It calls the cron route with `Authorization: Bearer <CRON_SECRET>`. A missing or wrong secret answers `401`, and the tick calls nothing |
| Unset secret | Every call to the cron route is refused while the configured secret is empty |
| Which secret | `vercelScheduler({ secret })`, else `process.env.CRON_SECRET`, read on each call |
| Dispatch | Each fire the tick sends to the dispatch endpoint carries the same secret |
| At load | `createBearerSecretPrincipalResolver` reads its secret when built, so an unset `CRON_SECRET` passed to it throws at startup, not on the first request |

| What a call gets | Detail |
| --- | --- |
| Order | An unauthenticated POST is refused before it learns anything about fired times or duplicates |
| Refusal | The dispatch endpoint answers a wrong or missing secret `401 { error: "unauthorized", message }`. The cron route answers `401` with the body `Unauthorized` |
| Whose run | `principal` on the bearer helper owns a scheduled run unless the schedule names its own. A schedule's `principal` wins for the user, and its `orgId` falls back to the caller's |
| Scheduled handlers | A scheduled handler is not reachable through the action surface or the flow's action list. The dispatch endpoint is the only way in |
| One secret | The secret gives one fixed principal for the whole dispatch route, so a holder can fire any schedule the resolver accepts |

A resolver can accept the bearer secret for scheduled calls only by branching on `context.source === "scheduled"`. The schedule fields are on [Schedules](./schedules.md).

## Subscriptions

`client.subscribe` is checked once, when the connection is minted. Individual notices are not checked.

| What the mint checks | Detail |
| --- | --- |
| Mint | `POST /users/:userId/stream` with `{ topics }`, up to 100 topics. The path's user must be the caller. The answer carries a signed ticket valid for 30 seconds and the granted topics |
| Session topic | Checked as the session stream is, on that request. A session the caller may not read is dropped, as one that does not exist is |
| User or organization topic | Names no id. It resolves to the verified caller's own user or organization. In an app where some flow authenticates, an anonymous caller gets neither |
| Credentials | Come through the client's `fetcher`, a bearer header or a cookie, because the mint goes through it |

| What happens after the mint | Detail |
| --- | --- |
| Refused topics | Asked for again each `pollIntervalMs` tick. With no `pollIntervalMs`, on reconnect |
| While open | Access is not re-checked while a socket is open. A read the caller is not allowed to make is refused when they read. A notice says that something changed, never what |
| Lifetime | The server closes every socket at most an hour after it opened, with close code `4000`. The client mints again, and the mint checks again |
| No ticket | A socket with no valid ticket in 5 seconds is closed |

## Terminal runs

`fsdev run` and `fsdev chat` ask the app's own resolution, the same answer an HTTP request would get, with `source: "cli"`. [CLI](./cli.md) has the flags and exit codes.

| Who the run is | What happens |
| --- | --- |
| No resolver, or no config | User `devuser`, organization `DEFAULT_ORG_ID`, printed as `__fsd_default_org__` |
| A resolver that checks a credential | It refuses the terminal, because the CLI carries none. The run stops before it writes anything, exit `2`, with `Flow "<f>" refused this terminal: <reason>` and a second line pointing at `--org` |
| `--org <id>` | Skips the resolver and runs as `--user`, or `devuser`. It must be a valid organization id and not `DEFAULT_ORG_ID`, or the exit is `2` |
| `--user <id>` alone | Asks the resolver as usual, keeps its organization, and replaces only the user. Blank is exit `2` |

| What else is checked | What happens |
| --- | --- |
| An instance pinned to an owner, `{ orgId, userId? }` | Refuses any identity outside the pin, before anything is written. With no `userId` in the pin, every user in `orgId` passes. Your code sets the pin, with the `ownerPin` option when it creates the instance or with `register(flow, { pin })` on the flow registry. The caller and the address never set it |
| Resuming a session | A session keeps the user and organization it was created with. Resuming it as anyone else is refused, exit `2` for `run` |
| `fsdev chat` | Asks per turn, for that turn's flow. A refusal fails that turn, and the next turn asks again. An owner mismatch on the chat session rotates to a fresh session |

## The bind guard

A flow is unauthenticated when the resolver its routes would pick is the framework default that trusts `body.userId`. The check does not judge whether a custom resolver verifies anything.

| Host | Behaviour |
| --- | --- |
| `fsdev serve` and `fsdev dev`, on a non-loopback host | Refuse to bind, exit code `3`, while any served flow is unauthenticated. The ways out: configure `authentication.resolvePrincipal` or `createFlowState({ resolvePrincipal })`, bind a loopback host, or pass `--allow-unauthenticated` |
| `serve()` from `@flow-state-dev/node`, on a non-loopback host | Rejects with an `Error` naming the unauthenticated flows and sets no exit code. The ways out are the same, with `allowUnauthenticated: true` in place of the flag |
| Next, Vercel and AWS Lambda handlers | Check on every call. An unauthenticated app answers `500 { "error": "Internal server error" }`, with the real message logged once. `allowUnauthenticated: true` overrides it |

The guard applies whatever `NODE_ENV` is, unset included.

## Next

- [Auth and tenancy](../concepts/auth-and-tenancy.md) is the model these tables belong to.
- [Schedules](./schedules.md) has the dispatch endpoint a scheduled call is sent to.
- [Webhooks](./webhooks.md) covers signature checks and who a webhook caller is.
- [Persistence](./persistence.md) shows what each record is keyed by.

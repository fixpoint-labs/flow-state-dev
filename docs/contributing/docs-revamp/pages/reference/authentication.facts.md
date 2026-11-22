# Facts for Authentication and tenancy (R-20, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests and `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. Where a fact comes from reading the implementation rather than a test or an exported doc comment, it is marked **[source]**; where a test pins it, **[test]**; where the existing page or another existing doc says it, **[doc]**. Nothing was run against a deployed project, and I ran no test this session: every **[test]** mark means the test's assertion says it, not that I saw it pass.

Abbreviations (paths from the repo root):

- `au` = `packages/core/src/types/auth.ts` (the public types, `DEFAULT_ORG_ID`, `isValidOrgId`, `DEFAULT_LOCAL_USER_ID`)
- `df` = `packages/core/src/flow/defineFlow.ts`; `ft` = `packages/core/src/types/flow.ts`
- `ih` = `packages/engine/src/transports/host/createInboundTransportHost.ts` (where a caller becomes a principal)
- `pk` = `packages/engine/src/transports/auth/pickPrincipalResolver.ts`
- `bd` = `packages/engine/src/transports/auth/defaultBodyUserIdPrincipalResolver.ts`
- `bs` = `packages/engine/src/transports/auth/createBearerSecretPrincipalResolver.ts`; `ex` = `.../auth/createBearerTokenVerifier.ts`; `as` = `.../auth/assert-secret.ts`
- `er` = `packages/engine/src/transports/errors.ts`
- `ra` = `packages/engine/src/routes/route-auth.ts` (ownership check on the management routes)
- `ru` = `packages/engine/src/routes/route-utils.ts`; `ac` = `packages/engine/src/routes/action-routes.ts`
- `sk` = `packages/engine/src/stores/scope-keys.ts`; `be` = `packages/engine/src/context/binding-errors.ts`
- `na` = `packages/engine/src/routes/network-auth.ts`; `sa` = `packages/engine/src/resources/scope-address.ts`
- `pd` = `packages/engine/src/push/push-delivery.ts`; `ss` = `packages/engine/src/push/socket-session.ts`; `ph` = `packages/client/src/subscribe/push-hub.ts`
- `fp` = `packages/fsdev/src/principal.ts`; `cl` = `packages/fsdev/src/chat/loop.ts`
- `vs` = `packages/vercel/src/scheduler.ts`; `sr` = `packages/engine/src/transports/scheduled/routes.ts`
- Tests (all under `packages/engine/test/` unless a path is given): `mra` = `management-route-auth.test.ts`, `obr` = `org-boundary-routes.test.ts`, `bi` = `binding-immutability.test.ts`, `trt` = `tenant-route-isolation.test.ts`, `pfr` = `transports/per-flow-resolver.test.ts`, `bst` = `transports/createBearerSecretPrincipalResolver.test.ts`, `ipp` = `transports/in-process-principal.test.ts`, `hat` = `transports/http-adapter.test.ts`, `rbs` = `resources-by-scope.test.ts`, `fio` = `flow-instance-ownership.test.ts`, `pdt` = `push-delivery.test.ts`, `e2e` = `transports/scheduled/end-to-end.test.ts`, `vst` = `packages/vercel/test/scheduler.test.ts`, `rid` = `packages/integration-tests/src/two-users-one-tenant/request-id.test.ts`, `fl` = `packages/core/test/flow.test.ts`.
- Docs: `adoc` = `apps/docs/docs/server/authentication.md` (the page's source), `cdoc` = `apps/docs/docs/cli/configuration.md`, `pdoc` = `apps/docs/docs/persistence/overview.md`, `sdoc` = `apps/docs/docs/fundamentals/state-and-scopes.md`, `mdoc` = `apps/docs/docs/server/mcp.md`.

## What the page is

A Reference page: who the framework decides a caller is, and what it checks once it has decided. Tables and signatures, no narrative. It answers two lookups by name: "Which resolver wins when two apply?" and "What is checked when a session id is sent?" It does not teach sign-in. The concept page (`concepts/auth-and-tenancy`) keeps the model; this page keeps the rows that page moved out.

Words to hold: **principal** is the caller identity `{ userId, orgId }` the runtime keys state, resources and request records by (`au:73-92`). A **resolver** is the function that produces it (`au:139-145`). **Organization** is always present on a request (`au:25-30`). **Tenant** is a second, separate axis, set by a header (`ru:58`), not by the resolver.

Imports the page's examples name:

- `defineFlow`, `DEFAULT_ORG_ID`, `isValidOrgId`: `@flow-state-dev/core` (`packages/core/src/index.ts:51`).
- Types `AuthenticationConfig`, `ResolvedPrincipal`, `PrincipalResolutionContext`, `ResolvePrincipalFn`, and `DEFAULT_LOCAL_USER_ID`: `@flow-state-dev/core/types` (`packages/core/src/types/index.ts:126-133`).
- `PrincipalResolutionError`, `createBearerSecretPrincipalResolver`, `extractBearerToken`, `createHs256JwtVerifier`, `createHmacVerifier`, `defaultBodyUserIdPrincipalResolver`: `@flow-state-dev/engine` (`packages/engine/src/index.ts:40-48`).
- `UserBindingMismatchError`, `OrgBindingMismatchError`, `networkAuthenticationError`, `createNetworkAuthGuard`, type `PrincipalResolver`: `@flow-state-dev/engine/host` (`packages/engine/src/host.ts:192,223-225,247`). `PrincipalResolver` is an alias of `ResolvePrincipalFn` (`packages/engine/src/transports/types.ts:71`).
- `createFlowState({ resolvePrincipal })` and `createFlowApiRouter({ resolvePrincipal, tenantIdHeader })`: `@flow-state-dev/engine` (`packages/engine/src/flowstate/types.ts:289`, `packages/engine/src/routes/createFlowApiRouter.ts:104`).

## Table 1: The resolver

### Signature

`ResolvePrincipalFn = (context: PrincipalResolutionContext) => Promise<R> | R`, where `R` is `ResolvedPrincipal | { userId?: string; orgId?: string } | null`. `au:139-145` (exported doc comment).

`ResolvedPrincipal` is `{ userId: string; orgId: string }`. `au:89-92`.

`PrincipalResolutionContext` fields (`au:102-118`):

| Field | Type | Meaning |
| --- | --- | --- |
| `source` | `string` | Which transport asked. Open string. The documented set is `http`, `mcp`, `webhook`, `scheduled`, `notification`; a custom transport picks its own. `au:15-19` |
| `request` | `Request`, optional | The native HTTP request, set for HTTP-shaped transports |
| `envelope` | `{ flowKind, action, sessionId?, metadata?, input }` | What the call is for |
| `rawBody` | `Uint8Array`, optional | Raw body bytes kept by HTTP-shaped adapters for signature checks |

Where the resolver hears about a throw: a resolver may throw `PrincipalResolutionError(message, { status })`; `status` defaults to `401`. `er:11-22`. The response uses that status and message: action route `ac:117-131`, management routes `ra:604-610` (a body of `{ error: message }`), webhook and scheduled routes answer `{ error: "unauthorized", message }` (`packages/engine/src/transports/webhook/routes.ts:181-183`, `sr:85-94`).

### What each caller hands the resolver

| Caller | `source` | `request` | `envelope` | Cite |
| --- | --- | --- | --- | --- |
| Action call over HTTP (`POST .../actions/:name`) | `http` | yes | `flowKind` = the addressed instance id, `action`, `sessionId`, `metadata` = the body's `metadata` plus `body` (the whole parsed body), `input` = `body.input` | `ac:105-118` **[source]**; body under `metadata.body` is what the default resolver reads, `bd:189-199` |
| A management route (session, state, resource, request control, listing) | `http` | yes | `flowKind` = the governing instance's id, or `""` when no flow governs; `action` = the route's kind; `sessionId`; `metadata` = `{}`; `input` = `undefined`. No body | `ra:586-606` **[source]**. A resolver that reads `metadata.body` gets `undefined` there. **[doc]** `adoc:494-500` |
| MCP request | `mcp` | yes | `action` = the tool name on `tools/call`, else `(metadata)`; `input` = the JSON-RPC params; `metadata` = `{ mcpMethod }` | `packages/mcp/src/createMcpTransportAdapter.ts:70,233-246` **[source]**. A refused call answers a JSON-RPC unauthorized error, with a `WWW-Authenticate: Bearer realm="MCP"` header when the status is 401 (`:248-259`) |
| Webhook | `webhook` | yes | `rawBody` kept; `metadata` carries the provider and event | `packages/engine/src/transports/webhook/routes.ts:173-183` **[source]** |
| Scheduled dispatch and schedule listing | `scheduled` | yes | the dispatch route sets `metadata` = `{ scheduleId, nominalFireTime, phase: "gateway" }`, `action` = `"<unresolved>"` | `sr:71-86` **[source]**; the constant is `SCHEDULED_TRANSPORT_SOURCE`, value `"scheduled"` (`packages/engine/src/execution/transport-sources.ts:22`, exported `packages/engine/src/index.ts:49`) |
| `fsdev run`, `fsdev chat` | `cli` | none | `flowKind`, `action`, `input`, `metadata` = `{ body: { userId, input } }`; the context is frozen | `ih:408-428` **[source]**, `ipp:146-166` **[test]** |

- `source: "cli"` is produced only by `fsdev run` and `fsdev chat`. A request from any transport, a custom adapter included, that claims it is refused with `401` before any resolver runs. `ih:281-290`, `ipp:210`, `ipp:236` **[test]**. **[doc]** `adoc:343-346`.
- On the action route, any `PrincipalResolutionError` with status `401` and a message containing `userId` is answered `400` instead (a resolver's own throw included). `ac:121-125` **[source]**. The page states it as behaviour: the no-user refusal is `400` on the action route and `401` on a management route, plus the flat limit about a resolver's own throw: the match is on the message text containing `userId` (`ac:121-125`), so a resolver author should keep that word out of a 401 message. In practice this is the "no `userId` resolved" refusal (`Action request requires non-empty userId`), so on `POST .../actions/:name` a missing user answers `400` with the default resolver (`hat:227` **[test]**) and with a configured resolver too. A management route answers the same refusal `401` (`ra:604-610`; `mra:177-183` **[test]**). **The existing page says `401` for "no userId" without this split.**

### Return shapes: what a resolver may return, and what happens

| Resolver returns | Result | Cite |
| --- | --- | --- |
| `{ userId, orgId }` valid | The principal. Runs | `ih:316-352` |
| `{ orgId }` only (no `userId`) | `userId` comes from the flow's `authentication.defaultUserId` when set; otherwise the `requireUser` rule below | `ih:327-329`, `pfr:103-111` **[test]** |
| `{ userId }` only, or an `orgId` that is empty, whitespace-only or has a lone surrogate | `401`: "Request requires a verified organization: ... returned no usable orgId" (unless the framework default resolver ran, see Table 4) | `ih:260-265` |
| `null`, or a result with no `userId` | The user is checked first (`ih:327-336`): with no `defaultUserId` and `requireUser: true`, `401` "Action request requires non-empty userId" (`400` on the action route); with `defaultUserId` set, the organization refusal above | `ih:317-351`, `pfr:84-122` **[test]** |
| `orgId` equal to `DEFAULT_ORG_ID` | `401`: the value is reserved and a configured resolver cannot claim it | `ih:267-274`, `ipp:120` **[test]** |
| throws `PrincipalResolutionError` | The request is refused with its status and message | `er:11-22` |

- `null` is not "fall through to `defaultUserId`" when a resolver is configured. `defaultUserId` fills the user and never the organization, so `null` plus `defaultUserId` is refused for the missing organization. `ih:327-329`, `pfr:84-101` **[test]**, `au:122-134`. **The existing page, `adoc:129-131`, says "return `null` to fall through to `defaultUserId`". The code refuses that case. Code wins.**
- When a resolver returns neither user nor organization and `requireUser` is `true`, the refusal is the user one (`Action request requires non-empty userId`, `401`), because the user check runs first. `ih:331-336`, `pfr:113-122` **[test]**.
- A machine caller with no end user returns `{ orgId }` and lets `defaultUserId` name the system user. `au:131-133`, `pfr:103-111` **[test]**. **[doc]** `adoc:77-85`.
- `isValidOrgId(value)`: true for a string that is not empty, not whitespace-only, and has no lone UTF-16 surrogate. A whitespace-only id is rejected, not trimmed; a valid id is stored exactly as given. `au:65-70`. Exported from `@flow-state-dev/core`.

### `AuthenticationConfig` (on `defineFlow({ authentication })`)

| Field | Type | Default | Meaning | Cite |
| --- | --- | --- | --- | --- |
| `resolvePrincipal` | `ResolvePrincipalFn` | none | Called once per inbound request | `au:171-176` |
| `defaultUserId` | `string` | none | Substituted when the resolver returns no `userId` | `au:178-183`, `ih:327-329` |
| `requireUser` | `boolean` | `true` | See Table 3 | `au:185-191` |

- `defineFlow` also takes `requireUser` at the top level as a shorthand. The first one set wins, in this order: instance `authentication.requireUser`, definition `authentication.requireUser`, instance top-level `requireUser`, definition top-level `requireUser`, default `true`. So an instance's top-level `requireUser` loses to a definition's `authentication.requireUser`. `ft:574-577`, `df:1432-1441` **[source]**, `fl:153` **[test]**.
- A flow definition used as several instances can override `authentication` per instance. The merge is per field: an instance's `resolvePrincipal`, `defaultUserId` and `authentication.requireUser` win individually and unset ones fall through to the definition. `df:1318-1335`, `df:1426-1441` **[source]**; no test pins the instance override.

## Table 2: Resolution order

Order for one request, in `ih` (`ih:278-352`):

1. A context that claims `source: "cli"` and was not built by the in-process entry point is refused `401`. `ih:283-290`.
2. The resolver is picked: the flow's own `authentication.resolvePrincipal`, else the host-level `resolvePrincipal`, else the framework default (reads `body.userId`). `pk:21-28`, `ih:291-303`. The "else the framework default" step is `createFlowState` supplying `defaultBodyUserIdPrincipalResolver` when no `resolvePrincipal` option is given: `createFlowState.ts:1154`, `:1299`.
3. The resolver runs once. `ih:316`.
4. The user: the resolver's `userId` if a non-empty string; otherwise the flow's `defaultUserId` if non-empty. `ih:317-329`.
5. No user: `requireUser` true (the default) gives `401` `Action request requires non-empty userId`; `requireUser` false gives `500` `Flow "<kind>" has authentication.requireUser: false but no userId was resolved. Set authentication.defaultUserId or return a userId from authentication.resolvePrincipal.` `ih:331-347`, `pfr:113-134` **[test]**. The page quotes it exactly, with `<kind>` filled as the example's `support`.
6. The organization: see Table 4. `ih:350`.
7. The principal is stamped on the request and the runtime continues.

The `requireUser` and `defaultUserId` used are the picked flow's own. `ih:304-305`.

### Lookup: Which resolver wins when two apply?

| Applies | Wins | Cite |
| --- | --- | --- |
| A flow's own `authentication.resolvePrincipal` and `createFlowState({ resolvePrincipal })` | The flow's own. The host-level one is a fallback for flows that have none | `pk:27`, `flowstate/types.ts:283-289`, `pfr:73-79` **[test]** |
| `createFlowState({ resolvePrincipal })` and the framework default | `createFlowState`'s | `createFlowState.ts:1154` |
| A flow-level and an instance-level override on the same field | The instance's | `df:1330-1334` |
| A route that names a record (a session, a request, a stored file) | The resolver of the flow instance the **stored record** names as its owner, not the flow in the URL. A record whose owner is not registered here falls to the host resolver | `ra:535`, `ra:314-358`, `ra:462-520` **[source]**. **[doc]** `adoc:421-425` |
| A route spanning flows, or addressed by user (listings, `/users/:userId/...`) | The host resolver, with `flowKind: ""` | `ra:586-601` **[source]** |
| Two flows that share one resource (same key, same scope) | They must have one resolver; otherwise `409` for a caller signed in to one of them (other callers: Table 10) | `sa:181-206`, `sa:331-338` |

## Table 3: `requireUser` and `defaultUserId`

| Setting | What it does | Cite |
| --- | --- | --- |
| `requireUser: true` (default) | After the resolver and `defaultUserId` have run, a request with no `userId` is refused `401`. It is a presence check. A resolver that returns `{ userId: "anyone" }` for every caller passes it. Verifying the credential is the resolver's job | `ih:331-336`; `au:185-191` |
| `requireUser: false` | The flow opts out of user-scope identity. `defineFlow` throws if the flow declares `user.stateSchema`, a `user.client` projection, or any resource with `scope: "user"` | `df:1280-1313` **[source]**, `fl:176-185` **[test]** (the `user.stateSchema` case) |
| `requireUser: false` and no user resolved | `500` (a configuration mistake, not a caller error): set `defaultUserId` or return a `userId` | `ih:337-347`, `pfr:124-134` **[test]** |
| `defaultUserId` | Fills the user only. It never supplies an organization | `au:178-183`, `au:122-134` |

Use the row for `requireUser: false` for webhooks and scheduled jobs that have no end user. **[doc]** `adoc:134-137`. The runtime still stamps a `userId` on request records, which `defaultUserId` covers. **[doc]** `adoc:246-250`.

## Table 4: Organization

Every request runs in an organization: a session, a request, a dispatched child, a scheduled job each carry one. `au:25-30`.

| Case | Organization | Cite |
| --- | --- | --- |
| A configured resolver (the flow's, or `createFlowState`'s) | The one it returns. Missing, blank, malformed, or `DEFAULT_ORG_ID` gives `401` | `ih:260-274` |
| No resolver anywhere (the framework default ran) | `DEFAULT_ORG_ID`, value `"__fsd_default_org__"`. The server logs one warning, the first time it does so | `au:39`, `ih:243-257` (one flag per inbound host; a `createFlowState` server builds one, `createFlowState.ts:1292`, and so does the router's handler set, `routes/http-handlers.ts:300`; the page says "the server" rather than name the internal host) |
| Direct execution below any transport (`runAction`) | The caller passes `orgId`: the verified organization, or `DEFAULT_ORG_ID` | `er:35-48` (`OrgRequiredError` is thrown when trusted code supplies none); **[doc]** `adoc:87-99` |

- The organization never comes from the request body, a query, a header or metadata. The default resolver returns no `orgId` on purpose, and the host supplies the default. `bd:147-151`, `au:79-82`. Test: with a resolver, a posted `orgId` is ignored on session create (`mra:342-355` **[test]**) and a new session is bound to the authenticated org (`packages/engine/test/principal-org-spoofing.test.ts:94,111`).
- `DEFAULT_ORG_ID` is a development default, not a security boundary: the value is unusable as a customer id on purpose, and a configured resolver cannot return it. `au:31-35`.
- `isDefaultBodyUserIdPrincipalResolver(resolver)` decides "the framework default ran", by a brand symbol, not function identity. A hand-written resolver that delegates to the default is not detected: it counts as a custom resolver, so the bind guard treats the flow as authenticated and the host does not supply `DEFAULT_ORG_ID` (`ih:314`, `ih:243-257`). `bd:161-184`, `ih:314`.
- Where a stored session or request has no organization (written before organizations were required), an authenticated caller gets `409 migration-required`; a caller the resolver could not identify gets the ordinary `401`; listings omit the record. `ra:290-345`. The migration is on the persistence page: `pdoc` section "Which organization a record belongs to". The anchor and the section sit on a page outside this one; the row links there.

## Table 5: What `requireUser` does not do, and the one-line limits

- The framework does not verify that a `userId` belongs to whoever sent the request; the resolver's credential check does. **[doc]** `adoc:48-50`, `adoc:564-570`.
- It does not store credentials, run OAuth, or implement RS256/ES256 verification (`createHs256JwtVerifier` is HS256 only; an asymmetric algorithm needs your own verifier inside `resolvePrincipal`). `ex:13-18` (header comment), **[doc]** `adoc:304-306`.
- The client's `userId` (`createClient({ userId })`) is what it acts as when the server has no sign-in. With sign-in on, the server identifies the caller from the request's credentials. **[doc]** `apps/docs/docs/configuration/client.md:79`. With a resolver configured, a `userId` in a session-create body is ignored and the principal's is used (`mra:327-340` **[test]**).

## Table 6: The built-in resolver helpers

### `createBearerSecretPrincipalResolver(options)`

| Option | Type | Default | Rule | Cite |
| --- | --- | --- | --- | --- |
| `secret` | `string` | required | Must be a non-empty string, or the call throws `createBearerSecretPrincipalResolver: \`secret\` must be a non-empty string.` when the resolver is built | `bs:29-34,58`, `as:4-8`, `bst:130` **[test]** |
| `principal` | `ResolvedPrincipal` | required | Returned on a match. `principal.userId` must be a non-empty string or the call throws when built. The type also requires `orgId`; the build-time check does not test it, and a principal with no usable `orgId` is refused `401` per request by Table 4 | `bs:35-40,59-66`, `bst:139` **[test]**, `ih:260-265` |
| `headerName` | `string` | `"authorization"` | Case-insensitive. Read from the request's headers, or from `envelope.metadata.headers` when there is no `Request` | `bs:41-45,69,87-107`, `bst:97,113` **[test]** |

Behaviour of the returned resolver (`bs:71-85`):

| Request carries | Result | Cite |
| --- | --- | --- |
| `Authorization: Bearer <secret>`, equal | Returns `principal` | `bst:32` **[test]** |
| Same with the scheme in other case (`bearer`) | Accepted | `ex:35-44`, `bst:41` **[test]** |
| A Bearer token that is not the secret | Throws `PrincipalResolutionError("Invalid scheduler secret.", { status: 401 })`, with that literal message on every route the helper resolves for, scheduled or not: the returned resolver never reads `context.source`, and `bs:78` is the only place in `packages/*/src` that throws the message. The compare is constant time, and a length mismatch is not faster | `bs:76-81`, `bst:68,85` **[test]** |
| No header, or a scheme other than Bearer | Returns `null`. The host then checks the user first: with no `defaultUserId` and `requireUser: true`, `401` "Action request requires non-empty userId"; with `defaultUserId` set, `401` for want of an organization (Table 4) | `bs:72-74`, `bst:50,59` **[test]**, `pfr:84-101` **[test]** |

One secret maps to one principal. Per-caller keys need a hand-written `resolvePrincipal`. `bs:10-14`.

**The brief row "a request with no `Authorization` header runs as the default user" is false.** See the disposition list.

### `extractBearerToken(header)`, `createHs256JwtVerifier(options)`, `createHmacVerifier(options)`

Exported from `@flow-state-dev/engine` (`packages/engine/src/index.ts:41-46`). Their option tables belong to the webhook and JWT examples; this page names them in the "Sharing and verifying" list only. What the existing page states about them, verified against the code:

- `extractBearerToken` is case-insensitive on the scheme, trims whitespace, and returns `null` for a missing header, a non-Bearer scheme, or an empty token. `ex:31-42`.
- `createHs256JwtVerifier({ secret, issuer?, audience?, clockSkewSeconds?, now? })` returns the payload, or `null` on any failure; an invalid `secret` throws when it is built. Default clock skew is `0`. When `audience` is set, a token with no `aud` is rejected. `ex:58-95`.
- `createHmacVerifier({ secret, format: "stripe" | "raw", toleranceSeconds, prefix })`: **[doc]** `adoc:252-255`. I did not re-read its source for this sheet; the page should either link to the webhook reference for it or have it checked in pass 5.

## Table 7: What is checked when a session id is sent

This is the lookup. Two situations: the app has a configured resolver for the governing flow, or it does not.

### With a configured resolver (the governing flow's own, or the host's)

`authorizeManagementRoute` runs before the route's handler, on every session-addressed, request-addressed, user-addressed and host-spanning route. `ra:1-9`, `ra:180-283`.

| Step | What is checked | Answer | Cite |
| --- | --- | --- | --- |
| 1 | The tenant: the session is looked up under the caller's tenant header (Table 9). A session with that id under another tenant is no session | not found | `ra:462-468`, `ru:96-108` |
| 2 | The caller: the governing flow's resolver runs. No credential | `401` | `ra:584-610`, `mra:177-183` **[test]** |
| 3 | The user: the stored session's `userId` is the principal's | not equal: `404 { error: "Unknown session \"<id>\"" }`, the same words as an id nobody used | `ra:619-624`, `ru:120-122`, `mra:218-232` **[test]** |
| 4 | The organization: the stored session's `orgId` is the principal's | not equal: `403 { error: "Caller's organization does not own the requested resource" }` | `ra:666-681`, `obr:181-199` **[test]** |
| 5 | Both match | `200`, the route runs | `obr:201-214` **[test]**, `mra:207-216` **[test]** |
| (no session) | An unknown id is `404`, not turned into an auth error | `404` | `mra:249-259` **[test]** |

- Order matters to the reader: the user check is before the organization check. A session another user owns answers `404` whatever organization the caller is in, so the `403` is reached only by the same user acting for a different organization. `ra:619-624`, `ra:666-681`.
- The same check covers: read (`GET /api/flows/sessions/:id`), delete, metadata patch, request list, children, state, stream, resource content and manifest, collection items, and the debug resource routes. `ra:180-283` (the exhaustive route list). The debug routes answer a missing or hidden session as `404 { error: "session_not_found" }` rather than `Unknown session`. `ra:117-127`.
- Request-addressed routes (status, stream, retry, continue, resume, answer, abort): another user's or another organization's request is answered as an id nobody used (`404`), and a request stream resumed from a cursor (`starting_after`, `Last-Event-ID`) answers an empty `200` for both. `ra:129-145`, `ra:629-632`, `ra:671-674`, `obr:262-285` **[test]**.
- A stored file (`get_blob`) is checked as the session that owns it; another user's, another organization's or an unowned file answers `404` naming nothing. `ra:639-641`, `ra:676`, `ru:127`.
- User-addressed routes (`/users/:userId/...`): the path's user must be the caller, else `403 { error: "Caller is not the owner of the requested resource" }`. `ra:643-651`.
- An action POST (`.../actions/:name`) is not part of this check. It resolves the principal itself and is checked at admission: a session another user or another organization owns answers `404 Unknown session "<id>"`, nothing is written, and the same words as an unused id. `ac:278-280`, `ih:596-619`, `hat:244` **[test]**. **[doc]** `adoc:476-482`.
- Creating a session with an id that is taken answers `409`. This is the one place an id shows it is in use. `packages/engine/test/session-birth.test.ts:259-264` **[test]** (an existing id answers `409`); the "whoever holds it" half (the same `409` for another user's session) is **[doc]** `adoc:364-365`, `adoc:481-482` and not pinned by a test I found.
- The id does not decide who owns what: a client may choose its own `requestId`; one that another principal already holds gives the caller a new request of their own. The new id is in the `x-request-id` response header and in the `202` body, the first user's request is untouched, and sending the id again reaches the caller's own. `ac:133-145`, `ac:365-368`, `rid:104-147` **[test]**, `rid:149` **[test]** (the owner's own reuse is idempotent). **[doc]** `adoc:451-474`.
- Which flow governs the record: the flow instance the stored record names, never one the caller names. On an action route the principal is resolved first, with the addressed flow's resolver (`ac:106-118`); the session is checked later, at admission (`ac:294-310`). Admission checks the user before the instance (`be:164-183`), so another user's session answers `404 Unknown session` (`ac:278-280`) and `409 wrong-instance-session` is reached only by the owning user at a different instance. A record with no recorded owner is the singleton's, or `409 migration-required` when the kind has several instances. `ra:314-358`, `ra:462-520`, `ac:288-305`, `fio:172`, `fio:446-512` **[test]**.
- The resolver is not given the body on these routes: `metadata` is `{}`. `ra:599`. A caller never decides access from a field it writes.

### Listings

| Route | What the caller gets | Cite |
| --- | --- | --- |
| `GET /api/flows/sessions` | Only the caller's sessions. With a principal, a `userId` query parameter is ignored (`scope?.userId ?? param`), so asking for another user's id returns the caller's own sessions | `packages/engine/src/routes/session-routes.ts:229-233` **[source]**, `mra:263-292` **[test]** |
| `GET /api/flows/sessions`, `GET /api/flows/active-requests`, a flow with its own resolver | Rows go only to the caller that flow's resolver names as the row's owner. A caller that resolver refuses gets no error and none of its rows | `ra:66-90`, `instance-caller.ts:1-40` **[source]** |
| The same, with no host-level resolver in a mixed app (one flow authenticates, another does not) | The open flows' rows stay; the authenticated flow's rows are withheld from an anonymous caller. The route still answers `200` | `mra:293-324` **[test]**, `ra:581` |
| With a host-level resolver that refuses the caller | `401` for the listing, whatever the flows' own resolvers would say | `ra:584-610` **[source]**: `flowKind: ""` goes to the host resolver. No test names this sentence; **[doc]** `adoc:380-383` states it |
| `POST /api/flows/:flowId/sessions` | The new session's `userId` and `orgId` come from the principal. A body `orgId` is never read. A body `userId` is ignored when a resolver is configured | `mra:327-355` **[test]**, `au:79-82` |

### Without a resolver (the development default)

- `userId` is read from `body.userId` (`bd:139-152`). With no `userId` in the body the action route answers `400` (`hat:227` **[test]**).
- When no flow authenticates (host resolver is the default and no flow has its own), management routes allow everything before any load, so reads and listings are unscoped: any caller can read any session, and every session is listed. `ra:395-400` **[source]**, `mra:598-632` **[test]**.
- An existing session still refuses a different `userId`. The session's user and organization are fixed at creation (Table 8), so an action POST naming another user answers `404 Unknown session`. `bi:54-81` **[test]**, `ac:278-280`.
- Only in a mixed app (anonymous flows beside authenticating ones): a session of an open flow carrying an organization other than `DEFAULT_ORG_ID` is answered `403` on an addressed read, and omitted from the listing. With no flow authenticating, the early allow above skips this check. `ra:554-561`, `ra:581`, `packages/engine/src/routes/session-routes.ts:300-303` (applies only when `anonymousFlowIds` is set), `obr:575-595` **[test]**.
- A flow that authenticates and one that does not can share a server. Flows are checked independently: the unauthenticated flow's sessions stay open. `mra:634-645` **[test]**. **[doc]** `adoc:398-399`.
- Two public routes need no principal: flow metadata (`list_flows`, `capabilities`). `ra:181-199`, `mra:647-660` **[test]**. When the registry holds an owner-pinned instance, `list_flows` resolves the caller per pinned instance and omits each one whose resolver refuses the caller or whose pin excludes them; it never answers `401`. `packages/engine/src/routes/http-handlers.ts:1000-1028` **[source]**.

## Table 8: The session consistency check

| Fact | Cite |
| --- | --- |
| A session's `userId` and `orgId` are fixed when it is created. A later request that loads it under another user or organization is refused before any write | `bi:54-81,111-135` **[test]**; `be:218-265` |
| User mismatch throws `UserBindingMismatchError` (`sessionId`, `sessionUserId`, `requestedUserId`). The message is `Session <id> belongs to another user and cannot be used by this caller.` and never names the owner | `be:232-244` |
| Organization mismatch throws `OrgBindingMismatchError` (`sessionId`, `sessionOrgId`, `requestedOrgId`). The message names both organizations | `be:251-265` |
| The user is checked before the organization | `bi:255` **[test]**, `ih:596-617` |
| Late-binding an organization onto a session that had none is refused too | `bi:138` **[test]** |
| Raised at admission, before a run is registered or acknowledged, and again at context creation for a session created in between | `be:224-231`, `ih:596-617` |
| Over HTTP the action route answers both as `404 Unknown session "<id>"` | `ac:278-280` |
| A refused request leaves the session as it was: not in its snapshot or stream, not its `latestRequestId`, and its `updatedAt` does not move | `bi:300-326` **[test]** |
| "Moving" a session means creating a new one. The CLI says so: `use a new session id` | `fp:198-202` |
| It is an integrity check, not an identity check: it holds the identity the resolver supplied once the session exists | **[doc]** `adoc:517-522` |
| A session belongs to one flow instance as well. A different instance reaching it is refused `409` (`wrong-instance-session` / `wrong-instance-request`), naming neither owner | `be:310-333`, `ac:288-305` |
| A request id another principal holds is refused with `RequestOwnerMismatchError` (message names the id only). The action route turns the race into `409 request-id-in-use`, and a plain collision into a request of the caller's own (above) | `be:344-352`, `ac:283-287`, `request-id-owner-fence.test.ts:266` **[test]** |
| Through MCP the same check applies: an action cannot run against another principal's session state, even when the session id is chosen by the client | **[doc]** `mdoc:329-332` |

Errors named on the page are failure shapes; the concept page keeps only "a session belongs to one user and one organization". Whether the error classes themselves appear on the Reference page is a call for the page; the status and message shapes are the observable part.

## Table 9: Tenant isolation

| Fact | Cite |
| --- | --- |
| The tenant comes from the `x-tenant-id` request header (`DEFAULT_TENANT_ID_HEADER`). An absent or empty header means no tenant | `ru:58`, `ru:76-80` |
| The header name is configurable only on `createFlowApiRouter({ tenantIdHeader })`. `createFlowState` has no such option, so a `createFlowState` app uses `x-tenant-id` | `createFlowApiRouter.ts:97-104`; `flowstate/types.ts` (no match for `tenantIdHeader`) **[source]**. **[doc]** `sdoc:509` says the same |
| A tenant id containing `:` is refused `400` (`Tenant id must not contain ":"`) | `ru:81-85`, `trt:144-148` **[test]** |
| With a tenant, the session is stored under `<tenantId>:<sessionId>`. The same session id under two tenants is two records, with two states and two sets of session-scoped resources. The id the API returns is always the bare id | `sk:230-249`, `sk:255-267`, `trt:74-90` **[test]** |
| A session lookup under the wrong or a missing tenant header is `404`, including the crafted probe (no header, a session id of `<tenant>:<id>`) | `ru:96-108`, `trt:92-110` **[test]** |
| A mutating route under the wrong tenant does nothing: a `DELETE` with no tenant header leaves the tenant's session in place | `trt:129-142` **[test]** |
| Listings are scoped to the header's tenant, with bare ids | `trt:112-127` **[test]** |
| Retry and continue of another tenant's request answer `404` | `trt:155-200` **[test]** |
| A record with no tenant matches only a request with no tenant; `undefined` and absent are the same | `sk:268-298` |
| The tenant is on `ctx.request.identity.tenantId` and `ctx.session.identity.tenantId` in a block | `packages/engine/test/tenant-id-context.test.ts:52-69` **[test]** |
| Isolated by tenant: session (record, state, session-scoped resources) and request (history, listing). Not isolated: user and org scopes, shared across tenants. To isolate those, put the tenant in the id you pass | **[doc]** `pdoc:258-267`, `sdoc:511-519` |
| With no header, a session keys on its own id alone | **[doc]** `sdoc:523` |
| **The header is not checked against the principal.** The resolver returns a user and organization; nothing compares the tenant to either. The tenant must come from something you trust, such as your gateway or a fetch wrapper | `ru:76-90`, `ra:51-59` (the guard's context carries `tenantId` from the request; the principal has no tenant field, `au:89-92`) **[source]**. **[doc]** `sdoc:509` ("Set it from your gateway, or from your client's `fetch` wrapper") |
| A push topic is `{ scope, id, tenantId, resource? }` with `tenantId` always present (`""` for a single-tenant app), so no tenant hears another's notices | **[doc]** `pdoc:338`; `pd:158-170` **[source]** (`tenantId = ctx.tenantId ?? ""`) |
| The client has no tenant option; the header is added through `fetcher` | `grep` found no `tenantId` or `x-tenant-id` in `packages/client/src`; `packages/client/src/client.ts:79` (`fetcher`) |

## Table 10: Sharing resolvers across flows

| Fact | Cite |
| --- | --- |
| A resolver is per flow, by design: flows differ (one public, one private). Flows that share auth share a constant: `const sessionResolver: ResolvePrincipalFn = ...` and `authentication: { resolvePrincipal: sessionResolver }` in each | **[doc]** `adoc:308-324` |
| Two flows that declare the same resource key at the same scope must agree on their resolver, compared **by function identity** (`!==`). Different functions, even identical bodies, disagree. Disagreement answers `409 declarations_disagree`: `Resource "<key>" at <scope> scope is declared by flows "<a>" and "<b>" with different sign-in resolvers, so there is no one caller to read or write it as. Give both flows one resolver.` It covers a read and a send, and the default write flow reaches the same verdict | `sa:181-206`, `rbs:164-177` **[test]**, `rbs:196-212` **[test]** |
| The same rule applies to `requireUser` and `defaultUserId`: two declaring flows with different settings answer `409`  | `sa:207-218` |
| The `409` reaches only a caller signed in to some declaring flow. A caller any declaring flow's resolver refuses, or who resolves only to each flow's `defaultUserId`, gets `404 unknown_resource` (`Unknown resource "<key>" at <scope> scope`) | `sa:236-238`, `sa:327-338` **[source]** |
| When the declaring flows resolve one request to different users or orgs, the answer is `500 resolver_disagreement` | `sa:347-357` **[source]** |
| It also applies to the resource's `client`, `runBy` and `canWrite` settings (not an auth fact; a neighbour) | `sa:219-227` |
| One declaring flow with its own resolver and another on the host fallback disagree. Two where one names the host's resolver itself and the other falls back to it agree | `rbs:196-212`, `rbs:179-195` **[test]** |
| The flow that governs a stored record is the owner it names, not the one in the URL. A session created through `review-east` is checked by `review-east`'s resolver on every later read | `ra:314-358`, `ra:462-520`, **[doc]** `adoc:421-425` |
| A session's request history stays with its owning flow: its request list, state with items and stream show only requests that flow ran, and conversation history sent to the model is built from those | **[doc]** `adoc:437-443`. I did not re-derive this from the code; pass 5 should check it before the page repeats it |
| Isolation of user/org state per flow (`isolateUserState`) is where data is filed, not who may act; it does not stand in for the resolver | **[doc]** `adoc:547-559`. It belongs on the state or flow-isolation page, not this one |

## Table 11: The network guard

| Fact | Cite |
| --- | --- |
| A flow is unauthenticated when the resolver its routes would pick (`pk`) is the framework default that trusts `body.userId`. The check does not judge whether a custom resolver verifies anything | `na:38-58` |
| `fsdev serve` and `fsdev dev` on a non-loopback host refuse to bind, exit code `3` (a `CliError` with `EXIT_CONFIG_ERROR` wrapping the guard failure), while any served flow is unauthenticated. The three ways out: configure `authentication.resolvePrincipal` on the flow (or `createFlowState({ resolvePrincipal })`), bind a loopback host, or pass `--allow-unauthenticated` | `na:51-58`, `packages/node/src/bind-guard.ts:83-88`, `packages/fsdev/src/commands/serve.ts:109`, `packages/fsdev/src/commands/dev.ts:131,238`. CLI detail: the existing `apps/docs/docs/api/cli.md` and `cdoc` carry it |
| `@flow-state-dev/node`'s `serve()` runs the same check at bind (loopback exempt) and rejects with an `Error` naming the unauthenticated flow kinds, with no exit code (`packages/node/src/bind-guard.ts:62-80`); it also runs a per-request guard when the host is not loopback | `packages/node/src/serve.ts:193-198` |
| The Next, Vercel and AWS Lambda handlers apply the per-request guard on **every** call: an unauthenticated app answers `500 { "error": "Internal server error" }`, with the real message logged once, and the answer is not cached, so a flow registered later is seen. `allowUnauthenticated: true` is the override | `na:62-85`, `packages/next/src/createNextHandler.ts:45-52`, `packages/vercel/src/handler.ts:67`, `packages/node/src/aws-lambda.ts:27,39` |
| The guard is independent of `NODE_ENV`: an unset environment is how Lambda serves | `na:63-66` |

## Table 12: Who a terminal run is (`fsdev run`, `fsdev chat`)

The CLI page keeps the flags and exit codes. These are the authentication rows.

| Fact | Cite |
| --- | --- |
| The CLI asks the app's own resolution (flow's resolver before the host's, the user fallback, the organization rules): the same answer an HTTP request would get, with `source: "cli"`, no `request`, and `metadata.body` = `{ userId, input }` | `ih:381-428`, `ipp:68-118` **[test]**, `ipp:146` **[test]** |
| With no resolver anywhere, or no config at all: user `devuser` (`DEFAULT_LOCAL_USER_ID`), organization `DEFAULT_ORG_ID` (printed as `__fsd_default_org__`) | `au:41-47`, `fp:25-31`, `ipp:94-109` **[test]**. **[doc]** `cdoc:135-137` |
| A resolver that checks a credential refuses the terminal, because the CLI carries none. The run stops before writing anything, exit `2`: `Flow "<f>" refused this terminal: <reason>` and a second line pointing at `--org` | `fp:146-153`, `ipp:131-144` **[test]** |
| `--org <id>` skips the resolver and runs as `--user`, or `devuser`. It must be a valid organization id and not `DEFAULT_ORG_ID`, else exit `2` | `fp:85-101,139-142` |
| `--user <id>` alone asks the resolver as usual, keeps its organization, and replaces only the user. Blank is exit `2` | `fp:98-100,155-159` |
| A flow instance created with `ownerPin: { orgId, userId? }` (type `InstanceOwnerPin`, exported from `@flow-state-dev/core`) refuses any identity outside the pin, before anything is written. With no `userId` in the pin, every user in `orgId` passes. The pin is set in code: the `ownerPin` instance option when the instance is minted (copied onto the instance, `df:1414`), or the flow registry's `register(flow, { pin })` (`createFlowRegistry` is exported from `@flow-state-dev/engine`, `packages/engine/src/index.ts:32`). Never parsed from the address or the caller | `fp:103-130`, `packages/core/src/types/flow.ts:704-721,765-770`, `packages/core/src/flow/defineFlow.ts:1414`, `packages/engine/src/registry/flow-registry.ts:103-108,298-300`, `packages/engine/src/context/instance-pin.ts:1-9,52-72` **[source]** |
| A session keeps the user and organization it was created with. Resuming it as anyone else is refused, exit `2` for `run` | `fp:188-203` |
| `fsdev chat` asks per turn, for that turn's flow. A refusal fails that turn only; the next turn asks again. An owner mismatch on the chat session rotates to a fresh session | `cl:163-188` |
| A flow `authentication` on the CLI path: the same `PrincipalResolutionError`s a request would get, unchanged, so a resolver that refuses an HTTP caller with no credential refuses the CLI | `ih:393-396` |

## Table 13: Subscription authorization and connection lifetime

`client.subscribe` is "hear that something changed, then read again". It is checked at the mint, not by reading rows.

| Fact | Cite |
| --- | --- |
| A mint is `POST /users/:userId/stream` with `{ topics }`, at most 100 topics (`PUSH_MINT_MAX_TOPICS`, `packages/contracts/src/types/push-delivery.ts:31`; re-exported only from `@flow-state-dev/core/internal`, so the page gives the number, not the name). The path's user must be the caller (a user-addressed route). The answer carries a signed ticket, valid 30 seconds, and the granted topics | `ra:253-257`, `pd:129-144,177-212`, `packages/engine/src/push/ticket.ts:21` |
| A session topic is checked with the session stream's check, on that request. A session the caller may not read is dropped, as one that does not exist is. A session replaced between the check and the grant is dropped too | `pd:148-160`, `pdt:270-277` **[test]** |
| A user topic or an org topic names no id: it resolves to the verified caller's own user or organization. In an app where some flow authenticates, an anonymous caller gets neither | `pd:162-168`, `pdt:279-295` **[test]** |
| The credentials that prove who the socket is come through the client's `fetcher` (a bearer header or a cookie), because the mint goes through it | `ph:9-14` |
| A topic that was refused is asked for again each `pollIntervalMs` tick. Without `pollIntervalMs` it is asked for again on reconnect | `ph:15-22` |
| Access is not re-checked while a socket is open. A read the caller may no longer make is refused when they read; a notice still says something changed, never what | `ss:12-16` (**[source]**; the "notices never carry rows" part: `pdoc:338`) |
| The server closes every socket at most an hour after it opened (close code `4000`); the client mints again, and the mint checks again | `ss:14-16,37-40` |
| A socket with no valid ticket in 5 seconds is closed | `ss:37-38` |

## Table 14: Scheduled and cron authentication

| Fact | Cite |
| --- | --- |
| Vercel Cron calls the cron route with `Authorization: Bearer <CRON_SECRET>`. A missing or wrong secret answers `401`, and the tick calls nothing | `vs:55-56,75-80`, `vst:48-62` **[test]** |
| The cron route compares in constant time and refuses every call while the configured secret is empty, so an unset `CRON_SECRET` never opens it. The page states the refusal and not the constant-time compare | `vs:72-80`, `vst:64-73` **[test]** |
| The secret defaults to `process.env.CRON_SECRET`, read on each call. `vercelScheduler({ secret })` overrides it | `vs:24-28,55`, `vst:104` **[test]** |
| Each fire the tick sends to the dispatch endpoint carries the same secret | `vs:25-26,61` |
| The dispatch endpoint runs the resolver before it reads the fire record, so an unauthenticated POST learns nothing about fired times or duplicates | `sr:68-95` (the comment says this) |
| Wrong or missing secret on the dispatch endpoint answers `401`. A missing secret is refused by the user check or the organization check, whichever the flow's `defaultUserId` leads to; the page does not say which | `e2e:232-262` **[test]**, `ih:317-351` |
| The Vercel cron route answers a wrong or missing secret `401` with the plain body `Unauthorized` (not the JSON refusal) | `vs:55-56` |
| The dispatch response body for a refusal is `{ error: "unauthorized", message }` | `sr:88-94` |
| `createBearerSecretPrincipalResolver` reads its secret when it is built, so an unset `CRON_SECRET` passed to it fails at startup (throws), not on the first request | `bs:58`, `as:4-8`, `bst:130` **[test]** |
| `principal` on the bearer helper is who a scheduled run belongs to unless the schedule names its own principal; a schedule's own `principal` wins for the user, and its `orgId` falls back to the caller's | `sr:176-200` **[source]**. The schedule fields themselves are R-33 |
| A resolver can accept the bearer secret for scheduled calls only by branching on `context.source === "scheduled"` (`context` is the resolver's argument, `au:139-145`) | `sr:73`, `packages/engine/src/execution/transport-sources.ts:22`, `bst:20-26` (builds a `scheduled` context) |
| A scheduled handler is not reachable through the action surface or the flow's action list. The only door is the dispatch endpoint | `e2e:180-205` **[test]** |
| A holder of the secret can fire any schedule the resolver accepts. Rotating the secret is changing the environment variable and redeploying | `vs:55` (read on each call: a redeploy picks up the new value); the "any schedule" half **[source]**: the secret yields a fixed principal for the whole dispatch route. No test says "rotate". The rotation sentence is advice, not behaviour; carry the first half only |

## The four questions for each stored part

The page does not own storage, but its subject is who a record belongs to. For each stored part the page names:

| Stored part | Who owns it | Who can see it | Where it is stored | How many |
| --- | --- | --- | --- | --- |
| A session's binding: `userId`, `orgId`, `tenantId`, owning flow instance (`flowId`) | The framework writes it at creation from the resolved principal and the header. The caller does not set it | The resolved principal whose `userId` and `orgId` equal it, within the same tenant. Anyone else gets `404` (another user), `403` (same user, other organization), `404` (other tenant) | The session record in the configured store. SQLite has `user_id`, `org_id`, `tenant_id`, `flow_id` columns on `sessions`; the in-memory and filesystem stores hold the same fields. `packages/store-sqlite/src/schema.ts:18-20,32-34`, `packages/engine/src/stores/types.ts:35-70` | One per session. With a tenant, one per `(tenant, session id)` |
| A request record's binding: `userId`, `orgId`, `tenantId` | The framework, from the principal | The principal that created it. Another user's or organization's request answers as an unused id | The request store; SQLite `requests` columns `user_id`, `org_id`, `tenant_id`. `packages/store-sqlite/src/request-store.ts:154` | One per request |
| The tenant namespace on a session key | The deployment, through whatever sets the header | Anyone who can send the header value; it is not verified against the principal | In the session record's key (`<tenant>:<id>`) and `tenant_id` | One namespace per distinct header value |
| `DEFAULT_ORG_ID` on records | The framework, only when no resolver is configured | Anyone, in the unauthenticated case; it is not a boundary | On every record the unauthenticated app writes | Every record of an unauthenticated app |
| The push ticket and push secret | The host (`enablePushDelivery`, a secret read on use) | Signed to the caller who minted it, valid 30 seconds | Not stored: signed and verified, not persisted | One per mint |

The ticket row names an internal setup call; the page may skip it. Its observable parts are the 30-second ticket, the one-hour socket and the re-check on reconnect, all above.

## Contradictions: code against the existing page

1. `adoc:129-131` says a resolver may "return `null` to fall through to `defaultUserId`". With a configured resolver the request is refused for want of an organization. Code: `ih:260-265`, `pfr:84-101` **[test]**. The page must say `{ orgId }` alone, with `defaultUserId`.
2. `adoc:122` and `adoc:204-206` give `401` for a request with no `userId`. On the action route the refusal is `400`: `ac:121-125`, `hat:227` **[test]**. A management route answers `401`.
3. `adoc:207`, "A resolver returning null ... `requireUser: true` ... the framework rejects with 401": true for the user check; if the resolver also lacks an organization, the message names whichever is checked first (the user).
4. `adoc:7-10` calls the `userId` "authoritative" and says verification is "your application's job", typically middleware ahead of the handler. With a resolver configured, the framework reads identity from the resolver, not the body. The sentence is a framing, not a contract; carry the resolver contract instead.
5. `adoc:41-46` lists "Identity source" as one of "Two checks" (it is a third item, and it is not a check). A numbering slip on the old page; not a fact.
6. `adoc:18-20` compares the trust model to named frameworks. Not a fact about this one; outsider rule says cut.

## Disposition of the rows other pages' depth passes moved to R-20

I read the rows with the command in the brief (31 matching lines, from `start/add-to-an-existing-app`, `concepts/auth-and-tenancy`, `concepts/serving-flows`, `concepts/what-the-browser-sees`, `concepts/state-and-scopes`, `concepts/sessions-items-and-streaming`, `concepts/how-it-fits-together`, `reference/schedules`, `reference/cli`, `reference/glossary`, `build/schedules/vercel-cron`, `build/deploy/aws-lambda`, `build/live-updates`, `build/chat-from-the-terminal`, `build/mcp-server`). The text of each row is quoted in short. Each is carried (and where) or dropped (and why).

**Carried, verified true:**

- "Caller identity: a request with no `userId` is refused; with no sign-in configured the server trusts the `userId` the request carries" (and the near-duplicate "`userId` sent by the client is a claim") → Table 2 steps 4-5, Table 7 "Without a resolver". Carry with the correction that the action route answers `400`, not `401`, for "no `userId`".
- "Resolution order row: with no `authentication`, `userId` is read from the request body (development only)" → Table 2 step 2 and Table 7.
- "`requireUser`: default true; checks only that the request resolved to a user id" → Table 3.
- "Organization source: resolver only; a resolver returning no organization gives 401; with no resolver, `DEFAULT_ORG_ID`" → Table 4.
- "`createBearerSecretPrincipalResolver`: options..." (corrected by pass 5) → Table 6. Every sub-claim checks: `secret` and `principal.userId` non-empty or it throws when built; `headerName` default `authorization`; constant-time compare; `401` "Invalid scheduler secret."; missing header or non-Bearer returns no principal, so `401` unless... **The clause "unless `authentication.defaultUserId` is set" is false** (see dropped list); carried without it. One secret to one principal: `bs:10-14`.
- "Ownership check by route, on the management routes" (corrected by pass 5) → Table 7. All four answers verified: no credential `401`; another user's session `404 Unknown session "s1"`; own session under another organization `403 Caller's organization does not own the requested resource`; matching `200`. The request-addressed and file-read clause and the action-POST clause both verified (`ra:629-641`, `ac:278-280`).
- "A session owned by someone else answers exactly as an unused id (404)" → Table 7.
- "Session consistency check: a session's user and organization are fixed at creation; a request under a different identity is refused before any write" (three near-duplicate rows) → Table 8. The row that names `OrgBindingMismatchError` is carried as a failure shape, per its own note.
- "Session consistency check: a request naming a session that belongs to another user is answered as not found, and no block runs" → Table 7 and 8: the action route refuses at admission, before any block (`ac:278-280`, `ih:596-617`, `bi:54-81`). The lookup answer it points at is the "What is checked when a session id is sent?" lookup, Table 7.
- "Resolution order and the no-resolver default: `userId` read from the body, reads and listings unscoped, an existing session still refuses a different user" → Table 7 "Without a resolver".
- "Tenant isolation: `x-tenant-id` header scopes session ids; ... wrong or missing tenant gives 404; no header means no split" → Table 9.
- "Tenant header is not verified against the principal; it must be set by a trusted gateway" → Table 9, bold row. The "trusted gateway" advice is the existing doc's wording (`sdoc:509`), not a behaviour; the behaviour is that nothing compares them.
- "Resolver signature and resolution order: flow-level beats runtime-level; what the resolver receives when the caller is the CLI" → Tables 1-2 and 12.
- "Identity rows: development default user and organization, `DEFAULT_ORG_ID` refusal, owner-pinned flows, and the session consistency check when a session belongs to another user or org" → Tables 4, 8, 12.
- "Authentication row: the non-loopback bind guard and its three ways out" → Table 11.
- "Principal: fields, and the default development organization when `resolvePrincipal` is unset" → Tables 1 and 4.
- "Resolver construction: `createBearerSecretPrincipalResolver` reads its secret when built, so a missing `CRON_SECRET` fails at startup" → Table 14. `principal` is who a scheduled run belongs to, qualified: a schedule's own `principal` wins for the user (`sr:176-200`).
- "Scheduled handlers are reachable only through the dispatch endpoint; `ctx.source === "scheduled"` is the value a resolver branches on" → Table 14. The "only through the dispatch endpoint" half is the `e2e:180-205` test. The page text needs "the action surface does not list them", which is what the test shows.
- "Bearer-secret auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`; a wrong secret returns `401` from the cron route or the dispatch endpoint" → Table 14.
- "Cron and dispatch authentication: ... wrong or missing secret returns `401` from both; an unset secret makes the cron route refuse every call and `createBearerSecretPrincipalResolver` throw at load; rotating means changing the variable and redeploying" → Table 14. Carried, with the rotation clause marked as advice.
- "Where the secret is checked: the cron route (401, calls nothing onward) and the dispatch endpoint (resolver runs before anything else is read ...); a holder of the secret can fire any schedule the resolver accepts" → Table 14. The "resolver runs before anything else is read" is slightly wide: the route validates the id, flow and body first (`sr:55-67`); what it does not do is read the fire record. The dispatch comment says exactly "before anything reads the fire record". Carry "before it looks at any earlier fire", not "before anything else is read".
- "Resolver row: with no resolver configured, the caller's `userId` is taken from the request body and is not verified" → Table 7, and Table 11 for the guard.
- "13. Subscription authorization ..." (corrected by pass 5) → Table 13. All sub-claims verified, including that the omitted topic is asked for again each `pollIntervalMs` tick.
- "Connection lifetime: access is not rechecked while open ...; server closes every connection after one hour; the reconnect rechecks" → Table 13. "At most an hour" is the code's wording (`ss:14`), not "after one hour exactly".
- "Who a chat turn runs as: resolver asked once per turn per flow, the no-resolver default, what happens when a resolver refuses the CLI (that turn fails, chat continues), and `--org` to get past it" → Table 12. "Per turn, for that turn's target flow" is the accurate wording.
- "Session-consistency row: the stored session's owner must match the caller, so an action cannot run against another principal's session state; principal still comes from `resolvePrincipal`" (MCP) → Table 8 last row.

**Dropped:**

- "`defaultUserId` and scheduled calls: a request with no `Authorization` header runs as the default user; a wrong secret is still `401`." **Dropped: false.** The bearer helper returns `null` for a missing header, a configured resolver that yields no organization is refused `401` (the organization is never filled by `defaultUserId`), so the request does not run. `ih:260-265`, `pfr:84-101` **[test]**, `e2e:232-246` **[test]** (the same call answers `401`). A resolver that returns `{ orgId }` for a missing header would run as the default user; the bearer helper does not. The corrected sentence belongs in Table 6: no header means `401`. The same false clause sits in the `createBearerSecretPrincipalResolver` row ("`401` ... unless `authentication.defaultUserId` is set") and is dropped from it.

Nothing else is dropped in full. Sub-claims set aside: none beyond the ones named above.

## Left out on purpose

- **Cross-flow schema compatibility** (`CrossFlowSchemaConflictError`, `isolateUserState`, `isolateOrgState`): `adoc:528-559`. It is about state declarations, not who a caller is. It belongs to the state or flow-isolation reference. Not carried.
- **How to write a Stripe, JWT or webhook resolver** (the three patterns, `adoc:184-306`): examples, not rows. They belong in recipes and the webhook and MCP pages. The signatures they use are in Table 6.
- **Calling a flow without a transport** (`runAction` with `userId`, `orgId`): `adoc:87-99`. Its failure shape is `OrgRequiredError` (`er:35-48`). A row if the page wants it, with the example from the existing page; I list it in Table 4 only.
- **Debug endpoints, `debugAllowAnonymousLocal`**: `apps/docs/docs/configuration/runtime.md:53`. The runtime-options reference owns them.
- **`WWW-Authenticate` on MCP refusals, MCP route details**: a MCP-reference row, noted in Table 1.
- Why the framework has the rules it has (design history): not on the sheet; none observable.
- How `routeSubject` classifies each route, the `pendingDenial` ordering, and the incarnation checks the handlers do after the guard: mechanism. The page keeps the answers (Table 7), not the machinery.
- The existing page's cut-in claim "A request stream resumed from a cursor ... answers an empty `200`" is carried in Table 7; the reasoning given for it is not.

## Open for pass 5 (checks I could not finish from here)

- `createHmacVerifier` option names and defaults (`adoc:252-255`) were not re-derived from source.
- The existing page's "a session's request history keeps to its owning flow" (`adoc:437-443`) is not re-derived.
- Whether the `409` on session creation is the same for another user's session as for one's own (`adoc:364-365`): the test shows `409` for an existing id only.
- `GET /api/flows/active-requests` with a flow-level resolver: stated by `adoc:401-407` and `ra:66-90`; no test line was cited.

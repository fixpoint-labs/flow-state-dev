# Facts for Auth and tenancy (C-17, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, and one example. No spec is cited. The page plan's Sources line names `server/authentication`, `fundamentals/state-and-scopes` and `advanced/flow-isolation`; all three are existing user docs and are cited below. Nothing here was run for this sheet; behaviour is cited to tests and doc comments.

Paths are from the repo root. Abbreviations:

- `auth` = `apps/docs/docs/server/authentication.md`
- `sas` = `apps/docs/docs/fundamentals/state-and-scopes.md`
- `iso` = `apps/docs/docs/advanced/flow-isolation.md`
- `pers` = `apps/docs/docs/persistence/overview.md`
- `coreAuth` = `packages/core/src/types/auth.ts`
- `eng` = `packages/engine/src`, `engT` = `packages/engine/test`
- `kb` = `examples/knowledge-base/src/flow.ts` (the one example that uses `createBearerSecretPrincipalResolver`)

Legend: **[page]** the page states it. **[ref]** it belongs on a Reference page (`reference/authentication`, `reference/flows`, `reference/persistence`); the page links, does not state it. **[old wrong]** an existing page says it and the code says otherwise; do not copy. **[flag]** a gap or a contradiction in the sitemap entry for the caller to settle.

The page's cast is the support desk: a `support` flow with a `reply` action. Users `alice` and `bob`; organizations `acme` and `globex`. The page chooses these names; the code does not name them, though `alice`/`bob`/`acme`/`globex` are the names the existing tests and docs use (`engT/management-route-auth.test.ts:207-231`, `engT/org-boundary-routes.test.ts:184-198`, `auth:371-374`).

## 1. Does Flow State log users in? Who is responsible for what

- The framework does not log users in. It "does not store secrets, run OAuth, or look up users in your database. That stays on your side." `auth:12-15`; `auth:564-570` ("What the framework does not do": store credentials, OAuth tokens or webhook secrets; implement RS256/ES256 JWT verification; run an OAuth provider; verify that a `userId` belongs to the caller). [page: the answer to question 1]
- The `userId` the app supplies is treated as authoritative; verifying it belongs to the caller is the app's job. `auth:7-10`. `coreAuth:73-77` (doc comment on `ResolvedPrincipal`: "The runtime treats the `userId` here as authoritative for state-scope routing, and the `orgId` as the authoritative organization boundary"). [page]
- App's job: verify the credential the transport carries (session cookie, JWT, signed webhook header) and produce a `userId` and an `orgId`; reject a missing or invalid credential, or throw `PrincipalResolutionError` from inside the resolver. `auth:22-29`. [page]
- Framework's job: check that the identity attached to a request is consistent with what is stored. `auth:31-33`. Concretely: the session binding check (section 5), schema compatibility at startup (`auth:38-40`, section 7), and "identity source" (the user and org an action runs under come from the resolver, section 3). [page: the two checks a reader can observe, session binding and identity source; schema compatibility is [ref]]
- The framework "does not, and cannot, verify that `userId: A` actually belongs to whoever sent the request." `auth:48-50`. [page, flat]
- The word the framework uses for the attached identity is a **principal**: "the caller identity the runtime keys state, resources, and request records by." `auth:12-15`. `coreAuth:73-92` (`ResolvedPrincipal { userId: string; orgId: string }`). [page: define on first use]
- [old wrong] `auth:31-33` says "Two checks" and then lists three bullets (session binding, schema compatibility, identity source). Do not copy the count; the page does not announce one (user-docs tells table, "Counted preamble").
- [old wrong] `auth:16-19` ("the same trust model Mastra, LangGraph, and other application-layer frameworks use") compares products by name. The page does not.

## 2. Every request has a user and an organization

- "There is no such thing as a request without" an organization. A session, a request, a dispatched child and a scheduled job each carry one; the server checks it on reads and on execution alongside the user. `auth:52-56`. `coreAuth:26-28`. [page]
- The organization comes from one of two places and never from the caller: a configured resolver's verified principal, or `DEFAULT_ORG_ID` when no resolver is configured. `auth:58-69`; `coreAuth:79-83` ("A caller-supplied organization never reaches this type"). [page]
- A configured resolver that returns no organization, a blank one, one that is not well-formed Unicode, or the reserved default is refused with 401. Returning `null` is refused too: `defaultUserId` "supplies a user and never an organization". `auth:60-64`; `coreAuth:122-134`; `engT/transports/org-principal-matrix.test.ts:147-189` (user but no org; whitespace-only org; reserved default; `null` from a configured resolver, each rejects with `PrincipalResolutionError`). [page one sentence; the full list of refusals is [ref] `reference/authentication`]
- `DEFAULT_ORG_ID` is exported from `@flow-state-dev/core`. Its value is `"__fsd_default_org__"`. `coreAuth:39`; `packages/core/src/index.ts:52`. It is "a development and system-wiring identity, not a security boundary"; a configured resolver cannot claim it. `coreAuth:31-34`; `auth:73-75`. [page: name it once, say it is for running one organization without authentication; the literal value is [ref]]
- With no resolver configured, the framework supplies `DEFAULT_ORG_ID` and warns once per host, not once per request. `auth:65-67`; `engT/transports/org-principal-matrix.test.ts:81-116` (supplies `DEFAULT_ORG_ID`; ignores a body `orgId`; warns once). [ref]
- Any string is a valid organization id except an empty one, a whitespace-only one, or one with a lone UTF-16 surrogate; those are rejected, not trimmed or repaired; every other string is stored exactly as given. `auth:100-106`; `coreAuth:49-70` (`isValidOrgId`, exported from `@flow-state-dev/core`, `packages/core/src/index.ts:52`). [ref]
- A session's organization, like its user, is fixed when the session is created. Reopening cannot move it. `auth:107-108`. [page, in "What it checks"]
- A machine caller with no end user returns `{ orgId }` from its resolver and lets `defaultUserId` name the system user: `resolvePrincipal: async (ctx) => ({ orgId: await verifyServiceToken(ctx) }), defaultUserId: "system"`. `auth:76-87`; `engT/transports/org-principal-matrix.test.ts:191-205` (resolver returns only `orgId`; `userId` comes from `defaultUserId`); `engT/transports/per-flow-resolver.test.ts:102-111` (`{ userId: "system", orgId: "acme" }`). [page, one sentence, in "Telling the framework who is calling"]
- A caller that runs the runtime directly, below any transport, passes `userId` and `orgId` to `runAction` itself. `auth:89-99`. [ref] `reference/authentication`; the page links `advanced/manual-flow-execution`.
- Records stored before an organization was required can carry none; an authenticated caller who addresses one gets `409 migration-required`, an unidentified caller gets the ordinary 401. `auth:110-116`; `engT/org-boundary-routes.test.ts:331-362`. [ref]
- Unit of "tenant" versus "organization" is not the same thing: see section 6. [flag] The sitemap's second figure ("Organizations, users, tenants", nested boxes) needs the exact nesting; section 6 gives what each boundary splits.

## 3. Telling the framework who is calling

The hook.

- A flow declares `authentication` in `defineFlow`. Its fields: `resolvePrincipal`, `defaultUserId`, `requireUser`. `coreAuth:170-192` (`AuthenticationConfig`); `auth:139-168`. [page]
- `resolvePrincipal` is called once per inbound request, after the transport adapter builds the context. It returns a principal, a partial `{ userId?, orgId? }`, or `null`. `coreAuth:122-145,170-177`. [page]
- The context it receives: `source` (an open string; documented values `http`, `mcp`, `webhook`, `scheduled`, `notification`; `cli` is the value `fsdev run` and `fsdev chat` send), `request` (present for HTTP-shaped transports), `envelope` (`flowKind`, `action`, optional `sessionId`, optional `metadata`, `input`) and `rawBody` (HTTP bytes kept for signature checks). `coreAuth:14-19,94-118`; `auth:146-150`. [page: `request` only; the rest is [ref]]
- A resolver can throw `PrincipalResolutionError` (from `@flow-state-dev/engine`) to choose the HTTP status: 401 for an invalid signature, 403 for a valid signature on a forbidden resource. `coreAuth:135-137`; `auth:163-167`. [page one sentence; error shape [ref]]
- Resolution order (per-flow resolver wins over the host-level `resolvePrincipal` option of `createFlowState`; `defaultUserId` fills a missing user; still no user with `requireUser !== false` gives 401). `auth:170-182`; `engT/transports/per-flow-resolver.test.ts:100-150`. [ref] `reference/authentication` (the sitemap says resolution order is Reference).
- Sharing one resolver across flows: pull it into a constant of type `ResolvePrincipalFn`. `auth:308-324`. [ref]
- Host-level fallback: `createFlowState({ resolvePrincipal })` is used for a flow with no resolver of its own; a per-flow resolver always wins. `auth:326-338`. [ref]

Example: a resolver from the session cookie.

- Shape (existing docs): `resolvePrincipal: async ({ request }) => { const session = await getSession(request); if (session === null) return null; return { userId: session.user.id, orgId: session.user.orgId }; }`. `auth:186-203`. Returning `null` on a `requireUser: true` flow rejects with 401; "the browser client sees a clean `Unauthorized` response". `auth:203-207`; `engT/transports/per-flow-resolver.test.ts:113-122`. [page]
- [flag] `getSession` (`auth:188`) and `readSession` (`auth:150`) are the app's own helpers; neither is exported by the framework. The page must declare or import one from an app path (`../lib/session`) and say what it is in a clause (examples rule: no phantom names).
- [flag] `auth:149-153` shows `if (session === null) return null; return { userId: session.userId, orgId: session.orgId }`; the cookie example above carries the same shape. One of the two is enough.
- Also exercised in a test: `resolvePrincipal` reading a verified header and returning `{ userId: "user-a", orgId: token }`, or `null` when the header is absent. `engT/principal-org-spoofing.test.ts:49-63`. [ref]

Example: `requireUser: true`.

- `requireUser: true` is the default. It means the request must produce some `userId` after the resolver and the `defaultUserId` fallback have run; with none, the framework rejects with 401. `auth:118-122`; `coreAuth:185-191`; `engT/transports/per-flow-resolver.test.ts:113-122`. [page]
- It is "a presence check, not an authentication check": a resolver that returns `{ userId: "anyone" }` for every caller still satisfies it. `auth:124-129`. [page, this is the load-bearing limit]
- To enforce real identity, do it in `resolvePrincipal`: throw `PrincipalResolutionError` for a bad credential, return `null`, or look the user up in your own store before returning it. `auth:131-134`. [page]
- `requireUser: false` opts a flow out of user-scope identity. The framework refuses to compile a flow that declares user-scope state, resources, or a `client` block while `requireUser: false`. For webhooks and scheduled jobs with no end user. `auth:136-138`; `coreAuth:162-165,185-191`. A `requireUser: false` flow with no `userId` and no `defaultUserId` fails with 500, a configuration mistake rather than a caller error. `engT/transports/per-flow-resolver.test.ts:124-137`. [ref] `reference/authentication`; the page may name `requireUser: false` in one clause.
- The example for this entry is `requireUser: true` inside `authentication`; since it is the default, the example's job is to show it beside a resolver. [flag] The sitemap's example "Require a user: `requireUser: true`" is the default. The page can show it as one line next to the resolver and say it is the default; the code does not need it written to take effect. `coreAuth:185-188` ("When `true` (default)").

Example: a shared-secret resolver for server callers.

- `createBearerSecretPrincipalResolver({ secret, principal, headerName? })` is exported from `@flow-state-dev/engine`. `eng/transports/auth/createBearerSecretPrincipalResolver.ts:28-45,54-56`; `eng/index.ts` re-export (listed by `grep` at `packages/engine/src/index.ts`, `packages/engine/src/transports/index.ts`). [page]
- Options: `secret` (non-empty string, compared in constant time), `principal` (a `ResolvedPrincipal`, "typically a system user"), `headerName` (default `"authorization"`, case-insensitive). `eng/transports/auth/createBearerSecretPrincipalResolver.ts:28-45`. [page: `secret` and `principal`; `headerName` is [ref]]
- On a matching `Authorization: Bearer <secret>` it returns the configured principal. `engT/transports/createBearerSecretPrincipalResolver.test.ts:30-37`. The `Bearer` scheme is case-insensitive (`bearer <secret>` also matches). `:39-46`. [page]
- On a mismatch it throws `PrincipalResolutionError` with status 401. `engT/transports/createBearerSecretPrincipalResolver.test.ts:75-87`; source `eng/transports/auth/createBearerSecretPrincipalResolver.ts:80-84`. [page]
- When the header is absent, or the scheme is not Bearer (`Basic ...`), it returns `null`, so the host applies `defaultUserId` if one is set. `engT/transports/createBearerSecretPrincipalResolver.test.ts:48-73`; `eng/transports/auth/createBearerSecretPrincipalResolver.ts:15-17,75-77`. [page: this is what "no credential" does; with `requireUser: true` and no `defaultUserId` it is the 401 above]
- A configured resolver that returns `null` is refused regardless of `defaultUserId`, because there is no organization (section 2). So the principal passed in must carry `orgId`; the tests build `{ userId: "system", orgId: DEFAULT_ORG_ID }`. `engT/transports/createBearerSecretPrincipalResolver.test.ts:12-16`. [flag] `DEFAULT_ORG_ID` in a configured resolver is refused (section 2, `coreAuth:127-129`); the test at `:12-16` only calls the resolver function directly, not through the host. The page's example passes a real org id (`orgId: "acme"`), as the example app does.
- It throws at construction when `secret` is empty or `principal.userId` is empty. `eng/transports/auth/createBearerSecretPrincipalResolver.ts:57-69`. [ref]
- A real use: `kb:168-173` builds the resolver only when `KB_MCP_SECRET` is set, because the factory throws on an empty secret, with `principal: { userId: "owner", orgId: "org_test" }`, `requireUser: true` and no `defaultUserId` ("a missing/invalid key denies rather than serving an anon principal"). `kb:161-174`. [page: the pattern of building it from an env var; do not copy `org_test`]
- The helper reads from the `Request` headers, or, on a non-HTTP transport, from `metadata.headers`. `eng/transports/auth/createBearerSecretPrincipalResolver.ts:90-111`. [ref]
- It checks one shared secret and returns one fixed principal: for per-tenant keys or OIDC the host writes `resolvePrincipal` itself. `eng/transports/auth/createBearerSecretPrincipalResolver.ts:10-13` (doc comment). [page one clause: when you outgrow it]
- Other verifiers that live beside it: `createHmacVerifier` (Stripe-style signature), `createHs256JwtVerifier`, `extractBearerToken`. `auth:209-306` (the Stripe and JWT patterns). HS256 only; RS256 and ES256 need JWKS and are not built in. `auth:303-306`, `auth:565`. [ref]

## 4. What the framework checks on a request

Ownership of what a URL names.

- A resolver configured on a flow covers the whole flow API, not only action calls: session reads and writes, session state, resource content, request control (stream, abort, resume, status) and the debug endpoints all resolve a principal first. `auth:348-355`. [page: state in a sentence]
- The framework checks the principal owns what the URL addressed. A session or request belongs to the `userId` it was created under. `auth:356-360`. [page]
- Alice asks for Bob's session by id: she gets `404`, the same answer as an id nobody has used, with body `{ error: 'Unknown session "s1"' }`. `auth:356-360,371-372`; `engT/management-route-auth.test.ts:218-232` ("denies an authenticated user another user's session": `bob` credential, session owned by `alice`, 404, `{ error: 'Unknown session "s1"' }`). [page: the answer to question 3]
- The 404 is deliberate so the answer does not say the id is in use. Stated as behaviour: another user's session, and another user's request, answer exactly as an id nobody has used. `auth:477-480`; `engT/management-route-auth.test.ts:224-228` (test comment). [page: state the behaviour; drop the "a 403 would tell the caller the id is in use" argument (design defense)]
- A write is refused the same way: Bob's `PATCH` to Alice's session resource content is `404` `Unknown session`. `engT/management-route-auth.test.ts:234-247`. [ref]
- An unknown session id on an authenticated flow is still `404`, not 401/403. `engT/management-route-auth.test.ts:249-260`. [ref]
- An anonymous read of a session on an authenticated flow is rejected (401). `engT/management-route-auth.test.ts:177-195`; `auth:368-370`. [page, in a four-line request table]
- The same user in two organizations: the session is stored with its organization, and a caller holding a valid credential for the right user but acting for a different organization gets `403`. `auth:361-375`; `engT/org-boundary-routes.test.ts:184-199` (`dana` in `acme`'s session, acting as `globex`: 403) and `:201-216` (same user in `acme`: 200). [page]
- Four-line table the existing page uses (page may reuse with its own names): no credential `-> 401`; `bob`'s credential, session belongs to `alice` `-> 404`; `alice`'s credential, session belongs to `acme`, `alice` acting for `globex` `-> 403`; `alice`'s, acting for `acme` `-> 200`. `auth:368-375`. [page]
- A request id is addressed the same way: another user's (or another organization's) request answers as an id nobody has used. For reads of a request stream resumed from a cursor (`starting_after` or `Last-Event-ID`) the answer for an unused id is an empty `200`, for someone else's request too. `auth:358-364,468-474`; `engT/org-boundary-routes.test.ts:254-286`. [ref]
- Ids are addresses, not secrets: nothing depends on them staying private, so ids need not be unguessable, and a client may generate its own. `auth:490-493`. [page one sentence, since question 3 invites "do I need to hide the id?"]
- Creating a session is the one write that shows an id is taken: `POST /api/flows/support/sessions` with a `sessionId` another user holds answers `409`, whoever holds it. `auth:366-367,481-488`. [ref]
- A client that sends the same `requestId` another user already holds still gets its own request, under an id the response gives in the `x-request-id` header; theirs is untouched. `auth:462-466`. [ref]
- Listings narrow to the caller instead of rejecting: `GET /api/flows/sessions` returns the caller's own sessions; a `userId` query parameter narrows the set and cannot widen it; an `orgId` query parameter cannot widen it either. `auth:378-386`; `engT/management-route-auth.test.ts:262-292`; `engT/org-boundary-routes.test.ts:288-330`. [ref]
- No endpoint on the flow API enumerates across owners. `auth:445-447`. [ref]

A body field never sets identity.

- A client sends another user's id in the body: when a resolver is configured, a `userId` in the body is ignored. `POST /api/flows/:flowId/sessions` takes the new session's `userId` from the principal: `bob`'s credential with body `{ userId: "alice" }` creates a session owned by `bob`, status 201. `auth:385-388`; `engT/management-route-auth.test.ts:327-340`. [page: the answer to question 2]
- An `orgId` in the body is never consulted, on session creation or on an action call. `auth:41-45,385-387`; `engT/management-route-auth.test.ts:342-355` (body `orgId: "org-y"`, credential org `org-x`; the session's org is `org-x`); `engT/principal-org-spoofing.test.ts:89-130` (action dispatch: `body.orgId` of `org-y` with a verified org of `org-x` runs under `org-x`, and a new session is bound to `org-x`). [page]
- If a caller should be able to name its own organization, the resolver reads it and checks it against the verified credential. The parsed body is on `ctx.envelope.metadata.body` for exactly that. `auth:42-47`. [ref] `reference/authentication`
- On the session-listing and other `GET` routes the resolver gets the `Request` and no parsed body; a resolver that reads `metadata.body` there gets `undefined`. `auth:494-500`. [ref]
- On an action call an app with no resolver reads `userId` from the request body. That default resolver is `defaultBodyUserIdPrincipalResolver`, exported from `@flow-state-dev/engine`; it reads `envelope.metadata.body`, else `envelope.input`, and returns `{ userId }` or `null`. `eng/transports/auth/defaultBodyUserIdPrincipalResolver.ts:22-44`; `engT/management-route-auth.test.ts:623-632` ("still takes the session owner from body.userId"). [page: one sentence; this is the development default and the reason the next two bullets exist]
- With no resolver, session reads, session listings and management endpoints stay open: a read serves the stored session, a listing returns every session, unscoped. `auth:390-396`; `engT/management-route-auth.test.ts:599-621`. `fsdev serve` refuses to bind a non-loopback host until flows have authentication configured. `auth:393-396`; `apps/docs/docs/api/cli.md:116-117` (`--host` default `127.0.0.1`; a non-loopback host runs the same check; `--allow-unauthenticated` binds anyway). [page: one sentence flagging dev-only; the flags are [ref]]
- Flows are checked independently. On a server where one flow configures a resolver and another does not, the second flow's sessions stay open. `auth:398-400`; `engT/management-route-auth.test.ts:634-645`. [ref]
- The two endpoints that span every flow (`GET /api/flows/sessions`, `GET /api/flows/active-requests`) need a host-level resolver to identify the caller for flows with no resolver of their own. `auth:402-408`. [ref]
- The flow that governs a read is the one stored as the record's owner, not one the caller names. A session created through `review-east` is checked by `review-east`'s resolver on every later read. `auth:411-420`. Address and stored owner must agree on action routes, else `409 wrong-instance-session` before any resolver. `auth:421-432`. [ref]

Session binding.

- A session is bound to one user and one organization when it is created, and both are immutable. A later request claiming another user is refused with `UserBindingMismatchError`, another organization with `OrgBindingMismatchError`. `auth:502-524`; `eng/context/binding-errors.ts:32-65` (both classes exported); `engT/binding-immutability.test.ts:54-81` (a session created for `alice`, then claimed as `bob`: `UserBindingMismatchError`), `:110-136` (created under `org_a`, then `org_b`: `OrgBindingMismatchError`), `:167-191` (the matching identity is admitted). [page]
- The user check runs before the org check. `engT/binding-immutability.test.ts:255-282`. [ref]
- It is thrown before the request is accepted, so nothing is written and no request exists to poll. Over HTTP the caller gets `404 Unknown session`; the error message names the session and never the owner. `auth:508-513`; `eng/context/binding-errors.ts:24-31` (doc comment). [page: "Nothing from it is written" is a guarantee; the status is [ref]]
- A refused request leaves the session as it was: it never shows in the session's snapshot or stream, it does not become `latestRequestId`. `auth:520-523`; `engT/binding-immutability.test.ts:284-360`. [ref]
- The check is structural, not an identity check: it guarantees that once a session belongs to `userId: A`, no request can route data through it under another identity, whether the mismatch came from a buggy client, a routing mistake or a stale cookie. Auth code guarantees the request represents `userId: A`. `auth:514-519`. [page: the guarantee; drop "stale cookie that drifted" colour if it does not earn a line]
- To "move" a session to another user or org, create a new session. `auth:524`. [page: one line, in the limits]
- Which case answers question 2 when **no resolver** is configured: the body `userId` is trusted at the action route (section 4), and the session binding is the remaining guard: a session created for `alice`, then claimed as `bob` in the body, is refused by the binding check. `engT/management-route-auth.test.ts:599-604` (comment: "These apps trust `body.userId` on the action path already ... The bind rail is their guard"); `engT/binding-immutability.test.ts:54-81`. [flag] The page's answer to question 2 has two cases. With a resolver, the body field is not read (identity comes from the credential). Without one, the body is the identity (a development default) and only the session binding stops a second claim on an existing session. The page should say so in two sentences and not blur them.

What a resolver does not protect (limits the page states flat).

- Isolation (below) "is about storage, not about permission": it decides where a flow's data is filed; it does not decide whether the caller may act as this user. `auth:555-560`; `iso:97` ("Isolation keeps flows out of each other's storage. It does not decide who is allowed to call your flow"). [page, one sentence, in "How it fits with the others"]

## 5. Tenants

What a tenant is and how it is sent.

- A tenant is a customer when one deployment serves several ("your tenants"). `sas:509`. [page]
- The tenant id is sent as an HTTP header, `x-tenant-id` by default. It is configured with `createFlowApiRouter({ tenantIdHeader })`. `sas:509`; `eng/routes/route-utils.ts:56-58` (`DEFAULT_TENANT_ID_HEADER = "x-tenant-id"`); `eng/routes/http-handlers.ts:185-188` (the `tenantIdHeader` option). [page: the default header; the option is [ref]]
- The doc's advice is to set the header from a gateway or a client's `fetch` wrapper "the same way you'd attach an auth header". `sas:509`. [page]
- An absent or empty header means single-tenant: the bare session id is the key. `eng/routes/route-utils.ts:60-66,76-79`; `sas:523`. [page]
- A tenant id containing `:` is refused with a 400 `ValidationError`. `eng/routes/route-utils.ts:80-83` (reads: "Tenant id must not contain ":""). [ref]
- [flag] The tenant id is read from a request header, not from the resolver's output. `ResolvedPrincipal` has only `userId` and `orgId`: `coreAuth:89-92`. The framework does not check the header against the credential. So the page must say the tenant id is set by something you trust (a gateway), and that nothing in the framework verifies it matches the credential. Existing docs say this only as "Set it from your gateway" (`sas:509`). [flag] `sas:313` says the session-creation check's `principal` is `{ userId, orgId, tenantId? }`, while the exported `ResolvedPrincipal` has no `tenantId`; reconcile against `packages/core/src/types/session-create.ts` (`SessionCreatePrincipal`) before the page says anything about a tenant on the principal. The page should not.

What a tenant separates.

- With a tenant id present, session storage is namespaced: two tenants that both use session id `chat-1` get two separate session records, separate session state and separate session-scoped resources. Request listing and cross-turn history are scoped to the tenant too, so one tenant never sees another's turns. `sas:511,514-517`; `pers:256-258`. [page: the answer to question 4]
- Tested: two tenants, same session id, distinct records, each with its own state; no bare-key record is created. `engT/tenant-store-isolation.test.ts:63-80`. Request history is isolated by tenant. `engT/tenant-store-isolation.test.ts:90-109`. Over HTTP the same id resolves to distinct records per tenant, the id returned is the bare id, and each carries its own `tenantId`. `engT/tenant-route-isolation.test.ts:74-92`. A listing returns only the calling tenant's sessions. `engT/tenant-route-isolation.test.ts:116-131`. [page]
- A read with the wrong tenant, or with no tenant header, answers `404`. `engT/tenant-route-isolation.test.ts:94-104`. [page: the second tenant asking for the first's session id gets a 404, as another user would]
- A crafted session id that spells another tenant's storage key (`"acme:s"` with no header) is rejected, `404` over HTTP and a `tenant` error from `runAction`. `engT/tenant-route-isolation.test.ts:106-114`; `engT/tenant-store-isolation.test.ts:113-139`; `eng/context/binding-errors.ts:67-90` (`TenantBindingMismatchError`). [ref]
- The session id the app sees (`ctx.session.identity.id`, and API responses) is always the bare id sent; the tenant prefix is a storage detail. `sas:521`; `engT/tenant-store-isolation.test.ts:82-87`. The tenant is read in a block as `ctx.session.identity.tenantId` (and `ctx.request.identity.tenantId`). `sas:521`; `engT/tenant-id-context.test.ts:20-40,52-60`. [page]
- The stored key is `${tenantId}:${sessionId}`; request records keep a bare `sessionId` and a separate `tenantId` that listing filters on. `pers:267`; `engT/user-cell-keys.test.ts:90-95` (`"s1"` bare, `"t1:s1"` with tenant `t1`). [ref] `reference/persistence`; the page does not show the key format.
- Persistent adapters (SQLite, Postgres) add a nullable `tenant_id` column by idempotent migration; existing rows read back as no tenant; an app that never sends the header is unchanged. `pers:267`; `sas:523`. [ref]

What a tenant does not separate.

- **User** and **org** scopes are not tenant-isolated: they key on the user and organization, or the organization alone. A user's preferences and org-level policy and quotas "are usually meant to apply across tenants". To isolate them per tenant, encode the tenant into the id you pass. `sas:519`; `pers:260-265` (table: session scope isolated; user and org "No, shared across tenants by design"). [page: this is the line between a tenant and an organization, and the content of the second figure]
- So a tenant splits sessions only. `sas:25` (the state-scopes figure's description: "A tenant id splits sessions only"). [page]
- An organization is the boundary for user and org records; a tenant is the boundary for sessions. A request has both. Nothing in the code or docs says one contains the other; they are two separate keys. [flag] The sitemap's second figure ("Organizations, users, tenants. Nested boxes ... box in a box") asks for nesting. The code does not nest tenant inside org or org inside tenant: the session key is `tenant:session` and records the owning org and user as fields; the user key is `user:~org:org`. The figure should draw three independent splits (what each key separates), not a containment tree, unless the caller settles one. See section 6 for the keys.

## 6. Where identity is stored (the four questions, for each stored part)

This page is about something that stores data in three places, so each gets the four questions. The keys are the observable address; the page may say what each part is keyed by in a clause and leaves the key format to Reference.

**The session's owner fields (userId, orgId, tenantId, owning flow).**

- Who owns it: the session itself carries its owner. `userId` and `orgId` are fixed at creation. `auth:107-108,502-506`; `engT/binding-immutability.test.ts:54-136`. The owning flow instance is recorded too, and governs later reads: `auth:411-420`. [page: user and org; flow is [ref]]
- Who can see it: only the owner (the same user, the same organization, the same tenant) gets the record; anyone else gets `404`/`403` as in section 4. `auth:356-375`; `engT/management-route-auth.test.ts:218-232`; `engT/org-boundary-routes.test.ts:184-199`; `engT/tenant-route-isolation.test.ts:94-104`. [page]
- Where it is stored: the session store (in memory by default; SQLite or Postgres when a persistent store is configured), under the key `${tenantId}:${sessionId}`, bare `sessionId` with no tenant. `pers:267`; `engT/user-cell-keys.test.ts:90-95`. [ref]
- How many exist: one per (tenant, session id). The same session id under two tenants is two records. `sas:511`; `engT/tenant-store-isolation.test.ts:63-80`. [page]

**The user record (user-scope state and resources).**

- Who owns it: the user, inside one organization. Alice in `acme` and Alice in `globex` are two user records with two copies of every user-scoped resource. `sas:491`; `iso:17`; `engT/user-cell-keys.test.ts:47-52` (`alice:~org:acme` is not `alice:~org:globex`). [page]
- Who can see it: that user's own requests; every flow on the server reads the same record for that user in that organization, unless the flow opts out with `isolateUserState`. `sas:491`; `iso:15-17`; `engT/user-cell-keys.test.ts:35-45`. A user's state reaches only that user's views. `sas:465`. [page]
- Where it is stored: the store behind user state, keyed `<user>:~org:<org>` (`<user>:~org:<org>:<flow>` for an isolated flow). `engT/user-cell-keys.test.ts:35-45`. [ref] `reference/flows` (the key; the page may say "keyed by the user and the organization").
- How many exist: one per (user, organization), shared across flows; one more per flow copy for each flow that sets `isolateUserState: true`. `iso:15-17,40-53`; `engT/flow-isolation.test.ts:149-198` (`resolveUserStorageKey`, "gives two copies of one collection kind separate keys", "isolates user and org independently"). [page: one and one-per-flow; collection copies are [ref]]
- Two flows that declare incompatible `user.stateSchema` shapes on the same record are refused at registration with `CrossFlowSchemaConflictError`, before data can be corrupted; identical schemas merge, extra optional fields merge with a warning. `iso:21-34`; `auth:528-543`; `engT/flow-isolation.test.ts:277-310`. [ref] `reference/authentication` (the sitemap names the cross-flow rules there).

**The org record (org-scope state and resources).**

- Who owns it: the organization. `sas:503`. [page]
- Who can see it: everyone in the organization, through every flow, unless the flow sets `isolateOrgState`. `sas:503`; `iso:15-17`. [page]
- Where it is stored: keyed by the organization id alone (the key is the org id, byte for byte), `<org>:<flow>` when isolated. `engT/user-cell-keys.test.ts:79-88`. [ref]
- How many exist: one per organization, shared across flows; one more per flow copy that sets `isolateOrgState: true`. `iso:15,40-53`; `engT/flow-isolation.test.ts:184-198`. [page]
- A tenant id does not change any of these keys. `sas:519`. [page: stated in section 5]

**What isolation does and costs.**

- `isolateUserState: true` and `isolateOrgState: true` on `defineFlow` store that flow's user (or org) state separately, exclude it from the cross-flow schema check, and make it private to the flow. The two flags are independent. `iso:36-53`; `auth:545-551`. [ref] `reference/flows` ("Isolation flags -> reference/flows")
- A flow definition that runs as several named copies keeps one private record per copy. `iso:55-89`. [ref]
- Flipping the flag later does not move data: the flow starts on a fresh record. `iso:115-117`. [ref]
- Isolation "decides where a flow's data is filed", it neither adds to nor stands in for who may call the flow. `auth:555-560`; `iso:97`. [page]

## 7. What it gets you

Each is observable, and each ties to the cast.

- You never write the check that Bob cannot read Alice's session or request. A session, a request, a stored file's session routes, a listing: each is scoped to the caller by the framework once a resolver is configured. `auth:348-360,378-386`; `engT/management-route-auth.test.ts:218-292`. [page]
- A client cannot choose its own user or organization. They come from the credential the resolver verified, not from the body, query, header or metadata. `coreAuth:79-83`; `auth:385-388`; `engT/principal-org-spoofing.test.ts:89-130`; `engT/management-route-auth.test.ts:327-355`. [page]
- One person in two organizations cannot reach one organization's session while acting for the other. `auth:361-375`; `engT/org-boundary-routes.test.ts:184-216`. [page]
- Two customers on one deployment can use the same session id and never meet. `sas:511`; `engT/tenant-route-isolation.test.ts:74-92`. [page]
- A session cannot be reused under a different user or organization, whatever the cause. `auth:514-519`; `engT/binding-immutability.test.ts:54-136`. [page]
- Ids do not need to be unguessable. `auth:490-493`. [page]
- A startup error, not silent data loss, when two flows disagree on shared user or org state. `auth:538-543`; `iso:21-34`. [ref] (mechanism of a startup check; the page may keep one clause)

## 8. How it fits with the others (neighbours)

- State and scopes (`concepts/state-and-scopes`): the four scopes; the user scope is keyed by user and organization; a tenant splits sessions only. `sas:14-27,469-505,507-523`. [page: link; one clause]
- Sessions, items and streaming: a session holds one owner; ownership is checked on every route that addresses a session or request. `auth:348-360`. [page: link]
- Serving flows (C-13): the same `authentication` hook runs for HTTP, MCP, webhook and scheduled transports; "Adapters never implement auth themselves. They call `host.resolvePrincipal` and the host applies the per-flow routing transparently." `auth:180-182`; `coreAuth:3-6`. [page: one clause; the transports themselves are C-13]
- Webhook transport verifies signatures itself, per provider, at the mount (`stripeWebhookVerifier`, `githubWebhookVerifier`, `slackWebhookVerifier`, `createWebhookVerifier`); a resolver with `createHmacVerifier` is for a signed POST over plain HTTP. `auth:259-267`. [ref] (`reference/webhooks`); the page may link.
- A terminal is a caller too: `fsdev run` and `fsdev chat` ask the same resolvers with `source: "cli"` and no `request`; only those two commands produce that source and a request from any other transport that claims it is refused with 401 before the resolver runs. `auth:340-346`; `apps/docs/docs/cli/configuration.md` "Who a run is". [ref]
- Triggering a flow from code with no HTTP layer: the caller supplies the resolved `userId` and `orgId` itself. `auth:557-559`; `auth:89-99`. [ref] `advanced/manual-flow-execution`
- Persistence (`pers`): where records carry the organization, tenant and owning flow, and what happens to records written before an organization was required. `auth:110-116`; `pers:256-267`. [ref]

## 9. Cold-read answers (key for pass 2)

Straight from the facts above; the question writer may use these.

1. **Does Flow State log users in?** No. The app verifies the credential (cookie, JWT, signed header) and tells the framework who the caller is by returning a `userId` and an `orgId` from `resolvePrincipal`. `auth:12-29,564-570`.
2. **A client sends another user's id in the body: what stops it?** With a resolver configured, the body's `userId` and `orgId` are not read; identity comes from the resolver. `engT/management-route-auth.test.ts:327-355`; `engT/principal-org-spoofing.test.ts:89-130`. With no resolver the body `userId` is the identity (development default); an existing session still refuses a different user (`UserBindingMismatchError`). `engT/management-route-auth.test.ts:623-632`; `engT/binding-immutability.test.ts:54-81`.
3. **Alice asks for Bob's session by id: what happens?** `404 Unknown session`, the same answer as an id nobody has used. If it is Alice's own session but she is acting for another organization: `403`. `engT/management-route-auth.test.ts:218-232`; `engT/org-boundary-routes.test.ts:184-199`.
4. **Two customers on one deployment: what separates their sessions?** The tenant id (the `x-tenant-id` header by default). Same session id under two tenants is two records; a read with the wrong tenant is `404`. User and org records are not separated by tenant. `engT/tenant-route-isolation.test.ts:74-104`; `sas:519`.
5. (edge) **Does `requireUser: true` mean the user was verified?** No, it is a presence check; a resolver returning `{ userId: "anyone" }` satisfies it. `auth:124-129`.
6. (edge) **A resolver returns `null` on a flow with `defaultUserId: "system"`. What happens?** 401: a configured resolver must yield an organization, and `defaultUserId` supplies a user, never an organization. `auth:60-64`; `engT/transports/org-principal-matrix.test.ts:175-189`.
7. (edge) **A request that names a session the caller owns under the wrong tenant header?** `404`. `engT/tenant-route-isolation.test.ts:94-104`.

## 10. Flags for the caller

1. **Question 2 has two answers** (resolver or none). The page must keep both and say which is the development default (section 4, "Which case answers question 2 when no resolver is configured").
2. **The second figure's "nested boxes" does not match the code.** Tenant and organization are two independent splits (session key `tenant:session`; user key `user:~org:org`; org key `org`). Draw what each boundary splits, not a containment tree, or settle one with the owner. Sections 5 and 6.
3. **Tenant id is not verified against the credential**; it is read from a header the gateway should set. `ResolvedPrincipal` carries no tenant. The page must not describe a tenant as coming from the resolver. `sas:313` says the session-creation check's principal has `tenantId?`; check `SessionCreatePrincipal` in `packages/core/src/types/session-create.ts` before stating anything about it. Not cited above as page content.
4. **`createBearerSecretPrincipalResolver` examples**: a configured resolver's principal must carry a real `orgId` (not `DEFAULT_ORG_ID`); the test fixture at `engT/transports/createBearerSecretPrincipalResolver.test.ts:12-16` uses `DEFAULT_ORG_ID` only because it calls the resolver directly. The page's example passes `orgId: "acme"` or an env-var org.
5. **`getSession` / `readSession`** in the existing page are the app's own helpers. The page declares one from an app path.
6. **Counted preamble and product comparison** at `auth:31-33` and `auth:16-19`: do not carry over.
7. **`requireUser: true` is the default**, so the sitemap's first example is a one-liner beside the resolver, not a new behaviour.
8. **Reference pages the page links** (not stated on it): resolution order, the session consistency check's error shapes, cross-flow schema rules, `requireUser: false`, the id rules, the listing rules, `409 migration-required`, `wrong-instance-session` -> `reference/authentication`; isolation flags -> `reference/flows`; the stored keys -> `reference/persistence`.

## 11. Revise round 1 notes

Corrections to the sheet above, and what moved to Reference. Where this section and an earlier one disagree, this one is right.

- **Cross-organization status depends on the route.** The 403 `Caller's organization does not own the requested resource` is the answer on the management routes (session reads and writes, state, resources, request control): `packages/engine/src/routes/route-auth.ts:185,666-680`. Request-addressed routes and file reads answer another organization's request or file as an id nobody used (404): `route-auth.ts:660-672`. An action POST (`execute_action`) is exempt from that guard and is checked at admission, where another user's or another organization's session throws a binding error that `routes/action-routes.ts` answers as `Unknown session "<id>"` with 404. So sections 4 (lines on the four-line table) and 9 answer 3 hold for the management routes only. The page no longer shows the table; it says Bob gets the same 404 as an unused id and links the reference for each route's status.
- **`PrincipalResolutionContext.request` is optional** (`packages/core/src/types/auth.ts:105`, set only for HTTP-shaped transports). The page's resolver returns `null` when it is `undefined`, and says so in one clause.
- **Moved to Reference** (the page links `../reference/authentication.md`, or `../reference/persistence.md` for keys, and states only the guarantee): `requireUser` as a presence check (page keeps "Verifying the credential is the resolver's job"); organization source and the missing-organization 401, plus the no-resolver `DEFAULT_ORG_ID` default; bearer-secret options, construction errors, header handling and the 401 on a wrong secret; the four-row status table and the per-route answers; why a 404 hides existence; the session consistency check (page keeps "a session keeps its user and organization for life, create a new session"); the no-resolver resolution order (page keeps: body `userId`, any caller can read any session, development only); tenant isolation detail (wrong or missing tenant 404, no header means no split); the tenant-header-not-verified limit (page keeps one sentence); what each record is keyed by.
- **No-resolver reads:** with no resolver, session reads and listings are unscoped (section 4, `auth:390-396`), so "any caller can read any session" is accurate.

## 12. Revise round 2 notes

- The page now says a call to `reply` is a request and the framework keeps a record of it (section 1, `auth:12-15`: the principal keys "request records"). It names the app paths of `getSession` (`src/lib/session.ts`) and `reply` (`src/flows/support/blocks/reply.ts`), the layout the examples rule gives; neither is a framework export.
- The cookie resolver accepts HTTP callers only (`request` is optional, `packages/core/src/types/auth.ts:105`); other ways in are [Serving flows](./serving-flows.md).
- "A principal with no `orgId` is refused" restates section 2 (`auth:60-64`); the no-resolver default and the session consistency check are named by what they do in the links, with the detail on the Reference page.
- The cross-organization bullet describes one user (Alice) arriving for an organization other than the session's (section 4, `engT/org-boundary-routes.test.ts:184-199`). The tenant header is unchecked against the credential (section 5, flag 3).

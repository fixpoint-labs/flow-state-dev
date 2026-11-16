# Facts: Receive a Stripe webhook (B-12, recipe, 600 words)

Pass 1 fact sheet. Cites only: the existing guide (`apps/docs/guides/webhooks-stripe.md`, the page
this one keeps), the existing reference (`apps/docs/docs/server/webhooks.md`, `.../authentication.md`,
`.../setup.md`), exported surface and doc comments, tests. Paths are from the repo root. `engine` =
`packages/engine`, `core` = `packages/core`.

Where an existing page and the code disagree, the code wins and the row says so (see
"Corrections to the existing page" at the end). Those rows must be fixed in the recipe, not carried.

## Task and outcome

1. The task: when Stripe marks an invoice paid, run a block in a `billing` flow that records the
   payment. Stripe signs each delivery; the server refuses a delivery whose signature does not
   verify. [guide webhooks-stripe.md:8-14]
2. A webhook binding is an action in webhook form: it carries the handler `block` and execution
   policy inline, is selected by the provider's event type, and is trusted by the signature check.
   It lives on `flow.webhooks`, never in `flow.actions`. [core/src/types/webhooks.ts:5-14, 52-63]
3. Because it is not in `actions`, a webhook handler has no action endpoint, is not listed among the
   flow's actions, is never an MCP tool, and runs only through a verified webhook. Webhook-originated
   requests are not re-runnable from the public retry/continue routes. [reference webhooks.md:119-129;
   core/src/types/webhooks.ts:57-63]
4. `defineFlow` still requires an `actions` map; a flow that only receives webhooks declares
   `actions: {}`. [reference webhooks.md:131-132; guide webhooks-stripe.md:45]

## Step 1: declare the binding

5. Import `defineFlow`, `defineWebhookBinding`, `sequencer`, `handler` from `@flow-state-dev/core`.
   [guide webhooks-stripe.md:22; core/src/types/webhooks.ts:154]
6. The flow's `webhooks` map is keyed by provider name (`stripe`); each provider has an `on` map keyed
   by event type (`"invoice.paid"`). Keys are matched by exact string equality against the event type
   the host extracts. Keys are opaque strings: a typo never matches and is not an error.
   [core/src/types/webhooks.ts:94-100, 262-263 (validate: "NOT validated against any provider vocabulary"); core/src/types/webhooks.ts:171-174]
7. `defineWebhookBinding<TPayload>(binding)` types `event.payload` as `TPayload` in `input`,
   `sessionId` and `when`. It is compile-time only; at runtime it returns the object it was given.
   [core/src/types/webhooks.ts:147-162]
8. Binding fields: `block` (required, any block kind), `input(event)` (required, may be async, maps
   the event to the block's input), `sessionId(event)` (optional, may be async), `when(event)`
   (optional, synchronous predicate), plus the shared action policy (`inputSchema`, `onCompleted`,
   `onErrored`, and the others on `ActionCore`). [core/src/types/webhooks.ts:64-84;
   core/src/types/flow.ts:198-211; reference webhooks.md:103-117]
9. `input`'s result is validated against the binding's `inputSchema`, falling back to the block's own
   `inputSchema`, as an HTTP body would be. [core/src/types/webhooks.ts:66-71]
10. The event handed to `input` is a `WebhookInboundEvent`: `provider`, `eventType` (`string | null`),
    `payload` (parsed body), `headers` (`Headers`), `rawBody` (`Uint8Array`), optional `deliveryId`.
    [core/src/types/webhooks.ts:37-50]
11. A Stripe `invoice.paid` payload field path the example reads: `payload.data.object.id`,
    `.customer`, `.amount_paid` (the guide's own `StripeEvent` interface; the page declares it, it is
    not a framework type). [guide webhooks-stripe.md:25-29]
12. Flow auth shape for a flow with no end user: `authentication: { defaultUserId: "system",
    requireUser: false }`. [guide webhooks-stripe.md:46-47; engine/test/transports/webhook-routes.test.ts:367]
13. `requireUser: false` is a build-time opt-out: the flow cannot declare `user.stateSchema`,
    `user.client`, or any `scope: "user"` resource, and `defineFlow` throws if it does.
    [core/src/flow/defineFlow.ts:1280-1311; reference authentication.md:134-137]
14. The flow carries no secret and no signature code; those are supplied by the host. The flow
    definition stays browser-safe. [core/src/types/webhooks.ts:16-23; reference webhooks.md:15-19]
15. Registration validation (throws at `defineFlow`): a provider with no `on` map or `service`; a
    binding with no `block`; `input` not a function; `sessionId` or `when` present but not a function;
    an empty provider or event key. [core/src/types/webhooks.ts:179-263]
16. Optional narrowing: `when: (e) => ...` skips the binding when it returns falsy. Example in the
    reference: `when: (e) => e.payload.action === "opened"`. A throwing `when` is a non-match, logged,
    answered 202. [core/src/types/webhooks.ts:78-83; engine/src/transports/webhook/routes.ts:360-382;
    engine/test/transports/webhook-routes.test.ts:151]

## Step 2: verify the signature (Question 1: what refuses a forged event?)

17. The host, not the flow, supplies verification. At mount, `createWebhookTransportAdapter({ providers })`
    takes a `WebhookProviderDefinition` per provider name, the same name the flow's `webhooks` map uses.
    [engine/src/transports/webhook/createWebhookTransportAdapter.ts:24-60]
18. `WebhookProviderDefinition` fields: `verify(rawBody, headers)` required; `eventType(payload,
    headers)`, `parse(rawBody, headers)`, `deliveryId(payload, headers)`, `acknowledge(event)` optional.
    [createWebhookTransportAdapter.ts:29-53]
19. `createWebhookTransportAdapter` and `stripeWebhookVerifier` are exported from
    `@flow-state-dev/engine`. [engine/src/index.ts:44, 51; engine/src/transports/index.ts; guide
    webhooks-stripe.md:77-80]. `createFlowState` and `inMemoryStores` too (index.ts:18).
20. The adapter is one entry in `adapters` on `createFlowState`. [createWebhookTransportAdapter.ts:62-64;
    guide webhooks-stripe.md:86-96; engine/src/flowstate/createFlowState.ts:1310 passes `adapters`]
21. `stripeWebhookVerifier(secret, { toleranceSeconds? })`: `secret` is a string or a `() => string`
    getter; the getter is resolved lazily on first use (so an env var set after import works) and the
    result is cached. [engine/src/transports/auth/createWebhookVerifier.ts:36-48, 55-67; reference
    webhooks.md:191-193]
22. It reads the `Stripe-Signature` header (`t=<timestamp>,v1=<hex>`), signs `<timestamp>.<rawBody>`
    with HMAC-SHA256, and compares in constant time. [createWebhookVerifier.ts:50-67;
    engine/src/transports/auth/createHmacVerifier.ts:185-192, 127-131, 96-97]
23. It rejects a timestamp more than `toleranceSeconds` from now (default 300 seconds, so five
    minutes, in either direction), even when the signature matches. [createHmacVerifier.ts:60-66,
    96, 115-120]
24. A header with several `v1`/`vN` signatures passes if any one matches, so Stripe secret rotation does
    not break verification. [createHmacVerifier.ts:150-174]
25. A missing or empty `Stripe-Signature`, a header with no timestamp or no signature, or a body whose
    HMAC does not match, returns `false`. [createHmacVerifier.ts:106-113, 172]
26. In the route, `verify` runs first, on the raw bytes, before the body is parsed or any session is
    created. `false` or a throw gives `401 { error: "invalid_signature" }`; nothing is dispatched.
    [engine/src/transports/webhook/routes.ts:59-71]
27. A forged delivery gets 401 and creates no session. Test: forged `stripe-signature` header
    `t=9999999999,v1=deadbeef`, expects 401 and no session at `customer-cus_42`.
    [engine/test/transports/webhook-routes.test.ts:434-458]; and a plain 401 with no dispatch
    [webhook-routes.test.ts:126-136]
28. The secret is read on the host only: the framework stores no secret; the verifier is a pure
    function over `(rawBody, headers)`. [reference webhooks.md:191-193, 235-236]
29. `eventType` is how the event type is read. Stripe puts it in the body, so
    `eventType: (payload) => (payload as { type: string }).type`. [guide webhooks-stripe.md:91; reference webhooks.md:178-181]
30. `eventType` is required on a provider definition when any flow declares `on` for it. The adapter
    throws at startup if it is missing. Also at startup: a flow declaring a provider the mount did not
    configure throws. [createWebhookTransportAdapter.ts:93-124; reference webhooks.md:68-70]
31. `deliveryId: (payload) => (payload as { id: string }).id` puts Stripe's event id on
    `event.deliveryId` and `metadata.webhook.deliveryId` of the request. [guide webhooks-stripe.md:92,
    109-110; engine/test/transports/webhook-routes.test.ts:120-124]
32. The framework surfaces the delivery id and does not de-duplicate; make the block idempotent, e.g.
    key the write on `deliveryId` or the invoice id. Providers deliver at least once. [reference
    webhooks.md:322-340; guide webhooks-stripe.md:35-36]
33. Mounting: `createVercelNextHandler(flowstate)` from `@flow-state-dev/vercel/next` returns
    `{ GET, POST, PATCH, DELETE }` for a Next catch-all route `app/api/flows/[...path]/route.ts`.
    [packages/vercel/src/next.ts:17-21; guide webhooks-stripe.md:100-105]
34. The adapter mounts one route, `POST /api/flows/:flowKind/webhooks/:provider`. `basePath` defaults
    to `/api/flows` and can be overridden. [createWebhookTransportAdapter.ts:58-59, 66-79]
35. A flow's address in the URL is its id; a singleton flow's id is its `kind`. So `kind: "billing"`
    is served at `/api/flows/billing/webhooks/stripe`. [core/src/flow/defineFlow.ts:399-401;
    engine/src/registry/flow-registry.ts:127-130 (`get`: "A singleton answers to its kind")]

## Step 3: map the event to an action, and whose run it is (Question 2)

36. Order in the route after verify: parse body (`JSON.parse` of UTF-8 unless `parse` is given; a
    parse failure is `400 { error: "invalid_payload" }`) → extract `eventType` and `deliveryId` →
    optional `acknowledge` handshake → match `on[eventType]` and `when` → run `input` and `sessionId` →
    resolve principal → validate dispatch → ensure session → dispatch → 202.
    [routes.ts:1-9, 73-81, 83-116, 143-147, 153-161, 171-178, 202-234, 236-278]
37. A throwing `eventType` or `deliveryId` extractor is treated as not extracted (logged), never a 5xx.
    [routes.ts:87-108; webhook-routes.test.ts:247-290]
38. Unmatched events: no `on` key for the event type, a null event type, or a failing `when` give
    `202 { status: "ignored", provider, eventType }`, with no run. This is deliberate on the provider
    side: providers retry non-2xx. [routes.ts:143-147, 365-383; reference webhooks.md:259-262;
    webhook-routes.test.ts:138-149]
39. A throw in `input` or `sessionId` is `500 { error: "route_failed", message }`. [routes.ts:155-161]
40. Unknown flow id: `404 { error: "flow_not_found" }`. Provider not declared on the flow, or not
    configured on the mount: `404 { error: "webhook_not_found", provider }`. These come before
    verification. [routes.ts:48-57; webhook-routes.test.ts:326-347]
41. Success response: `202 { status: "accepted", provider, eventType, requestId }`, sent without
    waiting for the block to finish. The block runs after the response. Errors after dispatch land on
    the request record, not in the response. [routes.ts:273-278; reference webhooks.md:289-301]
42. The 202 is held until the request is durably recorded; if recording fails the response is
    `503 { error: "dispatch_not_durable" }` so the provider retries. [routes.ts:249-271;
    webhook-routes.test.ts:219-245]
43. Provider time budgets cited by the reference: Slack 3 seconds, GitHub 10 seconds. Stripe's budget
    is not cited anywhere in the repo; do not state one. [reference webhooks.md:297-301]
44. Concurrency: when the flow's concurrency policy is `reject` and a duplicate for the same session is
    already in flight, the response is `200 { status: "skipped", reason: "in_flight", requestId }`.
    [engine/src/routes/concurrency-refusal.ts:15-34; webhook-routes.test.ts:460-524] (Reference
    material; do not put on the recipe.)

### Which user the run belongs to

45. The run's user is the resolved principal. For a flow with `requireUser: false` and
    `authentication.defaultUserId: "system"` and no resolver of its own, the principal is
    `userId: "system"`. Test: `session.userId === "system"`. [routes.ts:171-186;
    engine/src/transports/host/createInboundTransportHost.ts:326-329 (default applied when the resolver
    returns none); webhook-routes.test.ts:429]
46. The principal is resolved with `source: "webhook"`. A flow's own `authentication.resolvePrincipal`
    wins over the host's. [routes.ts:175-180; createInboundTransportHost.ts:287-298 (comment on
    precedence); engine/src/transports/auth/pickPrincipalResolver.ts:20-28]
47. With no resolver configured anywhere, the framework default reads `userId` from the body it is
    given; for a webhook that is `envelope.input`, the object the binding's `input` returned. If the
    mapped input has no `userId` field, the resolver returns nothing and `defaultUserId` applies. So:
    do not put a `userId` key in the mapped input. A payload field flowing into `userId` would let the
    sender name the user. [engine/src/transports/auth/defaultBodyUserIdPrincipalResolver.ts:31-44, 78-92;
    routes.ts:175-180]. Flag: only the second half ("the sender names the user") is inference from
    the resolver reading `envelope.input`; the first half is read directly.
48. Organization: with no configured resolver the framework supplies the reserved development org
    (`DEFAULT_ORG_ID`) and warns once. A configured resolver must return a verified `orgId`; returning
    none gives 401. [createInboundTransportHost.ts:242-272; reference authentication.md:52-67]
49. If no `userId` resolves and `requireUser` is `false`, the response is a 500-class
    `PrincipalResolutionError` ("Set authentication.defaultUserId"). With `requireUser` true, 401.
    [createInboundTransportHost.ts:331-348]
50. `sessionId` is optional. Omitted (or resolving to `undefined`), the run gets a fresh ephemeral
    session; a webhook has no thread to key on. [core/src/types/webhooks.ts:72-77; reference
    webhooks.md:268-273]
51. Given `sessionId: (e) => \`customer-${e.payload.data.object.customer}\``, the first delivery for
    that id creates the session and later ones reuse it, so a customer's events accumulate in one
    session. Two simultaneous first deliveries: one creates, the other adopts. [session-resolver.ts:1-12;
    reference webhooks.md:274-281]
52. A session derived this way is bound to the principal that created it; a later delivery resolving to
    a different user or org is refused (session consistency check). [reference authentication.md:502-523;
    reference webhooks.md:283-287]
53. If the flow's session state schema cannot be created from nothing (a required field, or a create
    check wanting initial state), the webhook cannot create the session and the route answers with
    the session-create-refused response; a webhook carries no initial state. If the session store is
    down: `503 { error: "session_unavailable" }`. [session-resolver.ts:28-34; routes.ts:218-233]
    (Reference material.)

### Stored parts: four questions

The page's stored parts are the session a delivery creates (when `sessionId` is set) and the request
record each delivery leaves. The page itself defines no collection.

54. **Session** `customer-<stripe customer id>`:
    - Who owns it: the resolved principal at creation, `userId: "system"` and the resolved `orgId`;
      immutable afterwards. [session-resolver.ts:50-58; reference authentication.md:504-506;
      webhook-routes.test.ts:429]
    - Who can see it: requests resolving to that same user and org; a different identity gets
      "Unknown session" (404 over HTTP). A browser user does not see it unless they resolve to
      `system` in the same org. [reference authentication.md:509-513]
    - Where it is stored: the session store of the `stores` profile the flow runs on (`inMemoryStores()`
      in the example, which does not survive a restart). Row records `metadata: { source: "webhook",
      provider, eventType }`. [session-resolver.ts:60-64; webhook-routes.test.ts:430; guide
      webhooks-stripe.md:85 and engine/src/flowstate/createFlowState.ts:233-237 (default is in-memory)]
    - How many: one per distinct `sessionId` value, so one per Stripe customer in the example. With no
      `sessionId`, a new ephemeral session per delivery. [reference webhooks.md:268-281]
55. **Request record** per delivery: carries `metadata.webhook = { provider, eventType, deliveryId? }`
    and the request's outcome; one per accepted delivery, owned by the same principal, stored in the
    request store. The 202 body's `requestId` names it. [routes.ts:163-169, 273-278; reference
    webhooks.md:289-295, 326-328]. Visibility of request records to readers is not cited; say nothing
    beyond "errors surface in DevTool".
56. DevTool shows the post-dispatch errors; the guide also says the request list carries a `webhook`
    badge. The badge is NOT confirmed in `apps/devtool/src` (no match for "webhook"). Leave the badge
    out. [reference webhooks.md:294-295 for errors in DevTool; guide webhooks-stripe.md:136-137 for the
    badge, unverified]

## Step 4: test it

57. A signed request can be built with no Stripe account: sign `<ts>.<rawBody>` with HMAC-SHA256 under
    the secret, send header `stripe-signature: t=<ts>,v1=<hex>`. The test `signedStripeRequest` does
    exactly this against `http://test/api/flows/billing/webhooks/stripe`.
    [webhook-routes.test.ts:382-392]
    Expected: valid signature and `invoice.paid` body gives 202; the handler runs; the session
    `customer-cus_42` has `userId: "system"` and `metadata` `{ source: "webhook", provider: "stripe" }`
    and the handler's state. [webhook-routes.test.ts:394-432]
58. Forged signature gives 401 and no session. [webhook-routes.test.ts:434-458]
59. Failure codes a reader hits locally and what each means: 401 `invalid_signature` (secret or
    signature wrong, or timestamp outside five minutes); 404 `flow_not_found` (flow id in URL);
    404 `webhook_not_found` (provider segment not declared on the flow or not on the mount); 400
    `invalid_payload` (body is not JSON); 202 `ignored` (event type has no binding). [routes.ts:48-57,
    69-71, 80, 143-147]
60. The Stripe CLI path (`stripe listen --forward-to <url>` prints a `whsec_...` secret; then
    `stripe trigger <event>`) is the existing guide's. The CLI is not in this repo, so its behaviour
    cannot be verified here. The recipe may keep it as the existing page states it. [guide
    webhooks-stripe.md:114-138]. Two things on that page need care: `stripe listen` prints the
    secret it signs with, which must be what `STRIPE_WEBHOOK_SECRET` holds when the server starts
    (the getter reads it lazily on first delivery, then caches: changing the env var later needs a
    restart) [createWebhookVerifier.ts:36-48]; and the guide triggers `invoice.payment_succeeded`
    while the binding is on `invoice.paid`, which does not match unless Stripe also sends
    `invoice.paid` for that trigger. Uncheckable here; either trigger `invoice.paid` or say nothing.

## Corrections to the existing page (code wins)

C1. `createFlowState({ flows: { billing: billingFlow() } })` (guide :84-85; also `setup.md:22,55`)
    throws `FlowStateConfigError`: `flows` is a list of instances, "The keyed record form was
    removed". Write `flows: [billingFlow()]`. A singleton's id is its `kind`, so the URL is
    unchanged. [engine/src/flowstate/createFlowState.ts:372-377; setup.md:200 shows the list form]
C2. The guide's `recordPayment` handler calls `ledger.recordPayment(...)`, a free variable. Each
    identifier in an example must be imported or declared (user-docs.md "No phantom names"). Use an
    app helper imported by relative path or a declared stub; do not invent framework API.
C3. The guide calls `recordPayment` an "action" in several places. It is a block; the binding is the
    action in webhook form. The guide's `recordPaymentPipeline` sequencer wrapping one handler via
    `.tap` is unnecessary: `block` accepts a handler directly (any block kind). [core/src/types/webhooks.ts:234-239;
    reference webhooks.md:105-106]. (A handler's return is recorded; keep it small. Nothing to state.)
C4. The guide imports `sequencer`; the order of `.tap(handler)` was not exercised in a test reachable
    for this sheet. Drop it per C3.
C5. `"a 404 means the provider name or flow kind in the URL is off"` is right (routes.ts:48-57).
    `"a 200/202"` : a valid delivery is 202, with 200 only for a handshake body or a `skipped`
    concurrency refusal. Say 202.
C6. The guide's example file paths (`flows/billing.ts`, `lib/flowstate.ts`) do not match the layout in
    user-docs.md ("Code examples"). Use `src/flows/billing/flow.ts`, `src/flows/billing/blocks/record-payment.ts`,
    `src/lib/flowstate.ts`? Note: the layout lists `lib/<name>.ts` as client-side helpers; the
    server config belongs in `fsdev.config.ts` ("the app: its kits, flows and stores"). Writer decides;
    whichever is used, route imports `flowstate` from it.

## Not cited, so not on the page

- Stripe's retry schedule, Stripe's response-time budget, Stripe CLI behaviour beyond the existing guide.
- Anything about how the adapter is built beyond observable responses.
- Raw-body handling in Next.js: the verifier signs the exact request bytes; the route reads
  `req.arrayBuffer()` itself (routes.ts:59). A reader's own middleware that re-serialises the body
  would break verification, but that is not stated in any cited page; omit.

## Links the page needs (targets exist or are planned)

- `reference/webhooks` (sitemap): detail rows for `when`, `acknowledge`, `parse`, `createWebhookVerifier`,
  idempotency, concurrency `skipped`, session-create refusal, org rules.
- C-17 (sitemap): serving flows. Current page: `docs/contributing/docs-revamp/pages/concepts/serving-flows.md`.

## Resolved in the page (revise round 1)

- C1 applied: `flows: [billingFlow()]`. `defineFlow` returns a callable; a singleton is served at its `kind`
  (setup.md:196-200; createFlowState.ts:372-377).
- C2 applied: `ledger` is imported from `src/lib/ledger` and described as the reader's own helper.
- C3/C4 applied: the binding's `block` is the handler directly; no sequencer.
- C5 applied: the page says the CLI reports a `202` (routes.ts:273-278).
- C6 applied: files are `src/flows/billing/blocks/record-payment.ts`, `src/flows/billing/flow.ts`,
  `src/lib/flowstate.ts`, `src/app/api/flows/[...path]/route.ts`.
- Fact 60: the page triggers `invoice.paid` directly; it no longer claims `invoice.payment_succeeded`
  also sends it.
- `createFlowState`, `inMemoryStores`, `createWebhookTransportAdapter` and `stripeWebhookVerifier` all come
  from `@flow-state-dev/engine` (index.ts:18, 25, 44, 51), imported in one statement.
- Moved to the reference page (page links it, states none of it): response codes 401/404, the signing recipe
  (`<timestamp>.<rawBody>`), the provider-field table, and caller-identity detail. The page keeps the
  five-minute rejection, the `deliveryId` location (fact 31), and one clause each on `requireUser: false`
  and `sessionId` (facts 45, 50, 51).

## Resolved in the page (revise round 2)

- `src/lib/ledger.ts` is now shown as a stub; the tc check had no file at that path.
- `flows: [billingFlow()]` re-verified: createFlowState.ts:372-377 throws on the keyed record form, so the older guide's object form (guide :84) is the stale one.
- Fact 31: the page no longer says where a block reads the delivery id (no cited accessor in a block); it points to the reference.
- Step 3 outcome: the 202 is observable (fact 41); the log line is not cited, so the page tells the reader to check the ledger.

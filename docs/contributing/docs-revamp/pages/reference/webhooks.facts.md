# Facts for Webhooks and inbound transports (R-32, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, and one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. **[test]** marks a fact a test pins. **[source]** marks a fact read from code that no test or doc comment pins. **[doc]** marks a fact the existing user docs state and the code agrees with. Nothing here was run against a deployed server.

Abbreviations (paths from the repo root):

- `wh` = `packages/engine/src/transports/webhook/routes.ts` (the request pipeline; its header comment is the surface of the route)
- `wa` = `packages/engine/src/transports/webhook/createWebhookTransportAdapter.ts`
- `ws` = `packages/engine/src/transports/webhook/session-resolver.ts`
- `wv` = `packages/engine/src/transports/auth/createWebhookVerifier.ts`
- `hv` = `packages/engine/src/transports/auth/createHmacVerifier.ts`
- `ty` = `packages/core/src/types/webhooks.ts`
- `au` = `packages/core/src/types/auth.ts`
- `tt` = `packages/engine/src/transports/types.ts`
- `ho` = `packages/engine/src/transports/host/createInboundTransportHost.ts`
- `fr` = `packages/engine/src/routes/createFlowApiRouter.ts`
- `cr` = `packages/engine/src/routes/concurrency-refusal.ts`
- `pr` = `packages/engine/src/routes/public-reentry.ts`
- `er` = `packages/engine/src/transports/errors.ts`
- Tests, `packages/engine/test/transports/`: `wrt` = `webhook-routes.test.ts`, `wat` = `webhook-adapter.test.ts`, `wvt` = `createWebhookVerifier.test.ts`, `wst` = `webhook-service-route.test.ts`; `packages/engine/test/public-reentry-opt-in.test.ts` = `pro`
- Docs: `dwh` = `apps/docs/docs/server/webhooks.md`, `dit` = `apps/docs/docs/advanced/inbound-transports.md`, `gst` / `ggh` / `gsl` = `apps/docs/guides/webhooks-stripe.md` / `webhooks-github.md` / `webhooks-slack-events.md`
- Goal: `goals/webhook-transport/runs-the-bound-handler-on-a-verified-delivery/goal.md` = `goal`

The page's plan names five tables (binding fields, verification, mapping to an action, who the caller is, writing a transport) and one lookup ("What is returned to a sender whose signature fails?"). Reference pages carry their own tables and are not held to the six-row cap.

## The one-line answer to the lookup

A sender whose signature fails gets **401** with the JSON body `{ "error": "invalid_signature" }`. Nothing is parsed, routed or dispatched, and no session is created. A `verify` that throws is treated the same as one that returns `false`. [test: `wrt:127-137`, `wrt:435-458`; goal "forged POST returns 401 and creates no session"; source `wh:61-71`]

## 1. Mounting

| # | Fact | Source |
|---|------|--------|
| 1.1 | `createWebhookTransportAdapter({ providers, basePath? })` and the four verifier helpers (`stripeWebhookVerifier`, `githubWebhookVerifier`, `slackWebhookVerifier`, `createWebhookVerifier`) are exported from `@flow-state-dev/engine`. `defineWebhookBinding` and the types `WebhookInboundEvent`, `WebhookEventBinding`, `WebhookBindingsConfig`, `WebhookServiceConfig`, `WebhookServiceRoute`, `WebhookConfig`, `WebhookSubscriptionConfig` are exported from `@flow-state-dev/core`. `WebhookProviderDefinition` and `CreateWebhookTransportAdapterOptions` are exported from the engine's transports index. | `packages/engine/src/index.ts:43-51`; `packages/core/src/index.ts:328-336`; `packages/engine/src/transports/index.ts:94-107` |
| 1.2 | The adapter's `source` is the string `"webhook"`. | `wa:22`, `:73`; `wat:44-51` [test] |
| 1.3 | The adapter mounts one route: `POST <basePath>/:flowKind/webhooks/:provider`. `basePath` defaults to `/api/flows`; it is trimmed, given a leading `/`, and loses trailing `/`. A custom `basePath: "/hooks"` mounts `/hooks/:flowKind/webhooks/:provider`. | `wa:55-60`, `:69`, `:76-80`, `:126-134`; `wat:44-60` [test] |
| 1.4 | The adapter is passed in `adapters` to `createFlowState` or `createFlowApiRouter`. | `wa:62-65`; `fr:142-147`; `dwh` "Install and mount" [doc]; `wat:82-96` [test] |
| 1.5 | `:flowKind` is the id of the flow instance. The adapter looks it up with the host's registry per request. | `wh:45-51`; `dit` "Webhook adapter shape" [doc] |
| 1.6 | `:provider` is the key of the flow's `webhooks` map and of the mount's `providers` map. The two must use the same name. | `wa:55-57`; `ty:138-141`; `wh:53-54` |
| 1.7 | Startup check, run as the adapter's `start` hook when the router is built: a registered flow that declares a provider the mount has no definition for throws `Webhook adapter: flow "<kind>" declares webhooks for provider "<name>" but no provider definition was supplied...`; a flow whose provider uses an `on` map while the definition has no `eventType` throws `...declares an \`on\` event map, but its provider definition has no \`eventType\` extractor...`. The webhook `start` is synchronous, and the router rethrows a synchronous `start` error, so construction fails. (An async `start` error is only logged.) | `wa:84-124`; `wat:62-80` [test]; `fr:622-642` [source] |
| 1.8 | Two adapters declaring the same method and path make the router throw `TransportRouteCollisionError` at construction (message `Route collision on <METHOD> <path>: declared by adapters [<sources>]`; fields `method`, `path`, `sources`). | `er:142-156`; `fr:800-821`; `wat:82-96` [test, the webhook route does not collide with the built-ins] |
| 1.9 | Routes an adapter mounts are matched ahead of the built-in HTTP route table. | `fr:716-720` [source]; `docs/contributing/docs-revamp/pages/reference/http-api.facts.md` row 1.6 states the cross-site check does not apply to them |
| 1.10 | The flow's `webhooks` map is validated when the flow is defined, not when it is mounted. It throws a plain `Error` for: an empty provider name; a provider entry that is neither an `on` object nor a `service`; an `on` key that is empty; a binding that is not an object; a binding with no `block`; a binding whose `input` is not a function; a `sessionId` or `when` that is present and not a function; a provider that declares both `on` and `service`; a `service` with no `normalize` function or empty `entry`. Event keys are opaque strings, not checked against any provider's vocabulary, so a typo never matches. | `ty:168-264`; `packages/core/src/flow/defineFlow.ts:1466`; `packages/core/test/webhook-config-validation.test.ts` [test, exists; cases not individually read] |
| 1.11 | The webhook transport ships inside `@flow-state-dev/engine`; there is no separate package. | `dwh` "Install and mount" [doc]; `packages/engine/src/index.ts:43-51` |

## 2. Binding fields (what the flow declares)

A binding is the value under `webhooks[provider].on[eventType]`. Build it with `defineWebhookBinding<TPayload>(...)`, a compile-time convenience that returns its argument unchanged at runtime. A plain object also works, untyped. [`ty:147-162`; `dwh` [doc]]

| # | Field | Type and meaning | Source |
|---|-------|------------------|--------|
| 2.1 | `on` key | The map key. A string matched by exact equality against the provider's extracted `eventType`. Never a dotted sub-event. An event whose `eventType` is `null` matches nothing. | `ty:95-100`; `wh:365-374`; `ggh` "The `on` key is `pull_request`... not `pull_request.opened`" [doc] |
| 2.2 | `block` | Required. The block to run: a handler, generator, sequencer or router. Comes from the binding's `ActionCore`, so the binding is an action in webhook form and needs no entry in `flow.actions`. | `ty:52-64`, `:234-239`; `dwh` [doc] |
| 2.3 | `input` | Required function `(event) => unknown \| Promise<unknown>`. Maps the event to the block's input. The result is validated against the binding's `inputSchema`, falling back to the block's own schema, as an HTTP body is. A throw from `input` answers **500** `{ error: "route_failed", message }`. | `ty:65-71`, `:241-246`; `wh:154-161` |
| 2.4 | `sessionId` | Optional function `(event) => string \| Promise<string> \| undefined`. Derives the session id from the event. Omitted, or resolving to `undefined`, the run gets a fresh session. Given, the session is found or created, so repeated events with the same id share one session. A throw answers **500** `route_failed`. | `ty:72-77`; `wh:156-161`, `:208-217`; `ws:1-12` |
| 2.5 | `when` | Optional synchronous predicate `(event) => boolean`. A falsy result means the binding does not match: the delivery is acknowledged (202 `ignored`) and nothing runs. A `when` that throws is logged as a warning and treated as no match (202), never a 5xx. | `ty:78-83`; `wh:139-147`, `:356-383`; `wrt:139-180` [test: "treats a throwing `when` predicate as a non-match (202, no dispatch, no 5xx)"] |
| 2.6 | Action-level policy | The rest of `ActionCore`, on the binding itself. The existing doc names `durable`, `tokenBudget`, `onCompleted` and `onErrored`; also `inputSchema` (used in 2.3). | `ty:30`, `:64`; `dwh` "A binding carries the handler plus the event mapping" [doc]. `ActionCore`'s full field list was not read; carry only the names the doc gives, or read `packages/core/src/types/flow.ts` `ActionCore` before listing more. |
| 2.7 | Not in `actions` | A webhook binding is not listed among the flow's actions, has no action endpoint, is never an MCP tool, and runs only through a verified webhook. `defineFlow` still requires an `actions` map, so a flow that only receives webhooks writes `actions: {}`. | `ty:5-15`; `dwh` "Webhook handlers live off `actions`" [doc]; `wrt:30-47` [test, the example flow uses `actions: {}`] |
| 2.8 | Re-entry | A request that arrived by webhook cannot be re-run from the public `retry`, `continue` or `resume` routes. Those routes allow only `http`, `mcp` and `scheduled`, plus whatever the host adds with `publicReentrySources`. `webhook`, `internal` and `task` can never be added: naming one throws when the router is built. A refused request answers the same not-found a missing request does. | `pr:30-80`; `packages/engine/src/flowstate/types.ts:313-324`; `pro:114-117`, `:158-160` [test]; `dit` "Letting your transport's requests be re-entered" [doc] |
| 2.9 | Flow tools | A flow-level `tools` config is applied to every webhook handler block, as it is to caller actions. | `packages/core/src/flow/defineFlow.ts:617-648` [source; surface behaviour not otherwise documented, optional] |

### The event handed to `input`, `sessionId` and `when`

`WebhookInboundEvent<TPayload = unknown>`:

| # | Field | Meaning | Source |
|---|-------|---------|--------|
| 2.10 | `provider: string` | The `:provider` URL segment. | `ty:37-39` |
| 2.11 | `eventType: string \| null` | What the provider's `eventType` extractor returned, or `null`. | `ty:40-41` |
| 2.12 | `payload: TPayload` | The parsed body. `unknown` unless narrowed with `defineWebhookBinding<T>()`. | `ty:42-43` |
| 2.13 | `headers: Headers` | The raw request headers. | `ty:44-45` |
| 2.14 | `rawBody: Uint8Array` | The exact request bytes. | `ty:46-47` |
| 2.15 | `deliveryId?: string` | Present only when the provider's `deliveryId` extractor returned one. | `ty:48-49`; `wh:109-116` |

### Service form (a provider entry that is not an `on` map)

| # | Fact | Source |
|---|------|--------|
| 2.16 | A provider entry can instead be `{ service: { entry, normalize } }`, never both `on` and `service`. `normalize(event, { received })` returns zero or more normalized events (a `SubscriptionEvent[]`); each is routed through the flow's internal action named by `entry`, as `userId` `service:<provider>`, in the org the host's principal resolver names. A flow gets it from its provider's service-flow factory (the GitHub one is `githubServiceFlow` in `@flow-state-dev/workforce`), not by hand. | `ty:104-135`; `wh:138-141`, `:289-354`; `packages/workforce/src/service-flows/github/service-flow.ts` |
| 2.17 | Responses on a service route: 202 `{ status: "accepted", provider, eventType, events, ownerRuns, refused }` once each owner run is durably recorded; 202 `{ status: "ignored", provider, eventType }` when `normalize` returns no events; 400 `invalid_payload` when `normalize` throws; 500 `route_failed` when routing fails; 503 `route_incomplete` when routing did not finish; 503 `dispatch_not_durable` (with `failed` count) when an owner run was not recorded. Verification and the handshake run before it, as for a binding. | `wh:289-354`; `wst:108-187` [test] |

## 3. Provider definitions (what the host supplies)

`createWebhookTransportAdapter({ providers: { <name>: WebhookProviderDefinition } })`. Secrets, crypto and wire-format knowledge live here, never on the flow. [`wa:24-60`; `ty:16-23`]

| # | Field | Signature and meaning | Source |
|---|-------|-----------------------|--------|
| 3.1 | `verify` | Required. `(rawBody: Uint8Array, headers: Headers) => boolean \| Promise<boolean>`. `false` or a throw rejects the delivery with 401. Runs over the raw bytes. | `wa:30-36`; `wh:61-71` |
| 3.2 | `eventType` | Optional in the type, required at startup when any flow uses `on` for this provider (see 1.7). `(payload, headers) => string \| null`. A throw is logged as a warning and read as `null`, so the handshake in 3.5 stays reachable. Stripe reads `payload.type`; GitHub reads the `X-GitHub-Event` header; Slack reads `payload.event.type`, falling back to `payload.type`. | `wa:37-42`; `wh:83-97`; `wrt:248-269` [test]; `gst`, `ggh`, `gsl` [doc] |
| 3.3 | `parse` | Optional. `(rawBody, headers) => unknown`. Default: `JSON.parse` of the UTF-8 body. A parse failure (including a throw from a custom `parse`) answers **400** `{ error: "invalid_payload" }`. Parsing happens after verification. | `wa:43-44`; `wh:73-81` |
| 3.4 | `deliveryId` | Optional. `(payload, headers) => string \| undefined`. The per-delivery id. It is set on `event.deliveryId` and recorded as `metadata.webhook.deliveryId`. GitHub's comes from the `X-GitHub-Delivery` header, Stripe's from `payload.id`, Slack's from `payload.event_id`. A throw is logged and the id omitted; the delivery still dispatches. | `wa:45-46`; `wh:98-116`; `wrt:271-290` [test]; `ggh:92-95`, `gst:91-92`, `gsl:72` [doc] |
| 3.5 | `acknowledge` | Optional handshake. `(event: WebhookInboundEvent) => BodyInit \| null`. A non-null return is sent as the body of a **200** response and nothing is dispatched (Slack's `url_verification` challenge). `null` continues to routing. A throw is logged and read as `null`. It runs after verification, parsing and extraction, so an unsigned request never reaches it. | `wa:47-52`; `wh:118-136`; `wrt:182-218` [test] |
| 3.6 | No dedupe | The route does not deduplicate redeliveries. `deliveryId` is provenance: pass it into the block's input (the binding's `input` function sees `event.deliveryId`) and make the block idempotent. | `dwh` "Idempotency" [doc]; `wh` (no dedupe step in the pipeline) [source] |
| 3.7 | Concurrency refusal | When the flow's concurrency policy is `reject` and another request already holds the key (the session, by default), the duplicate delivery is answered **200** `{ status: "skipped", reason: "in_flight", requestId }`, so the provider stops redelivering. The same on a queue-backed host. | `cr:15-40`; `er:55-75`; `wrt:461-525`, `:527-595` [test] |
| 3.8 | Secrets | Each built-in verifier takes a string or a `() => string` getter. A getter is resolved on first use and then memoized. A string or getter result that is empty or not a string throws `<helper>: \`secret\` must be a non-empty string.` The framework stores no secrets. | `wv:13-14`, `:37-50`, `:99-113`; `packages/engine/src/transports/auth/assert-secret.ts`; `wvt:152-185` [test] |

## 4. Verification

All verifiers have the type `(rawBody: Uint8Array, headers: Headers) => boolean`, compare in constant time, and return `false` for a missing or malformed header. [`wv:22`; `hv:1-8`, `:109-137`; `wvt` [test]]

| # | Verifier | What it checks | Source |
|---|----------|----------------|--------|
| 4.1 | `stripeWebhookVerifier(secret, { toleranceSeconds? })` | Header `Stripe-Signature`, form `t=<unix seconds>,v1=<hex>[,vN=<hex>]`. HMAC-SHA256 over `<t>.<rawBody>`. Any listed `vN` signature may match. Rejects a timestamp whose distance from now is more than `toleranceSeconds` (default 300), in either direction. `toleranceSeconds: Infinity` disables the check. | `wv:52-69`; `hv:43-76`, `:118-123`, `:153-177`, `:188-196`; `wvt:24-60` [test] |
| 4.2 | `githubWebhookVerifier(secret)` | Header `X-Hub-Signature-256`, form `sha256=<hex>`. HMAC-SHA256 over the raw body. A header without the `sha256=` prefix fails. | `wv:71-83`; `hv:139-151`; `wvt:61-80` [test] |
| 4.3 | `slackWebhookVerifier(secret, { toleranceSeconds?, now? })` | Headers `X-Slack-Signature` (`v0=<hex>`) and `X-Slack-Request-Timestamp` (digits only, else fails). HMAC-SHA256 over `v0:<timestamp>:<rawBody>`. Rejects a timestamp more than `toleranceSeconds` (default 300) from now; `Infinity` disables. The secret is the app's signing secret from its Basic Information page, not a bot token. | `wv:85-137`; `wvt:82-150` [test]; `gsl:83-84` [doc, for "signing secret, not a bot token"] |
| 4.4 | `createWebhookVerifier({ header, secret, format?, prefix?, algorithm?, encoding?, toleranceSeconds?, parseSignature?, now? })` | Generic HMAC. `header`: the request header carrying the signature. `format`: `"raw"` (default; `[prefix]<sig>`), `"stripe"` (`t=…,v1=…`) or `"custom"` (needs `parseSignature(headerValue) => { timestamp?, signatures } \| null`, else it throws at build time). `prefix`: stripped before comparison, `raw` only. `algorithm`: `sha256` (default), `sha1`, `sha512`. `encoding`: `hex` (default), `base64`, `base64url`. `toleranceSeconds`: default 300, applies when the parsed header carries a timestamp. | `wv:24-50`; `hv:27-76`, `:92-137`, `:179-186` |
| 4.5 | Failure answer | Any `false` or throw answers 401 `{ error: "invalid_signature" }`. See the lookup at the top. | `wh:61-71` |
| 4.6 | Body used | Verification runs over the exact bytes read from the request, before any parsing. | `wh:59-71` |

## 5. Mapping a delivery to an action (the pipeline, in order)

| # | Step | Outcome | Source |
|---|------|---------|--------|
| 5.1 | Flow lookup | Unknown `:flowKind`: **404** `{ error: "flow_not_found" }`. | `wh:48-51`; `wrt:327-336` [test] |
| 5.2 | Provider lookup | Provider not declared on the flow, or not configured on the mount: **404** `{ error: "webhook_not_found", provider }`. | `wh:53-57`; `wrt:338-347` [test] |
| 5.3 | Verify | Fails: **401** `invalid_signature`. | `wh:61-71` |
| 5.4 | Parse | Fails: **400** `invalid_payload`. | `wh:73-81` |
| 5.5 | Extract | `eventType` and `deliveryId` extractors run; a throw in either is logged, not an error. | `wh:83-116` |
| 5.6 | Handshake | `acknowledge` non-null: **200** with that body. | `wh:118-136` |
| 5.7 | Match | `on[eventType]`, then `when`. No match: **202** `{ status: "ignored", provider, eventType }`. A no-match gets 2xx so the provider does not retry an event the flow does not handle. | `wh:143-147`; `wrt:139-150` [test]; `dwh` "Routing" [doc] |
| 5.8 | Resolve | `input(event)` and `sessionId(event)` are awaited. Throw: **500** `{ error: "route_failed", message }`. | `wh:149-161` |
| 5.9 | Principal | `host.resolvePrincipal` with `source: "webhook"`, `rawBody`, and an envelope carrying `flowKind`, `action`, `sessionId`, `metadata`, `input`. A `PrincipalResolutionError` answers its own status with `{ error: "unauthorized", message }` (default status 401; 500 when `requireUser: false` and no `userId` could be resolved). | `wh:171-186`; `er:14-22`; `ho:326-349` |
| 5.10 | Validate | `host.validateDispatch` throws: **403** `{ error: "dispatch_rejected", message }` (a missing or invalid org, or a flow pinned to another owner). | `wh:202-206`; `ho:1565-1588` |
| 5.11 | Session | When `sessionId` is set, the session is created if absent (create-if-absent; of two simultaneous first deliveries one creates it and the other adopts it). Webhook session metadata is `{ source: "webhook", provider, eventType? }`. The create carries no initial state, so a flow whose sessions need some refuses it: answer is the create refusal's status (400, 403 or 404) with `{ error: <message>, field? }`, not retried-worthy. A store failure answers **503** `{ error: "session_unavailable" }`. | `wh:208-234`; `ws:1-67`; `packages/engine/src/context/session-birth.ts:179-191`; `packages/engine/src/routes/route-utils.ts:134-142`; `wrt:292-325` [test for the 503] |
| 5.12 | Dispatch | `host.dispatch` is fire-and-forget (`responseEmitter: null`, signal from the request). A synchronous throw: a `reject` refusal answers 200 `skipped` (3.7); anything else **503** `{ error: "flow_unregistered", message }`. | `wh:189-200`, `:236-247` |
| 5.13 | Acceptance | The route waits for `handle.accepted` (the request is durably recorded), never for `finished`. A rejection: a `reject` refusal answers 200 `skipped`; anything else **503** `{ error: "dispatch_not_durable" }`, so the provider retries. | `wh:249-271`; `wrt:220-246` [test]; `tt:208-258` |
| 5.14 | Answer | **202** `{ status: "accepted", provider, eventType, requestId }`. The block's output is not returned. The block runs after the response; an error after dispatch lands on the request record, not in the webhook response. | `wh:273-278`; `dwh` "Acknowledgement and async execution" [doc]; `goal` ("the route acks 202 even if the handler no-ops or fails async") |
| 5.15 | Provenance | The request record carries `source: "webhook"` and `metadata.webhook = { provider, eventType, deliveryId? }` (`deliveryId` only when the extractor returned one). The dispatched `action` name is the handler block's `name`, as provenance only: the runtime finds the handler through `metadata.webhook`, and a caller who posts that metadata to the public action endpoint cannot reach a webhook handler. | `wh:149-152`, `:163-169`; `wrt:104-125`, `:271-290` [test]; `ho:728-740`; `packages/engine/src/execution/resolve-entry.ts:6-17` |
| 5.16 | Timing | Because the block runs after the response, the answer returns inside provider budgets (Slack 3 s, GitHub 10 s) however long the block takes. | `wh:1-9`; `dwh` [doc] |
| 5.17 | Verified end to end | A signed Stripe `invoice.paid` POST ran the bound handler; session `customer-<id>` held the handler's effect; a forged signature returned 401 and made no session. | `wrt:395-458` [test]; `goal` |

### Response table (everything a sender can get back on a binding route)

| Status | Body | When |
|--------|------|------|
| 202 | `{ status: "accepted", provider, eventType, requestId }` | Verified, matched and durably recorded. |
| 202 | `{ status: "ignored", provider, eventType }` | No `on` key for the event type, or `when` was falsy or threw. |
| 200 | the `acknowledge` body | A handshake. No dispatch. |
| 200 | `{ status: "skipped", reason: "in_flight", requestId }` | Concurrency policy `reject` dropped a duplicate. |
| 400 | `{ error: "invalid_payload" }` | `parse` failed. |
| 400, 403, 404 | `{ error: <message>, field? }` | The flow refused to create the session. |
| 401 | `{ error: "invalid_signature" }` | `verify` returned `false` or threw. |
| 401 (or the resolver's status) | `{ error: "unauthorized", message }` | Principal resolution failed (no verified org, or no `userId` with `requireUser` true). |
| 403 | `{ error: "dispatch_rejected", message }` | `validateDispatch` refused. |
| 404 | `{ error: "flow_not_found" }` | No such flow. |
| 404 | `{ error: "webhook_not_found", provider }` | Flow does not declare the provider, or the mount does not configure it. |
| 500 | `{ error: "route_failed", message }` | `input` or `sessionId` threw. |
| 500 | `{ error: "unauthorized", message }` | `requireUser: false` with no `userId` resolved and no `defaultUserId`. |
| 503 | `{ error: "session_unavailable" }` | The session store failed. |
| 503 | `{ error: "dispatch_not_durable" }` | The request was not durably recorded. |
| 503 | `{ error: "flow_unregistered", message }` | `host.dispatch` threw something other than a `reject` refusal. |

Source for every row: `wh:39-279`, `cr:23-40`. The HTTP router's cross-site check and body-type check (`415`) do not apply: this route reads the raw bytes itself and the adapter's routes are matched first. A request with a method other than POST on this path is not served by this route. [`wa:76-80`; `fr:716-720`]

## 6. Who the caller is

| # | Fact | Source |
|---|------|--------|
| 6.1 | The sender is authenticated by the signature, not by a user. The route never reads a `userId` from the body, headers or query. | `wh:61-71`, `:171-186` [source]; `wrt:395-433` [test: session `userId` is `"system"` with no user in the request] |
| 6.2 | The run's `userId` comes from `host.resolvePrincipal`: the flow's `authentication.resolvePrincipal` when it has one, else the host-level resolver (default: read `userId` from a JSON body, which a webhook does not carry), then `authentication.defaultUserId` when the resolver returned no `userId`. | `ho:291-330`; `au:96-122`, `:130-170`; `wrt:373-433` [test] |
| 6.3 | `authentication: { defaultUserId: "system", requireUser: false }` is the documented webhook-only setup. `defaultUserId` is "substituted when `resolvePrincipal` returns no `userId`... machine-driven transports (webhooks, schedules) that have no end user". | `au:174-195`; `dwh`, `gst`, `ggh` [doc] |
| 6.4 | `requireUser: false` rejects, at flow-definition time, user-scope state, `client` blocks and user-scope resource declarations. The request record still carries a `userId` (the `defaultUserId`) and so does the session (`session.userId === "system"` in the test). | `au:78-89`, `:186-194`; `dwh` "`requireUser: false` opts the flow out..." [doc]; `ho:731-736`; `wrt:428-433` [test] |
| 6.5 | `requireUser` defaults to `true`: no `userId` after the `defaultUserId` fallback answers **401** `"Action request requires non-empty userId"`. With `requireUser: false` and still no `userId`, the answer is **500** (a configuration error, not a caller error). | `ho:327-348` |
| 6.6 | Every request needs a verified organization. With no `resolvePrincipal` configured anywhere, the framework supplies the development organization `DEFAULT_ORG_ID` (`"__fsd_default_org__"`) and logs one warning. A configured resolver must return a valid `orgId` that is not `DEFAULT_ORG_ID`, or the delivery answers **401** (`unauthorized`). A machine transport returns `{ orgId }` and lets `defaultUserId` name the user. | `ho:206-289`; `au:36-51`, `:117-126`; `wrt:66-72`, `:373-382` [test setup] |
| 6.7 | The resolver is called with `source: "webhook"`, the request, the `rawBody` and an envelope of `flowKind`, `action` (the block's name), `sessionId`, `metadata.webhook`, `input`. A resolver can therefore re-verify the signature itself. | `wh:171-181`; `au:94-115` |
| 6.8 | A derived session is bound to the principal that created it. A later delivery that resolves to the same session id must resolve to the same principal. | `dwh` "Sessions" (links to the authentication page's session consistency check) [doc]; `ws:35-67` (`userId`, `orgId` stored at creation) |
| 6.9 | The request is stamped with the flow instance addressed in the URL; a `sessionId` or `requestId` owned by another instance is refused with `FlowInstanceBindingMismatchError` before a record is written. The id is not a credential. | `dit` "The address on the envelope" [doc] |

## 7. Writing a transport

| # | Fact | Source |
|---|------|--------|
| 7.1 | A transport is an `InboundTransportAdapter`: `{ source: string, createBindings(host): TransportBindings }`. `createBindings` is pure and called once per host construction. | `tt:389-413` |
| 7.2 | `TransportBindings`: `routes?: TransportRoute[]`, `start?(): Promise<void> \| void` (called after all adapters' bindings are collected; a synchronous throw aborts startup, an async rejection is logged), `stop?(): Promise<void> \| void` (teardown). | `tt:274-288`; `fr:612-642` |
| 7.3 | `TransportRoute`: `{ method: "GET" \| "POST" \| "PATCH" \| "DELETE" \| "PUT", path, handler(req, { params }) => Promise<Response> }`. `:name` segments in `path` become `params`. | `tt:260-272`; `wa:76-80` |
| 7.4 | `source` is an open string stamped on every request record. Known values: `http`, `mcp`, `webhook`, `scheduled`, `notification`. The framework does not enforce an enum; DevTool shows known values with a label and badge and other values as the raw string. No built-in transport sends `notification`. Reserved: `cli` (the in-process entry point; a resolver call under it from a transport is refused with 401), `internal`, `task`. | `au:12-18`; `dit` "Known sources" [doc]; `ho:262-272`; `packages/engine/src/execution/transport-sources.ts` |
| 7.5 | The host surface an adapter uses: `registry`, `stores`, `logger?`, `resolvers?`, `usesExternalRunner`, `arbitratesExternalDispatch?`, `dispatch(envelope)`, `continueRequest(options)`, `validateDispatch(envelope)`, `resolvePrincipal(context)`. | `tt:294-387` |
| 7.6 | The order an adapter follows: `host.resolvePrincipal(context)` then build the `InboundRequestEnvelope` then `await host.validateDispatch(envelope)` then `host.dispatch(envelope)`. Adapters never do auth themselves. | `tt:364-387`; `wh:171-203`; `dit` "Auth" [doc]; `packages/testing/src/transports/conformance.ts:1-12` |
| 7.7 | `InboundRequestEnvelope` fields an adapter sets: `source`, `flowKind` (the instance id, passed through unchanged), `action`, `input`, `sessionId?`, `requestId?`, `tenantId?`, `principal`, `metadata?`, `rawBody?`, `responseEmitter?` (`null` for fire-and-forget), `signal?`. Also on the type: `orgId?`, `runtimeConfig?`, `resolvedActionCore?`, `attachments?`, which are set by the framework or by specific adapters. | `tt:77-201` |
| 7.8 | `host.dispatch(envelope)` is synchronous and returns an `InboundDispatchHandle`: `requestId`, `responseEmitter`, `liveStream` (null unless HTTP-shaped), `finished: Promise<ExecutionResult>`, and optional `accepted: Promise<void>` that resolves once the request is durably recorded and rejects if it could not be. An adapter that acknowledges before the run ends awaits `accepted`, not `finished`. It throws synchronously for an unknown flow kind or a malformed envelope. | `tt:208-258`, `:334-348` |
| 7.9 | A concurrency policy of `reject` surfaces as a `ConcurrencyRejectedError` (status 409, `key`, `inFlightRequestId`), either thrown from `dispatch` or rejecting `accepted`. A fire-and-forget adapter should map it to a benign "skipped" answer. | `er:55-75`; `cr:15-40` |
| 7.10 | The same concurrency policy governs every transport at one seam; an adapter needs no per-transport code. | `dit` "Concurrency policy enforcement" [doc]; `tt:208-258` |
| 7.11 | Mount a custom adapter in `createFlowApiRouter({ registry, stores, adapters: [...] })` or `createFlowState({ adapters })`. The built-in HTTP adapter and the scheduled endpoint are always mounted. A duplicate method and path throws `TransportRouteCollisionError` (1.8). | `fr:142-147`, `:599-626`; `dit` "Mounting a custom adapter" [doc] |
| 7.12 | To let a custom source use the public `retry`, `continue` and `resume` routes, pass `publicReentrySources: ["<source>"]` to `createFlowApiRouter` or `createFlowState`. | `packages/engine/src/flowstate/types.ts:313-324`; `pr:21-30`; `dit` [doc] |
| 7.13 | One adapter serves every flow in the registry; per-flow opt-in lives on the flow definition. | `dit` "Per-registry, not per-flow" [doc] |
| 7.14 | Conformance: `createInboundTransportConformanceTests({ name, factory, helpers: { buildEnvelope, teardown? } })` and `createMockTransportHost({ resolvePrincipal? })`, from `@flow-state-dev/testing/conformance`. The suite checks: a non-empty `source`; `createBindings` returns an object; the envelope built carries the adapter's `source`; it carries the resolved principal (`userId`); and teardown completes, when given. The mock host records `dispatchCalls` and `principalCalls`. | `packages/testing/src/transports/conformance.ts:41-160`; `wat:100-` [test, the webhook adapter runs the suite] |
| 7.15 | The echo example in `dit` (a `POST /api/flows/echo` adapter that awaits `handle.finished`) is a complete transport that streams nothing; it is the doc's own example. | `dit` "What an adapter looks like" [doc; not compiled in this pass] |

## 8. Examples that exist (for the page's one example)

| # | Fact | Source |
|---|------|--------|
| 8.1 | The shortest complete pair: a `billing` flow with `webhooks.stripe.on["invoice.paid"]` (`block`, `input`, optional `sessionId`) and `authentication: { defaultUserId: "system", requireUser: false }`, plus a host mount with `stripeWebhookVerifier(() => process.env.STRIPE_WEBHOOK_SECRET!)` and an `eventType` of `(payload) => payload.type`. | `dwh` "Minimal example" [doc]; `wrt:30-47`, `:350-433` [test] |
| 8.2 | The `kind: "billing"` flow and the `recordPaymentPipeline` block in `dwh` use names the layout in `user-docs.md` would put under `src/flows/billing/`. `recordPaymentPipeline` is not defined on the doc page; a page example must import or declare it. | `dwh:82-101`, `:354-376` |
| 8.3 | Mounting through Next: `createVercelNextHandler(flowstate)` from `@flow-state-dev/vercel/next`, in `app/api/flows/[...path]/route.ts`, exporting `GET, POST, PATCH, DELETE`. | `dwh:53-61` [doc]; `ggh` [doc] |
| 8.4 | Stripe's dashboard must be pointed at `POST <host>/api/flows/<kind>/webhooks/stripe`; the guides carry the provider-side setup steps. | `gst`, `ggh`, `gsl` [doc, not read in full; the page links to the guides rather than restating] |

## Stored data: the four questions

The page documents routing, not a store, but two things persist as a result of a delivery. Answers:

| Stored part | Who owns it | Who can see it | Where stored | How many |
|-------------|-------------|----------------|--------------|----------|
| The request record of a delivery (`source: "webhook"`, `metadata.webhook`, `userId`, `orgId`, `input`) | The flow instance named in the URL, run as the resolved principal's `userId` and `orgId` | The principal that owns it, read through the request routes; DevTool shows it with a webhook badge. A webhook-sourced request cannot be re-run from public routes (2.8). | The host's request store (in-memory unless the app installs SQLite or Postgres) | One per accepted delivery. A redelivery makes another; the route does not dedupe. An ignored delivery makes none. |
| The derived session (only when the binding sets `sessionId`) | The principal that first created it; later deliveries must resolve to the same principal (6.8) | That principal | The host's session store, with metadata `{ source: "webhook", provider, eventType? }` | One per distinct `sessionId`, found or created on each delivery. No `sessionId`: a fresh session per delivery. |

Sources: `ws:35-67`; `ho:728-740`; `wrt:395-433`. The store backends are named in other pages; nothing here pins which store a given app uses.

## Rows handed to R-32 by other pages' depth passes: carried, corrected, dropped

Seventeen rows came in from the other pages' records. Each was checked against the code above.

| Row (short) | Verdict | Where |
|-------------|---------|-------|
| Binding fields `block`, `input`; verification config; endpoint path; who the caller is (`defaultUserId` / `requireUser`) | Carried | 2.2-2.3, 1.3, 4, 6 |
| Failed signature returns 401 and runs nothing; verified event returns 202 immediately, block runs after | Carried | Lookup, 5.14 |
| `requireUser: false` rows still carry a `userId` from `defaultUserId` | Carried | 6.4 |
| Event routing key from the provider's `eventType`; GitHub's from `X-GitHub-Event`; sub-event in body narrowed by `when`; one row per binding field | Carried | 2.1-2.5, 3.2 |
| Binding `on` key never a dotted sub-event; false `when` is acknowledged and ignored | Carried | 2.1, 2.5 |
| `githubWebhookVerifier` checks `X-Hub-Signature-256` over the raw body; failed signature's response is the lookup | Carried | 4.2, Lookup |
| `deliveryId` extractor: `event.deliveryId` and `metadata.webhook.deliveryId`; throw logged and omitted; route does not dedupe | Carried, with one wording change: "so a handler can deduplicate on it" is kept only as "pass `event.deliveryId` into the block's input" (3.6). I found no accessor that gives a running block `metadata.webhook`, so the page must not say the block reads it from context. | 3.4, 3.6 |
| Delivery response 202 `accepted` with `provider, eventType, requestId`; 202 `ignored`; 503 `dispatch_not_durable` | Carried | 5.13-5.14, response table |
| Caller identity: `requireUser: false` with `defaultUserId` "runs a delivery as a system principal" | Carried with the phrase dropped. The code has no webhook "system principal": the run's `userId` is whatever the resolver returned, else `defaultUserId`, and an org is always required (6.2, 6.6). The row also leaves out the org requirement. | 6 |
| `sessionId` function maps an event to a session; omitted means no continuity | Carried | 2.4 |
| `stripeWebhookVerifier`: `Stripe-Signature`, signs `<ts>.<rawBody>`, five-minute tolerance, path pattern | Carried. Added that the tolerance is an absolute difference (a timestamp in the future also fails). | 4.1, 1.3 |
| Provider fields `eventType` and `deliveryId`; where the delivery id lands | Carried | 3.2, 3.4 |
| Response codes: 401 bad signature, 404 unknown provider or flow, 202 accepted; "200 only for a provider's `acknowledge` handshake" | Carried except the word "only". A second 200 exists: `{ status: "skipped", reason: "in_flight" }` for a concurrency `reject` (3.7). | Response table |
| Provider config on the adapter: `verify`, `eventType`, `deliveryId` | Carried and completed. The row omitted `parse` and `acknowledge`, which are also fields of `WebhookProviderDefinition`. | 3.1-3.5 |
| `acknowledge`: non-null `BodyInit` is a 200 body and skips dispatch; `null` continues; a throw is logged and read as `null` | Carried | 3.5 |
| `slackWebhookVerifier`: signed string, two headers, five-minute window, signing secret not bot token | Carried. The "signing secret, not bot token" clause rests on the Slack guide, not code. | 4.3 |
| Provider options `deliveryId`/`eventType`; "`metadata.webhook` fields available to the action"; 202-then-background timing | Carried except "available to the action": the fields are on the request record, and the code does not show a block reading them from its context (3.4, 5.15). | 3.2, 3.4, 5.14-5.16 |
| What the sender receives: 202 `accepted` JSON body; action output not returned; `ignored` when no binding matches; 401 bad signature | Carried | 5.14, response table |

Nothing handed over was dropped outright. The two corrections that change a claim are "200 only for acknowledge" (false) and "system principal" (no such webhook concept).

## Contradictions and gaps found

- `dwh` says the `deliveryId` "flows... through to the event your binding sees". True of `event.deliveryId`; I could not confirm a running block can read `metadata.webhook` itself. State only the event path.
- `dwh` "Acknowledgement and async execution" says 202 returns "immediately". The route in fact waits for durable recording (5.13) before it answers. Say "once the delivery is recorded", not "immediately".
- `dwh` lists 401 for a bad signature and 202 for ignored but not the 200 `skipped` answer for a concurrency `reject`, nor 400, 403, 500 or 503 answers. The response table above is complete against `wh`.
- `dit` "Known sources" says `notification` is used by no built-in transport; confirmed by search of `packages/*/src` (only the type comment and DevTool label mention it).
- `dwh` "Install and mount" says startup throws "in development". The code throws on router construction in any environment (1.7).
- The page plan's "writing a transport" table has no webhook-specific content beyond 7. The echo adapter example in `dit` was not type-checked in this pass; the page must compile any example it carries.
- `ActionCore`'s complete field list was not read (2.6). The pass-2 questions should not ask about binding fields beyond the five named plus `inputSchema`, `durable`, `tokenBudget`, `onCompleted`, `onErrored`.
- `packages/core/test/webhook-config-validation.test.ts` exists and its cases were not individually read; 1.10 is from the validator's source and doc comment.

## Revise round 1 (changes to the page and what backs them)

- Binding `block` accepts any block kind, evaluators included. `ty:234-239` (error text "any block kind"). Corrects 2.2's list of four.
- `createWebhookVerifier` with `format: "custom"` and no `parseSignature`: the verifier is built lazily, so the throw comes on the first verification, not when `createWebhookVerifier(...)` is called. Only a string secret is checked at build time. `wv:37-47`; `hv:102-104`, `:179-186`. Corrects 4.4 ("throws at build time").
- Timing (5.16): the answer does not wait for the block but does wait for the durable record (5.13), so a slow store can exceed a provider's budget. `wh:249-271`.
- `unauthorized` with status 500: the body's `error` is `unauthorized` whatever the status; 500 occurs when `requireUser: false` and no `userId` resolved. `wh:183`, `ho:327-348`.
- `flow_unregistered` is the body for any synchronous throw from `host.dispatch` other than a `reject` refusal, not only an unregistered flow; `message` carries the cause. `wh:236-247`.
- Service route counts: `events` is the number of normalized events, `ownerRuns` the runs fired, `refused` the runs refused by the row check (row missing, other org, other tenant, disabled); `failed` the runs not recorded. `route_failed` is the entry action erroring (runs already fired for earlier events stay fired); `route_incomplete` is routing stopped before it finished (a shutdown), retried and never acked. `wh:311-360`; `packages/engine/src/durability/owner-runs.ts:49-72`, `:85-90`. "Owner run" is described as a run for the owner of a stored row; the `subscription` example is read from the test fixture `wst:41`, not stated by a doc comment.
- Instance mismatch (6.9): `FlowInstanceBindingMismatchError` is raised in the host's ownership admission (`ho:589-630`), whose errors reach the route through `accepted` (`ho:811-816`), which the route answers `503 dispatch_not_durable` (`wh:255-270`); the session-create step can answer `503 session_unavailable` first. Both are 503. Which of the two a given case gets was read, not run. No test pins it.
- `liveStream` is `null` when the envelope's `responseEmitter` is `null` or the host runs requests externally; it is created only when `responseEmitter` is undefined and the host runs in process. `ho:924-955`.
- `continueRequest(options)` takes `requestId`, `resumeContext`, `signal`, `responseEmitter`, `includeTrace`, `leaseId?`; it re-enters a suspended request under its own id and rejects for a missing record or unregistered flow. `tt:40-50`, `:350-362`.
- Dropped from the page: a request with another method on the path (no response was confirmed); "per-flow opt-in lives on the flow" (7.13, no source in code or tests); "applied once, whatever the transport" (7.10, unobservable).
- Reference ownership: 16-28 of the pass 6 list. R-32 rows are on this page. `publicReentrySources` is listed once in full under Writing a transport and elsewhere linked to the HTTP API page. `ConcurrencyRejectedError` and the `actions: {}` clause stay here: concurrency.md carries no row for the error, and the example needs the clause.

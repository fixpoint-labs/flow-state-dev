# Facts: Receive Slack events (B-14, recipe, 650 words)

Revision 3: the "ignores the response body" line now says it holds for event deliveries (the url_verification challenge is echoed in the body), and the idempotency paragraph sits at the end of step 2.

Revision 2: the page no longer says "no reply channel" (Slack ignores the response body; replies go through Slack's Web API, out of scope), and `input` passes `e.deliveryId` as `eventId` into `ingestMessage` and the `saveMessage` stub, which keys its write on it (rows 24-25). Route order confirmed: `eventType` runs before `acknowledge`, and a non-null acknowledge returns before routing (routes.ts:87-136).

Revision 1: the page now declares `ingestMessage` (a handler, `src/flows/slack/blocks/ingest-message.ts`), uses the `src/` layout, `flows: [slackFlow()]`, makes `channel` required in `SlackEventCallback`, and states `when` as "skips events that carry no `user`" with no loop-protection claim (C5). Signing string, header names, the five-minute window, the `acknowledge` throw/null cases, the 202 body and the 3-second budget are deliberately left to the reference page (rows 8, 10, 16-18, 41-42); the page keeps the guarantee only. The page states the handshake in one short paragraph after the step-2 code.

Pass 1 fact sheet. Cites only: the existing guide (`apps/docs/guides/webhooks-slack-events.md`, the
page this one keeps), the existing reference (`apps/docs/docs/server/webhooks.md`,
`.../authentication.md`, `.../setup.md`), exported surface and doc comments, tests. Paths are from
the repo root. `engine` = `packages/engine`, `core` = `packages/core`.

This page is "as B-12, plus the URL challenge". Rows that are identical to the Stripe recipe's sheet
(`stripe.facts.md`, B-12) point at it by row number (`S#`); each was re-read against the code for
this sheet, and the page states each such fact once, in its own words. Rows that carry over from the
GitHub sheet are marked `G#`. Where the existing page and the code disagree, the code wins and the
row says so (see "Corrections to the existing page" at the end). Those rows must be fixed in the
recipe, not carried.

There is no test, example, lab or goal that runs Slack end to end. The nearest evidence is the
verifier tests (`engine/test/transports/createWebhookVerifier.test.ts:80-150`) and a route test that
exercises the `url_verification` handshake with a stand-in provider
(`engine/test/transports/webhook-routes.test.ts:181-199`). Everything about Slack's own behaviour
(what Slack sends, when, what its settings screens are called) comes from the existing guide alone;
those rows say so.

## Task and outcome

1. The task: when someone posts in a channel the bot is in, run a block in a `slack` flow that
   ingests the message. The server answers Slack's one-time URL verification, refuses any delivery
   whose signature does not verify, and reads the event type out of Slack's nested payload.
   [guide webhooks-slack-events.md:11-14]
2. The Events API is one-directional: Slack POSTs the endpoint when something happens (a message, a
   reaction, a member joining) and expects a fast 2xx. There is no reply channel; the webhook
   transport answers 202 and the block runs in the background. Use it to ingest Slack activity, not
   to hold a conversation. [guide webhooks-slack-events.md:16-22; S41; reference webhooks.md:289-295.
   "What Slack sends" is the guide's; not checkable in this repo.]
3. A webhook binding is an action in webhook form: it lives on `flow.webhooks`, never in
   `flow.actions`, has no action endpoint, is never an MCP tool, and runs only through a verified
   webhook. `defineFlow` still requires `actions`, so a flow that only receives webhooks declares
   `actions: {}`. [S2, S3, S4; reference webhooks.md:119-132]
4. What differs from Stripe and GitHub: Slack's event type is nested in the body, at
   `payload.event.type` for a real event and `payload.type` for the handshake and other envelopes
   (`event_callback`, `url_verification`). So the host's `eventType` needs a two-step read, and the
   host's `acknowledge` answers the handshake. [guide webhooks-slack-events.md:67-71;
   reference webhooks.md:178-181]

## Step 1: the handshake

5. Slack posts `{ "type": "url_verification", "challenge": "<string>" }` once, before it sends real
   events, and expects the `challenge` string echoed back. [guide webhooks-slack-events.md:24-35;
   reference webhooks.md:303-306. Slack's side; not checkable here.]
6. `acknowledge?: (event: WebhookInboundEvent) => BodyInit | null` is an optional member of
   `WebhookProviderDefinition`. When it returns a non-null body, the adapter responds `200` with that
   body and does not dispatch. Returning `null` lets routing continue. [engine/src/transports/webhook/
   createWebhookTransportAdapter.ts:47-52; routes.ts:121-136; reference webhooks.md:186-189]
7. Test: a `url_verification` body with `challenge: "abc123"` and an `acknowledge` that returns it
   gives `200`, response text `abc123`, and nothing dispatched.
   [engine/test/transports/webhook-routes.test.ts:181-199]
8. The response is `new Response(ack, { status: 200 })`, so a string challenge goes out as the
   response body unchanged, status 200. The code sets no content type of its own.
   [routes.ts:133-135] Flag: what content type Slack accepts is Slack behaviour, not cited; do not
   state one.
9. `acknowledge` runs after `verify` and after the body is parsed. So the handshake request must
   itself pass signature verification; with a wrong or missing secret the handshake gets
   `401 { error: "invalid_signature" }` and no challenge is echoed. [routes.ts:59-71, 73-81,
   118-136] Flag: that Slack signs its `url_verification` request is Slack behaviour, not cited here;
   the page may say "the check runs before the handshake, so a wrong signing secret fails here", which
   is observable from the code.
10. A throwing `acknowledge` is logged and treated as no handshake; routing continues, and with no
    `on` key for `url_verification` the response is `202 { status: "ignored" }`, so the challenge is
    not echoed. [routes.ts:119-132, 143-147; test webhook-routes.test.ts:201-217 (a throw falls through
    to routing)]. A handshake payload with no `challenge` field gives `p.challenge ?? null` = `null`,
    so the same `202 ignored`. [guide webhooks-slack-events.md:65]
11. A throwing `eventType` extractor is treated as null and does not stop the handshake, which runs
    after it. [routes.ts:87-97; test webhook-routes.test.ts:247-269 ("keeps the handshake reachable")]
12. The handshake is a property of the host's provider definition, not the flow. The flow never sees
    a `url_verification` request; the `on` map and `when` are not consulted for it. [routes.ts:118-147]

## Step 2: the host verifies, reads the nested type, and answers the handshake

13. `createWebhookTransportAdapter({ providers })` is one entry in `adapters` on `createFlowState`;
    each provider is a `WebhookProviderDefinition` keyed by the same name the flow's `webhooks` map
    uses (`slack`). [S17, S18, S20; createWebhookTransportAdapter.ts:29-64]
14. `createFlowState`, `inMemoryStores`, `createWebhookTransportAdapter` and `slackWebhookVerifier`
    are all exported from `@flow-state-dev/engine`, so one import statement covers them.
    [engine/src/index.ts:18, 44, 50; S19]. The options type `SlackWebhookVerifierOptions` is exported
    from `engine/src/host.ts:191` and `engine/src/transports/index.ts:99`, not from the package
    root `index.ts`; the page does not need to name it.
15. `slackWebhookVerifier(secret, options?)`: `secret` is a string or a `() => string` getter;
    `options` is `{ toleranceSeconds?: number; now?: () => number }`. `now` is a test seam, not for
    the page. [engine/src/transports/auth/createWebhookVerifier.ts:83-100]
16. The scheme: the signature is read from `X-Slack-Signature` (`v0=<hex>`), the timestamp from the
    separate `X-Slack-Request-Timestamp` header, and the HMAC-SHA256 is computed over
    `v0:<timestamp>:<rawBody>` under the secret and compared in constant time. [createWebhookVerifier.ts:
    90-132; test createWebhookVerifier.test.ts:80-98; reference webhooks.md:215-217]
17. A request is rejected (verify returns `false`, so the route answers 401) when: `X-Slack-Signature`
    is absent or empty; the timestamp header is absent or not purely digits (`/^\d+$/`, so `"123abc"`
    is rejected, not cleaned); the timestamp is more than `toleranceSeconds` from now in either
    direction; the HMAC does not match (wrong secret or a changed body). [createWebhookVerifier.ts:
    106-131; tests createWebhookVerifier.test.ts:104-150]
18. `toleranceSeconds` defaults to 300 (five minutes); `Infinity` disables the check. Test: a
    timestamp 1000 seconds old with a correct signature is rejected. [createWebhookVerifier.ts:84,
    101, 116; test createWebhookVerifier.test.ts:104-116]. Replay protection is therefore the
    timestamp window; the verifier keeps no record of seen signatures.
    Flag: the last clause is read from the code (no store); there is no test. Leave it out unless
    wanted.
19. The secret getter is resolved lazily on first verification and cached for the life of the
    verifier, so an env var set after import works, and changing it later needs a restart. Test:
    two verifications, getter called once. [createWebhookVerifier.ts:105-106, 126-128; test
    createWebhookVerifier.test.ts:170-186; reference webhooks.md:191-193]
20. The secret is Slack's "signing secret", not a bot token. [guide webhooks-slack-events.md:83-84.
    Where it is found on Slack's site (**Basic Information**) is Slack's UI; the guide's words, not
    checkable here.]
21. In the route, `verify` runs first on the raw bytes, before the body is parsed or any session
    exists. A `false` return or a throw gives `401 { error: "invalid_signature" }` and nothing runs.
    This is after the 404s for an unknown flow or provider. [S26, S40; routes.ts:48-71]
22. `eventType` for Slack: `payload.event?.type ?? payload.type ?? null`. A real event returns the
    nested type (`message`, `reaction_added`), the handshake returns `url_verification`, and a body
    with neither returns `null` (which the route answers `202 ignored`). The extractor's parameter is
    `unknown`, so the host narrows it with a local interface. Signature:
    `(payload: unknown, headers: Headers) => string | null`. [createWebhookTransportAdapter.ts:37-42;
    guide webhooks-slack-events.md:16-20, 67-71; routes.ts:143-147, 370]
23. `eventType` is required on the provider definition when any flow declares `on` for it. The
    adapter throws at startup if it is missing, and also if a flow declares a provider the mount did
    not configure. [S30; createWebhookTransportAdapter.ts:93-124]
24. `deliveryId: (payload) => payload.event_id` puts Slack's event id on `event.deliveryId` and on
    `metadata.webhook.deliveryId` of the request. The extractor type is `string | undefined`; an
    absent `event_id` simply leaves `deliveryId` off. A throwing extractor is logged and omitted, the
    delivery still dispatches. [createWebhookTransportAdapter.ts:45-46; routes.ts:98-108, 162-168;
    test webhook-routes.test.ts:270-290; S31. `event_id` is Slack's field name, taken from the guide
    (:20-24 and :72, :147-149); not checkable here.]
25. The framework surfaces the delivery id and does not de-duplicate. Providers deliver at least
    once, "especially after a slow response triggers a retry", so a block with a side effect keys
    its write on `deliveryId` or a natural key and no-ops on a repeat. [S32; reference
    webhooks.md:322-340, 337-340]. Flag: that Slack retries on a missed 3-second budget is stated in
    the guide (:145-146) and the reference (:297-300) as Slack's behaviour; cite those and say no more
    (no retry count or schedule exists in this repo).
26. Mounting: `createVercelNextHandler(flowstate)` from `@flow-state-dev/vercel/next` returns
    `{ GET, POST, PATCH, DELETE }` for `app/api/flows/[...path]/route.ts` (under `src/` in the
    layout). [S33; packages/vercel/src/next.ts:17-21; guide webhooks-slack-events.md:86-91]
27. The adapter mounts one route, `POST <basePath>/:flowKind/webhooks/:provider`; `basePath` defaults
    to `/api/flows`. A singleton flow's id is its `kind`, so `kind: "slack"` with provider `slack` is
    served at `/api/flows/slack/webhooks/slack`. [S34, S35; createWebhookTransportAdapter.ts:58-59,
    69-79; guide webhooks-slack-events.md:139]

## Step 3: the flow declares routing

28. Imports from `@flow-state-dev/core`: `defineFlow`, `defineWebhookBinding`, and `handler` for the
    block. `sequencer` (which the guide imports, :98) is not used in the guide's example and is not
    needed: `block` accepts any block kind directly. [core/src/types/webhooks.ts:154, 234-239;
    S5; stripe.facts.md C3]
29. The flow's `webhooks` map is keyed by provider name (`slack`); `on` is keyed by event type, matched
    by exact string equality against what the host's `eventType` returned. For Slack that is
    `message`, not `message.channels` (the latter is the name of the subscription in Slack's UI). A
    key that matches nothing is not an error. [S6; core/src/types/webhooks.ts:94-100, 262-263; guide
    webhooks-slack-events.md:95, 117, 142]
30. `defineWebhookBinding<SlackEventCallback>(...)` types `event.payload` in `input`, `sessionId` and
    `when`; compile-time only. The page declares `SlackEventCallback` itself; it is not a framework
    type. [S7; core/src/types/webhooks.ts:147-162]
31. Binding fields: `block` (required), `input(event)` (required, maps the event to the block's input,
    may be async), `sessionId(event)` (optional, may be async), `when(event)` (optional,
    synchronous). `input`'s result is validated against the binding's `inputSchema`, falling back to
    the block's own. [S8, S9; core/src/types/webhooks.ts:64-84]
32. Slack fields the example reads, all declared by the page's own interface: `event.type`,
    `event.text`, `event.user`, `event.channel`; plus the host reads `type`, `challenge`, `event_id`.
    These are Slack's field names, taken from the guide; not checked against Slack's schema here.
    [guide webhooks-slack-events.md:41-46, 100-108]
33. `when` skips the binding when it returns falsy; the delivery is answered
    `202 { status: "ignored", provider, eventType }` and nothing runs. A throwing `when` is a
    non-match, logged, also 202 (so `e.payload.event.user` on a payload with no `event` is a
    non-match, not a 500). `when` is synchronous. [S16; G9; routes.ts:143-147, 360-382; reference
    webhooks.md:113-115, 259-266]
34. No binding for the event type (a `reaction_added` while only `message` is bound), a null type, or a
    failing `when` all give the same `202 ignored`. So subscribing Slack to more event types than
    the flow binds is safe; the extras are acknowledged and dropped. Providers retry non-2xx, which
    is why ignored events are 2xx. [S38; routes.ts:143-147; reference webhooks.md:259-262]
35. Flow auth for a flow with no end user: `authentication: { defaultUserId: "slack-bot",
    requireUser: false }`; the run belongs to the resolved principal `userId: "slack-bot"`.
    `requireUser: false` bars `user.stateSchema`, `user.client` and `scope: "user"` resources on the
    flow (`defineFlow` throws). [G13; S12, S13, S45; guide webhooks-slack-events.md:113;
    engine/test/transports/webhook-routes.test.ts:429]. The mapped `input` must not carry a `userId`
    key: with no resolver configured the default resolver reads `userId` from `envelope.input`, so a
    payload field flowing into it lets the sender name the run's user. [S47]. The example's input
    keys are `text`, `user`, `channel`: `user` is Slack's user id and is not read as the run's user
    (the key the resolver reads is `userId`). [engine/src/transports/auth/
    defaultBodyUserIdPrincipalResolver.ts:31-44, 78-92]
36. The flow carries no secret and no signature code; the host supplies them, so the flow stays
    browser-safe. [S14; reference webhooks.md:15-19]
37. Registration validation at `defineFlow`: a provider with no `on`, a binding with no `block`,
    `input` not a function, an empty provider or event key. [S15; core/src/types/webhooks.ts:179-263]
38. `sessionId: (e) => \`channel-${e.payload.event.channel}\`` gives one session per Slack channel:
    the first delivery for that id creates the session, later ones reuse it, so a channel's events
    accumulate in one session. Two simultaneous first deliveries: one creates, the other adopts.
    Omitted, each delivery gets a fresh ephemeral session. [S50, S51; reference webhooks.md:268-281;
    session-resolver.ts:1-12]. Flag: `channel` is optional in the guide's interface, so a payload
    with no channel yields the id `channel-undefined`. Slack always sending one on `message` events
    is Slack behaviour, not cited here; the page's interface should make `channel` required (the
    page owns its interface) or the page says nothing about it.
39. The block that ingests: the guide names `ingestPipeline` (:118) and an "`ingestMessage` action"
    (:12), neither declared anywhere. The page declares a handler in its own file
    (`src/flows/slack/blocks/ingest-message.ts` in the layout) with an `inputSchema` matching
    `{ text, user, channel }`. A block is not an action; the binding is the action in webhook form.
    [stripe.facts.md C2, C3; core/src/types/webhooks.ts:52-63]. What the handler does with the text
    is the reader's own (`ledger` in the Stripe page is the model: an imported helper described in a
    clause).

## Step 4: point Slack at the endpoint

40. In the Slack app's **Event Subscriptions** page: turn events on, set the **Request URL** to
    `https://<host>/api/flows/slack/webhooks/slack`; Slack posts the handshake immediately and shows
    the URL as Verified; under **Subscribe to bot events** add `message.channels` and any others,
    then reinstall the app. [guide webhooks-slack-events.md:134-143] Slack's UI is not in this repo;
    keep these as the guide states them, no more.
41. Slack's response budget is three seconds; the route answers 202 before the block runs, so a slow
    block does not make Slack time out. The reference gives Slack 3 seconds and GitHub 10.
    [reference webhooks.md:297-301; routes.ts:1-9, 273-278; guide webhooks-slack-events.md:145-147]
42. Success response: `202 { status: "accepted", provider, eventType, requestId }`, sent before the
    block finishes. The 202 is held until the request is durably recorded; if recording fails the
    response is `503 { error: "dispatch_not_durable" }` so the provider retries. [S41, S42;
    routes.ts:249-278; test webhook-routes.test.ts:219-245]

## Step 5: test it locally (optional; the existing guide has no test step)

43. A signed Slack request can be built with no Slack account: take a body, pick a Unix-seconds
    timestamp `ts`, compute `v0=` + hex HMAC-SHA256 of `v0:<ts>:<body>` under the signing secret, and
    send headers `x-slack-signature` and `x-slack-request-timestamp: <ts>`. The unit test's
    `slackSig` does exactly this. [test createWebhookVerifier.test.ts:81-87, 89-102] The timestamp
    must be within 300 seconds of the server clock (row 18).
44. Expected results of that request against the mounted route, from the code: the handshake body
    `{"type":"url_verification","challenge":"abc"}` gives `200` with body `abc`; a `message` event
    body gives `202 { status: "accepted", provider: "slack", eventType: "message", requestId }`; a
    forged or stale signature gives `401 { error: "invalid_signature" }` and creates no session; a
    `reaction_added` with no binding gives `202 { status: "ignored" }`. [routes.ts:69-71, 133-135,
    143-147, 273-278; S27 (Stripe's forged-signature test, same route)]
    Flag: no test drives the Slack scheme through the route; the 200 echo is tested with a stand-in
    provider (row 7) and the Slack verifier is tested on its own (rows 16-19). Run the claim in this
    row against a real mounted route before the page states a transcript.
45. Failure codes a reader hits and what each means: 401 `invalid_signature` (wrong signing secret,
    stale or non-integer timestamp, or a body changed in transit); 404 `flow_not_found` (flow id in
    the URL); 404 `webhook_not_found` (provider segment not declared on the flow or not on the
    mount); 400 `invalid_payload` (body is not JSON); 202 `ignored` (event type has no binding or
    `when` failed). [S59; routes.ts:48-57, 69-71, 80, 143-147]. Reference material; the page links
    to `reference/webhooks` for them and states at most the 401 and the 202 `ignored`.
46. Two requests differ from the Stripe recipe in what a reader sees on first setup: with a wrong
    secret the **Request URL** cannot verify (row 9), and with `eventType` or `on` key mismatched
    (`message.channels` instead of `message`) Slack shows the URL Verified and every event is
    `202 ignored`. [routes.ts:143-147, 118-136; guide webhooks-slack-events.md:140-142]. Flag: the
    second is a consequence of the code; how Slack displays it is Slack's.

## Stored parts: four questions

The page's stored parts are the session a delivery creates (the `sessionId` the example sets) and the
request record each accepted delivery leaves. The page defines no collection, resource or state
schema. Slack-side data (messages, channels) is not stored by the framework; only what the block
does with the input is, and that is the reader's own.

47. **Session** `channel-<slack channel id>`:
    - Who owns it: the resolved principal at creation, `userId: "slack-bot"` and the resolved
      `orgId`; immutable afterwards. [S54; session-resolver.ts:50-58; reference authentication.md:
      502-513]
    - Who can see it: requests resolving to that same user and org; a different identity gets
      "Unknown session" (404 over HTTP). A browser user does not see it unless they resolve to
      `slack-bot` in the same org. [reference authentication.md:509-513]
    - Where it is stored: the session store of the `stores` profile the flow runs on;
      `inMemoryStores()` in the example does not survive a restart (the `default` profile is
      in-memory when `stores` is omitted). The row records `metadata: { source: "webhook",
      provider: "slack", eventType: "message" }`, the event type of the delivery that created it.
      [session-resolver.ts:60-64; createFlowState.ts:233-237; reference setup.md:91]
    - How many: one per distinct `sessionId` value, so one per Slack channel the bot hears from. With
      no `sessionId`, a fresh ephemeral session per delivery. [reference webhooks.md:268-281]
48. **Request record** per accepted delivery: carries `metadata.webhook = { provider, eventType,
    deliveryId? }` (so the Slack `event_id`) and the request's outcome; owned by the same principal,
    kept in the request store; the 202 body's `requestId` names it. Errors after dispatch land here
    and surface in DevTool, not in the webhook response. [S55; routes.ts:162-168, 273-278; reference
    webhooks.md:289-295, 326-328]. Visibility to readers is not cited beyond DevTool; say nothing more.
49. If the flow's session state cannot be created from nothing (a required field, or a create check
    wanting initial state) the webhook cannot create the session and the route answers with the
    session-create-refused response; if the session store is down, `503 { error:
    "session_unavailable" }`. The example flow declares no session state, so neither applies.
    [S53; session-resolver.ts:28-34; routes.ts:218-233] Reference material; not on the page.
50. A session derived this way is bound to the principal that created it; a later delivery resolving
    to a different user or org is refused. With one `defaultUserId`, all deliveries resolve alike.
    [S52; reference authentication.md:502-523; reference webhooks.md:283-287] Reference material.

## Corrections to the existing page (code wins)

C1. `createFlowState({ flows: { slack: slackFlow() } })` (guide :46) throws `FlowStateConfigError`:
    `flows` is a list of instances, "The keyed record form was removed". Write `flows: [slackFlow()]`.
    A singleton's id is its `kind`, so the URL is unchanged. [engine/src/flowstate/createFlowState.ts:
    372-377; reference setup.md:200 shows the list form]. Same as stripe.facts.md C1.
C2. The guide's flow uses `ingestPipeline` (:118), which is not imported or declared. Declare a
    handler in its own file and import it by relative path. [user-docs.md "No phantom names"]
C3. The guide calls the block an "`ingestMessage` action" (:12). It is a block; the binding is the
    action in webhook form. [core/src/types/webhooks.ts:52-63]
C4. The guide imports `sequencer` (:98) and never uses it. Drop it.
C5. The guide's `when` comment says "Ignore the bot's own messages to avoid a loop" (:119) over
    `e.payload.event.user !== undefined`. The code only tests that `user` is present; it does not
    identify the bot. Whether Slack omits `user` on a bot's own messages is Slack behaviour, not
    cited here. The page should say what the predicate does ("skips events that carry no `user`")
    and not claim loop protection. [routes.ts:373-374; core/src/types/webhooks.ts:78-83]. Flag for
    the page owner: if loop protection is wanted, compare `event.user` to the bot's Slack user id
    held in your own config; that is the reader's value, no framework API, and the claim is not
    otherwise checkable here.
C6. The guide's file paths (`lib/flowstate.ts`, `flows/slack.ts`) and `@/` imports do not match the
    layout in user-docs.md ("Code examples"). Use `src/flows/slack/flow.ts`,
    `src/flows/slack/blocks/ingest-message.ts`, a host file (`src/lib/flowstate.ts` as in the Stripe
    recipe, or `fsdev.config.ts`; the writer picks and matches B-12), and
    `src/app/api/flows/[...path]/route.ts`; relative imports. Match the Stripe recipe (stripe.md) so
    the three webhook recipes agree.
C7. The guide imports from `@flow-state-dev/engine` in two statements (:40-44); one statement
    covers all four names (row 14).
C8. The guide's front matter has no `type` and the opening sentence ("This guide covers Slack's
    **Events API**...") is copied into the revamp page's `description`. The page needs a task-shaped
    opening (what you want, then what you have at the end) as in stripe.md. [user-docs.md "Page
    types and budgets"]
C9. The guide's `SlackEnvelope` types `challenge` and `event_id` optional on one flat interface, and
    the flow's `SlackEventCallback` is a second, separate interface for the same payload family. Two
    local interfaces are fine (host narrows `unknown`; flow types `payload`), but the page should say
    which is which in a clause, or use one. [guide :41-46, 100-108]. Writer's call; no behaviour at
    stake.

## Not cited, so not on the page

- Slack's retry count, schedule, headers (`X-Slack-Retry-Num` etc.), and rate limits.
- What Slack sends on `message` events with subtypes (edits, bot posts, joins), and that `user` is
  absent on some. Not cited in this repo.
- Slack's UI labels beyond the three the guide names (**Basic Information**, **Event Subscriptions**,
  **Request URL**, **Subscribe to bot events**); keep them as the guide has them.
- How to expose a local server to Slack (a tunnel). Not in this repo.
- Anything about how the adapter is built beyond observable responses.

## Links the page needs (targets exist or are planned)

- `reference/webhooks` (sitemap): provider-field table, response codes, `parse`, `createWebhookVerifier`,
  `toleranceSeconds`, idempotency, concurrency `skipped`, session-create refusal, org rules.
- B-12 (Stripe) and B-13 (GitHub) recipes: the other two receivers, for the shape this page shares
  (`./stripe.md`, `./github.md`).
- C-17 (sitemap): serving flows. Current page: `docs/contributing/docs-revamp/pages/concepts/serving-flows.md`.

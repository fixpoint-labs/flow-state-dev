# Facts: Receive a GitHub webhook (B-13, recipe, 600 words)

Pass 1 fact sheet. Cites only: the existing guide (`apps/docs/guides/webhooks-github.md`, the page
this one keeps), the existing reference (`apps/docs/docs/server/webhooks.md`, `.../authentication.md`,
`.../setup.md`), exported surface and doc comments, tests. Paths are from the repo root. `engine` =
`packages/engine`, `core` = `packages/core`.

This page is "as B-12". Rows that are identical to the Stripe recipe's sheet
(`stripe.facts.md`, B-12) point at it by row number (S#) rather than repeat the evidence; they were
re-read against the code for this sheet. The page states each such fact once, in its own words.
Where an existing page and the code disagree, the code wins and the row says so (see "Corrections
to the existing page" at the end). Those rows must be fixed in the recipe, not carried.

## Task and outcome

1. The task: when someone opens a pull request on a repository, run a block in a `repo` flow that
   reviews it. GitHub signs each delivery; the server refuses a delivery whose signature does not
   verify. [guide webhooks-github.md:8-16]
2. What differs from Stripe: GitHub sends every webhook for a repository to one URL and names the
   event in the `X-GitHub-Event` header (`pull_request`, `push`, `issues`), not in the body. The
   sub-event (`opened`, `closed`, `synchronize`) is the body's `action` field. So routing has two
   steps: the host's `eventType` reads the header, and the binding's `when` narrows on
   `payload.action`. [guide webhooks-github.md:18-28; reference webhooks.md:178-181;
   engine/src/transports/webhook/createWebhookTransportAdapter.ts:37-42]
3. A webhook binding is an action in webhook form: it lives on `flow.webhooks`, never in
   `flow.actions`; it has no action endpoint, is not listed among actions, is never an MCP tool,
   and runs only through a verified webhook. `defineFlow` still requires `actions`, so a flow that
   only receives webhooks declares `actions: {}`. [S2, S3, S4; reference webhooks.md:119-132]

## Step 1: declare the binding (the flow)

4. Imports from `@flow-state-dev/core`: `defineFlow`, `defineWebhookBinding`, and the block
   builder the example uses (`handler`). [core/src/types/webhooks.ts:154; S5]
5. The flow's `webhooks` map is keyed by provider name (`github`); `on` is keyed by event type.
   The `on` key is `pull_request`, the value of `X-GitHub-Event`. It is not `pull_request.opened`;
   a key containing the action never matches, and a wrong key is not an error (keys are not
   validated against any provider vocabulary). [S6; guide webhooks-github.md:67-70;
   core/src/types/webhooks.ts:94-100, 262-263]
6. `defineWebhookBinding<PullRequestEvent>(...)` types `event.payload` in `input`, `sessionId` and
   `when`; compile-time only, a passthrough at runtime. The page declares `PullRequestEvent`
   itself; it is not a framework type. [S7; core/src/types/webhooks.ts:147-162;
   reference webhooks.md:147-149]
7. Binding fields: `block` (required, any block kind), `input(event)` (required, maps the event to
   the block's input, may be async), `sessionId(event)` (optional, may be async), `when(event)`
   (optional, synchronous predicate). [S8; core/src/types/webhooks.ts:64-84]
8. `input`'s result is validated against the binding's `inputSchema`, falling back to the block's
   own `inputSchema`. [S9; core/src/types/webhooks.ts:66-71]
9. `when: (e) => e.payload.action === "opened"` is the reference's own example of narrowing a
   coarse event type. A PR whose action is `closed` or `synchronize` fails the predicate; the
   delivery is answered `202 { status: "ignored", provider, eventType }` and nothing runs. A
   throwing `when` is a non-match (logged), also 202. [reference webhooks.md:113-115, 259-262;
   core/src/types/webhooks.ts:78-83; engine/src/transports/webhook/routes.ts:143-147, 360-382]
10. The event handed to `input`, `sessionId` and `when` is a `WebhookInboundEvent`: `provider`,
    `eventType` (`string | null`), `payload`, `headers` (`Headers`), `rawBody`, optional
    `deliveryId`. [S10; core/src/types/webhooks.ts:37-50]
11. Fields of the GitHub `pull_request` payload the example reads, all declared by the page's own
    `PullRequestEvent`: `action`, `number`, `pull_request.title`, `pull_request.html_url`,
    `pull_request.head.sha`, `repository.full_name`. These are GitHub's field names, taken from the
    existing guide; they are not checked against GitHub's schema in this repo.
    [guide webhooks-github.md:34-39, 52-58]
12. `sessionId: (e) => \`${full_name}#${number}\`` gives one session per pull request: the first
    delivery for a key creates the session, later ones reuse it. Two simultaneous first deliveries:
    one creates, the other adopts. Omitted, each delivery gets a fresh ephemeral session.
    [S50, S51; reference webhooks.md:268-281; engine/src/transports/webhook/session-resolver.ts:1-12]
    Flag: no test uses an id containing `#` or `/`; the code applies no format check that I found,
    but do not claim the form works beyond the existing guide.
13. Flow auth for a flow with no end user: `authentication: { defaultUserId: "github-bot",
    requireUser: false }`. The run belongs to the resolved principal, `userId: "github-bot"`, as
    the Stripe test shows for `"system"`. `requireUser: false` bars `user.stateSchema`,
    `user.client` and `scope: "user"` resources on the flow (`defineFlow` throws). [guide
    webhooks-github.md:44; S12, S13, S45; engine/test/transports/webhook-routes.test.ts:429]
14. The flow carries no secret and no signature code; the host supplies them, so the flow stays
    browser-safe. [S14; reference webhooks.md:15-19]
15. Registration validation at `defineFlow`: a provider with no `on`, a binding with no `block`,
    `input` not a function, an empty provider or event key. [S15; core/src/types/webhooks.ts:179-263]

## Step 2: verify the signature, read the header (the host)

16. `createWebhookTransportAdapter({ providers })` is one entry in `adapters` on `createFlowState`;
    each provider is a `WebhookProviderDefinition` keyed by the same name the flow uses (`github`).
    [S17, S18, S20; engine/src/transports/webhook/createWebhookTransportAdapter.ts:29-64]
17. `createWebhookTransportAdapter`, `githubWebhookVerifier`, `createFlowState` and
    `inMemoryStores` are exported from `@flow-state-dev/engine`. [engine/src/index.ts:18, 44, 48;
    S19]
18. `githubWebhookVerifier(secret)`: `secret` is a string or a `() => string` getter; the getter is
    resolved lazily on first use and cached, so an env var set after import works. It reads the
    `X-Hub-Signature-256` header (`sha256=<hex>`), computes HMAC-SHA256 of the raw body under the
    secret, and compares in constant time. [engine/src/transports/auth/createWebhookVerifier.ts:36-48,
    69-81; engine/src/transports/auth/createHmacVerifier.ts:91-134; reference webhooks.md:191-193,
    213-214, 235-236]
19. It has no timestamp check. GitHub's scheme signs the body alone, so the verifier applies no
    replay window, unlike Stripe's and Slack's 300 seconds. [createWebhookVerifier.ts:74-81 (`format:
    "raw"`, no `toleranceSeconds`); createHmacVerifier.ts:115 (tolerance applies only when the
    parsed signature carries a timestamp, and `raw` parsing carries none, :140-148)]
20. Returns `false` for: header absent or empty; header not starting with `sha256=`; HMAC mismatch
    (wrong secret). Tests: valid signature true; wrong secret false; hex with no `sha256=` prefix
    false. [createHmacVerifier.ts:106-113, 140-148; engine/test/transports/createWebhookVerifier.test.ts:60-77]
21. In the route, `verify` runs first, on the raw bytes, before the body is parsed or any session
    exists. `false` or a throw gives `401 { error: "invalid_signature" }` and nothing runs. This
    comes after the 404s for an unknown flow or provider. [S26, S40; engine/src/transports/webhook/routes.ts:48-71]
22. `eventType: (_payload, headers) => headers.get("x-github-event")` reads the event type off the
    header. `Headers.get` is case-insensitive. `eventType` has type `(payload, headers) =>
    string | null`; `headers.get` returns `string | null`, so it fits. [createWebhookTransportAdapter.ts:37-42;
    engine/test/transports/webhook-service-route.test.ts:74-78 (the same extractor in a test)]
23. `eventType` is required on the provider definition when any flow declares `on` for it. The
    adapter throws at startup if it is missing, and also if a flow declares a provider the mount
    did not configure. [S30; createWebhookTransportAdapter.ts:93-124]
24. `deliveryId: (_payload, headers) => headers.get("x-github-delivery") ?? undefined` puts GitHub's
    per-delivery id on `event.deliveryId` and `metadata.webhook.deliveryId`. The `?? undefined` is
    needed because the field's type is `string | undefined`, not `string | null`. [S31;
    createWebhookTransportAdapter.ts:45-46; webhook-service-route.test.ts:74-78]
25. The framework surfaces the delivery id and does not de-duplicate. GitHub can deliver the same
    event more than once (a redelivery from "Recent Deliveries" repeats the delivery id), so a
    block with a side effect keys its write on `deliveryId` or on a natural key (repo and PR
    number). [S32; reference webhooks.md:322-340]
    Flag: that GitHub's redelivery keeps the same `X-GitHub-Delivery` is GitHub behaviour, not
    cited in this repo; leave it out. The reference's "providers deliver at-least-once" is citable.
26. Mounting: `createVercelNextHandler(flowstate)` from `@flow-state-dev/vercel/next` returns
    `{ GET, POST, PATCH, DELETE }` for `app/api/flows/[...path]/route.ts`. [S33; vercel/src/next.ts:17-21;
    guide webhooks-github.md:110-115]
27. The adapter mounts one route, `POST /api/flows/:flowKind/webhooks/:provider`; `basePath`
    defaults to `/api/flows`. A singleton flow's id is its `kind`, so `kind: "repo"` is served at
    `/api/flows/repo/webhooks/github`. [S34, S35]

## Step 3: register the webhook on GitHub

28. In the repository's (or organization's) settings, add a webhook with: Payload URL
    `https://<host>/api/flows/repo/webhooks/github`; Content type `application/json`; Secret, the
    same value the host's getter returns (`GITHUB_WEBHOOK_SECRET`); events: "Pull requests", or
    "Send me everything" and let `when` filter. [guide webhooks-github.md:119-126] GitHub's UI is
    not in this repo; the page keeps these as the existing guide states them.
29. Content type matters: the default parse is `JSON.parse` of the UTF-8 body, so a delivery sent
    as `application/x-www-form-urlencoded` (body `payload=...`) cannot parse and gets
    `400 { error: "invalid_payload" }`. [engine/src/transports/webhook/routes.ts:73-81;
    reference webhooks.md:182-183]. Flag: the claim about what GitHub sends for the form content
    type is GitHub behaviour, not cited here; the page may say only "choose `application/json`"
    and that a body that is not JSON gets 400.
30. A delivery with event type `ping` (or any event with no `on` key, such as `push` here) is
    answered `202 { status: "ignored" }`. [routes.ts:143-147, 365-383]. Flag: that GitHub sends a
    `ping` on webhook creation is GitHub behaviour, not cited here; say only that an event with
    no binding is acknowledged and ignored, so selecting more events than you bind is safe.
31. Why ignored is 2xx: providers retry on non-2xx. [reference webhooks.md:259-262]. The reference
    cites GitHub's response budget as 10 seconds; the route answers 202 before the block runs, so
    a slow block does not make GitHub time out. [reference webhooks.md:297-301; routes.ts:273-278]
32. Success response: `202 { status: "accepted", provider, eventType, requestId }`, sent without
    waiting for the block to finish. Errors after dispatch land on the request record and surface
    in DevTool, not in the response. [S41; routes.ts:273-278; reference webhooks.md:289-295]
33. The 202 is held until the request is durably recorded; if recording fails, `503 { error:
    "dispatch_not_durable" }` so the provider retries. (Reference material.) [S42; routes.ts:249-271]

## Step 4: test it

34. Failure codes a reader hits while setting up, and what each means: 401 `invalid_signature`
    (secret on GitHub differs from the host's, or the body was altered); 404 `flow_not_found` (flow
    id in the URL); 404 `webhook_not_found` (provider segment not `github`, or not on the mount);
    400 `invalid_payload` (body not JSON); 202 `ignored` (no `on` key for the event, or `when`
    false). [S59; routes.ts:48-57, 69-71, 80, 143-147]
35. GitHub's "Recent Deliveries" tab on the webhook settings page shows each delivery's request and
    response and has a redeliver button, so a 202 can be confirmed and a payload replayed. [guide
    webhooks-github.md:127-130]. GitHub's UI is not in this repo; keep as the existing guide
    states it.
36. A signed request can be made without GitHub: HMAC-SHA256 of the exact body bytes under the
    secret, sent as `x-hub-signature-256: sha256=<hex>` with `x-github-event: pull_request`.
    `webhook-service-route.test.ts` builds exactly this request against
    `http://test/api/flows/svc/webhooks/github`. [webhook-service-route.test.ts:98-102;
    createWebhookVerifier.test.ts:61-65]
    Expected: valid signature and a `pull_request` body with `action: "opened"` gives 202; a forged
    signature gives 401 and no session. (The 401-and-no-session behaviour is tested for Stripe,
    webhook-routes.test.ts:434-458; the route code is provider-independent, routes.ts:59-71.)
    Flag: no existing test sends a GitHub `pull_request` through a `repo` flow end to end. The
    recipe's example is not run by any test; the writer must type-check it, and an `fsdev run`
    or a scratch test is the only way to see the 202.

## Which user the run belongs to, and stored parts (four questions)

37. User: the principal resolved with `source: "webhook"`. With no resolver anywhere and
    `requireUser: false`, `defaultUserId: "github-bot"` applies. A flow's own
    `authentication.resolvePrincipal` wins over the host's. [S45, S46; engine/src/transports/host/
    createInboundTransportHost.ts:287-298, 326-329]
38. Do not put a `userId` key in the object `input` returns: with no resolver configured, the
    default resolver reads `userId` from `envelope.input`, which is that object, so a payload field
    flowing into it would let the sender choose the user. The example's input has no `userId`.
    [S47; engine/src/transports/auth/defaultBodyUserIdPrincipalResolver.ts:31-44, 78-92]
    Flag: the "sender chooses the user" half is inference from the resolver reading
    `envelope.input`.
39. **Session** `<owner/repo>#<number>`:
    - Who owns it: the resolved principal at creation (`userId: "github-bot"`, the resolved
      `orgId`), immutable afterwards. [S54; session-resolver.ts:50-58]
    - Who can see it: requests resolving to that same user and org; a different identity gets
      "Unknown session" (404 over HTTP). A later delivery resolving to another user or org is
      refused. [S52, S54; reference authentication.md:502-523]
    - Where it is stored: the session store of the `stores` profile the flow runs on;
      `inMemoryStores()` in the example does not survive a restart. Row metadata:
      `{ source: "webhook", provider: "github", eventType: "pull_request" }`. [S54;
      session-resolver.ts:60-64; webhook-routes.test.ts:430; engine/src/flowstate/createFlowState.ts:233-237]
    - How many: one per distinct `sessionId` value, so one per pull request. With no `sessionId`,
      one ephemeral session per delivery. [S54; reference webhooks.md:268-281]
40. **Request record** per accepted delivery: `metadata.webhook = { provider, eventType,
    deliveryId? }` and the outcome; owned by the same principal, in the request store; the 202
    body's `requestId` names it. Say nothing beyond "errors surface in DevTool". [S55;
    routes.ts:163-169, 273-278; reference webhooks.md:289-295]
41. The page defines no collection and no resource of its own. The block the example runs
    (`reviewPullRequest`) is the reader's; what it stores is theirs to declare.

## Corrections to the existing page (code wins)

C1. `createFlowState({ flows: { repo: repoFlow() } })` (guide :86) throws `FlowStateConfigError`:
    `flows` is a list of instances, "The keyed record form was removed". Write
    `flows: [repoFlow()]`. A singleton's id is its `kind`, so the URL is unchanged.
    [engine/src/flowstate/createFlowState.ts:372-377; S1-C1]
C2. The flow example uses `reviewPipeline`, never defined or imported, and imports `sequencer` it
    never uses. No phantom names: declare or import the block (one `handler` whose output the page
    shows, or an import by relative path) and drop `sequencer`. `block` accepts a handler directly.
    [guide webhooks-github.md:33, 51; core/src/types/webhooks.ts:234-239; S-C3, S-C4]
C3. The guide says the flow "runs a `reviewPullRequest` action". It is a block; the binding is
    the action in webhook form. Name the block `reviewPullRequest` consistently, or say "block".
    [guide webhooks-github.md:13; S-C3]
C4. The guide's `createWebhookTransportAdapter` and `githubWebhookVerifier` are imported in two
    separate `import` statements from the same package (lines 78-83); one import suffices.
    [guide webhooks-github.md:78-83]
C5. The guide says GitHub is "a useful second example" (diff narrative against the Stripe page):
    cut. It also says `eventType` "exists" because of GitHub: cut (design defense).
    [guide webhooks-github.md:9-10, 106]
C6. The guide's "What you have" and the "header discriminator" section repeat each other and the
    code comments; the two-step routing is stated once.
C7. A valid delivery is `202`, not 200. 200 appears only for an `acknowledge` handshake body or a
    `skipped` concurrency refusal. The guide says 202 correctly. [routes.ts:273-278; S-C5]
C8. File paths in the guide (`flows/repo.ts`, `lib/flowstate.ts`) do not match the layout in
    user-docs.md "Code examples". Use `src/flows/repo/flow.ts`, `src/flows/repo/blocks/review-pull-request.ts`;
    the host file is the writer's call, as in the Stripe sheet (S-C6).
C9. The guide links the reference as `/docs/server/webhooks`; the revamp plan's target is
    `reference/webhooks` (sitemap). Use the planned slug.

## Not cited, so not on the page

- GitHub's retry or redelivery rules, what GitHub sends on webhook creation, GitHub's response
  budget beyond the reference's "10 seconds", which events GitHub offers, how GitHub's UI is laid
  out beyond the existing guide.
- Whether a particular GitHub header value (`X-GitHub-Event: pull_request`, field names in the
  body) is current: kept as the existing guide states them.
- `githubServiceFlow` and the workforce service flow for GitHub
  (`packages/workforce/src/service-flows/github/`): a different mechanism (`service`, not `on`);
  not part of this recipe.
- How the adapter is built beyond observable responses; raw-body handling in a reader's own
  middleware (not cited on any page).

## Links the page needs (targets exist or are planned)

- `reference/webhooks` (sitemap): `acknowledge`, `parse`, `createWebhookVerifier`, idempotency,
  concurrency `skipped`, session-create refusal, org rules.
- B-12 Receive a Stripe webhook (`./stripe.md`): where the shared steps (binding, mount,
  verification, idempotency) are first written; this page may point to it rather than repeat.
- C-17 (sitemap): serving flows. Current page: `docs/contributing/docs-revamp/pages/concepts/serving-flows.md`.

## Revision 1 (state of the page after pass 8)

R1. The page declares the block `reviewPullRequest` (a `handler`, file
    `src/flows/repo/blocks/review-pull-request.ts`) and uses that one name in prose and code. It
    says "block", never "action". `sequencer` and `reviewPipeline` are gone (C2, C3 resolved).
    `reviews` is the reader's own helper, as `ledger` is on the Stripe page. The page shows it as a
    stub file `src/lib/reviews.ts` (`reviews.start(key: string, data: unknown): Promise<void>`) so the
    block's import resolves; it type-checks with the other three files (round 3).
R2. Files: `src/flows/repo/flow.ts`, `src/lib/flowstate.ts`, `src/app/api/flows/[...path]/route.ts`
    (C8 resolved). One engine import; `flows: [repoFlow()]` (C1). `repoFlow()` is callable: a flow
    definition instantiates the way `billingFlow()` does on the Stripe page. [S1-C1]
R3. Delivery id (row 24, 25): the page says `deliveryId` records GitHub's id on
    `metadata.webhook.deliveryId` and the framework does not deduplicate on it; the example block
    keys its write on repo and PR number. The page no longer says the id "flows" for deduplication.
R4. The page makes no re-review claim. `when` passes only `opened`; later events on the same PR are
    acknowledged and ignored (row 9). `sessionId` is described as one session per pull request.
R5. Verification wording: the verifier "checks" `X-Hub-Signature-256` against the raw body and
    secret (row 18); a failed check is 401 (row 21). Response codes and 503 live on the reference
    page, linked as `/docs/server/webhooks` as the Stripe page links it.
R6. Page states "an event with no binding is acknowledged and ignored" (row 30) and that a
    delivery the server accepts gets a 202 (row 32).

## Revision 2 (state of the page after pass 8, round 2)

R7. Session paragraph (rows 12, 39): PR 42 and 43 on `acme/api` give `acme/api#42` and
    `acme/api#43`; first delivery creates, later reuse, simultaneous first deliveries adopt;
    owner `github-bot`; stored in the `stores` profile's session store, `inMemoryStores()` does not
    survive a restart; no `sessionId` gives a fresh ephemeral session per delivery.
R8. A step 4 "Check it worked" holds the success shape (row 32), the Recent Deliveries tab (row 35)
    and the failure codes (rows 29, 34): 401 `invalid_signature`, 400 `invalid_payload`, 404
    `flow_not_found`, 404 `webhook_not_found`. Errors after dispatch surface in DevTool (row 32).
R9. The link to the reference now says it covers every response code (rows 31-33 live there).

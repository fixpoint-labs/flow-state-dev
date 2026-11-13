# Facts for Serving flows (C-13, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example, and the thing running. No spec is cited. The page plan's Sources line names `server/setup`, `server/host-adapters`, `server/webhooks`, `server/scheduled`, `server/mcp`, `advanced/inbound-transports` and `guides/keeping-a-flow-running`; all are existing user docs and are cited below.

Paths are from the repo root. Abbreviations:

- `eng` = `packages/engine/src`, `engT` = `packages/engine/test`
- `core` = `packages/core/src`
- `node` = `packages/node/src`, `nodeT` = `packages/node/test`
- `mcp` = `packages/mcp/src`, `mcpT` = `packages/mcp/test`
- `hcc` = `examples/hello-chat/fsdev.config.ts` (the one example that uses `createFlowState`)
- `setup` = `apps/docs/docs/server/setup.md`
- `ha` = `apps/docs/docs/server/host-adapters.md`
- `wh` = `apps/docs/docs/server/webhooks.md`
- `sch` = `apps/docs/docs/server/scheduled.md`
- `mcpDoc` = `apps/docs/docs/server/mcp.md`
- `it` = `apps/docs/docs/advanced/inbound-transports.md`
- `kfr` = `apps/docs/guides/keeping-a-flow-running.md`
- `stripe` = `apps/docs/guides/webhooks-stripe.md`
- `cliDoc` = `apps/docs/docs/api/cli.md`
- `voiceDoc` = `apps/docs/docs/advanced/voice.md`

Legend: **[page]** the page states it. **[ref]** it belongs on a Reference page (`reference/runtime`, `reference/http-api`, `reference/webhooks`, `reference/schedules`, `reference/mcp-server`) or a recipe; the page links, does not state it. **[old wrong]** an existing page says it and the code says otherwise; do not copy. **[flag]** a contradiction or gap in the sitemap entry for the caller to settle. Nothing here was run for this sheet; behaviour is cited to tests and doc comments.

The page's cast is the support desk: a `support` flow with a `reply` action (the cast of C-05), a `billing` flow that Stripe starts, and a flow a schedule starts. The sheet uses those names. They are the page's choice; the code does not name them.

## 1. One object: `createFlowState`

- `createFlowState(options)` takes one config object and returns a `FlowState` handle. It builds the runtime synchronously. `eng/flowstate/types.ts:439` (handle doc), `:443-528` (the members); `setup:13-15`. [page]
- `flows` is a list of flow instances: `flows?: readonly FlowInstance<any, any>[]`. Each is served under its own `flow.id` (its `kind` unless the instance was given another id). Two with one id are refused. `eng/flowstate/types.ts:116-125`. [page: `flows: [support, billing, digest]` is the answer to question 1]
- The old keyed record `flows: { support }` throws at construction: "`flows` is a list of flows, each served under its own id ... The keyed record form was removed." `eng/flowstate/createFlowState.ts:372-376`; `engT/flowstate/createFlowState.test.ts:53-62` (`toThrow(/`flows` is a list of flows/)`). [old wrong] `setup:17-20`, `setup:48-62`, `setup:206-208`, `ha:67`, `wh:41`, `mcpDoc:43`, `sch:44`, `stripe` (the `createFlowState` snippet), `kfr:48`, `apps/docs/docs/cli/configuration.md:46-50` and `voiceDoc:34-37` all show `flows: { x }`. A reader who copies any of them gets that error. The page uses the list: `hcc:13-18` (`flows: [helloChatFlow]`).
- A flow is registered as the called factory, an instance: `flows: [helloChatFlow]` where `helloChatFlow` is the default export of its flow file, itself `helloChatFlow()` in `examples/hello-chat/src/flows/hello-chat/flow.ts:93-95` (as cited in the C-05 sheet). The page may say "each flow is the instance its file exports". [page, one clause] [flag] `wh:41` and `kfr:48` write `billingFlow()` inside the list; both call the factory at the mount site. Either works if `defineFlow` returns a factory; the page should show the same shape as C-05 (the file exports the instance).
- Duplicate ids and a bad `stores` config surface at construction, not on the first request. `eng/flowstate/createFlowState.ts:360-380` (registry built synchronously "so a duplicate flow kind/id surfaces at construction"); `setup:44` ("An empty `stores` map or a `defaultProfile` that names a profile you didn't declare throws right away"). [ref] `reference/runtime`
- Option names the page may name in a sentence each: `flows`, `stores`, `models`, `voice`, `settings`, `onError`, `adapters`, `kits`. Each is a field of `CreateFlowStateOptions`. `eng/flowstate/types.ts:116-250`. [page: only `flows`, `stores`, `models`; `adapters` once in the "other ways in" section]
- Every other option (more than six: `modelResolver`, `defaultProfile`, `settings`, `onError`, `errorCapture`, `onBackgroundWork`, `detectInterruptedOnStartup`, `dispatchDrainTimeoutMs`, `resolvePrincipal`, `durable`, `worker`, `kits`, `fill`, `root`, and the stale-sweep and drain timings) is a row on `reference/runtime`. `eng/flowstate/types.ts:116-420`; `setup:46` ("The full field list ... is in Runtime options"). [ref]
- `kits` and `fill` install kits and fill their slots; kit flows are "served beside `flows`". `eng/flowstate/types.ts:127-146`. [ref] The page, if it mentions them, says "flows a kit brings are served beside yours" in one clause and links the Kits concept page.
- The handle: `getRouter()` (resolves the route handlers; first call initialises stores), `ready()` (eager warm-up, idempotent), `dispose()` (releases pooled resources), `register(flow)` / `unregister(id)` (add or remove one flow after start-up), `activeProfile`, `meta`. `eng/flowstate/types.ts:443-534`; `setup:34-42`. [ref] The page names `getRouter` at most, as the thing a host calls.
- Construction is synchronous; stores and the router initialise lazily on the first `getRouter()` or `ready()`; database adapters open their pools then. `eng/flowstate/types.ts:439` ("lazily on first `getRouter()` / `ready()`; adapters open pools then"); `setup:186-190` ("Async initialization"). [ref]
- Keeping the config in its own module that route handlers, tests and the CLI all import: "Keep this file separate from your route handler. The route imports `flowstate` and mounts it." `setup:28`. [page, one sentence]
- The same object, default-exported from `fsdev.config.ts` at the project root, is what the `fsdev` CLI loads: it reads the registry, stores and resolver off that handle. `apps/docs/docs/cli/configuration.md:25-48`; `hcc:1-18` (the file's own comment: "the single runtime wiring for this app, imported directly by the Next.js route handler ... and loaded by the `fsdev` CLI"). [page: one sentence; this is why "a terminal" is one of the doors]

## 2. What it serves: the HTTP routes

- The default mount is `/api/flows`. A route that addresses a flow carries its id in the segment right after: for an ordinary flow, its `kind`, so `/api/flows/support/...` reaches `support`. `setup:194`; `ha:49`. [page: one line]
- An action is `POST /api/flows/:flowId/actions/:action` (new session) or `POST /api/flows/:flowId/:sessionId/actions/:action` (existing session). It answers `202 Accepted` with a `requestId`, runs the block asynchronously, and the result streams over SSE at `GET /api/flows/:flowId/requests/:requestId/stream`. `setup:220-240` (table), `setup:242-254` ("Request Lifecycle"). [ref] `reference/http-api`; the page names the one action route and 202 in a clause.
- `GET /api/flows` lists registered flows. A client reads each row's `id`, `kind`, `cardinality`, `requireUser`, `actions` (names) and `actionSchemas`. `setup:226`; C-05 sheet section 2 (`eng/routes/http-handlers.ts:515-535`). [ref]
- Session, state and resource routes also mount at the same prefix. `setup:220-240`. [ref] `reference/http-api`
- `basePath` replaces `/api/flows`: `serve(flowstate, { basePath: "/flows" })` serves the API at `/flows/...`; a client passes the same value as `apiPath`. `ha:49-58`; `node/serve.ts:63-64` (`basePath?: string` "API mount prefix. Default `"/api/flows"`"); `nodeT/app.test.ts:84-110`. [ref]
- Which routes a caller may use is decided by `authentication` on the flow (per-flow resolver wins over the host-level `resolvePrincipal`). With no resolver an action call takes its `userId` from the request body, "for local development only". `eng/flowstate/types.ts:268-272`; `kfr:236-240` region ("An action call to a flow with no resolver takes its `userId` from the request body, which is for local development only"); `it:212-222` ("Auth"). [ref] Authentication has its own page; this page links to it and states the dev-only default in one sentence, because question 2 and the Node host both lead to a network bind.

## 3. Where it runs: Next.js, a plain Node process, others

- **The flows do not change with the host.** The router "speaks Web standard `Request` and `Response`, so the same app runs long-lived on a Node process, on AWS Lambda, on Bun, or on Deno. What changes per platform is the thin wrapper around it." `ha:11`. The wrapper takes the `FlowState`: `createNextHandler(flowstate)`, `createVercelNextHandler(flowstate)`, `serve(flowState)`, `createServerApp(flowstate)`. `node/serve.ts:184-188` (`serve(app: FlowState | FlowApiRouter, ...)`); `packages/next/src/createNextHandler.ts:41-49` (`createNextHandler(flowstate: FlowState)`); `packages/vercel/src/next.ts:17`. [page: this is the answer to question 3]
- Next.js: a catch-all route file exports `{ GET, POST, PATCH, DELETE }` from the handler. `setup:144-169`. The sitemap sends the route to S-5; the page links, shows no route file. [ref/link S-5] `createNextHandler` needs Next.js 15+ (`setup:169`; `next/createNextHandler.ts:2-12`: awaits the async `params`). [ref]
- Vercel: `createVercelNextHandler` from `@flow-state-dev/vercel/next` adds SSE header shaping; `createNextHandler` from `@flow-state-dev/next` is the same mount with no Vercel behaviour, for other Next hosts. `setup:144-169`; `packages/vercel/src/handler.ts:15-23` (the SSE headers it sets). [ref] `guides/deploying-to-vercel`
- Plain Node: `serve(flowState)` from `@flow-state-dev/node` stands up a long-lived server in one call. It binds `process.env.PORT`, then `3000`, on `0.0.0.0`; mounts the API under `/api/flows`; serves `/healthz`; resolves once listening. `node/serve.ts:57-72` (`port`, `host`, `basePath`, `healthPath` defaults), `:172-183` (doc comment: "binds immediately and serves `/healthz` (503 until the router's stores finish initializing, 200 after)"); `packages/node/README.md:29-52`; `nodeT/serve.test.ts:104-110`, `:164-190`. [page: the Node host in one call is the sitemap's second example]
- `/healthz` answers 200 once stores are ready, 503 while initialising, 500 if initialisation fails permanently. `node/app.ts:106-137`; `ha:30`; `nodeT/serve.test.ts:165` (`reports 503 while stores initialize, then 200 once ready`), `:187` (500 on permanent failure). [ref]
- `SIGTERM` and `SIGINT` trigger a graceful shutdown: stop accepting, drain in-flight requests, then dispose the router and the `FlowState`. `shutdownGraceMs` defaults to 10 000. `node/serve.ts:20-22` (header), `:78-80`, `:86-92`, `:135-141`, `:287`; `nodeT/serve.test.ts:203` (`disposes the FlowState stores on close()`). [page: one clause under "what it gets you"; options are [ref]]
- `serve()` also serves a WebSocket for push on `<basePath>/users/:userId/stream`, so a browser client hears changes when they are saved rather than on a timer. `push: false` turns it off. `node/serve.ts:77-90`; `packages/node/README.md` section "Push"; `nodeT/serve-push.test.ts`. [ref] The page does not cover it; `reference/runtime` or the client page does.
- `serve()` can also serve a directory of static files (`staticDir`) with an `index.html` fallback. `node/serve.ts:65-66`; `nodeT/serve.test.ts:239-253`. [ref]
- `fsdev serve` is the terminal command for the same thing: it requires a committed `fsdev.config.*` that default-exports a `FlowState`, wraps `serve()` from `@flow-state-dev/node`, binds `$PORT` (then 3000) on `$HOST` (then `0.0.0.0`), and mounts the flow API and any MCP routes, with no DevTool. `cliDoc:163-183`; `packages/fsdev/src/commands/serve.ts:1-10`. [page: one sentence; flags are [ref]]
- Before a non-loopback bind, `fsdev serve` refuses a flow with no authentication configured, unless `--allow-unauthenticated`. `cliDoc:185`. [ref] The `serve()` function exports the same check as `assertNetworkBindIsAuthenticated`. `node/index.ts:24-25`. [ref]
- The portable app: `createServerApp(flowstate)` from `@flow-state-dev/node/app` returns a Web Fetch app (`app.fetch`) with `/healthz` and the router. Wrap it for Bun (`export default app`), Deno, or AWS Lambda (`createLambdaHandler` from `@flow-state-dev/node/aws-lambda`). `ha:17-26`, `:28-48`, `:95-120`; `nodeT/app.test.ts`, `nodeT/aws-lambda.test.ts`. [ref] `host-adapters` stays a page; the concept page links it. [flag: sitemap says "server/host-adapters (keep)", so the matrix lives there, not here]
- Edge runtimes (Cloudflare Workers, Vercel Edge) are not supported. `ha:97`. [ref/limit]
- On a serverless host that freezes the function after the response, post-response work (webhook dispatch, scheduled dispatch) can be killed. The fix is a `createFlowState` option, `onBackgroundWork: (p) => after(() => p)` with `after` from `next/server`. `eng/flowstate/types.ts:206-218`; `setup:171-184`; `stripe` ("That holds on a server that stays up ..."). [ref] The page does not state it; it links to the deploy guide. The page should avoid implying a webhook run is finished when the 202 returns.
- **Models and stores are set on this object, not on the host.** `models` configures the model resolver: `models: { default: "openai/gpt-6-luna", intents: { chat: [...] } }`; `intents` are "named ordered lists of candidate model ids", `default` the concrete fallback. `eng/flowstate/types.ts:30-40` (`FlowStateModelsConfig`), `:156`. With `models` omitted, providers auto-detect from environment variables (`OPENAI_API_KEY` and others) and `AI_GATEWAY_API_KEY` auto-wires the gateway. `hcc:8-11` (file comment: "`createModelResolver` is built by `createFlowState` from the (omitted) `models` option, which auto-detects providers from env vars"); `eng/flowstate/types.ts:154` ("Auto-wires AI Gateway via `AI_GATEWAY_API_KEY`"). [page: answer to question 4; gateways, providers, keys, retry policy are [ref]]
- `stores` says where the app keeps its data. Three shapes: omitted (in memory, as the `default` profile; nothing survives a restart; startup says so and production warns), one adapter (`stores: sqliteStores({ filename })`, which is `{ default: { primary: adapter } }`), or named profiles chosen per environment (`defaultProfile`, `FSD_ENV`). `eng/flowstate/types.ts:168-178`; `goals/first-hour/runs-without-store-ceremony/goal.md` (Signal a: stderr says the app runs in memory); `setup:74-84`. [page: the omitted case and the one-adapter case; profiles are [ref]]
- Store adapters: `inMemoryStores()` and `filesystemStores({ rootDir })` from `@flow-state-dev/engine`; `sqliteStores(options)` from `@flow-state-dev/store-sqlite`; `postgresStores(options)` from `@flow-state-dev/store-postgres`; `vercelPostgresStores()` from `@flow-state-dev/vercel/store`. `setup:80-98`; `packages/store-sqlite/src/registry.ts:95` (`sqliteStores(options: SQLiteStoreOptions): StoreAdapter`, backs the `primary` slot). The table has five rows; the page names two (default and one persistent), the rest are [ref]. `filesystemStores` is "local development only" per `setup:94`.
- Profile selection, first match wins: `process.env.FSD_ENV` (must name a declared profile or it throws), `defaultProfile`, the first declared profile. `NODE_ENV` is not consulted. `eng/flowstate/types.ts:180-185`; `setup:123-131`. [ref] `reference/runtime`
- An error in a flow's blocks goes to `errorCapture`; `onError` is an HTTP-level sink with `{ method, path }`. `eng/flowstate/types.ts:194-204`; `setup:133-142`. [ref]

## 4. Other ways in

All of these mount on the same router as the HTTP routes. HTTP is the built-in adapter; MCP, webhooks and schedules are `adapters` entries on `createFlowState`. `eng/flowstate/types.ts:246-250` (`adapters`); `eng/routes/createFlowApiRouter.ts:1-8`, `:139-144`, `:587-594` (the built-in HTTP adapter plus any supplied); `sch:44-52`, `mcpDoc:31-47`, `wh:28-52`. [page]

A transport "translates whatever it receives (an HTTP request, an MCP `tools/call`, a webhook POST, a cron tick) into an `InboundRequestEnvelope` and hands it to the host"; every adapter calls `host.resolvePrincipal` first. `it:13-22`, `it:212-222`. [page: the one claim the figure rests on]

### 4a. Webhooks

- A webhook is an HTTP POST from an external service (Stripe, GitHub, Slack). `wh:7-12`; `kfr:7-20`. [page]
- The flow declares routing and no secret. The host declares how to verify and read the provider's wire format. The flow side: `webhooks: { stripe: { on: { "invoice.paid": defineWebhookBinding({ block, input, sessionId? }) } } }`, imports from `@flow-state-dev/core`. The host side: `createWebhookTransportAdapter({ providers: { stripe: { verify: stripeWebhookVerifier(() => process.env.STRIPE_WEBHOOK_SECRET!), eventType: (payload) => payload.type } } })` in `adapters`, imported from `@flow-state-dev/engine`. `wh:14-20`, `:30-52`, `:70-100`; `kfr:20-60`; `core/types/webhooks.ts:1-30`, `:154-162`; `eng/index.ts:44-51` (exports `createWebhookTransportAdapter`, `stripeWebhookVerifier`). [page: "a webhook binding in three lines" is the sitemap's third example; the host adapter is a second block or a sentence]
- `defineWebhookBinding<TPayload>(binding)` takes the handler `block` (a handler, generator, sequencer or router), `input: (event) => ...`, optional `sessionId: (event) => string`, optional `when: (event) => boolean`, plus action-level policy (`durable`, `tokenBudget`, `onCompleted`, `onErrored`). It is a typing aid; at runtime it returns the object unchanged. `core/types/webhooks.ts:47-70` (`WebhookEventBinding extends ActionCore`), `:147-162`. [page: the three it shows; the rest [ref] `reference/webhooks`]
- **Is a webhook an action call? No.** A binding "is an action in webhook form": it carries the same `ActionCore` (the handler block plus execution policy) as an action, but it lives on `flow.webhooks`, "and never in `flow.actions`". It is selected by the provider's event type and trusted by the signature check, "not caller-addressed like an HTTP/MCP action". `core/types/webhooks.ts:3-14`, `:47-60`; `wh:119-130` ("Webhook handlers live off `actions`"). It has no action endpoint to POST to, does not appear in `GET /api/flows` `actions`, and is never an MCP tool: `wh:119-130`; `mcpT/adapter.test.ts:112-135` ("does not expose webhook handlers as MCP tools"). [page: answer to question 2: Stripe posts to a webhook route, not an action route; the run it starts is shaped like an action's]
- A flow that only receives webhooks still declares `actions: {}`. `wh:127-130`; `stripe` (`actions: {} // no caller-facing actions`). [ref]
- The route is `POST /api/flows/:flowKind/webhooks/:provider`; point the provider at it. `wh:63-66`; `stripe` ("Point Stripe at `POST /api/flows/billing/webhooks/stripe`"). The `:provider` segment is the key of the flow's `webhooks` map and of the host's `providers` map. `wh:63-66`. [ref]
- A delivery with a bad signature is refused with 401 and nothing runs. A verified delivery is answered `202` at once, and the block runs after the response. An event with no matching binding is acknowledged with 202 and ignored. `engT/transports/webhook-routes.test.ts:103-136` (202 and dispatch; 401 and no dispatch), `:138-149` (202, no dispatch); `engT/transports/webhook-routes.test.ts:394-460` (real signature updates session state; forged signature 401 and no session); `wh:291-300`; `goals/webhook-transport/runs-the-bound-handler-on-a-verified-delivery/goal.md` (Signal). [page: one sentence; every status is [ref]]
- With no `sessionId`, each event runs in a fresh session; deriving `sessionId` from the payload (`customer-${...}`) keeps one customer's events in one session. `core/types/webhooks.ts:70-77`; `wh:84-95`; `stripe` ("`sessionId` is optional ..."). [page: one sentence]
- The run carries provenance: `source: "webhook"` and `metadata.webhook` (`provider`, `eventType`, `deliveryId`). `engT/transports/webhook-routes.test.ts:114-122`; `it:203-210`. [ref]
- A webhook flow with no end user uses `authentication: { defaultUserId: "system", requireUser: false }`. `wh:70-90` region (the example); `stripe`; `kfr:20-60`. [ref] `reference/webhooks`, and the Stripe recipe. With no resolver beyond the signature, events run as `system` and the flow stays on the development default (its session endpoints are open, `fsdev serve` will not bind a network host): `kfr:90-100` region ("The provider's signature verifies each delivery, but that's all the example checks ..."). [ref] The page does not repeat this.
- If a flow declares a provider the host did not configure, the adapter throws at start-up. `wh:67-70`. [ref]
- Recipes: `guides/webhooks-stripe`, `guides/webhooks-github`, `guides/webhooks-slack-events`. [link]

### 4b. Schedules

- FSD does not run a clock for a schedule. A schedule is a named entry on the flow with a cron string; the host's scheduler (Vercel Cron, Cloud Scheduler, EventBridge, GitHub Actions, `node-cron`) calls the dispatch endpoint when the time comes. `kfr:104-110`; `sch:5-14`, `sch:61-98`. [page: one paragraph]
- Static schedules are declared on the flow: `schedules: { static: { "monthly-invoices": defineScheduleBinding({ cron: "0 0 1 * *", block: generateMonthlyInvoices }) } }`, imports from `@flow-state-dev/core`. Cron is POSIX five-field, validated when the flow is registered, so a malformed cron fails at boot. `sch:61-98`; `core/types/schedules.ts:407-415`. [ref] `reference/schedules`
- A schedule binding is also action-shaped and also off `actions`: "A schedule handler lives only on `schedules.static`, so it has no HTTP or MCP caller surface." `sch:61-92` ("Each entry carries its handler inline (the shared action core) instead of naming an entry in `flow.actions`. Same model the webhook transport uses"); `kfr` Terms ("Schedule tick. Your scheduler calling a schedule's dispatch endpoint"). [page: one clause, in the same sentence as webhooks]
- Mount: `createScheduledTransportAdapter()` from `@flow-state-dev/scheduled`, in `adapters`. It mounts `POST /api/flows/:flowKind/schedules/:scheduleId/dispatch` and a sibling `GET` that lists static schedules. Dispatch is fire-and-forget: 202 as soon as the request is accepted. `sch:32-60`; `it:154-170`. [ref]
- Dynamic schedules (stored at runtime, looked up by `schedules.resolve`) belong to the host's store, not the framework's. `sch:99-135`; `it:162-166`; `sch:11-22`. [ref]
- Auth is two-phase: the dispatch endpoint runs through the resolver (typically a shared secret, `createBearerSecretPrincipalResolver`); each schedule may carry its own `principal`. `it:168-176`; `kfr:104-135`. [ref]
- The one place the framework runs a clock: `serve()` from `@flow-state-dev/node` ticks a flow's schedule index each minute, claims due entries and dispatches each through the same app; the app must mount `createScheduledTransportAdapter()`. It starts only once the port is bound and only for a flow whose `schedules.index` is set. `node/serve.ts:336-395`; `nodeT/serve-schedules.test.ts:1-60`. [ref] `reference/schedules`, and this contradicts the flat statement "FSD doesn't run a clock" (`kfr:106`). [flag] The page says "your scheduler calls the dispatch endpoint" and does not claim FSD has no clock at all; the schedule-index tick is a Reference row.
- Schedule runs carry `source: "scheduled"` and `metadata.scheduleId`, `origin`, `cron`, `nominalFireTime`, `dispatchedAt`, `timezone`. `it:177-184`. [ref]

### 4c. MCP

- MCP (Model Context Protocol) is the protocol clients such as Claude Desktop and Cursor use to talk to external tool servers. `mcpDoc:7-17`. [page: defined in a clause]
- `@flow-state-dev/mcp` exposes a flow as an MCP server over Streamable HTTP. Opt in with `mcp: { enabled: true }` on the flow, add `createMcpTransportAdapter()` to `adapters`. `mcpDoc:7-14`, `:24-47`, `:87-95`; `mcp/createMcpTransportAdapter.ts:1-30`. [page]
- The endpoint is `POST /api/flows/:kind/mcp`; `GET` and `DELETE` on it answer 405. A dedicated prefix is `createMcpTransportAdapter({ dedicatedBasePath: true })`, mounted at `/mcp/:kind`. `mcpDoc:54-86`; `mcpT/adapter.test.ts:248-280`. [ref] `reference/mcp-server`
- The flow's actions become tools; each exposed action needs a `description`, which the model reads when choosing a tool; the flow fails to register if one is missing. An action opts out with `mcp: { enabled: false }`. `mcpDoc:87-100`; `core/types/flow.ts:132`, `:276`; `mcpT/adapter.test.ts:106-110`, `:437-452`. [page: one sentence, since question 2's counterpart is "an MCP call is an action call"]
- An MCP `tools/call` is an action call: it dispatches the exposed action through the same runtime, with `source: "mcp"` and the resolved principal. `mcp/createMcpTransportAdapter.ts:30-33` ("All action execution still flows through `host.dispatch` — the runtime below this layer is identical to HTTP"); `mcpT/adapter.test.ts:454-475`. [page: contrast with webhooks]
- MCP is stateless: no `Mcp-Session-Id` is issued and every `tools/call` creates a fresh session. `mcp/createMcpTransportAdapter.ts:9-11`; `mcpDoc:374`. [ref]
- Webhook handlers are never exposed as MCP tools. `mcpT/adapter.test.ts:112-135`. [ref]
- `fsdev serve` stands up the MCP routes from a committed config. `mcpDoc:50-57`; `cliDoc:165`. [ref] It reads the adapter from `adapters` on the config; nothing mounts MCP without `createMcpTransportAdapter()` in the config (no adapter is added by default: `eng/routes/createFlowApiRouter.ts:587-594` lists the built-in HTTP adapter plus `options.adapters`). [flag] `cliDoc:165` says `fsdev serve` "serves the flow API and MCP endpoints" without saying the config must add the adapter; the page says the adapter is an `adapters` entry.

### 4d. Voice

- Voice is not a separate way in. It adds speech to the text path: a provider on the server (`voice: { provider: new OpenAIVoiceProvider({ apiKey }) }` on `createFlowState`, from `@flow-state-dev/voice-openai`), `voice.tts` on a flow so its responses are synthesised, `useVoice()` in React. `voiceDoc:7-45`; `eng/flowstate/types.ts:42-50`, `:165-166`. A transcribe route exists on the HTTP router, answering 501 with no provider. `voiceDoc:43`; `eng/routes/http-handlers.ts:741` (route `transcribe`). [page: one clause under "other ways in", if it is named at all] [flag] The sitemap lists "voice" in the section title; voice starts nothing by itself, so the figure's "arriving at an action" does not hold for it. A spoken message is transcribed to text, then the client sends it as an ordinary action call. Recommend the page treats voice as "speech on top of HTTP" in a sentence, and the figure omits it (the figure brief already lists page, webhook, schedule, MCP client, terminal).

### 4e. A terminal, and in-process

- `fsdev run <flowId> <action> -i '<json>'` runs an action from the terminal with NDJSON output. With an `fsdev.config.ts`, it looks the flow up by instance id in the config's registry and uses the config's stores and models. `cliDoc:13-40`; `apps/docs/docs/cli/configuration.md:11-18`. [page: one sentence, "the terminal"]
- `fsdev dev` serves the same router plus the DevTool UI on a fixed loopback port, `4200`; `fsdev serve` is the production counterpart. `cliDoc:102-129`, `:163-183`. [ref]
- A caller in the same process (a script, a test, a queue worker) uses `createInProcessFetch(flowState)` from `@flow-state-dev/engine` as a client's `fetcher`: each request goes straight to the engine, no web server, no port. The routes, checks and answers are the same as over HTTP, and credentials still go through `resolvePrincipal`. `ha:62-85`; `eng/routes/in-process-fetch.ts:1-30`, `:90`. [ref/page, one sentence] 
- The terminal and in-process calls are action calls: `fsdev run` names an action; `createInProcessFetch` carries the same action route. `cliDoc:13-18`; `ha:66-72`. [page]

### 4f. Another system: a custom transport

- A queue or an event bus can start a run through a custom `InboundTransportAdapter` in `adapters`. `kfr:236-240` row "Another system"; `it:25-75`, `:110-125`. [ref] The page may name it in a clause and link `advanced/inbound-transports`. The page does not describe the envelope.
- One adapter serves every flow in the registry. Per-flow opt-in (such as `mcp.enabled`) lives on the flow definition. `it:250-254`. [ref]

## 5. The ways in, and where each ends

The table the figure and the "other ways in" section rest on. All rows cited above.

| Door | What starts it | What it declares on the flow | What it declares on the host | What it starts | Is it an action call |
| --- | --- | --- | --- | --- | --- |
| A page or client | `createClient(...).flow("support").send("reply", ...)` over HTTP | `actions: { reply }` | nothing (the built-in HTTP adapter) | the action `reply` | Yes |
| A terminal | `fsdev run support reply -i '{...}'` | `actions` | `fsdev.config.ts` default export | the action | Yes |
| An MCP client | `tools/call` at `POST /api/flows/:kind/mcp` | `mcp: { enabled: true }`, `actions` with `description` | `createMcpTransportAdapter()` | the action | Yes |
| A webhook | the provider's POST at `/api/flows/:kind/webhooks/:provider` | `webhooks.<provider>.on.<event>: defineWebhookBinding` | `createWebhookTransportAdapter({ providers })` | the binding's block, in its own request | No: it is action-shaped, on `flow.webhooks`, never in `actions` |
| A schedule | your scheduler POSTs `/api/flows/:kind/schedules/:id/dispatch` | `schedules.static.<id>: defineScheduleBinding` | `createScheduledTransportAdapter()` | the binding's block | No: action-shaped, on `flow.schedules`, never in `actions` |

Sources: section 4 and `wh`, `sch`, `mcpDoc`, `cliDoc`, `ha`. This table is for the writer; the page does not print it (six-row limit applies, and the figure carries it).

[flag] **Question 2 and the figure.** The sitemap asks "Stripe needs to start a flow. Is that an action call?" and the figure says "each arriving at an action". The code answers no for webhooks and schedules: the binding is "an action in webhook form" on `flow.webhooks`, selected by event type and authenticated by the signature, with no action name a caller can send and no MCP tool. What is true of every door, and safe to draw: each one ends at a block running as a request recorded like any other (`source` and `metadata` say which door), under a principal the host resolved. `it:13-22`; `it:177-210`; `engT/transports/webhook-routes.test.ts:114-122`. I recommend the figure label the arrows "starts a run" for webhook and schedule, "calls an action" for page, terminal and MCP, and highlight the run, not the action. If the caller keeps "STARTS AN ACTION", the page must not say a webhook is an action call, because question 2 would then be answered both ways.

## 6. What it gets you

Each is observable and tied to the support desk. Cited; all are guarantees, not mechanism.

- One config object serves the same flows to every door, so a flow is written once and reached by a page, a webhook and an MCP client without code per door. `it:13-22`; `it:250-254`.
- The terminal and the server read the same object, so `fsdev run` behaves as the server does (your models, your stores). `apps/docs/docs/cli/configuration.md:9-18`; `hcc:1-18`.
- Moving hosts changes the mount file, not the flows. `ha:11`; section 3 above.
- A webhook delivery is verified before any block runs, answered at once, and run after the response. `engT/transports/webhook-routes.test.ts:103-149`, `:394-460`; `goals/webhook-transport/.../goal.md`.
- A misconfigured app (a duplicate flow id, an empty `stores`, a webhook provider the host did not set up) fails when it starts, not when the first request arrives. `eng/flowstate/createFlowState.ts:360-380`; `setup:44`; `wh:67-70`.
- Nothing persists unless a store is named: with `stores` omitted the app runs in memory and says so at start-up. `eng/flowstate/types.ts:168-178`; `goals/first-hour/runs-without-store-ceremony/goal.md`.

## 7. How it fits with the others

Each is a link, stated once.

- Flows and actions (C-05) define what is served: the actions a flow exposes are the HTTP and MCP surface. The page does not restate them.
- Authentication decides who may use each door. `it:212-222`. A resolver per flow wins over the host's. `eng/flowstate/types.ts:268-272`.
- Persistence (stores) holds what the doors start. See section 8.
- Background work: a flow that hands work on does so with `dispatcher()`, not through a door. `kfr` row "Another flow" and terms "Dispatch". The page does not cover it; it links to the Background work concept so a reader does not take a dispatch for a way into the app.
- Kits: flows a kit brings are served beside the app's. `eng/flowstate/types.ts:127-146`.

## 8. The four questions, for each stored part

Serving flows is configuration. It stores nothing itself. What it names is where other things are stored, and what each door leaves behind.

| Part | Who owns it | Who can see it | Where it is stored | How many |
| --- | --- | --- | --- | --- |
| The config object (`createFlowState({...})`) | Your app's code | Whoever reads the repo; the `fsdev` CLI loads it from `fsdev.config.ts` | Source files | One per app (one handle per process) |
| The flow registry (the flows served, by id) | The running process | Any client: `GET /api/flows` lists each flow's `id`, `kind`, `actions`, `actionSchemas` | The process; rebuilt on each start; not a store | One per process; one entry per flow id |
| The app's data (sessions, requests, state) | The app, in the profile `stores` names | Per user and organization, by the routes' own rules; see C-05 and C-07 | In memory when `stores` is omitted (lost on restart); otherwise the adapter named (`sqliteStores`, `postgresStores`, `filesystemStores`, `vercelPostgresStores`) | One active profile per process (`FSD_ENV` or `defaultProfile` picks it) |
| A session a webhook or schedule starts | The flow; there is no end user, so the request runs as the principal the flow's `authentication` names (for example `defaultUserId: "system"`) | The principal's own routes; with no resolver, the development default | The app's stores | A fresh session per delivery unless `sessionId` derives one from the payload; then one per derived id |
| A session an MCP `tools/call` starts | The user the MCP resolver binds | That user | The app's stores | A fresh session per call (stateless) |
| Dynamic schedule rows | The host (a resource collection, a table, or a service) | The host | The host's store; the framework never owns schedule storage | One per stored schedule |

Sources: `eng/flowstate/types.ts:168-178`, `:180-185`; `eng/stores/types.ts:33-60` (`SessionRecord`); `core/types/webhooks.ts:70-77` (fresh ephemeral session when `sessionId` is absent); `mcp/createMcpTransportAdapter.ts:9-11`; `sch:11-22`; `it:162-166`; `engT/transports/webhook-routes.test.ts:114-122` (`sessionId` equals `customer-cus_9`); `setup:74-84`, `:125-135`; C-05 sheet section 2 for sessions. The in-memory default is a limit, not a store: `goals/first-hour/runs-without-store-ceremony/goal.md`. [page: who owns and where it is stored for the app's data, one sentence each; the rest [ref]]

## 9. Answers to the sitemap's four questions

1. **What do you pass to make three flows callable?** A list of the three flow instances: `createFlowState({ flows: [support, billing, digest] })`, and mount the handle. Not an object: `flows: { support, billing, digest }` throws at construction. `eng/flowstate/types.ts:116-125`; `eng/flowstate/createFlowState.ts:372-376`; `engT/flowstate/createFlowState.test.ts:53-62`.
2. **Stripe needs to start a flow. Is that an action call?** No. Stripe posts to the webhook route `POST /api/flows/billing/webhooks/stripe`. The flow's `webhooks.stripe.on["invoice.paid"]` binding (built with `defineWebhookBinding`) names the block to run and maps the event to its input. The host mounts `createWebhookTransportAdapter` and holds the signing secret. A bad signature is a 401 and nothing runs; a good one is a 202 and the block runs after. `core/types/webhooks.ts:3-14`; `wh:119-130`; `engT/transports/webhook-routes.test.ts:103-149`.
3. **Next.js or a plain Node process: what changes in your flows?** Nothing. What changes is the file that mounts the handle: a route file with `createNextHandler(flowstate)` (or `createVercelNextHandler`), or `await serve(flowstate)` from `@flow-state-dev/node`. `ha:11`; `setup:144-169`; `node/serve.ts:184-188`. The same `FlowState` goes to both.
4. **Where do stores and models get set?** On the one config object: `stores` and `models` on `createFlowState`. Omit `stores` and the app runs in memory; omit `models` and providers are detected from environment variables. Neither is set on the host or the flow. `eng/flowstate/types.ts:154-178`; `hcc:8-11`.

## 10. Examples the page may use (checked against the exported surface)

All three type-check against the signatures cited; none was compiled for this sheet. File titles follow the layout in `user-docs.md`.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import support from "./src/flows/support/flow";
import billing from "./src/flows/billing/flow";
import digest from "./src/flows/digest/flow";

export default createFlowState({
  flows: [support, billing, digest],
  models: { default: "openai/gpt-6-luna" },
  stores: sqliteStores({ filename: ".fsdev/data/support.db" }),
});
```

Backed by `eng/flowstate/types.ts:116-125`, `:154-156`, `:168-178`; `store-sqlite/src/registry.ts:95`; `hcc:13-18`. `filename` is the `SQLiteStoreOptions` field the kitchen-sink uses (`apps/kitchen-sink/fsdev.config.ts`, `sqliteStores({ filename: file })`). `models.default` is a string id (`FlowStateModelsConfig.default`, `eng/flowstate/types.ts:32`).

```ts title="src/server.ts"
import { serve } from "@flow-state-dev/node";
import flowstate from "../fsdev.config";

await serve(flowstate);
```

Backed by `node/serve.ts:184-188`; `packages/node/README.md:29-52`. Defaults: `$PORT` then 3000 on `0.0.0.0`; `/api/flows` and `/healthz`. [flag] Binding `0.0.0.0` with a flow that has no `authentication.resolvePrincipal` is open to the network; `serve()` itself does not refuse it (the guard is in `fsdev serve` and exported as `assertNetworkBindIsAuthenticated`, `node/index.ts:24-25`). The page should say "the `support` flow has a resolver" in a clause or use `fsdev serve`. Settle against `node/bind-guard.ts` before drafting.

```ts title="src/flows/billing/flow.ts"
import { defineFlow, defineWebhookBinding } from "@flow-state-dev/core";
import { recordPayment } from "./blocks/record-payment";

export default defineFlow({
  kind: "billing",
  actions: {},
  authentication: { defaultUserId: "system", requireUser: false },
  webhooks: {
    stripe: {
      on: {
        "invoice.paid": defineWebhookBinding({
          block: recordPayment,
          input: (e) => ({ invoiceId: (e.payload as { id: string }).id }),
        }),
      },
    },
  },
})();
```

Backed by `core/types/webhooks.ts:154-162`; `wh:70-100`; `stripe`. The sitemap's "three lines" is the `defineWebhookBinding` call. `recordPayment` is a block in its own file (`user-docs.md`: one export per block file). The `(e.payload as ...)` cast is needed unless `defineWebhookBinding<StripeEvent>` is used; a `StripeEvent` interface adds lines, so the page may name `e.payload` as typed `unknown` and use `defineWebhookBinding<{ id: string }>`. The host half, `createWebhookTransportAdapter({ providers: { stripe: { verify: stripeWebhookVerifier(() => process.env.STRIPE_WEBHOOK_SECRET!), eventType: (p) => (p as { type: string }).type } } })` in `adapters`, is a second block if the page shows it; `wh:30-52`; `eng/index.ts:44-51`. Whether the factory is called at the export (`defineFlow({...})()`) or at the list follows the C-05 sheet: the file exports the instance.

## 11. For the caller: what the sitemap entry says that the code does not support

- **"Webhooks ... arriving at an action"** (figure) and question 2: see the flag at the end of section 5.
- **"Voice"** as a door: see section 4d.
- **`guides/keeping-a-flow-running`** says "FSD doesn't run a clock" (`kfr:106`); `serve()` runs a one-minute tick for a flow that sets `schedules.index` (`node/serve.ts:336-395`). Not the page's content; the page says a scheduler calls the dispatch endpoint.
- **Existing pages show `flows: { x }`** (list in section 1). Each is a broken example that the cutover must not carry forward. This page is the first to show the list form from the setup family; `reference/runtime` and the Stripe recipe need the same fix.
- **`fsdev serve` and MCP**: no adapter is installed by default; the config's `adapters` must include `createMcpTransportAdapter()` (section 4c).
- **Source read but not citable**: the page plan's Sources line names only existing user docs, all cited. No spec, changeset or internal doc was opened.

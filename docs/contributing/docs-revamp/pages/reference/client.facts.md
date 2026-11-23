# Facts for Client configuration (R-14, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, and one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. **[test]** marks a fact a test pins. **[source]** marks a fact read from exported code where no test or doc comment pins it. **[doc]** marks a fact the existing user docs state and the code agrees with. Nothing here was run against a deployed server.

Paths are from the repo root. Abbreviations:

- Client: `cl` = `packages/client/src/client.ts`, `http` = `packages/client/src/internal/http.ts`, `str` = `packages/client/src/stream-client/streams.ts`, `rss` = `.../stream-client/request-stream-store.ts`, `hub` = `packages/client/src/subscribe/push-hub.ts`, `live` = `packages/client/src/live/live-read.ts`, `cty` = `packages/client/src/types/index.ts`
- Contracts: `cn` = `packages/contracts/src/types/change-notice.ts`, `pd` = `packages/contracts/src/types/push-delivery.ts`
- React: `fc` = `packages/react/src/context/FlowContext.ts`, `uc` = `packages/react/src/internal/useClient.ts`, hooks as `packages/react/src/hooks/<name>.ts`
- Workforce panels: `wr` = `packages/workforce/src/react/components/`
- Tests: `clt` = `packages/client/test/`, `rt` = `packages/react/test/`, `bus` = `packages/engine/test/bus/`
- Existing docs: `dcfg` = `apps/docs/docs/configuration/client.md`, `dapi` = `apps/docs/docs/api/client.md`, `dreact` = `apps/docs/docs/client/react.md`, `dcov` = `apps/docs/docs/client/overview.md`, `dhost` = `apps/docs/docs/server/host-adapters.md`
- Example: `ex` = `examples/hello-chat/src/app.tsx`, `exp` = `examples/hello-chat/app/page.tsx`

## What the page is

A Reference page: tables and lookups, no narrative, no word budget. The plan asks for three tables (`createClient` options, `FlowProvider` props, what hooks inherit) and one lookup ("What must `createClient` be given?"). Other pages' depth passes moved further rows here; they are in sections 5 to 10 and the carry/drop ledger is section 12. Reference pages in this tree carry their own row tables and are not held to the six-row cap.

## 1. `createClient` options

`createClient(options: CreateClientOptions): Client` (`cl:610`). `CreateClientOptions` has exactly four fields (`cl:56-80`); there is no tenant, org, token, headers or timeout field.

| # | Fact | Source |
|---|------|--------|
| 1.1 | `userId: string`. Required. "The user every call acts as. Sent as caller input, never trusted: with sign-in, the server authenticates the request's credentials instead." | `cl:57-62` |
| 1.2 | `userId` is trimmed and must be non-empty. An empty or whitespace `userId` throws `ClientHttpError` "userId is required" with `status: 0`. | `cl:611`; `http:89-93`; `clt/client.test.ts:53` [test] |
| 1.3 | `baseUrl?: string`. "Where the server answers, e.g. `"http://localhost:3000"`; `""` for the page's own origin. Required without a `fetcher`." | `cl:63-67` |
| 1.4 | With neither `baseUrl` nor `fetcher`, `createClient` throws (`ClientHttpError`, `status: 0`, message "createClient requires baseUrl, or a fetcher"). It throws at construction, not on the first call. | `http:43-48`; `clt/client.test.ts:52-55` [test] |
| 1.5 | With a `fetcher` and no `baseUrl`, requests are made against a relative path (`/api/flows/...`). A credential wrapper hands that to the browser's `fetch`, which resolves it against the page; `createInProcessFetch` reads only the path. | `http:33-40`; `clt/client.test.ts:58-63` [test]; `rt/credential-fetcher-same-origin.test.ts:52-57` [test] |
| 1.6 | `baseUrl` is put in front of every route path as given. Only one trailing `/` is dropped. A whitespace-only `baseUrl` counts as empty. | `http:166-169` (`normalizeBaseUrl`); `dcfg` "Choosing `baseUrl`" [doc] |
| 1.7 | `apiPath?: string`. "Where the server mounts the flow API, after `baseUrl`. Default `"/api/flows"`. Set it to the server's mount when that differs, such as the Node host's `basePath`." | `cl:68-74`; `http:13` |
| 1.8 | Routes are built as `baseUrl` + mount + route. The mount swaps the leading `/api/flows` of every route: a leading `/` is added when missing, one trailing `/` is dropped, `""` gives a mount of nothing (routes at `/chat/...`). A path that does not start at `/api/flows` is left alone. Unset, every URL is byte-identical to `/api/flows/...`. | `http:157-165` (`remount`); `clt/api-path.test.ts:53-88` [test: unset, `"/flows"`, `"/v2/flows/"` with `baseUrl: ""` gives `/v2/flows/chat/actions/send`] |
| 1.9 | `apiPath` reaches every namespace of one client: flows, send, sessions, requests, resources, `transcribe`, a request stream and a session stream. | `clt/api-path.test.ts:23-50`, `:68-81` [test] |
| 1.10 | `fetcher?: ClientFetch`. "The fetch every call and stream goes through. Pass the engine's `createInProcessFetch(flowState)` ... or a wrapper that adds credentials. Default: the global `fetch`." | `cl:75-79` |
| 1.11 | `ClientFetch` is `(input: RequestInfo \| URL, init?: RequestInit) => Promise<Response>`. | `cty:36-39` |
| 1.12 | The default fetch is the global `fetch` looked up on each call, so a `fetch` installed or wrapped after the client was built is the one used. With no global `fetch` and no `fetcher`, construction throws "No fetch implementation is available. Pass a fetcher to createClient." | `http:119-129` |
| 1.13 | One client is one transport. Every call and every stream (request stream, session stream, the `subscribe` socket's mint request, `transcribe`, `upload`) goes through the one `fetcher`; nothing reaches the global `fetch` once a `fetcher` is given. Another user or another server is another client. | `cl:600-613` header; `http:1-8`; `clt/one-transport.test.ts:1-11` [test]; `dcov` "One transport" [doc] |
| 1.14 | The `subscribe` socket is minted through the client's `fetcher` (`POST /users/:userId/stream`), so credentials the fetcher adds are what prove who the socket is. | `hub:10-14`; `clt/subscribe.test.ts:193` [test] |
| 1.15 | A non-2xx answer throws `ClientHttpError` with `status` (the HTTP status; `0` when the client refused before sending) and `body` (parsed JSON, or text if it does not parse, or `{ error }` for a status-0 refusal). | `cty:49-65`; `http:52-66`, `:15-22` |
| 1.16 | A client has no tenant option. A tenant is a request header the server reads (`x-tenant-id` by default; the server's `tenantIdHeader` renames it), so the client sends one through its `fetcher`. An empty or absent header means no tenant; a value containing `:` is refused `400`. | `cl:56-80` (no field); `packages/engine/src/routes/route-utils.ts:58-95`; `apps/docs/docs/fundamentals/state-and-scopes.md:509` [doc] |
| 1.17 | A client does not choose the flow. `fsd.flow(address)` names it per call. | `cl:866` (`flowHandle`); `dcfg` [doc] |

### 1a. `baseUrl` by situation

| # | Where the client runs | Routes answer at | `baseUrl` | Source |
|---|---|---|---|---|
| 1a.1 | Browser, same origin | `/api/flows/...` | `""`, or left off (a `FlowProvider` with no `baseUrl` builds its clients with `""`) | `uc:29`; `dcfg` [doc] |
| 1a.2 | Browser, same origin, Next.js `basePath: "/portal"` | `/portal/api/flows/...` | `"/portal"` | `dcfg` [doc]; arithmetic of 1.6 and 1.8 |
| 1a.3 | Node, worker, test, server component | `http://localhost:3000/api/flows/...` | `"http://localhost:3000"`. Needed anywhere with no page to resolve a relative path against; without it `fetch` rejects an invalid URL. | `dcfg` [doc] |
| 1a.4 | API on another origin | `https://api.example.com/api/flows/...` | `"https://api.example.com"` | `dcfg` [doc] |
| 1a.5 | Another origin behind a prefix | `https://api.example.com/portal/api/flows/...` | `"https://api.example.com/portal"` | `dcfg` [doc] |
| 1a.6 | Server mounted elsewhere (Node `serve(flowstate, { basePath: "/flows" })`) | `http://localhost:3000/flows/...` | the origin, plus `apiPath: "/flows"`. The Node host's `basePath` replaces `/api/flows`; it is not a prefix in front of it. | `dhost:49`, `:80`; `dcfg` [doc]; `clt/api-path.test.ts:68-81` [test] |
| 1a.7 | Never put the mount in `baseUrl`. `baseUrl: "/api/flows"` requests `/api/flows/api/flows/...`. A default Next.js app with no `basePath` and `baseUrl: "/api"` requests `/api/api/flows/...` and 404s. | arithmetic of 1.6 and 1.8; `dcfg` [doc] |

### 1b. In-process

| # | Fact | Source |
|---|------|--------|
| 1b.1 | A script, test or worker beside the engine passes `createInProcessFetch(flowState)` from `@flow-state-dev/engine` as `fetcher` and leaves `baseUrl` out. The calls reach the same routes, with the same checks, streams included. | `packages/engine/src/routes/in-process-fetch.ts:90-94`; `dcfg`, `dhost:63-80` [doc] |
| 1b.2 | `createInProcessFetch(app: FlowState \| FlowApiRouter, { basePath? })`. `basePath` default `"/api/flows"`; a path outside it answers 404. Match it to the client's `apiPath`. | `.../in-process-fetch.ts:18-26`, `:94`; `dhost:80` [doc] |

## 2. `FlowProvider` props

`FlowProvider` is exported from `@flow-state-dev/react`. Props type `FlowProviderProps` (`fc:42-62`):

| # | Prop | Type | Fact | Source |
|---|------|------|------|--------|
| 2.1 | `flowKind` | `string` | The flow hooks address by default. Optional. | `fc:43`, `:117` |
| 2.2 | `sessionId` | `string` | Stored in the context value and readable with `useFlowContext().sessionId`. **No hook or component in `@flow-state-dev/react` reads it** (`useFlow`, `useSession`, `useAction`, `useRequestStream`, `useApproval` and the renderers read `flowKind`, `userId`, `baseUrl`, `apiPath`, `fetcher` or `renderers` only). An app's own component can read it; a lab does. | `fc:44`, `:118`; grep of `useFlowContext` consumers in `packages/react/src` [source]; `labs/teammates/src/components/lines.tsx:126` |
| 2.3 | `userId` | `string` | Default caller id for hooks. Optional on the type. See 3.3 for what a hook does with none. | `fc:45`, `:119` |
| 2.4 | `baseUrl` | `string` | Forwarded to the clients hooks build. Unset: the page's own origin (`""`), with or without a `fetcher`. | `fc:46`; `uc:29` |
| 2.5 | `apiPath` | `string` | "Where the server mounts the flow API, after `baseUrl`. Default `"/api/flows"`." Every hook and component under the provider uses it. | `fc:47-52`; `rt/api-path.test.ts:55-67` [test] |
| 2.6 | `fetcher` | `ClientFetch` | "The fetch every hook's calls and streams go through ... Default: the global `fetch`." | `fc:53-59` |
| 2.7 | `renderers` | `RendererRegistry` | Item renderers for `ItemRenderer` and `ItemsRenderer`. Merged with the parent's (section 9). | `fc:60`; `packages/react/src/registry/block-renderers.ts:33-66` |
| 2.8 | `children` | `ReactNode` | Required. | `fc:61` |
| 2.9 | **Nesting.** A nested provider inherits each of `flowKind`, `sessionId`, `userId`, `baseUrl`, `apiPath`, `fetcher` from its parent when it does not set it. The test is `??`, so an explicit `""` for `baseUrl` is not "unset": `baseUrl=""` on a nested provider resets to the page's own origin. There is no way to unset `apiPath` or `fetcher` except to pass a value. `renderers` merge per slot (9.2): an inner `renderers={{ message: false }}` turns off the outer `message` renderer and keeps the other slots; `component`, `container` and `data` merge by key, the inner entry winning. | `fc:115-125`, `fc:66-103` [source]; `dcfg` [doc] |
| 2.10 | A `FlowProvider` is optional. Without one, a hook with no `userId` option uses `"devuser"` (3.3), and each hook builds its own client (3.6). | `uc:14-20`, `:33`; `useSession.ts:617` |
| 2.11 | `useFlowContext()` returns the merged context value `{ flowKind, sessionId, userId, baseUrl, apiPath, fetcher, renderers, clients }` and `{}` outside a provider. `clients` is the provider's own client cache and is not for apps. | `fc:20-34`, `:64`, `:150-152` |

## 3. What hooks inherit

| # | Fact | Source |
|---|------|--------|
| 3.1 | Every hook builds its calls through one client, made by `createClient({ userId, baseUrl: baseUrl ?? "", apiPath, fetcher })` from the hook's `userId` and `baseUrl` (or the provider's) and the provider's `apiPath` and `fetcher`. | `uc:18-32` |
| 3.2 | Overrides by hook (an option beats the provider's value; blank means the hook offers no such option and uses the provider's): see table 3a. | per row |
| 3.3 | `userId` when neither the hook nor the provider names one: `useSession` and `useRequestStream` and every hook that builds a client without a `userId` use `"devuser"` (a fixed default for local work); `useFlow` takes it from the client it builds, so also `"devuser"`; **`useAction` throws** `useAction requires userId (option or FlowProvider)`. `flowKind` missing: `useAction` throws `useAction requires flowKind (option or FlowProvider)`; `useRequestStream` throws the same for a `{ requestId }` source; `useFlow.createSession` throws "useFlow.createSession requires flowKind". | `uc:14-20`; `useSession.ts:617`; `useFlow.ts:60-62`, `:75-77`; `useAction.ts:50-59`; `useRequestStream.ts:140-163` |
| 3.4 | `apiPath` and `fetcher` come only from the provider, with one exception: `useVoice` takes its own `apiPath` and `baseUrl`. | `uc:18`; `useVoice.ts:24-26`, `:205`; `dcfg` [doc] |
| 3.5 | A `fetcher` that is a new function on each render makes a new client on each render, because the client is memoized on `(userId, baseUrl, apiPath, fetcher)` and held by `fetcher` in the provider's cache. A stable reference keeps the client, and so its open streams and socket. | `uc:5-8`, `:24-40`; `dreact` ("Pass a stable reference") [doc] |
| 3.6 | **One shared client per user and transport.** Under a provider, hooks with the same `userId`, `baseUrl`, `apiPath` and `fetcher` get the same client from that provider's cache, so they share one `subscribe` socket. Each provider has its own cache, so two providers never share a client. Outside a provider each hook builds its own. | `fc:28-37`, `:110-113`; `uc:33-39`; `rt/useSubscription.test.ts:150-171` [test: "shares one client ... under one provider", "gives each provider its own clients"] |
| 3.7 | The `userId` a hook acts as is the key of the shared client, so a hook with a `userId` override builds (or finds) another client than its siblings. | `uc:36` |
| 3.8 | A server component cannot call a hook. The package declares no `"use client"` boundary; the file that imports hooks or `FlowProvider` starts with `"use client";` (the quick start and the example page do). | no `"use client"` in `packages/react/src` [source]; `apps/docs/docs/getting-started/quick-start.md:141` [doc]; `exp:1` |
| 3.9 | Outside React, in a server component or route handler, use `createClient` with an absolute `baseUrl` (or an in-process `fetcher`). | `dcfg` "Choosing `baseUrl`" [doc] |

### 3a. Which options each hook takes over the provider's

Read from each hook's options type and its `useClient` call. "provider only" means the hook has no such option.

| Hook | `flowKind` | `userId` | `baseUrl` | `apiPath` | `fetcher` | `client` option | Source |
|------|:---:|:---:|:---:|:---:|:---:|:---:|--------|
| `useFlow` | option | option | option | provider only | provider only | none | `useFlow.ts:17-22`, `:59-62` |
| `useSession` | option | option | option | provider only | provider only | none | `useSession.ts:262-264`, `:615-618`, `:882` |
| `useAction` | option | option | option | provider only | provider only | none | `useAction.ts:12-16`, `:49-64` |
| `useRequestStream` | option | provider only | option | provider only | provider only | `client` (`Pick<Client, "flow">`) | `useRequestStream.ts:60-62`, `:85`, `:140-143` |
| `useVoice` | from its session | the session's | option | option | provider only | none | `useVoice.ts:24-26`, `:205` |
| `useResource`, `useSessionFeed`, `useSubscription`, `useView` | provider only | provider only | provider only | provider only | provider only | `client` | `useResource.ts:203`, `:222-223`; `useSessionFeed.ts:36`, `:70`; `useSessionList.ts:36`; `useSubscription.ts:45`, `:63-64`; `useView.ts:30`, `:71` |
| `useSessionList` | its own `flowKind` (and `flowId`), never the provider's: with neither set it lists with no flow filter | provider only | provider only | provider only | provider only | `client` | `useSessionList.ts:25-28`, `:53-66`; `internal/useLiveSessionRead.ts` [source] |
| `useResourceCollection`, `useResourceContent` | none (they take a session and a ref) | provider | provider only | provider only | provider only | none | `useResourceCollection.ts:179`; `useResourceContent.ts:34` |
| `useResourceManifest` | its session's (`session.snapshot?.flowKind ?? session.flowKind`) | provider | provider only | provider only | provider only | none | `useResourceManifest.ts:25-26` |
| `useApproval`, `useSuspensionForm` | provider | provider | provider only | provider only | provider only | none | `useApproval.ts:157-158`; `useSuspensionForm.ts:188-189` |
| `useHarnessLines` | its session's | its session's (`useClient({ userId })`) | provider only | provider only | provider only | none | `useHarnessLines.ts:116`, `:123` |
| `FlowNavigator` | n/a | provider | provider | provider | provider | `client` | `FlowNavigator.ts:153`, `:708` |

| # | Fact | Source |
|---|------|--------|
| 3a.1 | `client` on a hook is for a host that builds its own client (its own user, origin and `fetcher`), so the socket and the reads carry its credential. Pass a stable reference. Default: the provider's client. | `useSubscription.ts:39-45`; `useView.ts:30`; `useResource.ts:10`; `useSessionList.ts:35` |
| 3a.2 | The existing configuration page says hooks "(`useFlow`, `useSession`, `useAction`, `useVoice`, …) accept `flowKind`, `userId` and `baseUrl` as overrides". That is true of `useFlow`, `useSession` and `useAction` only; see 3a and "Contradictions found". | `dcfg` vs. the rows above |

## 4. Options of hooks that sit with the client configuration

Full signatures stay with the React API reference; these are the options other pages moved here. Each is read from the options type.

| # | Fact | Source |
|---|------|--------|
| 4.1 | **`useAction({ action, flowKind?, userId?, baseUrl?, result? })`**. `result: true`: `execute` resolves to `request.result()` (`status`, plus `output`, `outputNotRecorded` or `error`) and `loading` stays true until the request settles. Default (`result` unset or `false`): `execute` resolves when the server accepts the send, to `ExecuteActionResponse`. `execute(input, sessionId?)`. An unmount stops the wait and never the run. | `useAction.ts:11-39`; `rt/useAction-result.test.ts:55`, `:75`, `:147` [test] |
| 4.2 | **`useSession(sessionId, { live?, ... })`**. `live` default `false`. `live: true` opens one stream for the session after its first snapshot; each finished item any request in it keeps joins `items` about a second later, in reload order. Without `live` the hook follows only this page's own requests. The stream holds a connection open while mounted. If the server has no session stream, or refuses it, the item list behaves as if `live` were off, and no error is raised (the topic subscription of 4.3 is a separate effect, so the page scopes this to the item list). | `useSession.ts:269-298`, `:1936-1953` (`followSession`, "a stream refused or dropped before then leaves the view as it would be without `live`"); `rt/useSession-live.test.ts:186` [test: "without `live`, opens no stream"], `:311`, `:1167` |
| 4.3 | `live: true` also subscribes the **session, user and org** topics (`topic.session(id)`, `topic.user()`, `topic.org()`). On a `state` notice, or a `resource` notice its state may carry, the view reads its state again without its item history. A connect, a tick and a `resync` read too. Resource hooks are told which resource paths changed. | `useSession.ts:2054-2075` [source]; doc comment `:285-296` |
| 4.4 | A change this view's own request made is skipped while that request is in flight or its stream is open (the stream already carried it). A change that request makes after its stream closed is read like anyone else's. The skip applies to `state` and `resource` notices only. | `useSession.ts:2030-2037`; doc comment `:290-293` |
| 4.5 | On a host with push the change shows within about a second; on a host that cannot push the view reads its state every few seconds instead. | doc comment `:293-295`; `dreact` "Hearing requests you didn't send" [doc] |
| 4.6 | `Roster`, `BoardColumns` and `BoardList`, all three exported from `@flow-state-dev/workforce/react` (`packages/workforce/src/react/index.ts:12`, `:18`, `:27`), take `live?: boolean`, default `false`: read the roster or board again whenever another session hires, changes a worker, or changes a task. They also take `client?`. A `client` that has no `subscribe` is typed `live?: false`: `live: true` with it does not compile. Pass a stable `client`. | `wr/Roster.ts:80-117`; `wr/BoardColumns.ts:100-116`, `:189`; `wr/BoardList.ts:57-72`, `:125` |
| 4.7 | **`useClientData(session, { session?, user?, org? })`**. Each scope takes `string[]` (names, values typed `unknown`) or `Record<name, ZodSchemaLike \| true>`. With a Zod schema per name, the value is typed as the schema's output; with `true` or an array, `unknown`. The hook reads the session snapshot's `clientData`; it does not validate with the schema at run time (the schema is a type carrier: `_output`, optional `parse`). The server decides what is in the snapshot. | `useClientData.ts:11-50`, `:89-130`; `dcfg` "What the client can see" [doc] |
| 4.8 | **`useSubscription(topics, read, { pollIntervalMs?, enabled?, client? })`**. `enabled` default `true`, `false` subscribes nothing; an empty topic list subscribes nothing. `pollIntervalMs` omitted: no timer. `client`: `Pick<Client, "subscribe">`. | `useSubscription.ts:30-47`, `:71-82` |
| 4.9 | `useResource(def, { client?, pollIntervalMs?, all?, topicPrefix?, ... })`. `pollIntervalMs` is the timer pace where push can miss a change. `all`: at user or org scope a collection reads every entry, page after page; ignored for a single resource and at session scope. `topicPrefix` (with `all`) narrows to entries whose key starts with it. | `useResource.ts:178-222` |
| 4.10 | `useView(ref, input, { enabled?, pollIntervalMs?, client?, sessionId? })`. `pollIntervalMs` default 3 s, `null` for none. | `useView.ts:22-31` |
| 4.11 | `useDraft(namespace, id)` keeps unsent text in `localStorage` (section 10). | `useDraft.ts:1-12` |
| 4.12 | `useRequestStream({ source, flowKind?, baseUrl?, client?, filter?, includeTrace?, reconnectToken?, flush?, enabled?, reconnect?, ... })`. `reconnect` default `false`. `includeTrace` appends `?include=trace`. | `useRequestStream.ts:57-100`, `:147-155` |

## 5. Subscribing: `client.subscribe` and `client.live`

| # | Fact | Source |
|---|------|--------|
| 5.1 | `fsd.subscribe(topics: readonly WireTopic[], { onChange, pollIntervalMs? }): { close(): void }`. | `cl:568`; `hub:44-63` |
| 5.2 | A notice says that something under a topic changed, never what. It carries no rows. The caller reads again through the route it already reads with; that read is checked on the server like any other. | `cn:5-8`; `dapi` [doc] |
| 5.3 | **All subscriptions on one client share one connection** (one WebSocket). Each topic is counted; the last `close()` on a topic unsubscribes it, and the last handle's `close()` closes the socket. | `hub:1-8`; `clt/subscribe.test.ts:265` [test]; `dcov` "One socket" [doc] |
| 5.4 | **Push versus timer.** A host with push is one whose `GET <apiPath>/capabilities` answers `push: { transport: "websocket" }`; the route answers `push: pushCapability(...)`, which is that value when push delivery is enabled and `null` otherwise. `serve()` from `@flow-state-dev/node` enables it unless given `push: false` (default `true`; `pushSecret` is needed only when several processes serve one address). The Node app without `serve()`'s push answers `push: null`. A host without push answers `push: null` or no `push` field. On a host with push, the client mints a ticket through its `fetcher` and opens one socket. On a host without push, `onChange(null)` runs only on the `pollIntervalMs` timer and no socket is opened. Same code both ways. | `packages/engine/src/routes/http-handlers.ts:540`; `packages/engine/src/push/push-delivery.ts:109-111`; `packages/node/src/serve.ts:107-120`, `:374`; `packages/node/src/app.ts:37-41`, `:152-157`; `pd` `PushCapability`; `hub:10-26`; `clt/subscribe.test.ts:152`, `:164` [test]; `dapi` "On a host with no push" [doc] |
| 5.5 | **`pollIntervalMs`**: "Read on a timer at this pace wherever push can miss a change: the host has no push, the socket is down, or its bus doesn't cross processes. Omitted: no timer; reads happen on a notice, a connect and a reconnect." The timer runs: with no push; while the socket is down (from the first failed reconnect); until the socket's first `crossing` frame says `crosses: true`, and while it says `false`; and while one of its topics was refused (asked for again at each tick). Omitted, a refused topic is asked for again on reconnect only. The `crossing` frame carries the server bus's `crossesProcesses`, sent after the first ticket and on each change. The in-memory bus (the default, and what SQLite stores get) always says `true`, even with several processes, so the timer stays off and another process's change is not pushed. The Postgres bus says `false` until it hears its own ping, `false` while its listening connection is lost, and never `true` with no tail pool. | `packages/engine/src/push/socket-session.ts:183-184`; `packages/engine/src/bus/in-memory-bus.ts:1-11`, `:42`; `packages/store-postgres/src/bus.ts:112`, `:184`, `:236`, `:292`; `stores.md` "The change bus" [doc]; `hub:15-21`, `:51-56`; `clt/subscribe.test.ts:173` [test: omitted, no timer], `:209`, `:222`, `:285`, `:606`, `:626` |
| 5.6 | With one server process every change reaches an open socket: the default in-memory bus reports that it crosses processes, so the timer stays off while the socket is up. With several processes, a change made in another process reaches the socket only if the server's stores share notices across processes; otherwise it shows at the view's next read. | `dapi` "On several processes" [doc]; `bus/change-bus.test.ts:90` [test]; `engine/src/bus/in-memory-bus.ts:36-42` [source] |
| 5.7 | `onChange` gets: the notice that woke it, or **`null`** for a connect, a reconnect, a change of whether the server's bus carries notices between processes (the `crossing` answer, 5.5), or a timer tick. On `null`, read everything. | `hub:44-50`, `:22-26`; `clt/subscribe.test.ts:201`, `:222` [test] |
| 5.8 | `onChange` is called once on connect (only after the server acknowledges the ticket), and a throwing `onChange` does not stop the others. | `clt/subscribe.test.ts:201`, `:357`, `:693` [test] |
| 5.9 | A notice reaches every subscription whose topic covers it: same scope and session, and the same resource unless the subscription's topic names none. A topic the caller may not read is left out of the mint (the same way a nonexistent session is): `onChange` never hears it, and with `pollIntervalMs` the client asks again at each tick. | `hub:22-26`; `clt/subscribe.test.ts:246`, `:534`, `:606` [test]; `dapi` [doc] |
| 5.10 | **Notice shape `WireNotice`**: `{ topic: WireTopic, kind: ChangeKind, origin?: { requestId: string }, ids?: string[], partition?: string }`. `origin.requestId` names the request that made the change, when a request did. `ids` are opaque ids of what changed, when the publisher holds them. `partition` appears on a `board` notice of a partitioned ledger (an opaque key). The `{ topic, kind, origin? }` of the existing docs is the part an app acts on. | `pd:93-117`; `clt/subscribe.test.ts:560`, `:576` [test] |
| 5.11 | **`client.live(topics, options)`** keeps a screen current: reads now, and again on each heard notice. One read in flight and at most one waiting. A burst runs the read once more after the one in flight, not once per change. The waiting read gets the one notice that waited, or `null` when several different ones did. Reports a value only when it changed (compared by value). | `cl:570-579`; `live:1-30`, `:134-147`; `clt/live.test.ts:65`, `:103`, `:114`, `:250` [test] |
| 5.12 | `client.live` options: `read(notice \| null, signal)`, `onValue`, `onError`, `onStale`, `hear(notice)`, `paths`, `pollIntervalMs`, `readNow`, `topicsFromResult`. | `live:54-87` |
| 5.13 | **`client.live` `pollIntervalMs`: default `3000` ms; `null` for no timer; any other number sets the pace.** It is the timer wherever push can miss a change (same cases as 5.5). A subscription made with `null` is made with no `pollIntervalMs` at all. | `live:37-38`, `:68-72`, `:113`; `clt/live.test.ts:361-367` [test] |
| 5.14 | `readNow` default `true`; `false` leaves the first read to the subscription's connect. | `live:73-74` |
| 5.15 | `hear` filters which notices read. A connect, a reconnect, a tick (`null`) and a `resync` always read, whatever `hear` says. `paths` limits `resource` notices to those whose path falls under one of the roots. | `live:61-67`, `:125-132`; `clt/live.test.ts:176` [test] |
| 5.16 | A failed read tries again on its own, 1 s doubling to 30 s, and `onStale(true)` says the screen is stale until one lands. `close()` stops it. | `cl:573-575`; `live:14-17`; `clt/live.test.ts:285`, `:317`, `:266` [test] |
| 5.17 | **`useSubscription` timing.** On a host with push the read runs on each notice heard (coalesced as below), with no timer; on a host with no push it runs every `pollIntervalMs`. A burst of changes runs the read once more after the one in flight, not once per change. **No read on mount** (`readNow: false`): the subscription's connect is the first read, so the first read stays where the screen already makes it. The read throws → tries again 1 s doubling to 30 s. `read` gets an `AbortSignal`, aborted when the subscription ends. `pollIntervalMs` omitted means no timer (`pollIntervalMs ?? null`). | `useSubscription.ts:3-23`, `:73-82`; `rt/useSubscription.test.ts:140-148` [test: three notices, reads `[r1, null]`] |
| 5.18 | `useSubscription` subscribes through the provider's client, so the provider's `fetcher` signs the socket in. An app that builds its own client passes it as `client`. | `useSubscription.ts:6-12`, `:39-45` |
| 5.19 | A subscription is kept across renders with an equal topic list (compared by topic key) and the latest `read` is the one called; a changed topic list closes the old subscription and opens a new one. | `rt/useSubscription.test.ts:173-195` [test] |
| 5.20 | `useSessionList` and `FlowNavigator` read through the user topic and re-list on a `run` notice (and when the page becomes visible). A disabled list subscribes to nothing. | `useLiveSessionRead.ts:14-33`; `rt/useSessionList.test.ts:60` [test] |

## 6. Topics

| # | Fact | Source |
|---|------|--------|
| 6.1 | `topic` is exported from `@flow-state-dev/client` and from `@flow-state-dev/core`. | `packages/client/src/index.ts:53`; `packages/core/src/index.ts:237` |
| 6.2 | `WireTopic` is `{ scope: "session"; id: string; resource?: string } \| { scope: "user" \| "org"; resource?: string }`. There are three scopes and no other topic. | `cn:34-43` |
| 6.3 | Constructors: `topic.session(id, { resource? })`, `topic.user({ resource? })`, `topic.org({ resource? })`. `{ resource }` narrows the topic to one resource under the scope. | `cn:46-67` |
| 6.4 | `topic.user()` and `topic.org()` name no id: "the wire topic names no user, org or tenant id, so a client cannot ask for someone else's scope by naming it. The server fills those from the caller it verified." They resolve to the signed-in caller's user and organization. | `cn:5-10`, `:52-57`; `dapi` [doc] |
| 6.5 | A topic without `resource` also hears changes narrowed to a resource under it. A narrowed topic's notices reach its unnarrowed subscribers with the narrowed topic. | `dapi` [doc]; `bus/change-bus.test.ts:94` [test] |

### 6a. Which notice kinds each topic produces

| # | Topic | Kinds it hears, and what writes them | Source |
|---|-------|--------------------------------------|--------|
| 6a.1 | `topic.session(id)` | `items` (an item was kept under one of the session's requests; names nothing); `request` (a request was created, its status moved, or it was deleted; `ids` holds the request id); `run` (the session record was written, or a run, a child session, under it: `ids` holds the run's session id); `state` (a session state patch, or the session born or deleted); `resource` (a session resource written, created or deleted; `topic.resource` holds the resource path); `board` (a task on a board filed in the session changed; `topic.resource` holds the board id, `ids` the task id). | `cn:13-32`; `bus/change-bus.test.ts:224`, `:265`, `:336` [test]; `bus/scope-notices.test.ts:164-188`; engine `bus/board-notice.ts:57-64` [source: read for what `topic.resource` holds] |
| 6a.2 | `topic.user()` | `run` (one of the user's sessions was created, titled or deleted, or one of its requests started or ended; names nothing, because the topic spans the user's organizations); `state` and `resource` (user-scope state or resource written); `board` (a row on a board stored at user scope; names no task); `suspension` (one of the user's suspensions was written or deleted; names nothing). | `cn:13-32`; `bus/change-bus.test.ts:282-334` [test: `run` on session set, on request set, again on a request write whose status did not change; none on items or a state delta; `run` and `suspension` on session delete]; `bus/scope-notices.test.ts:171` |
| 6a.3 | `topic.org()` | `state` and `resource` (org-scope state or resource written, including a collection entry created from a run or from a browser). A row private to one owner is not named on the org topic; the scope still wakes. | `bus/scope-notices.test.ts:164`, `:188`, `:215`, `:236` [test] |
| 6a.4 | Any topic, any kind | `resync`: the bus may have missed notices (it reconnected). Every subscriber reads once, whatever kinds it otherwise listens for. | `cn:29-31`; `live:125-127` |

| # | Fact | Source |
|---|------|--------|
| 6a.5 | **`ChangeKind`** is `"items" \| "request" \| "run" \| "state" \| "resource" \| "board" \| "suspension" \| "resync"`: eight kinds. | `cn:32` |
| 6a.6 | `"run"` on the user topic is sent when a session is created, retitled or deleted (any whole-record session write), and when one of its requests starts or ends (a request write). A session state delta (`patchField` and the other delta verbs) and streamed items send none to the user topic, though the session's own topic hears them. | `bus/change-bus.test.ts:282-334` [test]; `dapi` "list again on a `"run"` notice" [doc] |
| 6a.7 | `"state"` and `"resource"` come from writes to session, user or org state and client-readable resources, in a run or from a browser route (collection create, content update, delete). Scope-state `state` and `resource` notices come from session, user and org writes only; request and block-instance state raise neither. A request's state field delta (`patchField`, `incField`, `pushToArray`, `deleteField`) does publish `request` on its session and `run` on the session's parent, and a session state delta publishes `run` on the session and its parent (`bus/publish-writes.ts:25-30`). A resource with no client configuration publishes nothing. | `packages/engine/src/bus/scope-changes.ts:1-26` [source]; `bus/scope-notices.test.ts:171`, `:199`, `:227`, `:236` [test] |
| 6a.8 | **`topic.resource`** on a notice: for `"resource"`, the resource path (a collection entry may carry its entry key in `ids`); for `"board"`, the board id; otherwise absent. | `cn:22-26`; `bus/scope-notices.test.ts:236` [test]; `bus/board-notice.ts:57-64` [source] |
| 6a.9 | **`"resync"` and `null` mean read everything.** | `live:125-127`; `hub:44-50` |
| 6a.10 | A change another server process writes reaches the socket only on a bus that crosses processes. | `dapi` [doc] |
| 6a.11 | `origin.requestId` is present on `state`, `resource` and `board` notices written inside a run; absent on a browser route write. | `bus/scope-notices.test.ts:164`, `:236` [test]; `bus/board-notice.ts:57-64` [source] |

## 7. `request(id).stream(options)` and the cursor

| # | Fact | Source |
|---|------|--------|
| 7.1 | `fsd.flow(address).request(requestId).stream(options): RequestStreamHandle`. Options: the request callbacks plus `startingAfter?: number`, `lastEventId?: string`, `dedupWindowSize?: number` (default 1000), `includeTrace?: boolean`, `reconnect?: boolean`. | `cl:275-289`; `str:22-29` |
| 7.2 | **Which cursor goes where.** `startingAfter` is sent as the **query** `?starting_after=<n>`. `lastEventId` is sent as the **header** `Last-Event-ID`, and only when `startingAfter` is unset; `startingAfter` wins when both are given. On a later connection the client uses the sequence number of the last event it delivered as `starting_after`. | `cl:1053-1063`; `str:219-245`; `str:23` ("Ignored when `startingAfter` is set") |
| 7.3 | `includeTrace: true` adds `?include=trace` and also delivers `block_trace`, `router_decision` and `state_snapshot` items. | `cl:1056-1060`; `cl:278` |
| 7.4 | `dedupWindowSize`: how many recent event keys are remembered to drop a duplicate. Default `1000`. | `str:27-28`, `:39`; `dcov` [doc] |
| 7.5 | **Reconnect.** By default a request stream does not reconnect after a failed connection: `onError` fires and it stops. When the server ends the stream before the request ends (it cuts off a reader that falls behind), the stream resumes after the last event it delivered; after five connections in a row that deliver nothing it gives up with `onError`. With `reconnect: true`, a failed connection opens again without limit after the client's backoff (1 s doubling, at most 30 s, reset once a connection delivers), resuming after the last event, unreported. A 401, 403 or 404, or five empty answers in a row, still ends it with `onError`. `close()` ends it, a pending reconnect included. | `cl:403-413`, `:275-289`; `str:195-203` |
| 7.6 | A session stream (`fsd.sessions.stream`) retries with backoff by itself; a request stream does not unless `reconnect: true`. | `dcov` "What the client handles" [doc]; `cl:487`; `str:195-203` |
| 7.7 | A request that already ended and is resumed past its end answers empty each time; that is what the five-empty-answers limit is for. | `str:195-203` |

## 8. A re-sent item id

| # | Fact | Source |
|---|------|--------|
| 8.1 | A client that holds items must overwrite by item id, not append. An item's `id` is unique within one request, not within a session. A keyed item emitted again takes the same id and goes back to in progress, then done again. | `rss:318-352` (`upsertItem`: `itemsById.set(key, item)` replaces the held item); `clt/request-stream-store.test.ts:126-134` [test: a second `upsert` of id `a` replaces it, `size()` stays 1] |
| 8.2 | The key an item is held under defaults to `item.id`. A store that holds a whole session's items passes `keyOf` to key by request and item id together, since two requests can keep the same id. Hooks do this. | `rss:263-272`; `clt/request-stream-store.test.ts:296-318` [test: both requests' items kept when keyed `requestId/id`]; `dreact` "Hearing requests you didn't send" [doc] |
| 8.3 | When a replaced item changes its `ts` or `itemIndex`, it is re-sorted into place; when it changes only values it stays where it was (`upsert` returns `false`). | `rss:325-355`; `clt/request-stream-store.test.ts:126-140` [test] |

## 9. Renderers and nested providers

| # | Fact | Source |
|---|------|--------|
| 9.1 | `RendererRegistry` slots: `message`, `reasoning`, `block_trace`, `tool_output`, `status`, `source`, `error`, `suspension`, `stopped` (each a component or `false`), and `component`, `container`, `data` (each a record of key to component or `false`). `false` suppresses rendering for that slot or key. | `packages/react/src/registry/block-renderers.ts:33-66` |
| 9.2 | **Nested merge.** A nested `FlowProvider`'s `renderers` merge with the parent's per slot: for each of the nine single slots, the child's value wins when it is set (`!== undefined`), so a child's `false` suppresses a parent renderer; otherwise the parent's stays. `component`, `container` and `data` merge by key (`{ ...parent, ...child }`), so the child wins per key and the parent's other keys stay. With no parent registry the child's is used, with none at all, `{}`. | `fc:66-103` [source]; `rt/flow-provider-data-renderers.test.ts:9` [test: keeps the parent's `data` renderers and adds the child's] |
| 9.3 | What a renderer receives: a renderer registered in a slot gets `{ item }`, and `{ item, line }` when drawn as a conversation line; a `stopped` renderer gets `{ line }`. Only the card chosen when no `suspension` renderer is set (a `renderers.component` entry named by `render.component`, or a built-in approval, question, selection or form card) gets `{ item, isResolved, resolution }`. A `data` item with no renderer for its `dataType` draws nothing. This row now lives on the UI components page (R-36). | `packages/react/src/components/ItemRenderer.ts:244-254`, `:260-285`; `ItemsRenderer.ts:98` |
| 9.4 | `renderers` is read by `ItemRenderer` and `ItemsRenderer` through `useFlowContext()`. | `packages/react/src/components/ItemRenderer.ts:252`; `ItemsRenderer.ts:76` |

## 10. What the browser holds, and the four questions

The page's own settings are not stored: a `createClient` or `FlowProvider` setting is code, held in memory for the life of the client or provider. What a browser client holds locally:

| # | Part | Who owns it | Who can see it | Where stored | How many | Source |
|---|------|-------------|----------------|--------------|----------|--------|
| 10.1 | The **client** (`createClient`) and its one transport and one socket | The app code that built it (or the `FlowProvider`, which builds and caches its clients) | The code that holds the reference | In memory, in the page; gone on reload | One per `(user, baseUrl, apiPath, fetcher)` per provider; a hook outside a provider builds its own | `uc:18-41`; `hub:1-8` |
| 10.2 | The **live item list** a hook shows (`useSession`'s `items`, a request-stream store) | The hook instance | The component tree under that hook | In memory; rebuilt from the server snapshot and streams on mount or reload | One per mounted `useSession` or request-stream store; keyed by `requestId` plus `id` when it holds a session | `useSession.ts:660-690`; `rss:263-272` |
| 10.3 | The **exposed-state snapshot** (`session.snapshot`, which `useClientData` reads) | The server decides what is in it: the scope's `client.expose` and each resource's client block. A scope that declares `client.derived` is refused by `defineFlow`; a computed value is a view (`defineView`, read with `useView`). The browser cannot opt into private state. | The component tree | In memory, a copy the hook read from the server | One per `useSession` view | `dcfg` "What the client can see" [doc]; `useClientData.ts:96-110`; `core/src/flow/defineFlow.ts:79-107` |
| 10.4 | **Unsent draft text** (`useDraft(namespace, id)`, `useDraftSend`) | The app, by the `namespace` it passes (and the box, when an app has several); `id` is what the box writes to, such as a session id | Any script on that browser origin; no other user or device. Stored as plain text under key `<namespace>:<id>`. | The browser's `localStorage`, on that device. Falls back to memory when storage throws (quota, private mode) or there is no `window`. Text typed before `id` is known is kept in memory and stored when the id arrives. | One entry per `(namespace, id)`; setting `""` or a send that lands removes it. A late send clears the stored draft only if it still equals the sent text | `useDraft.ts:1-12`, `:15-37`, `:55-62`; `useDraftSend.ts:48-72`; `index.ts:168` |
| 10.5 | No `createClient` option or `FlowProvider` prop changes any of the above: nothing configures the draft's key or turns the storage off. A different `userId` is a different client, but a draft key names no user, so two users on one browser origin with the same `namespace` and `id` read each other's draft. | `useDraft.ts:15-37` [source]; `cl:56-80` |
| 10.6 | One sentence the page may keep: the browser holds what it last received. | `dcfg` "What the client can see" [doc] |

## 11. Moved rows, checked against the code

See section 12 for the ledger. Facts that arrive only through that ledger are above.

## 12. The R-14 rows from other pages: carried or dropped

Each row from `grep -rhE --include=*.record.md -e '→ R-14( \(corrected by pass 5\))?$'` over `docs/contributing/docs-revamp/pages`, plus two rows named in other fact sheets' hand-off notes (`ui-components.facts.md:439`, `live-updates.facts.md:128`). 26 rows from the grep, 2 from the hand-off notes.

| # | Row (shortened) | Verdict | Where above |
|---|-----------------|---------|-------------|
| 12.1 | Hooks run only in client components (`"use client"`) | **Carried**, reworded: the package has no boundary; React's rule is why. A server component that imports a hook errors. The error text is Next's/React's, not the package's, so the sheet does not quote it. | 3.8 |
| 12.2 | `baseUrl` and Next.js `basePath`: client appends `/api/flows`; omit `baseUrl` on same origin; pass only a Next `basePath` such as `"/portal"` | **Carried.** "Give it only a Next.js `basePath`" is incomplete: `baseUrl` is also needed with no page (Node) and for another origin. | 1.6, 1a.1 to 1a.7 |
| 12.3 | `FlowProvider` props table: `baseUrl` (`""` = page's own origin) and what hooks inherit (one shared client per user) | **Carried**, corrected: one client per user *and transport* (`baseUrl`, `apiPath`, `fetcher`), per provider. | 2.4, 3.1, 3.6 |
| 12.4 | `useAction` `result: true` waits and resolves to the result; default resolves on acceptance | **Carried.** | 4.1 |
| 12.5 | `useSession` `live: true` adds finished items from requests sent elsewhere; default follows only this page's own | **Carried**, with the extra: it also subscribes session, user and org topics. | 4.2 to 4.5 |
| 12.6 | `fetcher` on `createClient` and `FlowProvider` applies to every call and stream from that client | **Carried.** | 1.10, 1.13, 1.14, 2.6 |
| 12.7 | `useClientData` optional Zod schema per name types each value; untyped otherwise | **Carried**, with the correction that the schema is a type carrier only; nothing parses at run time. | 4.7 |
| 12.8 | Browser client keeps unsent draft text in `localStorage` beside the live list and exposed-state snapshot, and what a provider or `createClient` setting changes about it | **Carried.** No setting changes it (10.5). The page keeps one sentence. | 10 |
| 12.9 | Renderer props and nested `FlowProvider` merge of `renderers` (child wins per slot, `false` included; `component`/`container`/`data` merge by key) | **Carried.** The ui-components Reference page owns the registry's slots; this page owns the merge. | 9.1 to 9.4 |
| 12.10 | Client live options: `pollIntervalMs`, `client.live` default and `null`, when the timer runs | **Carried.** Default 3000 ms, `null` for none. | 5.5, 5.13 |
| 12.11 | Tenant header row: set through the client's `fetcher`; no tenant option on `createClient` | **Carried.** | 1.16 |
| 12.12 | Client rule for a re-sent item id: overwrite in place | **Carried**, refined: overwrite by id (or by `requestId` plus id for a session-wide list). "In place" holds when order keys are unchanged; a changed `ts` or `itemIndex` moves it. | 8.1 to 8.3 |
| 12.13 | `request(id).stream` options and which cursor header or query it sends | **Carried.** `starting_after` is the query, `Last-Event-ID` the header, query wins. Adds `reconnect`, which the existing `dapi` options sentence omits. | 7.1 to 7.7 |
| 12.14 | Delivery timing and coalescing; no read on mount; `client` option | **Carried.** | 5.11, 5.17, 5.18 |
| 12.15 | Topic table: constructors, what they cover, notice kinds each produces (`run` on session create, title, delete, request start or end) | **Carried.** | 6.3, 6a.1 to 6a.3, 6a.6 |
| 12.16 | Topic options: `{ resource }`; user and org take no id and resolve to the signed-in caller | **Carried.** | 6.3, 6.4 |
| 12.17 | Notice shape `{ topic, kind, origin? }`; when the callback gets `null`; `origin.requestId` | **Carried**, widened: the type also has `ids` and `partition`. | 5.7, 5.10, 6a.11 |
| 12.18 | Notice kinds table: each kind, what wrote it, what `topic.resource` holds (path for `"resource"`, board id for `"board"`), `"resync"` and `null` mean read everything | **Carried**, corrected: there are eight kinds. The existing `dapi` list stops at seven (no `"suspension"`). | 6a.1 to 6a.9 |
| 12.19 | `fsd.subscribe(topics, { onChange, pollIntervalMs })` returns `close()`; one connection per client | **Carried.** | 5.1, 5.3 |
| 12.20 | `pollIntervalMs`: when the timer runs on a push host; omitted means no timer | **Carried.** | 5.5 |
| 12.21 | `useSession` `live`: subscribes session, user, org topics; hooks re-read on a change from any session and skip their own; `Roster` and `BoardColumns` `live` prop does the same | **Carried**, with the limit that the skip applies to `state` and `resource` notices only, and that `live` is `false` by default, and that `BoardList` takes it too. | 4.3, 4.4, 4.6 |
| 12.22 | `ui-components.facts.md:439`: what a renderer receives (`{ item }`, `line`) and the nested merge | **Carried.** | 9.2, 9.3 |
| 12.23 | `live-updates.facts.md:128`: the list of moved subscribe facts | Covered by 12.14 to 12.21; no extra fact in it. | n/a |

Rows dropped: none. One part of one row is dropped from the page:

- 12.1: the error message a server component produces. It belongs to React or Next, varies by version, and is not in this package.

## 13. Contradictions found

Where an existing doc and the code disagree, the code wins.

| # | Existing doc says | Code says | Source |
|---|-------------------|-----------|--------|
| 13.1 | `dcfg` FlowProvider table: `sessionId` "Default session. `useFlow({ autoCreateSession: true })` can mint one instead." | The value is stored and readable with `useFlowContext()`, but no hook in `@flow-state-dev/react` uses it. `useFlow` keeps its own active session in state and does not read the provider's. The page should say it is readable by an app's own components and nothing else. | `fc:44`, `:118`; `useFlow.ts:59-125`; section 2.2 |
| 13.2 | `dcfg`: "Hooks (`useFlow`, `useSession`, `useAction`, `useVoice`, …) accept `flowKind`, `userId` and `baseUrl` as overrides." | Only `useFlow`, `useSession` and `useAction` accept all three. `useRequestStream` takes `flowKind` and `baseUrl`; `useVoice` takes `baseUrl` and `apiPath`; most others take none. | table 3a |
| 13.3 | `dcfg`: `FlowProvider` `userId` is the "Default caller id." | True, with a caveat the doc omits: with no `userId` anywhere, `useSession`, `useFlow` and `useRequestStream` act as `"devuser"`, while `useAction` throws. | 3.3 |
| 13.4 | `dapi` (`fsd.subscribe`): a notice's kind is one of `"items"`, `"request"`, `"run"`, `"state"`, `"resource"`, `"board"` or `"resync"`. | `ChangeKind` also has `"suspension"` (on the user topic). | `cn:32` |
| 13.5 | `dapi` request-stream options: "`startingAfter` ..., `lastEventId` ..., `dedupWindowSize` ... and `includeTrace`", and "A request stream does not reconnect on its own". | A fifth option, `reconnect: true`, makes it reconnect. The default statement is true. | `cl:275-289`; `str:195-203` |
| 13.6 | `dcfg` table says nested providers merge `renderers` "child keys override". | Per single slot the child's value wins when set (`false` included); per `component`/`container`/`data` key the child wins. Both are "child overrides", but the doc does not say `false` suppresses. | `fc:66-103` |

## 14. Limits

- No option for headers, tokens, timeouts, retries or a tenant on `createClient`. Credentials and tenant go through `fetcher` (1.10, 1.16).
- A client is bound to one user. Another user is another client (1.13).
- A hook cannot override `apiPath` or `fetcher` (3.4), except that `useVoice` takes its own `apiPath`.
- `apiPath` and `fetcher` on a nested provider cannot be unset, only replaced (2.9).
- `baseUrl` cannot carry the server's mount (1a.7).
- `subscribe` never says what changed (5.2).
- A request stream does not reconnect unless asked (7.5).
- The `FlowProvider` `sessionId` prop is not used by any built-in hook (2.2).
- Draft text is plain text in `localStorage` and is not keyed by user (10.4, 10.5).

## 15. What the page leaves out

- Full signatures of `useSession`, `useFlow` and the other hooks (generated React API).
- The send options (`sessionId`, `requestId`, `metadata`, `stream`), which belong to the client API reference.
- How the push socket authenticates and ages out, the close codes and the mint chunking (internal, or HTTP API).
- What each item type is (Items reference).
- Server-side sign-in and tenant configuration (Authentication reference).


## Revise round 1

- The in-process example passes `flows: [support]`: `CreateFlowStateOptions.flows` is a list (`packages/engine/src/flowstate/types.ts:152-157`, `createFlowState.ts:407-411`).
- Rows 7.1-7.7 (request stream options, resume, reconnect) and 8.1-8.3 (item id re-send) moved to the Items and the stream page (R-06); the page links there. The session-stream retry (7.6) is already on that page.
- Row 9.1-9.4 (renderer registry merge and renderer props) lives on the UI components page (R-36); the page links there.
- The tenant header (x-tenant-id, `tenantIdHeader`, `:` refused with 400) is on Authentication (R-20); the page keeps one sentence and the example.
- `createInProcessFetch(app, { basePath? })` signature and the 404 outside `basePath` are not on a Reference page yet (R-12 is not written); the page keeps one sentence: give it the same path as the client's `apiPath`. Source `engine/src/routes/in-process-fetch.ts:25`, `:94`.
- `partition` on a `board` notice is an opaque key naming the slice (partition) of the board the task was filed in (`engine/src/bus/board-notice.ts:22-25`, `push/partition-key.ts:3-8`).

## Revise round 2

- Construction refusals: all three (`userId is required`, `createClient requires baseUrl, or a fetcher`, `No fetch implementation is available...`) throw `ClientHttpError` with `status: 0` (`http:43-48`, `:89-93`, `:100-102`, `:119-129`).
- `useSession` `live` re-reads state on a `state` notice, and on a `resource` notice that names no resource or one the held snapshot's resources may hold (`useSession.ts` `stateCarries`, the `hear` filter). The page says "a resource the view's state snapshot holds".
- Without push, the `useSession` read runs at the `client.live` default, 3000 ms (`live:37-38`; `useSession` passes no `pollIntervalMs`). 4.5's "every few seconds" is 3 s.
- `run` is "a session record was written: the topic's own session, or a run (a child session) under it" (`cn:13-32`).
- The socket's request is the mint request (5.4, 1.14); the page calls it "one request through its `fetcher`" and does not name the ticket.
- The cross-process caveat and the timer rule are each stated once on the page, under `pollIntervalMs`.

## Revise round 3

- The page shows `src/flows/support/flow.ts` (a `handler` named `reply` with input `{ text }`, exported as `support`) so the in-process example's import resolves, and `src/components/desk-inbox.tsx` (`useAction({ action: "reply" })`, taking `flowKind` and `userId` from the provider) so `src/app/page.tsx`'s import resolves. `handler({ name, inputSchema, execute })` and `defineFlow({ kind, actions: { reply: { block } } })()` as on `background-work.md`; `useAction` returns `{ execute(input, sessionId?), loading, error }` (`packages/react/src/hooks/useAction.ts:31-42`). All seven ts/tsx examples type-check at their titled paths (strict, `moduleResolution: "bundler"`, workspace packages).
- One wording for push: "a host with push" / "a host without push", defined once under Subscribing by the `push` field of `GET /api/flows/capabilities` (5.4).
- The timer's cross-process case is the bus's answer (5.5), not the process count: on the default in-memory bus the timer stays off with several processes, and another process's change shows at the view's next read.
- `useSubscription` on a host with push reads on each notice (`useSubscription.ts:73-82`: `liveRead` over `client.subscribe`, `readNow: false`).

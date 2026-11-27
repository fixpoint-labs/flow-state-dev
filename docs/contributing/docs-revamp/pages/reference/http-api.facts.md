# Facts for HTTP API (R-13, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments (route handlers and their header comments count as the surface of an HTTP API), tests, `goals/`, and one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. **[test]** marks a fact a test pins. **[source]** marks a fact read from handler code where no test or doc comment pins it. **[doc]** marks a fact the existing user docs state and the code agrees with. Nothing here was run against a deployed server. Where an existing doc and the code disagree, the code wins and the fact says so under "Contradictions found".

Paths are from the repo root. Abbreviations:

- Engine routes, `packages/engine/src/routes/`: `rt` = `router.ts`, `hh` = `http-handlers.ts`, `ru` = `route-utils.ts`, `fr` = `createFlowApiRouter.ts`, `ar` = `action-routes.ts`, `sr` = `stream-routes.ts`, `ssr` = `session-routes.ts`, `ste` = `state-routes.ts`, `sst` = `session-stream-routes.ts`, `chr` = `child-session-routes.ts`, `rr` = `resume-routes.ts`, `anr` = `answer-routes.ts`, `abr` = `abort-routes.ts`, `rsr` = `request-status-routes.ts`, `rec` = `recovery-routes.ts`, `vr` = `view-routes.ts`, `scr` = `scope-routes.ts`, `blr` = `blob-routes.ts`, `acl` = `attachment-claim.ts`, `rsc` = `resource-routes.ts`, `dbr` = `debug-routes.ts`, `rau` = `route-auth.ts`, `ipf` = `in-process-fetch.ts`, `nau` = `network-auth.ts`
- Engine other: `enc` = `packages/engine/src/streaming/encode-event.ts`, `sse` = `.../streaming/sse.ts`, `ssm` = `.../streaming/sse-stream.ts`, `res` = `.../streaming/resume.ts`, `cf` = `.../streaming/client-filter.ts`, `push` = `packages/engine/src/push/push-delivery.ts`
- `ev` = `packages/contracts/src/items/events.ts`, `rst` = `packages/contracts/src/types/request-status.ts`, `att` = `packages/contracts/src/attachments.ts`
- Hosts: `app` = `packages/node/src/app.ts`, `srv` = `packages/node/src/serve.ts`, `lam` = `packages/node/src/aws-lambda.ts`, `nxt` = `packages/next/src/createNextHandler.ts`, `vch` = `packages/vercel/src/handler.ts`
- Client: `cl` = `packages/client/src/client.ts`, `clh` = `packages/client/src/internal/http.ts`
- Tests, `packages/engine/test/` unless prefixed: `rtt` = `router.test.ts`, `rse` = `request-security.test.ts`, `abt` = `abort.test.ts`, `sbb` = `streaming/sse-buffer-bound.test.ts`, `sed` = `stream-routes-external-dispatch.test.ts`, `src` = `stream-routes-resume.test.ts`, `sgr` = `suspension-resume-generalized.test.ts`, `rex` = `resume-expiry.test.ts`, `rrr` = `resume-route-refusal.test.ts`, `rct` = `recovery-routes.test.ts`, `rst-t` = `request-status-route.test.ts`, `brt` = `blobs/blob-routes.test.ts`, `hat` = `transports/http-adapter.test.ts`, `rsT` = `resource-state-routes.test.ts`, `foo` = `flow-instance-ownership.test.ts`, `ridf` = `request-id-owner-fence.test.ts`
- `it` = `packages/integration-tests/src/two-users-one-tenant/session-id.test.ts`; `nt` = `packages/node/test/`; `nxt-t` = `packages/next/test/`
- Existing docs: `dsetup` = `apps/docs/docs/server/setup.md`, `dcr` = `apps/docs/docs/server/connection-resilience.md`, `dca` = `apps/docs/docs/resources/client-access.md`, `dapi` = `apps/docs/docs/api/server.md`, `ddock` = `apps/docs/guides/deploying-with-docker.md`, `dhost` = `apps/docs/docs/server/host-adapters.md`

## What the page is

A Reference page: tables and lookups, no narrative, no word budget. The plan asks for four tables (every endpoint with method, path, body and response; the request lifecycle; reaching one copy of a flow; status codes) and two lookups ("Which endpoint starts an action?", "What does a wrong session return?"). Reference pages in this tree carry their own flag and row tables and are not held to the six-row cap (see `cli.facts.md`).

The "mount" is `/api/flows`. Every path below is relative to it unless it starts with `/api/flows`. The default is set by the engine (`fr:` `CANONICAL_ROUTE_NAMESPACE`), by `createInProcessFetch` (`ipf:` `DEFAULT_BASE_PATH`) and by the client (`clh:` `DEFAULT_API_PATH`); the Node host's `basePath` option moves it (`app:29-33`), and the client's `apiPath` option follows (`cl:62-70`; `clh:remount`).

## 1. Conventions that hold on every endpoint

| # | Fact | Source |
|---|------|--------|
| 1.1 | The routes are served by one dispatcher with exactly four method handlers: `GET`, `POST`, `PATCH`, `DELETE`. There is no `PUT`, `HEAD` or `OPTIONS` handler. Through `createInProcessFetch` and the Node host, any other method answers `405 { error: "Method not allowed" }`. The MCP adapter's endpoint (`<basePath>/:kind/mcp`, or `<basePath>/:kind` when dedicated, default `/mcp/:kind`) takes only `POST`: `GET` and `DELETE` there answer `405`, plain text `Method Not Allowed`, header `Allow: POST`. | `fr:770-774`; `ipf:121-130`; `nt/app.test.ts:130` [test]; `packages/mcp/src/createMcpTransportAdapter.ts:140-171`, `:597-601` [source] |
| 1.2 | A path that matches no route answers `404 { error: "Route not found" }`. The same body answers a known path with a method the path does not take, such as `GET` on an action route (the route table is method-aware). A method outside the four never reaches the table: `405` through the Node host and in-process fetch (`ipf:135-137`; `app:144`). | `hh:517`, `:976`; `rtt:294-310` [test: "returns not_found when method does not match an existing path"] |
| 1.3 | Method matching is case-insensitive. Empty path segments are dropped (`/api/flows//sessions` is `/api/flows/sessions`); a segment that is only whitespace is an id, not dropped. | `rtt:314-325`, `:353` [test] |
| 1.4 | Path segments are decoded once. A `%2F` stays inside its segment (this is how a collection topic with slashes travels). A segment that is not valid percent-encoding is kept as written. | `rtt:391-460` [test]; `packages/engine/src/routes/parseFlowRoute.ts` (`decodePathSegments` doc comment) |
| 1.5 | A request body is JSON. An empty body is read as `{}`. A non-empty body must carry `content-type: application/json` (parameters such as `; charset=utf-8` and any letter case are fine) or the route answers `415 { error: "Request body must be sent with content-type: application/json" }`. A body that is JSON but not an object is a `400` `Request body must be a JSON object`. A non-empty JSON-typed body that does not parse throws the parser's `SyntaxError`, which `errorStatus` maps to `500 { error: <message> }`. | `ru:677-709`, `:651-668`, `:700`; `rse:25-48` [test] |
| 1.6 | The router refuses a browser's cross-site write: any `POST`, `PUT`, `PATCH` or `DELETE` whose `Sec-Fetch-Site` header is `cross-site` answers `403 { error: "Cross-site mutation refused" }` before the route runs. Reads (`GET`) are not checked. Requests with the header absent, `same-origin`, `same-site` or `none` pass. Routes that a transport adapter mounts (webhooks, MCP, the connector keys route) are matched first and are not subject to this check. | `fr:668-727`; `rse:51-91` [test] |
| 1.7 | An error body is JSON `{ "error": "<text>" }`. Many routes add `message` (and sometimes `field`, `index`, `limit`) next to a stable code in `error`. The client throws `ClientHttpError` with `status` and the parsed `body` for any non-2xx answer. | `ru:45-50`; `clh:56-62`; `cl:` `ClientHttpError` use |
| 1.8 | A thrown error that no route handled answers `500` (a validation error answers `400`, an unsupported media type `415`), with `{ error: <message> }`. The router's `onError(error, { method, path })` sink is called first. | `hh:979-989`; `ru:655-675` |
| 1.9 | The caller's `userId` rides in the JSON body for writes (`userId`) and in the query for reads that name one (`?userId=`), on an app that configures no sign-in. With a sign-in, the server resolves the caller from the request's credentials and ignores body and query values for identity. | `ar:106-131`; `ssr:233-236`; `ssr:399-403`; `cl:` `userId` doc "Sent as caller input, never trusted" (`cl:58-61`) |
| 1.10 | A tenant is named by the `x-tenant-id` request header, or the header name set by `tenantIdHeader`. An empty or absent header means no tenant. A tenant id containing `:` is rejected with `400`. | `ru:58-95`; `hh:471-475` |
| 1.11 | A request id is the caller's to choose: a send may carry `requestId` in its body so a retry reaches the same request. An id another caller already holds is replaced with a fresh one for this caller. The `409 { error: "request-id-in-use", message: 'Request "<id>" cannot be used by this caller' }` is for an id another caller takes between that check and the dispatch write; sending again resolves to this caller's own request. (`ar:133-145`, `:288-293`) | `ar:133-145`, `:287-292`; `ridf:266` [test] |
| 1.12 | A request's response header `x-request-id` carries the id the request runs under, on a `202` and on the inline stream. | `ar:341`, `:368` |

## 2. Endpoints

Columns for the page: method, path, body or query, response. Status codes beyond the success one are in section 5.

### 2.1 Flows and capabilities

| Method | Path | Takes | Answers | Source |
|---|---|---|---|---|
| GET | `/api/flows` | nothing | `200 { flows: [{ id, kind, cardinality, requireUser, actions: string[], actionSchemas: { <action>: JSON Schema } }] }`, one row per registered instance. A pinned instance is listed only to a caller who matches its pin. The built-in default write flow is never listed. Needs no sign-in. | `hh:520-537`, `:945-973` |
| GET | `/api/flows/capabilities` | nothing | `200 { userStream: boolean, push: { transport: "websocket" } \| null }`. `userStream` is `false` on every host today (`hh:540`); it is a separate field from the push socket, which `push` reports. `push` is `{ transport: "websocket" }` under `serve()` and `null` elsewhere (Next.js, Vercel, `createServerApp` alone, Lambda). | `hh:539-541`; `push:108-111`; `app:152-158`; `nt/serve-push.test.ts:82-89`, `:194-195` [test]; `cl:` `FlowCapabilities` (`cl` type at `packages/client/src/types`, `userStream: boolean`) |
| GET | `/api/flows/:flowId/identity` | `?userId=` (open apps only) | `200 { userId, orgId }`: who the server acts as under that flow's sign-in. `404 Unknown flow` for an unknown flow or a caller outside the instance's owner pin; `401`-class status with `{ error: "unauthenticated", message }` when the flow's sign-in refuses. | `scr:207-232`; `cl:906` |

### 2.2 Actions and sessions

| Method | Path | Takes | Answers | Source |
|---|---|---|---|---|
| POST | `/api/flows/:flowId/actions/:action` | body `{ input, userId?, requestId?, metadata?, attachments? }`, no session | Starts the action in a new session. `202` or the SSE stream (see 4). | `rt:131-141`; `ar:74-369`; `cl:` `ExecuteActionRequestBody` use at `cl:873-885` |
| POST | `/api/flows/:flowId/:sessionId/actions/:action` | same body; `sessionId` in the path (a `sessionId` field in the body is read when the path has none) | Starts the action in that session, creating it when the id is unused. | `ar:90`; `rt:131-141` |
| POST | `/api/flows/:flowId/sessions` | body `{ userId?, sessionId?, title?, description?, tags?, metadata?, state? }` | `201 { session }`. Creates a session without running an action. The id is the body's `sessionId` or a generated `sess_...` id. `state` is parsed through the flow's session state schema so defaults fill in. A flow that binds its sessions (a readonly session state field or a `session.createCheck`) refuses a state the schema rejects with `400` (`SessionCreateRefusedError`); any other flow keeps the state as sent and validates it when its actions run. | `session-birth.ts:240-285` via `ssr:468-480`;  `ssr:381-513` |
| GET | `/api/flows/sessions` | query `flowKind`, `flowId`, `userId`, `limit`, `offset`, `include=dispatch-runs,status`, `state.<field>=<value>` | `200 { sessions: [...] }`. Rows are client session records (see 2.2.1). `include=status` adds `requestStatus` and, when it waits for a user, `requestWaitsForUser` to each row. `include=dispatch-runs` also returns sessions a dispatcher ran work in. Any other `include` token is `400` `include accepts "dispatch-runs" and "status"; received "<token>"`. A `state.` filter needs `flowId` or `flowKind`, and names a readonly state field; otherwise `400`. With a sign-in the list is narrowed to the caller and `userId` cannot widen it. | `ssr:96-141`, `:179-346`; `cl:620-630` |
| GET | `/api/flows/sessions/:sessionId` | nothing | `200 { session }` | `ssr:357-375` |
| PATCH | `/api/flows/sessions/:sessionId/metadata` | body `{ title?, description?, tags?, metadata? }` | `200 { session }`. `metadata` is merged into the stored object; the other fields replace. `409` `Session "<id>" kept changing while its metadata was written; try again` when concurrent writers outlast the bounded retries. | `ssr:548-612` |
| DELETE | `/api/flows/sessions/:sessionId` | nothing | `204`, empty. Removes the session, its resource content and state, and its attachments. | `ssr:517-546` |
| GET | `/api/flows/sessions/:sessionId/requests` | query `status`, `limit`, `offset`, `include_items`, `include_result_output` | `200 { requests: [...] }`: each request record plus `retryable: boolean`. Items are left out unless `include_items` is `true` or `1`. A request's `result` is sent as a summary with `hasOutput`, and carries `output` only with `include_result_output`. | `ssr:614-660` |
| GET | `/api/flows/sessions/:sessionId/state` | query `clientData`, `include_items`, `item_types`, `offset`, `limit` | `200 { sessionId, flowKind, at, sessionCreatedAt, clientData: { session?, user?, org? }, resources?: { session?, user?, org? }, items?, pagination? }`. `items` and `pagination` (`{ offset, limit, total, hasMore, nextOffset }`) appear only with `include_items`. `limit` defaults to 100. `clientData` filters by `session.<name>`, `user.<name>`, `org.<name>` (a bare name is session scope). | `ste:29`, `:56-254`; `ru:326-366` |
| GET | `/api/flows/sessions/:sessionId/children` | query `limit` (1 to 100, default 25), `offset` (0 to 10,000, default 0) | `200 { children: [{ id, parentSessionId, createdAt, updatedAt, flowId?, status? }] }`, oldest first. `status` is `active` (not finished: queued, running or waiting), `completed`, `failed`, `incomplete` or `aborted`; absent when the job has no run under the caller. A row can also carry `topic?` and `coordinate?`, written by the dispatch seam (`chr:122-215`). `400 { error: "limit must be 1–100" }` outside the range. The ceiling is the host's `maxChildSessionListLimit` (default 100). | `chr:36`, `:55`, `:440-538`; `fr:` `maxChildSessionListLimit` doc |
| GET | `/api/flows/sessions/:sessionId/stream` | query `since`, `session_created_at`, `item_types` | SSE. See 6.3. | `sst:186-243` |

#### 2.2.1 What a session is on the wire

| # | Fact | Source |
|---|------|--------|
| 2.2.1a | Every session answer sends the session record minus `resources`, with `id` set to the id the caller used and `state` cut to the fields the flow exposes (`session.client.expose`) or declares readonly. State a flow does not expose is never sent, and no request flag widens it. | `packages/engine/src/routes/client-session.ts:1-54` |
| 2.2.1b | Fields on the record a caller sees include `flowKind`, `flowId`, `userId`, `orgId`, `tenantId?`, `parentSessionId?`, `title?`, `description?`, `tags?`, `metadata?`, `version`, `createdAt`, `updatedAt`. | `packages/engine/src/stores/types.ts:35-95` |
| 2.2.1c | Creating a session with an id that exists answers `409 { error: 'Session "<id>" already exists' }`. A create the flow refuses answers the refusal's status with `{ error, field? }`. | `ssr:500-510`; `ru:137-142` |
| 2.2.1d | A session id beginning with the server's write-session prefix is reserved. As `sessionId` in the create body or the action body it is `400 { error: "reserved-session-id", message }`. In a route's path (action, view, session routes) the router refuses it before the handler as an unknown session, `404 { error: 'Unknown session "<id>"' }`. | `ssr:425-431`; `ar:92-97`; `packages/engine/src/routes/reserved-addresses.ts:28-40`; `hh:479` |

### 2.3 Requests

| Method | Path | Takes | Answers | Source |
|---|---|---|---|---|
| GET | `/api/flows/:flowId/requests/:requestId/stream` | query `include=trace`, `starting_after=<n>`; header `Last-Event-ID: <requestId>:<n>` | SSE. See 6. | `sr:93-319` |
| GET | `/api/flows/:flowId/requests/:requestId/status` | query `include_result_output=true\|1` | `200` a status snapshot `{ id, status, startedAtMs, ageMs, completedAtMs?, lastHeartbeatAt?, sessionId?, result? }`. `result` appears only with the flag. | `rsr:34-93` |
| POST | `/api/flows/:flowId/requests/:requestId/abort` | nothing | `204` stopped here, which includes a suspended request (parked) or an interrupted one no gate holds, ended `aborted`; `202` recorded for the process running it; `404`; `409` (`abr:37-72`). | `abr:116-167`; `abt:207`, `:342`, `:371`, `:588` [test] |
| POST | `/api/flows/:flowId/requests/:requestId/resume` | body `{ suspensionId, action, data? }`; `Accept: text/event-stream` optional | `202 { requestId }`, or the continuation's stream. Statuses in 5.3. | `rr:92-267` |
| POST | `/api/flows/:flowId/requests/:requestId/answer` | same body | same answer shapes. User stops only. Statuses in 5.3. | `anr:71-187` |
| POST | `/api/flows/:flowId/sessions/:sessionId/requests/:requestId/retry` | optional body `{ inputOverride? }` | `202 { status: "in_progress", request: { id, flowKind, flowId, actionName, status, retryOf }, session? }`. A new request id; the original stays. | `rec:70-176` |
| POST | `/api/flows/:flowId/sessions/:sessionId/requests/:requestId/continue` | query `include=trace`; `Accept: text/event-stream` optional | `202 { requestId }` (same id), or the continuation's stream. | `rec:192-302` |
| GET | `/api/flows/active-requests` | nothing | `200 { entries: [{ requestId, flowKind, actionName, sessionId?, startedAt, lastHeartbeatAt, ageMs }] }`: the requests running now that the caller may see. | `rec:359-378` |
| POST | `/api/flows/users/:userId/check-interrupted` | query `staleThresholdMs` | `200 { interrupted: [{ requestId, sessionId?, flowKind, flowId, actionName, interruptedAt }] }`: the requests this call marked `interrupted`. | `rec:461-526` |
| GET | `/api/flows/users/:userId/interrupted-requests` | nothing | `200 { interrupted: [...] }`, same row shape: every `interrupted` request of that user, whoever marked it; sweeps nothing. | `rec:556-588` |

Limits and refusals specific to these rows:

| # | Fact | Source |
|---|------|--------|
| 2.3a | `check-interrupted` takes the larger of `staleThresholdMs` and the host's `staleSweepThresholdMs`: a caller can widen the window, never tighten it. A value at or below the host's, zero and negatives included, sweeps as if left out. A value that is not a number is `400 { error: "staleThresholdMs must be a number" }` and sweeps nothing. The host's `queuedGraceMs` applies; the caller cannot change it. | `rec:439-526`; `rct:224-260` [test: "honours a value above the host threshold", "rejects a value that is not a number with 400"]; `dcr:` "Both sweep bounds" paragraph [doc] |
| 2.3b | Both user routes check that the `:userId` in the path is the caller when the app signs callers in. A `:userId` that is only whitespace is `400 userId is required`. An empty `:userId` is dropped as an empty path segment (1.3), so `/users//check-interrupted` matches no route: `404 Route not found`. | `rec:461-468`, `:556-562`; 1.3; `rau:` `routeSubject` `user` case |
| 2.3c | `interruptedAt` on the listing falls back to the record's last update for a record that never stamped one; `flowId` falls back to `flowKind` for a record written before instance ids existed. | `rec:556-588`; `rct:396-410` [test] |
| 2.3d | Retry takes only `interrupted` or `failed` requests. `retryable` on a session's request row is only `isPublicReentryAllowed(record.source, publicReentrySources)`: it checks the source, never the status (the page says so outright), so a `completed` row from `http` reads `true`. The status rule is enforced by the retry route (`409` otherwise). (`ssr:653-657`; `rec:84-100`) | `rec:84-98`; `ssr:654-657` |
| 2.3e | Retry, continue, resume and abort act on the request id. Retry, continue and resume refuse a request whose source is not caller-facing (`http`, `mcp`, `scheduled`, plus a host's `publicReentrySources`): resume answers it as an unknown request, retry and continue likewise (`404 Request "<id>" not found`). The `answer` route is open to every source. | `rr:113-120`; `rec:109-117`, `:212-216`; `anr:19-21`; `fr:` `publicReentrySources` doc |
| 2.3f | A request that is not suspended and not a user's stop, a dynamic scheduled dispatch and a path whose `:sessionId` is not the request's session are refused by `continue`: see 5.4. | `rec:218-248` |
| 2.3g | `abort` reads the request by id. It does not read `:flowId`, so the path's flow address is not checked on abort, unlike resume, retry, continue and status. Not pinned by a test. | `abr:137-168` [source] |
| 2.3h | A request id another user or tenant owns is answered as an unknown request on every request route (`404 Request "<id>" not found`), the same body as an id nobody used. The stream route answers `404 Unknown request "<id>"` instead (see 5.1). | `ru:152-154`, `:206-213`; `rau:` `hiddenRequestResponse` |

### 2.4 Resources, session-addressed

`:ref` is the resource's name on the flow. `:topic` is a collection entry key and may contain `/`.

| Method | Path | Takes | Answers | Source |
|---|---|---|---|---|
| GET | `/api/flows/sessions/:sessionId/manifest` | nothing | `200 { flowKind, resources: [{ ref, kind: "collection" \| "single", scope, hasClientData, client: { content?, state? } }] }`, plus `pattern` and `prefetchWindow` on collections only; a resource with nothing client-visible is left out (`rsc:770-810`) | `rsc:729-815` |
| GET | `/api/flows/sessions/:sessionId/resources/:ref/content` | nothing | `200 { ref, content }` for a single resource | `rsc:139-189` |
| GET | `/api/flows/sessions/:sessionId/resources/:ref/:topic/content` | nothing | `200 { ref, topic, content }`; `content` is `null` for an item with no content row | `rsc:192-270` |
| POST | `/api/flows/sessions/:sessionId/resources/:ref` | body `{ topic, content? }` | `201 { topic }` | `rsc:272-391` |
| PATCH | `/api/flows/sessions/:sessionId/resources/:ref/:topic/content` | body `{ content }` | `200 { ref, topic }` | `rsc:394-464` |
| DELETE | `/api/flows/sessions/:sessionId/resources/:ref/:topic` | nothing | `200 { ref, topic }`. A topic that does not exist is still `200`. | `rsc:817-898`; `dca:` "Deleting a topic that does not exist is still a `200`" [doc] |
| GET | `/api/flows/sessions/:sessionId/resources/:ref` | query `limit` (1 to 200, default 50), `cursor`, `topicPrefix` | `200 { items: [{ topic, storageKey, clientData? }], nextCursor? }`. `clientData` is omitted (undefined) for a resource with no `client.data` projection; the list never sends `hint` (only the single-item route does, `rsc:705-720`). Needs `client.state.read`. | `rsc:470-620`; `rsc:578-618` |
| GET | `/api/flows/sessions/:sessionId/resources/:ref/:topic` | nothing | `200 { topic, storageKey, clientData }`; `200 null` for an absent item; with no `client.data` projection, `{ topic, storageKey, hint }`. Needs `client.state.read`. | `rsc:622-727`; `rsT:445` [test: 403 without state.read] |

| # | Fact | Source |
|---|------|--------|
| 2.4a | Resource routes check the resource's `client` permissions, not the caller's body: `content.read`, `content.create`, `content.update`, `content.delete`, `state.read`. A resource the flow declares without the matching permission answers `403` (`Content read not permitted for "<ref>"`, `Create not permitted ...`, `Update not permitted ...`, `Delete not permitted ...`, `State read not permitted ...`). A `ref` that is not a declared session, user or org resource answers `404 Unknown resource "<ref>"`. | `rsc:159-171`, `:213-221`, `:293-307`, `:415-425`, `:523-531`, `:647-655`; `rsT:294`, `:307`, `:445` [test] |
| 2.4b | Collection mutations over HTTP work for session-scoped collections only; a user or org collection write answers `501 Collection mutations only supported for session scope`. A projected (read-only) collection answers `403 "<ref>" is a read-only projected collection` to create, update and delete. | `rsc:301-304`, `:324`, `:421-423`, `:433`, `:845-855` |
| 2.4c | A create with a missing or blank `topic` is `400 Missing or invalid topic`; an update with no `content` is `400 Missing or invalid content`; a topic that does not match the collection's pattern is `400`. A create on a topic that exists is `409 Item "<topic>" already exists`. A delete whose item changed during the request is `409`. A state schema that cannot be seeded from `{}` is `400` naming the field. | `rsc:311-314`, `:336`, `:358`, `:439`, `:885`; `dca:` "What the write endpoints refuse" [doc] |
| 2.4d | A list `limit` outside 1 to 200 is `400 limit must be 1–200`. | `rsc:470-471`, `:539-542` |
| 2.4e | A collection topic literally named `content` is shadowed by the `/:ref/content` route and cannot be read through the item-state route. | `rtt:273-284` [test: "prefers content over state-get"]; `dca:` [doc] |
| 2.4f | The `POST` writes the item's state first and its content second. A failed `POST` after the state write leaves a live item with no content row. | `dca:` "A create isn't final the moment it returns" [doc]; `rsc:358-390` |

### 2.5 Resources and views with no session

| Method | Path | Takes | Answers | Source |
|---|---|---|---|---|
| GET | `/api/flows/resources/:scope/:key` | `:scope` is `user` or `org`; query `userId` (open apps only) | `200 { scope, key, value?, version }`. `version` is `0` when nothing is stored yet. `400 collection` when the key is a collection. | `scr:62-98` |
| GET | `/api/flows/resources/:scope/:key/entries` | query `limit` (1 to 200, default 50), `cursor`, `topicPrefix` | `200 { items: [{ topic, storageKey, value, version }], nextCursor? }`. `400 not_a_collection`; `403 not_readable` without `client.state.read`; `400 invalid_limit`. | `scr:100-203` |
| GET | `/api/flows/resources/:scope/:key/entries/:entry` | nothing | `200 { topic, storageKey, value, version }`, or `200 null` for an absent entry or one the caller may not read. `400 invalid_entry` when the entry does not match the collection's pattern. | `scr:157-173` |
| POST | `/api/flows/resources/:scope/:key/actions/:action` | the action route's body | Runs the action the resource's `runBy` names, as that flow's session for the caller; answers as the action route does. `403 not_writable` when the resource sets no `runBy`; `409 runby_flow_missing` when the named flow is not registered or does not declare the resource; `501 no_default_write_flow` for `runBy: "default"` on a host with no default write flow. | `scr:240-310`; `hh:620-651` |
| POST | `/api/flows/:flowId/views/:view` | body `{ input?, userId?, changed? }` | `200 { output, topics, hears, keys?, partial? }` for a user or org view. Nothing is stored. | `vr:1-30`, `:153-159` |
| POST | `/api/flows/:flowId/:sessionId/views/:view` | same | the same answer for a session view, on that session. | `vr:1-30` |

| # | Fact | Source |
|---|------|--------|
| 2.5a | An invalid `:scope` is `400 { error: "invalid_scope", message }`. | `scr:73`, `:122`, `:255` |
| 2.5b | A view's address must match its scope: a session view at the sessionless path is `400 view_needs_session`; a user or org view at the session path is `400 view_takes_no_session`; an unknown view or flow is `404`; a view that fails answers `400` (validation), `409` (read only), `503` (retryable), `422` (`view_model_call`, `view_no_session`, `view_unrecorded_read`, other flow errors), else `500 view_failed`. | `vr:111-126`, `:232-264` |
| 2.5c | `changed` in a view body is a hint `{ topic, kind, ids }` with 1 to `NOTICE_MAX_IDS` string ids; anything else is ignored and the view runs whole. | `vr:176-196` |
| 2.5d | The reads and views in this table resolve the caller through the flow's own sign-in, never from body or query values (except the open-app development resolver's `userId`). | `scr:1-18`; `vr:17-30` |

### 2.6 Attachments, voice, push

| Method | Path | Takes | Answers | Source |
|---|---|---|---|---|
| POST | `/api/flows/blobs` | raw file bytes as the body; `Content-Type` is the file's type; query `userId` (open apps), `filename` | `201 { attachment: { type: "file", mediaType, filename?, data: "fsd-blob:<id>" } }` | `blr:68-108`; `rt:41-45` |
| POST | `/api/flows/:flowId/blobs` | same; the flow's own sign-in checks the uploader | same. `404 Unknown flow` for an unknown flow. | `hh:736-740`; `brt:361` [test] |
| GET | `/api/flows/blobs/:blobId` | nothing | `200` the file's bytes: `content-type` the stored type, `content-disposition` `inline` for `image/*` and `attachment` otherwise, `x-content-type-options: nosniff`, `cache-control: private, no-cache`. | `blr:112-158`; `brt:246` [test] |
| POST | `/api/flows/transcribe` | audio bytes (`Content-Type` the audio type) with query `userId`, `language`, `model`; or JSON `{ userId, audio: <base64>, mediaType?, language?, model? }` (`mediaType` defaults to `audio/webm`) | `200` a transcript. Limit 25 MiB. `501 transcription_not_configured` with no voice provider; `501 provider_does_not_support_transcription`. | `sr:377-440`; `ru:` |
| POST | `/api/flows/users/:userId/stream` | body `{ topics: [...] }` | `200 { transport: "websocket", ticket, path, topics }`: the topics the caller may hear and a ticket that lasts 30 seconds. `404 This host serves no push` on a host with no push; `400` for a body that is not `{ topics }`. | `push:125-176`; `push/ticket.ts:21` |
| GET | `/api/flows/users/:userId/stream` | a WebSocket upgrade | The change-notice socket, taken by `serve()` before the router sees the request. A plain `GET` that reaches the router answers `426 This route takes a WebSocket upgrade`. | `hh:717-721`; `srv:` `servePush`, `upgrade` handler |

| # | Fact | Source |
|---|------|--------|
| 2.6a | Attachment rules: media types allowed are `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `application/pdf`, `text/plain`, `text/markdown`, `text/csv`, `application/json`, `application/yaml`, `text/html`, `application/xml`. Any other type is `415 attachment_type_refused`. A file over 20 MiB is `413 attachment_too_large`; a text file over 200 KiB is `413 attachment_text_too_large`; a PDF over 100 pages is `413 pdf_too_many_pages`; a text file that is not UTF-8 is `415 attachment_not_text`; an unreadable PDF `415 pdf_unreadable`; an empty body `400 attachment_empty`; no `userId` on an open app `400`. | `att:35-62`, `:181-190`; `blr:68-216`; `brt:99-200` [test] |
| 2.6b | A server with no blob store answers `501 attachments_not_configured`. A host whose disk does not last between requests (Vercel) answers `501 attachments_unavailable` when the blob store keeps bytes on that disk. | `blr:50-60`; `vch:` `onThisHost`; `brt:118-135` [test] |
| 2.6c | A message names uploaded files in its action body's `attachments: [{ type: "file", mediaType, data, filename? }]`. At most 10 images and 5 documents per message. Needs a session id, and the action must write a user message. Refusals: `400 attachment_invalid`, `400 attachments_not_accepted`, `400 attachment_type_refused`, `400 attachment_limit`, `404 attachment_not_found` (not the caller's upload), `409 attachment_already_sent` (already claimed into another session), `501 attachments_not_configured`. | `acl:63-185`; `att:174-190` |
| 2.6d | Anyone who cannot read the file's session, and any file that does not exist, gets `404 { error: "attachment_not_found" }`: one answer for all. On the send path (an action body's `attachments`) the body also carries `index` and `message: "No such upload of yours."`. | `ru:127-129`; `brt:219-245` [test]; `acl:153-155` |
| 2.6e | Transcribe: no request `model` and no provider `defaultModels.transcribe` is `400 { error: "no_model", message }`. A `VoiceError` from the provider answers `{ error: <kind>, message }` with `voiceErrorToHttpStatus`: `auth` 401, `rate_limit` 429, `not_found` 404, `invalid_input` 400, `format_unsupported` 415, `provider_unavailable` 503, `network` 502, `aborted` 499, `unknown` 500. | `sr:466-520` [source] |

### 2.7 Debug routes

Gated. Read-only inspection of a session's resources, for the DevTool.

| Method | Path | Answers | Source |
|---|---|---|---|
| GET | `/api/flows/debug/storage` | `200 { storage: { kind, bytes, location? } \| null }`: the store's own size reading (`StoreRegistry.storageSize`); `null` for a store that can't measure itself (in memory). Host route: authentication only, no session | `dbr:` `handleDebugStorage`; `test/debug-storage-route.test.ts` [test] |
| GET | `/api/flows/sessions/:sessionId/debug/resources` | the resource tree | `dbr:` `handleDebugListResources`; `rt:` debug entries |
| GET | `/api/flows/sessions/:sessionId/debug/suspensions` | `200 { suspensions }`; query `status`, `flowKind`, `userId`, `limit` | `dbr:200-225`; `cl:684-690` |
| GET | `/api/flows/sessions/:sessionId/debug/resources/:ref/items` | a collection's items; query `limit`, `cursor`, `topic` | `cl:692-697` |
| GET | `/api/flows/sessions/:sessionId/debug/resources/:ref/content` | the raw content | `cl:699` |
| GET | `/api/flows/sessions/:sessionId/debug/resources/:ref/:topic/content` | one item's raw content | `cl:700-705` |

| # | Fact | Source |
|---|------|--------|
| 2.7a | The debug routes are off unless the router's `debugEndpointsEnabled` is `true` or the environment variable `FSDEV_DEBUG_ENDPOINTS` is `1`. Off answers `403 { error: "debug_endpoints_disabled" }`. `fsdev dev` turns them on. | `dbr:56-97`; `fr:` `debugEndpointsEnabled` doc |
| 2.7b | When on, the `Origin` header must be loopback (`localhost`, `127.0.0.1`, `[::1]`) or match `debugAllowedOrigins`: an entry matches by exact equality, and only an entry ending in `*` is a prefix match, on the exact prefix or the prefix followed by `:` (a port variant); an `Origin: null` header counts as no origin. Otherwise `403 { error: "debug_endpoints_origin_rejected", origin }`. A request with no `Origin` is refused the same way unless `debugAllowAnonymousLocal` is `true` or `FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL` is `1`. | `dbr:85-110`; `fr:` doc |
| 2.7c | They answer `404 { error: "session_not_found" }` for an unknown session and `404 { error: "resource_not_found", ref }` for an unknown `ref`. | `dbr:168`, `:208`, `:259-262` |
| 2.7d | They bypass `client` shaping on purpose; `secret` fields stay out. | `dbr:1-10` |

### 2.8 Routes a hosted server adds beside these

| Method | Path | What | Source |
|---|---|---|---|
| POST | `/api/flows/:flowId/webhooks/:provider` | A provider's webhook, when `createFlowState({ adapters })` includes the webhook adapter. Verifies the signature (`401 invalid_signature`), `400 invalid_payload`, `202` accepted or ignored. Page owner: R-32. | `packages/engine/src/transports/webhook/createWebhookTransportAdapter.ts:76-79`; `.../webhook/routes.ts:50-353` |
| POST | `/api/flows/:flowId/schedules/<scheduleId>/dispatch` | The schedule tick's fire. Body `{ nominalFireTime? }`. `202 { status: "accepted", scheduleId, origin, requestId }`; `200 { status: "skipped" \| "duplicate" }`; `404 flow_not_found`, `404 schedule_not_found`; `401 unauthorized`. A flow with no `schedules` answers as an unknown flow. Mounted on every router. Page owner: R-33 (the page keeps one line). | `packages/engine/src/transports/scheduled/createScheduledEndpointAdapter.ts:21-48`; `.../scheduled/routes.ts:48-300` |
| GET | `/api/flows/:flowId/schedules` | `200 { static: [{ id, cron, action, timezone, description?, enabled }], dynamic: { provided: boolean } }` | `.../scheduled/routes.ts:319-380` |
| POST | `/api/flows/:flowId/mcp` (default) or `<basePath>/:kind` (dedicated) | The MCP adapter, when mounted. `dedicatedBasePath: true` mounts it outside `/api/flows` at `/mcp/:kind`. Page owner: R-34. | `packages/mcp/src/createMcpTransportAdapter.ts:85-160` |
| GET, POST, DELETE | `/api/flows/mcp-credentials`, `/api/flows/mcp-credentials/<server>` | The connector keys route a Workforce Lab's projects flow hands the host (`connectorKeys`). `GET` answers `{ servers: [{ name, setAt }] }`; `POST` body `{ value }` answers `{ name, setAt }`; `DELETE` answers `{ name, setAt: null }`. Never returns a key. A Lab that offers no MCP servers serves no such route, so the Lab's client reads `404` as "none offered". Served by any host that mounts the router with that adapter, on its `/api/flows` mount. | `packages/workforce/src/projects/mcp-credentials.ts:1-60`; `.../project-keys.ts:CONNECTOR_KEYS_PATH`; `packages/shift-manager/src/lib/mcp-credentials.ts:35-80`; `packages/workforce/test/connector-keys-route.test.ts` |
| GET | `/healthz` | The Node host's health check (`createServerApp`, so `serve()`, `fsdev serve`, `fsdev dev` and the Lambda handler). Outside `/api/flows`; the path is `healthPath`. `200 { status: "ok" }`; `503 { status: "initializing" }` while stores open; `500 { status: "error", message }` after init failed for good. | `app:129-138`; `nt/app.test.ts:77`, `:382`, `:411` [test] |

## 3. Reaching one copy of a flow

| # | Fact | Source |
|---|------|--------|
| 3.1 | The segment after `/api/flows` on a flow route is the flow's instance id. For an ordinary flow the id is its `kind`. A flow declared `cardinality: "collection"` registers one instance per id given; each is reached only by its id. `GET /api/flows` lists one row per instance with `id`, `kind` and `cardinality`. | `dsetup:` "Addressing an instance" [doc]; `hh:520-537`; `foo:` |
| 3.2 | The kind of a collection is not an address: `POST /api/flows/review/actions/run` is `404 Unknown flow "review"` when only `review-east` and `review-west` are registered. No copy is picked. | `ar:80-87`; `dsetup:` [doc]; `dapi:` `registry.get("review")` [doc] |
| 3.3 | A session and every request under it record the instance that created them. Naming that session through another instance answers `409 { error: "wrong-instance-session", message }`; a request through another instance on the action route answers `409 wrong-instance-request`; a record that predates instance ids and cannot be attributed answers `409 migration-required`. Nothing is written. | `ar:294-310`; `foo:172`, `:496` [test]; `dsetup:` [doc] |
| 3.4 | Routes that read a request (`stream`, `status`, `resume`) answer `404` when the addressed instance is not the request's owner, with the body used for an unknown request, so the instance's existence is not disclosed. `answer` answers `404 { error: 'Suspension "<id>" not found' }` instead (5.3a). `retry` and `continue` answer `400 Flow mismatch: request belongs to flow instance "<id>", not "<id>"`. `abort` does not read the path's flow (2.3g). | `sr:164-168`, `:252-256`; `rsr:63-67`; `rr:105-111`; `anr:89-98`; `rec:100-107`, `:205-210`; `rst-t:52` [test: status 404 when the flowKind does not match] |
| 3.5 | An instance can be pinned to an owner. A caller outside the pin gets the `404` an unregistered address gets, and the instance is left out of `GET /api/flows` for that caller. | `hh:945-973`; `ssr:410-420`; `vr:105-108` |
| 3.6 | The session, user and org routes (`/sessions/...`, `/users/...`, `/resources/...`) carry no flow segment: the session's own record names its instance. | `rt:` route table |
| 3.7 | A flow registered with `register()` after start is served from the next request in that process. | `dapi:` "Registering a flow after startup" [doc] |

## 4. Request lifecycle: what `POST .../actions/:action` does

| # | Step | Source |
|---|------|--------|
| 4.1 | An unknown flow, or the default write flow addressed directly, is `404 Unknown flow "<id>"`. | `ar:80-87` |
| 4.2 | A body `sessionId` starting with the reserved write prefix is `400 reserved-session-id`. A path session id with it is refused by the router before the handler (so before 4.1) as `404 Unknown session "<id>"` (2.2.1d). | `ar:92-97`; `packages/engine/src/routes/reserved-addresses.ts:32-40`; `hh:479` |
| 4.3 | The caller is resolved: from the flow's sign-in, else the host's, else (open apps) `body.userId`. A missing `userId` in an open app is `400` (the body-userId resolver's `401` is mapped to `400`); any other sign-in refusal keeps the resolver's status, normally `401`. | `ar:103-131`; `hat:227-242` [test: "returns 400 when userId is missing"] |
| 4.4 | The organization comes only from the resolved principal, never from the body. | `ar:155-161` |
| 4.5 | Attachments in the body are checked and claimed into the session, with the refusals in 2.6c (`404 attachment_not_found` for a file that is not the caller's upload; an existing session that is not the caller's is `404 Unknown session` here). A claimed file belongs to the send's session from the claim on, while the send is still being admitted: a second send of the same file into the same session is accepted (`already-owned`, the file is shared); into another session it is `409 attachment_already_sent`, pending or admitted. A refused send releases its claims, so the file goes back to its uploader unless another send relies on it. | `ar:204-216`; `acl:54-185`; `packages/engine/src/blobs/attachments.ts:78-130`; `packages/engine/src/blobs/shared.ts:19-35`; `brt:265-270` [test: "refuses a file already sent with another conversation"]; 2.6c |
| 4.6 | Admission: an org-less caller on an org-required flow `400 OrgRequired`; an unregistered flow `404`; "active stream capacity" `503`; a concurrency `reject` refusal; a session bound to another user, org or tenant `404 Unknown session "<id>"`; a flow that refuses the session it would create the refusal's status; a request id in use `409 request-id-in-use`; a session or request owned by another instance `409`; any other dispatch failure `500 { error: "DispatchFailed", message }`. Nothing is written for a refusal, and any attachments are handed back. | `ar:224-313`; `hat:244-300` [test]; `concurrency-refusal.ts` |
| 4.7 | After admission a `202` means the request is recorded and can be found. If recording or queueing fails, the POST fails (a `500`, with no orphaned `in_progress` record). | `ar:260-266`; `sed:235` [test: "action route returns 500 (not 202) and leaves no in_progress orphan"] |
| 4.8 | With `Accept: text/event-stream`, the response is the live SSE stream itself, status `200`, headers `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache, no-transform`, `connection: keep-alive`, `x-accel-buffering: no`, `x-request-id`, `x-session-id`. With any other `Accept`, the response is `202` with `content-type: application/json`. | `ar:327-345`; `sbb:99-128` [test] |
| 4.9 | The `202` body is `{ status: "in_progress", request: { id, flowKind, flowId, actionName, status: "in_progress" }, session?: { id } }`, with header `x-request-id`. The caller then follows the result through `GET .../requests/:requestId/stream` or polls `GET .../status`. | `ar:350-369`; `sbb:130-` [test: "answers a caller that did not ask for a stream with 202 and fills no live stream"] |
| 4.10 | With no `sessionId` in the path or the body the request runs in a new session and the response does not carry its id: the `202` omits `session` and the inline stream's `x-session-id` header is empty. To keep sends together, create the session with `POST /:flowId/sessions` first and pass its id on each send. The client's `send` handles this by `sessionId` option. | `ar:342`, `:359-365`; `cl:` `send` (`cl:873-900`) |
| 4.11 | The run does not depend on the connection. A client that disconnects (closes the POST's stream, or the GET stream) ends only its own tail; the request keeps running on a request-scoped host until it finishes or the host's timeout. Only the abort route stops it. | `ar:166-172` (comment on no `signal`); `sr:328-375`; `stream-routes-disconnect.test.ts:33` [test: "ends, though nothing else holds the request"] |
| 4.12 | Statuses a request moves through: `in_progress`, then one of `completed`, `incomplete`, `failed`, `interrupted`, `aborted`, `suspended`. `suspended` returns to `in_progress` when answered; `interrupted` returns to `in_progress` on `continue`. | `rst:11-18` |
| 4.13 | Each request is recorded as it runs; state persists on completion. | `dsetup:` "Request Lifecycle" step 7 [doc] (not asserted by a route; omit unless R-05 states it) |

## 5. Status codes

### 5.1 Codes and what they mean here

| Status | Where it comes from | Source |
|---|---|---|
| `200` | Reads; resource writes (`PATCH`, `DELETE`); views; the inline stream; a resume or answer with `Accept: text/event-stream`; a webhook skipped by a concurrency `reject` policy (`200 { status: "skipped", reason: "in_flight" }`) or answered as a provider handshake `acknowledge`; a schedule fire that was skipped or a duplicate. A webhook that matches no binding, or normalizes to no events, is `202 { status: "ignored" }` (`webhook/routes.ts:134,146,308`; `concurrency-refusal.ts:20-38`). | per route above |
| `201` | Session created; collection item created; attachment uploaded. | `ssr:512`; `rsc:390`; `blr:107` |
| `202` | Action, resume, answer, retry, continue accepted; abort recorded for another process; webhook and schedule fire accepted. | `ar:350`; `rr:265`; `anr:169`; `rec:158`, `:294`; `abr:166` |
| `204` | Session deleted; abort stopped the request here, or ended a suspended or interrupted request. | `ssr:545`; `abr:157-160` |
| `400` | Missing or invalid `userId`, `topic`, `content`, `action`, `suspensionId`; a body that is not a JSON object; a bad `limit`; `include` token; scope; resume payload failing the stored schema (`validationErrors`); session or flow mismatch on `continue` and `retry`; a reserved session id in a body; no durability provider on resume and answer; transcribe `no_model` and a provider's `invalid_input`. | sections 2 to 4; 2.6e |
| `401` | The sign-in refused the caller; the resolver's status is passed through (normally `401`). Body `{ error: <message> }`. Also a voice provider's `auth` failure on transcribe. | `ar:120-129`; `rau:` resolver block; 2.6e |
| `403` | A resource permission the flow did not grant; a cross-site mutation; the debug gate; a user-addressed route (`/users/:userId/...`) whose path user is not the caller (`Caller is not the owner of the requested resource`); a session route where the same user acts under a different organization (`Caller's organization does not own the requested resource`). Another user's session or request is `404`, never `403` (`rau:612-679`). | `rsc:`; `fr:726`; `dbr:`; `rau:` denials |
| `404` | Unknown route; unknown flow; unknown or another user's session (`Unknown session "<id>"`); unknown or another user's request (`Request "<id>" not found`; the stream says `Unknown request "<id>"`); unknown resource, item, view, suspension, schedule, attachment (`attachment_not_found`); a voice provider's `not_found`. | below; 2.6e |
| `405` | A method outside the four (Node host, in-process fetch); `GET` or `DELETE` on the MCP endpoint, plain text with `Allow: POST`. | 1.1 |
| `409` | See 5.4. | below |
| `410` | A suspension past its deadline (resume and answer). | `rr:182-186`; `anr:114-117` |
| `413` | An upload over a size or page limit. | 2.6a |
| `415` | A non-empty body that is not `application/json`; an unsupported upload type; a voice provider's `format_unsupported`. | 1.5; 2.6a; 2.6e |
| `422` | A view's own code failed. | 2.5b |
| `426` | The user stream route reached as a plain `GET`. | `hh:720` |
| `429`, `499` | Transcribe: a voice provider's `rate_limit` (429) or `aborted` (499). | 2.6e |
| `500` | An unhandled error; a non-empty JSON body that does not parse; a dispatch failure; a voice provider's `unknown`; a refused network bind (below). | 1.5; 1.8; 4.6; 2.6e |
| `501` | No voice provider; no blob store; collection mutation on a user or org collection; no default write flow. | sections 2.4 to 2.6 |
| `502` | Transcribe: a voice provider's `network` failure. | 2.6e |
| `503` | Active stream capacity; a retryable view failure; the Node host's `/healthz` while stores initialize; a voice provider's `provider_unavailable`; a webhook the server cannot dispatch: `session_unavailable`, `flow_unregistered` (with `message`), `dispatch_not_durable` (once with `failed`), `route_incomplete`. | `ar:251-253`; `vr:259`; `app:137`; 2.6e; `packages/engine/src/transports/webhook/routes.ts:232`, `:246`, `:269`, `:341`, `:351` [source] |

The page splits this table into success, two refusal and server tables, and does not claim it lists every code: routes a host adds (webhooks, schedules, MCP) have more on their own pages.

Not-found answers (what a wrong id returns):

| Probe | Answer | Source |
|---|---|---|
| Session id nobody used | `404 { error: 'Unknown session "<id>"' }` | `ru:118-120` |
| Session id owned by another user or tenant | On the action and view routes, the same status and the same words, byte for byte, in every app. On read, state, stream, resources, children, delete and patch, the owner check runs only when something in the app authenticates: with the default body-`userId` resolver and no flow sign-in, `authorizeRoute` returns allowed before any load and those routes serve any user's session (`rau:385-399`, `:355-357`; `ru:223-229` `isCheckedSession`). Tenant isolation always applies (sessions are read by tenant). In an open app the `403` org mismatch below fires only for a stored org other than `DEFAULT_ORG_ID` (`rau:536-560`). Where the owner check runs: the same status and the same words. A session of another organization that the same user holds is `404 Unknown session` on the action route only (`ar:277-280`); on the management session routes it is `403 Caller's organization does not own the requested resource` (`rau:670-679`). Nothing is written, and the body names neither the owner nor the organization. Posting an action into another user's session answers `404` before the request is acknowledged and before the session changes. | `ar:274-280`; `rau:` `hiddenSessionResponse`; `it:137-168` [test: "refuses an action posted into it ... before acknowledging it"]; `it:120-130` [test: "the same status and the same words as an id nobody has used"]; `hat:244-300` [test] |
| Request id nobody used, or another user's or tenant's | `404 { error: 'Request "<id>" not found' }` on status, abort, retry, continue, resume | `ru:152-154`; `rst-t:42` [test] |
| Request stream for the same | `404 { error: 'Unknown request "<id>"' }`; with a resume cursor (`starting_after`, or a `Last-Event-ID` whose stream id equals the request id; any other is ignored, `res:95-116`) the answer is an empty `200` instead, so a client that already read the whole log is owed "nothing new". An unknown flow is named first: `404 Unknown flow "<id>"`. | `ru:164-190`; `src:175-195` [test] |
| Attachment | `404 { error: "attachment_not_found" }` for gone, unowned and another's alike; on the send path plus `index` and `message: "No such upload of yours."` | `ru:127-129`; `acl:153-155` |
| Debug routes | `404 { error: "session_not_found" }` | `dbr:168` |

### 5.2 Network bind and host guards

| # | Fact | Source |
|---|------|--------|
| 5.2a | On a host that serves the network (`createNextHandler`, `createVercelHandler`, the Lambda handler, and `serve()` on a non-loopback interface), a flow that has no sign-in configured makes every request answer `500 { error: "Internal server error" }` (the real reason is written once to the host's log). The overrides are `allowUnauthenticated: true` on the handler or `serve()`, `--allow-unauthenticated` in `fsdev`, or a sign-in on every flow. `serve()` refuses to bind at all in that case, with a message naming the flows. | `nau:49-85`; `nxt-t:network-auth.test.ts:29-30` [test]; `nxt:` `createNextHandler` options; `srv:166-190` |
| 5.2b | `serve()` bound to a loopback host answers `403 Forbidden` (plain text) to a request whose `Host` header is not loopback. | `srv:` `fetch` (`isLoopbackAuthority`) [source] |

### 5.3 Resume and answer, in the order the code checks

`POST /:flowId/requests/:requestId/resume`. Body `{ suspensionId, action, data? }`, `action` one of `approve`, `reject`, `submit`, `skip`. With `Accept: text/event-stream` the answer is the continuation's live stream (`200`, same headers as the action stream except no `x-session-id`); otherwise `202 { requestId }` (the same id).

| Order | Status | When | Body `error` | Source |
|---|---|---|---|---|
| 1 | 404 | Unknown flow | `Unknown flow "<id>"` | `rr:97-100` |
| 2 | 404 | No such request; a request another instance owns; another user's or tenant's; a source that is not caller-facing | `Request "<id>" not found` (one body for all four) | `rr:102-120` |
| 3 | 400 | No durable execution on this host | `No DurabilityProvider configured. Resume requires durable execution.` | `rr:122-127` |
| 4 | 400 | `suspensionId` missing; `action` missing; `action` not one of the four | `Missing required field: suspensionId` / `Missing required field: action` / `Field "action" must be one of approve, reject, submit, skip` | `rr:134-148` |
| 5 | 409 | Request is not `suspended` | `Request is "<status>", not "suspended"` | `rr:150-154` |
| 6 | 404 | Suspension not found, or a wait gate (answered as missing) | `Suspension "<id>" not found` | `rr:156-165` |
| 7 | 409 | Suspension already resolved | `Suspension "<id>" has already been resolved (status: "<status>")` | `rr:166-170` |
| 8 | 410 | Past its deadline. Checked before the action and payload checks; the suspension is marked `expired`. | `Suspension "<id>" expired at <ms>` | `rr:182-187`; `rex:112`; `sgr:394` [test] |
| 9 | 409 | `action` not in the suspension's allowed set (default `approve`, `reject`; `user_input` stops default to `submit`) | `Action "<a>" not permitted for this suspension (allowed: ...)` | `rr:192-197`; `sgr:305` [test] |
| 10 | 400 | `submit`, or an `approve` that carries `data`, fails the stored `resumeSchema`. `skip` and `reject` carry no payload and skip this check. A `submit` with no data against a schema is a `400`, not a `500`; a bare `approve` against a schema whose fields are optional passes. The suspension stays pending. | `Resume payload failed validation against the suspension's resumeSchema`, plus `validationErrors`: an object keyed by field path (first error per field; the root is `""`) | `rr:199-216`, `:41-69`; `sgr:322`, `:347`, `:368` [test] |
| 11 | 409 | Another resume or continue holds the request's 60 second lease | `Concurrent resume in progress. Try again later.` | `rr:237-241`; `resume-under-lease.ts:55` (`RESUME_LEASE_MS = 60_000`); `rrr:99` [test] |
| 12 | 500 | Any other refusal | `Resume refused unexpectedly.` | `rr:243-246`; `rrr:104` [test] |

`POST /:flowId/requests/:requestId/answer` differs:

| # | Fact | Source |
|---|------|--------|
| 5.3a | It checks ownership of the stop's request first (flow instance, user, tenant, organization), then loads the stop. A request that is not the caller's, no such stop, a stop that is not a user's (a task or custom gate), and a wait gate all answer `404 Suspension "<id>" not found`. The body has the same words for each. The missing-field `400`s come before this check (`suspensionId`, `action`). | `anr:59-61`, `:76-111` |
| 5.3b | It is open to every request source that resume refuses (task runs included) but takes only user stops (`user_approval`, `user_input`). | `anr:19-21`, `:110` |
| 5.3c | A stop already resolved is `409 { error: 'Suspension "<id>" has already been resolved (status: "<status>")', refused: "already-resolved" }`. This is also what the loser of an answer-versus-cancel-versus-deadline race is told. A stop whose request finished and whose record was cleaned up, but which the request's log names, answers the same. | `anr:63-67`, `:108-111`, `:181` |
| 5.3d | A stop past its deadline is `410 Suspension "<id>" expired at <ms>`. | `anr:114-117`, `:177-180` |
| 5.3e | `400` messages: `Answer failed validation against the suspension's resumeSchema` with `validationErrors`; `No DurabilityProvider configured. Answering requires durable execution.` | `anr:102`, `:127-131` |
| 5.3f | When another resume holds the request, the answer waits up to 2 seconds (50 ms polls) for it to resolve, then answers `409 { error: "Another resume of this request is in progress. Try again shortly.", refused: "busy" }`. Each try re-reads the stop under the lease, so when the other call settles it within the wait, this one is told `409 already-resolved` (5.3c), and a deadline that passed during the wait is `410`. So of two answers sent at once, one is `202` (or the stream) and the other `409 already-resolved`, or `409 busy` if the first still holds the request after 2 seconds. | `anr:56-57`, `:138-187` |
| 5.3j | After the `410` deadline check, an `action` outside the stop's allowed set is `409 Action "<a>" not permitted for this suspension (allowed: ...)`, and a `submit` (or an `approve` with `data`) failing the stored schema is `400` with `validationErrors`. A stop that is no longer pending answers `409 already-resolved` before the deadline is checked. | `anr:108-127` |
| 5.3g | Who answered is the signed-in caller's user id, or the request owner's id on an app with no sign-in. `resumedBy`, `resumeContext` and similar fields in the body are ignored. | `rr:218-219`; `anr:134-135`; `packages/engine/test/resume-metadata-ingress.test.ts` [test] |
| 5.3h | Both routes run the continuation as the request's owner (the identity stored on the request), not as the caller. | `reference/durable-execution.facts.md:6.4` (sibling sheet); `packages/engine/src/execution/request-continuation.ts:200-215` |
| 5.3i | Without `Accept: text/event-stream` the continuation's live stream is closed; read the request through `GET .../stream` or `.../status`. | `rr:262-267`; `anr:166-169` |

Where these routes are called from (the table of answering surfaces the sibling page links here for):

| Surface | What it calls | Source |
|---|---|---|
| `client.flow(<id>).request(<id>).resume(body)` and `.answer(body)` | `POST .../resume` and `.../answer`; resolve to a request handle, or with `{ stream: true }` to the SSE `Response`. Failures reject with `ClientHttpError` (`status` 404, 409, 410 or 400). | `cl:` `resume` (`cl:` `requestHandle`); `reference/durable-execution.facts.md` row for `client.flow(addr).request(id)` (sibling sheet: `cli/client.ts` cited there is now `packages/client/src/client.ts`) |
| React `session.answerSuspension` and `useSuspensions` | the same routes, streaming the continuation into `session.items` | `packages/react/src/context/SuspensionResolver.ts`; `.../hooks/useSuspensions.ts` |
| DevTool Suspensions tab | a user's stop through `answer`; a custom reason through `resume` | `reference/durable-execution.facts.md` (sibling sheet) |

### 5.4 Other `409`s and refusals by route

| Route | Status and body | Source |
|---|---|---|
| Action | `409 request-id-in-use`; `409 wrong-instance-session`; `409 wrong-instance-request`; `409 migration-required`; a concurrency `reject` refusal answers `409` (see `concurrency-refusal.ts`) | `ar:288-310`; `concurrency-refusal.ts`; `hat:302` [test] |
| Create session | `409 Session "<id>" already exists` | `ssr:508` |
| PATCH metadata | `409` kept changing | `ssr:610` |
| Abort | `409 Request "<id>" is already in terminal state "<status>"`; `409` when a resume reached it first (`was resumed before the stop reached it; stop it again to stop the running turn`) | `abr:153-164`; `abt:588`, `:289` [test] |
| Retry | `409 Request "<id>" is still in progress`; `409 Request "<id>" has status "<s>" and cannot be retried`; `400 Flow mismatch` | `rec:85-107` |
| Continue | `409` for any status but `interrupted`; `409` a dynamic scheduled dispatch cannot be continued; `409 Concurrent continuation in progress. Try again later.`; `400 Flow mismatch`; `400 Session mismatch: request "<id>" does not belong to session "<id>"` | `rec:205-262` |
| Any session-addressed read or write on a record stored with no `orgId`, or that no one flow instance owns | `409 { error: "migration-required", message }` for an authenticated caller; the ordinary `401` for an anonymous one. The record is preserved unchanged and refused at every route that addresses it. No exported operator command attributes such a record (the error message names only "the upgrade recipe in the persistence guide"), so the page names none. | `ru:735-767`; `rau:298-310`, `:350`; `packages/engine/src/context/org-attribution.ts:41-56` |

Terms the page no longer uses, kept for the owners of the pages that took the rows: a **wait gate** is a stop where a turn waits for a task to end; its answer is that task's ending, so the resume and answer routes treat it as a missing suspension (`rr:156-165`). The **default write flow** is the flow the server runs a resource's writes through; the **write-session prefix** is the literal `fsd-write.` (`default-write-flow.ts:65-69`; an id that starts with it, or has a `:`-separated part that does, is reserved). `createVercelHandler` is a real export of `@flow-state-dev/vercel` (a router or a function returning one); `createVercelNextHandler` wraps it (`packages/vercel/src/next.ts`).

## Moved to other Reference pages (pass 8, round 1)

These rows left `http-api.md`; the facts above stay true and feed the named page. The page keeps a link.

| Moved | To |
|---|---|
| Resume checks table, who a resume or answer is recorded as, the answering surfaces table, request statuses (5.3, 4.12) | R-17 `./durable-execution.md` |
| (Returned, revise round) The answer route's outcomes: accepted, busy, already-resolved, expired, not found, and the `400`/`409` body checks (5.3a, 5.3c to 5.3f) | Back on this page, section "Answering a stop" |
| Session resource routes: permissions, collections, refusals, write order, topic `content` (2.4a to 2.4f); sessionless resource reads and the `runBy` refusals (2.5, first table) | R-08 `./resources.md` |
| View refusals, `changed`, caller resolution (2.5a to 2.5d) | R-09 `./views.md` |
| Debug origin rules in full, 404 bodies, secret fields (2.7b to 2.7d). The page keeps one sentence: the origin `403` and the anonymous-local env override (2.7b). | R-35 `./cli.md` and `./environment.md` (the switch) |
| Connector keys: owner, storage key, what the route returns (section 8, 2.8) | R-34 `./mcp-server.md` |
| Webhook ack statuses; schedule dispatch bodies and the schedule listing (2.8) | R-32 `./webhooks.md`, R-33 `./schedules.md` |
| Frame format, resume cursor, slow reader, 30 second silence, session stream (section 6.1 to 6.3) | R-06 `./items.md` |
| What outlives a closed connection (4.11, 7.11) | R-19 `./background-work.md` |
| Proxy settings (6.4) | R-12 `./runtime.md` |
| Hosts, Next.js mounting, shutdown, in-process fetch, adapter route precedence (section 7) | R-12 `./runtime.md` |
| Unauthenticated-flow refusal, loopback Host check (5.2); caller and tenant resolution rows (1.9, 1.10) | R-20 `./authentication.md` |

## 6. Streams

### 6.1 Frame format on the request stream

| # | Fact | Source |
|---|------|--------|
| 6.1a | One frame per event: `id: <requestId>:<sequence_number>`, `event: <type>`, `data: <the whole event as one JSON line>`, then a blank line. `data` is the full event object, not only the item: it carries `stream: "request"`, `requestId`, `sequence_number`, `ts`, `type` and the type's own fields. | `enc:16-62`; `sse:27-54`; `sbb:54-85` [test] |
| 6.1b | A multi-line `data` is split across `data:` lines (`serializeSSEFrame`); JSON from the framework is one line. | `sse:27-54` |
| 6.1c | `sequence_number` starts at 1 (`request.created`) and rises by one per event within a request. | `ev:7-12`; `packages/engine/src/streaming/response-emitter.ts` (`sequenceNumber`) cited in `reference/items.facts.md:7.5` |
| 6.1d | Event names use dots on the wire (`item.added`, `item.done`, `item.updated`, `content.added`, `content.delta`, `content.done`, `content.audio.delta`, `resource.changed`, `session.metadata.changed`, `request.created`, `request.<status>`). The NDJSON that `fsdev run` prints uses underscores (`item_added`, `content_delta`) and has its own line shapes. | `ev:16-134`; `packages/fsdev/src/commands/run.ts:58-61`, `:702`, `:728` |
| 6.1e | A terminal event ends a stream: `request.completed`, `request.failed`, `request.aborted`, `request.incomplete`, `request.suspended`, and `request.interrupted` when its `status` is `interrupted`. After `request.suspended`, a resume reopens the same request under the same id; its sequence numbers continue. | `packages/engine/src/stores/subscribe-helpers.ts:25-60`; `rst:11-18` |
| 6.1f | `ping` and `debug` events are never written to the wire. The heartbeat is the SSE comment `: ping`, with no id. | `sr:83-90`; `ssm:` `PING_FRAME`; `ev:122-134` |
| 6.1g | Items marked not client-visible, and their content events, are left out of the stream unless the request asks `?include=trace`. | `cf:1-80`; `sr:106`, `:178`, `:247` |

### 6.2 Following and resuming a request stream

| # | Fact | Source |
|---|------|--------|
| 6.2a | `GET /:flowId/requests/:requestId/stream` is `text/event-stream; charset=utf-8` with `cache-control: no-cache` and `connection: keep-alive`. | `ru:39-43` |
| 6.2b | An in-flight request is followed live: events from the cursor, then new ones, until a terminal event. A terminal request is answered in one response with the saved events past the cursor. A log that has no terminal event ends with one made from the record's status. | `sr:152-216`, `:258-319`; `request-end-stream-contract.test.ts` [test] |
| 6.2c | The cursor is `starting_after=<n>` (the last `sequence_number` applied) or `Last-Event-ID: <requestId>:<n>`. If both are sent, `starting_after` wins. A `Last-Event-ID` that is a bare number, or names another request, is ignored and the stream starts at the first event. A `starting_after` that is not a non-negative integer is ignored. | `res:27-107`; `src:73-102` [test]; `stream-resume.test.ts:619-660` [test] |
| 6.2d | A cursor at or past the last event returns an empty body (nothing is rebuilt). With no cursor, replay starts at event 1. | `src:125-146` [test] |
| 6.2e | Replay never includes `content.delta` or `content.audio.delta`; the finished item (`item.done`) carries the whole text. | `res:147-153`; `stream-resume.test.ts:420-448` [test] |
| 6.2f | A request that was queued for an external worker and has not started yet streams (waits at the start of the log) instead of answering `404`. A request id that was never used still answers `404`. | `sr:113-129`; `sed:82`, `:167` [test: "streams before the worker starts instead of 404ing", "a genuinely unknown requestId still 404s"] |
| 6.2g | A reader that falls more than 4 MiB behind is cut off after what was already written, with no terminal event; resuming from the last id received delivers every remaining event once. | `ssm:` `DEFAULT_MAX_BUFFERED_SSE_BYTES`; `sbb:99-128` [test] |
| 6.2h | A live tail with no new event for 30 seconds (default 30,000 ms; `LIVE_TAIL_LIVENESS_MS` overrides) ends with a synthesized `request.interrupted` on SQLite, filesystem and Postgres, including Postgres with a live-tail pool (the LISTEN path). Only the in-memory store ignores it. | `live-tail-liveness.ts:8-18`; `packages/store-postgres/src/request-store.ts:787,878-880`; `packages/engine/src/stores/memory/request-store.ts:299-300` |
| 6.2i | Heartbeat cadence: 15,000 ms by default; `defaultSseHeartbeatMs` on the host, `request.sseHeartbeatMs` on a flow (wins), `0` turns it off. | `fr:` `defaultSseHeartbeatMs` doc; `sr:108-111` |
| 6.2j | Stopping a stream's connection does not stop the request (4.11). | `sr:328-375` |

### 6.3 The session stream

| # | Fact | Source |
|---|------|--------|
| 6.3a | `GET /sessions/:sessionId/stream` follows a whole session: every finished item any request in it keeps, and a notice of the session's unfinished runs. It has no sequence numbers. Events: `session.item` (`requestId`, `item`), `session.runs` (`runs`), `ping`; each carries `stream: "session"`, `sessionId`, and `at`. | `ev:154-211`; `sst:1-60` |
| 6.3b | Query: `since` (a server time from an earlier `at`, or the snapshot's `at`; default the last minute), `session_created_at` (the snapshot's `sessionCreatedAt`; a mismatch is `404 Unknown session`), `item_types` (comma list, the snapshot's filter). | `sst:186-243` |
| 6.3c | The server closes the connection after 15 minutes at most and sends a `ping` after 15 seconds of silence. A client reconnects with the last `at` as `since`. | `sst:115`, `:121`, `:348`, `:372` |
| 6.3d | It sends what a snapshot read would show: the same owner check, `409 migration-required` for an unattributed session. | `sst:186-240` |

### 6.4 Behind a reverse proxy

| # | Fact | Source |
|---|------|--------|
| 6.4a | The framework sets `cache-control: no-cache, no-transform` and `x-accel-buffering: no` on the live stream a `POST` returns (action, resume, answer, continue). The plain `GET` streams carry `cache-control: no-cache` and `connection: keep-alive` and no `x-accel-buffering`. The Vercel adapter adds `no-cache, no-transform` and `x-accel-buffering: no` to every SSE response it wraps. | `ar:332-345`; `rr:250-259`; `ru:39-43`; `vch:23-27`, `:72-83` |
| 6.4b | A proxy in front of `/api/flows/` must not buffer or cache responses and must keep idle connections open longer than the longest run. nginx directives the Docker guide uses: `proxy_buffering off` (no response buffering), `proxy_cache off` (no caching of the stream), `proxy_read_timeout 86400s` and `proxy_send_timeout 86400s` (idle limits), `proxy_http_version 1.1`. Caddy: `reverse_proxy` with `flush_interval -1`. The heartbeat (15 seconds by default) keeps a connection from looking idle. | `ddock:285-370` [doc, the guide's own config; the framework does not read these] |
| 6.4c | Symptom: a stream that arrives all at once at the end means something in the path (a proxy, a CDN, a load balancer) is buffering. | `ddock:` "SSE stream buffers behind nginx" [doc] |
| 6.4d | The guide has nginx `add_header X-Accel-Buffering no;` in the location. That header added by nginx on its own response does nothing for nginx's own buffering; the framework sets it on the upstream response, and nginx honours it from there on the POST streams only. Do not carry the guide's explanation ("tells downstream proxies"). `proxy_buffering off` is what covers the GET streams. | `ar:339-340`; `ru:39-43` [source]; flagged for the page: state only the directives |

## 7. Hosts: what mounts these routes

| # | Fact | Source |
|---|------|--------|
| 7.1 | `createFlowState(...)` returns a handle; `await flowstate.getRouter()` returns `{ GET, POST, PATCH, DELETE }`, each `(Request, { params: { path: string[] } }) => Promise<Response>`. `path` is the segments after the mount, already decoded once. A host with only the raw URL decodes it with `decodePathSegments(rawPath)`. | `fr:330-337`; `dapi:` `parseFlowRoute`, `decodePathSegments` [doc] |
| 7.2 | A host serves an event stream by passing the router's `Response` body through unbuffered. When the client goes away the stream ends silently. | `app:` header comment; `sr:328-375` |
| 7.3 | Next.js: `createNextHandler(flowstate)` from `@flow-state-dev/next` takes the object `createFlowState` returns, not `getRouter()`, and returns `{ GET, POST, PATCH, DELETE }`. It needs Next.js 15 (async `params`). It resolves the router on the first request. The route file in the repo's example exports `dynamic = "force-dynamic"`, with the comment that without it Next.js may buffer the response and the stream does not arrive token by token. | `nxt:1-60`; `examples/hello-chat/app/api/flows/[[...path]]/route.ts:1-9` |
| 7.4 | Next.js catch-all naming: a required catch-all `[...path]` needs at least one segment, so `GET /api/flows` is a `404` from Next. Two ways to serve it: name the folder `[[...path]]` (optional catch-all, as the hello-chat example does), or add a sibling `app/api/flows/route.ts` that exports `GET` and `POST` from `createVercelBareHandler(...)` (the kitchen-sink app does). | `packages/vercel/src/handler.ts:143-176`; `apps/kitchen-sink/app/api/flows/route.ts:1-6`, `apps/kitchen-sink/app/api/flows/[...path]/route.ts`; `examples/hello-chat/app/api/flows/[[...path]]/route.ts` |
| 7.5 | The route file must export all four verbs. A verb it does not export is not served by that file. The bare-path sibling exports only `GET` and `POST`. | `nxt:` return type; `vch:` `createVercelBareHandler` return type |
| 7.6 | On Vercel: `createVercelNextHandler(flowstate)` from `@flow-state-dev/vercel/next`, with `runtime`, `maxDuration` and `dynamic` exports as literals. | `apps/kitchen-sink/app/api/flows/[...path]/route.ts:1-9`; `dsetup:` "Adapters" [doc] |
| 7.7 | Node: `serve(flowstate, options)` from `@flow-state-dev/node`: port `options.port`, else `$PORT`, else `3000`; host `0.0.0.0`; mount `/api/flows`; health `/healthz`; push on by default. It also serves a static directory with an `index.html` fallback when `staticDir` is set. `fsdev serve` and `fsdev dev` use it. | `srv:91-150`, `:184-195`; `app:34-44` |
| 7.8 | Node shutdown: on `SIGTERM` and `SIGINT` (unless `handleSignals: false`) it stops accepting connections, waits for in-flight requests for up to `shutdownGraceMs` (default 10,000 ms), then force-closes connections, then disposes the router and the `FlowState` (stores). | `srv:` `doClose`, `onSignal`; `DEFAULT_SHUTDOWN_GRACE_MS` |
| 7.9 | Node serves nothing outside the mount and `/healthz` except what you configure: a path outside `basePath` is `404 { error: "Not found" }`, except transport-adapter routes that register outside it (MCP with `dedicatedBasePath`). The flow API is not reachable outside `basePath`. | `app:188-208`; `nt/app.test.ts:136`, `:155`, `:195`, `:239` [test] |
| 7.10 | Lambda: `createLambdaHandler(flowstate, options)` from `@flow-state-dev/node/aws-lambda` wraps the same app, so it serves the same `/api/flows` routes and `/healthz` with the same bodies and statuses. Function URL with `invokeMode: RESPONSE_STREAM` so SSE streams. | `lam:1-59`; `dhost:` [doc] |
| 7.11 | On a request-scoped host (a Lambda invocation, a serverless function) a client that disconnects mid-stream does not cancel the run: it continues until it finishes or the host's timeout kills it. (4.11) | `ar:166-172` [source]; recipe advice on timeouts stays in the recipe |
| 7.12 | The framework has no `/health` route. The only framework health route is `/healthz` on the Node host (and Lambda handler). Next.js and Vercel handlers serve none. | `app:129-138`; absence in `nxt` and `vch` [source] |
| 7.13 | CORS: no engine, Node, Next or Vercel code sets any `Access-Control-*` header, and no `OPTIONS` handler exists (an `OPTIONS` through the Node host or in-process fetch is `405`). A page on another origin must be fronted by something that adds CORS and answers the preflight. A non-empty JSON-less cross-site write is also refused by 1.5 and 1.6, so the JSON content type makes a browser send a preflight. | grep of `packages/{engine,node,next,vercel}/src` finds none; `ru:` `JsonMediaTypeError` doc; 1.1 |
| 7.14 | A custom host writes its own adapter over the router, not over the engine internals: `router[method](req, { params: { path } })`. A custom transport adapter's routes (`adapters` option) are matched before the canonical ones, collisions among them throw `TransportRouteCollisionError` at construction. | `fr:360-460`, `:668-690`, `:` `validateRouteUniqueness` |
| 7.15 | In-process: `createInProcessFetch(flowstate)` is a `fetch` that reaches the same router with no server; hand it to a client's `fetcher`. A path outside the base path is `404 { error: "Not found" }`; a router that failed to initialize is `500 { error: "Server failed to initialize" }`. | `ipf:63-143` |
| 7.16 | The client appends `/api/flows` to `baseUrl` itself. `baseUrl` is the origin (or `""` for the page's own origin); `apiPath` replaces `/api/flows` when the server mounts elsewhere. `baseUrl` must not include `/api/flows`. | `cl:55-72`; `clh:` `buildFlowApiUrl` |

## 8. What stores data here

The HTTP API stores nothing of its own; the routes read and write records owned by other pages (sessions, requests, suspensions, resources, blobs). The one stored part this page names that is not owned elsewhere is a connector key.

| Question | Answer for a connector key (`/api/flows/mcp-credentials/<server>`) | Source |
|---|---|---|
| Who owns it | The user whose sign-in verified the request. The caller is never a field of the body or path. | `packages/workforce/src/projects/mcp-credentials.ts:1-60` |
| Who can see it | Only the user's own `setAt` time, through the route and a browser read of the collection. The value is never sent back, is kept out of the engine's debug reads, and is not readable by resource tools. The one reader of the value is the server's MCP connection step. | same |
| Where it is stored | The host's store, in the user scope, under the key `mcp-credentials/<server>`, as written (not encrypted): anyone who can read the store can read it. | same |
| How many | One per user per MCP server name. | same |

## 9. Rows moved here from other pages: kept and dropped

Each row from `grep -rhE --include=*.record.md -e '→ R-13( \(corrected by pass 5\))?$'` is listed in the order printed. "Kept" names the fact above that carries it.

| # | Row (from) | Verdict | Where / why |
|---|---|---|---|
| 1 | The keys route: when the host does not serve it Settings lists no servers (shift-manager) | **Kept, narrowed** | 2.8 (connector keys). The route is a transport adapter route on the router's `/api/flows` mount, so any host that mounts the router with it serves it; the Lab's client reads `404` as "no servers offered". The page cannot say "which hosts do" in a list; it says the route is served when the host's router has the adapter. The shift-manager page's sentence "the HTTP API reference says which hosts do" needs rewording (flag for the cutover). |
| 2 | Next.js route requirements: `dynamic = "force-dynamic"` is needed or Next.js buffers (add-to-an-existing-app) | **Kept, narrowed** | 7.3. The evidence is the example's comment, "may buffer"; "is needed" is stronger than anything in the code. State it as the example does. |
| 3 | Verbs the route must serve: `GET`, `POST`, `PATCH`, `DELETE` (add-to-an-existing-app) | **Kept** | 1.1, 7.5. |
| 4 | Mount path: the catch-all folder must be `[[...path]]` so the bare `/api/flows` is served (add-to-an-existing-app) | **Kept, corrected** | 7.4. `[[...path]]` is one of two ways; the other is a sibling bare route (`createVercelBareHandler`). The "must" is wrong; the folder must be an optional catch-all OR have a sibling. |
| 5 | A session id owned by another user returns `404 Unknown session`, identical to an unknown id (flows-and-actions) | **Kept** | 5.1 "Session id owned by another user". Test: `it:120-168`. |
| 6 | With no `sessionId` the request runs in a new session and the response does not carry the id (flows-and-actions) | **Kept** | 4.10. |
| 7 | `POST /api/flows/<kind>/actions/<action>`; `Accept: text/event-stream` gives the stream, otherwise `202` with the request id (serving-flows, corrected by pass 5) | **Kept** | 4.8, 4.9. |
| 8 | Endpoint rows: the flow API mount path and what a hosted server mounts besides it (cli) | **Kept** | The mount path in the conventions paragraph; "besides" in 2.8 (webhooks, schedules, MCP, connector keys, `/healthz`, the push socket in 2.6). |
| 9 | Resume and answer endpoints, base path, and the table of answering surfaces (durable-execution) | **Kept** | 2.3, 5.3 and the surfaces table. The DevTool tab row is cited to the sibling sheet, not re-verified here. |
| 10 | Resume route status codes, check order and messages (durable-execution) | **Kept, re-verified** | 5.3, re-read against `resume-routes.ts` and the tests. Two corrections to the old sheet's wording are in 5.3 order 3 versus 4 (the missing-durability `400` comes before the field `400`s) and order 12. |
| 11 | Resume validation row: submit with no data against a schema is 400; a bare approve passes when fields are optional (durable-execution) | **Kept** | 5.3 order 10. |
| 12 | Answer route differences: 404 text, 409 already-resolved, 410, 400 validationErrors (durable-execution) | **Kept** | 5.3a to 5.3f. |
| 13 | Frame format: `id` composition, `data` holds the whole event, dotted names vs underscored names in NDJSON (items) | **Kept** | 6.1a, 6.1d. |
| 14 | `check-interrupted` and `interrupted-requests` routes and their answer shape (items) | **Kept** | 2.3, 2.3a to 2.3c. |
| 15 | Routes the adapter serves: the catch-all handler vs the bare `/api/flows` listing endpoint, and which export covers each (vercel) | **Kept** | 7.4, 7.5. |
| 16 | CORS: the HTTP API sets no CORS headers; the caller adds them (vercel) | **Kept** | 7.13. Verified by a negative search of four packages, not by a test; state it as "sets no CORS headers". |
| 17 | Router contract: one handler per HTTP method, called with a Web Request and `{ params: { path: segments } }`, returning a Web Response; segments decoded once; a method with no handler is not served (railway) | **Kept** | 7.1, 1.4, 1.1. |
| 18 | Lambda endpoint table note: same endpoints as `serve()`, so the table applies unchanged (aws-lambda) | **Kept** | 7.10. |
| 19 | Request lifecycle row: client disconnect mid-stream on a request-scoped host: the run continues until it finishes or the host's timeout (aws-lambda) | **Kept** | 4.11, 7.11. |
| 20 | Streaming behind a reverse proxy: SSE must not be buffered or cached; idle timeouts outlast a long stream; nginx directives, `X-Accel-Buffering`, Caddy `flush_interval` (docker) | **Kept, with one part dropped** | 6.4a to 6.4c. **Dropped:** the guide's claim that `add_header X-Accel-Buffering no` "tells any upstream proxy not to buffer" (6.4d); `X-Accel-Buffering` is a response header the origin sets, the framework sets it itself on the POST streams, and nginx's own `add_header` is not what makes nginx stop buffering. The page lists only the directives and what the framework sets. |
| 21 | Same rows: four-row directive table (directive, what it does, value) (docker) | **Kept** | 6.4b gives `proxy_buffering off`, `proxy_cache off`, `proxy_read_timeout 86400s`, `proxy_send_timeout 86400s`. The values come from the guide, not the framework. |
| 22 | Caddy `flush_interval -1` (docker) | **Kept** | 6.4b. The guide itself says Caddy's default already handles most SSE cases, so state it as an explicit setting, not a requirement. |
| 23 | Symptom row: a stream that arrives all at once means a proxy or CDN is buffering (docker) | **Kept** | 6.4c. |
| 24 | HTTP API: the framework exposes no health route (the `/health` route is the app's own handler); `SIGTERM` handling on the host adapter (docker) | **Kept, corrected** | The row is wrong as written: the Node host exposes `/healthz` (2.8, 7.7, `app:129-138`, `nt/app.test.ts:77,382,411`). The old Docker guide's `/health` is the app's own handler. `SIGTERM`: 7.8. The framework has no `/health` (7.12). The Next.js and Vercel handlers serve no health route. |
| 25 | Router contract: `router[method](Request, { params: { path } })`, decoded segments, `text/event-stream` with a streaming body the host must flush and forward unbuffered, a stream ends silently on client disconnect; better replaced by the node host adapter and a link (docker) | **Kept in part** | 7.1, 7.2. "Host must flush" is dropped: no framework code or exported surface states it (the sibling sheet `items.facts.md` row 25 drops it for the same reason), and the framework's own hosts do not hand-flush. |
| 26 | `GET /api/flows` lists registered flows and is the first call a client makes; the route must be an optional catch-all (`[[...path]]`); a required catch-all returns 404 for the bare path (your-first-flow) | **Kept, corrected** | 2.1 and 7.4. "Is the first call a client makes" is dropped (no code says it: `client.flows()` is one method among many and a client can send without it). "Must be `[[...path]]`" is corrected as in row 4. |
| 27 | `GET /requests/:id/stream` for a queued, not-yet-claimed request: record exists, waits at sequence 0; unknown id returns 404 (background-jobs-bullmq) | **Kept, narrowed** | 6.2f. The tests pin "streams before the worker starts" and "a genuinely unknown requestId still 404s". "Waits at sequence 0" is code-read (`sr:176` `fromSequence = cursor.sequenceNumber ?? 0`) and not named by a test; the page says it streams without answering `404`. |

## 10. Contradictions found

| # | Existing doc says | Code says | Page states |
|---|---|---|---|
| C1 | `dca` (resource HTTP endpoints): "Requests for resources without `client` config return 404." | A resource the flow declares without the matching `client` permission answers `403` (`Content read not permitted for "<ref>"`, etc.). `404 Unknown resource "<ref>"` is for a `ref` the flow does not declare. `rsc:159-171`; `rsT:294`, `:307`, `:445` [test]. | The code's answer, 2.4a. |
| C2 | `dca`: the resource item routes are written as `/:ref/:topic/content` with "`:topic` is a multi-segment wildcard" and "the client encodes slashes as `%2F`". | The route table uses a `*topic` wildcard (`rt:` `get_collection_item_content`, `get_collection_item_state`); the client sends `%2F` (`clh:topicPath`) and the engine decodes each segment once. Both hold: the router accepts either a raw `/` or `%2F` in the topic. | State the wildcard and the `%2F` encoding. |
| C3 | `dsetup` endpoints table: lists `GET /api/flows/:flowId/requests/:requestId/stream` and others but omits `/status`, `/abort`, `/resume`, `/answer`, `/retry`, `/continue`, `/active-requests`, `/users/:id/check-interrupted`, `/identity`, `/resources/...`, views, blobs, transcribe, `/manifest`, `/requests`. | `rt:` route table has all of these. | The page lists every route in `rt`. |
| C4 | `dsetup` "Request Lifecycle" lists 7 steps (validate, resolve session, create scope, `202`, execute, stream, persist). | The `202` arrives after admission, and with `Accept: text/event-stream` there is no `202` (4.8). The step list is not an observable contract beyond what section 4 says. | Section 4's rows, no numbered internals. |
| C5 | `dsetup`: `GET /api/flows/capabilities` returns `{ userStream, push }`, `push` "`{ transport: "websocket" }` under `serve()`, else `null`". | Agrees (`userStream` is `false` always). | As stated, plus `userStream: false`. |
| C6 | `dsetup` `PATCH` table row: `PATCH /api/flows/sessions/:sessionId/metadata` "Update title, description, tags, metadata". | Agrees; `metadata` merges, the other fields replace (`ssr:588-596`). | With the merge note. |
| C7 | `ddock` checklist: "Health check endpoint: `/health` returns 200". | The Node host's health route is `/healthz` (`app:129`). The Docker recipe page (`docker.md:58`) already says `/healthz`. | `/healthz`. |
| C8 | `ddock` nginx section: "`X-Accel-Buffering no` — tells any upstream proxy not to buffer either". | See 6.4d. | Only directives. |
| C9 | `dcr` (abort): "returns `404` when no request exists under that id". | Agrees, and also `404` for another user's or tenant's request; it also does not read `:flowId`. | 2.3g, 2.3h. |
| C10 | The Next adapter doc comment: `createNextHandler(flowstate, ...)` "takes `flowstate`". Row 2 of the `add-to-an-existing-app` record says the input is the object `createFlowState` returns, not `getRouter()`. | `createNextHandler(flowstate: FlowState, ...)` calls `flowstate.getRouter()` itself (`nxt:` `getRouter`). `createVercelHandler` is the one that takes a router or a function returning one. | 7.3. |

## 11. Left out on purpose

- The page lists no `PUT`, `HEAD` or `OPTIONS` routes: none exist (1.1).
- The WebSocket frame protocol after the upgrade (ticket, topic frames, notice frames) is not in the sheet: the frames are carried in `packages/node/src/serve.ts` and the engine's `push/socket-session`, and are read by the client's push hub. Not read here beyond the mint and the `426`; if the page needs the frame table it comes from R-?? (live updates).
- Webhook, schedule and MCP request and response shapes beyond one line each (2.8): their pages own them.
- The `ENTRY_LIST` and `STATE_LIST` pagination internals beyond default and maximum.
- `GET /api/flows/:flowId/...` instance pins' construction (`ownerPin`): that belongs to the workforce pages.
- Anything that says why a rule is shaped as it is (comments in the handlers explaining oracles, races or history). The page states the behaviour only.

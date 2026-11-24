---
title: HTTP API
type: reference
description: "Every endpoint a Flow State server answers, what a request does between arriving and finishing, how to reach one copy of a flow, and the status codes its routes answer."
---

# HTTP API

A Flow State server answers a small, fixed set of HTTP routes under one prefix. A browser, a script or another service uses them to start an action, follow its result as it is produced, read what a session holds, and answer a run that has stopped to ask. The React hooks and the client library call these routes for you; this page is for calling them directly, from another language, a proxy or a test.

The routes work on a few kinds of thing. A flow is the backend unit your app registers. A session is the record a flow keeps its requests in. A request is one run of one action. Every route names the flow, the session or the request it works on, so any host that can forward `GET`, `POST`, `PATCH` and `DELETE` to the router can serve all of them.

The prefix is `/api/flows`, and every path below is relative to it unless it starts with `/api/flows`. A Node host's `basePath` option moves it, and the client's `apiPath` option follows. The examples on this page use one app: a flow with the id `research` and an action `start`.

```bash title="start research from a shell"
curl -N -X POST http://localhost:3000/api/flows/research/actions/start \
  -H 'content-type: application/json' \
  -H 'accept: text/event-stream' \
  -d '{"userId":"user_1","input":{"topic":"battery chemistry"}}'
```

## Rules that hold on every route

| Rule | Behavior |
| --- | --- |
| Methods | `GET`, `POST`, `PATCH`, `DELETE`. Nothing answers `PUT`, `HEAD` or `OPTIONS`; through the Node host and in-process fetch they return `405 { "error": "Method not allowed" }`. The MCP endpoint takes only `POST`: `GET` or `DELETE` there is `405`, plain text `Method Not Allowed`, with `Allow: POST`. Method matching ignores case. |
| Unknown path | `404 { "error": "Route not found" }`. So is one of the four methods on a path that does not take it, such as `GET` on an action route. |
| Path segments | Empty segments are dropped. Each segment is decoded once, so `%2F` stays inside its segment (how a collection topic with slashes travels). A segment that is not valid percent-encoding is kept as written. |
| Request body | JSON. An empty body is read as `{}`. A non-empty body needs `content-type: application/json` (parameters and letter case are fine) or the answer is `415`. A body that does not parse as JSON is `500 { "error": "<parser message>" }`. A body that is JSON but not an object is `400 Request body must be a JSON object`. |
| Cross-site writes | A `POST`, `PUT`, `PATCH` or `DELETE` with `Sec-Fetch-Site: cross-site` is `403 { "error": "Cross-site mutation refused" }` before the route runs. `GET` is not checked. Routes a transport adapter mounts (webhooks, MCP, connector keys) are matched first and skip this check. |
| Error body | `{ "error": "<text>" }`. Many routes add `message`, and sometimes `field`, `index` or `limit`, beside a stable code in `error`. The client throws `ClientHttpError` with `status` and the parsed `body` on any non-2xx answer. |
| Unhandled errors | `500 { "error": "<message>" }`. A validation error is `400` and an unsupported media type is `415`. |
| CORS | No `Access-Control-*` header is set and no `OPTIONS` handler exists. A page on another origin needs something in front that adds the headers and answers the preflight. |
| Caller and tenant | The caller comes from the flow's sign-in, or from `userId` in the body or query on an app with none. A tenant comes from the `x-tenant-id` header. See [Authentication and tenancy](./authentication.md). |
| Request id | A send may carry `requestId` so a retry reaches the same request. An id another caller already holds is replaced with a fresh one for this caller. If another caller takes the id while this send is being checked (steps 5 and 6 under [What an action request does](#what-an-action-request-does)), the answer is `409 { "error": "request-id-in-use", "message": "Request \"<id>\" cannot be used by this caller" }`, and sending again runs under a fresh id. |
| Response header | `x-request-id` carries the id a request runs under, on a `202` and on an inline stream. |

## Which endpoint starts an action?

`POST /api/flows/:flowId/actions/:action` starts the action in a new session. `POST /api/flows/:flowId/:sessionId/actions/:action` starts it in the named session and creates the session when the id is unused. Both take the same body: `{ input, userId?, requestId?, metadata?, attachments? }`. A `sessionId` field in the body is read when the path has none.

With `Accept: text/event-stream` the answer is the live stream of the run, `200`. With any other `Accept` it is `202` with `content-type: application/json`:

```json title="202 body"
{
  "status": "in_progress",
  "request": { "id": "req_…", "flowKind": "research", "flowId": "research", "actionName": "start", "status": "in_progress" },
  "session": { "id": "sess_…" }
}
```

Follow the result with `GET /api/flows/:flowId/requests/:requestId/stream`, or poll `.../status`. A `202` means the request is recorded and can be found. If recording or queueing fails, the `POST` fails.

With no `sessionId` in the path or the body the run gets a new session and the response does not say which: the `202` omits `session` and the stream's `x-session-id` header is empty. To keep sends together, create the session first with `POST /api/flows/:flowId/sessions` and pass its id on each send.

## Endpoints

### Flows and capabilities

| Method | Path | Takes | Answers |
| --- | --- | --- | --- |
| `GET` | `/api/flows` | nothing | `200 { flows: [{ id, kind, cardinality, requireUser, actions, actionSchemas }] }`, one row per registered instance. `actionSchemas` maps each action name to a JSON Schema. A pinned instance is listed only to a caller who matches its pin. Needs no sign-in. |
| `GET` | `/api/flows/capabilities` | nothing | `200 { userStream: boolean, push: { transport: "websocket" } \| null }`. `userStream` is always `false`. `push` says whether the change-notice socket is served: `{ transport: "websocket" }` under `serve()`, `null` on Next.js, Vercel, `createServerApp` alone and Lambda. |
| `GET` | `/api/flows/:flowId/identity` | `?userId=` (open apps only) | `200 { userId, orgId }`: who the server acts as under that flow's sign-in. `404 Unknown flow` for an unknown flow or a caller outside the instance's pin. When the flow's sign-in refuses, `{ error: "unauthenticated", message }` with the resolver's status. |

### Actions and sessions

| Method | Path | Takes | Answers |
| --- | --- | --- | --- |
| `POST` | `/api/flows/:flowId/actions/:action` | body above | `202` or the SSE stream. |
| `POST` | `/api/flows/:flowId/:sessionId/actions/:action` | body above | `202` or the SSE stream, in that session. |
| `POST` | `/api/flows/:flowId/sessions` | `{ userId?, sessionId?, title?, description?, tags?, metadata?, state? }` | `201 { session }`. Creates a session without running an action. The id is `sessionId` or a generated `sess_…`. `state` is parsed through the flow's session state schema, so defaults fill in. A flow that binds its sessions (it has a readonly session state field or a session create check) refuses a state the schema rejects with `400`. Any other flow keeps the state as sent and checks it when its actions run. |
| `GET` | `/api/flows/sessions` | query `flowKind`, `flowId`, `userId`, `limit`, `offset`, `include`, `state.<field>=<value>` | `200 { sessions: [...] }`. `include=status` adds `requestStatus` (and `requestWaitsForUser` when a run waits for a user) to each row; `include=dispatch-runs` adds sessions a dispatcher ran work in. Any other `include` token is `400`. A `state.` filter needs `flowId` or `flowKind` and names a readonly state field, otherwise `400`. With a sign-in the list is narrowed to the caller and `userId` cannot widen it. |
| `GET` | `/api/flows/sessions/:sessionId` | nothing | `200 { session }` |
| `PATCH` | `/api/flows/sessions/:sessionId/metadata` | `{ title?, description?, tags?, metadata? }` | `200 { session }`. `metadata` is merged into the stored object; the other fields replace. |
| `DELETE` | `/api/flows/sessions/:sessionId` | nothing | `204`. Removes the session, its resource content and state, and its attachments. |
| `GET` | `/api/flows/sessions/:sessionId/requests` | query `status`, `limit`, `offset`, `include_items`, `include_result_output` | `200 { requests: [...] }`: each request record plus `retryable`. Items are left out unless `include_items` is `true` or `1`. A `result` is a summary with `hasOutput`, and carries `output` only with `include_result_output`. |
| `GET` | `/api/flows/sessions/:sessionId/state` | query `clientData`, `include_items`, `item_types`, `offset`, `limit` | `200 { sessionId, flowKind, at, sessionCreatedAt, clientData: { session?, user?, org? }, resources?, items?, pagination? }`. `items` and `pagination` (`{ offset, limit, total, hasMore, nextOffset }`) appear with `include_items`; `limit` defaults to 100. `clientData` filters by `session.<name>`, `user.<name>`, `org.<name>`; a bare name is session scope. |
| `GET` | `/api/flows/sessions/:sessionId/children` | query `limit` (1 to 100, default 25), `offset` (0 to 10,000, default 0) | `200 { children: [{ id, parentSessionId, createdAt, updatedAt, flowId?, topic?, coordinate?, status? }] }`, oldest first. `status` is `active` (not finished), `completed`, `failed`, `incomplete` or `aborted`. `topic` and `coordinate` name what the child was dispatched for, when it was dispatched. `limit` outside the range is `400 limit must be 1–100`. The ceiling is the host's `maxChildSessionListLimit`. |
| `GET` | `/api/flows/sessions/:sessionId/stream` | query `since`, `session_created_at`, `item_types` | SSE. See [Items and the stream](./items.md). |

A session answer is the session record with `id` set to the id the caller used. `resources` is left out; read them through the resource routes. `state` is cut to the fields the flow exposes or declares readonly. State a flow does not expose is never sent. A create with an id that exists is `409 Session "<id>" already exists`. An id that begins with `fsd-write.`, or has a `:`-separated part that does, is reserved. As `sessionId` in a create or action body it is `400 reserved-session-id`. In a path it is `404 Unknown session "<id>"`, before the route runs.

### Requests

| Method | Path | Takes | Answers |
| --- | --- | --- | --- |
| `GET` | `/api/flows/:flowId/requests/:requestId/stream` | query `include=trace`, `starting_after=<n>`; header `Last-Event-ID` | SSE. See [Items and the stream](./items.md). |
| `GET` | `/api/flows/:flowId/requests/:requestId/status` | query `include_result_output=true\|1` | `200 { id, status, startedAtMs, ageMs, completedAtMs?, lastHeartbeatAt?, sessionId?, result? }`. `result` appears only with the flag. |
| `POST` | `/api/flows/:flowId/requests/:requestId/abort` | nothing | `204` stopped here (a suspended or interrupted request is ended `aborted`), `202` recorded for the process running it, `404`, or `409`. |
| `POST` | `/api/flows/:flowId/requests/:requestId/resume` | `{ suspensionId, action, data? }`; `Accept: text/event-stream` optional | `202 { requestId }` or the continuation's stream. Checks and refusals: [Pause, resume and replay](./durable-execution.md). |
| `POST` | `/api/flows/:flowId/requests/:requestId/answer` | same body | `202 { requestId }` or the continuation's stream. Takes only a user's stops: [Answering a stop](#answering-a-stop). |
| `POST` | `/api/flows/:flowId/sessions/:sessionId/requests/:requestId/retry` | optional `{ inputOverride? }` | `202 { status: "in_progress", request: { id, flowKind, flowId, actionName, status, retryOf }, session? }`. A new request id; the original stays. |
| `POST` | `/api/flows/:flowId/sessions/:sessionId/requests/:requestId/continue` | query `include=trace`; `Accept: text/event-stream` optional | `202 { requestId }` (the same id) or the continuation's stream. |
| `GET` | `/api/flows/active-requests` | nothing | `200 { entries: [{ requestId, flowKind, actionName, sessionId?, startedAt, lastHeartbeatAt, ageMs }] }`: requests in progress that the caller may see. |
| `POST` | `/api/flows/users/:userId/check-interrupted` | query `staleThresholdMs` | `200 { interrupted: [{ requestId, sessionId?, flowKind, flowId, actionName, interruptedAt }] }`: the requests this call marked `interrupted`. |
| `GET` | `/api/flows/users/:userId/interrupted-requests` | nothing | `200 { interrupted: [...] }`, same row shape: every `interrupted` request of that user, whoever marked it. Sweeps nothing. |

Rules for these routes:

- **Statuses.** The statuses a request moves through are in [Pause, resume and replay](./durable-execution.md).
- **`check-interrupted`.** The window is the larger of `staleThresholdMs` and the host's `staleSweepThresholdMs`: a caller can widen it, never tighten it. A value at or below the host's, zero and negatives included, sweeps as if left out. A value that is not a number is `400 staleThresholdMs must be a number` and sweeps nothing. The host's `queuedGraceMs` applies and the caller cannot change it.
- **User routes.** With a sign-in, the `:userId` in the path must be the caller. A `:userId` of only whitespace is `400 userId is required`. An empty one is dropped as an empty segment, so the path is `404 Route not found`. On the listing, `interruptedAt` falls back to the record's last update, and `flowId` falls back to `flowKind` when the record names no instance.
- **Retry** takes only `interrupted` or `failed` requests; any other status is `409`. `retryable` on a session's request row does not look at status. It says only whether the request's source allows retry (next bullet), so a `completed` row from `http` reads `true` and a retry of it is `409`.
- **Sources.** A request's source is the way it arrived. The caller-facing sources are `http`, `mcp`, `scheduled` and any in a host's `publicReentrySources`. Retry, continue and resume answer a request from any other source as an unknown request. `answer` is open to every source.
- **Abort** reads the request by id and does not check `:flowId`.
- **Other users' requests.** A request id another user or tenant owns is answered as an unknown request on every request route, with the same body as an id nobody used.

### Answering a stop

`POST /api/flows/:flowId/requests/:requestId/answer` with `{ suspensionId, action, data? }` answers a run that stopped for a user's approval or input.

| Answer | When |
| --- | --- |
| `202 { requestId }`, or `200` with the continuation's stream under `Accept: text/event-stream` | The stop was waiting and this call answered it. |
| `409 { error: "Another resume of this request is in progress. Try again shortly.", refused: "busy" }` | Another resume or answer held the request. This call waits up to 2 seconds for it first. |
| `409 { error: 'Suspension "<id>" has already been resolved (status: "<status>")', refused: "already-resolved" }` | The stop was settled before this call reached it, including by a call it waited on. |
| `410 { error: 'Suspension "<id>" expired at <ms>' }` | The stop's deadline has passed. Checked before `action` and `data`. |
| `404 { error: 'Suspension "<id>" not found' }` | No such stop, a stop that is not a user's, or a request that is not the caller's. One body for all three. |
| `400`, or `409 Action "<a>" not permitted …` | `suspensionId` or `action` missing or not `approve`, `reject`, `submit` or `skip`; no durable execution; `data` failing the stop's schema (with `validationErrors`). The `409` is an action the stop does not allow. |

When two people answer the same stop at once, one gets `202`. The other waits, then gets `409 already-resolved`, or `409 busy` if the first holds the request for longer than 2 seconds. Resume's checks: [Pause, resume and replay](./durable-execution.md).

### Resources of a session

`:ref` is the resource's name on the flow. `:topic` is a collection entry key and may contain `/`, sent as `%2F` or raw.

| Method | Path | Takes | Answers |
| --- | --- | --- | --- |
| `GET` | `/api/flows/sessions/:sessionId/manifest` | nothing | `200 { flowKind, resources: [{ ref, kind: "collection" \| "single", scope, hasClientData, client: { content?, state? }, pattern?, prefetchWindow? }] }`. `pattern` and `prefetchWindow` appear on collections only. A resource with nothing client-visible is left out. |
| `GET` | `/api/flows/sessions/:sessionId/resources/:ref/content` | nothing | `200 { ref, content }` |
| `GET` | `/api/flows/sessions/:sessionId/resources/:ref/:topic/content` | nothing | `200 { ref, topic, content }`. `content` is `null` for an item with no content row. |
| `POST` | `/api/flows/sessions/:sessionId/resources/:ref` | `{ topic, content? }` | `201 { topic }` |
| `PATCH` | `/api/flows/sessions/:sessionId/resources/:ref/:topic/content` | `{ content }` | `200 { ref, topic }` |
| `DELETE` | `/api/flows/sessions/:sessionId/resources/:ref/:topic` | nothing | `200 { ref, topic }`. Deleting a topic that does not exist also answers `200`. |
| `GET` | `/api/flows/sessions/:sessionId/resources/:ref` | query `limit` (1 to 200, default 50), `cursor`, `topicPrefix` | `200 { items: [{ topic, storageKey, clientData? }], nextCursor? }`. `clientData` is left out when the resource has no `client.data` projection. Needs `client.state.read`. |
| `GET` | `/api/flows/sessions/:sessionId/resources/:ref/:topic` | nothing | `200 { topic, storageKey, clientData }`, `200 null` for an absent item, or `{ topic, storageKey, hint }` when the resource has no `client.data` projection. Needs `client.state.read`. |

Each route checks the resource's `client` permissions. Permissions, refusals, collection writes and write order: [Resources](./resources.md).

### Resources and views with no session

| Method | Path | Takes | Answers |
| --- | --- | --- | --- |
| `GET` | `/api/flows/resources/:scope/:key` | `:scope` is `user` or `org`; `?userId=` (open apps) | `200 { scope, key, value?, version }`. `version` is `0` when nothing is stored. |
| `GET` | `/api/flows/resources/:scope/:key/entries` | query `limit` (1 to 200, default 50), `cursor`, `topicPrefix` | `200 { items: [{ topic, storageKey, value, version }], nextCursor? }`. |
| `GET` | `/api/flows/resources/:scope/:key/entries/:entry` | nothing | `200 { topic, storageKey, value, version }`, or `200 null` for an absent entry or one the caller may not read. |
| `POST` | `/api/flows/resources/:scope/:key/actions/:action` | the action route's body | Runs the action the resource's `runBy` names, as that flow's session for the caller, and answers as the action route does. |
| `POST` | `/api/flows/:flowId/views/:view` | `{ input?, userId?, changed? }` | `200 { output, topics, hears, keys?, partial? }` for a user or org view. Nothing is stored. |
| `POST` | `/api/flows/:flowId/:sessionId/views/:view` | same | The same answer for a session view, on that session. |

Refusals for the resource rows: [Resources](./resources.md). View refusals and the `changed` hint: [Views](./views.md).

### Attachments, voice and push

| Method | Path | Takes | Answers |
| --- | --- | --- | --- |
| `POST` | `/api/flows/blobs` | the file's bytes as the body; `Content-Type` is the file's type; query `userId` (open apps), `filename` | `201 { attachment: { type: "file", mediaType, filename?, data: "fsd-blob:<id>" } }` |
| `POST` | `/api/flows/:flowId/blobs` | same; the flow's own sign-in checks the uploader | Same. `404 Unknown flow` for an unknown flow. |
| `GET` | `/api/flows/blobs/:blobId` | nothing | `200` the file's bytes, with the stored `content-type`, `content-disposition` `inline` for `image/*` and `attachment` otherwise, `x-content-type-options: nosniff` and `cache-control: private, no-cache`. |
| `POST` | `/api/flows/transcribe` | audio bytes with query `userId`, `language`, `model`; or JSON `{ userId, audio: <base64>, mediaType?, language?, model? }` | `200` a transcript. Limit 25 MiB. `501 transcription_not_configured` with no voice provider; `501 provider_does_not_support_transcription`. |
| `POST` | `/api/flows/users/:userId/stream` | `{ topics: [...] }` | `200 { transport: "websocket", ticket, path, topics }`: the topics the caller may hear, and a ticket that lasts 30 seconds. `404 This host serves no push` on a host with no push. `400` for a body that is not `{ topics }`. |
| `GET` | `/api/flows/users/:userId/stream` | a WebSocket upgrade | The change-notice socket, taken by `serve()` before the router sees the request. A plain `GET` that reaches the router is `426 This route takes a WebSocket upgrade`. |

- **Accepted types.** `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `application/pdf`, `text/plain`, `text/markdown`, `text/csv`, `application/json`, `application/yaml`, `text/html`, `application/xml`. Any other type is `415 attachment_type_refused`.
- **Limits.** A file over 20 MiB is `413 attachment_too_large`. A text file over 200 KiB is `413 attachment_text_too_large`. A PDF over 100 pages is `413 pdf_too_many_pages`. A text file that is not UTF-8 is `415 attachment_not_text`, an unreadable PDF is `415 pdf_unreadable`, an empty body is `400 attachment_empty`, and no `userId` on an open app is `400`.
- **Hosts.** A server with no blob store answers `501 attachments_not_configured`. On a host whose disk does not last between requests (Vercel), a blob store that keeps bytes on that disk answers `501 attachments_unavailable`.
- **Sending files.** A message names uploaded files in the action body: `attachments: [{ type: "file", mediaType, data, filename? }]`, at most 10 images and 5 documents. It needs a session id, and the action must write a user message. Refusals: `400` `attachment_invalid`, `attachments_not_accepted`, `attachment_type_refused`, `attachment_limit`; `404 attachment_not_found`; `409 attachment_already_sent` for a file already sent into another session; `501 attachments_not_configured`.
- **One answer for a missing file.** A file that does not exist and a file in a session the caller cannot read both answer `404 { "error": "attachment_not_found" }`. On a send the body also carries the file's `index` and `message: "No such upload of yours."`.
- **Transcription errors.** No `model` in the request and no default on the provider is `400 no_model`. A voice provider's failure is `{ error: <kind>, message }`: `401` auth, `404` not found, `429` rate limit, `499` aborted, `502` network, `503` provider unavailable, and also `400` invalid input, `415` format unsupported, `500` unknown.

### Debug routes

Read-only inspection of a session's resources, for the DevTool. Off by default, answering `403 { "error": "debug_endpoints_disabled" }`; `fsdev dev` turns them on. When on, a request whose `Origin` is neither loopback nor allow-listed is `403 { "error": "debug_endpoints_origin_rejected", "origin" }`, and so is a request with no `Origin` unless `FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL=1`. The switch is in [Environment variables](./environment.md).

| Method | Path | Answers |
| --- | --- | --- |
| `GET` | `/api/flows/sessions/:sessionId/debug/resources` | The resource tree. |
| `GET` | `/api/flows/sessions/:sessionId/debug/suspensions` | `200 { suspensions }`; query `status`, `flowKind`, `userId`, `limit`. |
| `GET` | `/api/flows/sessions/:sessionId/debug/resources/:ref/items` | A collection's items; query `limit`, `cursor`, `topic`. |
| `GET` | `/api/flows/sessions/:sessionId/debug/resources/:ref/content` | The raw content. |
| `GET` | `/api/flows/sessions/:sessionId/debug/resources/:ref/:topic/content` | One item's raw content. |

### Routes a host adds

These sit on the same `/api/flows` mount, or beside it, when the host's router carries the adapter. Each has its own page for the shapes.

| Method | Path | What it is |
| --- | --- | --- |
| `POST` | `/api/flows/:flowId/webhooks/:provider` | A provider's webhook, when the webhook adapter is installed. Statuses and bodies: [Webhooks](./webhooks.md). |
| `POST` | `/api/flows/:flowId/schedules/<scheduleId>/dispatch` | A schedule's fire. Body `{ nominalFireTime? }`. Bodies and statuses: [Schedules](./schedules.md). |
| `GET` | `/api/flows/:flowId/schedules` | The flow's static and dynamic schedules. Shape: [Schedules](./schedules.md). |
| `POST` | `/api/flows/:flowId/mcp`, or `<basePath>/:kind` | The MCP adapter. Mounting and options: [MCP server](./mcp-server.md). |
| `GET`, `POST`, `DELETE` | `/api/flows/mcp-credentials`, `/api/flows/mcp-credentials/<server>` | Connector keys for a Workforce Lab's MCP servers. A key is never returned. Shapes and storage: [MCP server](./mcp-server.md). |
| `GET` | `/healthz` | The Node host's health check, outside `/api/flows` (the path is `healthPath`). `200 { status: "ok" }`; `503 { status: "initializing" }` while stores open; `500 { status: "error", message }` after a failed start. Next.js and Vercel handlers serve none. |

## Reaching one copy of a flow

The segment after `/api/flows` on a flow route is the flow's instance id. For an ordinary flow the id is its `kind`. A flow declared `cardinality: "collection"` registers one instance per id you give it, and each is reached only by its own id. `GET /api/flows` lists one row per instance with `id`, `kind` and `cardinality`.

| Question | Answer |
| --- | --- |
| Is the kind an address for a collection? | No. With only `review-east` and `review-west` registered, `POST /api/flows/review/actions/run` is `404 Unknown flow "review"`. No copy is picked. |
| What if a session is named through the wrong instance? | A session and every request under it record the instance that created them. Naming that session through another instance is `409 { error: "wrong-instance-session", message }`. On the action route, a request through another instance is `409 wrong-instance-request`. A session or request with no single instance that owns it is `409 migration-required`; see [Who owns a record](./stores.md#who-owns-a-record-and-what-keys-it). Nothing is written. |
| What do the request routes say? | `stream`, `status` and `resume` answer `404`, with the body used for an unknown request, when the addressed instance is not the request's owner. `answer` answers `404 { error: 'Suspension "<id>" not found' }`. `retry` and `continue` answer `400 Flow mismatch: request belongs to flow instance "<id>", not "<id>"`. `abort` does not read the path's flow. |
| What is a pinned instance? | An instance can be pinned to an owner. A caller outside the pin gets the `404` an unregistered address gets, and the instance is left out of `GET /api/flows` for that caller. |
| Which routes carry no flow segment? | `/sessions/...`, `/users/...` and `/resources/...`: the session's own record names its instance. |
| A flow registered after start? | `register()` after start is served from the next request in that process. |

## What an action request does

The checks run in this order. Nothing is written for a refusal, and uploaded attachments stay with the uploader, so they can be sent again.

| Step | What happens |
| --- | --- |
| 0 | A send that names no session (no `sessionId` in the path or the body, or an empty one) is `400 { error: "session-required", message }`, before the flow is looked up or the caller resolved. Pass the conversation's id, or `oneOffSessionId()` for a one-shot send. |
| 1 | An unknown flow, or the default write flow addressed directly, is `404 Unknown flow "<id>"`. The default write flow is the flow the server runs a resource's writes through; see [Resources](./resources.md). |
| 2 | A `sessionId` in the body that begins with `fsd-write.`, or has a `:`-separated part that does, is `400 reserved-session-id`. Such an id in the path is refused before step 1, as `404 Unknown session "<id>"`. |
| 3 | The caller is resolved: from the flow's sign-in, else the host's, else (open apps) `body.userId`. A missing `userId` in an open app is `400`. Any other sign-in refusal keeps the resolver's status, normally `401`. |
| 4 | The organization comes only from the resolved caller, never from the body. |
| 5 | Attachments in the body are checked, and refused with the codes under [Sending files](#attachments-voice-and-push): `400 attachment_invalid`, `attachments_not_accepted`, `attachment_type_refused`, `attachment_limit`; `404 attachment_not_found` for a file that is not the caller's upload; `501 attachments_not_configured`. Each file then belongs to this send's session. Sending it again into the same session is accepted. Sending it into another session, even before this send is recorded, is `409 attachment_already_sent`. |
| 6 | Checks before the request is recorded. An org-less caller on a flow that requires an org is `400 OrgRequired`. An active-stream capacity limit is `503`. A concurrency `reject` policy is a refusal. A session bound to another user, org or tenant is `404 Unknown session "<id>"`. A flow that refuses the session it would create answers the refusal's status. A request id in use is `409 request-id-in-use`. A session or request owned by another instance is `409`. Any other dispatch failure is `500 { error: "DispatchFailed", message }`. |
| 7 | The request is recorded, and the answer is sent: the stream, or `202`. |

Stream headers: `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache, no-transform`, `connection: keep-alive`, `x-accel-buffering: no`, `x-request-id`, `x-session-id`.

Closing a stream does not stop the request: see [Background work](./background-work.md).

## Other refusals by route

| Route | Refusal |
| --- | --- |
| Action | `409 request-id-in-use`, `wrong-instance-session`, `wrong-instance-request`, `migration-required`; a concurrency `reject` refusal is `409`. |
| Create session | `409 Session "<id>" already exists`. |
| `PATCH` metadata | `409 Session "<id>" kept changing while its metadata was written; try again`, when other writes keep changing the session while this one is applied. |
| Abort | `409 Request "<id>" is already in terminal state "<status>"`. `409 … was resumed before the stop reached it; stop it again to stop the running turn` when a resume got there first. |
| Retry | `409` while the request is in progress. `409 Request "<id>" has status "<s>" and cannot be retried`. `400 Flow mismatch`. |
| Continue | `409` for any status but `interrupted`. `409` for a dynamic scheduled dispatch. `409 Concurrent continuation in progress. Try again later.` `400 Flow mismatch`. `400 Session mismatch: request "<id>" does not belong to session "<id>"`. |
| Any route that names a session or request stored with no owner organization, or with no single flow instance that owns it | `409 { error: "migration-required", message }` for a signed-in caller; the ordinary `401` for an anonymous one. The record is kept as stored and refused on every route that names it. Owner fields: [Who owns a record](./stores.md#who-owns-a-record-and-what-keys-it). |

## What a wrong session returns

A session id nobody used is `404 { "error": "Unknown session \"<id>\"" }`. On the action and view routes, a session another user owns gets the same status and the same words, byte for byte, in every app. On the read, state, stream, resources, children, delete and patch routes that holds only when something in the app authenticates. In an app with the default resolver and no flow sign-in, those routes check no owner and serve any user's session. Another tenant's session is never served. How the caller is resolved: [Authentication and tenancy](./authentication.md).

Where the answer is `404`, nothing is written, and the body names neither the owner nor the organization. An action posted into another user's session is `404` before the request is acknowledged and before the session changes.

A session of another organization that the same user holds is `404 Unknown session` on the action route. On the other session routes it is `403 { "error": "Caller's organization does not own the requested resource" }`. An open flow in an app where another flow signs callers in also answers that `403` for a session stored under an organization other than the default one. When nothing in the app authenticates, these routes skip the owner and organization checks.

| Probe | Answer |
| --- | --- |
| A request id nobody used, or another user's or tenant's | `404 { error: 'Request "<id>" not found' }` on status, abort, retry, continue, resume. |
| The request stream for the same | `404 { error: 'Unknown request "<id>"' }`. With a resume cursor (`starting_after`, or a `Last-Event-ID` that names this request) it is an empty `200` instead. An unknown flow is named first: `404 Unknown flow "<id>"`. |
| An attachment that is gone, unowned or another's | `404 { error: "attachment_not_found" }`; on a send, with `index` and `message` |
| A debug route | `404 { error: "session_not_found" }` |

## Status codes

Routes a host adds (webhooks, schedules, MCP) answer more codes than these, with bodies their own pages list.

| Success | Where it comes from |
| --- | --- |
| `200` | Reads; resource `PATCH` and `DELETE`; views; the inline stream; a resume or answer with `Accept: text/event-stream`; a webhook skipped by a concurrency `reject` policy or answered as a provider handshake; a schedule fire that was skipped or a duplicate. |
| `201` | Session created, collection item created, attachment uploaded. |
| `202` | Action, resume, answer, retry or continue accepted; abort recorded for another process; webhook or schedule fire accepted; a webhook that matches no binding, answered `{ status: "ignored" }`. |
| `204` | Session deleted; abort stopped the request here, or ended a suspended or interrupted request. |

| Refusal | Where it comes from |
| --- | --- |
| `400` | Missing or invalid `userId`, `topic`, `content`, `action` or `suspensionId`; a body that is not a JSON object; a bad `limit`, `include` token or scope; a resume payload that fails the stored schema; a session or flow mismatch on `continue` and `retry`; a reserved session id in a body; no durable execution on resume and answer; `no_model` or a voice provider's invalid input on transcribe. |
| `401` | The sign-in refused the caller. The resolver's status is passed through, normally `401`. Body `{ error: <message> }`. Also a voice provider's auth failure on transcribe. |
| `403` | A resource permission the flow did not grant; a cross-site write; the debug gate; a user-addressed route (`/users/:userId/...`) whose path user is not the caller (`Caller is not the owner of the requested resource`); a session route where the same user acts under another organization (`Caller's organization does not own the requested resource`). |
| `404` | Unknown route, flow, session, request, resource, item, view, suspension, schedule or attachment; a voice provider's not found. See above for the exact bodies. |
| `405` | A method outside the four, through the Node host or in-process fetch; `GET` or `DELETE` on the MCP endpoint (plain text, `Allow: POST`). |
| `409` | See the refusals above. |

| Refusal | Where it comes from |
| --- | --- |
| `410` | A suspension past its deadline, on resume and answer. |
| `413` | An upload over a size or page limit. |
| `415` | A non-empty body that is not `application/json`; an unsupported upload type; an audio format the voice provider does not take. |
| `422` | A view's own code failed. |
| `426` | The user stream route reached as a plain `GET`. |
| `429`, `499` | Transcribe: the voice provider's rate limit (`429`), or the request was aborted (`499`). |

| Server | Where it comes from |
| --- | --- |
| `500` | An unhandled error; a non-empty JSON body that does not parse; a dispatch failure; a voice provider's unknown failure; a host that refuses requests because a flow has no sign-in ([Authentication and tenancy](./authentication.md)). |
| `501` | No voice provider; no blob store; a collection write on a user or org collection; no default write flow. |
| `502` | Transcribe: the voice provider could not be reached. |
| `503` | Active-stream capacity; a retryable view failure; `/healthz` while stores open; a voice provider that is unavailable; a webhook the server cannot dispatch: `session_unavailable`, `flow_unregistered`, `dispatch_not_durable` or `route_incomplete` ([Webhooks](./webhooks.md)). |

## Next

- [Items and the stream](./items.md): the frames, events and resume cursors the streams carry.
- [Pause, resume and replay](./durable-execution.md): request statuses, and the checks on resume and answer.
- [Resources](./resources.md): permissions and refusals on the resource routes.
- [Runtime configuration](./runtime.md): the hosts that serve these routes, and mounting them.
- [Authentication and tenancy](./authentication.md): how the caller and tenant are resolved.
- [CLI](./cli.md): `fsdev dev` and `fsdev serve` start the host.

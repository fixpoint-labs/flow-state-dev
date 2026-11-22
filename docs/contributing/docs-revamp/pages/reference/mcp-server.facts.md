# Fact sheet: MCP server (R-34, `reference/mcp-server`)

Every fact the page may state, with file and line. Paths are relative to the repo root.
Sources are the exported surface, tests, one example and existing user docs only.

Abbreviations:

- `ad` = `packages/mcp/src/createMcpTransportAdapter.ts`
- `tc` = `packages/mcp/src/tool-conversion.ts`
- `rf` = `packages/mcp/src/result-formatting.ts`
- `sc` = `packages/mcp/src/schema.ts`
- `er` = `packages/mcp/src/errors.ts`
- `at` = `packages/mcp/test/adapter.test.ts`
- `e2e` = `packages/mcp/test/end-to-end.test.ts`
- `ft` = `packages/core/src/types/flow.ts`
- `df` = `packages/core/src/flow/defineFlow.ts`
- `au` = `packages/core/src/types/auth.ts`
- `host` = `packages/engine/src/transports/host/createInboundTransportHost.ts`
- `rd` = `packages/mcp/README.md`
- `dm` = `apps/docs/docs/server/mcp.md` (existing user page)
- `kb` = `examples/knowledge-base`

**[probe]** marks a behaviour I ran against the real router (the adapter wired into `createFlowApiRouter`, in-memory stores, a temporary test file since deleted) because no existing test pins it. Anything marked **[code only]** was read from source and not run.

Legend: **[test]** pinned by an existing test. **[doc]** from an existing user page, not otherwise verified.

## The page's shape (planned)

Three tables, plus lookups. The tables: settings, how actions map to tools, caller identity. The one named lookup: "Which actions are exposed by default?" Answer in section C. A reader arriving from B-30 (the MCP server recipe) expects: every setting and its default, the tool-name rules, the error codes, how to group calls into a session, and what the adapter does not do.

## A. Surface

- Package `@flow-state-dev/mcp`. Exports: `createMcpTransportAdapter`, `MCP_TRANSPORT_SOURCE` (`"mcp"`), type `CreateMcpTransportAdapterOptions`, `toolNameFromActionKey`, `resolveExposedActions`, `actionToMcpTool`, type `McpTool`, `toolResultFromExecution`, type `McpToolResult`, `toolInputJsonSchema` (`packages/mcp/src/index.ts:55-67`).
- `createMcpTransportAdapter(options?)` returns an `InboundTransportAdapter` whose `source` is `"mcp"` (`ad:135-152`). It is passed in the `adapters` array of `createFlowApiRouter` (`ad:24-26`, `packages/engine/src/routes/createFlowApiRouter.ts:147`) or of `createFlowState` (`packages/engine/src/flowstate/types.ts:283`; used in `kb/fsdev.config.ts:36`).
- Node requirement `>=22`; version 0.1.6 (`packages/mcp/package.json`). Peer: `zod`. Not needed on the page unless the install row wants it.
- The adapter is a hand-written JSON-RPC 2.0 handler over HTTP POST. One flow = one MCP server (`ad:3-4`, `tc:212-215`). Tool names carry no flow prefix (`tc:212-215`).

## B. Settings (table)

All four options are optional (`ad:82-121`). A settings table has these rows.

| Option | Type | Default | Behaviour |
| --- | --- | --- | --- |
| `basePath` | `string` | `"/api/flows"`, or `"/mcp"` when `dedicatedBasePath` is true | Route prefix. A trailing slash is removed (`ad:139-146`) **[test: `at:211-247`, "normalizes a trailing slash"]** |
| `dedicatedBasePath` | `boolean` | `false` | Off: endpoint is `POST <basePath>/:kind/mcp`. On: `POST <basePath>/:kind` (`ad:153-155`) **[test: `at:248-258`, `e2e:141-`]** |
| `allowedOrigins` | `string[] \| "*"` | unset (same-origin only) | See section F |
| `forwardQueryParams` | `string[]` | unset (forwards nothing) | See section G |

Details for the two path rows:

- **Correction to the R-34 row carried from B-30.** It said "`dedicatedBasePath` (default `/mcp`...)". `dedicatedBasePath` is a boolean, default `false`. The string `/mcp` is the default of `basePath` once `dedicatedBasePath` is true (`ad:82-94`, `ad:139-140`).
- Default endpoint: `POST /api/flows/:kind/mcp`. With `dedicatedBasePath: true`: `POST /mcp/:kind`. With `{ dedicatedBasePath: true, basePath: "/integrations/mcp" }`: `POST /integrations/mcp/:kind` (`ad:139-155`; the three-case route table is `at:224-246`).
- `basePath` also works without `dedicatedBasePath`: `{ basePath: "/custom" }` mounts `/custom/:kind/mcp` **[test: `at:211-235`]**.
- A dedicated base that is root-only (`""`, `"/"`, `"///"`, `" / "`) throws `TypeError` "dedicated basePath must include a non-root prefix." when the adapter is created **[test: `at:211-222`]** (`ad:141-145`). A root-only `basePath` without `dedicatedBasePath` is not rejected by this check (`ad:141`) **[code only]**.
- One adapter instance mounts one layout. In dedicated mode the default `/api/flows/:kind/mcp` URL is not served: the route table holds only the dedicated path (`ad:153-173`; `at:248-258` lists exactly `/mcp/:kind` for the three methods). `[test]`
- Each endpoint has three routes, `POST`, `GET` and `DELETE` (`ad:157-173`). `GET` and `DELETE` return `405` with header `Allow: POST` and body `Method Not Allowed` (`ad:597-602`) **[test: `at:266-280`, `e2e:130-139`]**.
- HTTP action routes (`/api/flows/...`) are separate and unaffected by the MCP prefix (`ad:3-6`; `dm:72-77`) **[doc]**. Whether a `/api/flows` route and an MCP route can collide is validated by the router: path collisions throw `TransportRouteCollisionError` at construction (`packages/engine/src/routes/createFlowApiRouter.ts:143-146`). The MCP route at `/api/flows/:kind/mcp` takes the request before the HTTP catch-all **[test: `e2e:110-128`]**.

Flow-level and action-level settings (on `defineFlow`, not on the adapter):

| Setting | Where | Default | Behaviour |
| --- | --- | --- | --- |
| `mcp.enabled` | flow | `false` | Opts the flow in. A request for a flow without it returns JSON-RPC `-32601` `Flow "<kind>" is not exposed via MCP.` (`ft:330-337`; `ad:226-229`) **[test: `at:502-518`]** |
| `mcp.exposeResources` | flow | `true` | Documented as exposing resources via `resources/list`; the list is empty today whatever its value (section I) (`ft:338-343`; `ad:351`) |
| `actions.<key>.mcp.enabled` | action | `true` | `false` removes the action from the tool list (`ft:129-141`; `tc:282`) **[test: `at:106-110`, `at:489-500`]** |
| `actions.<key>.mcp.name` | action | derived from the key | Overrides the tool name (section D) |
| `actions.<key>.mcp.session` | action | unset (fresh session per call) | Section H |
| `actions.<key>.description` | action | the block's `description` | Section C |

## C. Which actions are exposed by default (the named lookup)

- With `mcp: { enabled: true }` on the flow, **every entry of `flow.actions`** is exposed as a tool, except entries with `mcp: { enabled: false }` (`tc:275-303`; `ad:339-345`) **[test: `at:105-110`]**. Nothing is exposed for a flow without `mcp.enabled` (`ad:227`).
- `flow.actions` holds only the flow's caller-facing (`public`) actions. `internal.actions`, `task.actions`, webhook bindings and schedule bindings live in other maps and are never exposed (`ft:263-270`) **[test: `at:112-136`, webhooks]**.
- A call to a tool that does not exist, or that was opted out, returns `-32601` `Unknown MCP tool "<name>".` (`ad:384-388`) **[test: `at:476-500`]**.
- A request over MCP arrives as a `public` dispatch, the same type an HTTP request delivers (`packages/engine/src/execution/transport-sources.ts:50-66`). So MCP reaches only what HTTP callers can reach. **[code only]**
- Every exposed action needs a non-empty `description`: its own, else its block's. `defineFlow` resolves the description once, taking the block's when the action sets none (`df:146-154`, `df:602-605`; `ft:276-286`). If an exposed action still has none, `defineFlow` throws at flow registration: `Flow "<kind>" exposes action "<key>" via MCP but the action has no description, and neither does its block "<block name>". Give the block a description, or set actions.<key>.description when the tool needs wording of its own...` (`df:1348-1370`). Whitespace-only counts as empty. **[code only]** (the guard is not covered by a test in `packages/mcp/test`).
- The description becomes the tool's LLM-facing description in `tools/list` (`tc:309-315`). The doc comment asks that it say what the tool does, when to use it against its siblings, preconditions and side effects, and what each argument means (`ft:276-286`).
- Example: `kb/src/flow.ts` exposes eight tools and opts the two filesystem-path actions out with `mcp: { enabled: false }` (`kb/src/flow.ts:4-11`, `kb/src/flow.ts:131-135`). Use it as the reason a reader would opt an action out: it takes server-side paths.

## D. How actions map to tools (table)

| Action | Tool |
| --- | --- |
| key `recordPayment` | name `record_payment` |
| `URLParser` | `url_parser` |
| `getHTTPSProxy` | `get_https_proxy` |
| `IOError` | `io_error` |
| `event_queue` | `event_queue` |
| `event-queue` | `event-queue` |

Source: `tc:244-246` (`decamelize`, separator `_`, `preserveConsecutiveUppercase: false`), **[test: `at:92-103`]**. Hyphens are kept.

- `mcp.name` overrides the derived name, when it is a non-empty string (`tc:284-288`) **[test: `at:138-153`, `at:333-357`]**.
- Name charset: `[A-Za-z0-9_.-]`, 1 to 128 characters. A derived or overridden name outside it throws `MCP tool name "<name>" derived from action "<key>" violates the MCP tool name charset (must match [A-Za-z0-9_.-]{1,128}). Rename the action.` (`tc:248-261`). **[code only]** (no test).
- Two exposed actions that resolve to the same tool name throw `Flow "<kind>" exposes actions "<a>" and "<b>" which both resolve to the MCP tool name "<name>". Rename one of them or set a distinct mcp.name override.` (`tc:291-298`) **[test: `at:155-195`]**. The override goes through the same check.
- **Correction to the R-34 row from B-30 / README.** The README says the collision throws "at flow registration" (`rd`, "Tool name derivation"). It does not. `resolveExposedActions` runs inside `tools/list` and `tools/call` (`ad:339`, `ad:384`), so the error is thrown when a client's request reaches the adapter. **[probe]**: a flow with `recordPayment` and `record_payment` registered fine; the first `tools/list` threw the error out of `router.POST` (no JSON-RPC response from the adapter; the host sees an exception). The page says "the first `tools/list` or `tools/call` fails with this error", and gives no HTTP status. Only the missing-description check runs at registration (section C). The charset error is thrown at the same point as the collision.
- `tools/list` result: an array of `{ name, description, inputSchema }` for each exposed action, in the action declaration order (`ad:335-345`; `tc:231-235`, `tc:309-315`) **[test: `at:437-452`]**.
- `inputSchema` is the action's `inputSchema`, else the block's `inputSchema` (`tc:313`). Zod to JSON Schema via `zod-to-json-schema`, target `jsonSchema2019-09`, no `$ref`s, `$schema` key removed (`sc:180-195`). Always an object: a schema that is not an object, or an object with no properties, becomes `{ "type": "object", "properties": {}, "additionalProperties": false }` (`sc:189-203`) **[test: `at:197-209`]**. **[probe]**: a `z.object({ amount: z.number() })` lists as `{"type":"object","properties":{"amount":{"type":"number"}},"required":["amount"],"additionalProperties":false}`.
- **Contradiction inside the source.** The header comment of `schema.ts` says "Draft 2020-12 dialect"; the code passes `target: "jsonSchema2019-09"`. Code wins. The page names no dialect; it says the schema is a JSON Schema object with no `$ref`s.

## E. Caller identity (table)

How the adapter answers "who is calling":

- The adapter builds a `PrincipalResolutionContext` with `source: "mcp"`, the raw `request`, and an `envelope` of `{ flowKind, action, input, metadata: { mcpMethod } }` (`ad:236-245`). `action` is the called tool's name for `tools/call` (the tool name, not the action key) and the literal `"(metadata)"` for every other method; `"(unknown)"` when a `tools/call` has no string name (`ad:241`). `input` is the JSON-RPC `params` (`ad:242`).
- It then calls `host.resolvePrincipal(context)` once per request (`ad:231-246`): the flow's own `authentication.resolvePrincipal`, else the router's host-level `resolvePrincipal` (`host:291-302`; router option `packages/engine/src/routes/createFlowApiRouter.ts:149-157`).
- So the hook receives `ctx.source === "mcp"` and the raw `Request` (`au:99-117`). It can read the `Authorization` header (`dm:196-201`) **[doc]**. Credentials are read by your resolver, from whatever it chooses. The adapter itself reads none, and `forwardQueryParams` does not touch authentication (`ad:117-118`; `rd`, query params section). **Page claim**: "Send credentials in the `Authorization` header; the adapter does not read a token from the query string." A resolver you write could still read `ctx.request.url`; the page says only that the adapter does not.
- `ctx.source` is an open string; the known set is `http`, `mcp`, `webhook`, `scheduled`, `notification` (`au:12-17`).
- Resolver return values (`au:200-216`, `host:305-347`): the resolver may return a full principal, a partial `{ userId?, orgId? }` or `null`.
  - A `userId` that is missing is filled from `authentication.defaultUserId`.
  - With no `userId` after that and `requireUser` true (the default), the host throws `PrincipalResolutionError("Action request requires non-empty userId", { status: 401 })`.
  - A resolver that returns no usable `orgId` is refused with a 401 `PrincipalResolutionError` (`host:260-274`) whose message is `Request requires a verified organization: authentication.resolvePrincipal returned no usable orgId. Return a nonempty, well-formed orgId from the resolver.` The reserved development id gets its own message, `Request requires a verified organization: "__fsd_default_org__" is reserved for unauthenticated single-organization development and cannot be claimed by a configured resolver. Return this deployment's own organization id.` `Action request requires non-empty userId` is only for a missing `userId` (`host:331-336`). `orgId` must be non-empty, well-formed, and not the reserved development id (`au:55-66`, `au:152-163`).
  - With `requireUser: false` and still no user, the error is status 500 (`host:339-347`).
- The request then runs as the resolved `userId` and `orgId`: `host.dispatch({ source: "mcp", flowKind: flow.id, action, input, principal, sessionId, ... })` (`ad:412-424`) **[test: `at:454-474`]**.
- **Failure shape.** A `PrincipalResolutionError` thrown by the resolver or the host becomes an HTTP response with the error's `status` (default 401), body `{"jsonrpc":"2.0","id":<id>,"error":{"code":-32001,"message":"<error message>"}}`, content type `application/json`, and, only when the status is 401, header `WWW-Authenticate: Bearer realm="MCP"` (`ad:247-259`; `PrincipalResolutionError` default status `packages/engine/src/transports/errors.ts:14-22`) **[test: `at:520-540`]**. **[probe]**: a flow with no resolver and no `defaultUserId` answered `tools/list` with `401`, `WWW-Authenticate: Bearer realm="MCP"` and `{"code":-32001,"message":"Action request requires non-empty userId"}`.
  - Any other error thrown while resolving the principal is rethrown (`ad:260`). The page does not describe it.
- **No-resolver default.** With no resolver configured anywhere, the framework default reads `userId` from the request body. For MCP it looks at `envelope.input`, which is the JSON-RPC `params` (`packages/engine/src/transports/auth/defaultBodyUserIdPrincipalResolver.ts:31-44`, `:93-109`; `ad:242`). So under the default a `userId` key inside `params` would name the user, which is caller-controlled. The org is then the development org `__fsd_default_org__` (`au:25-34`, `host:236-258`). **[code only]**. Page statement: configure `authentication.resolvePrincipal` on any flow served over a network; the default trusts a caller-supplied `userId`.
- Network guard: `createNextHandler`, `createVercelNextHandler` and `serve()` refuse, with HTTP 500 `{"error":"Internal server error"}`, a router whose flows use the default resolver, unless `allowUnauthenticated: true` is passed (`serve()` also skips it for a loopback host, and `fsdev serve` has `--allow-unauthenticated`). It applies to every route including MCP's (`packages/engine/src/routes/network-auth.ts:58-100`; `packages/next/src/createNextHandler.ts:19-60`; `packages/vercel/src/handler.ts:67`; `packages/node/src/serve.ts:193-196`; the refusal text names the flow kinds and the remedy). **[code only]**
- Helpers exported from `@flow-state-dev/engine` for resolvers: `extractBearerToken(header)` returns the token or `null` (case-insensitive `Bearer`, trims, `null` on malformed) (`packages/engine/src/transports/auth/createBearerTokenVerifier.ts:25-37`); `createBearerSecretPrincipalResolver({ secret, principal, headerName? })` (header default `authorization`) returns `principal` on a matching secret, throws `PrincipalResolutionError` 401 on a mismatch and returns `null` when the header is absent or not Bearer (`createBearerSecretPrincipalResolver.ts:40-75`); `createHs256JwtVerifier` (`createBearerTokenVerifier.ts:91`). The knowledge-base example uses the secret resolver and omits `defaultUserId` so a missing key denies (`kb/src/flow.ts:160-166`).
- **Dropped from `dm:213`:** the existing page calls `defaultBodyUserIdResolver(ctx)`. No workspace package exports that name (the exported name is `defaultBodyUserIdPrincipalResolver`). Do not copy it.
- **Order of checks** for a POST (`ad:189-295`), which tells the reader what needs credentials:
  1. Origin check (403).
  2. JSON parse (`-32700`) and envelope check (`-32600`).
  3. `notifications/initialized` (202, no body), `ping` (`{}`) and `initialize` answer here, **before the flow is looked up and before authentication**. **[probe]**: `initialize` on a flow with no resolver and no user answered `200`.
  4. Flow lookup (`-32601` if absent or not `mcp.enabled`).
  5. Principal resolution (401 / `-32001`).
  6. The method: `tools/list`, `tools/call`, `resources/list`, `resources/read`; anything else, including `resources/subscribe` and `resources/unsubscribe`, gives `-32601` (`ad:263-294`). Because authentication runs first, an unauthenticated caller gets `-32001` for an unknown method, not `-32601`.
- Provenance: every MCP request is stored with `RequestRecord.source = "mcp"` (`ad:413`; `packages/engine/src/stores/types.ts:176-184`) **[test: `e2e:87-108`]**. Records written before the field existed read as `"http"` (`stores/types.ts:179-181`). The DevTool request list labels source `mcp` as "MCP" (`packages/devtool/src/react/components/workspace/request-separator.tsx:92`, `:156-160`); other sources show their raw value; the trace, items and state panels are the same as for an HTTP request **[code only for the panel claim; dropped, see below]**.
- Dispatch metadata `{ mcpMethod: "tools/call", mcpToolName: <tool name> }` accompanies each call (`ad:423`). Not observable to a caller beyond the record; leave off the page unless the reader asks where the tool name is recorded.

## F. Origin check (settings row detail)

- `allowedOrigins` unset: a request carrying an `Origin` header that is not the request URL's origin gets HTTP `403` with body `Origin not allowed` (`ad:604-620`). **[probe]**: `Origin: http://evil.example` gave `403 Origin not allowed`.
- `allowedOrigins: ["https://app.example.com"]`: an `Origin` exactly equal to a listed string passes; the same-origin case also still passes (`ad:611-616`).
- `allowedOrigins: "*"`: any origin passes. The JSDoc says use it for local development only (`ad:98-100`).
- A request with **no** `Origin` header always passes (non-browser clients such as Claude Desktop and Cursor do not send one) (`ad:609`; `dm:`, "Origin enforcement") **[doc]**.
- The check runs on `POST` only; `GET` and `DELETE` return 405 first (`ad:157-173`).
- The check is not a credential check. It is the only browser protection.

## G. `forwardQueryParams` (settings row detail)

- Type `string[]`. Each listed param that appears on the endpoint URL is merged into the `tools/call` input under the same key, as a string (`ad:390-406`, `ad:634-651`) **[test: `at:591-680`]**.
- The query value **overrides** a same-named argument the model sent (`ad:111-113`) **[test: `at:628-633`]**.
- Only listed params forward (`at:621-627`). Default forwards nothing (`at:642-647`).
- Only `tools/call` is affected. `initialize`, `tools/list`, `resources/*` and authentication do not see the params (`ad:117-118`, `ad:274`).
- A forwarded key reaches the action only if the action's input schema accepts it; otherwise the usual input validation strips or rejects it, as for any key (`ad:114-117`).
- A repeated param collapses to its first value (`ad:629-633`). A listed param that is absent is skipped. An empty value (`?source=`) forwards as `""` since only `null` is skipped (`ad:647-648`) **[code only]**.
- Arguments handling: a call with `arguments` omitted or `null` still receives the forwarded params (as `{}` plus them) **[test: `at:665-679`]**. An `arguments` that is not a plain object (a string, a number, an array) is passed through unchanged and the forwarded params are not added **[test: `at:649-663`]** (`ad:399-406`).
- Not for credentials: the value sits in the URL (`dm:` "This is not an authentication mechanism") **[doc]**. Use it for a provenance tag such as `?source=claude-desktop`.

## H. Sessions (settings row detail)

- By default there is no state between calls. A `tools/call` is dispatched with `sessionId` undefined, which is a fresh flow session each time, and the adapter never issues an `Mcp-Session-Id` header (`ad:9-11`, `ad:408-419`) **[test: `at:728-733`]**. Each call is one request, one session.
- `actions.<key>.mcp.session` (type `string | { fromInput: string }`, `ft:129-171`) changes that for that action only:
  - **Template string.** Mints a new id for each call. The first `*` is replaced by a random token (`Date.now()` plus random hex); a later `*` stays literal; with no `*`, the token is appended (`ad:493-501`; `ft:155-163`) **[test: `at:734-752`]**. `"conv_*"` becomes like `conv_1784…_a1b2`. Two calls get different ids.
  - **`{ fromInput: "<field>" }`.** Uses the string value of that top-level field of the (merged) input as the session id. A missing field, an empty string or a non-string value falls back to a fresh session, with no error from the adapter (`ad:502-506`) **[test: `at:753-780`]**. Two calls sharing the value share one session **[test: `at:759-765`]**.
  - The id is a **flow** session id. It selects which session state and item history a call sees; it is not the MCP protocol's `Mcp-Session-Id` and not an authentication decision. The principal still comes from `resolvePrincipal` (`ft:164-171`; `rd`, "Deriving a session id per action").
  - `fromInput` reads the value after `forwardQueryParams` has merged, so a forwarded param can supply the session field (`ad:401-408`) **[code only]**.
  - A template-string action hands the new id back only if its block returns it; the adapter does not add the id to the result (`rd`, comment on `createConversation`) **[doc]**. The result format (section J) has no field for it.
- **Who owns the session record**: the resolved principal. A session created through MCP belongs to the resolved `userId` and `orgId`; a different user or organization naming the same id is refused before anything runs and is answered `-32602` `Unknown session "<id>"`, without naming either owner **[test: `at:409-435`]** (`ad:467-475`). **[probe]**: alice's `conversationId: "c1"` ran twice in one session; bob sending `c1` got `-32602 Unknown session "c1"`.
- **Limit: namespace the id.** The id is used as a bare session key, so two users who pick the same string address the same name; the user/org check keeps them apart (as the probe shows) but the second user is refused rather than given a fresh session. For users who do not trust each other, prefix the id with the principal (`ft:164-171`; `dm:326-345`) **[doc]**. The existing page's further claim that "a pre-dispatch metadata write (the session's auto-resume pointer) is only tenant-guarded today" is **dropped**: it describes an internal write the reader cannot observe. The observable fact is the user and organization refusal, shown by the probe above.
- **Limit: bound the field's length in the input schema.** **[probe]**: with `fromInput: "conversationId"`, a call with `conversationId: "c-bad"` and an invalid `n` was rejected by the input schema (`isError: true`), and the session store still listed a session `c-bad` owned by that user. The session is created before the input schema runs. The adapter does not limit the length of the id (`ad:502-506`, `deriveSessionId` has no length check). So a schema bound such as `.max(64)` rejects the call but not the session: an over-long id from a rejected call still leaves a session. The page states it that way and does not claim the bound caps the stored id. (This is the "corrected by pass 5" row; the observable fact is the leftover session.)
- Stored parts, the four questions, for this page (it stores two kinds of record, both written by the runtime, not by the adapter):
  - **Session record.** Owner: the resolved principal's `userId` and `orgId`. Visible to: that user (and organization), as with any session; another user naming it is refused (`at:409-435`). Stored: the flow's configured session store (the stores passed to `createFlowState`; in-memory, filesystem, SQLite or Postgres), keyed by the session id. Count: one per `tools/call` by default; one per distinct id with `fromInput`; one per call with a template string.
  - **Request record.** Owner: the same principal. Visible to: the DevTool request list and the session's history, where it carries `source: "mcp"`. Stored: the request store. Count: one per `tools/call`; `tools/list`, `initialize` and the other methods write none **[test: `e2e:87-108` expects exactly one record after one `tools/call`]**.
  - The adapter itself stores nothing and holds no state between requests (`ad:9-11`).
  - On the page, the two records are a short list that links to Stores; the helper exports and the default-resolver refusal list live on the Authentication page (`reference/authentication`, sections "Built-in resolver helpers" and "The bind guard"), and the page links there.

## I. Resources

- `resources/list` always returns `{ "resources": [] }`, whatever `mcp.exposeResources` says. The engine helper that would fill it returns an empty array (`ad:277-280`, `ad:347-362`; `packages/engine/src/resources/internal.ts:313-327`) **[test: `at:565-575`]**. The `initialize` result still advertises `resources: { listChanged: false, subscribe: false }` (`ad:324-327`).
- `resources/read` never returns content. Errors, all code `-32002` (`er:22`, `ad:513-565`): missing or non-object `params`, or a `uri` that is missing, not a string or empty, gives `-32602` instead (`ad:519-525`); every other string `uri` gets `-32002`. Otherwise: a `uri` not of the form `flow://<kind>/resources/<ref>` or for another flow: `Resource URI "<uri>" is not exposed at this endpoint.`; unknown ref: `Unknown resource "<ref>".` **[probe]**; a collection resource: `Collection resources are not exposed via MCP in v1.`; `client.content.read` not true: `Resource "<ref>" is not exposed (client.content.read is not true).`; otherwise `No flow-bound resource is currently readable in stateless MCP v1.` (the page lists all five)
- `resources/subscribe` and `resources/unsubscribe` return `-32601` `MCP method "<name>" is not supported in v1.` (`ad:285-290`) **[test: `at:577-589`]**.
- Page statement: "`resources/list` returns an empty list and `resources/read` returns `-32002`." Leave out why. Do not carry "will return entries once a flow scope lands": that is roadmap.

## J. Results and errors

Tool result (`rf:96-106`, `rf:123-143`):

- One `{ type: "text", text }` content block, nothing else. No `structuredContent`, no `outputSchema`, no progress notifications, no streamed response; the response is one JSON body (`ad:12-13`; `rd` "v1 Limitations"; `rf:85-93`).
- `text` is: the action's output, as-is when a string and `JSON.stringify` otherwise (`String(value)` if that throws); when the action produced no output, one backward pass over the items returns the first of: a `message` item's text, or a `block_trace` item's output (stringified); an empty string if there is none (`rf:62-74`). The page names the block trace as the record of one block run and links Items.
- A failed run returns `{ content: [{ type: "text", text: <error message> }], isError: true }` with HTTP 200. The message is `error.message` for an `Error`, the string itself, an object's `message` field, else its JSON. **[probe]**: invalid arguments came back as `isError: true`, text `Action input validation failed at "amount": Expected number, received string`. So a bad argument is a tool result, not a JSON-RPC error. **[test: `at:333-357`, `e2e:87-108` for the success path]**.
- Example success text **[probe]**: a handler returning `{ ok: true, amount: 3 }` yields text `{"ok":true,"amount":3}`.

JSON-RPC error codes (`er:16-22`), all with HTTP 200 unless noted:

| Code | Name in source | When |
| --- | --- | --- |
| `-32700` | parse error | Body is not valid JSON (`ad:197-202`) |
| `-32600` | invalid request | Body is not an object, `jsonrpc` is not `"2.0"`, or `method` is not a string (`ad:204-209`) **[test: `at:555-563`]** |
| `-32601` | method not found | Flow not exposed; unknown tool; opted-out tool; unknown method; `resources/subscribe`, `/unsubscribe` (`ad:226-229`, `ad:292-293`, `ad:386-388`) **[test: `at:476-553`, `at:577-589`]** |
| `-32602` | invalid params | `tools/call` with no `params` or no string `name`; `resources/read` with no `uri`; a synchronous dispatch failure that is not a busy case (message passed through); a session another user or org owns (`Unknown session "<id>"`) (`ad:376-382`, `ad:445`, `ad:470-475`) |
| `-32000` | server busy | A concurrency `reject` (`ConcurrencyRejectedError`), a `queue` wait that exceeds its budget (`ConcurrencyQueueTimeoutError`), or a dispatch error whose message matches `capacity`, `busy` or `stream cap`. `error.data` is `{ "retryable": true }` (`ad:429-445`, `ad:458-466`) **[test: `at:359-407`]** |
| `-32001` | authorization required | Principal resolution failed; HTTP status is the error's own, default 401 (`ad:247-259`) **[test: `at:520-540`]** |
| `-32002` | resource denied | `resources/read` (section I) |

Other HTTP statuses: `202` with an empty body for `notifications/initialized` (**[test: `at:281-290`]**, `ad:216-218`); `403` for a refused origin; `405` for `GET`/`DELETE`.

- A JSON-RPC notification (no `id`) other than `notifications/initialized` is not special-cased: it is handled like any request and answered, with `id: null` (`ad:211-212`). **[code only]** Leave off the page.
- `ping` returns `{}` (`ad:219-221`). `initialize` (**[test: `at:292-331`]**, `ad:301-333`): supported protocol versions `2025-06-18` and `2025-03-26` (`ad:78-80`); a supported requested version is echoed; an unsupported one gets `2025-06-18`; no requested version gets `2025-03-26` (`ad:78-80`, `ad:314-320`; verified: the asymmetry is in the code, an absent version falls back to the older one). Response `capabilities`: `tools: { listChanged: false }`, `resources: { listChanged: false, subscribe: false }`; `serverInfo` `{ name: <flow kind>, version: "1.0.0" }`.

## K. Limits (what it does not do)

All flat; no rationale.

- Stateless unless the action sets `mcp.session`; no `Mcp-Session-Id` is ever issued (section H).
- One JSON text result per call. No progress notifications, no `outputSchema`, no `structuredContent`, no SSE response (`ad:12-13`, `rf:85-93`; `rd`, "v1 Limitations").
- `GET` and `DELETE` on the endpoint return 405. There is no server-initiated message stream (`ad:157-173`).
- `resources/list` is always empty and `resources/read` rejects with `-32002` (section I). `resources/subscribe` is not supported.
- No bundled OAuth. Authentication is whatever your flow's `authentication.resolvePrincipal` does (`rd`; `ad:231-246`). Helpers: `extractBearerToken`, `createBearerSecretPrincipalResolver`, `createHs256JwtVerifier`.
- Prompts, completion, logging, sampling and roots: the adapter implements `initialize`, `ping`, `notifications/initialized`, `tools/list`, `tools/call`, `resources/list`, `resources/read` and nothing else; any other method gives `-32601` (`ad:263-294`) **[test: `at:542-553`, uses `completion/complete`]**.
- It cannot expose a flow that did not opt in, and it never exposes `internal`, `task`, webhook or schedule entries (section C).

## L. Hosting (table row)

- `createFlowApiRouter` and `createFlowState` take the adapter through `adapters` (section A). In the default layout it needs no extra mounting: the flow API's catch-all route already forwards `/api/flows/:kind/mcp` (`e2e:87-128`; `dm:44-52`) **[doc]**.
- Dedicated layout (`/mcp/:kind`): the host must forward that prefix to the router. `serve()` from `@flow-state-dev/node` does it automatically: a request that matches no static file and no `basePath` route is offered to the dedicated-route dispatch (`packages/node/src/serve.ts:219-254`; `packages/node/src/app.ts:54-67`, `:173-213`). `fsdev serve` wraps `serve()` with `basePath: "/api/flows"` and says it serves "the flow API and MCP endpoints (no DevTool UI)" (`packages/fsdev/src/commands/serve.ts:3`, `:40`, `:105-108`, `:140-146`). Dedicated routes outside `basePath` are served only for adapter routes, never the flow API (`packages/node/src/app.ts:186-199`).
- In a Next.js app a handler mounted at `app/api/flows/[...path]/route.ts` never receives `/mcp/*`; add `app/mcp/[...path]/route.ts` exporting the same handlers (`dm:80-86`) **[doc; not run]**. `createNextHandler(flowstate, { allowUnauthenticated? })` and `createVercelNextHandler` (from `@flow-state-dev/vercel/next`) return `{ GET, POST, PATCH, DELETE }` (`packages/next/src/createNextHandler.ts:36-60`; `packages/vercel/src/next.ts:18`). A router given `params: { path: ["mcp", "billing"] }` serves the dedicated route **[test: `e2e:141-165`]**.
- An MCP client is pointed at the full URL, e.g. `http://localhost:3000/api/flows/billing/mcp` or `http://localhost:3000/mcp/billing` (`rd`; `dm`).

## M. Rows moved to R-34 by other pages: kept and dropped

Source list: `grep -rhE --include=*.record.md -e '→ R-34( \(corrected by pass 5\))?$' docs/contributing/docs-revamp/pages`. 21 rows from `concepts/serving-flows.record.md`, `reference/stores.record.md`, `reference/http-api.record.md`, `build/mcp-server.record.md`. Disposition of each:

| Row | Disposition |
| --- | --- |
| MCP settings row: `mcp.enabled` on a flow and the adapter that maps its actions to tools | Carried (section B, C) |
| MCP credential: storage location, visibility (`setAt` only), length and character limits, unencrypted | **Dropped.** It is about a user's key for an MCP server that a workforce app *connects to* (`packages/shift-manager/src/lib/mcp-credentials.ts:1-9`, the `connectorKeys` route), not about serving a flow over MCP. It belongs on a page about connecting to external MCP servers (the `mcp` tools catalog page), not here. |
| MCP connector keys: owner, one per server, storage key `mcp-credentials/<server>`, what the route returns | **Dropped**, same reason: client-side connector keys (`mcp-credentials.ts:1-9`, `:20-50`), unrelated to `createMcpTransportAdapter`. |
| Endpoint row: default path `POST /api/flows/:kind/mcp`; GET and DELETE return 405; existing HTTP routes unchanged | Carried (section B). "Existing HTTP routes unchanged" is diff narrative and is not stated; the fact kept is that HTTP action routes stay under `/api/flows`. |
| Settings rows: `dedicatedBasePath` (default `/mcp`...), `basePath`, default URL not aliased, root-only base rejected | Carried, **corrected**: `dedicatedBasePath` is a boolean default `false`; `/mcp` is the default `basePath` in dedicated mode (section B). |
| Hosting row: `serve()`, `fsdev serve`, Next.js `app/mcp/[...path]/route.ts` | Carried (section L). The Next.js route file is from the existing page and was not run. |
| Mapping rows: `mcp.enabled` on the flow and per-action `mcp: { enabled: false }`; non-empty description, registration throws naming flow and action (corrected by pass 5) | Carried (section C). Corrected form kept: the description is the action's own else its block's; registration throws and names the flow, action and block. |
| Caller identity row: `RequestRecord.source = "mcp"`; DevTool "MCP" source chip; same trace/items/state panels (corrected by pass 5) | Carried in part: `source = "mcp"` and the "MCP" label (section E). **Dropped:** "the same neutral chip style used for other non-HTTP sources" and "same panels as an HTTP request": the label table is the only thing I could confirm (`request-separator.tsx:92`), and the panel claim is not backed by a test. |
| Tool-name table: decamelize rules (`recordPayment`, `URLParser`, `getHTTPSProxy`, `event-queue`) | Carried (section D) |
| Refusal row: duplicate tool name throws when the adapter resolves the flow's tools, not at registration; `mcp.name` override uses the same check and charset check (corrected by pass 5) | Carried (section D), confirmed by probe. |
| Caller identity rows: MCP uses `resolvePrincipal`; hook gets `ctx.source === "mcp"` and the raw `Request` | Carried (section E) |
| Caller identity row: credentials from `Authorization` header only; query-string tokens ignored | Carried **narrowed** (section E): the adapter reads no credential itself and does not take one from the query string; a resolver you write decides what it reads. "Only" is the resolver's choice, not a rule the adapter enforces. |
| Failure row: null principal on a user-requiring flow gives 401, `WWW-Authenticate: Bearer realm="MCP"`, `-32001`; `PrincipalResolutionError` same body with its own status; header only when 401 (corrected by pass 5) | Carried (section E), confirmed by probe and `at:520-540`. |
| `forwardQueryParams` row | Carried (section G) |
| `mcp.session` rows: template form, `{ fromInput }` form, fallback to fresh session | Carried (section H) |
| Session row: derived id selects flow session state and history only; no `Mcp-Session-Id`; default fresh session per `tools/call` | Carried (section H) |
| Limits rows for `{ fromInput }`: namespace per principal; a call against another user's session is refused and answered as unknown; the session record is written before the input schema runs, so bound the field length (corrected by pass 5) | Carried (section H), both halves confirmed by probe. The "auto-resume pointer is only tenant-guarded" sentence in the existing page is dropped (unobservable). |
| `allowedOrigins` row | Carried (section F) |
| Limits rows: stateless; one text block; no progress, `outputSchema`, `structuredContent`; `resources/list` empty, `resources/read` `-32002`; no bundled OAuth (corrected by pass 5) | Carried (sections I, J, K). The result-text rule is stated in J. |

## N. Contradictions and cautions for the writer

- README and the existing `dm` say a tool-name collision throws "at flow registration" / "at startup". The code throws on the first `tools/list` or `tools/call`. The page states the code's behaviour.
- `defaultBodyUserIdResolver` in `dm:213` does not exist.
- README "Usage" example (`rd`, top) passes `registry: myRegistry` to `createFlowApiRouter` and uses the `flows: { billing: ... }` record form in `dm:30-38`. `createFlowState` takes `flows` as an **array** of flow instances (the example `kb/fsdev.config.ts:35` uses `flows: [knowledgeFlow]`). The page uses the array form.
- `rd` "Status" section points at a spec. Not carried.
- `schema.ts` header says Draft 2020-12; code targets `jsonSchema2019-09`. Not stated on the page.
- Names that carry "v1" in source messages (`... in v1.`, `...stateless MCP v1.`): these are the adapter's literal error strings and must be quoted exactly if quoted. The page does not call anything "v1"; no release framing.
- No error message here is a place to state the `-32000` retry hint as advice; the fact is `error.data.retryable: true`.
- Everything marked **[probe]** was run once against in-memory stores; none of it has a test of its own. The cutover check should add or accept them before the page ships.

## O. Examples that exist (for the page's one example, if it wants one)

- Settings and mapping tables need no example. If a snippet is wanted, the B-30 app is `support` with `lookUpOrder` exposed and `exportTickets` opted out (`docs/contributing/docs-revamp/pages/build/mcp-server.md`, existing page). Use that scenario, not `billing`.
- A complete real one: `examples/knowledge-base/fsdev.config.ts` (adapter in `adapters`) and `examples/knowledge-base/src/flow.ts` (bearer-secret resolver, two actions with `mcp: { enabled: false }`).
- Tests that show each setting in code: `packages/mcp/test/adapter.test.ts` (route layout `:211-258`, forwarding `:591-680`, session `:682-780`).

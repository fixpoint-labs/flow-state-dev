# Facts for Flows and actions (C-05, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example, and the thing running.

Paths are from the repo root. Abbreviations:

- `core` = `packages/core/src`
- `eng` = `packages/engine/src`
- `cli` = `packages/client/src`
- `hc` = `examples/hello-chat/src/flows/hello-chat/flow.ts`
- `hcc` = `examples/hello-chat/fsdev.config.ts`
- `fl` = `apps/docs/docs/fundamentals/flows.md`
- `ac` = `apps/docs/docs/fundamentals/actions.md`
- `sc` = `apps/docs/docs/fundamentals/state-and-scopes.md`
- `cliDoc` = `apps/docs/docs/api/cli.md`
- `man` = `apps/docs/docs/advanced/manual-flow-execution.md`
- `setup` = `apps/docs/docs/server/setup.md`
- `srv` = `apps/docs/docs/api/server.md`

Legend: **[page]** the page states it. **[ref]** it belongs on `reference/flows` or `reference/http-api`; the page links, does not state it. **[run]** observed by running the thing (a scratch flow through `createClient` over `createInProcessFetch`, and through `fsdev run`); the nearest test or doc line is cited beside it. **[verify]** not confirmed against running code; keep off the page or soften. **[old wrong]** the existing page says it and the code says otherwise; do not copy.

The page's one scenario is the support desk the sitemap names: a flow `support` with one action `reply`, a second action added later. The example flow used for this sheet is a `handler` with a `sessionStateSchema` counting replies; `hc` is the shipped example it was modelled on.

## 1. What a flow is (opening, model figure)

- `defineFlow({ kind, actions })` is the call that makes a flow. `kind` and `actions` are the two fields every flow sets; everything else is optional. `core/types/flow.ts:532-583` (`kind: string`, `actions: TActions`); `hc:78-91`
- `defineFlow` returns a factory. Calling the factory makes the instance the server registers: `export default helloChatFlow()`. `core/flow/defineFlow.ts:1623-1712` (returns `flowFactory` with the blueprint's fields attached); `hc:93-95`; `fl:65-77`. [page: three words for the reader, definition, the called copy that is registered, and sessions; see section 2]
- A flow with no `cardinality` is a singleton: its id is its `kind`. `core/flow/defineFlow.ts:189-197` (omitted means `"singleton"`), `:395-423` (`return suppliedId ?? flowKind`); [run] `inst.id === "support"`, `cardinality: "singleton"`. [page, one clause]
- Several registered copies of one definition (`cardinality: "collection"`, each with its own `id`): [ref] `reference/flows`. `core/flow/defineFlow.ts:419-425`; `fl:79-96`; `fl:182-190`. The page names the idea at most once, in a link. Question 1 of the sitemap needs only the singleton case.
- Not every field of the flow is the page's: `session`, `request`, `user`, `org`, `resources`, `tools`, `voice`, `authentication`, `requireUser`, `webhooks`, `schedules`, `mcp`, `internal`, `task`, `reads`, `views`. [ref] `core/types/flow.ts:532-583`, `:735-790`; `fl:205-225`. The page mentions only `session.stateSchema`, because the example counts replies.
- `requireUser` defaults to `true` for a flow. `core/types/flow.ts:575-578`; [run] `requireUser: true` on a flow that sets nothing. [ref] The page does not mention it; every example passes a `userId` to `createClient`, and the page says the client names the user, in a clause.
- A flow that declares `session.stateSchema` gets its defaults applied each time a run reads the stored state. `sc:186-190`. [ref/State and scopes]

## 2. The three things people call "the flow" (figure: definition, running flow, session)

The figure's claim: the word "flow" names three different things, in three different places. Left to right.

**Definition (your code).**
- The definition is the `defineFlow({ ... })` call in `src/flows/<flow>/flow.ts`. It is code. It holds no user data and answers no request. `fl:79` ("A definition describes a flow"); `core/flow/defineFlow.ts:1623-1700`; `fl` figure description (line 77): "it answers no request itself".
- The layout the page's code lives in: `src/flows/<flow>/flow.ts` holds `defineFlow` and its actions; one block per file under `src/flows/<flow>/blocks/`.. The CLI discovers a flow from `src/flows/<flow-name>/flow.ts`, `flows/<flow-name>/flow.ts` or `flows/<flow-name>.ts`, whose default export is a flow instance. `cliDoc:316-322`. [page]

**Registered flow (the copy in the running process).**
- The copy the server serves is the called factory: `flow = helloChatFlow(); export default flow;`. `hc:93-95`.
- An app registers it by listing it in `createFlowState({ flows: [helloChatFlow] })`. `hcc:13-18`; `eng/flowstate/types.ts:116-125` (`flows?: readonly FlowInstance[]`: "a list. Each is served under its own `flow.id`... two with one id are refused"). `createFlowState` takes a list. [old wrong] `setup` shows `flows: { myFlow }` (lines 17-20) and the setup page's second snippet, an object, which the option's type (`readonly FlowInstance<any, any>[]`) does not accept. The page uses the list.
- The registry is held in the running process; it is not stored. A registry indexes each instance by its id, `register` refuses a duplicate id. `eng/registry/flow-registry.ts:1-30`; `srv:108-127`. [page: one sentence, "the server keeps a registry of flows by id"; the refusals are [ref]]
- The registered flow is shared by every caller: every user's request on `support` goes to the one registered flow. [run] two users on the same flow; `eng/registry/flow-registry.ts:1-10` (every registered instance has one address, its `id`). [page]
- A client lists what is registered with `fsd.flows()`: one row per registered flow, with `id`, `kind`, `cardinality`, `requireUser`, `actions` (names) and `actionSchemas`. `cli/types/index.ts:96-109` (`FlowListEntry`); `eng/routes/http-handlers.ts:515-535` (builds each row from `flow.actions`, `actionSchemas` from `config.inputSchema ?? config.block.inputSchema`); `eng/test/registry-routes.test.ts:1008-1014` (`actionSchemas` keys equal the action names); [run] `[{"id":"support","kind":"support","cardinality":"singleton","requireUser":true,"actions":["reply","reset"],"actionSchemas":{"reply":{"type":"object","fields":{"message":{"type":"string","required":true,"minLength":1}}},"reset":{...}}}]`. [page: the client can ask what actions exist and what input each takes; the route is [ref] `reference/http-api`]
- The list shows the public `actions` only. `eng/routes/http-handlers.ts:526-531` (`Object.keys(flow.actions)`); entries under `internal` and `task` are not on it. [ref] `fl:266-292`

**Session (in the store).**
- A session is one conversation with a flow. Its record holds the flow it belongs to (`flowKind`, and `flowId`, the exact registered instance), its `userId`, its `orgId`, timestamps, and its state. `eng/stores/types.ts:33-60` (`SessionRecord`); `cli/types/index.ts:129-137`, `:181-202` (`SessionSummary`, `SessionDetail`); [run] a session detail reads `{ id, flowKind: "support", flowId: "support", userId: "u1", orgId: "__fsd_default_org__", ... }`.
- A session records the flow instance that made it. A later call that names another instance of the same kind is refused with `409 wrong-instance-session`. `eng/routes/action-routes.ts:289-300`; `eng/test/flow-instance-ownership.test.ts:171`, `:493`; `fl:192-203`. [ref] `reference/flows`; the page may say "a session belongs to the flow that made it" in one clause.
- A session keeps what the flow writes to its session state between calls: a second call with the same `sessionId` sees the first call's count. `sc:35` ("The next request with the same `sessionId` picks up where the last one left off"); [run] `reply` on one session returned `count: 1` then `count: 2`; on a second session `count: 1`. [page]
- The client sees only the session state the flow exposes: `SessionDetail.state` is "the session state fields the flow exposes (`session.client.expose`) or declares readonly, and no others: empty when there are none". `cli/types/index.ts:189-194`; [run] `state: {}` for a flow with no `client.expose`. `hc:87-90` (`client: { expose: ["messageCount"] }`). [ref] The page does not need exposure; if the example shows state read-back, it must set `client.expose`.
- Each call to an action is recorded as a request in its session; a request has an id and a status. `cli/client.ts:335` (`RequestHandle`), `:409-412`; `cli/types/index.ts:213-221` (`SessionRequestSummary`: `id`, `flowKind`, `flowId`, `actionName`, `userId`, `sessionId`); `cli/client.ts:463` (`sessions.requests(sessionId)`: "The requests run in one session"). [page, one clause; the lifecycle states are [ref] `reference/http-api`]

### The four questions for each stored part

The definition and the registered flow store nothing; they are code and process memory. What a flow leaves in the store is a session, and what each request leaves in it.

| Stored part | Who owns it | Who can see it | Where it is stored | How many |
| --- | --- | --- | --- | --- |
| The definition | Your code | Whoever reads the repo | Source files | One per `defineFlow` call |
| The registered flow | The running server process | Every caller who may use the flow; a client lists it with `fsd.flows()` | The process: a registry, not a store | One per registered id; a singleton's id is its `kind` |
| A session | The user who made it, inside the organization the request ran in, and the flow it was made through | That user only: another user naming it gets `404 Unknown session`; a client lists its own user's sessions by default | The app's stores (in memory unless the app names a store; `sqlite`, `postgres` and filesystem persist) | Many per flow: one per conversation, each separate |
| A session's state | The session | The flow's blocks on every request in the session; a client sees only the fields the flow exposes | With the session record | One per session |
| A request (one call of an action) | The session it ran in; the user who sent it | The same user | The app's stores, under the session | One per `send` |

Sources for the table: `eng/stores/types.ts:33-60`; `cli/types/index.ts:129-137`, `:181-202`, `:213-221`; `cli/client.ts:460` (`sessions.list` default is the client's own user: `ListSessionsOptions.userId`, `cli/client.ts:86-100`); `eng/test/session-owner-admission.test.ts:1-12` (a session another user owns is refused at admission, answered `404 Unknown session`); `eng/test/org-boundary-routes.test.ts:356-358`; [run] user `u2` sending to `u1`'s session got `404 {"error":"Unknown session \"sess_...\""}`; `eng/routes/action-routes.ts:272-281` (a session another user or organization owns "is refused at admission with nothing written, and answered as the session routes answer it, as an id with no session behind it. Neither the owner, its organization, nor the session's existence reaches the caller"). For where the data is kept and how stores differ: `fsdev run` writes to `.fsdev/data/fsdev.db` (SQLite) without a config, `cliDoc:87`; with no `stores` the app runs in memory: `goals/first-hour/runs-without-store-ceremony/goal.md` (Signal a: "stderr says the app runs in memory"). [ref] `reference/flows`; the page says "in the app's store" and names two kinds in one clause at most.

## 3. The smallest working example (a flow with one action)

The shape the page shows, in the layout of the page's app, `src/flows/support/flow.ts`:

- `defineFlow({ kind: "support", actions: { reply } })` where `reply` is a block. An action can be the bare block, or `{ block, ... }` when the entry sets more. `core/types/flow.ts:290-306` ("What an author writes for an entry: the block alone, or the object form... `defineFlow` turns a bare block into `{ block }`"); [run] `Object.keys(inst.actions.reset)` is `["block"]` for the bare-block action.
- `hc` is the shipped model: one action `chat` with `{ block: chatPipeline, userMessage: (input) => input.message }`. `hc:78-91`.
- The action's name is its key in `actions`: the client sends `"reply"`. `cli/client.ts:428-437` (`send(action, input, options)`); `cli/client.ts:841-870` (the path is `/api/flows/<flow>/actions/<action>`). [page]
- An action's `inputSchema` defaults to its block's `inputSchema`. It is set on the action only when the action should differ from the block (narrower, richer `.describe()`s for MCP, or `z.unknown()`). `core/types/flow.ts:203-209`; `eng/test/action-input-schema-fix552.test.ts:12-50` (omitted falls back to the block's; an explicit one validates first). [page: one sentence; the example sets none, as `hc` does] [old wrong] `ac:34-35` says `inputSchema` is a field every action carries and the examples set it on every action; the code does not require it.
- Fields an action may set beside `block`: `inputSchema`, `userMessage`, `taskOf`, `concurrency`, `durable`, `autoResume`, `tokenBudget`, `onCompleted`, `onErrored`, `description`, `mcp`. `core/types/flow.ts:196-285`. [ref] `reference/flows`. The page names only `block`, `inputSchema` and `userMessage`.
- `userMessage`: a function of the input that returns the text to record as a `user` message item when the request starts; the text alone, or `{ text, metadata }`. It is not sent to a model. `core/types/flow.ts:212-219`; `hc:82-85`; `ac:36`. [page, one sentence, only if the example sets it]
- [old wrong] `onCompleted` and `onErrored`, on an action and on `request`, are blocks (`BlockDefinition`), not functions; `ac`/`fl:228-246` and `fl:358-383` show `async (result, ctx) => {...}`. `core/types/flow.ts:210-211`, `:416-420`. Keep hooks off the page; the old text must not be copied into `reference/flows`.
- The first action to pass: a handler that counts replies in session state and returns the echo. [run] input `{ message: "hi" }` returned `{ echoed: "hi", count: 1 }`; the second call on the same session returned `count: 2`; a new session returned `count: 1`. `core/blocks/handler.ts:107-121` (`handler({ name, inputSchema, execute })`); `hc:58-66` (`sessionStateSchema` and `ctx.session.patchState`); `sc:57-76` (`ctx.session.incState`). The count is the example's stored thing, and Q2's answer.

## 4. Calling it

**From code (the client).**
- `createClient({ userId, baseUrl })` builds the one client. `userId` is required; `baseUrl` is required unless a `fetcher` is given. `cli/client.ts:55-80` (`CreateClientOptions`); `packages/client/test/client.test.ts:56-62` ("needs a user, and a baseUrl when it has no fetcher"). [page]
- `fsd.flow("support")` gives a handle on one flow, addressed by its id: a singleton's kind. `cli/client.ts:524-530`; `cli/client.ts:857-860`; `packages/client/test/client.test.ts:123-125` (`.flow("demo").send(...)`). [page]
- `flow.send("reply", { message: "hi" }, { sessionId })` runs the action and resolves to a handle on the request it started. `cli/client.ts:428-437`; `:409-412` (`SentRequest` is a `RequestHandle` plus `.response`). [page]
- The send resolves as soon as the server accepts the request, not when the action finishes. The server answers `202` with the request id and `status: "in_progress"`. `eng/routes/action-routes.ts:347-368`; `cli/types/index.ts:80-94` (`ExecuteActionResponse`); [run] `response {"status":"in_progress","request":{"id":"req_...","flowKind":"support","flowId":"support","actionName":"reply","status":"in_progress"},"session":{"id":"sess_..."}}`. [page: the sentence is the answer to "does it wait"]
- Wait for it with `sent.wait()`, which resolves the settled status (`completed`, `failed`, ...), or read what the action returned with `sent.result()`, which resolves `{ status, output }` on `completed` and `{ status: "failed", error }` on `failed`. `cli/client.ts:335-362` (`wait`, `result`: "Resolves for every way a request settles and says which, so branch on `status`"), `:300-306` (`WaitOptions`: polls every 250 ms by default), `:308-333` (`RequestResult`); `packages/client/test/request-result.test.ts:37-66`; [run] `wait` → `{"id":"req_...","status":"completed",...}`; `result` → `{"status":"completed","output":{"echoed":"hi","count":1}}`. [page]
- Follow a request live with `sent.stream({ ... })` instead. `cli/client.ts:405` (`stream(options)`). [page: one clause, links to Streaming]
- Without a `sessionId`, the call starts a session of its own and the response carries none: the `session` field is absent, and the new session's id is not returned. `eng/routes/action-routes.ts:360-366` (`session: resolvedActionInput.sessionId === undefined ? undefined : {...}`); `eng/context/createExecutionContext.ts:758` (id is `ephemeral_<ts>_<rand>`); `sc:186`; [run] `nosession response` had no `session`; the session listed under the user as `ephemeral_...`. [page: "To keep a conversation, make a session first and pass its id": `flow.createSession()` returns the session `{ id, ... }`. `cli/client.ts:445` (`createSession`), `:879-886`; `packages/client/test/client.test.ts:178-186`]
- `send` takes `{ sessionId, requestId, metadata, attachments, stream }`. `cli/client.ts:213-230` (`SendOptions`), `:264-274` (`StreamOption`). [ref] `reference/http-api` for the rest; the page uses `sessionId` only.
- The path a send takes without a `sessionId` is `POST /api/flows/<flow>/actions/<action>`; with one, `POST /api/flows/<flow>/<sessionId>/actions/<action>`. `cli/client.ts:857-860`; `packages/client/test/client.test.ts:127-134`. [ref] `reference/http-api`; the page may show it once as the route a send goes to.

**What the client names.**
- A client names a flow and an action, both by string: `flow("support")` and `send("reply", ...)`. It never names a block. The block is the action's value in the flow's `actions` map and is not on any route. `cli/client.ts:857-860` (path carries `flow` and `action` only); `core/types/flow.ts:188-201` (`ActionCore`: "the executable unit (a block) plus its execution policy"); `eng/routes/http-handlers.ts:526-531` (the flows listing names actions, not blocks). [page: Q1's answer is "an action, on a flow"]
- An action name that the flow does not define fails: [run] over the HTTP route the send answered `500 { error: "DispatchFailed", message: "Flow \"support\" does not define action \"nope\"" }`; through `fsdev run` the CLI exits `2` and prints `Action "nope" not found on flow "support". Available actions: reply`. `eng/execution/runAction.ts:397-405`; `packages/fsdev/src/commands/run.ts:349-355`. [ref] `reference/http-api` (the status is a [verify]: a 500 for an unknown action reads wrong; keep off the page).
- Another user's session id answers as an id with no session behind it: `404 Unknown session`. `eng/routes/action-routes.ts:272-281`; [run]. [page, in the Q2 section]

**Typed calls.**
- Pass `typeof flowDefinition` to `flow<...>(...)` and the action name and input type-check: an unknown action name or an input that does not match the action's schema is a type error. `cli/client.ts:281-298` (`TypedFlow`, `ActionNameOf`, `ActionInputOf`), `:523-531`; `packages/client/test/client.test.ts:162-170` (`@ts-expect-error` on `"walk"` and on `{ value: 1 }`); `ac:104-118`. [page]
- The input type is the action's `inputSchema` output, read from the flow's type. `cli/client.ts:293-298`; `core/types/flow.ts:948` (`FlowActionInput`: the block's `inputSchema` output). [page: one clause]
- Both the flow definition and the called instance satisfy `TypedFlow`: the client test passes `typeof demoFlow`, where `demoFlow = defineFlow({...})` (the definition, not the called copy). `packages/client/test/client.test.ts:39-50`, `:163`. `ac:109` passes `typeof myFlow`. [page: `import type { supportFlow }` is enough]
- Use `import type` so the flow's server code is not pulled into a browser bundle. `ac:118`. [page: one sentence; it is advice, not mechanism]
- The input is checked at runtime against the action's schema, whether or not the call is typed. [page]

**What happens to bad input.**
- Over the client, a `send` with input the schema refuses is accepted, and the request then settles `failed` with `error.code === "validation_error"` and a message `Action input validation failed at "message": String must contain at least 1 character(s)`. It does not reject the `send`. `eng/execution/runAction.ts:411-428` (`parseActionInput` throws `ValidationError("Action input validation failed...")`); `eng/test/action-input-schema-fix552.test.ts:50-51`, `:82-83` (through `runAction`, `result.error.message` matches); [run] `bad result {"status":"failed","error":{"code":"validation_error","message":"Action input validation failed at \"message\": String must contain at least 1 character(s)"}}`. [ref] `reference/flows`; the page may say "input is checked against the action's schema before the block runs" and link; it must not claim a status code.
- [old wrong] `ac:98` ("Bad input returns 400") and `ac:35` ("rejected before any block runs", which is true) conflict: the first is not what happens over this route. Do not copy "returns 400".
- [old wrong] `ac:68-80` documents the HTTP route as `POST /api/flows/:kind/actions/:action` and a stream route. The segment is the instance id, not the kind (`fl:182-190`); for a singleton the two are the same. [page: say "the flow's id"; the `:kind` spelling is [ref]]

**From a terminal.**
- `fsdev run <flowId> <action> -i '<json>'` runs one action and prints one JSON object per line (NDJSON) on stdout. The first argument is the flow's instance id. `cliDoc:13-24`; [run] `fsdev run support reply -i '{"message":"hi"}' --session s1` ended with `{"type":"flow_complete","output":{"echoed":"hi","count":1},"durationMs":60,"items":2}`, exit 0. [page]
- The last line on success is `flow_complete` with the action's `output`; on failure it is `error`. `cliDoc:42-60` (the event table); `packages/fsdev/src/commands/run.ts:56-66` (`FlowEvent`, `flow_complete`, `error`). [page: show the `flow_complete` line; the other event types are [ref] the CLI reference]
- `--session <id>` reuses a session across invocations: the same state is read the second time. `cliDoc:91-99`; [run] two runs with `--session s1` returned `count: 1` then `count: 2`. [page]
- With no config, `fsdev run` finds the flow in `src/flows/<name>/flow.ts` and keeps its data in `.fsdev/data/fsdev.db` (SQLite). With an `fsdev.config.ts`, it uses the config's registry and stores. `cliDoc:38-40`, `:87`, `:316-322`; `hcc:1-18` ("Run a flow from the CLI without the browser: `pnpm fsdev run hello-chat chat -i '{"message":"hi"}'`"); `examples/hello-chat/README.md` ("the same flow, no browser"). [page: one sentence; stores are [ref]]
- An action that does not exist exits `2` and names the actions the flow has: [run] `Action "nope" not found on flow "support". Available actions: reply`. `packages/fsdev/src/commands/run.ts:349-355`; `cliDoc:20` ("An id nothing is registered under fails, and the error lists the ids that are"). [ref]
- A flow that is a generator needs a model: `hello-chat`'s `fsdev run` needs `OPENAI_API_KEY`. `examples/hello-chat/README.md` ("set `OPENAI_API_KEY`"). The page's handler example needs no model; keep the example model-free or say so.

## 5. Question 2: two users call `reply` at once (one definition, many conversations)

What they share:
- The registered flow: the same code, the same `reply` action, the same schema. One registered `support` answers both. `eng/registry/flow-registry.ts:1-10`; [run] two users sent to the one `support`.
- State that is wider than a conversation, when the flow keeps any: user state is one record per user within an organization; org state is one record for everyone in the organization. `sc:14-23` (the scope table: "User: Across sessions for a user, per organization", "Org: Across sessions in an org"); the figure description at `sc:25`: "Org state is shared by everyone in the organization". [page: one sentence, linked to State and scopes; the example sets no user or org state, so the page says "two users in one organization share the organization's state, if the flow has any"]
- The store the app configured: both users' sessions live in the same stores. `hcc:13-18`.

What is separate:
- Each user's session, and its state: a count on one user's session does not touch another's. [run] new session counted from 1. `sc:35`; `sc:27` ("A session names the user and organization it belongs to. It doesn't contain their state").
- A session another user owns is refused. Naming it answers `404 Unknown session`, the same answer as an id that does not exist. `eng/routes/action-routes.ts:272-281`; `eng/test/session-owner-admission.test.ts:1-12`; [run].
- Each request: every `send` is its own request with its own id, and is recorded in its session. `cli/types/index.ts:213-221`; [run] three sends, three request ids.
- Two requests on one session at once run in parallel by default (`allow`). An action can declare `concurrency: "queue"` (one at a time, in arrival order) or `"reject"`. `core/types/flow.ts:244-253` (`concurrency` on `ActionCore`: "Default when unset everywhere: `"allow"`"); `apps/docs/docs/advanced/concurrency-policies.md:10-25`, `:20-24` (the `allow`, `queue`, `reject` lines). [ref] `reference/flows` and Concurrency policies; the page may say "two requests on one session run side by side unless the action says otherwise" in one sentence, and link. The race behaviour is not the page's.
- Where a user comes from: the client names a user, and the server checks it when the app configures sign-in. `cli/client.ts:58-60` (`userId`: "Sent as caller input, never trusted: with sign-in, the server authenticates the request's credentials instead"). [ref] `reference/http-api` and Authentication; the page says "the client says who the user is" in a clause and links.

## 6. Question 3: you add a second action; what changes for the client

- A new key in `actions` is a new name the client may send. The same flow, the same `createClient`, the same session. [run] `reset` added beside `reply`: `fsd.flows()` listed `"actions":["reply","reset"]`, and `send("reset", {})` was accepted. `cli/types/index.ts:96-109`; `eng/routes/http-handlers.ts:515-535`.
- The flow's address, its sessions and its stored state do not change. `eng/routes/action-routes.ts:272-281` (the session is addressed by id, the flow by id; the action is the last path segment); `cli/client.ts:857-860`. [page]
- With a typed client, `send("reset", {})` type-checks as soon as the flow's type has the action; `send` with a name the flow does not have is a type error. `cli/client.ts:281-298`; `packages/client/test/client.test.ts:162-170`. [page]
- An action's input is its own: each action has its own schema, so `reset` may take `{}` while `reply` takes `{ message }`. `core/types/flow.ts:203-209`; [run] `actionSchemas` held a different schema per action. `ac:9-30`. [page]
- Actions share the flow's sessions and state: a session started through `reply` can be given to `reset`. [run] sending `reset` into the session `reply` used was accepted; `sc:35` (a session belongs to the flow, not to an action). [verify the count was reset; the example's `reset` returns `{ ok: true }` only, so keep the claim to "the same session"]
- Removing or renaming an action is a change for every client that sends it. That is a statement of what a name is, not of a rule in the framework: [verify] there is no test on what a stale client gets; the unknown-action answer is a 500 over HTTP (see section 4); keep off the page.

## 7. Question 4: can you run an action with no server

Yes, three ways. Each runs the same action from the same registered flow.

- **A terminal.** `fsdev run <flowId> <action> -i '<json>'`, section 4. `cliDoc:13-24`; [run].
- **The client, in process.** `createClient({ userId, fetcher: createInProcessFetch(flowState) })`: the client's calls go to the engine in this process, with no web server. The same `flow(...).send(...)`, `wait()` and `result()` apply. `cli/client.ts:70-79` (`fetcher`: "Pass the engine's `createInProcessFetch(flowState)` to reach an engine in this process with no web server"); `eng/routes/in-process-fetch.ts:1-11`; `packages/engine/test/in-process-fetch.test.ts:166-188` ("runs a real action and reads its status back through the engine, no server"); `goals/client/does-every-job-with-one-client/goal.md` Outcome ("The same code runs over HTTP and in the host's own process, with no web server") and Signal; [run] the whole of section 4's client sequence ran this way with `createFlowState({ flows: [inst], stores: { default: { primary: inMemoryStores() } } })`. `createInProcessFetch` and `createFlowState` are exported from `@flow-state-dev/engine`. `eng/index.ts:25`, `:35`. [page: this is the example that answers Q4 while staying on the client]
- The in-process path goes through the same router as HTTP and authenticates from the request the same way; there is no trust shortcut. `eng/routes/in-process-fetch.ts:6-10` ("a request takes the same path in process and over HTTP... There is no in-process trust shortcut"). [page: a clause; it is a guarantee]
- **`runAction`.** `runAction({ flow, actionName, input, userId, orgId, sessionId, stores, runtimeConfig })` from `@flow-state-dev/engine` runs one action to its end and resolves `{ output, items, durationMs, error, requestId }`. `eng/execution/types.ts:71-103` (`flow`, `actionName`, `input`, `userId`, `sessionId?`, `orgId` required, `stores`), `eng/execution/runAction.ts:1026-1036`; `man:56-70`, `:84-100`. [ref] / one line on the page, as the sitemap says (the task is B-28). The page names `runAction` once, links the manual-execution page, and does not show its options.
- [old wrong] `man:56-70`'s example omits `orgId`, which `RunActionOptions.orgId` marks "**Required**". `eng/execution/types.ts:80-92`. Do not copy the example. `man:72-80` calls `runtimeConfig` required and `source` an option; both are on `RunActionOptions` (`runtimeConfig` is read at `eng/execution/runAction.ts:1062`, `:1070`).
- `runAction` does not authenticate: the caller supplies a resolved `userId` and `orgId`. `man:39-46`; `eng/execution/types.ts:80-92`. [ref] `reference/flows`.
- A flow used with no server still needs a session and a store to keep state between calls: `--session` on the CLI, or a `sessionId` on `send`. [run]; `cliDoc:91-99`. [page, one clause]

## 8. What it gets you

Each is observable in the page's example.

- **One name to call.** The client sends `reply` to `support`. It does not import, name or know about the blocks behind it, so the blocks can change, be split, or be reordered without the client changing. `cli/client.ts:857-860`; `core/types/flow.ts:188-201`; `eng/routes/http-handlers.ts:526-531`. [page: the claim "blocks can change without the client changing" is inferred from the above; no test asserts it; phrase it as "the route carries the flow and the action, not the block"]
- **The input is checked for you.** An action's input is validated against its schema before its block runs; a bad call comes back as a failed request with the first problem named, not as a half-run. `eng/execution/runAction.ts:411-428`; [run]. [page; shape of the failure is [ref]]
- **A session keeps what the flow writes.** Call `reply` twice on one session and the second sees the first's count; a new session starts at 1. `sc:35`; [run]. [page; it is the example's proof]
- **The same action runs from a browser, a script, a test and a terminal.** The client over HTTP, the client over `createInProcessFetch`, `fsdev run` and `runAction` run one registered action. `goals/client/does-every-job-with-one-client/goal.md` (Outcome: "The same code runs over HTTP and in the host's own process"); `cliDoc:13-24`; `man:11-24`. [page]
- **The client is checked against the flow.** With `typeof flow`, the action names and input shapes come from the definition, so a renamed action or a changed input is a compile error in the client. `packages/client/test/client.test.ts:162-170`; `ac:104-118`. [page]
- **The server tells a client what is there.** `fsd.flows()` lists each registered flow with its action names and input schemas. `cli/types/index.ts:96-109`; `eng/test/registry-routes.test.ts:1008-1014`. [page, one clause; or drop]
- Every send is a recorded request with an id, listed under its session. `cli/types/index.ts:213-221`; `cli/client.ts:463`. [page, one clause; "what a request keeps" is [ref] `reference/http-api`]

## 9. How it fits with the others (neighbours, named once where they first matter)

- **Blocks.** An action's `block` is the thing that runs. Blocks are C-02; the page names a block once, as "what the action runs", and links. `core/types/flow.ts:188-201`; `docs-revamp/pages/concepts/blocks.facts.md` section 1 (`A flow's actions expose blocks to a client`; "A block is run by the framework (as an action, a step, a route, or a tool)"). A sequencer is accepted as an action's block. `hc:71-83`.
- **State and scopes.** What a session, a user and an org hold: C-xx, linked from "what the two users share". `sc:14-27`.
- **Entries a client cannot reach.** `internal.actions`, `task.actions` and `reads` are beside `actions`; a client cannot send them. [ref] `reference/flows`. `core/types/flow.ts:313-322` (`TypedEntries`), `:605` (`internal`), `fl:266-310`. The page does not name them; the sitemap sends every field to `reference/flows`.
- **Transports other than a client send.** Webhooks, schedules and MCP reach the same registered flow. [ref] `reference/flows` and the transports pages. `fl:205-225`. The page may say "other callers reach the same flow" in the links, not in prose.
- **Several registered copies of one definition.** [ref] `reference/flows`. The page links it from "What it gets you" or Next, once. `fl:79-96`, `:182-203`.
- **Lifecycle hooks.** [ref] `reference/flows`. [old wrong] see section 3.
- **Endpoints** (`/api/flows/...`, the stream route, the request routes). [ref] `reference/http-api`. `cli/client.ts:857-860`; `eng/routes/action-routes.ts:347-368`.
- **A flow is not a worker, a board, or a kit.** [verify] no fact on this sheet supports a comparison; leave it off.

## 10. Things the page must not say

- "Bad input returns 400." Over `send`, the call is accepted and the request settles `failed` (section 4).
- `onCompleted` or `onErrored` as callbacks taking `(result, ctx)`. They are blocks.
- `createFlowState({ flows: { myFlow } })`. `flows` is a list.
- `inputSchema` as a required field of every action.
- The `runAction` example from `man` as written: it leaves out `orgId`.
- That a send without a `sessionId` gives back a usable session id. It does not.
- That a flow is something the server stores. The definition lives in code and the registered flow in the running process; only sessions and their requests are stored.
- Internal reasoning for the design (why the factory exists, why singletons are the default). Say what is: the call returns a factory; calling it makes the copy you register.
- The retired words: say "user" for the signed-in human, never "person". (The word list is `node scripts/check-retired-terms.mjs`'s; `RETIRED_PAGE` runs it on the page's own path.)
- Model names other than `openai/gpt-6-luna`; the example needs none.

## 11. Verification

The behaviours marked [run] were observed with two scratch runs, deleted afterwards:

1. A flow `support` with actions `reply` (a handler that counts replies in session state) and `reset`, served by `createFlowState({ flows: [inst], stores: { default: { primary: inMemoryStores() } } })`, called through `createClient({ userId, baseUrl: "", fetcher: createInProcessFetch(state) })` and `flow<typeof f>("support")`: `createSession`, `send` with and without `sessionId`, `wait`, `result`, `sessions.list`, `sessions.get`, `flows()`, a send with input the schema refuses, a send of an action the flow lacks, and a send by a second user into the first user's session.
2. The same flow discovered from `src/flows/support/flow.ts` and run by `tsx packages/fsdev/src/bin.ts run support reply -i ... --session s1 --store filesystem` twice, and once with an action the flow lacks.

No tracked file was left changed by the runs.

## Revise round 1 notes

- Verified `parseActionInput` reports `issues[0]` only: "first problem" was true; the page now says only that the request fails before the block runs (finding 8) and links the failure shape to the flows reference (R-22).
- Verified a send with no `sessionId` returns no session (sections 4, `action-routes.ts:360-366`); kept, linked to R-13.
- Finding 11: `fsdev run` with a config uses the config's stores; the page's config sets none, so state does not carry between runs. The page no longer claims `count` is 2 on a second CLI run, and the example drops `--session s1`. Section 4's `--session` line holds only with persistent stores.
- Section 2 "in memory": removed from the page and figure; the page says what a caller can rely on (one registered flow per id, shared by every user, not per user).
- The flow's id defaults to its `kind` for a singleton (section 1); the page says so at the `defineFlow` paragraph.
- Moved to Reference (R-05, R-13, R-22, R-35): action fields, `inputSchema` override, failure shape, `404 Unknown session`, `fsdev run` output detail.

## Revise round 2 notes

- Finding 4 checked by running the page's flow through `createClient` over `createInProcessFetch`, twice per variant: with the flow's `session.stateSchema` and no `?? 0` guard, counts were 1 then 2; with no flow-level schema and the guard, also 1 then 2. The block's `sessionStateSchema` types `ctx.session.state.replyCount` as `number`, and the flow-level default applies on read (`sc:186-190`), so the page drops the guard and keeps both declarations (block declares its slice, flow declares the full shape; as `hc:24-29`, `:61`).
- The flow's id is defined once, at `defineFlow`: a singleton's id is its `kind` (section 1).
- "What it gets you" is four points. The "one action, three callers" point is cut from the page: section 4 and "With no server" already show it (section 8's fourth bullet stays a fact, not a page claim).
- Action form: "`{ block, ... }` when the action needs options of its own" (section 3, `core/types/flow.ts:290-306`).

## Revise round 3 notes

- Pass 9 question 2 (two users at once, what is shared, separate, and what a foreign session id gets): the page's "One definition, many conversations" now answers all three in the page body as Shared / Separate / the refusal. Section 5 is the source: shared registered flow, the app's stores and org state (`sc:14-23`); separate sessions, state and requests (`cli/types/index.ts:213-221`); `404 Unknown session`, same as a missing id, nothing written, owner not revealed (`eng/routes/action-routes.ts:272-281`, `eng/test/session-owner-admission.test.ts:1-12`, [run]).

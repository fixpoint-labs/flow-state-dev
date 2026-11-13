# Facts for how-it-fits-together.md (concept, C-01)

Every fact the page may state, with file and line, from what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `examples/`. No spec, no `docs/internal/`, no `CLAUDE.md`, no `docs/architecture/`.

Short forms (paths from the repo root): `core` = `packages/core/src`; `engine` = `packages/engine/src`; `react` = `packages/react/src`; `client` = `packages/client/src`; `docs` = `apps/docs/docs`; `hc-cfg` = `examples/hello-chat/fsdev.config.ts`; `hc-flow` = `examples/hello-chat/src/flows/hello-chat/flow.ts`; `hc-app` = `examples/hello-chat/src/app.tsx`; `hc-route` = `examples/hello-chat/app/api/flows/[[...path]]/route.ts`. Names in the example (`hello-chat`, `chat`) come from `examples/hello-chat`; the page's own app (help desk) is the page's choice and carries the same shapes.

## Read this first: things the page cannot state as built

1. **No kit ships yet.** `defineKit`, the `kits` and `fill` options and the install and slot machinery are built (`core/kit/define-kit.ts`, `engine/flowstate/types.ts:130-145`, `engine/flowstate/kits.ts`). The kit factories the doc comments name, `workforce({ model })` and `harnesses({})`, are not exported: `grep -rl defineKit packages/*/src` finds only `core/index.ts` and `core/kit/*`, and `packages/workforce/src/index.ts` exports no kit. Their only appearance is in two doc comments (`core/kit/define-kit.ts:5`, `engine/flowstate/types.ts:~128`). A page showing `kits: [workforce(...)]` states a surface specified and not built: mark it for reconciling at cutover. The built way to get workers today is `hireWorkforce(installation)`, whose flows are registered through `flows` (`packages/workforce/README.md:5-9`, `:36-39`).
2. **The plan says `useFlow` and `send`.** `useFlow` lists flows and sessions and creates and selects a session (`react/hooks/useFlow.ts:55-62`, `:135-152`); it returns no send. From a React page, sending is `useSession(sessionId).sendAction(action, input, options?)` (`react/hooks/useSession.ts:441-445`; used at `hc-app:47-64`). `send(action, input, { sessionId })` is a method of the client's flow handle (`client/client.ts:855-862`; used at `packages/workforce/README.md:58-59`).
3. **`flows` is a list.** `flows?: readonly FlowInstance[]`, each served under its own `flow.id`, two with one id refused (`engine/flowstate/types.ts:119-124`). `hc-cfg:17-18` passes `flows: [helloChatFlow]`. Two docs pages print a record (`docs/server/setup.md:22`, `docs/persistence/overview.md:38`); the type wins.

## The app in one file

- `createFlowState(options)` returns a handle built from declarative config; `kits`, `flows`, `stores` are all optional fields (`engine/flowstate/types.ts:124`, `:137`, `:178`). `docs/server/setup.md:7-10`: the engine registers your flows, runs actions, persists state and streams results; you describe it once with `createFlowState`.
- The whole wiring of the example app: `createFlowState({ flows: [helloChatFlow], onError })`, default-exported from `fsdev.config.ts`. `hc-cfg:14-22`
- The same file is imported by the web route and loaded by the `fsdev` CLI. `hc-cfg:2-4`
- A route file mounts the handle: `export const { GET, POST, PATCH, DELETE } = createNextHandler(flowstate)`. `hc-route:10`. One `[[...path]]` route is enough. `apps/docs/guides/anatomy-of-a-flow.md:111`
- Host adapters (`node`, `next`, `vercel`) serve a FlowState from one kind of host. `docs/glossary.md:73`
- The engine can run with no HTTP server: `fsdev run`, `runAction`. `docs/server/setup.md:9`; `docs/cli/agent-dev-loop.md:8`
- `stores` takes one adapter (`sqliteStores({ filename })`) or named profiles chosen per environment; omitted, data is held in memory, nothing persists across a restart, and startup says so. `engine/flowstate/types.ts:168-178`

## The layers: one sentence each, and what teaches it

- The framework is built in layers; a package uses only the layers under it. `docs/glossary.md:15`, `:25`
- Order, bottom to top (the glossary figure's description): Contracts (item types, block instance ids); Core (blocks, flows, actions, scopes, resources, capabilities); Engine, Client, React, Orchestration, and the smaller packages Memory, Tools and Workspace; the hosts and stores built on Engine, Workforce (on Core and Orchestration), Patterns and Harness manager; Shift Manager on top. `docs/glossary.md:23`
- Workforce imports Core and Orchestration and nothing from Engine. `docs/glossary.md:25`
- Engine runs flows and stores what they write. Store adapters (`store-sqlite`, `store-postgres`) and host adapters plug into it. `docs/glossary.md:23`, `:72-73`
- The client is how code outside the server talks to your flows: Node, browser and edge, no React or DOM dependency; HTTP and SSE, or an engine in the same process. `docs/client/overview.md:7`
- The React package wraps the client with hooks and renderers. `docs/client/overview.md:9`
- Patterns, tools, skills, UI and memory are built on the runtime and are not part of it; you can ship a flow without any. `docs/ecosystem/overview.md:5-9`, `:11-21`
- Most higher terms are a lower term with a name and a rule added; a worker is a resource one user owns, naming the flow that runs it. `docs/glossary.md:17`
- Orchestration builds task boards from the Core primitives; Workforce builds workers, coordinators and projects; Shift Manager is an app that reads what Workforce writes. `docs/glossary.md:15`

### Kit
- A kit packages a feature so an app installs it with one config object. `core/kit/define-kit.ts:3-5`
- It declares its config (`config`), the kits it `requires`, the typed places other kits fill (`slots`), what it fills in the kits it requires (`contributes`), an optional folder it owns (`directory`), and an `install` that returns the flows it serves. `core/kit/define-kit.ts:5-9`, `:117-125`
- It composes existing pieces: resources, views and capabilities ride on the flows its install returns. `core/kit/define-kit.ts:9-10`
- Name: lowercase letters, digits, single hyphens, unique in an app; a kit listed twice is refused. `core/kit/define-kit.ts:117`; `engine/flowstate/kits.ts:56-62`
- `createFlowState({ kits })` takes kits in any order and installs them in `requires` order; their flows are served beside `flows`. `engine/flowstate/types.ts:126-131`; test `engine/test/flowstate/kits.test.ts:92`
- Only a kit that requires a slot's owner can fill the slot; the app fills slots itself with `fill`, by slot key. `core/kit/define-kit.ts:123-124`; `engine/flowstate/kits.ts:138-141`; `engine/flowstate/types.ts:139-145`
- A kit's folder is read at start-up; a file in it that no reader used rejects `ready()` and every request, naming each file. `engine/flowstate/types.ts:133-136`

### Flow
- `defineFlow({ kind, requireUser, actions, session: { stateSchema, client: { expose } } })` returns a definition; calling it (`helloChatFlow()`) returns the instance you register. `hc-flow:78-95`
- A flow is the deployable unit: blocks, state and client visibility in one registerable object. `apps/docs/guides/anatomy-of-a-flow.md:44`
- `kind` names the flow to the engine; its address is its id, the kind unless the instance was given another. `engine/flowstate/types.ts:119-123`
- An action is a named entry point on a flow. It wraps one root block and adds an input schema, hooks, a token budget and durability settings. `docs/glossary.md:49`; `hc-flow:80-85`
- `userMessage` on an action makes the framework emit the user's line as a message item. `hc-flow:76-77`
- A flow can also declare `views`. `core/types/flow.ts:60-62`

### Block
- A block is a typed unit of work with an input schema and an output schema; you define it, the framework runs it. `docs/glossary.md:41`
- Exactly five kinds: handler (plain code), generator (a model call), evaluator (a model judgment), sequencer (runs blocks in order), router (picks one block to run). `docs/glossary.md:42`; `core/types/block.ts:43`
- A sequencer is itself a block, so it can be an action's block. `core/blocks/sequencer-methods.ts:154-162`; `hc-flow:71-73`, `:82-83`
- A block listed in a generator's `tools` is a tool; there is no separate tool type. `docs/glossary.md:46`
- `.tap(block)` runs a block for its state change only; the previous step's output stays the result. `hc-flow:68-70`

## What happens when you send a message: the stops, in order

Example: flow `hello-chat`, action `chat`, input `{ message }`.

1. **The page calls the action.** `session.sendAction("chat", { message })`. `hc-app:47-64`; signature `react/hooks/useSession.ts:441-445`. With no `sessionId` it throws. `react/hooks/useSession.ts:2194-2196`
2. **The page shows the user's line at once** when `userMessage` is passed; the server's copy replaces it. `react/hooks/useSession.ts:436-438`, `:2237-2250`
3. **POST to the action's route.** With a session: `POST /api/flows/<flow>/<sessionId>/actions/<action>`; without: `POST /api/flows/<flow>/actions/<action>`. `client/client.ts:857-861`; `engine/routes/router.ts:128-140`
4. **The server answers with the stream or with 202.** With `Accept: text/event-stream` the POST response is the SSE stream (200). Otherwise `202` with `{ status: "in_progress", request: { id, flowKind, flowId, actionName, status }, session }`, and the client follows the request on a separate GET stream. `engine/routes/action-routes.ts:327-362`. `sendAction` asks for the inline stream and falls back to the 202 path. `react/hooks/useSession.ts:2260-2266`
5. **Refusals before anything runs.** A session another user or organization owns is answered as an unknown session; neither the owner nor the session's existence reaches the caller. `engine/routes/action-routes.ts:274-279`. Input is validated against the action's `inputSchema` before any block runs; invalid input returns a validation error. `apps/docs/guides/anatomy-of-a-flow.md:73`
6. **The root block runs.** In the example a sequencer: `chatGenerator` (the model call), then `incrementMessageCount` as a tap. `hc-flow:68-73`
7. **Items stream out as blocks emit them.** A generator with `itemVisibility: { client: true, history: true }` streams its message to the client and keeps it in history (`hc-flow:42-52`); with `itemVisibility` unset it emits no items (`core/blocks/generator.ts:1269-1275`). A handler shows nothing unless it emits through `ctx.emit` (`core/types/block.ts:466`).
8. **State changes are written as blocks make them,** each emitting a `state_change` item. `docs/fundamentals/state-and-scopes.md:463`. On completion lifecycle hooks fire and the request is marked complete (`apps/docs/guides/anatomy-of-a-flow.md:77`); the client refetches the authoritative snapshot on `request.completed` (`docs/fundamentals/state-and-scopes.md:461`).
9. **The page re-renders** from `session.items` and the snapshot's exposed state (`session.snapshot?.clientData?.session?.messageCount`). `hc-app:50`, `:72-73`. `useSession` folds stream events into a live item list. `docs/streaming/overview.md:19`
10. **A dropped stream resumes** from its sequence number: the client sends `Last-Event-ID` or `starting_after`, the server replays what was missed. `apps/docs/guides/anatomy-of-a-flow.md:103-105`; `docs/fundamentals/overview.md:42`

Item facts:
- Every artifact a block run produces is an item; items stream over SSE and are, in most cases, persisted. `docs/streaming/overview.md:7`
- Items belong to requests; requests belong to sessions; the session exposes the items of all its requests as one timeline. `docs/streaming/overview.md:9`
- Three jobs: streaming output, session history, LLM context. `docs/streaming/overview.md:11-17`
- A request is one run of one action on one session. `docs/glossary.md:71`

## Where to look when an answer is wrong

- A worker is a configuration plus an owner, run by the flow it names. `packages/workforce/README.md:5-6`
- A worker's brief is the Markdown body of its `WORKER.md`; its frontmatter is its configuration. `packages/workforce/README.md:5-7`, `:21-26`
- A worker whose record names no `flow:` runs on the built-in `agent` flow; its body becomes its instructions and steers its answers. `packages/workforce/README.md:40-43`
- A worker whose record names `flow: <kind>` runs on that flow you wrote. `packages/workforce/README.md:60-62`
- So, in order of effort: the worker's file, then the flow it names, then the blocks inside that flow. *(The ordering is the page's advice built from the three facts above, not a documented procedure.)*
- `fsdev run <flow> <action> -i '<json>'` runs the same engine as the server against the same stores. Stdout is one JSON line per event (`item_added`, `content_delta`, `state_change`, `flow_complete`, `error`); stderr carries runtime logs. `docs/cli/agent-dev-loop.md:8`, `:13-14`
- Run from the app directory, `fsdev run` uses the app's `fsdev.config.ts` models and stores. `docs/cli/agent-dev-loop.md:33`
- The DevTool shows sessions, items, state and execution traces; started with `fsdev dev`. `docs/devtool/overview.md:8-19`
- Each block execution is recorded as a `block_trace` item. `docs/advanced/block-memoization-and-replay.md:7`; `docs/streaming/items.md:57-112`. Trace items are hidden from clients by default and opted into with `?include=trace`. `docs/streaming/trace-channel.md:5-16`
- A block's trace carries its failure as `block_trace.error`, `{ message, code?, details? }`. `docs/streaming/items.md:112`
- Wrong state on a page: the browser sees only the fields a scope's `client.expose` lists. `core/types/flow.ts:57-66`; `hc-flow:88-90`; `docs/fundamentals/state-and-scopes.md:25`

## Where things are kept: four columns

### In your repo
- Flow code (`defineFlow`, blocks) and `fsdev.config.ts`. `hc-cfg`; `hc-flow`
- A standard worker is a `WORKER.md` file under `workforce/teams/<team>/workers/<name>/`; every user has each. `packages/workforce/README.md:11-23`; `docs/glossary.md:116`
- A kit's folder is read when the app starts. `engine/flowstate/types.ts:133-136`

### In the process (gone when it ends)
- With the default in-memory store nothing persists across a restart. `engine/flowstate/types.ts:169-172`; `docs/persistence/overview.md:25`
- A suspension held in memory is lost when the process ends, so durable execution is off by default on in-memory stores. `docs/advanced/durable-execution.md:38`

### In your store
- Three kinds of stored data: scope state (session, user, org), resources, items. `docs/persistence/overview.md:7`
- The required `primary` slot backs sessions, requests, users, orgs, active requests, checkpoints, content and traces. `docs/server/setup.md:78`
- Adapters: in-memory (default), file, SQLite, Postgres. `docs/persistence/overview.md:25-28`
- The store is chosen by `stores` on `createFlowState`. `engine/flowstate/types.ts:168-178`

### In the browser
- The active session id is React state in `useFlow`; with `autoCreateSession` it creates a session on mount when none exists, and by default selects the most recent. `react/hooks/useFlow.ts:18-29`, `:141-152`
- `useSession` holds the live item list and the snapshot in React state. `docs/streaming/overview.md:19`; `react/hooks/useSession.ts:2188-2330`
- A snapshot read returns the session's exposed state (`snapshot.clientData`) and items. `hc-app:50`
- `useView` holds the last answer as `value`, `undefined` until the first answer lands. `react/hooks/useView.ts:13-14`
- `useDraft(namespace, id)` keeps unsent message text in `localStorage` under `<namespace>:<id>`; storage that throws leaves it in memory. `react/hooks/useDraft.ts:2-12`. It is the only `localStorage` use in `packages/react/src` and `packages/client/src` (`grep -rn "localStorage\|sessionStorage\|indexedDB"` over both finds only `useDraft.ts:2,23,36,37`).

## The four questions, for each stored part

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| Session | The user who created it, in one organization; a request naming another user's or organization's session is answered as an unknown session. `engine/routes/action-routes.ts:274-279`; `docs/fundamentals/state-and-scopes.md:25` | That user's requests. The browser sees only what `client.expose` lists. `docs/fundamentals/state-and-scopes.md:25` | `primary` store. `docs/server/setup.md:78` | Many per user per flow: `useFlow` lists them (`react/hooks/useFlow.ts:135-139`). One session is one conversation (`docs/fundamentals/state-and-scopes.md:35`) |
| Session state | The session; keyed by session id, and by tenant id when one is sent. `docs/fundamentals/state-and-scopes.md:25` | Blocks of that session; the browser, `client.expose` fields only | `primary` | One record per session |
| Items (messages, tool results, traces) | The request that produced them, collected on the session. `docs/streaming/overview.md:9` | Conversational items by their `itemVisibility`; `block_trace`, `router_decision`, `state_snapshot` hidden from clients, opt-in for the DevTool. `docs/streaming/trace-channel.md:5-16` | On the request record, `primary`. `docs/streaming/overview.md:9` | Many per request |
| A block's output | The request that ran it, as that block's `block_trace.output`. `docs/advanced/block-memoization-and-replay.md:7` | Not sent to the browser; the DevTool reads it through the trace channel; a downstream block gets it as input | The item log on the request record, on a store that persists; with the default in-memory store it goes when the process does (`engine/flowstate/types.ts:169-172`) | One per block execution; recorded up to 256 KiB serialized, a larger value as a placeholder with a 512-character preview. `docs/streaming/items.md:149-155` |
| User state | One user in one organization (keyed by user and org; one record per flow copy with `isolateUserState`). `docs/fundamentals/state-and-scopes.md:25` | That user's blocks and views; the browser, `client.expose` fields. `docs/fundamentals/state-and-scopes.md:465` | `primary` | One per user per organization |
| Org state | The organization; keyed by org id, per flow copy with `isolateOrgState`. `docs/fundamentals/state-and-scopes.md:25` | Blocks of everyone in the organization; the browser, `client.expose` fields | `primary` | One per organization |
| Request state | One action run. `docs/fundamentals/state-and-scopes.md:20`, `:472-479` | Blocks in that run; the next request cannot see it. `docs/fundamentals/state-and-scopes.md:25` | Written through to `stores.request`, kept with that request. `engine/context/createExecutionContext.ts:2645-2668` | One per request |
| Resource | Declared at `session`, `user` or `org` scope; lives with that scope. `docs/resources/overview.md:43` | By its `client` config. `docs/fundamentals/state-and-scopes.md:467` | `primary` (content and resource state). `docs/persistence/overview.md:7` | A named container; a collection is a family keyed by a pattern. `docs/glossary.md:53-54` |
| A view's answer | Nobody: it is computed on each read of the data it reads (a session, or the caller's user or org). `core/types/view.ts:2-9` | The caller who reads it; `user` and `org` views take identity from the verified principal. `core/types/view.ts:29-33` | **Not stored**: "a view adds no request, changes no row ... nothing is stored" (`engine/test/session-views-store-nothing.test.ts:2-7`). The browser holds the last answer as `value` while the screen is open (`react/hooks/useView.ts:13`) | One shared read per view and input in a client, shared by every screen watching it. `react/hooks/useView.ts:7-9` |
| Standard worker (`WORKER.md`) | You; a file in your repo | Every user has each standard worker. `docs/glossary.md:116` | Your repo, read at start-up. A user's first edit copies it to that user's own roster under the same id and the change lands on the copy. `workforce/src/workers/client.ts:218-223` (`workforce` = `packages/workforce`) | One file per standard worker; one copy per user who edits it |
| Unsent text in a message box | The browser's user | That browser | `localStorage` via `useDraft`. `react/hooks/useDraft.ts:2-12` | One per `namespace:id` |

## Answer key for the plan's four questions (facts only)

1. *A worker gives a wrong answer: which layer first, which next?* The worker's file first: its body is its instructions on the built-in `agent` flow (`packages/workforce/README.md:40-43`). If the file is right, or names its own `flow:` (`:60-62`), the flow, then its blocks; `fsdev run` prints each block's events (`docs/cli/agent-dev-loop.md:13-14`).
2. *Kit, flow, block, one sentence each.* Kit: a feature an app installs with one config entry; it brings flows, a folder it reads and slots (`core/kit/define-kit.ts:3-10`). Flow: the deployable unit, with actions, state and client visibility, served under its id (`apps/docs/guides/anatomy-of-a-flow.md:44`). Block: a typed unit of work, one of five kinds (`docs/glossary.md:41-42`).
3. *Stops before text comes back.* The page calls the action; POST to the action route; session check and input validation; the root block runs (generator, then tap); items stream over SSE; state is written and the snapshot refetched; the page re-renders (steps 1-9).
4. *Which outlive the request?* A session: yes, stored in `primary`, shared by its requests (`docs/fundamentals/state-and-scopes.md:35`). A block's output: yes on a store that persists, as part of the item log; on the default in-memory store it goes with the process (`engine/flowstate/types.ts:169-172`). A view's answer: no, computed per read, nothing stored (`engine/test/session-views-store-nothing.test.ts:2-7`).

## Limits a reader would assume otherwise (Reference rows, not page text)

- A view cannot write and cannot call a model: a write is refused with `read_only`, a model call with `view_model_call`. `engine/test/views.test.ts:321-345`; `core/types/view.ts:4-6`
- With `stores` omitted, a restart loses sessions. `engine/flowstate/types.ts:169-172`
- `block_trace` output above 256 KiB serialized is recorded as a placeholder. `docs/streaming/items.md:149-155`

## Contradictions and doubts for the caller

- **Standard worker edits.** `docs/glossary.md:116` says "Nobody can edit one. To change it for yourself, fork it." The code says the first edit of a standard worker copies it to the user's own roster under the same id (`packages/workforce/src/workers/client.ts:218-223`); the standard is unchanged for everyone. The glossary line is stale. The page should use the code's wording or not mention editing.
- **`flows` record vs list.** See item 3 above.
- **`useFlow` has no send.** See item 2 above.
- **Anatomy guide "ephemeral session".** `apps/docs/guides/anatomy-of-a-flow.md:74` says an action sent without a `sessionId` creates "an ephemeral one (or a persisted one, depending on flow config)". Not verified against code; left off. `useSession.sendAction` requires a session id (`react/hooks/useSession.ts:2194-2196`).
- **A "starter" is not a package.** The plan's layer stack from S-1 is not citable. Layer order here comes from `docs/glossary.md:23`. Nothing citable defines a starter.
- **Resource visibility defaults** belong to the Resources Reference page; this sheet gives only "by its `client` config".

## Revise round 3 notes (pass 8, round 1 of this pass)

- Unsent draft text in `localStorage` is framework behavior (`useDraft`, `react/hooks/useDraft.ts:2-12`), not the example app's. The sentence left the page prose for a client Reference row (R-14, provisional slug `../reference/client.md`); the figure still draws the box.
- "Each block's recorded output" is observable only through the trace channel and DevTool, not from the API on this page. Cut from the page (Reference).
- `sendAction` throwing without a session id (`react/hooks/useSession.ts:2194-2196`): moved to the React API reference (`../reference/api/react.md`). The page keeps that `useFlow` finds or creates the session.
- Another user's session answered as unknown (`engine/routes/action-routes.ts:274-279`): page keeps "A session answers only the user who owns it" and links R-20 (provisional `../reference/sessions.md`).
- `fsdev run` output format (`docs/cli/agent-dev-loop.md:13-14`): moved to R-35 (provisional `../reference/cli.md`).
- A worker's `WORKER.md` body is its instructions and a record may name `flow:` (`packages/workforce/README.md:5-7`, `:40-43`, `:60-62`); the page now says so in one clause where `triage` first appears.
- `session.items` now first appears in step 4 (`hc-app:72-73`).

## Revise round 2 notes (pass 8)

- A view's answer: the server keeps nothing; the browser holds the last answer as `value` while the screen is open (`react/hooks/useView.ts:13`; `engine/test/session-views-store-nothing.test.ts:2-7`). Page now says both.
- `triage` is a worker whose `WORKER.md` names `flow: help-desk` (`packages/workforce/README.md:60-62`); the debugging path now ends at `fsdev run help-desk chat`. Worker defined at first use, beside `workforce` (`:5-7`).
- Request state: written to the store with its request (`engine/context/createExecutionContext.ts:2645-2668`); only that run sees it (`docs/fundamentals/state-and-scopes.md:25`).
- Session ownership sentence merged into step 2; R-20 link moved there.
- Added "What it gets you" (store persistence `engine/flowstate/types.ts:168-178`; stream resume `anatomy-of-a-flow.md:103-105`; `client.expose` `state-and-scopes.md:25`; `fsdev run` stores `agent-dev-loop.md:33`) and "How it fits with the others" (layers `docs/glossary.md:25`; client `docs/client/overview.md:7-9`; `docs/ecosystem/overview.md:5-9`).
- `workforce` kit factory remains specified and not exported; the page keeps its cutover comment.

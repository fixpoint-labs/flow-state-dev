# Facts for how-it-fits-together.md (concept, C-01)

Paths are from the repo root. Sources are only what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `examples/`. No spec, no `docs/internal/`, no `CLAUDE.md`.

Short forms: `core` = `packages/core/src`; `engine` = `packages/engine/src`; `react` = `packages/react/src`; `hc-flow` = `examples/hello-chat/src/flows/hello-chat/flow.ts`; `hc-cfg` = `examples/hello-chat/fsdev.config.ts`; `hc-app` = `examples/hello-chat/src/app.tsx`; `hc-route` = `examples/hello-chat/app/api/flows/[[...path]]/route.ts`.

## Read this first: three things the page cannot state as built

1. **No kit ships yet.** `defineKit`, the `kits` and `fill` options and the install machinery are built. `workforce(...)`, `harnesses(...)` and `claudeCode()` are not exported by any package: `grep defineKit packages/*/src` finds only `core/kit/*`, and `workforce`'s `index.ts` has no kit. The `kits: [workforce(...), harnesses(...), claudeCode()]` config exists only in the pilot page (`docs/contributing/docs-revamp/pilot/what-flow-state-is.md:42-52`) and in two doc comments (`core/kit/define-kit.ts:5`, `engine/flowstate/types.ts:128`). A page that shows `createFlowState({ kits })` with those names is stating a surface not yet built; reconcile at cutover. The built way to get workers today is `hireWorkforce(...)` (`packages/workforce/README.md:5-9`, `:30-34`), registered through `flows`.
2. **The page plan says `send` and `useFlow`.** `useFlow` (`react/hooks/useFlow.ts:58`) lists flows and sessions and creates/selects a session. It has no send. Sending from a React page is `useSession(sessionId).sendAction(action, input, options)` (`react/hooks/useSession.ts:441-445`, example `hc-app:47-64`). `send(action, input, { sessionId })` is a method on the client's flow handle (`packages/client/src/client.ts:841-877`, used at `packages/workforce/README.md:44-46`).
3. **`stores` and `flows` are not the whole config.** `createFlowState({ kits, flows, stores })` is valid: all three are optional fields (`engine/flowstate/types.ts:124`, `:137`, `:178`). `flows` is a list, `readonly FlowInstance[]` (`types.ts:124`), though `apps/docs/docs/server/setup.md:22` and `apps/docs/docs/persistence/overview.md:38` print a record (`flows: { myFlow }`). The type wins; the list is what `hc-cfg:17-18` uses.

## The layers (what each is, one sentence, and where it is taught)

- Packages stack in layers; a package uses only the layers under it. `apps/docs/docs/glossary.md:15`, `:21-25`
- Contracts (item types, block instance ids) is the bottom layer; Core builds on it; Engine, Client, React, Orchestration sit on Core; Workforce and the hosts/stores sit above; Shift Manager sits on top. `apps/docs/docs/glossary.md:23` (figure description)
- Workforce imports Core and Orchestration, nothing from Engine. `apps/docs/docs/glossary.md:25`
- Contracts holds the shapes shared by the server and the browser; Core re-exports them and adds the builders. `apps/docs/docs/glossary.md:35`
- Engine runs flows. Store adapters (`store-sqlite`, `store-postgres`) and host adapters (`node`, `next`, `vercel`) plug into it. `apps/docs/docs/glossary.md:65`
- The client is how code outside the server talks to your flows; it works in Node, browser and edge, with no React or DOM dependency; it speaks HTTP and SSE, or calls an engine in the same process. `apps/docs/docs/client/overview.md:7`
- The React package wraps the client with hooks and renderers. `apps/docs/docs/client/overview.md:9`
- Ecosystem packages (patterns, tools, skills, UI, memory) are built on the runtime but are not part of it; you can ship a flow without any. `apps/docs/docs/ecosystem/overview.md:5-9`, `:11-21`

### Kit (one sentence)
- A kit packages a feature so an app installs it with one config object. `core/kit/define-kit.ts:3-5`
- A kit declares its config (`config`), the kits it `requires`, the `slots` other kits fill, what it `contributes` to the slots of kits it requires, an optional folder it owns (`directory`), and an `install` that returns the flows it serves. `core/kit/define-kit.ts:6-9`, `:117-151`
- A kit's name: lowercase letters, digits, single hyphens, unique in an app. `core/kit/define-kit.ts:117-118`; listed twice is refused, `engine/flowstate/kits.ts:56-62`
- A slot is a typed place other kits fill: keyed (by key; a key given twice is refused naming both) or list (appended in install order, the app's last). `core/kit/define-kit.ts:22-48`
- Only a kit that requires the slot's owner can fill it. `core/kit/define-kit.ts:123-124`; refused otherwise, `engine/flowstate/kits.ts:140`
- `createFlowState({ kits })` takes kits in any order and installs in `requires` order. `engine/flowstate/types.ts:126-131`
- A kit's flows are served beside the app's `flows`. `engine/flowstate/types.ts:130-131`; test `engine/test/flowstate/kits.test.ts:92`
- The app can fill slots itself with `fill`, by slot key. `engine/flowstate/types.ts:139-145`
- A kit's folder is read at start-up; any file in it that no reader used rejects `ready()` and every request, naming each file. `engine/flowstate/types.ts:134-136`; `engine/flowstate/kits.ts:268-290`
- Wrong kit config throws at construction: the factory checks config against the kit's schema. `core/kit/define-kit.ts:250-256`
- A kit "composes existing pieces": resources, views and capabilities ride on the flows its install returns. `core/kit/define-kit.ts:9-10`

### Flow (one sentence)
- `defineFlow({ kind, actions, session: { stateSchema, client: { expose } } })` returns the flow; calling it returns an instance you register. `hc-flow:78-91`, `:95`; `core/flow/defineFlow.ts:1-9`
- A flow is the deployable unit: it bundles blocks, state and client visibility into one registerable object. `apps/docs/guides/anatomy-of-a-flow.md:44`
- A flow's `kind` is its name to the engine; its address is its id (the kind unless the instance was given another). `engine/flowstate/types.ts:119-123`; `apps/docs/docs/glossary.md:158`
- An action is a named entry point on a flow that wraps one root block. `apps/docs/docs/glossary.md:49` (Action row); `hc-flow:80-85`
- A flow can also declare `views`. `core/flow/defineFlow.ts:185`, `:1490`

### Block (one sentence)
- A block is a typed unit of work with an input schema and an output schema; you define it, the framework runs it. `apps/docs/docs/glossary.md:41`; `docs/contributing/docs-revamp/pages/blocks.facts.md` (block facts, `core/types/block.ts:1195-1217`)
- Exactly five kinds: handler (plain code), generator (a model call), evaluator (a model judgment), sequencer (runs blocks in order), router (picks one block to run). `apps/docs/docs/glossary.md:42`; `core/types/block.ts:43`
- A sequencer is itself a block, so it can be an action's block. `core/blocks/sequencer-methods.ts:156-162`; `hc-flow:71-73`, `:82-83`
- A block can be a generator's tool. `core/blocks/generator.ts:422`; `apps/docs/docs/glossary.md:46`

## The app in one file

- `createFlowState(options)` assembles the runtime from declarative config and returns a `FlowState` handle whose router initialises lazily on first request. `engine/flowstate/createFlowState.ts:1325-1335`
- `hc-cfg` is the whole wiring for the example app: `createFlowState({ flows: [helloChatFlow], onError })`, default-exported. `hc-cfg:14-22`
- With `stores` omitted, data is held in memory and nothing persists across a restart; startup says so. `engine/flowstate/types.ts:169-172`
- `stores` takes one adapter (`sqliteStores({ filename })`), or named profiles chosen per environment. `engine/flowstate/types.ts:173-178`
- A route file mounts the handle: `export const { GET, POST, PATCH, DELETE } = createNextHandler(flowstate)`. `hc-route:1-8`; `packages/next/src/createNextHandler.ts:4`, `:37`
- The same file serves `fsdev run` and `fsdev dev`: put the config in `fsdev.config.ts` default-exported. `apps/docs/docs/server/setup.md:30`; `hc-cfg:1-9`
- The engine can also be called with no HTTP server: `fsdev run` and `runAction`. `apps/docs/docs/server/setup.md:9`
- A host adapter mounts the handle as route handlers (`node`, `next`, `vercel`). `apps/docs/docs/glossary.md:73`

## What happens when you send a message (the stops, in order)

One page action, from the browser. Names from the example: flow `hello-chat`, action `chat`, input `{ message }`.

1. **Page calls the action.** `session.sendAction("chat", { message })`. `hc-app:47-64`; signature `react/hooks/useSession.ts:441-445`. `sendAction` throws if the hook has no `sessionId`. `react/hooks/useSession.ts:2195-2196`
2. **The page shows the user's line at once** when you pass `userMessage`; the server's copy replaces it. `react/hooks/useSession.ts:2227-2248`; doc `:436-440`
3. **POST to the flow's action route.** With a session: `POST /api/flows/<flow>/<sessionId>/actions/<action>`; without: `POST /api/flows/<flow>/actions/<action>`. `packages/client/src/client.ts:857-861`; routes `engine/routes/router.ts:130-140`
4. **The server answers inline or with 202.** If the request has `Accept: text/event-stream`, the POST response is the SSE stream (status 200). Otherwise it answers `202` with `{ status: "in_progress", request: { id, flowKind, flowId, actionName, status }, session }` and the client follows the request on a separate GET stream. `engine/routes/action-routes.ts:327-362`. `useSession.sendAction` asks for the inline stream and falls back to the 202 path. `react/hooks/useSession.ts:2262-2318`
5. **Refusals before anything runs.** A session that another user or organisation owns is answered as an unknown session. `engine/routes/action-routes.ts:272-280`. The input is validated against the action's `inputSchema` before any block runs; invalid input returns a validation error. `apps/docs/guides/anatomy-of-a-flow.md:72`
6. **The action's root block runs.** In `hc-flow` that is a sequencer: `chatGenerator` (the model call), then `incrementMessageCount` as a tap. `hc-flow:71-73`. Each step's output is the next step's input; a `.tap` runs for its state change only and the previous output stays the result. `hc-flow:68-70`; `core/blocks/sequencer-methods.ts:163-166`
7. **Items stream out as blocks emit them.** A generator with `itemVisibility: { client: true, history: true }` streams its message to the client and keeps it in history. `hc-flow:42-52`. A generator with `itemVisibility` unset produces no auto-emitted items. `core/blocks/generator.ts:1271-1275`. A handler shows nothing unless it emits through `ctx.emit`. `docs/architecture/blocks.md:65` (via `blocks.facts.md`); `core/types/block.ts:466`
8. **State changes are saved as blocks make them**, each emitting a `state_change` item on the wire (`apps/docs/docs/fundamentals/state-and-scopes.md:463`); on completion, lifecycle hooks fire and the request is marked complete (`apps/docs/guides/anatomy-of-a-flow.md:77`). The page calls the refetched state "the snapshot" and says so where it first appears. The client refetches the authoritative snapshot on `request.completed`. `apps/docs/docs/fundamentals/state-and-scopes.md:461`
9. **The page re-renders** from `session.items` (the live item list) and from the snapshot's exposed state. `hc-app:50`, `:72-73`. `useSession` folds the stream's events into a live item list. `apps/docs/docs/streaming/overview.md:19`
10. **A stream that drops can resume**: events carry sequence numbers; the client sends `Last-Event-ID` or `starting_after` and the server replays what was missed. `apps/docs/guides/anatomy-of-a-flow.md:103-105`; `apps/docs/docs/fundamentals/overview.md:42`

Item facts the page may use:
- Every artifact a block run produces is an item; items stream over SSE and are, in most cases, persisted. `apps/docs/docs/streaming/overview.md:7`
- Items belong to requests; requests belong to sessions; the session exposes the items of all its requests as one timeline. `apps/docs/docs/streaming/overview.md:9`
- Three roles: streaming output, session history, LLM context. `apps/docs/docs/streaming/overview.md:11-17`
- A request is one run of one action on one session. `apps/docs/docs/glossary.md:71`

## Which layer to open first when an answer is wrong

Only observable behaviour, so the page can point a reader at one place per kind of wrong.

- A worker's brief is the Markdown body of its `WORKER.md`; the file's frontmatter is its configuration. `packages/workforce/README.md:5-7`, `:21-26`, `:62-64`
- A worker whose file names no `flow:` runs on the built-in `agent` flow; its body becomes its instructions. `packages/workforce/README.md:40-43`
- A worker whose file names `flow: <worker flow>` runs on that worker flow, and the flow decides what a worker may declare. `packages/workforce/README.md:60-66`
- So a worker's wrong answer has three places to look, in order of effort: the file (instructions/model/tools), then the flow it names, then the blocks inside that flow. *(This ordering is the page's advice, built from the three facts above, not a documented procedure.)*
- To see which block produced what: `fsdev run <flow> <action> -i '<json>'` prints one JSON event per line to stdout (`item_added`, `content_delta`, `state_change`, `flow_complete`, `error`) and runtime logs to stderr; `--log-level debug` adds nested-block events inside sequencers and routers. `apps/docs/docs/cli/agent-dev-loop.md:8`, `:13-14`, `:50`
- `fsdev run` uses the app's `fsdev.config.ts` (its models and stores) when run from the app directory. `apps/docs/docs/cli/agent-dev-loop.md:33`
- The DevTool shows sessions, items, state and execution traces over HTTP and SSE; started with `pnpm fsdev dev`. `apps/docs/docs/devtool/overview.md:8-18`
- Each block execution is recorded as a `block_trace` item (input, output, error). `apps/docs/docs/streaming/items.md:57-112`; the trace items are hidden from clients by default and opted into with `?include=trace`. `apps/docs/docs/streaming/trace-channel.md:5-16`, `:30-36`
- When a block fails, `block_trace.error` is `{ message, code?, details? }`. `apps/docs/docs/streaming/items.md:112`
- Wrong **state** shown on a page: the browser sees only the fields a scope's `client.expose` (or `derived`) lists. `core/types/flow.ts:59-66`; `hc-flow:88-90`; `apps/docs/docs/fundamentals/state-and-scopes.md:25`

## Where things are kept — four columns

### In your repo
- Flow code (`defineFlow`, blocks), `fsdev.config.ts`, and a kit's folder (e.g. `workforce/teams/<team>/workers/<name>/WORKER.md`) are files in your repo. `hc-cfg`; `hc-flow`; `packages/workforce/README.md:13-23`
- A worker's file ID: team and worker folder give the id `team.worker`; an org worker's id is its folder name alone. `packages/workforce/README.md:93-95` (field table, `id`)
- A kit's folder is read when the app starts. `engine/flowstate/types.ts:134`
- A **standard worker** is one defined by files in the repo; every user has each. `apps/docs/docs/glossary.md:116`

### In the process (gone when the request or process ends)
- Request state lasts one action run: scratch space for one run; the next request cannot see it. `apps/docs/docs/fundamentals/state-and-scopes.md:20`, `:25`, `:472-479`
- With the default in-memory store nothing persists across a restart. `engine/flowstate/types.ts:171-172`; `apps/docs/docs/persistence/overview.md:7`, `:30`
- The registered flows, the model resolver and the store connections live in the `FlowState` handle for the life of the process. `apps/docs/docs/server/setup.md:15-30`
- An in-memory suspension is lost when the process ends, so durable execution is off by default on in-memory stores. `apps/docs/docs/advanced/durable-execution.md:38` (table row and sentence after)

### In your store (outlives the request)
- Three categories of stored data: scope state (session, user, org), resources, and items. `apps/docs/docs/persistence/overview.md:7`
- The `primary` slot backs sessions, requests, users, orgs, active requests, checkpoints, content and traces. `apps/docs/docs/server/setup.md:78`, `apps/docs/docs/persistence/overview.md:11`
- Adapters: in-memory (default, lost on restart), filesystem, SQLite, Postgres. `apps/docs/docs/persistence/overview.md:25-30`
- The store is chosen by `stores` on `createFlowState`. `engine/flowstate/types.ts:168-178`

### In the browser
- The active session id is React state in `useFlow`; with `autoCreateSession` it creates a session on mount when none exists, and by default selects the most recent one. `react/hooks/useFlow.ts:18-29`, `:141-152`
- The live item list and the snapshot are held by `useSession` in React state/refs. `react/hooks/useSession.ts:649`, `:2188-2330`
- A snapshot read returns the session's exposed state (`snapshot.clientData`) and its items. `react/hooks/useSession.ts:527-528`; `hc-app:50`
- `useDraft(namespace, id)` keeps unsent message text in `localStorage` so a reload keeps what was typed; if storage throws it is kept in memory only. `react/hooks/useDraft.ts:2-12`, `:63`
- Nothing else in the React or client packages writes to `localStorage`/`sessionStorage`/IndexedDB. Checked: `grep -rn "localStorage\|sessionStorage\|indexedDB" packages/react/src packages/client/src` finds only `useDraft.ts`.

## The four questions, for each stored part

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| Session | The user who created it, in one organisation. A request naming a session another user or organisation owns is answered as an unknown session. `engine/routes/action-routes.ts:272-280`; `apps/docs/docs/fundamentals/state-and-scopes.md:25`, `:503` | That user. The browser sees only what the session's `client.expose` lists. `apps/docs/docs/fundamentals/state-and-scopes.md:25` | The `primary` store. `apps/docs/docs/server/setup.md:78` | Many per user per flow: `useFlow` lists them (`react/hooks/useFlow.ts:137-139`). A session is one conversation (`apps/docs/docs/fundamentals/state-and-scopes.md:35`) |
| Session state | The session. Keyed by session id, and by tenant id when one is sent. `apps/docs/docs/fundamentals/state-and-scopes.md:25`, `:511` | Blocks of that session; the browser sees `client.expose` fields only | `primary` | One record per session |
| Items (messages, tool results, block traces) | The request that produced them, collected on the session. `apps/docs/docs/streaming/overview.md:9` | Conversational items reach the client by their `itemVisibility`; `block_trace`, `router_decision`, `state_snapshot` are hidden from clients and read by the DevTool opt-in. `apps/docs/docs/streaming/overview.md:43-58`; `apps/docs/docs/streaming/trace-channel.md:5-16` | On the request record, in the `primary` store. `apps/docs/docs/streaming/overview.md:9` | Many per request; one `block_trace` per block execution (lifecycle patched in place). `apps/docs/docs/streaming/items.md:175` |
| A block's output | Recorded as the block's `block_trace.output` on the request that ran it. `apps/docs/docs/advanced/block-memoization-and-replay.md:7` | Not shown to the browser. Read by the DevTool via the trace channel, or by a downstream block as its input | In the item log (the request record) on a store that persists | One per block execution. Recorded up to 256 KiB serialised; larger is recorded as a placeholder with a 512-character preview. `apps/docs/docs/streaming/items.md:149-155` |
| User state | One user, inside one organisation (keyed by user and org; one record per flow copy with `isolateUserState`). `apps/docs/docs/fundamentals/state-and-scopes.md:25` | That user's blocks; only that user's views. `apps/docs/docs/fundamentals/state-and-scopes.md:465` | `primary` | One per user per organisation |
| Org state | The organisation. Keyed by org id; per flow copy with `isolateOrgState`. `apps/docs/docs/fundamentals/state-and-scopes.md:25` | Everyone in the organisation's blocks; the browser sees `client.expose` fields | `primary` | One per organisation |
| Resource | Declared on a block or flow at `session`, `user` or `org` scope; lives with that scope's owner. `apps/docs/docs/resources/overview.md:43` | By its `client` config | `primary` (content and resource state). `apps/docs/docs/persistence/overview.md:7`, `:37` | A named container; a collection is a family keyed by a pattern. `apps/docs/docs/glossary.md:53-54` |
| Request state | The one action run. `apps/docs/docs/fundamentals/state-and-scopes.md:472-479` | Blocks in that run; the next request cannot see it | Scratch for the run; not kept for the next request | One per request |
| A view's answer | Nobody; it is computed on each read from the data it reads (a session, or the caller's user or org). `core/types/view.ts:2-9`, `:29-33` | The caller who reads it; `user` and `org` views take identity from the verified principal, not the request. `core/types/view.ts:29-33` | **Not stored.** "a view adds no request, changes no row ... nothing is stored." `engine/test/session-views-store-nothing.test.ts:2-7`. The browser holds the last answer in React state (`useView` `value`). `react/hooks/useView.ts:13` | One shared read per view and input in a client, shared by every screen watching it. `react/hooks/useView.ts:7-11` |
| `WORKER.md` (a standard worker) | You; a file in your repo | Every user gets each standard worker. `apps/docs/docs/glossary.md:116` | Your repo, read at start-up; a user's edit makes that user's own copy under the same id (`packages/workforce/src/workers/client.ts:218-223`) | One file per standard worker; one copy per user who edits it |
| The unsent text in a message box | The browser's user | That browser | `localStorage` via `useDraft`. `react/hooks/useDraft.ts:2-12` | One per `namespace:id` |

## Answer key for the plan's four questions (facts only)

1. *Wrong answer from a worker: which layer first, which next?* The worker's file (`WORKER.md` body and frontmatter) first, because the body is its instructions on the built-in `agent` flow (`packages/workforce/README.md:40-43`). If the file is right or names its own `flow:`, the flow and then its blocks (`packages/workforce/README.md:60-66`; `fsdev run` shows each block's events, `apps/docs/docs/cli/agent-dev-loop.md:13-14`, `:50`).
2. *Kit / flow / block, one sentence each.* Kit: a feature an app installs with one config entry; it brings flows, a folder it reads, and slots (`core/kit/define-kit.ts:3-10`). Flow: the deployable unit, with actions, state and client visibility, served under its id (`apps/docs/guides/anatomy-of-a-flow.md:44`). Block: a typed unit of work, one of five kinds (`apps/docs/docs/glossary.md:41-42`).
3. *Stops a message makes before text comes back.* Page action call, POST to the action route, validation and session check, the action's root block (sequencer: generator, then tap), items streamed over SSE, state committed, page re-renders (list above, steps 1-9).
4. *Which outlive the request?* A session: yes (stored in `primary`; many requests share it, `apps/docs/docs/fundamentals/state-and-scopes.md:35`). A block's output: yes, as part of the recorded item log on a store that persists, but with the default in-memory store it goes when the process does (`engine/flowstate/types.ts:171-172`). A view's answer: no, computed per read, nothing stored (`engine/test/session-views-store-nothing.test.ts:2-7`).

## Limits a reader would assume otherwise (for linking to Reference, not for the page)

- A view cannot write and cannot call a model: a write is refused with `read_only` (409) and a generator or model call with `view_model_call` (422). `engine/test/views.test.ts:321-345`; `core/types/view.ts:4-6`
- Memory-only default: with `stores` omitted, restart loses sessions. `engine/flowstate/types.ts:171-172`
- A fresh `fsdev run` against a multi-instance or Postgres-backed app uses the app's config. `apps/docs/docs/cli/agent-dev-loop.md:33`

## Contradictions and doubts found (for the caller)

- **Edit of a standard worker.** `apps/docs/docs/glossary.md:116` says "Nobody can edit one. To change it for yourself, fork it." The code says the first edit of a standard worker copies it to the user's own roster under the same id (`packages/workforce/src/workers/client.ts:218-223`; `packages/workforce/test/worker-roster.test.ts:34-48` and `:137-143` show hire, fork and fire onto a standard id are refused, the standard is unchanged for everyone). The pilot (`docs/contributing/docs-revamp/pilot/workers.md`, "Whose worker it is") agrees with the code. The glossary line is stale. This page should not repeat either wording; if it mentions editing, use the code's.
- **`flows` as a record vs a list.** See "three things" above, item 3.
- **`useFlow`/`send`.** See "three things" above, item 2.
- **Anatomy guide, "ephemeral session".** `apps/docs/guides/anatomy-of-a-flow.md:74` says an action sent without a `sessionId` creates "an ephemeral one (or a persisted one, depending on flow config)". Not verified against code in this pass; left off the sheet. The page's example always sends with a session.
- **"The server is generated... one catch-all route in Next.js is enough"** (`apps/docs/guides/anatomy-of-a-flow.md:111`): confirmed by `hc-route` (one `[[...path]]` route, four methods).
- **Plan's figure "layer stack from S-1"** is not a source a fact sheet may cite. The layer order above comes from `apps/docs/docs/glossary.md:23` and `docs/contributing/docs-revamp/pilot/what-flow-state-is.md:21` (a draft page, cited for the starter / kits / flows / blocks / engine ordering only).
- **A "starter" is not a package.** Pilot calls the layer a starter (`pilot/what-flow-state-is.md:25-41`); nothing in code or published docs defines it. `apps/kitchen-sink` and `examples/hello-chat` exist as apps. Do not describe a starter as built on this page without the caller confirming.

## Store-questions gaps (not answerable from allowed sources)

- Whether a request's own **state** (request scope) is written to the store at all or lives only in the run: the docs say it lasts one action run and the next request cannot see it, and nothing more. The page can say that and no more.
- Who can see a **resource** is set by its `client` config; per-resource defaults belong to the Resources Reference page.

## Revise round 1 notes

- The page's `kits: [workforce({ directory })]` stays: the revamp README ("The pages are written for the release that carries kits") sanctions a specified-not-built surface. Type-checked against a declaration `workforce(options: { directory?: string; model?: string }): KitInstance` from `docs/architecture/kits.md`; whether `model` is required is an open reconciliation item at cutover.
- The page no longer states that a block's output is recorded with the items, the localStorage draft detail, the validation order, or resume by sequence number. Those are Reference rows (stores, client, HTTP API, streaming), linked from the page. Reference slugs (`http-api`, `streaming`, `views`) are provisional until those pages exist.
- The debugging paragraph follows Alice's path (`fsdev run`, then `help-desk`, `chatGenerator`, `incrementMessageCount`); the worker answer-key entry above is no longer on the page.

## Revise round 2 notes

- `workforce(...)` stays: the page's `fsdev.config.ts` type-checks against the declaration for the specified-not-built kit (see round 1); the standard allows that for an unbuilt surface. `flows: [helpDeskFlow]` needs a `FlowInstance` (`engine/flowstate/types.ts:124`), so the page says `helpDeskFlow` is the instance `flow.ts` default-exports (`hc-flow:95`, `hc-cfg:17-18`).
- A view is defined on the page as a read-only question a screen asks the server, computed per read and not stored (`core/types/view.ts:2-9`, `engine/test/session-views-store-nothing.test.ts:2-7`). The page holds the last answer in React state while the screen is open (`react/hooks/useView.ts:13`).
- `session.items` is defined at first use as the live item list (`apps/docs/docs/streaming/overview.md:19`).
- `fsdev run` prints one JSON line per event: `item_added`, `content_delta`, `state_change`, `flow_complete`, `error` (`apps/docs/docs/cli/agent-dev-loop.md:13-14`). The page names the first three in plain words.
- The two views links are different pages: `../reference/views.md` (when a view is read again) and `./views.md` (the concept).

## Revise round 3 notes

- Wording only: the page says `helpDeskFlow` is what `flow.ts` default-exports (a flow instance, `hc-flow:95`, `engine/flowstate/types.ts:124`), and the Block row says "one of five types", so neither line trips the retired-term check. The five-sort claim is unchanged (`core/types/block.ts:43`).
- `workforce(...)` still is not exported by `@flow-state-dev/workforce`; the page keeps it as the specified-not-built kit factory (revamp README, "Those kit factories are specified and not built"; user-docs.md allows a not-yet-built surface). Reconcile at cutover.

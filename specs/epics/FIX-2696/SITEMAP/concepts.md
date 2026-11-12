# Sitemap · Concepts

[Index](README.md) · [Start](start.md) · **Concepts** · [Catalog](catalog.md) · [Build](build.md) · [Reference](reference.md)

Twenty-three pages, type `concept`, read front to back. 1,500 words of prose at most; the target
beside each page is what the plan adds up from. All are written by **FIX-2701** through the
ten-pass loop, to the concept/reference contract (D6): the model, why it is built this way, what
the reader gets, how it fits with the others, shown in figures and short examples. Detail goes
to the Reference page named in each entry.

Every page follows the brief's concept outline: opening · the model in a figure · the smallest
example · two to five sections · What it gets you · How it fits with the others · Next. The
contents lines below name the sections in between. "If you know …" is listed where a page has one.

**One cast for the model.** C-02 to C-11 share a support desk: a `support` flow that cleans a
customer's message, drafts a reply, and can look up an order. The reader meets the same names from
page to page. C-12 onward use the cast named in each entry.

| Group | Pages |
| --- | --- |
| The map | C-01 |
| The model | C-02 to C-12 |
| Running it | C-13 to C-20 |
| Getting work done | C-21 to C-23 |

---

## The map

### C-01 · How it fits together

`concepts/how-it-fits-together` · concept · 800 words

**Job.** The map of the book: each layer in a paragraph, and which page teaches it.

**Contents.** (opening) · An app, from the top · What happens when you send a message · Where things are kept · Which page to read for what · Next

**After reading, the reader can answer**
1. A worker gives a wrong answer. Which layer do you open first, and which next if that is not it?
2. In one sentence each: what is a kit, a flow, a block?
3. A message goes in. Name the stops it makes before text comes back.
4. Which of these outlive the request: a block's output, a session, a view's answer?

**Figures**
- *One message, top to bottom*. The layer stack from S-1 with one request threaded through it: page → action → blocks → items back. Adds motion to the static stack. Marks: layer boxes, arrow (`CALLS · STREAMS BACK`), dashed outline on the action run, hatching on the session.
- *Where things are kept*. Four columns: in your repo, in the process, in your store, in the browser. Adds the answer to "where does this live" for every noun in the book. Marks: columns, hatching on the store column, highlighter on the session.

**Examples**
- The app in one file: `createFlowState({ kits, flows, stores })`.
- One action called from a page: `useFlow`, `send`.

**Links to, does not explain.** Everything. Each layer's paragraph ends in its page; `reference/glossary` for the words.

**Sources.** `guides/anatomy-of-a-flow` (merge) · `fundamentals/overview` (merge) · `ecosystem/overview` (the layering only).

---

## The model

### C-02 · Blocks

`concepts/blocks` · concept · 900 words · drafted ([`pages/blocks.md`](../../../../docs/contributing/docs-revamp/pages/blocks.md))

**Job.** A block is one typed step, and there are five kinds.

**Contents.** The smallest flow · The five kinds · Blocks inside blocks · Giving a block to a model · What a block gets you · How it fits with the others

**After reading, the reader can answer**
1. You need to call your own API in the middle of a flow. Which kind of block?
2. A run dies after `cleanMessage`. On a store that persists, what runs again?
3. Can a sequencer be a tool? What does the model see?
4. What does a block declare so the next block can trust what it gets?

**Figures**
- *One block* (drawn: `pages/figures/blocks.svg`, to be redrawn). Input, the block, output, with the schema on each side. Adds the contract as a shape. Marks: arrow (`TYPED INPUT · TYPED OUTPUT`), highlighter on the output schema.
- *The five kinds, by who decides*. A row from "your code decides" to "the model decides": handler, sequencer, router, evaluator, generator. Adds the one axis that tells the kinds apart. Marks: columns, highlighter on the axis label.

**Examples**
- A handler: `handler({ inputSchema, outputSchema, execute })`.
- A generator: `generator({ model, prompt })`.
- Two blocks chained: `sequencer().step()`.
- A block as a tool: `generator({ tools: [lookUpOrder] })`.

**Links to, does not explain.** Every option → `reference/blocks`. Retries and replay → `reference/durable-execution`. Type helpers → `reference/type-helpers`.

**Sources.** `fundamentals/blocks` (rewrite to its opening and the five kinds) · `fundamentals/type-system` (the contract idea).

**To bring to the contract.** Drop "What a block needs" and "What a block won't do"; move their limits to `reference/blocks`.

### C-03 · Generators and tools

`concepts/generators-and-tools` · concept · 1,000 words

**Job.** There is no `agent()`: an agent is a generator with tools, and you choose how much the model decides.

**Contents.** If you know agents · A generator with a tool · The loop the generator runs · From fixed steps to free choice · What the model is told: prompt and context · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. Where is the agent loop, and who wrote it?
2. You want the model to choose between two tools but never skip the final check. How do you build that?
3. What is the difference between a tool and a block?
4. The model needs the customer's plan in its prompt. Where does that come from?

**Figures**
- *The generator's loop*. The model, a tool call out to `lookUpOrder`, the result back, repeat, then the answer. Adds the loop the reader never writes. Marks: arrow (`CALLS · RETURNS`), dashed outline on the whole loop, highlighter on "the model picks the next call".
- *The spectrum*. Three versions of the support reply side by side: fixed pipeline, pipeline as one tool, free tool choice. Adds the choice the page is about. Marks: columns, highlighter on the middle one.

**Examples**
- A tool is a block: `handler` passed in `tools`.
- A pipeline as one tool: `sequencer` in `tools`.
- A typed answer: `generator({ outputSchema })`.
- Context for the prompt: the `context` slot.

**Links to, does not explain.** Generator options, tool-loop limits, context formatters → `reference/generators`. Prompt files → B-22. Model choice → C-18.

**Sources.** `guides/building-agents` (promote; keep the opening) · `advanced/generator-context` (the idea; the rest to Reference).

### C-04 · Composition

`concepts/composition` · concept · 1,000 words

**Job.** How blocks join: in sequence, by choice, side by side, and what passes between them.

**Contents.** A sequence · Output flows forward · A choice: routers · Side by side: parallel steps · Work that does not block the answer · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. Step two needs step one's output in a different shape. Where does the reshaping go?
2. Three lookups can run at once. What does the next step receive?
3. You want to log after the reply without delaying it. Which step?
4. Is a sequencer a block? What follows from that?

**Figures**
- *What passes between steps*. `handleTicket` as a row of steps, each arrow labelled with the type it carries. Adds the data, where a flowchart shows only order. Marks: arrow (`PASSES ITS OUTPUT`), highlighter on the one reshaping step.
- *Four ways to join*. Sequence, router, parallel, side chain as four small drawings on one canvas. Adds a visual index of the DSL. Marks: columns, arrow, dashed arrow on the side chain (`ONLY ALONGSIDE; NOTHING WAITS`).

**Examples**
- A sequence: `.step()`.
- Reshape between steps: `.map()`.
- A choice: `router`.
- Fan out: `.parallel()`.
- A side chain: `.sideChain()`.

**Links to, does not explain.** Every method and its conditional variants → `reference/sequencer-methods`. Waiting on a condition → same page. Utility blocks → `reference/utility-blocks`.

**Sources.** `sequencers/overview` (rewrite; keep the opening) · `sequencers/composing-blocks` (keep) · `advanced/sequencer-side-chains` (the idea).

### C-05 · Flows and actions

`concepts/flows-and-actions` · concept · 900 words

**Job.** A flow is a backend with a name; its actions are what a client can call.

**Contents.** A flow with one action · What an action is · Calling it · One definition, many conversations · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. What does a client name when it calls your backend: a block, an action, or a flow?
2. Two users call `reply` at once. What do they share and what is separate?
3. You add a second action. What changes for the client?
4. Can you run an action with no server?

**Figures**
- *Definition, running flow, session*. Your code on the left, the registered flow in the process, sessions in the store. Adds the three things people call "the flow". Marks: columns, arrow (`BECOMES · OWNS`), hatching on sessions, highlighter on the action name.

**Examples**
- Define it: `defineFlow({ kind, actions })`.
- Call it from code: `createClient`, `flow(kind).send(action, input)`.
- Run it from a terminal: `fsdev run`.
- Typed input on the client: the action's `inputSchema`.

**Links to, does not explain.** Every `defineFlow` field, several running copies of one flow, lifecycle hooks → `reference/flows`. Endpoints → `reference/http-api`.

**Sources.** `fundamentals/flows`, `fundamentals/actions` (rewrite as one) · `advanced/manual-flow-execution` (one line; the task is B-28).

### C-06 · Sessions, items and streaming

`concepts/sessions-items-and-streaming` · concept · 1,000 words

**Job.** A session is one conversation; everything that happens in it is an item; items stream.

**Contents.** One reply, as it arrives · What an item is · The items you will meet · A session keeps them · Emitting your own · If the connection drops · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. The model is halfway through a sentence. What has the browser received so far?
2. You reload the page mid-answer. What do you see?
3. Your handler wants to show a progress card. What does it do?
4. Which items does the next request's model see?

**Figures**
- *One request as a timeline*. Items in order along a line: the user's message, a tool call, text arriving in pieces, done. Adds time, which code cannot show. Marks: arrow (`THEN`), dashed outline on the request, hatching on the session's list below it, highlighter on the growing text item.
- *Dropped and resumed*. The same timeline with a gap, and the stream picking up at the next sequence number. Adds why a reload loses nothing. Marks: red on the dropped connection (`CONNECTION LOST`), arrow.

**Examples**
- Read the stream on a page: `useSession`.
- Emit a component item: `ctx.emit.component`.
- Read it from a terminal: `fsdev run` output, three lines.

**Links to, does not explain.** Every item type, visibility, the wire format, resume and heartbeat → `reference/items`. Rendering items → C-10.

**Sources.** `streaming/overview`, `streaming/emitting-items` (keep, trim) · `server/connection-resilience` (the guarantee) · `streaming/trace-channel` (to Reference).

### C-07 · State and scopes

`concepts/state-and-scopes` · concept · 1,100 words

**Job.** Four places to keep typed state, told apart by how long each lasts and who shares it.

**Contents.** The four scopes · Session first · State a user carries between conversations · State an organization shares · What the browser may see · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. The customer's plan should follow them into every conversation. Which scope?
2. A second request arrives. Can it read what the first put in request state?
3. Two users in one organization: what do they share?
4. A field holds an internal score. How do you keep it from the browser?

**Figures**
- *The four scopes* (redraw of the published `state-scopes.svg` with the support cast). Four separate records side by side, each with what keys it. Adds that none sits inside another. Marks: columns, dashed outline on request, hatching on session, user and org, arrow (`NAMES`).
- *Who sees what*. Alice and Bob in one organization: two sessions each, one user record each, one org record. Adds sharing, which the first figure does not show. Marks: box in a box, hatching, highlighter on the shared org record.

**Examples**
- Declare session state: a schema on the flow.
- Read and write it: `ctx.session.state`.
- User and org state: `ctx.user`, `ctx.org`.
- Expose a field to the browser: the `client` block.

**Links to, does not explain.** Every state operation and what it returns → `reference/state-operations`. Block and sequencer state → `reference/blocks`. Isolation settings → `reference/flows`. Tenancy → C-17.

**Sources.** `fundamentals/state-and-scopes` (rewrite to about 1,000) · `fundamentals/state-operations`, `state/mutation-model` (to Reference) · `advanced/block-state`, `sequencer-state`, `state-targets-and-parents` (to Reference).

### C-08 · Resources

`concepts/resources` · concept · 1,000 words

**Job.** A resource is named, stored data a block declares: a document, a record, or a collection of them.

**Contents.** A resource a block declares · State or a resource? · Collections · Who can read it: the model, your code, the browser · It travels with the block · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. The refund policy is one document every reply should respect. State or a resource, and at which scope?
2. You drop `draftReply` into another flow. What comes with it?
3. Ticket notes pile up. What do you use, and how does a block add one?
4. Does a resource load when nothing declares it?

**Figures**
- *State and resources* (redraw of the published `state-vs-resources.svg`). The session's state beside the resources it can reach. Adds the line between "fields on a record" and "named data with content". Marks: columns, hatching on both, dashed arrow (`ONLY WHEN EXPOSED`) to the browser.
- *A resource travels with its block*. `draftReply` carrying its `refundPolicy` declaration into two flows. Adds portability. Marks: box in a box, arrow (`INSTALLS`), highlighter on the declaration.

**Examples**
- Define one: `defineResource`.
- Declare it on a block: the block's `resources` map.
- A collection: `defineResourceCollection`, `create`.
- Read it in a block: `ctx.resources`.

**Links to, does not explain.** Fields, storage, identity, collections, the manifest, HTTP and hook access → `reference/resources`. Search, edges, reactive blocks → B-34 to B-37.

**Sources.** `resources/overview`, `resources/storage` (rewrite as one) · `resources/collections` (concept half) · `resources/client-access`, `resources/manifest` (to Reference).

### C-09 · Views

`concepts/views` · concept · 900 words

**Job.** A view is what a screen reads: an answer computed when asked, and read again when what it depends on changes.

**Contents.** If you know queries · A list on a screen · Declaring the view · Reading it · When it updates · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. Where is a view's answer stored?
2. A worker starts waiting for you. What makes the badge appear?
3. Whose rows does a user-scoped view return for Alice?
4. View or resource: a list of open tickets with a count?

**Figures**
- *A screen asks, a view answers*. The sidebar on the left, the `roster` view in the middle, the stored data it reads on the right. Adds that the view sits between and stores nothing. Marks: columns, arrow (`ASKS · READS`), hatching on the data, dashed outline on the view's answer, highlighter on the view.
- *What makes it refresh*. A write lands in the data; the view is asked again; the row changes. Adds the update path as three steps. Marks: arrow (`THEN`), highlighter on the changed row.

**Examples**
- Declare it: `defineView({ scope, key, block })`.
- Install it: `defineFlow({ views })`.
- Read it: `useView`.

**Links to, does not explain.** Options, scopes, row keys, refusals → `reference/views`. Views a kit serves → K-05.

**Sources.** `packages/core/src/flow/defineView.ts` doc comments and tests · `goals/views/` · `workforce/ui` (the roster as the worked example).

**Cast.** The Workforce roster sidebar, per the audit's proposal; the support desk does not reach this page.

### C-10 · What the browser sees

`concepts/what-the-browser-sees` · concept · 1,000 words

**Job.** The client is a thin, typed window: it calls actions, follows a session's stream and reads what the server exposes.

**Contents.** A page that talks to a flow · Three things a page does · Rendering items · What the browser never gets · Without React · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. Which three things can a page do with a flow?
2. A field is in session state but not on the page. Why?
3. An item type has no renderer. What does the reader see, and where do you add one?
4. You are not using React. What do you import?

**Figures**
- *The window*. The server's session on the right, the page on the left, and a wall between them with three openings: call, follow, read. Adds the boundary. Marks: columns, arrow (`CALLS`, `FOLLOWS`, `READS`), hatching on the session, red on what cannot cross (`NOT EXPOSED`).

**Examples**
- Wrap the app: `FlowProvider`.
- Follow a session: `useSession`.
- Call an action: `useAction`.
- Render an item type: the renderer map.
- Plain client: `createClient`.

**Links to, does not explain.** Every hook → generated `@flow-state-dev/react`. Client options → `reference/client`. Components → `reference/ui-components` and K-40.

**Sources.** `client/overview` (keep, trim) · `client/react` (rewrite; hook tables to Reference) · `configuration/client` (to Reference).

### C-11 · Capabilities

`concepts/capabilities` · concept · 900 words

**Job.** A capability bundles the tools, context and resources for one ability, so a block gets all of it with one line.

**Contents.** One line instead of three · What a capability carries · Turning parts off · A capability that takes config · Capability or kit? · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. `draftReply` needs order lookup: a tool, a prompt section and a resource. How many places do you edit?
2. One block should get the context but not the tools. How?
3. Where must a capability's resources be declared?
4. You want to ship a whole feature with screens. Capability or kit?

**Figures**
- *What `uses` installs*. One capability box holding three parts, and a block that names it receiving all three. Adds the bundle as a shape. Marks: box in a box, arrow (`INSTALLS`), highlighter on `uses: [orders]`.
- *Capability and kit, side by side*. A capability attaches to a block; a kit installs into an app. Adds the answer to "which do I reach for". Marks: columns, arrow.

**Examples**
- Define one: `defineCapability`.
- Use it: `uses: [orders]`.
- Turn a part off: `orders.presets({ tools: false })`.
- A factory: `createOrdersCapability(options)`.

**Links to, does not explain.** Presets, open config, dynamic `uses`, type inference → `reference/capabilities`. Writing one step by step → B-32.

**Sources.** `fundamentals/capabilities` (keep; later in the order) · `advanced/capabilities-authoring` (to B-32 and Reference).

### C-12 · Kits and slots

`concepts/kits-and-slots` · concept · 1,100 words

**Job.** A kit is a feature an app installs in one line; a slot is an opening a kit leaves for others to fill.

**Contents.** If you know plugins · Three kits in a config file · What a kit brings · A slot · A kit that fills one can open another · Filling a slot from your app · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. How does the harnesses kit add a worker type to a kit that has never heard of it?
2. Does the order of the `kits` list matter?
3. You want Codex beside Claude Code. Whose slot do you fill, and where?
4. What does a kit bring besides flows?
5. Kit, capability or flow: you are packaging a feature for other apps.

**Figures**
- *The chain*. `workforce` opens a slot, `harnesses` fills it and opens its own, `claudeCode` fills that. Adds the one idea that makes an app remixable. This is the figure the audit asked to be the best on the site. Marks: columns, arrow (`FILLS A SLOT`), highlighter on the slot that is both filled and opened from.
- *What a kit brings into an app*. One kit box with its flows, the folder it reads and its views, set into the app. Adds the contents of "one line". Marks: box in a box, hatching on the data its views read.
- *Your app fills a slot too*. The app's own `fill` entry beside a kit's contribution. Adds that slots are not only for kits. Marks: arrow, highlighter on the app's entry.

**Examples**
- Install three kits: `createFlowState({ kits })`.
- Fill a slot from the app: `fill`.
- A small kit: `defineKit({ name, slots, install })`.
- Contribute to another kit: `requires`, `contributes`.

**Links to, does not explain.** `defineKit` options, slot kinds, startup refusals, the folder read → `reference/kits`. Writing one → B-04.

**Sources.** The exported `defineKit` surface, its doc comments and tests · `goals/kits/install-in-any-order/`. No user page exists today.

**Unsettled.** `defineKit` is merged and unreleased; `workforce()`, `harnesses()` and `claudeCode()` are specified and not built (FIX-2627). Config keys reconcile at FIX-2705. If the model is contested when the page is written, this is the page D4 keeps `concept-doc` for.

---

## Running it

### C-13 · Serving flows

`concepts/serving-flows` · concept · 900 words · cast: the support desk

**Job.** One config object turns flows into an HTTP service, and there is more than one way in.

**Contents.** One object · What it serves · Where it runs · Other ways in: webhooks, schedules, MCP, voice · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. What do you pass to make three flows callable?
2. Stripe needs to start a flow. Is that an action call?
3. Next.js or a plain Node process: what changes in your flows?
4. Where do stores and models get set?

**Figures**
- *Ways in*. One running app in the middle; around it a page, a webhook, a schedule, an MCP client and a terminal, each arriving at an action. Adds that every door ends at the same place. Marks: arrow (`STARTS AN ACTION`), highlighter on the action.

**Examples**
- The object: `createFlowState({ flows, stores, models })`.
- The Node host in one call: `@flow-state-dev/node`.
- A webhook binding in three lines: `defineWebhookBinding`.

**Links to, does not explain.** The Next.js route → S-5. Every option → `reference/runtime`. Endpoints → `reference/http-api`. Webhooks, schedules, MCP → `reference/webhooks`, `reference/schedules`, `reference/mcp-server` and the recipes.

**Sources.** `server/setup` (rewrite as the one page) · `server/host-adapters` (keep) · `server/webhooks`, `server/scheduled`, `server/mcp`, `advanced/inbound-transports` (one paragraph each; the rest to Reference) · `guides/keeping-a-flow-running` (the "starts without a person" half).

### C-14 · Persistence

`concepts/persistence` · concept · 1,000 words

**Job.** What is stored, where, and how to choose a store.

**Contents.** What gets stored · Memory, SQLite, Postgres · Choosing · Who owns a record · What a restart keeps · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. You restart the dev server on the default store. What is gone?
2. One machine, one file, survives restarts. Which store?
3. Which record does a user's state belong to, and what keys it?
4. Does changing the store change your flows?

**Figures**
- *What a restart keeps*. Three columns, one per store, each listing sessions, state, resources, paused runs, with what survives. Adds the choice as a picture. Marks: columns, hatching on SQLite and Postgres, dashed outline on memory, highlighter on "paused runs".

**Examples**
- The default: nothing to write.
- SQLite: `@flow-state-dev/store-sqlite` in `stores`.
- Postgres: `@flow-state-dev/store-postgres` in `stores`.

**Links to, does not explain.** What a store must guarantee, custom stores, lookups by metadata → `reference/stores`. Moving data → B-31. Tenant isolation → C-17.

**Sources.** `persistence/overview` (split: the chooser of about 1,200, with the missing SQLite section).

### C-15 · Pausing, resuming and surviving a crash

`concepts/pausing-resuming-and-surviving-a-crash` · concept · 1,200 words

**Job.** A run can stop for a person or die with the process, and pick up where it stopped.

**Contents.** A reply that needs approval · Pausing · Resuming · What does not run twice · A crash is the same shape · Two requests at once · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. A refund over $100 waits for a manager. Where is the run while it waits?
2. The manager approves a day later, after a deploy. What runs?
3. The process dies after `lookUpOrder`. Is the order looked up again?
4. What do you need set up for any of this to survive a restart?

**Figures**
- *A run that stops and starts*. The support run as a timeline in two halves with a wait between: finished blocks, the pause, the resume. Adds what is stored during the wait. Marks: arrow (`THEN`), dashed outline on each half, hatching on the recorded outputs and the pause, highlighter on "picks up here".
- *Crash and approval, same shape*. The two cases one above the other. Adds that one mechanism covers both. Marks: red on the crash (`PROCESS DIED`), hatching.

**Examples**
- Pause for a person: `ctx.suspend()`.
- Show what is waiting: `useSuspensions`.
- Approve: `useApproval`.
- Turn on a store that persists: `stores`.

**Links to, does not explain.** What `suspend` returns, replay rules, idempotency keys, retention, suspending in generators and routers → `reference/durable-execution`. Two requests on one session → `reference/concurrency`. The full approval build → B-03.

**Sources.** `advanced/durable-execution` (rewrite to about 1,500) · `advanced/block-memoization-and-replay`, `advanced/idempotency`, `server/connection-resilience` (merge) · `advanced/concurrency-policies` (one section; the rest to Reference).

### C-16 · Background work

`concepts/background-work` · concept · 1,100 words

**Job.** Three ways to do work outside the reply, chosen by one question: what still has to be alive when it finishes.

**Contents.** If you know job queues · The one question · Alongside the reply: side chains · The same request, somewhere else: queued runs · In a session of its own: dispatch · Starting without a person · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. Summarise the conversation after replying; losing it on a crash is fine. Which one?
2. A report takes ten minutes and the user closes the tab. Which one?
3. Is a task board a background queue?
4. Something runs every morning with no user. What starts it?

**Figures**
- *What each one outlives*. Three rows, each a bar against the same timeline: the reply, the request, the process. Adds the comparison the "one question" asks for. Marks: dashed outline on what lasts one action run, hatching on what outlives the request, highlighter on the question.

**Examples**
- A side chain: `.sideChain()`.
- A queued action run: the action's background setting.
- Dispatch into its own session: the dispatch call.

**Links to, does not explain.** Options, delivery and failure rows → `reference/background-work`. BullMQ → B-19. Schedules → B-15 to B-18. Boards → C-21.

**Sources.** `guides/background-work` (promote) · `guides/keeping-a-flow-running` (merge) · `server/background-work` (to Reference).

**Unsettled.** The exact option names for queued runs and dispatch come from the fact sheet.

### C-17 · Auth and tenancy

`concepts/auth-and-tenancy` · concept · 1,100 words

**Job.** Who a request is from, which organization it runs in, and what keeps one customer's data from another's.

**Contents.** Who is responsible for what · Every request has a user and an organization · Telling the framework who is calling · What the framework checks · Tenants · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. Does Flow State log users in?
2. A client sends another user's id in the body. What stops it?
3. Alice asks for Bob's session by id. What happens?
4. Two customers on one deployment: what separates their sessions?

**Figures**
- *Whose job is what*. Your auth on the left, the resolver in the middle, the framework's checks on the right. Adds the line of responsibility. Marks: columns, arrow (`TELLS`), red on the refused request (`REFUSED`), highlighter on the resolver.
- *Organizations, users, tenants*. Nested boxes showing what each boundary splits. Adds the three words in one picture. Marks: box in a box, hatching.

**Examples**
- Require a user: `requireUser: true`.
- A resolver from your session cookie: the resolver hook.
- A shared-secret resolver for server callers: `createBearerSecretPrincipalResolver`.

**Links to, does not explain.** Resolution order, the session consistency check, cross-flow rules → `reference/authentication`. Isolation flags → `reference/flows`.

**Sources.** `server/authentication` (rewrite; keep the first 1,200) · `fundamentals/state-and-scopes` (session creation and tenancy, split out) · `advanced/flow-isolation` (the idea).

### C-18 · Models

`concepts/models` · concept · 900 words

**Job.** A model is a string; you can name a purpose instead, and fall back when one fails.

**Contents.** A model string · Naming the job, not the model · When a model fails · Letting the user choose · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. What do you write to use a small, fast model?
2. You want to swap the cheap model everywhere without touching blocks. How?
3. The first model is down. What happens to the request?
4. Where do provider keys go?

**Figures**
- *From a block to a provider*. A generator names a purpose; the app maps it to a model string; the string resolves to a provider, with a fallback beside it. Adds the two indirections. Marks: arrow (`RESOLVES TO`), dashed arrow (`ONLY IF THE FIRST FAILS`), highlighter on the mapping.

**Examples**
- A string: `model: "openai/gpt-6-luna"`.
- A purpose: an intent name on the generator.
- A fallback: an array of strings.
- The mapping: `models` in `createFlowState`.

**Links to, does not explain.** String format, intents, gateways, retry, caching, reasoning settings, custom resolvers → `reference/models`. Keys → `reference/environment`.

**Sources.** `fundamentals/models` (short concept page; cut migration, SDK-version and roadmap notes) · `getting-started/setting-up-models` (the rest) · `advanced/custom-model-resolver` (to Reference).

### C-19 · When something fails

`concepts/when-something-fails` · concept · 800 words

**Job.** What happens to an error in a block, what the user sees, and where you catch it.

**Contents.** A block throws · What the caller sees · Catching it in the flow · Hearing about it · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. `lookUpOrder` throws. Does the user see a stack trace?
2. You want a fallback reply when the model fails. Where does it go?
3. How do errors reach your error tracker?
4. Is the failed run's history kept?

**Figures**
- *The path of an error*. From the block that threw, up through the sequencer, to the item the caller sees and the hook you listen on. Adds the two exits. Marks: arrow, red on the throw and the error item (`FAILED`), highlighter on the hook.

**Examples**
- A fallback step: the sequencer's error handling.
- A lifecycle hook: `onErrored`.
- What the client receives: the error item.

**Links to, does not explain.** Error shapes and codes, capture settings → `reference/errors`. Sentry → B-20. Retries → `reference/durable-execution`.

**Sources.** `advanced/error-handling`, `advanced/error-capture` (merge into one).

### C-20 · Testing

`concepts/testing` · concept · 900 words

**Job.** A flow is typed blocks, so you test it without a server or a model.

**Contents.** A test with no model · Standing in for a generator · Asserting on items and state · Checking the model's work: evals · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. How do you test `handleTicket` without calling a provider?
2. What do you assert on: text, items, or state?
3. You want to know the reply quality did not drop. Test or eval?
4. Does a flow test need a database?

**Figures**
- *What is real in a test*. The flow's blocks drawn as in C-04, with the generator swapped for a stand-in and everything else unchanged. Adds what is and is not faked. Marks: arrow, highlighter on the stand-in.

**Examples**
- Test a flow: `testFlow`.
- Test one block: `testBlock`.
- A generator stand-in: the mock generator.
- Seed state: the harness's seed option.

**Links to, does not explain.** Every harness option → generated `@flow-state-dev/testing`. Benchmarks → B-33.

**Sources.** `testing/overview`, `testing/testing-flows` (merge) · `guides/building-a-chat-app` (the tests step, shared with B-01).

---

## Getting work done

### C-21 · Tasks and boards

`concepts/tasks-and-boards` · concept · 1,100 words · piloted ([`pilot/tasks-and-boards.md`](../../../../docs/contributing/docs-revamp/pilot/tasks-and-boards.md)) · cast: three competitors and a comparison

**Job.** A board is a stored list of tasks and the loop that works through it, in dependency order.

**Contents.** The smallest board · What a task carries · When a task fails · How long the list lasts · Who does the work · Start with a pattern · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. `initech` fails. What happens to `compare`, and what does the flow learn?
2. The request ends with two tasks pending. Who runs them, and when?
3. You want tasks to survive between requests. What do you change?
4. Board or background queue: a nightly job?

**Figures**
- *A board is a list and a loop* (drawn: `pilot/figures/board.svg`). Adds what is left when the request ends. Marks: hatching on the list, dashed outline on the drain, arrow, highlighter on the waiting task.
- *Ready, running, done*. The four tasks as a small dependency graph at three moments. Adds order over time, which the list hides. Marks: arrow (`WAITS ON`), red on a failed task (`FAILED · CANCELS WHAT WAITS ON IT`).

**Examples**
- A board: `taskBoard({ workers, initialTasks })`.
- Run it: `board.drain` as an action.
- Keep the list: store the tasks on a session resource.
- Read what the dependencies produced: `input.deps`.

**Links to, does not explain.** Every option, status and stop reason → `reference/task-board`. The task record and claim rules → `reference/task-collections`. Patterns → K-19 to K-28.

**Sources.** `orchestration/task-board` (rewrite to about 2,500 at most; cut Migrating) · `guides/board-lifecycle` (merge) · `orchestration/overview` (keep the opening) · `orchestration/agents` (merge).

**To bring to the contract.** Move the stop-reason and retry detail to Reference; replace "What a board won't do" with the outline's last two sections; make the example store its list on a resource from "How long the list lasts" on, as the figure shows.

### C-22 · Workers

`concepts/workers` · concept · 1,000 words · piloted ([`pilot/workers.md`](../../../../docs/contributing/docs-revamp/pilot/workers.md)) · cast: `engineering.lead`, Alice and Bob

**Job.** A worker is a named agent you brief in a Markdown file, then talk to or hand tasks.

**Contents.** If you know agents · The file · Install the roster · Talk to one · Hand one a task · Whose worker it is · What runs a worker · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. Alice edits the lead from inside the app. What does Bob see? What happens to the file?
2. The lead is asked to write code. What does it do?
3. A worker needs fixed steps and a review. What do you change, and what stays a document?
4. Where do a worker's tasks show up for a page to render?

**Figures**
- *One file, a worker on each user's roster* (drawn: `pilot/figures/worker.svg`). Adds the copy per user. Marks: columns, hatching, arrow, highlighter on one user's worker.
- *Standard, edited, forked, hired*. One roster with four workers and where each came from. Adds the ownership rules as a picture. Marks: arrow (`MADE FROM`), hatching, highlighter on the edited copy.

**Examples**
- The file: `WORKER.md`.
- Install: `workforce({ directory })`.
- Talk: `createWorkforceClient`, `ensureWorkerSession`.
- A worker on your own flow: `flow:` in the file.

**Links to, does not explain.** Every setting → `reference/worker-md`. Refusals, hiring options → `reference/workforce`. Coordinators, delegation, messaging → K-06 to K-08.

**Sources.** `workforce/overview` (rewrite) · `workforce/workers-on-disk` (the model) · `workforce/durable-hire` (ownership).

**To bring to the contract.** Move the refusal sentences to Reference; replace "What a worker won't do".

### C-23 · Coding harnesses

`concepts/coding-harnesses` · concept · 900 words · cast: `engineering.coder` fixing a failing test

**Job.** A coding harness is a coding agent run as one block, in its own checkout, with a verdict before its work counts.

**Contents.** If you know coding agents · A coding agent as a block · Its own checkout · A verdict before it counts · Asking you a question · Choosing a harness · What it gets you · How it fits with the others

**After reading, the reader can answer**
1. Where does the harness make its changes, and can it touch your working tree?
2. The run says it is done. What has to be true before the task is marked complete?
3. The agent needs a decision from you mid-run. How does it reach you?
4. You switch from Claude Code to Codex. What changes in your flow?

**Figures**
- *A supervised run*. The task, the checkout, the harness working in it, the verdict, then the result recorded. Adds the gate between "the agent stopped" and "the task is done". Marks: arrow (`THEN`), dashed outline on the harness run, hatching on the task and its record, highlighter on the verdict.
- *The harness is a slot*. One run shape with Claude Code, Codex and Cursor as interchangeable fills. Adds that the choice is one line. Marks: columns, arrow (`FILLS A SLOT`).

**Examples**
- Install: `harnesses({ workspace })`.
- Pick an agent: `claudeCode()` in `kits`.
- Hand a worker a coding task: the delegate in `WORKER.md`.

**Links to, does not explain.** Run states, the verdict contract, the question channel, workspace options → `reference/harness-runs`. Each agent's setup → K-15 to K-17.

**Sources.** `tools/coding-agents` (rewrite to about 1,000) · `orchestration/harness-manager` (the model only) · `workforce/projects` (the coding half).

**Unsettled.** The kit factories and `workspace` keys (FIX-2627). Whether Codex and Cursor arrive as kits or as fills of the harnesses slot.

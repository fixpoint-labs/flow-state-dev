# Fact sheet: Glossary (R-39, reference, `reference/glossary`)

Pass 1. Cites only: the existing glossary pages (`apps/docs/docs/glossary.md`, "OLD" below; its revamp
copy `docs/contributing/docs-revamp/pages/reference/glossary.md` differs only in frontmatter), the
vocabulary source the sitemap names (`docs/contributing/glossary.mjs`, "G" below, a contributor file,
not a spec), exported surface and doc comments, and tests. No spec was read. Paths: `core/` is
`packages/core/src/`, `client/` is `packages/client/src/`, `wf/` is `packages/workforce/src/`,
`orch/` is `packages/orchestration/src/`, `engine/` is `packages/engine/src/`,
`hm/` is `packages/harness-manager/src/`.

Page shape from the sitemap: generated from `glossary.mjs`, grouped by layer (app, kit, flow, block,
engine). Lookup: "What does 'worker' mean here?". Reference type, no word budget, tables only.

## 0. Findings the writer must act on before drafting

| # | Finding | Source |
|---|---------|--------|
| 0.1 | **G has no layer field.** An entry has only `term`, `means`, `decision`, `names?`, `retires`, `published?`. The page cannot be generated "grouped by layer" from G as it stands: the five groups (app, kit, flow, block, engine) must be assigned by hand (proposal in section 3) or a `layer` key added to G. | `glossary.mjs:115-1626` (all entries); keys seen: `term, means, decision, names, retires, published` |
| 0.2 | G holds 45 entries. Only 16 carry `published: true`: Hand-off, User, Worker, Assignee, Worker flow, Standard worker, Fork, Roster, Coordinator, Delegate, Delegation, Door, Project, Workstream, Project coordinator, Shift Coordinator. The header says "the published glossary page defines every entry flagged `published: true`". The other 29 are contributor vocabulary (naming rules). | `glossary.mjs:18`, `:112`, `:1576` (`PUBLISHED_TERMS`) |
| 0.3 | G's `means` strings are naming rules for contributors, not definitions for a reader. Examples: Status = "A lifecycle enum (`WorktreeStatus`), with no `…Type` suffix"; State = "Scope state or resource state, and nothing else"; Session factory = "What `defineSessionBoard` builds. Never a kit". These cannot be published as written. The writer takes the reader-facing ones (section 2, marked **R**) and treats the rest as not-for-page (**C**). | `glossary.mjs:154`, `:160`, `:412` |
| 0.4 | G's `decision` fields name issue ids and owner decisions. None goes on the page. | `glossary.mjs` (every entry) |
| 0.5 | OLD defines 76 terms in package-grouped tables with a "Built from" column. 26 of them match a G term. Terms in G but not on OLD: Status, Dispatch, Dispatcher, Flow runner, Hold, Routed task, Message budget, Split, Session factory, Follow-up, Message, claimsUnassigned, View, Kit, Slot, Harness, Live read, Direct read, Default write flow, Routine, Topic. OLD has no entry for **Kit**, **Slot**, **View**, **Routine**, **Topic** or **Harness**, all reader-facing (section 2). | `apps/docs/docs/glossary.md` table rows; G term list |
| 0.6 | OLD's grouping is by package (Contracts and Core, Engine, Orchestration, Smaller packages, Workforce, Shift Manager). The sitemap asks for five groups (app, kit, flow, block, engine). The two schemes do not map one-to-one (section 3). | OLD headings; `specs/` not cited; sitemap line is in the brief |
| 0.7 | OLD "Words that mean two things": **Worker** (Workforce: a configuration one user owns; task board: a block that runs a task), **Kind** (flow `kind`), **Roster** (Workforce roster vs Shift Manager screen). This answers the sitemap lookup "What does 'worker' mean here?" and carries to the new page. | OLD "Words that mean two things" |
| 0.8 | G entry for Worker says the word "seat" is retired for it. Page prose must say "worker", never "seat". Also: "user" not "person", "worker" not "member" for someone on a team. | `glossary.mjs:484-490`; `docs/contributing/user-docs.md` "Words" |
| 0.9 | G's Live read entry carries a comment "Not published until the release that ships `client.live`". `client.live` exists in the client now, so the page may define it; confirm the release state at pass 5. | `glossary.mjs:686-693`; `client/client.ts:570-571`, `:788` |

## 1. How the page reads from G (what the generator needs)

- 1.1 One table row per entry: term, what it means, layer. Plus the package and a link where OLD gave one (`apps/docs/docs/glossary.md` rows).
- 1.2 Entries are in G in source order, grouped by comment banners ("Resource and status", "Dispatch, wait, ask and hand-off", "Tasks and holds", "Execution tiers"). Banners are not layers. `glossary.mjs:117`, `:173`, `:324`, `:715`.
- 1.3 The tables cap at six rows per the standard; a reference page that must list 40+ terms splits by layer heading, each table at most six rows. `docs/contributing/user-docs.md` "Before you call it done" (no table has more than six rows). Check at pass 4 whether the cap applies to a Reference lookup table; the standard does not exempt it.

## 2. The terms, with what a reader can observe

Key: **R** = reader-facing, goes on the page. **C** = contributor naming rule, not on the page. Layer
codes are the proposal in section 3. "G line" is the term's line in `glossary.mjs`.

### Block layer (what a unit of work is)

| Term | R/C | What the page may say | Source |
|------|-----|-----------------------|--------|
| **Block** | R | A typed unit of work with an input and an output schema, in one of exactly five kinds: `handler`, `generator`, `evaluator`, `sequencer`, `router`. | `core/types/block.ts:43` (`BlockKind`); OLD "Block", "Block kind" |
| **Sequencer** | R | A block that runs other blocks in order (`step`, `tap`, `sideChain`, `parallel`, ...). | OLD "Sequencer"; `core/types/block.ts:43` |
| **Tool** | R | A block listed in a generator's `tools`; the model can call it. No separate tool type. `ToolsSlot` is `GeneratorTool[]` or a function returning one. | OLD "Tool"; `core/blocks/generator.ts:425` |
| **Dispatcher** | R | The block `dispatcher()` builds; only it carries the name. Sends its input to an entry on another flow. Not a sixth kind. | G:274 (`"The dispatcher block, and only it."`); `core/blocks/dispatcher.ts:306`; OLD "Dispatcher block" |
| **Side chain** | R | Work that runs alongside the turn (`sideChain`, `side-chain`). `background` is the umbrella over all three tiers. | G:717; OLD "Side chain" (its items are marked side-chain output) |
| **Item** | R | One typed record a request streams back (`OutputItem`, `getItems`; the union, `data` included, is `packages/contracts/src/items/types.ts:820-833`): a message, reasoning, a tool output, a data item, a status, an error, a state or resource change, a suspension and others. Not a resource in a collection. | G:166; OLD "Item" |
| **Status** | C | A lifecycle enum with no `Type` suffix. | G:154 |
| **State** | R (short) | Scope state or resource state, and nothing else. A block's own state is `ctx.self`. | G:160; OLD "State" |

### Flow layer (what an app declares and the server runs)

| Term | R/C | What the page may say | Source |
|------|-----|-----------------------|--------|
| **Flow** | R | `defineFlow` with a `kind`; declares actions, scope state, resources, capabilities. Top-level backend unit (definition like a class, each registered flow an instance). Never "a backend" or "a workflow". | OLD "Flow"; `docs/contributing/user-docs.md` "Words" |
| **Flow instance** | R | A flow called with an id and settings. `kind` `"singleton"` (default): one instance per kind, id defaults to the kind. `"collection"`: several named copies of one definition, each needs an id. | `core/types/flow.ts:497-506`; OLD "Flow instance" |
| **Action** | R | A named entry point on a flow wrapping one root block; adds input schema, hooks, token budget, durability settings. | OLD "Action" |
| **Scope** | R | Where state lives and how long: `request`, `session`, `user`, `org`. | `core/types/scope.ts:7`; OLD "Scope" |
| **Session** | R | The scope that lasts across requests: its state, history and items. Never define it as "a conversation". | OLD "Session"; `user-docs.md` "Words" |
| **Resource** | R | Named, schema-validated data at `session`, `user` or `org` scope. A resource in a collection is a resource; `collection.get()` returns its `ResourceRef`. | G:118; OLD "Resource" |
| **Resource collection** | R | A family of resources keyed by a pattern such as `files/*`: `get`, `list`, `create`, `upsert`, `delete`. | OLD "Resource collection" |
| **Capability** | R | A bundle of resources, state schemas, prompt context, tools and helpers a block or flow pulls in with `uses`. | OLD "Capability" |
| **View** | R | The hook that computes an answer for a screen: `defineView({ scope, block, key? })`, installed in a flow's `views`. Scope is `"session"`, `"user"` or `"org"`; definition throws on another scope, a missing block, a block with no output schema, or a non-function `key`. Stores nothing; refuses writes and model calls (G). `ctx.view.partial(entries, { removed? })` answers for only the rows a change touches; it throws when the run has no `changed` or the view declares no `key`. | `core/flow/defineView.ts:13-60`; `core/types/view.ts:95-106`; G:642 |
| **Live read** | R | `client.live(topics, options)`: keeps a screen current on change notices; filters notices, merges them, one read at a time, reports a value only when it changed, retries a failed read. A view's hook builds on it. | `client/client.ts:570-571`, `:788`; G:686 |
| **Direct read** | R | `client.resource(def, { key? })`: reads a user or org resource, or a collection's entries, by scope and key with no session, and writes through the flow its `runBy` names. Reads nothing until a method is called. No block runs. | `client/client.ts:535-540`; G:694 |
| **Default write flow** | R | The flow that writes a user or org resource, or a collection's entries, named by `runBy: "default"`. `canWrite` decides the write; `runBy` requires client state read access (`client: { state: { read: true } }`) and refuses `eviction` collections. | `core/types/resource-collection.ts:252-260`, `:552-572`; G:709 |
| **Principal** | R | The verified caller: a `userId` and an `orgId`. `resolvePrincipal` configures it. | OLD "Principal"; `bullmq/src/worker.ts:57-62` (`resolvePrincipal?: PrincipalResolver`) |
| **User** | R | The signed-in human making a request, always inside one org. Every action is taken by one user. No system users in the framework. | G:467; OLD "User" |
| **Suspension** | R | A run that stops to wait for a user's approval or answer, then resumes where it stopped (`ctx.suspendForUser`). | `contracts/types/suspension.ts:54-77`; OLD "Suspension" |
| **Hold** | R | What keeps a task open for a person; a question is one kind (`holdTaskForUser`, `suspendForUser`). | G:325; `orch/task-board/turn-wait.ts:22` (`PersonWaitTool`) |
| **Ask** | R (Shift Manager) | Only a question to a person (an approval, a clarifying question). Never delivering work. | G:203; OLD "Ask" (an approval or question a run is suspended on) |
| **Routine** | R | A standing instruction that fires on its own as its owner, with exactly one trigger: a clock (recurring) or an event (a subscription). Four verbs: `listRoutines`, `saveRoutine`, `pauseRoutine`, `deleteRoutine`. A clock routine's id is `clock:<key>`; an event routine's is `event:<subscription id>`. A worker reaches them as tools through `createRoutinesCapability` and only the routines that act through it. | G:783; `wf/routines/routines.ts:1-25` |
| **Topic** | R | A declared name an internal event is published on (`deploy.finished`), with its kinds, data schema and description. A session publishes with `publishEvent`; a routine follows it on thread `internal:<topic>`. An undeclared topic or kind is refused at both. | G:811; `wf/service-flows/internal-events/topics.ts:4-22`, `:15-16`; `wf/service-flows/index.ts:10` |

### Kit layer (what an app installs)

| Term | R/C | What the page may say | Source |
|------|-----|-----------------------|--------|
| **Kit** | R | The installable unit above a flow, made with `defineKit`. An app installs kits with `createFlowState({ kits: [workforce({ model }), harnesses({})] })`, in any order. A kit declares `config`, the kits it `requires`, `slots`, what it `contributes` to required kits, an optional `directory` (a folder it owns in the app), and an `install` returning flows. A kit has no client half. The name is lowercase letters, digits and single hyphens, at most 64 characters (it is half of every slot key). Config is checked against the kit's schema when the factory is called; `directory` on a kit that owns no folder throws. | `core/kit/define-kit.ts:1-18`, `:182-216`, `:211-245`; G:667 |
| **Slot** | R | A typed, named place a kit declares and other kits fill at install. Two shapes: `slot.keyed(schema)` (entries by key; a key given twice is refused naming both contributors) and `slot.list(schema)` (contributions append in install order, each kit's `requires` first, the app's last). Key of one slot: `<kit>.<slot>`, read from the owning kit's factory (`workforce.slots.workerFlows`). An app drops a contribution with `kit.without(slot, key?)`. Same idea one level up as a block's slot (`ToolsSlot`, `UsesSlot`, the context slot). | `core/kit/define-kit.ts:20-70`, `:150-170`; `core/blocks/generator.ts:425`; `core/capability/types.ts:607`; G:674 |
| **Harness** | R | A coding agent a run drives as a block (Claude Code, Codex, Cursor). As a value `Harness` (from `@flow-state-dev/harness-manager`): `{ id, label?, agent, readiness, pass, usage?, models? }`; fills the harness kit's `harnesses` slot. A worker's `harness:` line names one by `id`. `label` defaults to `id`. | `hm/harness.ts:1-45`; G:680 |
| **Harness block** | R | The shape every coding-agent block shares: takes a prompt, returns a handle with an outcome, a final message, usage and cost. | OLD "Harness block" |
| **Session factory** | C | `defineSessionBoard`'s product; never a kit. | G:412; `wf/coordinator/coordinator-flow.ts:407` |

### Engine layer (what runs and stores flows)

| Term | R/C | What the page may say | Source |
|------|-----|-----------------------|--------|
| **FlowState** | R | What `createFlowState` returns: the server holding flow instances, stores, kits and principal resolver. | OLD "FlowState"; `core/kit/define-kit.ts:5` (`createFlowState({ kits })`) |
| **Flow runner** | R | `FlowRunner` decides where a flow action runs. `InProcessRunner` (default) runs in the current process; `WorkerRunner` (BullMQ) enqueues to a queue. Interface: `dispatch(envelope, bridge?)`, `close()`. | `engine/transports/runner.ts:122-135`; G:311 |
| **Request** | R | One run of one action on one session; streams items; resumable. | OLD "Request" |
| **Stores** | R | Where sessions, requests, user and org state, resources, checkpoints and traces are kept. In-memory by default; SQLite or Postgres to persist. | OLD "Stores" |
| **Host adapter** | R | Serves a FlowState from one kind of host (`node`, `next`, `vercel`). | OLD "Host adapter" |
| **Durable action**, **Scheduled action** | R | Action that checkpoints each step; action that runs on a cron schedule. | OLD rows of the same names |
| **Block instance id** | R | `requestId:path:attempt`; a retry gets the next attempt number. | OLD "Block instance id" |

### App layer (what a user of the product works with: Workforce and Shift Manager)

| Term | R/C | What the page may say | Source |
|------|-----|-----------------------|--------|
| **Worker** | R | A configuration with an owner: names the flow it runs on, carries its own instructions, skills and tools. Belongs to one user and acts as them. Never "seat". | G:484; OLD "Worker" |
| **Worker flow** | R | The flow a worker runs on: the built-in `agent`, the coordinator, or an app-registered flow. Each registered once; every worker naming it shares that copy. | G:517; OLD "Worker flow" |
| **Standard worker** | R | A worker every user has, read from the installation's files, the same for everyone. Nothing at run time writes the file. A user's first edit copies it onto their own roster under the same id; other users keep the file's version; `reset` deletes the copy. (Corrected after the loop: the earlier "Nobody edits one" was untrue.) | G:523; `wf/workers/standard-workers.ts:6-11`; `wf/workers/client.ts:212-231`; `wf/workers/roster-view.ts:92-99` |
| **Fork** | R | Copies a standard worker, or one of the user's own, into a new worker of the user's own under a new id, from its configuration. | G:524; `wf/workers/client.ts:212-216` |
| **Roster** | R | The workers one user has, standard ones included. Shift Manager's Roster screen shows the same workers by what they are doing (on shift or off shift). | G:526; OLD "Roster" (Workforce and Shift Manager rows) |
| **Coordinator** | R | A worker that hands each message to its delegates as routed tasks. Never a mailbox. | G:533; OLD "Coordinator" |
| **Routed task** | C/R | A coordinator's post; the message it routes is named by the request that carried it (`messageRequestId`). | G:370; `wf/coordinator/coordinator-flow.ts:263`, `:294` |
| **Delegate** | R | A worker a conversation may delegate to, and the only workers it can give work to. Listed under `delegates:` in the worker's file, or `delegates: all`. | G:548; OLD "Delegate" |
| **Delegation** | R | Handing work to one of your delegates, checked against your roster. | G:563 |
| **Door** | R | `respond`, the one public action that takes a message to a worker, on every worker flow. | G:565; OLD "Door" |
| **Project** | R | A body of work, private to you or shared with your org. | G:586; OLD "Project" |
| **Workstream** | R | One area of a shared project, with one owner. | G:587; OLD "Workstream" |
| **Project coordinator** | R | Your coordinator for one project: one session per user per project. Never a room or a talk session. | G:589; OLD "Project coordinator" |
| **Shift Coordinator** | R | The standard coordinator a user asks who works here, and asks to hire or fire; worker id `shift-coordinator`. | G:606; `packages/shift-manager/src/lib/derive.ts:277`; OLD |
| **Message** | C/R | What one worker sends another through Workforce's messaging. | G:442 |
| **Message budget** | C | The workforce kit's `messages.budget`: the one budget a user's line starts. | G:384 |
| **Task**, **Task board**, **Task collection** | R | A unit of work with a status (`pending`, `in_progress`, `held`, `completed`, `errored`, `cancelled`), optional assignee, dependencies; a board drains a task collection with a pool of workers. | OLD "Task", "Task board", "Task collection" |
| **Task tools** | R | The filer's tools: `createTask` files, `getTask` and `listTasks` read, `updateTask` changes or cancels; the worker's `reportProgress`. | G:356; OLD "Task tools" |
| **Assignee** | R | Who a task goes to: an entry in a task board's workers, or a name the board's assignee check accepts. | G:503; OLD "Assignee" |
| **claimsUnassigned** | R (option) | An `AssigneeRoster` flag: the board's default worker claims a task with no assignee, so a model's `createTask` may file one unassigned. Absent or false, the task goes to `soleAssignee()`, or the call is refused with `assignee_required`. | G:510; `orch/skills/task-tools-capability.ts:324`, `:332`, `:363`, `:396` |
| **Claim order** | R | The rule that picks the next ready task: `fifo` (the default), `priority`, or your own `ClaimOrder`. There is no `topological` order; neither named order claims a task with unmet deps. `orchestration/src/task-board/index.ts:463-468`, `shared.ts:27-41`. | G:317; OLD "Claim order" |
| **Dispatch** | R | Start work on another worker. A task board's pass is a dispatch. OLD calls the task form "Dispatch a task". | G:174; OLD "Dispatch a task" |
| **Wait** | R | What a turn does on a task it dispatched: `getTask({ id, wait: true })` or `dispatcher({ wait: true })`; pauses until the work ends or the deadline; the deadline cancels nothing. A board's `onIdle: "wait"` is a different setting. | G:189; OLD "Wait" |
| **Hand-off** | R | A session that was doing the work passes it to another session, mid-work. Never delivering new work. | G:242; OLD "Hand-off" |
| **Follow-up** | C/R | What a finished task takes (`followUpOf`). | G:428; `core/types/dispatch.ts:72`, `:335` |
| **Split** | C | A task split into pieces with no board, settle or cancel of its own. | G:398 |
| **Lab**, **Inbox**, **Tasks**, **General** | R (Shift Manager) | See OLD "Shift Manager" table. | OLD rows of the same names |

### Contradictions between OLD and G (code or G wins; settle at pass 5)

- 2.1 OLD says **Dispatch a task** and G says **Dispatch**. G is the vocabulary source; use "Dispatch".
- 2.2 OLD **Kind**: "A flow's `kind` is its name to the engine." G has no Kind entry; `kind` is `"singleton"|"collection"` for a flow's *instancing* in `core/types/flow.ts:497-506`, which is a different `kind`. The word means both a flow's name and its instancing mode. Flag for the writer: define only the word's role in one place or leave out.
- 2.3 OLD "Block kind" lists the five kinds; code agrees (`core/types/block.ts:43`).

## 3. Layer assignment (proposal; G carries none)

| Layer | Terms from G (R only) | Plus terms OLD adds |
|-------|-----------------------|---------------------|
| **app** | Worker, Worker flow, Standard worker, Fork, Roster, Coordinator, Delegate, Delegation, Door, Project, Workstream, Project coordinator, Shift Coordinator, Routine, Topic, Assignee, Dispatch, Wait, Hold, Ask, Hand-off, claimsUnassigned, Claim order, Task tools, Message | Task, Task board, Task collection, Team, Hire, Fire, Lab, Inbox |
| **kit** | Kit, Slot, Harness | Harness block, Harness manager, Pattern |
| **flow** | Resource, State, View, Live read, Direct read, Default write flow, User, Hold (suspension side) | Flow, Flow instance, Action, Scope, Session, Resource collection, Capability, Principal, Suspension |
| **block** | Item, Dispatcher, Side chain | Block, Block kind, Sequencer, Connector, Tool, Model resolver |
| **engine** | Flow runner | FlowState, Flow registry, Request, Stores, Host adapter, Durable action, Scheduled action |

- 3.1 The mapping is the writer's, not G's. OLD puts Routine/Topic nowhere (not defined); both are Workforce (`wf/routines/`, `wf/service-flows/internal-events/`), hence app.
- 3.2 Terms that straddle: **Hold** (a task hold at app level; `suspendForUser` is a flow-level suspension), **User** (a core principal, but the page's audience term). Put each once, at the layer a reader looks for it, and cross-reference.

## 4. Stored parts: who owns, who sees, where stored, how many

Only terms that store data. Answers are from code or G; "not verified" means the sheet read no code for it.

| Part | Owner | Who can see | Where stored | How many | Source |
|------|-------|-------------|--------------|----------|--------|
| **Worker** (a user's own) | the one user (acts as them) | that user | resource collection at `user` scope, pattern `workforce/workers/*`, per organization, accessor `workforceWorkers` | one row per worker | `wf/workers/keys.ts:13-19` |
| **Standard worker** | the installation (files on disk) | every user, same for all | projected from the installation's files at pattern `workforce/standard-workers/*`; not editable (a fork makes the user's own copy) | one per worker folder | `wf/workers/keys.ts:21-25`; G:523-524 |
| **Worker's session binding** | the worker session | that session | session-state field `workerId`, readonly: set at creation, never changes | one per worker session | `wf/workers/keys.ts:29-36` |
| **Private project** | its owner | its owner | `projects/*` in the owner's user scope | one per project | `wf/projects/collections.ts:13`, `:200-215` |
| **Shared project and workstream entries** | org scope; a workstream's entry written only by its owner | the org | org-scope collections | one project row each; one entry per workstream | `wf/projects/collections.ts:191`, `:253`; G:586-587; OLD "Workstream" |
| **Project files** | the project's owner | owner (private project) | `project-files/**` | many | `wf/projects/collections.ts:13`, `:261` |
| **Routine** | its owner (fires "as its owner") | its owner; a worker sees only routines acting through it | a clock routine is a schedule keyed by name; an event routine is a subscription keyed by subscription id | one per routine; app-declared routines seeded into each user's collections when their roster flow runs a request | `wf/routines/routines.ts:1-25` |
| **Topic** | the app (declared) | not stored; a declaration | declared, no record | one per name | G:811; `wf/service-flows/internal-events/topics.ts:18-22` |
| **Roster** (Shift Manager screen) | derived | the user | not stored; worked out on each read | n/a | OLD "Roster" (Shift Manager) |
| **Kit folder** | the app | the app | a folder the kit owns, path from the `directory` config; every entry is used or refused, an unclaimed one stops the app starting | one per kit that owns one | `core/kit/define-kit.ts:70-90` |
| **Default write session** | the server, for the writer | not verified | "a write session the server keeps for that writer" | not verified | G:709 |
| **Task** | the board's flow session | not verified | state or a resource collection | many | OLD "Task collection" |

## 5. Lookups the page must answer

- **What does "worker" mean here?** Two senses, told by the package: Workforce, a configuration one user owns, naming its flow and carrying instructions, skills and tools (G:484); on a task board, a block that runs one claimed task (OLD "Board worker", "Words that mean two things"). Never a "seat" (G:484-490).
- **What is the difference between a kit and a flow?** A flow is the unit the server runs (`defineFlow`); a kit is the unit an app installs and returns flows (`defineKit` `install`). `core/kit/define-kit.ts:1-18`.
- **What is a slot?** Section 2, Kit layer. Two meanings, kit slot and block slot (`ToolsSlot`, `UsesSlot`, context), same idea.
- **Where does a term's page live?** OLD links each row to its full page (`./fundamentals/blocks.md` and others). The new page links by slug; the writer maps slugs from the page plan.

## 6. Items left out for lack of a reader-facing source

- Contributor naming rules in G (`names:`, `retires:`, EXEMPTIONS, PERSON_PINS): enforcement of the vocabulary checks, not behavior. `glossary.mjs:824-1440`.
- The `decision` strings in every entry.
- Default write flow's session keeping, Task visibility: no observable surface read.

## 7. Open for later passes

- Pass 2/3: which of the 16 `published` terms plus the reader-facing unpublished ones (View, Kit, Slot, Routine, Topic, Harness, Live read, Direct read, Default write flow) belong on a reference page that links out. The sitemap says every term is linked from "every page's first use of a term".
- Pass 4: `scripts/check-retired-terms.mjs` on the new page; the word "person" is retired for "user" (G:467 `User` entry's retirements).
- Pass 5: confirm `client.live` release state (0.9), the OLD/G Dispatch name (2.1), and the Kind definition (2.2).

## 8. Revise round 1

- Corrected: claim order names are `fifo` (default) and `priority` only; the page now says "such as `fifo` or `priority`".
- Moved to Reference (page keeps one definition and a link): block instance id format and retry (R-17 `durable-execution`); sequencer methods, connectors, side chains (R-03 `sequencer-methods`); model resolver fallbacks (R-21 `models`); action fields, flow instance cardinality (R-05 `flows`); principal default org (R-20 `authentication`); flow registry duplicate ids (R-12 `runtime`); request resume (R-06 `items`); stores profiles (R-16 `stores`); durable and scheduled detail (R-17, R-33 `schedules`); task statuses, task tools rule, assignee resolution, claim order, dispatch, wait, flow policy (R-23 `task-board`, R-24 `task-collections`, R-19 `background-work`); skill (R-30, slug `skills` **[verify]**); harness manager (R-27 `harness-runs`); patterns (R-41); memory tiers (R-37 `memory`); worker flow, standard worker, hire/fire, coordinator modes, role entries, workstream and project coordinator detail (R-25 `workforce`); address, delegates (R-28 `worker-md`); team and package folder rules (R-29 `workforce-folder`).
- The `updateTask` per-field rule, the hire refusal on missing role entries, and "nothing holds a request open" are off the page and not claimed. "Entry" no longer appears as a term.
- "Built from" names the lower terms a term is made of, not where its data lives.
- "Words that mean two things" now has Shift Coordinator (worker, and Shift Manager screen) and a corrected Kind entry.
- Figures live in `figures/` beside the page as `glossary-{core,layers,orchestration,shift-manager,workforce}.svg` (the vocabulary sweep reads only SVGs under a `figures/` folder as assets, `docs/contributing/glossary.mjs:1459`); the five SVGs pass brand lint.

- 5.1 Team profile is left off the page: it is a Lab config kept in the Shift Manager source folder and is not in the published package, so a reader who installed the package cannot use it.
- 5.2 Package is listed under "Words that mean two things": the Package column names an npm package, while a Workforce package is a `PACKAGE.md` folder a worker can hold.

## 9 · Added after the loop

- Kit row on the page: `workforce({ model })` and `harnesses({})` are kits; kits install in any listed order, sorted by `requires`; no client half. `core/kit/define-kit.ts:1-17`; `engine/flowstate/kits.ts:5-11`; `docs/architecture/kits.md:25`.
- Slot: a keyed key given twice is refused naming both contributors, as one `FlowStateConfigError` at construction; `kit.without(slot, key?)` drops a whole contribution or one keyed entry. `core/kit/define-kit.ts:22-61`, `:166-170`; `engine/flowstate/kits.ts:10-11`, `:188-191`.
- Wait: `getTask({ id, wait: true })` and `dispatcher({ wait: true })`; at the deadline the turn resumes with the task running; the deadline cancels nothing. `orch/tasks/helpers/wait-on-task.ts:3-6`, `:28-30`; `core/blocks/dispatcher.ts:233`.
- `tools` package: depends on core and workspace; exports `search`, `fetch`, `crawl`, `createBashTool`, and an MCP capability at `./mcp`. `packages/tools/package.json:34-50`, `:95-97`; `packages/tools/src/index.ts:6`; `packages/tools/src/mcp/index.ts:7`.
- Shift Manager is published (`packages/shift-manager/package.json` has no `private`); the layers figure said "not published" and is corrected.

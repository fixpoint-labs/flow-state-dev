# Facts for Workforce (K-05, catalog, kit template)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec is cited; the page plan's Sources line was used only for placement. Paths are from the repo root.

Legend: **[page]** the page states it. **[ref]** belongs on a Reference page (`reference/workforce`, `reference/worker-md`, `reference/kits`); the page links, does not state it. **[gap]** nothing citable exists; the page must not assert it. **[reconcile]** a name or path that depends on something unsettled; mark for cutover. **[verify]** not confirmed end to end; keep off the page or soften. **[cut]** history or mechanism; never on the page.

Abbreviations:

- `wk` = `packages/workforce/src/kit/workforce-kit.ts` · `ki` = `packages/workforce/src/kit/index.ts` · `kt` = `packages/workforce/test/workforce-kit.test.ts`
- `dk` = `packages/core/src/kit/define-kit.ts` · `ety` = `packages/engine/src/flowstate/types.ts`
- `aw` = `packages/workforce/src/agent-worker-flow.ts` · `wi` = `packages/workforce/src/messages/worker-identity.ts` · `dl` = `packages/workforce/src/worker-default-layer.ts`
- `hb` = `packages/workforce/src/workers/hire-blocks.ts` · `wr` = `packages/workforce/src/workers/worker-row.ts` · `sw` = `packages/workforce/src/workers/standard-workers.ts`
- `rf` = `packages/workforce/src/workers/roster-flow.ts` · `rg` = `packages/workforce/src/workers/register.ts` · `rv` = `packages/workforce/src/workers/roster-view.ts` · `wu` = `packages/workforce/src/workers/worker-usage.ts`
- `cl` = `packages/workforce/src/workers/client.ts` · `br` = `packages/workforce/src/browser.ts` · `wf` = `packages/workforce/src/workers/worker-flow.ts`
- `wt` = `packages/workforce/test/worker-roster.test.ts` · `at` = `packages/workforce/test/agent-worker-flow.test.ts` · `ct` = `packages/workforce/test/worker-chosen-tools.test.ts` · `mt` = `packages/workforce/test/agent-worker-memory.test.ts` · `ht` = `packages/workforce/test/agent-worker-history.test.ts` · `st` = `packages/workforce/test/worker-history-summary.test.ts` · `dt` = `packages/workforce/test/worker-default-layer.test.ts`
- `mf` = `packages/workforce/src/manifest-sources.ts` · `wc` = `packages/workforce/src/workforce-capability.ts` · `wdt` = `packages/workforce/test/worker-discovery.test.ts` · `core-d` = `packages/core/src/manifest/discovery-tools.ts`
- `bw` = `apps/docs/docs/workforce/built-in-worker.md` · `dh` = `apps/docs/docs/workforce/durable-hire.md` · `ov` = `apps/docs/docs/workforce/overview.md` · `di` = `apps/docs/docs/orchestration/discovery.md` · `inv` = `apps/docs/docs/workforce/inventory.md` · `ui` = `apps/docs/docs/workforce/ui.md`
- `tm` = `labs/teammates/host.mts` · `ks` = `apps/kitchen-sink/lib/workforce-kit.ts` · `ksw` = `apps/kitchen-sink/workforce/teams/support/workers/fsd`
- `g1` = the `goals/workforce-workers/` goal that the built-in worker flow answers from a file alone · `g2` = `goals/workers-as-resources/keeps-each-users-workers-their-own/goal.md` · `g3` = `goals/kits/workforce-and-harnesses-install-as-kits/goal.md` · `g4` = `goals/agent-discovery/an-orchestrator-routes-a-task-by-asking/run.mts`

## Flags against the page plan (read first)

1. **Discovery is not something the kit installs.** `installWorkforce` adds exactly two capabilities of its own to the agent and coordinator flows, `consultSessions` and the routine tools (`wk:219-227`, header `wk:24-26`). Nothing in `packages/workforce/src/kit` or `src/workers` composes `createWorkforceCapability` or writes inventory rows (grep of both folders for `discover`, `discovery`, `openInventory`: none; `inventoryWorkers` appears only as a collection the roster flow declares, `rf:61`, and as an exported helper, `rg:154`). An app gets `discover` only by composing the capability into the agent flow's `uses`, which `WorkforceAgentOptions` carries (`wk:52`, `aw:338`). `createWorkforceCapability` needs `roster: { workers }` (the declared workers) and an `inventory` key (`wc:43-71`); the `workers` domain lists a worker only where a file declares it and an inventory row exists (`mf:20-25`, `mf:157-189`). Inventory rows are written by a flow the app builds (`inv` "Wiring the boot"), not by the kit. **The one citable end-to-end use under the kit is the goal's**, which replaces `agent` through the `workerFlows` fill and composes the capability by hand (`g4:141-155`). **[gap]** for any claim that a kit app has discovery on. The page's "What a worker can find" section can state what `discover` returns and what narrows it (facts in section 6) and that the app adds it; it must not say the kit turns it on. Under the kit an app gets the installation the capability needs from a `workerFlow(...)` builder's argument or a `flows` slot builder's argument (`kt:151-153`, `kt:162-163`; `installWorkers` in `goals/lib/workers.mts:117-140` reads it that way), and `roster: { workers: installation.standardWorkers() }` is how the lab reads the declared workers (`packages/shift-manager/teams/devteam/host.mts:1174-1177`). Escalate to the caller: the page plan assumes the kit serves discovery.
2. **A runtime hire does not appear in `discover`'s `workers` domain.** `workersSource` lists the inventory rows that a declared file backs, and drops a row with no file (`mf:161-175`). A user's own hired or forked worker has no file and no inventory row (`inv:25`, "A user's own workers ... aren't listed"). `di:9` and `di:13-15` ("A worker hired a minute ago is not in a prompt written at boot") argue for discovery over a prompt; read as a claim about hires it is wrong for the current surface. **[verify]** do not say a hire shows up in `discover`. The existing doc's "Workers are projected from a record that is only ever appended to" (`di:109-111`) is consistent with the code.
3. **The existing Hiring page contradicts the code on editing a standard worker.** `dh:10-12` says nobody can change a standard worker while the app runs, and `dh:93` says an edit of one is refused. The code: an edit of a standard worker's id makes the user's own copy under the same id and applies the change to it; `reset` deletes the copy (`hb:10-14`, `hb:213-247`, `hb:262-277`; `cl:217-231`; tests `wt:286-310`, `wt:371-383`). `hire`, `fork` onto, and `fire` of a standard worker's id are still refused (`hb:178`, `hb:199`, `hb:255`; `wt:34-47`). A standard worker's flow cannot be changed by an edit (`hb:225-231`; `wt:395-400`). **The page states the code's behaviour.** `dh` is stale here and `reset` is on no existing page.
4. **The existing Hiring page's roster rows are short.** `dh:130-131` shows `{ id, flow, standard, description }`. The client's `RosterEntry` has nine fields: `id`, `flow`, `standard`, `description`, `name`, `teamName`, `forkedFrom`, `edited`, `settings` (`cl:54-84`; asserted whole in `wt:62-63`). **[ref]**: the page names the roster entry in a clause and links.
5. **The existing UI page puts the screens in the wrong package.** `ui:10` and `ui:13` say `Roster`, `BoardColumns`, `BoardList` come from `@flow-state-dev/react`. They are exported from `@flow-state-dev/workforce/react` (`packages/workforce/src/react/index.ts:11-33`; subpath in `packages/workforce/package.json` exports `./react`). `packages/react/src` has no `Roster` or `BoardColumns` (grep: none). `Roster` reads a collection through a session you pass, by `collectionRef` (`packages/workforce/src/react/components/Roster.ts:68-78`), not the roster view. **[ref]** and **[verify]**: the page does not name the components or their package. It names the views (section 5) and links to the UI page.
6. **No install line for the package exists in any citable source.** The package README and the Workforce docs pages carry no `pnpm add` / `npm install` line (grep of `packages/workforce/README.md`, `ov`, and `apps/docs/docs/workforce/workers-on-disk.md`: none). The package is published (`packages/workforce/package.json`: `name` `@flow-state-dev/workforce`, `version` `0.5.0`, `publishConfig.access` `public`, `private` unset). **[reconcile]** the K-01 sheet reaches the same gap for workforce and claude-code (`pages/catalog/index.facts.md` fact 3.10). The page may print `pnpm add @flow-state-dev/workforce` as derived from the package name, marked for cutover with the install lines the plan defers.
7. **`workforce({ directory })` is the plan's example and it is real,** but `directory` is not one of the kit's own config keys. It is the app's path override that every kit with a folder takes (`dk:90-91`, `dk:241-247`; test `kt:77`). A kit that owns no folder refuses it (`dk:242-244`). The default needs no config (`wk:182`). **[page]** The page says what `directory` does; the example the plan names is a legal call, but with the default folder the call is `workforce({})`.
8. **The agent flow's tool catalog has two doors under the kit.** Config `agent.catalog` (`aw:273`, passed through `wk:233-243`) and the generated module's `blocks` (`wk:64`, applied `wk:237`, with `agent` after it so `agent.catalog` wins by spread order, `wk:237-238`). `fsdev gen` writes the module from the folder (`packages/workforce/src/codegen/index.ts:1-24`, `discover.ts:85-88`). The page's "a worker with tools" example can use a worker's own `blocks/` folder, which needs no catalog (section 3.2, example 2). **[page]**
9. **A stored-data table is required, and it is in section 4.** Workforce stores a user's own workers, a user's copy of an edited standard worker, a user's routines, sessions, skills and memory. The page states owner, visibility, location and count for the first two and for what a worker keeps; routines, projects, messages and inventory rows are **[ref]**.

## 1. What it is, and install it (opening, "what you get")

- Workforce is a kit named `workforce`. `defineKit({ name: "workforce", ... })`. `wk:174-175`. **[page]**
- It is exported from `@flow-state-dev/workforce/kit` (`ki:1-19`; subpath `packages/workforce/package.json` exports `./kit`). The module is Node-only: its folder reader reads the app's `workforce/` folder at start-up, so it belongs in the app's server entry. `ki:1-6`. **[page]**
- One config object installs it: `createFlowState({ kits: [workforce({ agent: { model: "openai/gpt-6-luna" } })], stores })`. `wk:171-172`; header `wk:3-5`. **[page]**
- What an app gets, in the doc comment's words: it "reads the app's `workforce/` folder (every file used or refused), builds the worker model over the workers it declares, and serves one copy of each worker flow and the roster flow." `wk:3-9`. **[page]**
- With the default config over a folder holding one worker, the running app serves exactly two flows: `agent` and `workforce-roster`. `kt:75-80` (`state.meta.flowKeys` sorted equals `["agent", "workforce-roster"]`); goal `g1:15` (the registered copies are `agent` and the roster flow). **[page]** (the figure's flow list)
- A worker file names its flow in `flow:`; a file that names none runs on `agent`. See section 3.1.
- The kit requires no other kit and fills none (`wk:174-186`: no `requires`, no `contributes`). `harnesses` requires it and fills its slots (`packages/harness-manager/src/kit/harnesses-kit.ts:98`, `105-106`). **[page]** (one clause: other kits plug into this one)
- The app lists kits in `createFlowState({ kits })`, in any order; they install in `requires` order. `ety:126-130`; K-01 fact 3.3. **[page]**
- Every file in the folder is used or the app does not start; the refusal names each file. Test: a folder with `notes.txt`, `flows/helper.mts`, `teams/core/notes.md`, `flows/workers/nested/deep.ts` beside a valid worker fails `ready()` naming each stray and not `WORKER.md` or `flows/workers/coder.mts`. `kt:82-102`; goal `g3:12` (`b:stray`). `wk:4` ("every file used or refused"). **[page]**, one sentence. The mechanism is on the Kits reference **[ref]** (`dk:70-75`).
- A worker file that does not load stops the app starting and the refusal names it: `refused` contains `teams/core/workers/lead`. `kt:104-112`. **[page]**, a clause.
- The kit's default folder is `workforce/`, read against the app's root. `wk:182`; `dk:139-141`, `ety:147-153`. **[page]**
- `directory` in the kit's config overrides it, read against the working directory. `dk:90-91`, `dk:140-143`; `kt:75-80` (a temp directory passed as `directory`). **[page]** (one clause)
- Install: `pnpm add @flow-state-dev/workforce` is derived (flag 6). **[reconcile]**
- The model a worker runs on needs its provider's AI SDK package in the app: `@ai-sdk/openai` for `OPENAI_API_KEY`, or `@ai-sdk/gateway` for the Vercel AI Gateway. Without it the turn fails naming the package. `ov:86`. **[ref]** (the page links to "Setting up models", `apps/docs/docs/getting-started/setting-up-models.md`)

### The folder the kit reads (the figure's folder column)

- A standard worker on a team: `teams/<team>/workers/<name>/WORKER.md`, id `<team>.<name>`. An org worker: `org/workers/<name>/WORKER.md`, id `<name>`. `ov:49`. **[page]**
- A team's own file is `TEAM.md`. `labs/teammates/workforce/teams/teammates/TEAM.md`; `ov` and `bw:130-150`. **[page]** (a clause, or leave to `reference/worker-md`)
- Skills folders: `org/skills/<skill>/SKILL.md`, `teams/<team>/skills/<skill>/SKILL.md`, `teams/<team>/workers/<name>/skills/<skill>/SKILL.md`. `bw:130-150`. **[page]**
- Code the folder may hold: `flows/workers/<name>.ts` (a worker flow), `blocks/<name>.ts` (an agent-wide tool), a worker's or team's `blocks/` folder, `resources/` folders, package `blocks/`. `packages/workforce/src/codegen/index.ts:1-12`; `discover.ts:85-88`; `kt:83-91`. Rendered into `workforce/workforce.gen.ts` by `fsdev gen`, which the app imports and hands to the kit as `generated`. `wk:60-76`, `packages/workforce/src/codegen/fsdev-gen.ts:1-9`; example `ks:38`, `ks:56`. **[page]**, a clause; **[ref]** for the maps.
- The generated module accepts only its five maps (`workerFlows`, `blocks`, `resourceModules`, `workerBlocks`, `packageBlocks`); a misspelled key is refused at the kit's call, not dropped. `wk:120-131`; `kt:197-202`. **[ref]**

## 2. What this installs (figure 1)

The convention's figure: the kit's folder, the flows it serves, the views, the slots it opens. Sources for each:

- **Folder:** `workforce/` (section 1).
- **Flows always served:** `agent` (the built-in worker flow) and `workforce-roster`. `kt:75-80`.
- **Flows served when configured:** `coordinator`, when config has `coordinator` (`wk:246-247`); a GitHub service flow when `github` is set (`wk:278`); an internal-events service flow when `internalEvents` is set (`wk:268-270`, `wk:279`); and every flow an entry in the `flows` slot builds (`wk:277`). `kt:256-290` asserts `internal-service` is served when configured. **[ref]**
- **Worker flows other kits add:** whatever fills the `workerFlows` slot. `harnesses` adds `coder`. `harnesses-kit.ts:105`; goal `g3:7` (`a:flows`). **[page]** (one clause)
- **Capabilities on its own flows:** `consultSessions` and the routine tools, offered only to a worker whose file picks them. `wk:24-26`, `wk:221-227`. **[ref]**
- **Slots (three):** `workerFlows` (keyed), `uses` (list), `flows` (keyed). `wk:177-181`. **[page]** (names and one line each; section 7)
- **Views:** section 5.
- **Config keys:** `agent`, `coordinator`, `consult`, `routines`, `github`, `internalEvents`, `generated`, `taskChainLimit`, `messages`, `projectCoordinator`, `sessionFields`; the schema is strict, so an unknown key is refused. `wk:79-111`, `wk:133-147`. **[ref]** (the page names `agent` and `directory`; the rest is `reference/workforce`)
- **Stored data:** user-scope `workforce/workers/*` rows (section 4); routines at `workforce/schedules/*` and `workforce/subscriptions/*`, and worker messages at `workforce/messages/*`, declared on the roster flow. `rf:13-20`. **[ref]**
- Two flows, the three slots and the folder are the whole of "what it installs" a reader must keep. Everything else is configuration.

## 3. The built-in agent

### 3.1 What a worker runs on when its file names no flow (question 1)

- A worker file that names no `flow:` runs on the built-in worker flow `agent`. `bw:13`; `aw:3-8`; test `at:60-69` ("hires a record that names no `flow:`, handing its body over as instructions"); `at:83` (`flow: agent` names the same flow). **[page]**
- The file's body becomes the worker's instructions. `bw:33`; `at:60-69`. **[page]**
- Every worker on `agent` shares one registered copy; each turn runs as the worker its session names. `bw:33`; `aw:1496-1504` (`kind: AGENT_FLOW`, `cardinality: "collection"`); goal `g1:7`. **[page]**
- A file with a description and a body, nothing else, is enough: goal `g1:5-19` has two such workers answer in their own voices, each carrying a token only its file holds, on the one copy. `g1:5-7`. **[page]**
- A file that names a flow nobody registered stops the roster hiring; nothing from a mixed roster is registered. `g1:19` leg (c); `rg:78-81`. **[ref]** (the page may say one clause)
- The built-in's model, when neither the worker's file nor the app names one, is `intent/chat`, a provider-neutral name the app's own model resolver turns into a concrete model. `aw:134` (`DEFAULT_MODEL`), `aw:473` (`model: z.string().default(options.model ?? DEFAULT_MODEL)`); test `at:89`. A worker's `model:` line overrides it; the kit's `agent.model` sets the default for workers that name none (`aw:276-277`). **[page]**
- A turn may take at most 50 model steps by default; on the last step the worker is offered no tools and answers in text. `aw:141`, `aw:1245`. `agent.maxSteps` changes it. `aw:389`. `bw:110`. **[ref]**
- A `WORKER.md`'s settings are for the file reference. `instructions`, `model`, `tools`, `skills`, `capabilities`, `packages`, `discover`, `defaults`, and the app's own `settings` keys. `bw:35` (list); `aw:645` (`discover`). **[ref]** (`reference/worker-md`)

### 3.2 Tools

- A worker has no tools unless its file grants them. With no `tools:` line it gets the tools of the capability presets its own file picked under `capabilities:`, plus the blocks of packages it holds, and nothing else. `bw:49`; test `ct:149-168`, `ct:279-290` ("offers a worker that picks nothing and lists nothing no tool at all"). **[page]**
- A written `tools:` line is the whole of what the worker can call, "a hard runtime fence, not a hint". An empty list means none. `aw:27-31` (doc comment); tests `ct:170-210`; `bw:49`. **[page]**
- Each name in `tools:` resolves, in order: the worker's own `blocks/` folder, its team's `blocks/` folder, then the flow's tool catalog. The first match wins. A name nothing registers is refused when the roster is built, naming the name. `bw:45`; tests `at:120-136`. **[page]** (one sentence; resolution rules **[ref]**)
- Registering a name is not granting it: a block in a worker's `blocks/` folder is callable by that worker only once its `tools:` line lists it. `bw:47`; test `ct:170-186`. **[page]**
- The tool catalog is a map from key to block that the app passes: a file on disk can carry only a name. With none, "the built-in carries no tools at all". `aw:268-273` (`catalog`). Config path under the kit: `workforce({ agent: { catalog } })`, or the generated module's `blocks`. `aw:273`; `wk:52`, `wk:233-243`; `ks:50-61`; `tm:357-361`. **[page]**
- A worker's own block: a file `blocks/<name>.ts` inside the worker's folder, default-exported; the worker lists its name in `tools:`. `ksw/WORKER.md:1-8` (`tools: [search-docs, fetch]`); `ksw/blocks/search-docs.ts:11-20` (`export default search({ includeDomains }).as({ name: "search-docs", description })`). The generated module registers it under `workerBlocks["support.fsd"]`. `apps/kitchen-sink/workforce/workforce.gen.ts` (the `workerBlocks` map, lines 14-20). **[page]** (example 2)
- `tools:` is the one key reserved for tool names across worker flows. `bw:64`. **[ref]**
- A skill's `allowed-tools` does not widen the catalog. `bw:60`; test `at:337-372`. **[ref]**
- Controls that are not tools: the skill loader when `skills.activateTool` is on, a capability preset's `controlTools`, and the four standing-rules tools (`rules/read`, `rules/add`, `rules/change`, `rules/remove`) on a turn a user's own message started. `bw:51-58`. **[ref]**
- Search and fetch tool blocks come from `@flow-state-dev/tools` (`import { search } from "@flow-state-dev/tools/search"`). `ksw/blocks/search-docs.ts:11`. **[page]** (example 2's import)

### 3.3 Skills

- A skill is a folder holding a `SKILL.md`. `bw:128-150` (tree). Three places feed a worker on a team: `org/skills/`, `teams/<team>/skills/`, and the worker's own `skills/`; an org worker is fed by `org/skills/` and its own. `bw:130-157`. **[page]**
- A worker's skills are its own, kept in the scope of the user it runs for: two people never share one worker's copy. `bw:128`, `bw:300`; goal `g2:7` (`a:own-memory`) (a hired worker holding no skill does not answer with the standard worker's). **[page]**
- Holding a skill is not free by default: a worker that holds one is offered the load tool (`skills.activateTool`, on unless the file sets `activateTool: false`) and a listing of every skill it holds each turn, a token cost proportional to the catalog; `defaults: { skillsIndex: false }` turns the listing off. `aw:549-566`, `dl:20-45`. **[page]** (one sentence). Activation: the slash message (`/<skill> text`) activates for the turn and always works; `skills.active` lists always-on skills; `skills.activateTool` lets the model pull one mid-turn; `skills.enableLlmClassifier` adds a model call. `bw:159-183`; tests `at:521-600`. **[ref]**
- A worker that holds a skill is shown its list and a load tool with no setting, and one that holds none pays nothing; `defaults: { skillsIndex: false }` turns the list off. `dl:20-45`, `dl:61-75`; tests `dt:215-250`. **[ref]**
- Editing a skill later does not reach a worker already holding a copy; `refreshSeededSkills` from `@flow-state-dev/orchestration` pulls an edit through. `bw:185-191`. **[ref]**
- Config: `agent.skills` seeds skills every worker on the flow holds. `aw:275`; `bw` options table. **[ref]**

### 3.4 Memory

- By default the model "gets that conversation's last 50 turns and nothing said in any other". `bw:197`. The window is the framework's history window, default 50 turns (`packages/core/src/types/flow.ts:380`; `aw:1136`); test `ht:143` (at most the window of earlier turns reaches the model), `ht:95-140` (two of a worker's conversations stay apart). **[page]**
- Older turns are folded into a running summary before they leave the window, with no switch set and on the worker's own model; a worker whose `defaults` sets `historySummary: false` gets none, and `defaults: false` turns every default section off. `dl:23-28`, `dl:61-75`; tests `st:110-146`. **[ref]** (not on any existing page; **[verify]** that the page need say it; one clause is enough if the figure's conversation box needs "recent turns")
- Memory is off until the app composes it: "Memory costs tokens on every turn and latency on most of them, so it is something you switch on rather than something you inherit." `bw:197`; test `mt:230` ("carries no memory at all when the factory is called with no arguments"). **[page]**
- Under the kit, memory goes on the agent flow through `agent.uses` (the memory capability) and `agent.afterAnswer` (the write side). Both are options of `AgentWorkerFlowOptions`, which `WorkforceAgentOptions` carries whole. `aw:338`, `aw:381`; `wk:52`. The one example uses it: `uses: [mem.capability.presets({ recall: false, connect: false, semantic: true, episodic: true })], afterAnswer: mem.captureFromItems`, with `const mem = system({ model, working: { capacity: 7 }, episodic: true, semantic: true })` from `@flow-state-dev/memory`. `tm:362-363`, `tm:304`, `tm:64`. **[page]**
- Reach for `system()`, not `createMemoryCapability`: the latter builds the read side only, so the worker "looks like it remembers" and records nothing. `bw:248`; test `mt:203-229` (a fact told in one conversation is read back in the next with nothing seeded). **[ref]**, the memory page owns it; the Workforce page links.
- `afterAnswer` is the write side; without it the durable stores stay empty. It runs beside the answer and cannot change it; in a conversation a failed capture is only logged, in a task it fails the attempt. `bw:250-252`; test `mt:278` ("still answers when the post-answer step throws"). **[ref]**
- Who shares what, with the built-in: long-term memory (episodic, semantic, digest) is kept per user and shared by that user's workers on `agent`, never across people (a tier set to `org` scope is shared with the organization); working memory is per conversation, so it is one worker's; skills are per worker for each user. `bw:293-300`; test `mt:380-408`. **[page]** (answers "who owns it")
- `recall` and `connect`, memory's two tools, reach only a worker that selects them (or whose `tools:` names them through the catalog). `bw:49`, `bw:254-282`. **[ref]**
- The kit can also take capabilities for the agent flow through its `uses` slot. `wk:179`, `wk:221-224`; test `kt:114-140` (a kit's `uses` capability puts its resource on `agent`). **[page]** (section 7)

### 3.5 What goes into a worker's turn (figure 2, "A worker's turn")

The figure shows one model call receiving: the brief, the tools, memory and the conversation. What each is, from the generator's slots at `aw:1195-1245`:

- **The brief** (the instruction text), joined in this order, absent parts dropped: (1) the identity layer, (2) the team's instructions, (3) the worker's own instructions (its file's body), (4) the instructions of packages the worker holds. `aw:1195-1200`; `bw:37-41` ("Before its team's instructions and its own, every worker on `agent` is told who it is"). **[page]**
- **The identity layer** opens with the worker's name, its team and its `description`, then lists the workers it can message by name and id, and the workers that take only tasks, which it reaches by filing one; then one rule: work things out yourself first, look with tools before asking anyone, ask the user only what depends on them, and do what you can this turn. `wi:61-65`, `wi:28-34`, `wi:37-41`; `bw:39`. The list is read from the roster on every turn, so a worker hired or fired shows up or drops off on the next turn. `bw:41`. **[page]** (one sentence; the full text **[ref]**)
- A worker with no `name:` goes by the last part of its id. `bw:39`. **[ref]**
- **After the brief, as tagged context:** today's date and weekday with the server's time zone, the skills list when the worker holds a skill, and the earlier-conversation summary when one exists. `dl:12-45`; tests `dt:121-157`. A worker's `defaults` key turns each off. **[ref]**
- **Standing rules**, the notes a user has asked a worker to keep, are kept per worker and per user and read on every turn. `bw:120-122`; `standing-rules.md`. **[ref]** (the page links to "Standing rules")
- **The tools:** section 3.2.
- **Memory:** section 3.4; absent until the app adds it.
- **The conversation:** the recent turns of this conversation, at most the history window (50), none from another conversation. Section 3.4. A user's turn is kept as theirs, so a conversation holds both sides. `aw:1128-1144`; `bw:197`; test `ht:95-140`. **[page]**
- The marks the plan names: arrow `GOES INTO` (brief, tools, memory, conversation go into the model call); hatching on memory and the conversation (they are optional or window-bounded: memory is off until added, the conversation is bounded by the window); dashed outline on the turn. These are figure decisions, not facts; the facts above are what the labels may say. **[page]**

## 4. A user's own workers (hire, fork, edit, fire) and what is stored (question 2)

### 4.1 What changes when a user hires, and what does not

- A hire writes one row to the user's roster, in the organization they are signed in to. It takes effect on the user's next turn, on any of the app's processes. No restart. `dh:14-18`; `hb:1-5`; test `wt:22-31` (a hire leaves the registry's flow count unchanged, and a second host booted on the same store runs the worker on its next turn). **[page]**
- **What changes on disk: nothing in the app's files.** The `workforce/` folder is untouched, no flow is registered, and nothing restarts. The one change is the row, written to the app's configured store (whatever `stores` the app gave, for example SQLite: `tm:385`). `hb:1-5`; `wr:3-10` ("a hire, a fork, an edit and a fire are writes to the user's data"); `wt:22-26`. **[page]** (the answer to question 2)
- The row is at `workforce/workers/<id>`, user scope. `wr:3-4`; `packages/workforce/src/workers/keys.ts:12-15` (`WORKERS_PATTERN`). **[page]** (one clause; the key itself **[ref]**)
- A turn already running keeps what it started with; the next turn reads the change. `cl:217-224`. **[ref]**
- A hire is checked before it is written, the way the worker's flow checks a turn: the flow must be a worker flow not kept for standard workers, and the settings must pass the flow's schema with every name resolved. A refused write changes nothing. `hb:5-9`, `hb:146-151`; tests `wt:76-97`. **[ref]**

### 4.2 The four actions and the client

- The roster flow, `workforce-roster`, carries five actions: `hire`, `fork`, `edit`, `fire`, `reset`. `rg:129-139` (`hireWorkforce` mounts them). **[page]** (`dh:19-20` says four; the code has a fifth, `reset`)
- `hire({ id, name?, flow?, description?, instructions?, skills?, settings? })`: `flow` omitted means `agent`. `hb:28-43`; `cl:97-110`. **[page]**
- `fork({ from, id })` copies a standard worker, or one of the user's own, into a new worker of the user's own: its flow, description, instructions, its team's instructions, the names of its skills and its settings, with `forkedFrom` set. `hb:45-52`, `hb:103-120`, `hb:193-212`. The copy does not change when the files do (`wt:120-135`: a later file edit does not reach the fork); the standard worker is unchanged for everyone (`wt:137-143`); a fork starts with no conversations and the original's sessions stay with it (`wt:156-167`). A fork of a standard worker the user has edited starts from the user's copy, without its name (`wt:352-360`). **[page]**
- `edit({ id, ...fields })` replaces each field given; `settings` replaces the stored settings whole. `hb:54-69`, `hb:213-247`. The edit reaches the next turn on every host (`wt:190-198`). Moving a worker to another flow leaves its earlier sessions unable to take messages, naming both flows (`dh:77-80`); **[verify]** against a test before stating it (the code check `cl`, `hb` has no such text; the message is in the session create check, not read here). **[ref]**
- `edit` of a standard worker's id first copies it onto the user's roster under the same id, carrying the file's own name, settings, skills and team text, then applies the change. The copy is read before the file until reset. The roster lists it once, still `standard: true`, with `edited: true`. `hb:10-14`, `hb:213-247`, `hb:103-120`; tests `wt:286-310`, `wt:323-350`. Other users still see the file's version (`wt:308-310`). **[page]**
- `reset({ id })` deletes the user's copy so the next turn reads the file again. It refuses a worker that is not standard (`"<id>" isn't a standard worker ...`) and a standard worker the user has not edited (`You haven't edited "<id>" ...`). `hb:262-277`; test `wt:371-383`. **[page]**
- A standard worker keeps its file's flow: an edit that names another flow is refused (`"<id>" runs on "<flow>", as its file declares, so its flow can't be changed`); naming its own flow is no change. `hb:225-231`; test `wt:395-405`. **[ref]**
- `fire({ id })` deletes the row; the user's past sessions stay readable; a new turn on one is refused with the worker named as fired. `hb:249-260`; test `wt:169-181`. **[page]**
- A hire, a fork onto, or a fire of a standard worker's id is refused: `"<id>" is a standard worker, which nobody can <verb>. Fork it to get a worker of your own.` `hb:138-144`; test `wt:34-47`. **[page]** (one sentence)
- A hire under an id already on the user's roster is refused and nothing is written: `"<id>" is already on your roster. Pick another id. Nothing was written.` `hb:153-163`; test `wt:49-55`. **[ref]**
- An id is one path segment and cannot start with `~`. `hb:26`. **[ref]**
- The same writes exist as blocks, `createWorkerHireBlocks(installation)`, for a flow of the app's own or a model's tools. `hb:127`, `hb:279`; `dh:50-56`. **[ref]** (a hire made by a worker's own turn is a hire like any other; `dh:118-120`)

### 4.3 Hiring from the client (example 3)

- `createWorkforceClient(fsd)` wraps the app's client (`createClient({ userId, baseUrl })`); import it from `@flow-state-dev/workforce/browser`, which is browser-safe. `cl:272-277`; `br:21-29`; guard test `packages/workforce/test/browser-subpath-safe.test.ts:1-12`. **[page]**
- The client's `hire(input)` returns `{ id, flow }`. It is on `roster()` at once and its first turn runs on its row: "nothing is registered and nothing restarts". It rejects, writing nothing, for a standard worker's id or one already on the roster, a flow that is not a worker flow, or settings the flow refuses. `cl:204-211`; test `wt:234-248`. **[page]**
- Also on the client: `fork(from, id)` (`cl:212-216`), `edit(input)` (`cl:217-225`), `reset(id)` (`cl:226-231`), `fire(id)` (`cl:232-237`; refuses a standard worker, `wt:250-255`), `roster()` (`cl:127-132`), `watchRoster(onRoster, { onError })` (`cl:133-145`), `ensureWorkerSession({ worker })`, `findWorkerSession`, `listWorkerSessions`. **[page]** (the three or four the example uses; the rest **[ref]**)
- A write through the client goes to the user's workers collection, which the roster flow runs (`runBy`): no roster session is found or made. `cl:7-12`, `cl:297-310`; `wr:84-88`. The roster flow's actions are also reachable by sending to a roster session, `fsd.flow("workforce-roster")` (`dh:19-30`; test `wt:22-26` uses `rosterAction`). **[ref]** (the page uses the client)
- `watchRoster(onRoster)` hands over the roster once read, then again each time a hire, fork, edit or fire (from any tab or any worker's turn) changes it; it reports only a change; a failed read goes to `onError` and is retried on its own; it returns a stop function. A change shows within about a second on a host that pushes, and every three seconds where push can miss one. `cl:133-145`; `dh:116-138`; tests `packages/workforce/test/watch-roster.test.ts:68-139`. **[page]** (one sentence; timings **[ref]**)
- A roster row (`RosterEntry`): `id`, `flow`, `standard`, `description`, `name`, `teamName`, `forkedFrom`, `edited`, `settings` (only the settings the worker's flow chooses to show). `cl:54-84`. **[ref]**; the page names `id`, `flow` and `standard`.
- A browser-side session of `fsd.flow(session.flowKind)` carries a turn: `send("respond", { message }, { sessionId })`. `packages/workforce/README.md` ("To talk to it"), `cl:171`. **[ref]**
- The example type-checks against `HireWorkerInput` (`cl:97-110`): `workforce.hire({ id: "scribe", instructions: "Take short notes." })` is a legal call (`flow` defaults to `agent`). `fsd` comes from `createClient` in `@flow-state-dev/client` (`dh:24`). **[page]**

### 4.4 The four questions, for each stored part

| Stored part | Who owns it | Who can see it | Where it is stored | How many exist |
| --- | --- | --- | --- | --- |
| A standard worker (a `WORKER.md`) | The app: its files. `sw:3-12` | Every user has it, the same for everyone who has not edited it. `sw:3-12`, `dh:10`; `wt:137-143` | In the app's `workforce/` folder only. Nothing stores it: "They are read from the loaded files each time, so a deploy that changes a file changes the worker for everyone who hasn't edited it." `sw:6-8` | One per file. No cap stated. |
| A user's own worker (hired or forked) | The user, in the organization they are signed in to. `wr:3-15` | Only its owner: another user can't list it, open its sessions, message it or create a session with it, and asking for another user's worker gets the answer for one that does not exist. `dh:99-104`; tests `wt:57-67` (two users' `scribe`s are two workers), `wt:69-74` (not on the same user's roster in another organization); goal `g2:8` leg (b). A browser reads its `flow`, `name`, `description`, `forkedFrom` and the settings its flow chooses to show; its other settings and its instructions stay on the server. `wr:69-75` | One row per worker, user scope, key `workforce/workers/<id>`, in the app's configured store. `wr:3-4`, `wr:82-89`; `dh:106-108`. A user in two organizations has a separate roster in each. `wr:12-14`; `dh:104-105` | One per hire or fork, per user, per organization. **[gap]** no limit is stated or enforced in `hb`. |
| A user's copy of an edited standard worker | The user | Only its owner; every other user still gets the file's version. `wt:308-310` | One row at `workforce/workers/<id>`, the standard worker's own id. `hb:10-14`; deleted by `reset`. | At most one per standard worker, per user. |
| A worker's skills (built-in `agent`) | The worker, for each user. `bw:128`, `bw:300` | Only that user's copy. Two people never share one worker's. | Kept by the built-in in the user's scope, partitioned by worker. `bw:128`; goal `g2:7` (`a:own-memory`) | One set per worker, per user. |
| Working memory | The conversation | The worker running it, for that conversation. `bw:298-299` | With the session. | One per conversation. |
| Long-term memory (episodic, semantic, digest), once added | The user, at the default `user` scope | Every worker the user has on `agent`; never another user's. A tier set to `org` scope is shared with the organization. `bw:293-297` | In the user's scope in their organization. | One per tier, per user. |
| Standing rules | The worker, for the user | Per worker and per user. `bw:120-122` | `standing-rules.md` **[ref]** | One set per worker, per user. |
| A session (a conversation, a task) | The user | The user. `ov:16` ("every session is yours alone") | The app's session store. | One per conversation, one per task, one lasting one per workstream a worker leads. `ov:18` |
| The roster's routines, messages, inventory | **[ref]** | **[ref]** | **[ref]** `rf:13-20` | **[ref]** |

## 5. Views the kit serves (question 3)

A view answers one question from stored data; it never writes (see `pages/concepts/views.facts.md`). The kit serves these:

- **On `workforce-roster`, at user scope with no session:**
  - `roster`: the user's workers, their own and the standard ones, joined on the server and keyed by worker id. A standard worker the user has edited is listed once, as their copy, still standard and on its file's team. The answer is typed (`id`, `flow`, `standard`, `description`, `name`, `teamName`, `forkedFrom`, `edited`, `settings`). `rf:69-70`; `rv:1-14`, `rv:21-37`, `rv:54-62`; `packages/workforce/src/workers/keys.ts:143-145`. A hire, edit, fork or fire reaches its watchers without the app naming a topic. `rv:10-12`. A user who has opened no session still has an answer: goal `g3:8` (`a:roster`) ("read by a user who has opened no session ... and the read makes no session"). **[page]**
  - `workerUsage`: how many tokens each of the user's workers used, by model and coding harness, over the last `days` UTC days (1 to `WORKER_USAGE_MAX_DAYS`, a default when omitted). A read of the user's own records; no model call. `rf:71`; `wu:283-284`, `wu:293-319`; `keys.ts:147-149`. **[page]** (the name and one clause; options and shape **[ref]**, the existing page is `worker-usage.md`)
  - `workstreamReport`: one workstream entry's latest report; a shared project's entries are the organization's, a private one's the user's. `rf:73`; `packages/workforce/src/projects/workstream-report-view.ts:1-48`; `keys.ts:151-153`. **[ref]**
  - `routines`: the user's routines, with the app's declared ones joined in. `rf:75`; `packages/workforce/src/routines/routines.ts:839-850`; `rg:142`. Always mounted: `hireWorkforce` passes `routines.view` on every install (`rg:132-142`). **[ref]**
- **On `agent` (and on `coordinator`, when configured):** `listTasks_tasks`, a session view of the conversation's task list, keyed by task id. `aw:1528`; `packages/workforce/src/conversation-board/board.ts:2066-2070`; `packages/orchestration/src/skills/views/task-list-view.ts:42-58`; the id `tasks` is `packages/workforce/src/conversation-board/ledger.ts:61`; coordinator `packages/workforce/src/coordinator/coordinator-flow.ts:1791`. It reads for one session; a session with no board to list is refused `no_delegation_board`. **[page]** (name it and say a task board screen watches it; mechanics **[ref]**)
- **Client handles:** `rosterView` and `workerUsageView`, exported from `@flow-state-dev/workforce/browser` for `useView`/`client.view`. `br:30-31`; `cl:313`. **[page]**
- **Views the kit does not serve:** the `readiness` view belongs to `harnesses`, not workforce (`harnesses-kit.ts:16-17` per K-01 fact 3.6). The project views are not in the roster flow's `views`; the `checkRepository` view is on the app's own projects flow (`packages/workforce/src/projects/project-writes.ts:549`, `test/projects.test.ts:592-593`). Workforce serves no projects flow of its own: "Workforce ships none of its own" for the `flows` slot. `wk:22`. **[page]** (one clause so a reader does not look for them)
- **What the screens are:** components exist at `@flow-state-dev/workforce/react`: `Roster`, `WorkerDetail`, `BoardColumns`, `BoardList`. `packages/workforce/src/react/index.ts:1-33`. They read collections through a session; see flag 5. **[ref]** and **[verify]**.

Answer to question 3, for the page: the roster flow serves `roster`, `workerUsage`, `workstreamReport` and `routines`; the agent flow (and the coordinator flow when configured) serves the conversation's task list as `listTasks_tasks`.

## 6. What a worker can find (discovery)

All facts here concern the `discover` tool. Flag 1 and 2 say it is not on by default under the kit and does not list a runtime hire.

- `discover` is one tool call that returns a short list of what is in scope for the agent now: the workers it can hand work to, the skills it can load, and the resources it can read. `di:9`; `wc:1-12`. **[page]**
- Three domains exist: `workers`, `skills`, `resources`; each is a source computed when the agent asks. `di:46`; `core-d:112-153`; `packages/contracts/src/types/manifest.ts` (`MANIFEST_DOMAINS`). **[page]**
- Calls: `discover({})` for everything in scope, `discover({ domain: "workers" })` for one domain, `discover({ detail: "full" })` to add each entry's `contract`. Default detail is thin. `di:19-42`; `core-d:102-128`. An entry carries `id`, `kind`, `purpose`, optionally `contract`. `core-d:46`; `di:29-42`. **[page]**
- A call with a domain that does not exist comes back naming the three real ones. `di:107`; `core-d:139-140`; test `wdt:155`. **[page]**, a clause.
- A domain with no entries returns an empty list, an ordinary answer; one domain failing to read does not stop the others. `di:101-105`. **[ref]**
- What `workers` lists: a worker that a `WORKER.md` declares and the inventory also holds a row for; a worker whose file is gone does not appear. `mf:20-25`, `mf:157-189`; test `packages/workforce/test/manifest-sources.test.ts:59-92`; `di:109-111`. A `purpose` is the worker's `description:` (or its instructions, or `The worker "<id>". Its file declares no description.`). `mf:95-105`; test `manifest-sources.test.ts:102-105`. **[page]** (one sentence; see flag 2)
- Discovery never widens reach. A domain appears only if the flow's scope carries it; a skill marked `disable-model-invocation` and a resource collection a model may not read are absent, not listed-and-marked. `di:88-90`; `wc:14-26`. **[page]**
- A worker's file narrows what it sees with `discover: [workers, skills]`; naming a domain the scope does not carry adds nothing; an empty list means nothing at all; omitting the key leaves every domain in scope. `di:92-101`; `aw:645`; tests `wdt:109-155` ("sees nothing at all when its file names an empty list" `wdt:141`; "BR-11 does not reach a domain its scope lacks by naming it" `wdt:123-131`); a misspelled domain is refused naming the three (`wdt:186`). **[page]**
- Composing it: `createWorkforceCapability({ roster, inventory, sources })` into the flow's `uses` gives every worker on the flow `discover`. `roster` is `{ workers: readonly WorkerManifest[] }` (what `readDeclaredRoster` returns also fits); `inventory.workers` names the registry key the worker inventory is mounted under; `sources` adds other domains' sources (`skillsManifestSource`, `resourcesManifestSource`). `wc:43-71`, `wc:83-95`; `di:46-75`; `mf:63-79`. **[ref]** (the options table belongs on `reference/workforce`; the page shows no composition code because of flag 1)
- Outside a workforce, `discoveryTools(createManifestRegistry([...]))` builds the door by hand. `di:77-83`. **[ref]**
- It is not the resource manifest (what a browser may do with a session's resources) and not installation (what an app has). `di:140-144`. **[page]**, a clause.
- Moving skills from the prompt to the door (`skills.with({ dynamicActivation: true, catalogContext: false })`, order matters). `di:111-141`. **[ref]**
- Why use it over a prompt list: the list in a prompt is paid for on every step; discovery returns the list only when asked, and reads at the moment it asks. The tool's own definition is still sent with the worker's other tools, so the cost is small, not zero. `di:13-17`; `core-d:112-159`. **[page]**, one sentence, as the reason to want it.

## 7. Slots it opens (question 4), and slots it fills

- **Opens three slots.** `workforce.slots.workerFlows` (keyed), `workforce.slots.uses` (list), `workforce.slots.flows` (keyed). `wk:177-181`; header `wk:11-22`. **[page]**
- **`workerFlows`: add a kind of worker.** Entries are worker flows beside the built-in `agent`, each "an entry as `workerFlow(…)` builds one", so a flow that needs the installation receives it. A worker's file picks one with `flow:`. A flow, `{ flow }`, or a `workerFlow(...)` builder is accepted. `wk:11-16`, `wk:150-153`; `wf:1-22`, `wf:46-60`. **[page]** (the answer to question 4)
  - An entry keyed `agent` or `coordinator` replaces the kit's own, which is then not configured; configuring `agent` as well as supplying an `agent` entry is refused ("Keep one"). `wk:16-17`, `wk:205-216`; `kt:166-175`. **[ref]**
  - The generated module's `workerFlows` and the slot's must not both hold one name; refused `wk:197-202`. **[ref]**
  - `harnesses` fills it with `coder`; the test `kt:114-140` fills it with a `helper` flow the roster's `flow: helper` worker runs on, and then `state.meta.flowKeys` is `["agent", "helper", "workforce-roster"]`. `harnesses-kit.ts:105`; `kt:114-140`. **[page]** (one example of the slot's use)
  - A worker flow must declare the installation's session and accept the worker's configuration or `hireWorkforce` refuses it, naming each. `rg:71-81`, `rg:97-111`. **[ref]**
- **`uses`: add a capability to the agent and coordinator flows.** `wk:18-19`, `wk:221-224`. A kit may contribute `[workforce.slots.uses]: [capability]`; test `kt:114-140` asserts the resource appears on `agent`. `harnesses` adds its readiness capability this way (`harnesses-kit.ts:106`). **[page]**
- **`flows`: serve flows built on the installation.** Each entry is a builder handed the installation; the kit serves what it returns beside its worker flows. Workforce ships none of its own. `wk:20-22`, `wk:277`; test `kt:142-164`. **[page]** (one sentence)
- The app can fill any slot itself with `fill`: `createFlowState({ kits, fill: { [workforce.slots.flows]: { projects: (installation) => [...] } } })`. `kt:145-164`; `ety:140-145`. **[ref]**
- A kit that fills a slot is listed after naming workforce in `requires: [workforce]`, and writes `contributes: () => ({ [workforce.slots.workerFlows]: { helper: workerFlow(helperFlow) } })`. `kt:123-133`. **[ref]** (`reference/kits`; K-01 and C-12 own the contract)
- **Fills no slots.** Workforce requires no kit (flag in section 1).
- `internalEventsOf(installation)` and the kit's `internalEvents` config let a worker flow built on the installation publish internal events. `ki:8-10`; `wk:96-97`, `wk:268-270`, `kt:256-290`. **[ref]**

## 8. Examples (the three the plan names)

The page's one app is `help-desk` (the pilots' cast; `docs/contributing/user-docs.md` "Code examples"). Each example type-checks against the signatures below.

1. **`workforce({ directory })`.** `createFlowState({ kits: [workforce({ directory })], stores })` is legal: `directory` is the factory argument every folder-owning kit accepts (`dk:90-91`), and `agent`, `stores` are real (`wk:171-172`, `kt:31`, `kt:77`). With the default folder the call is `workforce({})`. The model default is `intent/chat` unless `agent: { model }` (`aw:473`). Example from the app: `fsdev.config.ts` default-exports `createFlowState({ kits, stores })` (`examples/hello-chat/fsdev.config.ts:15-21`, per C-12's sheet `kits-and-slots.facts.md` fact 1). The model string in examples is `openai/gpt-6-luna` (`wk:172`). **[page]**
2. **A worker with tools.** A worker file `workforce/teams/support/workers/billing/WORKER.md` with `tools: [lookUpOrder]` and a block `workforce/teams/support/workers/billing/blocks/look-up-order.ts` that default-exports a block. The shapes are `ksw/WORKER.md:1-8` and `ksw/blocks/search-docs.ts:11-20` (a default export; the file's name is not the tool's name unless the block is named so: `.as({ name: "search-docs" })`). `fsdev gen` writes `workforce.gen.ts`, and the app passes `generated` (`ks:38`, `ks:56`). **[reconcile]** the example's block must be a real block: `handler({ name, inputSchema, outputSchema, execute })` from `@flow-state-dev/core` (`wt` harness; `ct` tests use `handler`). For the layout rule "one export per block file named after the file" (`user-docs.md`), the generated convention uses a default export (`ksw/blocks/search-docs.ts:16`); **[verify]** which the page shows. With a catalog instead, `agent: { catalog: { lookUpOrder } }` (`aw:273`; `tm:357-361`). A `tools:` line is a fence: the worker may call only what it lists (section 3.2).
3. **Hiring from the client.** `createWorkforceClient(fsd)` from `@flow-state-dev/workforce/browser`, then `await workforce.hire({ id: "scribe", instructions: "Take short notes." })` returning `{ id: "scribe", flow: "agent" }`, then `watchRoster`. Signatures `cl:97-110`, `cl:126-145`, `cl:211`, `cl:277`; test `wt:234-248`. `fsd = createClient({ userId, baseUrl })` from `@flow-state-dev/client` (`dh:24`). **[page]**

## 9. Neighbours and what the page links to, not explains

- The model (a worker, the file, who owns it, what runs it): C-22, the Workers concept page. Pilot `docs/contributing/docs-revamp/pilot/workers.md:10-120`. The page names none of it again; it uses "worker", "standard worker", "roster", "fork" as the glossary defines them. **[page]** (link)
- Kits and slots (what a kit declares, order, the folder claim): C-12, `pages/concepts/kits-and-slots.md`. **[page]** (link)
- Views: C-?, `pages/concepts/views.md`; the roster view's own text is on Views (`views.facts.md:140-175`). **[page]** (link)
- Hire options, inventory, usage, discovery output: `reference/workforce`. File settings: `reference/worker-md`. Both **[ref]**.
- The harnesses kit, claude-code, the starters (Teammates, Claude Code-style, Shift Manager): the Catalog index (K-01) and their own pages. Teammates is the one example that installs `workforce` with memory, a tool catalog, routines and GitHub: `tm:348-398`. **[page]** (link only)
- Hiring and forking, the built-in worker, inventory, worker usage, discovery and UI are existing pages the plan folds into this page or into Reference: `dh`, `bw`, `inv`, `worker-usage.md`, `di`, `ui`. Items from each that the page keeps are listed above; what is left goes to Reference.

## 10. Words to use and not use

- Say **worker flow** for the flow a worker runs on, never "type". Say **worker** for one configured agent a user talks to. Say **roster** for the workers one user has, standard ones included. Say **standard worker** and **fork** as the glossary defines them. `docs/contributing/glossary.mjs:484-524`.
- `agent` is the built-in worker flow's name. Say "the built-in agent" for the flow and "a worker" for a configured one; do not call the flow "the agent worker" in prose that also says "worker".
- Do not say "installation", `hireWorkforce`, `createWorkerInstallation` or `readDeclaredRoster` as the way to install workforce: under the kit no app calls them (goal `g3:4`).
- Do not describe how the kit's folder reader, claim pass or hire step is built; only what a caller sees.

## 11. Answers to the plan's four questions (for the cold-read key)

1. **A worker whose file names no flow** runs on the built-in `agent` worker flow, one registered copy shared by every worker that runs on it; the file's body is its instructions; its model is the file's `model:`, else `agent.model`, else the app's `intent/chat`. `bw:13`, `bw:33`; `aw:473`; `at:60-69`; goal `g1:5-19`.
2. **A user hires a worker while the app runs:** nothing on disk changes (no file in `workforce/`, no flow registered, no restart). One row is written to that user's data in the app's store, at `workforce/workers/<id>`, in the organization they are signed in to. It is read on the user's next turn by any process, and no one else can reach it. `hb:1-5`; `wr:3-15`; `wt:22-31`, `wt:57-74`; `dh:14-18`, `dh:99-114`.
3. **Views:** `roster`, `workerUsage`, `workstreamReport` and `routines` on the roster flow; `listTasks_tasks` on the agent flow (and the coordinator's flow, when configured). Section 5.
4. **To add a kind of worker, a kit fills `workforce.slots.workerFlows`** (a keyed slot of worker flows; a worker's file selects one with `flow:`). `wk:177-181`; `harnesses-kit.ts:105`; `kt:114-140`.

Edge cases for the questions' second half (a failure, a second user, an edit):

- A second user hires under the same id: two separate workers, neither sees the other's. `wt:57-67`.
- A user edits a standard worker: they get their own copy under the same id; other users still get the file's. `wt:286-310`. `reset` returns it to the file; `reset` on an unedited one refuses. `wt:371-383`.
- A user fires a worker they were talking to: the past sessions stay readable; a new turn is refused naming the worker as fired. `wt:169-181`.
- A hire naming a skill or tool nothing registers, or an id already taken: refused, nothing written. `hb:147-162`; `wt:49-55`, `wt:98-118`.
- A stray file in `workforce/`: the app does not start, naming the file. `kt:82-102`.

## 12. Existing-page contradictions to fix at Reference (not on this page)

- `dh:10-12`, `dh:93`: standard worker "nobody can change", edit refused. Code: edit copies; `reset` exists (flag 3).
- `dh:25-27`: "four actions"; the roster flow carries five (`rg:134-139`).
- `dh:130-131`: roster rows are `{ id, flow, standard, description }`; the entry has nine fields (flag 4).
- `ui:10`, `ui:13`: components from `@flow-state-dev/react`; they are in `@flow-state-dev/workforce/react` (flag 5).
- `di:13-15`: discovery's argument that a worker hired a minute ago is not in a boot-time prompt is true; discovery's `workers` domain also omits a runtime hire (flag 2).
- `ov:56-77` and `bw:13-33` install workforce through `createWorkerInstallation` and `hireWorkforce`; the kit replaces both for an app (goal `g3:4`). The pages predate the kit; the Reference keeps them as the lower-level door. **[verify]** with the caller which door the docs call primary.

## 13. Revise round 1 additions

- Install example 2 passes `generated` (`import * as generated from "./workforce/workforce.gen"`; `workforce({ generated, ... })`): `ks:38`, `ks:56`; `wk:60-76`. The module exports `workerFlows`, `blocks`, `resourceModules`, `workerBlocks`, `packageBlocks` (`apps/kitchen-sink/workforce/workforce.gen.ts:15-28`). **[page]**
- Stray-file rule on the page: every file must be a `WORKER.md`, `TEAM.md`, `SKILL.md` or a code file the layout names (`kt:82-102`; section 1 folder list). **[page]**
- Refusal shape: hire/fork/fire on a standard id and hire on an existing id throw `Error` with the id and "Nothing was written" (`hb:138-144`, `hb:153-158`); the client rejects with it (`cl:292-295`). **[page]**
- Discovery: enabling takes `createWorkforceCapability({ roster, inventory })` in the agent flow's `uses`, not one line (`wc:43-71`); the page names it and links to Reference. Hired workers absent from `workers` and domain output moved to Reference. **[ref]**
- Stored-parts table on the page drops the `Where` column (`wr:3-4`, `hb:10-14`): Reference.

## 14. Revise round 2 additions

- A user's own workers are per (user, organization): a user in two organizations has a separate roster in each. `wr:12-14`; `packages/workforce/src/workers/worker-row.ts:12-13`. The page states it in one sentence under the stored-parts table. **[page]**
- `discover` costs tokens only when called, beyond its own tool definition. **[page]**
- `createWorkforceCapability` goes in `agent.uses`, the same door as memory (`wk:52`, `aw:338`). **[page]**

## 11. Added after the loop: facts for the opening

- The harnesses kit requires workforce and fills its `workerFlows` slot with the `coder` flow. `packages/harness-manager/src/kit/harnesses-kit.ts:9-12,88-105`. **[checked]**
- Every starter in the catalog installs the workforce kit: `catalog/starters/claude-code-style.md:52,65`, `catalog/starters/teammates.md:102,115`; Shift Manager is worked over a workforce app (`packages/shift-manager/test/workforce.test.ts`). **[checked]**
- The error reporter "turns a failure that stayed failed, or a problem a user describes, into one reproducible bug report, previewed to the operator in Inbox". `packages/workforce/src/error-reporter/index.ts:3-6`. **[checked]**
- `Roster`, `BoardColumns`, `BoardList` and `WorkerDetail` come from `@flow-state-dev/workforce/react`. `packages/workforce/src/react/index.ts:11-30`. **[checked]**
- A `tools:` line does not fence control tools: `sendMessage` (`messages/message-tool.ts:122-123,163`), standing-rule tools on a user turn (`standing-rules/rules-capability.ts:136`), the conversation board's task tools while a delegate takes tasks (`conversation-board/board.ts:1961`). **[checked]**

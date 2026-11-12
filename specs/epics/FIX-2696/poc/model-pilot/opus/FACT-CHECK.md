# Fact check: `compare/x/*.md`

Baseline: `main` at `d63b4e5c`. Kits (`defineKit`, `slot`, `createFlowState({ kits, fill, root })`, `flows` as an array) are **already built** (FIX-2626: `packages/core/src/kit/define-kit.ts`, `packages/engine/src/flowstate/kits.ts`, `types.ts:117-150`). The workforce kit, the `harnesses` kit and harness values (FIX-2627) are **not built**; those claims are checked against `specs/issues/FIX-2627/` and the epic. The roster view, `useView`, the workforce client and the task board are on `main` and are checked against code.

Paths are relative to `/home/user/flow-state-dev/`.

## what-flow-state-is.md

| # | Claim (page line) | Verdict | Evidence |
|---|---|---|---|
| 1 | The server runs workers, streams answers to the browser and keeps data in your own database (14) | RIGHT | |
| 2 | On a store that persists, a run is picked back up after a crash (14) | RIGHT | `packages/engine/src/flowstate/types.ts:305-319` (durable on by default over persisting stores) |
| 3 | One server entry, `createFlowState`, names kits, flows and stores (22) | RIGHT | `types.ts:117-190` |
| 4 | `createFlowState` from `@flow-state-dev/engine`; `sqliteStores({ filename })` from `@flow-state-dev/store-sqlite` (25-26, 37) | RIGHT | `packages/store-sqlite/src/registry.ts:36,95` |
| 5 | `import { workforce } from "@flow-state-dev/workforce"` (27) | UNSUPPORTED | Not built. FIX-2627 names the `workforce` kit (`DECISIONS.md` "Names") but no entry point for it. The root is the only plausible server entry (`FIX-2626/DECISIONS.md` "Placement") |
| 6 | `import { harnesses } from "@flow-state-dev/harness-manager"` (28) | **WRONG** | `specs/issues/FIX-2627/DECISIONS.md` "The harness kit": the kit is exported from `@flow-state-dev/harness-manager/kit`, and "Only that subpath imports workforce". `FIX-2627/SPEC.md` lists "importing `@flow-state-dev/harness-manager` pulls in workforce" under *Not done if* |
| 7 | `workforce({ model: "openai/gpt-6-luna" })`, with the model at the top level (33) | UNSUPPORTED | The specs disagree. `FIX-2627/SPEC.md` (the host diff) puts it under `agent`: `workforce({ directory, agent: { model, uses } })`, and its DECISIONS say "The agent and coordinator flows' options are config". `FIX-2626/SPEC.md`'s sketch (`config: z.object({ model })`) and the JSDoc at `packages/core/src/kit/define-kit.ts:5` / `engine/src/flowstate/types.ts` (`kits` doc) show `{ model }` |
| 8 | `harnesses({})` is a valid config (34) | UNSUPPORTED | `FIX-2627/SPEC.md` passes `harnesses({ workspace, defaultHarness, review, checks })`. Its DECISIONS say the coder "runs where the harness kit's `workspace` says". Nothing says `workspace` is optional |
| 9 | `flows: [triageFlow]`, an array (36) | RIGHT | `types.ts:119-124` |
| 10 | Omit `stores` and the app runs in memory, lost on restart (41) | RIGHT | `types.ts` `stores` doc |
| 11 | A host adapter (Node, Next.js or Vercel) serves it; `fsdev` runs its flows (41) | RIGHT | `packages/node`, `packages/next`, `packages/vercel` |
| 12 | Screens read through hooks each kit's package exports (43) | RIGHT | `FIX-2626/DECISIONS.md` D1 |
| 13 | A kit is a feature installed with one config object (47) | RIGHT | `define-kit.ts:1-17` |
| 14 | The workforce kit gives every user a roster of workers (47) | RIGHT | FIX-2627 goal |
| 15 | The harnesses kit runs Claude Code, Codex and Cursor on a checkout (47) | RIGHT | Epic `DECISIONS.md` O1 "The harness shape" |
| 16 | A kit carries its flows, their data and the screens' hooks (47) | RIGHT | FIX-2626 D1 |
| 17 | "Kits build on each other without knowing about each other" (49) | **WRONG** | The filling kit names and imports the owner. `harnesses` has `requires: [workforce]` and contributes under `workforce.slots.workerFlows` (`FIX-2626/SPEC.md` sketch; `FIX-2627/DECISIONS.md` "The harness kit"). A fill from a kit that doesn't require the owner is refused (`engine/src/flowstate/kits.ts:140`). Only the slot owner is unaware of who fills it |
| 18 | A slot is a typed place other kits fill (49) | RIGHT | `define-kit.ts` `slot.keyed` / `slot.list`, each with a schema |
| 19 | Workforce opens a slot for its workers' flows (49) | RIGHT | `FIX-2627/DECISIONS.md` "Workforce's slots" (`workerFlows`) |
| 20 | Harnesses fills it with a coding worker flow, so with both kits in the list a worker can name that flow and write code (49) | **WRONG** (as stated, and the example shows it) | The harness kit has no harnesses of its own. Each one goes into its keyed `harnesses` slot: `claudeCode()` is a separate kit, and Codex and Cursor go in through `fill` (`FIX-2627/SPEC.md` host diff; DECISIONS "The harness value"). Listing `harnesses({})` and `workforce(...)` alone puts no harness behind `coder` |
| 21 | List order doesn't matter (49) | RIGHT | `kits.ts:55-80` |
| 22 | The same key twice in one slot is refused, naming the problem (49) | RIGHT | `kits.ts:191` |
| 23 | A kit that requires an uninstalled kit is refused (49) | RIGHT | `kits.ts:66` |
| 24 | Both refusals stop the app starting (49) | RIGHT | They throw `FlowStateConfigError` at construction (`kits.ts:47-53`) |
| 25 | The workforce kit owns `workforce/` (51) | RIGHT | `FIX-2626/SPEC.md` sketch `directory: { path: "workforce" }` |
| 26 | A worker is `teams/<team>/workers/<name>/WORKER.md` (53) | RIGHT | `packages/workforce/src/loader/read-workforce-directory.ts:4-7` |
| 27 | Frontmatter takes `description` and `model` (55-56) | RIGHT | `read-workforce-directory.ts:258`; `agent-worker-flow.ts:468` |
| 28 | The kit reads the folder when the app starts (62) | RIGHT | `kits.ts:12-14` (`installKits`, at start-up) |
| 29 | A file the kit doesn't understand stops the app starting, named (62) | RIGHT | `kits.ts:285-288`; FIX-2626 D2 |
| 30 | A flow is actions plus shared state; an action takes typed input and runs one block (66) | RIGHT | `packages/core/src/types/flow.ts:227-238` |
| 31 | A session keeps its own state and its items (66) | RIGHT | |
| 32 | `defineFlow({ kind, actions: { triage: { block } } })()` (74-79) | RIGHT | `core/src/flow/defineFlow.ts:1644-1660` (returns a factory) |
| 33 | `npx fsdev run triage triage -i '<json>'` (85) | RIGHT | `packages/fsdev/src/commands/run.ts:132-134` |
| 34 | It runs with no server or browser, streaming the same items (82) | RIGHT | `run.ts` (NDJSON) |
| 35 | Five block kinds (92-98) | RIGHT | |
| 36 | Each kind's description: handler, generator, evaluator, sequencer (order, parallel, loop), router (94-98) | RIGHT | `blocks/evaluator.ts:1-7`; `blocks/sequencer.ts:1334,1473,1740,1834` |
| 37 | Generator fields `name, model, prompt, inputSchema, outputSchema, user: (input) => …` (112-119) | RIGHT | `blocks/generator.ts:599-612` |
| 38 | A handler takes `sessionStateSchema`; `ctx.session.state` and `patchState` (121-128) | RIGHT | `blocks/handler.ts:85`; `types/state.ts:35`; `types/scope.ts:246` |
| 39 | `sequencer({ name, inputSchema }).step(classify).tap(countTriaged)`, where `tap` keeps the verdict as the output (130-132) | RIGHT | `sequencer.ts:2004` |
| 40 | There is no `agent()` function (135) | RIGHT | No such export in `core/src/index.ts` |
| 41 | Every kit is built from the five kinds (135) | RIGHT | A kit's install returns flows (`define-kit.ts` `KitInstallation`) |
| 42 | A worker's instructions, model and tools are all in `WORKER.md` (141) | RIGHT | `workforce/src/manifest.ts:431-434` ("A worker names its tools in `tools:`") |
| 43 | Add a kit to `kits` with its config (142) | RIGHT | |
| 44 | Change a kit for your app by filling a slot or changing config, with no fork (143) | RIGHT | `types.ts` `fill` |
| 45 | Your own flow goes in `flows`, served beside the kits' flows (144) | RIGHT | `types.ts` `kits` doc |
| 46 | A worker can run on a flow you wrote (145) | RIGHT | `flow:` key; `hire-blocks.ts:35` |
| 47 | It isn't a hosted service (151) | RIGHT | |
| 48 | "Each [model call] is a generator or an evaluator in a flow you can open" (152) | **WRONG** | A harness run calls its model through a handler. `packages/claude-code/src/sdk/agent.ts:3` ("handler block running the Claude Code Agent SDK in-process") and `:952` (`handler({`). The page's own harnesses kit runs these |
| 49 | A kit reaches another kit only through the slots that kit opens (153) | RIGHT | `kits.ts:136-140` |

## tasks-and-boards.md

| # | Claim (page line) | Verdict | Evidence |
|---|---|---|---|
| 1 | A task is a goal, an assignee and its dependencies (14) | RIGHT | `orchestration/src/tasks/schema/task-init.ts:22-39` |
| 2 | A board is a stored list plus the loop that works it, handing each ready task to its assignee (14) | RIGHT | `task-board/index.ts:1-35` |
| 3 | The loop stops when every task is done or nothing left can run (14) | RIGHT | `index.ts:44-53` (`complete-or-blocked` default) |
| 4 | `taskBoard` from `@flow-state-dev/orchestration/task-board`, taking `name`, `workers` (registry) and `initialTasks` (17-29) | RIGHT | `orchestration/package.json` `./task-board`; `index.ts` options (`name`, `workers`, `initialTasks`) |
| 5 | `board.drain` is a block, used as `.step(board.drain)` (31, 42) | RIGHT | `index.ts` `drain: SequencerDefinition` |
| 6 | acme and globex run side by side, and compare reads both from `input.deps`, keyed by task id (34) | RIGHT | `tasks/workers/types.ts:62-73` |
| 7 | Tasks are data: goal, status, assignee, input and output (40) | RIGHT | `tasks/schema/task.ts` |
| 8 | By default tasks last one request (40) | RIGHT | `index.ts` collection doc (request-backed default) |
| 9 | Kept in a collection at session, user or org scope, they last across requests (40) | RIGHT | `tasks/collection/define-task-collection.ts:114` |
| 10 | The drain works only inside a request; a task added elsewhere wakes nothing (42, 111) | RIGHT | `index.ts` header |
| 11 | `createTask` files a task with a goal, assignee and deps (50) | RIGHT | `skills/task-tools-capability.ts:1363` |
| 12 | `listTasks` and `getTask` read the board (51) | RIGHT | `:1889`, `:1946` |
| 13 | `updateTask` changes a task before it starts, messages a running one, or cancels one (52) | RIGHT | `:1550-1560` |
| 14 | No tool marks a task done; it ends when its assignee returns or throws (54) | RIGHT | The claimless `done` field only answers a confirm (`:1578-1584`) |
| 15 | Once a task starts, what it was asked is fixed (54) | RIGHT | `:1550` description |
| 16 | One assignee holds a task at a time; a pending task is claimed only when its deps completed and nothing holds it (60) | RIGHT | `index.ts:69-75` |
| 17 | Ready tasks go in filing order, or by priority (60) | RIGHT | `index.ts` `claimOrder` ("fifo" default, "priority") |
| 18 | A dead claim runs out after about two minutes (62) | RIGHT | `tasks/collection/internal.ts:1131` (`DEFAULT_LEASE_DURATION_MS = 120_000`) |
| 19 | A task abandoned this way three times ends `errored` (62) | RIGHT (nuance) | `internal.ts:516-524,1093-1095`: three recoveries are allowed and the row settles `errored` on the next lapse. The code's own error text says "abandoned 3 times" (`:1105`) |
| 20 | Up to four tasks run at once unless you set `concurrency` (64) | RIGHT | `index.ts` `concurrency` ("Default: 4") |
| 21 | On a plan board each task runs inside the drain, and the drain waits on each (68) | RIGHT | `index.ts:38-41` |
| 22 | A board can hand every task to another session and wait on none (70) | RIGHT | `index.ts:38-41` (`delegation`) |
| 23 | A workforce coordinator's conversation keeps a board; each task runs in a session of the assigned worker and the conversation hears the result (70) | RIGHT | `workforce/src/conversation-board/board.ts:8-14` |
| 24 | A task with unfinished deps stays `pending` (76) | RIGHT | |
| 25 | When a dep fails for good or is cancelled, its dependents are cancelled, each naming the cause (76) | RIGHT | `task.ts` `causedBy` |
| 26 | A task asking a person keeps its place and nothing else claims it (78) | RIGHT | `index.ts:62-68` |
| 27 | The answer can come from the inbox, a line in the task's session, or the filer (78) | RIGHT | `task-tools-capability.ts:1550-1560` (the filer answers only midway questions) |
| 28 | After the answer the task gets one more turn on the same attempt, from its brief and the answer (78) | RIGHT | `task-board/task-request.ts:847` |
| 29 | A task can be filed held and waits for a release (80) | RIGHT | `task-init.ts:68`; `task-tools-capability.ts:30` |
| 30 | A coding task can wait for its PR to merge while the board moves on (82) | RIGHT | `task-board/blocks/board-meta.ts:215-217` |
| 31 | `getTask` with `wait: true` pauses until the task ends or a deadline passes; otherwise the ending arrives as a notice (84) | RIGHT (nuance) | `task-tools-capability.ts:42-51`. This works only where the host can hold a wait and the board resumes waits; elsewhere the field is refused |
| 32 | "Each ending is final" (88) | **WRONG** | Contradicted by line 94 of the same page and by `retryTask` (`task-tools-capability.ts:2151-2156`), which puts an errored or cancelled task back to waiting. Only `completed` is final |
| 33 | `completed`: its output never changes (90) | RIGHT | |
| 34 | `errored` means no attempts left; `maxAttempts` gives more; each retry gets the previous error as feedback (91) | RIGHT | `task.ts:50-56` |
| 35 | `cancelled`: cancelled, or a dependency ended without completing (92) | RIGHT | |
| 36 | A completed task doesn't reopen; you file a follow-up that names it (94) | RIGHT | `task.ts` `followUpOf`; `:2155` |
| 37 | A retry keeps the task's id and its work so far (94) | RIGHT | `:2154-2155` |
| 38 | The drain's last item says why it stopped (96) | RIGHT | `board-meta.ts:314` |
| 39-44 | The six reasons and their meanings (100-105) | RIGHT ×6 | `board-meta.ts:201-217,291-306` |
| 45 | A board doesn't run on its own (111) | RIGHT | |
| 46 | Only the claim holder settles a task; a late result is dropped (112) | RIGHT | `index.ts:28-36` |
| 47 | "It doesn't choose an assignee. The filer names one." (113) | **WRONG** | No assignee is needed with a uniform `workers` block: "A single uniform worker runs every claimed task" (`index.ts`, `workers` doc). `assignee` is optional (`task-init.ts:38`). The workforce conversation board says "An unassigned row goes to the only one" (`conversation-board/board.ts`, "The grant") |
| 48 | An unknown assignee fails the task unless the board has a `defaultWorker` (113) | RIGHT | `index.ts` `defaultWorker` doc |
| 49 | Figure: a throw with attempts left goes back to pending; a lapsed claim is claimed again; a retry returns an errored or cancelled task to pending (58) | RIGHT | |

Omission, not scored: the page lists four task tools but leaves out `retryTask` (`task-tools-capability.ts:2152`), even though line 94 describes retrying.

## workers.md

| # | Claim (page line) | Verdict | Evidence |
|---|---|---|---|
| 1 | A worker is briefed in a Markdown file at `teams/<team>/workers/<name>/WORKER.md` (131-140) | RIGHT | `read-workforce-directory.ts:4-7` |
| 2 | The workforce kit reads `workforce/` when the app starts (142) | RIGHT | Planned: `FIX-2626/SPEC.md` sketch; `kits.ts` start-up |
| 3 | The id comes from the path: `support.triage` (142) | RIGHT | `read-workforce-directory.ts:375` |
| 4 | A worker with no team lives at `workforce/org/workers/<name>/` and its id is the bare folder name (142) | RIGHT | `read-workforce-directory.ts:4-7,134-138` |
| 5 | The agent piece is a generator with tools (148) | RIGHT | |
| 6 | A worker is its instructions, model, skills, tools and flow (148) | RIGHT | `hire-blocks.ts:28-41`; `manifest.ts:431-434` |
| 7 | A file with no `flow:` runs on the built-in `agent` flow, its body as instructions (150) | RIGHT | `agent-worker-flow.ts:120`; `hire-blocks.ts` `rowFromStandard` (`standardWorkerFlow(manifest, AGENT_FLOW)`, `instructions: manifest.body`) |
| 8 | A worker can run on a flow of your own, even one with no model; one roster can mix both (150) | RIGHT | |
| 9 | A worker works for one user; nobody else opens its sessions, messages it or reads its memory (151) | RIGHT | |
| 10 | Each conversation and each task is a stored session (152) | RIGHT | |
| 11 | A board's `workers` entries are blocks; a task naming a worker by id runs in a session of that worker (154) | RIGHT | `conversation-board/board.ts:8-14` |
| 12 | You talk to a worker through its `respond` action (158) | RIGHT | `worker-door.ts:30`; `agent-worker-flow.ts:1440` |
| 13 | `createClient({ userId, baseUrl })` (164) | RIGHT | `client/src/client.ts:66,612` |
| 14 | `createWorkforceClient(fsd)` from `@flow-state-dev/workforce/browser` (162-165) | RIGHT | `workforce/src/browser.ts:21-29`; `workers/client.ts:51` |
| 15 | `ensureWorkerSession({ worker })` finds a session or makes one (167) | RIGHT | `workers/client.ts:171` |
| 16 | `fsd.flow(session.flowKind).send("respond", { message }, { sessionId: session.id })` (168-170) | RIGHT | `client.ts:851-870`; `SessionSummary` (`client/src/types/index.ts:129-131`); `userMessage: (input) => input.message` (`agent-worker-flow.ts:1443`). Teammates does the same (`labs/teammates/src/adapter.ts:1263-1264`) |
| 17 | The worker sees recent turns of its own conversation only (173) | RIGHT | `agent-worker-flow.ts:1083` (50-turn window) |
| 18 | A roster holds the standard workers plus the user's own (177) | RIGHT | `workers/roster-view.ts` |
| 19 | A changed file, once redeployed, reaches every user who hasn't edited the worker (181) | RIGHT | `hire-blocks.ts:11-14` |
| 20 | One file gives each user a separate worker (183) | RIGHT | |
| 21 | A user's own worker is a row; every process sees it next turn with no restart (185) | RIGHT | `hire-blocks.ts:1-4` |
| 22 | A user in two organizations has a roster in each (185) | RIGHT | `workers/keys.ts:13` ("per organization") |
| 23 | The client has a method per roster change: hire, fork, edit, fire, reset (189-213) | RIGHT | `workers/client.ts:211-237` |
| 24 | `hire({ id, instructions })`, with `flow` defaulting to `"agent"` (192-193) | RIGHT | `hire-blocks.ts:28-42` |
| 25 | `fork(from, id)`, `edit({ id, instructions })`, `fire(id)` signatures (196-202) | RIGHT | `client.ts:216,225,237` |
| 26 | Each change is checked first; a refusal writes nothing and rejects with the reason (205) | RIGHT | `client.ts:206-211`; `hire-blocks.ts:6-9` |
| 27 | A hire takes instructions, description, skills and settings, the same keys a `WORKER.md` takes, and can't reuse a standard worker's id (207) | RIGHT | `hire-blocks.ts:28-42` (settings are "the keys a `WORKER.md` frontmatter accepts other than `flow` and `description`") |
| 28 | A fork copies flow, description, instructions, skills and settings as a snapshot and starts with no conversations (209) | RIGHT | `hire-blocks.ts:97-120,193-206` |
| 29 | An edit replaces only the fields given; the next turn reads it and a running turn keeps what it started with (211) | RIGHT | `client.ts:218-224` |
| 30 | Moving a worker to another flow leaves old conversations on the old flow, where new messages are refused (211) | RIGHT | `workers/installation.ts:835-840` |
| 31 | Editing a standard worker makes a per-user copy under the same id that keeps its conversations and the file's flow; `reset(id)` deletes the copy (213) | RIGHT | `hire-blocks.ts:11-14,58`; `client.ts:218-231` |
| 32 | Firing keeps past conversations readable and refuses new messages, naming the worker as fired (215) | RIGHT | `installation.ts:829` |
| 33 | A task for a worker fired before it ran fails, and the filing conversation hears it (215) | RIGHT | `conversation-board/board.ts:1042-1050` |
| 34 | A standard worker can't be fired (215) | RIGHT | `hire-blocks.ts:11-12` |
| 35 | Hire, fork, edit, reset and fire are also blocks (217) | RIGHT | `hire-blocks.ts:122,279` |
| 36 | The roster is a view the server recomputes when something it read changes (221) | RIGHT | `roster-view.ts` header |
| 37 | `useView` from `@flow-state-dev/react` and `rosterView` from `@flow-state-dev/workforce/browser`; `value` is `undefined` until the first answer (224-229) | RIGHT | `react/src/hooks/useView.ts:13,49-53`; `browser.ts:30`; no input needed (`client/src/view/view.ts:90`) |
| 38 | Rows have `id`, `name` (nullable), `flow` and `standard` (233, 240) | RIGHT | `roster-view.ts` `rosterEntrySchema` |
| 39 | An edited standard worker is listed once, as the user's copy (240) | RIGHT | `roster-view.ts` (standard entries merged with copies) |
| 40 | A worker never acts for anyone but its owner (244) | RIGHT | |
| 41 | Hiring writes no files (246) | RIGHT | `hire-blocks.ts:11` |

## Totals

| Page | Claims | RIGHT | WRONG | UNSUPPORTED |
|---|---|---|---|---|
| what-flow-state-is.md | 49 | 42 | 4 | 3 |
| tasks-and-boards.md | 54 (reasons counted ×6) | 52 | 2 | 0 |
| workers.md | 41 | 41 | 0 | 0 |
| **All** | **144** | **135** | **6** | **3** |

### Code examples

- **what-flow-state-is `fsdev.config.ts`**: `harnesses` is imported from the wrong entry point; it comes from `@flow-state-dev/harness-manager/kit`. `workforce({ model })` matches FIX-2626's sketch and the shipped JSDoc, but FIX-2627 puts the model under `agent`. `harnesses({})` fills no harness and passes no `workspace`, so the coding worker the text promises has nothing to run on. The rest (`kits`, `flows` array, `sqliteStores({ filename })`) matches the code.
- **`flows/triage.ts`** and **`flows/triage-pipeline.ts`**: match the real signatures.
- **tasks-and-boards board example**: matches.
- **workers client and hire examples** and the **`Roster` component**: match the code on `main`.

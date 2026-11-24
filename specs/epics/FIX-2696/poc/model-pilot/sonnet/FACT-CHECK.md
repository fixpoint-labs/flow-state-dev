# Fact check: compare/z

Checked against `packages/` on main (`d63b4e5c`) and the planned surface in `specs/epics/FIX-2618/` and `specs/issues/FIX-2619..2629/`. Note: `defineKit`, slots, `createFlowState({ kits, fill, flows: [] })` are **already on main** (`packages/core/src/kit/define-kit.ts`, `packages/engine/src/flowstate/types.ts:115-150`). The `workforce` and `harnesses` kits themselves are not; they are FIX-2627's.

## what-flow-state-is.md

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | "Run a starter and you have a team of AI workers, a page to talk to them on, and a backend" | UNSUPPORTED | No app starter or scaffolder in `packages/` (fsdev commands: benchmark, block, chat, dev, gen, run, serve, ui, worktrees: `packages/fsdev/src/commands/`). The specs' `init` scaffolds only a kit's folder: one team, one worker (`specs/issues/FIX-2627/DECISIONS.md:135`), not an app with a page |
| 2 | The code is in your repo, the data in your stores | RIGHT | |
| 3 | A worker is a Markdown file | RIGHT | `WORKER.md` loader, `packages/workforce/src/loader/` |
| 4 | Four layers: app, kits, flows, blocks | RIGHT | framing, matches epic O1 |
| 5 | An app is one config object, screens, own flows | RIGHT | |
| 6 | Example: `createFlowState({ kits: [...], flows: [deskFlow], stores: { default: { primary: sqliteStores(...) } } })` | RIGHT | `kits` `types.ts:137`, `flows` as array `types.ts:120`, stores shape `types.ts:166-176` |
| 7 | `workforce({ model: "openai/gpt-6-luna" })` | UNSUPPORTED | The specs disagree. FIX-2627, which owns the kit, nests model under the agent flow's config: `workforce({ directory, agent: { model, uses } })` (`specs/issues/FIX-2627/SPEC.md:69`; "the agent and coordinator flows' options are config", `DECISIONS.md:96-97`). FIX-2626's sketch and the engine docstring use `workforce({ model })` (`FIX-2626/SPEC.md:64`, `types.ts:128`) |
| 8 | `harnesses({ claudeCode: {} })` | **WRONG** | Claude Code is its own kit, `claudeCode()`, which fills the harness slot. Codex and Cursor go in through the app's `fill`. `harnesses` takes `{ workspace, defaultHarness, review, checks }` (`FIX-2627/SPEC.md:69-73`, `DECISIONS.md:102-108`). The `{ claudeCode: {} }` shape appears only in the epic's PROPOSED sketch (`epics/FIX-2618/examples/app-install.md:11`), and that sketch hands the real shape to the child |
| 9 | `createFlowState` serves every flow over HTTP, streams their output and saves state to the named stores | RIGHT | `packages/engine/src/flowstate/` |
| 10 | A host adapter (Node, Next.js, Vercel) puts it on the network | RIGHT | `packages/node`, `packages/next`, `packages/vercel` |
| 11 | Screens are ordinary React that talk to it through the client | RIGHT | |
| 12 | A kit is a feature installed with one line | RIGHT | `define-kit.ts:4-5` |
| 13 | `workforce` gives Markdown workers, conversations and a task board behind the conversation | RIGHT | conversation board, `workforce/src/conversation-board/board.ts` |
| 14 | `harnesses` adds coding agents (Claude Code, Codex, Cursor) "as workers that can take a coding task" | **WRONG** | The harness kit contributes one coding worker *flow*, `coder`. A worker's `harness:` line picks the harness, and Claude Code comes from a separate `claudeCode()` kit (`FIX-2627/SPEC.md:13,40`, `DECISIONS.md:102-108`). Harnesses are slot values, not workers |
| 15 | Kits carry flows, and their resources, views and capabilities ride on those flows | RIGHT | `define-kit.ts:9-10`. FIX-2626 D1: no `resources`/`views` field |
| 16 | Workforce reads worker files from `workforce/` | RIGHT (planned) | `FIX-2626/SPEC.md` sketch `directory: { path: "workforce" }` |
| 17 | The kit scaffolds starter files once, and then you own them | RIGHT (planned) | `init` through the copy-in, never overwriting (`FIX-2626/DECISIONS.md`, "Decided, not asked" → `init`). Not on main yet: no `init` command in `fsdev/src/commands/` |
| 18 | A file the kit can't use stops the app from starting, with the file named | RIGHT | `types.ts:133-135`; FIX-2626 D2 |
| 19 | Slots are typed places that other kits fill | RIGHT | `define-kit.ts:22-45` |
| 20 | Workforce has a worker-flows slot, and `harnesses` fills it with a coding worker | RIGHT (planned) | `FIX-2627/DECISIONS.md:94` |
| 21 | Workforce never learns `harnesses` exists | RIGHT | "workforce never imports harness-manager", `FIX-2627/DECISIONS.md:102-104` |
| 22 | A kit lists the kits it needs with `requires` | RIGHT | `define-kit.ts:121` |
| 23 | The app can list kits in any order | RIGHT | `types.ts:127-130` |
| 24 | Slot entries are merged and checked, and a key given twice is refused, naming both kits | RIGHT | `define-kit.ts:58`, `types.ts:132-133` (keyed slots; a list appends) |
| 25 | A kit that fills a slot can declare slots of its own | RIGHT | `FIX-2626/SPEC.md` goal signal (`c` requires `b` and declares its own slot) |
| 26 | `defineKit({ name, requires, contributes: () => ({...}), install: () => ({ flows }) })` | RIGHT | Matches `KitDefinition` (`define-kit.ts:113-150`); `install` returns `{ flows }` (`define-kit.ts:96-98`) |
| 27 | Entry `[workforce.slots.workerFlows]: { planner: plannerFlow }` | UNSUPPORTED | `workerFlows` entries are "builders that receive the installation" (`FIX-2627/DECISIONS.md:94-95`), not flow instances. It type-checks only because `contributes` returns `Record<string, unknown>` (`define-kit.ts:132`) |
| 28 | `contributes` is what a kit puts in others' slots; `install` returns the flows it serves | RIGHT | `define-kit.ts:123-150` |
| 29 | A flow is named actions plus state, and its actions are served as endpoints | RIGHT | |
| 30 | A session holds one conversation's state and items | RIGHT | |
| 31 | The same flow runs from a terminal with no server | RIGHT | `fsdev/src/commands/run.ts:2` |
| 32 | Generator example (`name, model, prompt, inputSchema, history: true, user`) | RIGHT | `core/src/blocks/generator.ts:599-612`; `history: true` `:364-367` |
| 33 | `defineFlow({ kind, actions: { chat: { block } } })()` | RIGHT | `core/src/flow/defineFlow.ts:1644-1659` returns a factory |
| 34 | `npx fsdev run hello-chat chat -i '{...}'` | RIGHT | `run.ts:132-134`; user defaults to the resolver's or `devuser` (`run.ts:140`) |
| 35 | `fsdev run` runs in-process and prints each event as a line of JSON | RIGHT | `run.ts:2` (NDJSON) |
| 36 | Every action runs one block | RIGHT | `ActionEntry.block` |
| 37 | Five block kinds | RIGHT | handler, generator, evaluator, sequencer, router |
| 38 | All kinds share one contract: input schema, output schema, a function | RIGHT (loose) | Sequencers and routers compose blocks and have no single body; acceptable at concept level |
| 39 | Handler is plain code | RIGHT | |
| 40 | A generator calls a model; with tools it becomes the agent loop | RIGHT | |
| 41 | An evaluator asks questions whose answers you know and returns typed answers | RIGHT | `core/src/blocks/evaluator.ts:1-7` |
| 42 | A sequencer runs blocks in order, in parallel or in a loop | RIGHT | `sequencer-methods.ts:163,223,229,261` |
| 43 | A router picks which block runs next | RIGHT | |
| 44 | There is no `agent()` function | RIGHT | No such export in any `packages/*/src/index.ts` (only `codexAgent`, `cursorAgent`, `AGENT_FLOW`) |
| 45 | The "which layer you change" list | RIGHT | framing |
| 46 | Flow State doesn't host your app, and a kit serves flows made of blocks | RIGHT | |

**Code examples:** `defineKit` and `createFlowState` shapes compile against main. The `harnesses({ claudeCode: {} })` config is wrong (row 8). The `workforce({ model })` config is unsettled (row 7). Generator, flow and `fsdev run` are correct.

## tasks-and-boards.md

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | A board is a stored list plus a loop; assignees take what's ready; it stops when everything is done or nothing can run | RIGHT | `orchestration/src/task-board/index.ts:475-481` |
| 2 | Task fields `goal`, `assignee`, `deps`, `input`, `output`, `status` | RIGHT | `tasks/schema/task-init.ts:23-48` |
| 3 | `assignee` is a key in the `workers` map, or a worker's id | RIGHT | `index.ts` `workers` registry; workforce board, `board.ts:1046-1051` |
| 4 | Code files tasks at start, and any block can add more while the board runs | RIGHT | `initialTasks` `index.ts:489`; `board.capability` |
| 5 | A model files tasks through four tools: `createTask`, `getTask`, `listTasks`, `updateTask` | RIGHT | `skills/task-tools-capability.ts:4-7, 2141` |
| 6 | "A fifth, `reportProgress`, is offered only to the turn that is working a task" | **WRONG** (minor) | The working turn also gets `holdTaskForUser`, and `suspendForUser` where the host can suspend (`task-tools-capability.ts:18-23, 780-782`). The page itself names `holdTaskForUser` later. Actions also get a fifth filer tool, `retryTask` (`:2151, 2184`) |
| 7 | `taskBoard({ name, workers: { analyst, writer }, initialTasks })` example | RIGHT | `index.ts:668`; `taskWorkerInputSchema` `tasks/workers/types.ts:39` |
| 8 | `board.drain` is a block, mountable as an action or a sequencer step | RIGHT | `index.ts:584` (`SequencerDefinition`) |
| 9 | The writer reads its deps' outputs from `task.deps`, keyed by task id | RIGHT | `tasks/workers/types.ts:56-66` |
| 10 | Six statuses | RIGHT | `tasks/schema/task-status.ts:13-20` |
| 11 | Ready means `pending` with every dep completed | RIGHT | (questions must also clear, `task-init.ts:71-75`) |
| 12 | The claim is one atomic write, so one assignee wins | RIGHT | the claim gate, `tasks/collection/method-table.ts:504-535` |
| 13 | `concurrency` defaults to 4 | RIGHT | `index.ts:402` |
| 14 | The lease defaults to two minutes and is renewed while the work runs | RIGHT | `tasks/collection/internal.ts:1131`; `startLeaseRenewal` `index.ts:93` |
| 15 | A dead process's lease lapses, and the next claim takes the task back | RIGHT | |
| 16 | A takeback isn't charged against failure retries | RIGHT | `internal.ts:541-554` (abandonments discounted). The page omits that abandonments have their own budget of 3 (`internal.ts:524`) |
| 17 | No tool finishes a task; it ends when its block returns or throws | RIGHT | `task-tools-capability.ts:17-18` |
| 18 | A return becomes `output`, status `completed` | RIGHT | |
| 19 | A throw ends `errored` unless `maxAttempts` is left; then it goes back to `pending` with feedback | RIGHT | `internal.ts:527-535` |
| 20 | A filer or a person can cancel any time before it finishes | RIGHT | `task-tools-capability.ts:8-10` |
| 21 | Dependents of an errored or cancelled task are cancelled transitively and labelled `skipped` | RIGHT | `tasks/collection/cascade.ts:9-12, 31` |
| 22 | `held: true` sits until released; it can still be cancelled or edited | RIGHT | `task-init.ts:64-68`; field rules `task-tools-capability.ts:7-9` |
| 23 | `questions` keep it `pending` until each is answered; answers join the brief | RIGHT | `task-init.ts:71-78` |
| 24 | `holdTaskForUser` ends the turn, keeps the attempt, and the answer starts one more turn on the same attempt | RIGHT | `task-tools-capability.ts:762-778` |
| 25 | `suspendForUser` keeps the task `in_progress`, puts the stop in `holds`, and resumes it | RIGHT | `tasks/collection/holds.ts:110-115` |
| 26 | Answers come from an inbox, or a typed line answers the oldest open question | RIGHT | `orchestration/src/inbox/`; `tasks/steers.ts:155-199` |
| 27 | Waiting on a person doesn't hold the board open; it stops `waiting-on-a-user` | RIGHT | `task-board/blocks/board-meta.ts:212-214, 229-230` |
| 28 | The next drain after an answer picks up dependents | RIGHT | |
| 29 | Default stop: all completed, or no worker active and nothing claimable | RIGHT | `index.ts:475-481` (`complete-or-blocked`) |
| 30 | "It reports why: `all-completed`, `blocked-by-failures`, `waiting-on-a-user` or `retry-budget-exhausted`" | **WRONG** | Six reasons, not four: also `dispatched` and `waiting-on-an-event` (`board-meta.ts:209-217, 291-297`) |
| 31 | `onIdle: "wait"` keeps the board open until a predicate says stop | RIGHT | `index.ts:485-486, 517` (`shouldExit`) |
| 32 | The drain runs only while a request executes it | RIGHT | |
| 33 | "Tasks added while nothing drains wait where they are, and adding one wakes nothing" | **WRONG** | On a dispatching board, the conversation board this page sends the reader to next, `createTask` hands a ready row over at once (`task-tools-capability.ts:26-29`). True only for a plain board |
| 34 | By default tasks last for the request | RIGHT | `index.ts` `collection` default (request-backed) |
| 35 | A session-, user- or org-scope collection outlives the request | RIGHT | `tasks/collection/define-task-collection.ts:114` |
| 36 | A board is not a background queue | RIGHT | |
| 37 | A Workforce conversation's coordinator files tasks for its workers | RIGHT | `workforce/src/conversation-board/board.ts:8-16` |

**Code example:** `taskBoard` and the generator workers match `index.ts:668` and `types.ts:39`.

## workers.md

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | A worker is briefed in a Markdown file | RIGHT | |
| 2 | You can talk to it or hand it a task | RIGHT | `respond` door; `work` entry `workforce/src/worker-task-entry.ts:13` |
| 3 | What it learns about a user stays with that user; rosters are per user | RIGHT | per-user roster (`workers/client.ts:126-131`) |
| 4 | The `workforce` kit reads `workforce/` | RIGHT (planned) | FIX-2627 |
| 5 | Path `workforce/teams/<team>/workers/<name>/WORKER.md`, id `<team>.<name>` | RIGHT | `loader/read-packages-directory.ts:128-129` (org workers, `org/workers/<name>` with a bare id, not mentioned) |
| 6 | `model:` in frontmatter | RIGHT | agent flow setting `agent-worker-flow.ts:468` |
| 7 | `description` is the only required key | RIGHT | `manifest.ts:240-241` |
| 8 | `createWorkforceClient(fsd)` → `ensureWorkerSession({ worker })` → `fsd.flow(session.flowKind).send("respond", { message }, { sessionId: session.id })` | RIGHT | `workers/client.ts:171, 277`; `client/src/types/index.ts:129-131`; `worker-door.ts:30`; `agent-worker-flow.ts:938` |
| 9 | With no `flow:` line, the built-in `agent` flow | RIGHT | `agent-worker-flow.ts:120`; `standard-workers.ts` `standardWorkerFlow` |
| 10 | A worker can name your own flow, even one with no model | RIGHT | `worker-config.ts:99-101` |
| 11 | A worker belongs to one user | RIGHT | |
| 12 | Many workers share one flow, with a session per conversation and per task | RIGHT | `conversation-board/board.ts:8-12` |
| 13 | A worker's id is addressed by conversations, delegate lists and `assignee` | RIGHT | |
| 14 | A standard worker is the same for everyone and the file can't change at run time | RIGHT | `workers/standard-workers.ts:3-10` |
| 15 | A user's own workers are private rows | RIGHT | `hire-blocks.ts` (caller's roster) |
| 16 | Alice and Bob each have "the standard researcher", which are two workers | RIGHT (conceptual) | |
| 17 | The kit serves `workforce-roster` with one action per verb | RIGHT | `workers/keys.ts:141`; `roster-flow.ts:6` (hire, fork, edit, fire, reset) |
| 18 | Roster example: `createSession()`, `send("hire", { id, instructions })`, `("edit", { id, instructions })`, `("fire", { id })` | RIGHT | `client/src/client.ts:455`; `hire-blocks.ts:27-71` |
| 19 | `send("fork", { from: "researcher", id: "my-researcher" })`, also in the second example | **WRONG** | Under the page's own scheme the standard researcher is `engineering.researcher` (row 5; `read-packages-directory.ts:128-129`). Fork looks the worker up by exact id (`hire-blocks.ts:201`), so `from: "researcher"` fails with no worker found unless an org worker of that name exists |
| 20 | Each write lands on the user's next turn, on any process, with no restart | RIGHT | `workers/client.ts:205-209` |
| 21 | Hire takes an id, a flow (default `agent`) and `WORKER.md` settings; a bad setting, a taken id or a standard id is refused and nothing is written | RIGHT | `hire-blocks.ts:27-41, 138-158` |
| 22 | A fork is a snapshot | RIGHT | `hire-blocks.ts:99` |
| 23 | Edit replaces the fields given; on a standard worker you get your own copy under the same id | RIGHT | `hire-blocks.ts:11-12, 219-230` (it also refuses changing a standard worker's flow, not mentioned) |
| 24 | `reset` deletes your copy | RIGHT | `hire-blocks.ts:89, 264-272` |
| 25 | Fire deletes your own worker; its sessions stay readable; a new message is refused, naming it fired; standard workers can't be fired | RIGHT | `workers/installation.ts:829`; `hire-blocks.ts:255` |
| 26 | A refused write ends the request `failed` with the reason | RIGHT | blocks throw → request failed |
| 27 | `send` returns when the write starts; `forked.wait()` → `{ status }` | RIGHT | `client/src/client.ts:351`; `ExecuteActionResponse.status` includes `in_progress` (`client/src/types/index.ts:81`) |
| 28 | `workforce.watchRoster` reports the roster, then each change | RIGHT | `workers/client.ts:133-145` |
| 29 | On `agent`, a task runs as one turn: goal and context as the message, the answer as the result | RIGHT | `worker-task-entry.ts:13` |
| 30 | Delegates, and every hand-over checked against the roster | RIGHT | `conversation-board/board.ts:14-16, 1042-1051` |
| 31 | A coordinator picks a delegate per message and files tasks | RIGHT | `coordinator/coordinator-route.ts:28` |
| 32 | A task whose worker was fired fails, the filer hears, and no other worker takes it | RIGHT | `board.ts:1042-1051` |
| 33 | Workers act only for their owner; hiring writes no files | RIGHT | `standard-workers.ts:6-8` |

**Code examples:** the client and roster calls match the real signatures. The fork's `from` id contradicts the page's own id rule.

## Totals

| Page | Claims | RIGHT | WRONG | UNSUPPORTED |
|---|---|---|---|---|
| what-flow-state-is.md | 46 | 41 | 2 | 3 |
| tasks-and-boards.md | 37 | 34 | 3 | 0 |
| workers.md | 33 | 32 | 1 | 0 |
| **All** | **116** | **107** | **6** | **3** |

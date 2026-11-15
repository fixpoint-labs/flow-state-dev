# Fact check: compare/y

Pages: `y/what-flow-state-is.md`, `y/tasks-and-boards.md`, `y/workers.md`.
Planned (kit) surface checked against `specs/epics/FIX-2618/` and `specs/issues/FIX-2626`, `FIX-2627` (and siblings). Everything else is checked against `packages/` on main. Paths below are relative to `/home/user/flow-state-dev/`.

## what-flow-state-is.md

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | "Run a starter and you have a team of AI workers ... and a page" (a *starter* is a shipped, runnable app) | UNSUPPORTED | No spec or package defines a "starter". The only use of the word in the kit specs is a kit's `init` scaffolding "starter files" into its folder (`specs/issues/FIX-2626/SPEC.md:151`, `DECISIONS.md:79`). The apps that match the description are labs (`labs/README.md:1-6, 20-23`) |
| 2 | The backend streams answers, keeps what workers learned, resumes a run after a crash | RIGHT | crash recovery on durable hosts, `packages/core/src/types/flow.ts:264-270` |
| 3 | The code is in your repo, the data in your database | RIGHT | stores packages (`store-sqlite`, `store-postgres`) |
| 4 | A worker is a Markdown file | RIGHT | `packages/workforce/src/manifest.ts:15-37` |
| 5 | A feature is a kit an app installs with one line | RIGHT (planned) | `specs/issues/FIX-2626/SPEC.md:17-19, 63-68` |
| 6 | Kits are made of the same typed blocks you write yourself | RIGHT (planned) | `specs/issues/FIX-2626/DECISIONS.md:57-59` (a kit holds only existing pieces) |
| 7 | Figure: claude-code fills a slot harnesses opened, harnesses fills one workforce opened | RIGHT (planned) | `specs/issues/FIX-2626/SPEC.md:80-86`; `FIX-2627/DECISIONS.md:96-107` |
| 8 | Five block kinds: generator, handler, sequencer, router, evaluator | RIGHT | `packages/core/src/blocks/` (evaluator.ts, generator.ts, handler.ts, router.ts, sequencer.ts) |
| 9 | "The Teammates starter is a small team you talk to one at a time ... members message each other where you can see it, and hand code changes to a coding agent" | UNSUPPORTED | The behaviour matches the `teammates` **lab** (`labs/README.md:23`), but nothing ships it as a "starter" (see #1) |
| 10 | The worker file shape: `name`, `description`, `tools:` frontmatter, body = brief | RIGHT | `labs/teammates/workforce/teams/teammates/workers/researcher/WORKER.md:1-6` (a shorter version of the real file); `packages/workforce/src/worker-config.ts:250` |
| 11 | Rewrite the brief and restart: the worker follows the new one | RIGHT | `packages/workforce/src/workers/standard-workers.ts:6-8` |
| 12 | Add a folder with a second file and the team has a new member | RIGHT | `packages/workforce/src/manifest.ts:22` |
| 13 | The team, its task board and the coding agents all come from kits | RIGHT (planned) | `specs/issues/FIX-2627/SPEC.md:18-21` |
| 14 | Code: `createFlowState({ kits: [workforce({ directory }), harnesses({ workspace }), claudeCode()] })` | RIGHT (planned) | `specs/issues/FIX-2626/SPEC.md:64`; `FIX-2627/SPEC.md:68-72`. Note: the epic's sketch spells it `workforce({ roster: ... })` (`specs/epics/FIX-2618/examples/app-install.md:12`), but the child specs own the shape and both say `directory` |
| 15 | A kit brings its flows, the files it reads from your repo, and its views | RIGHT (planned) | `FIX-2626/DECISIONS.md:57-59`. `defineKit` has no `views` field; views come with its flows and package exports. The page's wording still holds |
| 16 | Slots are openings for other kits to fill; `harnesses` opens one and `claudeCode` fills it | RIGHT (planned) | `FIX-2627/DECISIONS.md:102-107`. Small gap: the app can also fill a slot (`fill:`, `FIX-2626/DECISIONS.md:72-75`) |
| 17 | A kit names the kits whose slots it fills, and never reaches into them | RIGHT (planned) | `FIX-2626/SPEC.md:26` (a fill by a kit that doesn't require the owner is refused); epic ER-5 |
| 18 | A kit that fills a slot can open slots of its own | RIGHT (planned) | `FIX-2626/SPEC.md:43` (c requires b and declares its own slot) |
| 19 | "That is how one person's app becomes the base for someone else's" | UNSUPPORTED | No spec delivers sharing apps between people. The epic leaves the third-party ecosystem out of scope (`specs/epics/FIX-2618/SPEC.md:32`, `:151`) |
| 20 | A flow is a backend over HTTP; a client runs an action such as `chat`; results stream; typed state is kept between calls | RIGHT | `examples/hello-chat/src/flows/hello-chat/flow.ts:75-79` |
| 21 | What each block kind does (table) | RIGHT | `packages/core/src/blocks/evaluator.ts:1-8` (typed questions) |
| 22 | Any block, a whole pipeline included, can be a model tool | RIGHT | `packages/core/src/blocks/generator.ts:422` (`GeneratorTool = BlockDefinition`) |
| 23 | Code: `sequencer({ name }).step(...)`, `generator({ name, model, prompt, tools })` | RIGHT | `packages/core/src/blocks/generator.ts:599-613` |
| 24 | `pnpm fsdev run hello-chat chat -i '{...}'`, with no server or browser | RIGHT | `packages/fsdev/src/commands/run.ts:132-134`; `examples/hello-chat` |
| 25 | The run prints one JSON event per line | RIGHT | `run.ts:133` ("streaming NDJSON output") |
| 26 | Open source, TypeScript, a web service you host | RIGHT | MIT `license` in package.json files |
| 27 | "The starters are research software, and each one's README lists what isn't wired yet" | UNSUPPORTED | This is how `labs/README.md:3-6` describes **labs**; no starters exist |
| 28 | Running a starter takes about ten minutes and one API key | UNSUPPORTED | Nothing in specs or code |

**Totals:** 23 right · 0 wrong · 5 unsupported. **Worst:** the whole page is framed around a "starter" product (#1, #9, #27, #28) that neither the specs nor the code have. The real things are labs, plus the starter files a kit's `init` scaffolds.

## tasks-and-boards.md

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | A board is a stored list plus a loop (the drain); it stops when every task is done or nothing left can run | RIGHT | `packages/orchestration/src/task-board/index.ts:44-53` (default `onIdle: "complete-or-blocked"`) |
| 2 | Imports: `defineFlow` from core, `taskBoard` from `@flow-state-dev/orchestration/task-board` | RIGHT | `packages/orchestration/package.json` exports `./task-board` |
| 3 | `taskBoard({ name, workers, initialTasks })` with `{ id, goal, assignee, deps }` tasks | RIGHT | `task-board/index.ts:301-307, 381, 494`; `tasks/schema/task-init.ts:22-40` |
| 4 | `defineFlow({ kind, actions: { run: { block: board.drain } } })()` | RIGHT | `packages/core/src/types/flow.ts:296-329`; `flow/defineFlow.ts:1644-1662` |
| 5 | `workers` maps each `assignee` name to a block | RIGHT | `task-board/index.ts:367-381` |
| 6 | `board.drain` is a block | RIGHT | `task-board/index.ts:580` (`drain: SequencerDefinition`) |
| 7 | A dependent task receives upstream results on `input.deps`, keyed by task id | RIGHT | `tasks/workers/types.ts:62-73` |
| 8 | `id` names the task, unique on its board; `goal`, `assignee`, `deps` as described | RIGHT | `task-init.ts:22-40` |
| 9 | `status`: "`pending`, then `in_progress`, then `completed` or `errored`" | WRONG | `tasks/schema/task-status.ts:13-20`: there are also `held` and `cancelled`. The page itself says dependents get cancelled two sections later |
| 10 | A task is ready when every dep is `completed` | RIGHT | `task-board/index.ts:463-467` |
| 11 | Up to four ready tasks at a time by default | RIGHT | `task-board/index.ts:409-412, 693` (`concurrency = 4`) |
| 12 | A task is only ever claimed once | RIGHT | `task-board/index.ts:73-76` (CAS claim) |
| 13 | A failed task is marked `errored` and the board carries on | RIGHT | `task-board/index.ts:497-509` (`onError: "skip"` default) |
| 14 | Its dependents are cancelled and never run | RIGHT | `tasks/collection/cascade.ts:9-12, 55-58` |
| 15 | The drain ends by emitting an item with `terminationReason` `all-completed` / `blocked-by-failures` | RIGHT | `task-board/blocks/board-meta.ts:291-316` |
| 16 | There are other reasons, such as a task waiting on a person | RIGHT | `board-meta.ts:207-218` (`waiting-on-a-user`, `waiting-on-an-event`, `dispatched`, `retry-budget-exhausted`) |
| 17 | Storage: the request by default; or a resource in session, user or org scope that lasts across requests | RIGHT | `task-board/index.ts:338-359`; `tasks/collection/define-task-collection.ts:114-115` |
| 18 | The drain lives only while a request runs it; tasks added later wait; a board is not a background queue | RIGHT | `task-board/index.ts:322-336`, `onIdle` docs `:474-487` |
| 19 | A task can go to a named worker, or run in a session of its own | RIGHT | `task-board/index.ts:398-407` (`newSession`) |
| 20 | By default the drain waits on that session; delegation mode returns once tasks are handed out and each session settles its task | RIGHT | `task-board/index.ts:322-336` |
| 21 | Parallel Tasks, Supervisor, Plan and Execute ship as patterns that build the board | RIGHT | `packages/patterns/src/parallelTasks/index.ts:1-13`, `supervisor/index.ts:1-17`, `plan-and-execute/index.ts:1-20` |
| 22 | Each pattern's one-line description (one pass, review per result, replan between rounds) | RIGHT | same files |
| 23 | No retry unless the task sets `maxAttempts` | RIGHT | `tasks/schema/task-init.ts:42-47` (also capped board-wide by `maxTotalRetries`, `index.ts:440-458`) |
| 24 | A board doesn't run on its own; something has to run the drain | RIGHT | `task-board/index.ts:322-336` |

Code example: matches the real signatures. `analyst`/`writer` are left undefined on purpose, which is fine.

**Totals:** 23 right · 1 wrong · 0 unsupported. **Worst:** the status row lists four statuses; the real list has six (`held`, `cancelled` are missing).

## workers.md

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | A worker is an agent briefed in a Markdown file | RIGHT | `packages/workforce/src/manifest.ts:15-37` |
| 2 | You can talk to a worker, or hand it a task | RIGHT | `workers/client.ts:158-171`; `conversation-board/board.ts:1-30` |
| 3 | "Everyone who uses the app gets their own copy of each worker" (and the figure: each roster holds "its own engineering.lead") | WRONG | `workers/standard-workers.ts:3-8`: standard workers are "the same for every user, projected read-only. Nothing stores them." A user only gets a copy of their own by editing or forking one. Keeping each user apart comes from user-scoped sessions and resources, not from per-user copies |
| 4 | What a worker learns about its person stays with that person | RIGHT | user-scoped roster and sessions, `delegates/delegate-check.ts:7-13` |
| 5 | Frontmatter `name`, `description`, `model`, `delegates` | RIGHT | `worker-config.ts:212-214`; `agent-worker-flow.ts:468` |
| 6 | `workforce/teams/engineering/workers/lead/WORKER.md` gets the id `engineering.lead` | RIGHT | `manifest.ts:22` |
| 7 | `name` is what people see; the folders give the id | RIGHT | `workers/standard-workers.ts:47`; `hire.ts:81` |
| 8 | `description` is the only setting a file must have | RIGHT | `loader/read-workforce-directory.ts:270-278` |
| 9 | `delegates` names other workers by id | RIGHT | `worker-config.ts:195-214` |
| 10 | The body is the worker's instructions | RIGHT | `manifest.ts:33-37` |
| 11 | A non-TypeScript author can add or change a worker by editing a document | RIGHT | follows from #1, #10 |
| 12 | Workers come with the Workforce kit: `createFlowState({ kits: [workforce({ directory: "./workforce" })] })` | RIGHT (planned) | `specs/issues/FIX-2627/SPEC.md:68-69`; `FIX-2627/DECISIONS.md:47` |
| 13 | The folder is read at start; a file the kit can't use stops the app and the error names the file | RIGHT (planned) | `specs/issues/FIX-2626/SPEC.md:12, 19`; `DECISIONS.md:60-63` (D2) |
| 14 | A session is one conversation or one task, with its own history | RIGHT | `workers/client.ts:158-171` |
| 15 | `createClient({ userId, baseUrl })` from `@flow-state-dev/client` | RIGHT | `packages/client/src/client.ts:56-66, 612` |
| 16 | `createWorkforceClient(fsd)` from `@flow-state-dev/workforce/browser` | RIGHT | `packages/workforce/src/browser.ts:22`; `workers/client.ts:277`. FIX-2627 moves the client's reads to views but keeps its writes (`FIX-2627/SPEC.md:142`), so `ensureWorkerSession` stays |
| 17 | `ensureWorkerSession({ worker })` returns a session with `id` and `flowKind` | RIGHT | `workers/client.ts:171`; `client/src/types/index.ts:129-131` |
| 18 | `fsd.flow(kind).send("respond", { message }, { sessionId })` | RIGHT | `client/src/client.ts:428-432, 213-214`; the `respond` action, `hire.ts:113` |
| 19 | `ensureWorkerSession` creates the session the first time | RIGHT | `workers/client.ts:158-170` |
| 20 | The worker sees the recent turns of the conversation | RIGHT | `agent-worker-flow.ts:1083` (a 50-turn history window) |
| 21 | A delegate works a task in a session of its own, with the goal as its message; its answer is the task's result; the lead is told when it ends | RIGHT | `conversation-board/board.ts:1-30`; `tasks/schema/task-init.ts:81-85` (`session` defaults to `"new"`) |
| 22 | The tasks sit on a board that belongs to the conversation | RIGHT | `conversation-board/session-board.ts`, `board.ts:16-21` |
| 23 | A worker can only hand work to its own delegates; a task for anyone else is refused, naming the worker | RIGHT | `worker-config.ts:202-205`; `orchestration/src/skills/task-tools-capability.ts:353-354` |
| 24 | A coordinator is a worker that picks the right delegate for each message | RIGHT | `workforce/src/coordinator/coordinator-flow.ts`; `worker-description.ts:7-9` |
| 25 | Repo files define the standard workers; each user's set is their roster | RIGHT | `standard-workers.ts:3`; `delegates/delegate-check.ts:7-9` |
| 26 | Bob can't open Alice's conversations or read her lead's memory of her | RIGHT | `delegate-check.ts:12-13` |
| 27 | "Nobody can edit a standard worker from inside the app"; a user who wants a different one forks it | WRONG | `workers/hire-blocks.ts:11-14`: "Edit on one makes the caller's own copy of it under the same id ... which the turn and the roster then read before the file; reset deletes that copy." Also `standard-workers.ts:9-11`. A user *can* edit a standard worker in the app. Only the file is never written. Fork (a new id) is a separate action |
| 28 | A user can hire a worker from scratch at run time; it is theirs alone; no file changes and nothing restarts | RIGHT | `workers/hire-blocks.ts:1-4` |
| 29 | Every worker runs on a flow; with no `flow:` it runs on the built-in agent | RIGHT | `hire.ts:18-23, 162`; `agent-worker-flow.ts:120` |
| 30 | `flow: request-triage` names your own worker flow | RIGHT | `worker-config.ts:83-91` (uses this very example) |
| 31 | A worker acts only for its owner; workers message workers on the same roster, never across users | RIGHT | `messages/message-tool.ts:14-17`; `delegate-check.ts:12-13` |

Code examples: the client snippet matches the real signatures. The `workforce({ directory })` kit call matches FIX-2627. The `flow: request-triage` file is valid: only `description` is required.

**Totals:** 29 right · 2 wrong · 0 unsupported. **Worst:** "Nobody can edit a standard worker from inside the app" (#27). The roster has an edit action that makes a same-id copy, which is read before the file.

## Totals

| Page | Right | Wrong | Unsupported |
|---|---|---|---|
| what-flow-state-is.md | 23 | 0 | 5 |
| tasks-and-boards.md | 23 | 1 | 0 |
| workers.md | 29 | 2 | 0 |
| **All** | **75** | **3** | **5** |

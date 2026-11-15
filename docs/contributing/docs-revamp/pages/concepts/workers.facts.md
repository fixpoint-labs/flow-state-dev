# Facts for Workers (C-22, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, issue, changeset or `docs/internal` was read. The kit is built, so no fact here is a spec's name marked for reconciling.

Paths are from the repo root. Abbreviations:

- `ov` = `apps/docs/docs/workforce/overview.md`
- `wd` = `apps/docs/docs/workforce/workers-on-disk.md`
- `dh` = `apps/docs/docs/workforce/durable-hire.md`
- `bw` = `apps/docs/docs/workforce/built-in-worker.md`
- `dw` = `apps/docs/docs/workforce/delegating-work.md`
- `co` = `apps/docs/docs/workforce/coordinators.md`
- `mw` = `apps/docs/docs/workforce/messaging-workers.md`
- `ui` = `apps/docs/docs/workforce/ui.md`
- `wk` = `packages/workforce/src`
- `wt` = `packages/workforce/test`
- `kit` = `packages/workforce/src/kit/workforce-kit.ts`
- `dk` = `packages/core/src/kit/define-kit.ts`
- `kp` = `packages/engine/src/flowstate/kits.ts`
- `ks` = `apps/kitchen-sink/lib/workforce-kit.ts` (the one example that installs the kit)
- `pilot` = `docs/contributing/docs-revamp/pilot/workers.md` (the pilot this page keeps; read so the page and the sheet agree)

Legend: **[page]** the page states it. **[ref]** it belongs on `reference/worker-md` or `reference/workforce`; the page links, does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[cut]** history or mechanism; never on the page.

## Flags against the pilot and the page plan (read first)

1. **The pilot's install snippet has the wrong import path.** It imports `workforce` from `@flow-state-dev/workforce`. The root export list has no `workforce` kit; the kit is exported from the `./kit` subpath: `import { workforce } from "@flow-state-dev/workforce/kit"`. `packages/workforce/package.json:45-48` (exports map `"./kit"`), `kit:156`, `wk/kit/index.ts:8-15`, `ks:35`. The call `workforce({ directory: "./workforce" })` is valid: every kit that owns a folder takes `directory` beside its own config, read against the working directory. `dk:90-91`, `dk:241-244`, `dk:178-183`. The folder defaults to `workforce/` beside the app, so `directory` can be left out. `kit:164`, `dk:136-143`. The page should show `workforce({ directory: "./workforce" })` only if it wants the override visible; `workforce()` alone is the same app. [page]
2. **"Everyone gets their own copy of each worker" is looser than the code.** A standard worker is one definition read from the files for every user; it is not stored per user. What is per user is the sessions, what the built-in worker keeps (skills, memory, standing rules) and, once a user edits or forks one, a stored row. `wk/workers/standard-workers.ts:1-12`, `dh:106-110`, `bw:118-120`. The page can say "each user has the lead, and what it learns about them stays with them" and must not say each user has a stored copy before an edit. See the four questions below.
3. **The pilot's rule that editing a standard worker makes the user's own copy is right, and three existing user docs state the opposite.** `ov:20` ("nobody can edit them"), `dh:10-11` ("nobody can change it while the app runs") and `dh:93` (an edit of a standard worker "is refused ... Fork it") and `wd:271-273` all say an edit is refused. The code and its tests say an edit copies the worker onto the user's roster under the same id, and `reset` deletes the copy: `wk/workers/hire-blocks.ts:11-14` (module comment), `:81-90` (`edit`, `reset` doc comments), `:213-247` (`edit` body), `:262-277` (`reset` body); `wk/workers/client.ts` doc comments on `edit` and `reset`; `wt/worker-roster.test.ts:286-310`, `:371-383`. The page follows the code. **Neighbour pass:** `ov:20`, `dh:10-11`, `dh:93`, `dh:75-83` (no mention of `reset`), `wd:271-273` need correcting where they are republished. Not this page's job; flagged for pass 5/neighbours.
4. **The pilot says the coder's "message" is "the task's goal".** The built-in flow's message is the task's title, goal and context. `ov:130`, `bw:114` ("Taking a task"). The page should say "the task" or "its title, goal and context", not "goal" alone. [page]
5. **"You can hand it work and expect the work back" holds only for a flow that takes tasks.** A worker flow takes tasks when it declares the `contributor` role; one that declares no role takes none and cannot be a delegate. The built-in `agent` and `coordinator` flows declare their roles themselves. `wd:454-477`, `wk/worker-roles.ts:326-328` (`takesTasks`), `wk/delegates/delegate-check.ts:14-20`, `wt/delegate-takes-conversation-tasks.test.ts:81-114`. What is true for every flow, whatever it is: it takes a user's message on `respond`. `wd:408-411`. So the page's "from the outside it is the same worker either way" is true of talking, and true of handing work only when the flow takes tasks. [page, one clause; roles are [ref]]
6. **The refusal sentences in the pilot move to Reference** (the plan says so). Rows are listed in each section marked [ref].

## 1. What a worker is (opening)

- A worker is a configuration with an owner: its instructions, skills, tools and the flow that runs it. `ov:18`. [page, as "a named agent with a job"]
- You write one in a `WORKER.md`: settings between `---` fences, instructions below. `wd:57-59`, `wk/manifest.ts:15-38` (`declared`, `body`). [page]
- A worker with no `flow:` runs on the built-in agent flow, `agent`; "Write a description and some instructions in a `WORKER.md`, name no `flow:`, and you have a worker that talks." `bw:13`, `wd:76`. [page]
- You can talk to a worker (a conversation) or hand it a task (a session per task). `ov:18` ("one per conversation, one per task, and one lasting session for a workstream it leads"). [page; workstreams are not on this page]
- A worker's sessions are sessions of the flow it runs on. `ov:195`. [page, one clause or [ref]]
- Someone who does not write TypeScript can add a worker or change one's instructions by editing a document. `wd:37`. [page]

### If you know agents (the opening move)

- The built-in `agent` worker is what most frameworks call an agent: a model, the worker's instructions, its tools, and the conversation so far. `bw:13-35`, `bw:43` ("Tools"), `ov:82` ("It sees the recent turns of the conversation it's in"). [page]
- A worker flow can be other things than one model call. A worker's behaviour lives in the flow it names; "A `WORKER.md` is data: a description, the flow the worker runs on, and that flow's settings. Behavior lives in the flow it names." `wd:759`. [page]
- The worker flow the example routes in code is a `router` block that picks a branch from the request, with no model call deciding: "rather than asking a model where it should go". `wd:761-799`. [page: "mostly plain code that asks a model one question at the end" is the pilot's wording; the cited example is code that routes and a generator `answer`; keep the claim to what `wd:761-799` shows: a flow whose graph decides, a model call only inside `answer`] **[verify]** the pilot's "a plan, a draft and a review" as an example is not in any cited example; keep it as a general statement of what a flow can hold ("fixed steps, branching, or a review before anything is sent", the pilot's wording) or drop the example. A flow can be any flow the app defines, so the capability is true; no cited example shows plan/draft/review. Use "fixed steps, branching, or a review" without claiming an example.
- Every worker flow takes a message on one action named `respond`, so an app talks to any worker without knowing which flow it runs on. `wd:408-411`. [page]
- A model call's id: no model name is needed in the file. A worker file may set `model:`; the built-in's default is a provider-neutral intent, `"intent/chat"`, which the app's own resolver maps to a concrete model. `wk/agent-worker-flow.ts:121-133` (`DEFAULT_MODEL`), `wk/agent-worker-flow.ts:466` (`model: z.string().default(options.model ?? DEFAULT_MODEL)`). [ref]; the page's file example sets `model: openai/gpt-6-luna` (the repo's small-model name in examples; needs the provider's AI SDK package: `ov:86`, [ref]).

## 2. The file (`WORKER.md`)

- Where it lives: a team worker at `teams/<team>/workers/<name>/WORKER.md`; the id is team and name joined with a dot, so `teams/engineering/workers/lead/` is `engineering.lead`. An org worker lives at `org/workers/<name>/WORKER.md` and goes by its folder name alone (`shift-coordinator`). `ov:49`, `wd:148-152`. [page: the team form; the org form is [ref]]
- `engineering.lead` and `shift-coordinator` can't collide because a team worker's id always has a dot. `wd:150`. [ref]
- The id is how everything else names the worker: a coordinator's `delegates:`, a task's assignee, the roster, `ensureWorkerSession({ worker })`. `wd:152`. [page, one clause]
- `description` is the only key a file must have. `wd:76`, `wk/loader/read-workforce-directory.ts:275-278` (refusal `WORKER.md in "analyst/" must declare a non-empty \`description\``). [page]
- `name:` is an optional display name for people ("Engineering Manager" for `eng.em`); apps show it in place of the id, which stays the address. `wd:76`, `wk/workers/client.ts` (`RosterEntry.name`: "Display only; the id stays its address."). [page, one clause]
- `model`, `tools`, `delegates`, `flow`, `resources`, `references`, `packages`, `skills`, `capabilities` are settings; the body is `instructions`. `bw:35`, `wd:61-88`, `wd:622-624` (body arrives as `instructions`). [ref `reference/worker-md`; the page's example uses `name`, `description`, `model`, `delegates` only, as the pilot does]
- `delegates` names other workers by id. `wd:86`, `dw:20-29`. [page]
- Everything below the second `---` is the worker's instructions. `wd:622-624`. [page]
- Keys the file refuses: `persona:`, `workerSkills:`, `workerTools:`, `workerPackages:`, `workerId:`, `teamInstructions:`. `wd:76`, `wk/loader/read-workforce-directory.ts:315-351`. [ref]
- Reading the file checks no other key; the flow the worker names decides at hire which settings are allowed. `wd:88`, `wd:356`. [ref]
- The frontmatter is the dialect a `SKILL.md` uses. `wd:90`. [ref]
- `TEAM.md`: optional, holds instructions every worker on a team carries. `wd:92-117`. [ref; not on this page]

### The file, for the stored part: four questions

The `WORKER.md` is a stored part (it lives in the repo).

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The app: the file is in your repo, the same for every user. | `wd:271-273` ("Every `WORKER.md` is a standard worker. Every user ... has it"), `wk/workers/standard-workers.ts:1-12` |
| Who can see it | Every user has the worker it defines; a browser reads its roster row, never the file. A user cannot change the file from the app. | `wd:271-273`, `wk/workers/standard-workers.ts:98` (`client: { state: { read: true } }`), `wk/workers/hire-blocks.ts:11` |
| Where it is stored | Nowhere but the repo: it is read from the files when the app starts, and not stored per user. A deploy that changes a file changes the worker for everyone who has not edited it. | `dh:108-110`, `wk/workers/standard-workers.ts:5-8`, `wd:956` ("Read it once, at startup") |
| How many exist | One per `WORKER.md`. | `wd:271-275` |

## 3. Install the roster

- Workers come with the Workforce kit: `createFlowState({ kits: [workforce(...)] })`. `kit:1-8`, `kit:156-166`, `ks:56-60`. [page]
- Import: `import { workforce } from "@flow-state-dev/workforce/kit"`; Node only, "import it from the app's server entry". `wk/kit/index.ts:1-7`, `ks:35`. [page]
- A kit is a feature an app installs with one config object. `dk:4-6`. (C-12 explains kits; the page links.) [link only]
- The folder defaults to `workforce/` beside the app; `directory` in the kit's config overrides it, read against the working directory. `kit:150-151` ("Its folder defaults to `workforce/` beside the app."), `dk:136-143`, `dk:178-183`, `wt/workforce-kit.test.ts:71-72` (a test passes `workforce({ directory })`). [page]
- The kit reads the folder, builds the workers it declares, and serves one copy of each worker flow and the roster flow; the app does no hiring itself. `kit:1-8`, `wt/workforce-kit.test.ts:70-75` (flows `["agent", "workforce-roster"]`). [page: the first clause; the flow names are [ref]]
- When the folder is read: when the app starts. A refusal rejects `ready()`. `kp:285-289`, `wt/workforce-kit.test.ts:77-107` (the test awaits `state.ready()` and reads the rejection). [page]
- Every file in the folder is used or refused. A file workforce does not read stops the app starting, and the error names the file; the message is `createFlowState: the app can't start; a kit's folder was refused:` and one line per path. `kit:2-9`, `wk/loader/read-workforce-folder.ts:1-12`, `kp:285-289`, `wt/workforce-kit.test.ts:77-98`. [page: one sentence, as the pilot has it; the list of claimed paths is [ref]]
- A `WORKER.md` that does not load (for example a broken frontmatter) stops the app starting too, naming its folder. `wk/loader/read-workforce-folder.ts:84-91` (`the workforce folder did not load:` and one line per problem), `wt/workforce-kit.test.ts:99-107`. [page, same sentence as above; refusal wording is [ref]]
- What the kit's config takes: `agent`, `coordinator`, `consult`, `routines`, `github`, `generated`, `taskChainLimit`, `messages`, `projectCoordinator`, plus `directory`. The config is strict: any other key is refused. `kit:77-96`, `kit:117-129`. [ref `reference/workforce`]
- The kit declares three slots other kits and the app fill: `workerFlows`, `uses`, `flows`. `kit:10-22`, `kit:159-163`. [ref]
- The `workforce/` folder also holds the app's code for worker flows (`flows/workers/`, `blocks/`), which `fsdev gen` registers. `kit:58-74`, `wk/loader/read-workforce-folder.ts:13-20`, `wd:829-835`. [ref; one link from "What runs a worker"]
- The example that installs the kit: kitchen-sink's `workforce/` tree holds one coordinator and four specialists on the built-in `agent` flow. `ks:1-8`, `ks:56-60`. [page: as the pointer to a running example, if the page wants one]
- The roster flow the kit serves is where a user's hires, forks, edits and fires are sent. `dh:19-21`. [ref]

## 4. Talk to one

- A conversation with a worker is a session, and a session runs one worker for its whole life. You name the worker when the session is created; messages after that never name it. `wd:837-840`. [page]
- `createWorkforceClient(fsd)` takes your app's client (`createClient`) and calls through it as that client's user. `wd:856-857`, `wk/workers/client.ts:299-306` (`createWorkforceClient`), `wk/browser.ts:21-29` (exported from `@flow-state-dev/workforce/browser`, which reaches no Node built-in). [page]
- `ensureWorkerSession({ worker })` returns this user's conversation with that worker and creates it the first time. `wd:857-858`, `wk/workers/client.ts` doc comment on `ensureWorkerSession`. [page]
- It returns a `SessionSummary`, which has `id` and `flowKind`. `packages/client/src/types/index.ts:129-132`. [page]
- Two calls at once get the same session, not two. `wd:859-860`, `wk/workers/client.ts` (doc comment). [ref]
- If you move a worker to another flow, the next call starts a new session there. `wd:860-861`. [ref]
- It throws `No worker "<id>" on your roster.` for a worker not on the user's roster. `wd:862-863`. [ref]
- It needs a signed-in organization: the client asks the roster flow for the identity's `orgId` first. `wk/workers/client.ts:300-312` (the `orgOf` read). `ov:84`, `wd` (n/a). [ref; the page's example does not touch it]
- To talk: `fsd.flow(session.flowKind).send("respond", { message }, { sessionId: session.id })`. `wd:902-906`, `ov:185`, `packages/client/src/client.ts:428-433`. [page]
- The worker sees the recent turns of that conversation, and those turns stay in it; what it is told there reaches no other conversation. `ov:82`, `wd` (`bw:118-120`: "A conversation keeps its recent turns"). [page]
- A user can hold more than one conversation with the same worker: create another on the worker's flow with `state: { workerId }`; `ensureWorkerSession` and `findWorkerSession` never return it. `wd:865-873`. [ref]
- `workerId` is a readonly field of the session's state: nothing changes it after the create. The server checks at create that the worker is the user's or a standard one and runs on this flow; a session created without a worker is refused. `wd:875-879`, `wk/workers/keys.ts:31-37`. [ref]
- A worker that is not yours is refused with the same answer as one that does not exist. `wd:875-877`, `dh:99-104`. [page, as the Alice/Bob answer: Bob cannot reach Alice's worker or its sessions] 
- `listWorkerSessions(worker)` lists the user's conversations with a worker; `findWorkerSession` returns the default one or nothing. `wd:861`, `wd:881-900`. [ref]
- A message that names a worker is refused (a message names no worker). A turn on a session whose worker was fired, or moved to another flow since the session was created, is refused. `wd:908-909`. [ref]
- In React, `useFlow` creates sessions with no starting state, which a worker's flow refuses: find or start the session with the client, then `selectSession`. `wd:929-946`. [ref; one clause on the page at most]
- Messages from other workers land in the default conversation. `wd:858`, `mw:12`. [ref]

### A session, for the stored part: four questions

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The user who opened it. A session of a worker belongs to the user whose worker it is; every session in a task chain is the user's. | `dw:236` ("Every session in the chain is yours"), `wk/workers/derive-session-id.ts:1-25` (derived id names its owner), `wd:875-877` |
| Who can see it | Its owner only. A turn can't name another user's worker, and another user's read returns nothing. | `dh:99-104`, `wd:875-877`, `dw:188` ("It never returns another user's rows") |
| Where it is stored | In the app's store, with its history. It outlives the request. | `ov:18`, `wd:837-840` (a session is the conversation), `ov:84` |
| How many exist | One default conversation per user per worker, derived from user, organization, flow and criteria; the user may start more. One session per task a worker is handed. | `wk/workers/derive-session-id.ts:1-25`, `wd:865-873`, `ov:128` ("one run per task") |

## 5. Hand one a task

- A worker with `delegates` can hand work to the workers it names; every hand-over is a **task**, filed on a board, for one of its delegates. `dw:10-14`. [page]
- A worker files tasks when at least one of its delegates takes a task; there is no switch. `dw:14`, `dw:44`. [page, one clause]
- The built-in `agent` flow takes tasks with no setup: it runs a task as one turn in a task session of its own, with its own instructions, tools and model; the message is the task's title, goal and context; the answer is stored as the task's result and the task completes. `ov:130`, `bw:114`, `wt/any-worker-files.test.ts:167-188`. [page]
- A failed turn fails the attempt. A task gets two attempts, a number you cannot change; a first failure runs it again with no word. `bw:114` ("If the turn fails, the attempt fails."), `co:476`. [ref]
- When the task ends, the filing conversation hears it once, in a line under the delegate's name, whether it completed (with what came back), failed for good, stopped on a question, or was cancelled. `co:464-472`, `dw:171-175`. [page: "the lead is told and carries on"; the line formats are [ref]]
- Whether the filing worker "carries on" depends on its flow: a coordinator routing by `judgment` or `best-fit` takes a turn to read the line; one routing by `round-robin` or `everyone` shows the line and nothing more. `co:474`. [ref; the page's lead is an `agent` worker, whose behaviour with the line is: "it is woken with a line when a task the session filed ends" `dw:127` (`entries(turn)` row for the factory's flows) and for the built-in `agent`, which has "all of this already" `dw:62`]. **[verify]** a test showing the built-in `agent` takes a turn on the ending line: `wt/any-worker-files.test.ts:167-188` ("files on an `agent` worker's own session ... and the task completes and is heard there") is the nearest; the page may say "the lead is told when the task ends" and not state what it does next.
- Each task is a session and at least one model turn. `dw:246`. [ref]
- **Which delegates the lead can hand work to:** only its own delegates. A task for anyone else is refused, `unknown_assignee: "<id>" is not on this board's team. Available: ...`, the same answer for another user's worker as for a worker nobody holds, and nothing is stored. `co:438-441`, `dw:215` (the same rule for pieces), `wt/delegates-as-authority.test.ts:17-31`, `:53-65`. [ref `reference/workforce`; the page may say "refused, and the refusal names the worker"]
- A delegate whose flow takes no task is refused, with the reason. `co:444-448`, `wt/delegate-takes-conversation-tasks.test.ts:96-114`. [ref]
- A worker removed or fired before the task ran: the task fails and the conversation hears so; no other worker picks it up. `ov:132`, `co:452`. [ref]
- A delegate must be on the same user's roster; `delegates: all` is the whole roster as it stands, reread on every call. `dw:29`, `dw:33-42`, `wt/delegates-as-authority.test.ts:33-51`. [ref]
- A standard worker's `delegates:` must name standard workers; one that names another is refused at load: `standard worker "ana" names "bobs.helper" in \`delegates:\`, which isn't a standard worker`. `wt/any-worker-files.test.ts:578-587`, `wk/workers/installation.ts:383-409`. [ref]
- Tasks nest: a worker given a task can split it for its own delegates; a chain stops at five boards deep and 100 tasks under one top task. `dw:213-215`, `dw:238-254`. [ref]
- For work that is not a task, a worker sends another worker a message: "Nothing is filed and no result is owed." `mw:10-12`, `dw:16`. [link only, K-08]
- A coordinator is a worker run by the `coordinator` flow that hands each message to its delegates; it is "a worker like any other on your roster". `co:10-12`, `co:14-16`. [link only, K-06]

### Where tasks are shown to a page (sitemap question 4)

- Every session of a worker that files keeps its own board: a conversation, the session a coordinator routes to, or a task session. A worker files onto the board of the session it is in. `dw:169`. [page]
- The conversation's board is what a page reads: a browser reads a user's boards through the `tasks` collection on any of that user's sessions, on a flow that keeps boards (the built-in worker flow, the coordinator flow, or a flow built with `defineSessionBoard`). `dw:188`, `ui:62`, `ui:60-62`. [page]
- A read on any other session fails with a 404, `Unknown resource "tasks"`. `dw:188`. [ref]
- The read covers the tasks of every session that user has filed from and never another user's. `dw:188`. [page]
- `clientData` holds `id`, `title`, `goal`, `status`, `assignee`, `run`, `priority`, `attempts`, `maxAttempts`, `deps`, `labels`, `error`, `createdAt`, `updatedAt`, `startedAt` and `completedAt`; a task's input, output and metadata are never sent. `dw:190`. [ref]
- Ready-made screens: `Roster`, `BoardColumns` and `BoardList` from `@flow-state-dev/workforce/react`; `BoardColumns` and `BoardList` take `sessionId`, `boardRef="tasks"` and `client`, and `live` to read again on a change. `ui:7-18`, `ui:60-130`. [page: name them, one clause; props are [ref]]
- The page's link for rendering a board: `tasks-and-boards` (C-21) for what a board is, `ui.md` for the components. [link only]

### A task, for the stored part: four questions

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The user whose conversation filed it. | `wk/conversation-board/ledger.ts:3-11` ("at the owner's user scope"), `dw:188` |
| Who can see it | That user, through any of their sessions; never another user's. The worker that filed it and its delegate see it through their sessions. A task's input, output and metadata are never sent to a browser. | `dw:188-190`, `wk/conversation-board/ledger.ts:118-125` |
| Where it is stored | In one durable collection at the owner's user scope, with each conversation reaching only its own partition. | `wk/conversation-board/ledger.ts:3-11` |
| How many exist | As many as are filed: up to 100 under one top task, five boards deep. A board may hold any number of its own. | `dw:238-254` |

## 6. Whose worker it is (standard, edited, forked, hired)

- The files in your repo define the **standard** workers. Every user of every organization in the installation has each of them, configured as the file says. A user's set of workers is their **roster**: their own plus the standard ones. `wd:271-273`, `wk/workers/client.ts` (`roster()` doc: "their own workers and every standard worker"), `ov:20`. [page]
- Alice's lead answers to Alice. Bob cannot open her sessions, name her lead as a delegate, or read what it remembers about her. `ov:26`. [page: the answer to question 1]
- Another user's worker gets the same answer as one that does not exist. `dh:99-104`, `co:659`. [page]
- A standard worker is not stored: it is read from the files each time. `dh:108-110`, `wk/workers/standard-workers.ts:5-8`. [page]
- **Edit:** a user can edit a standard worker from inside the app. The edit copies it onto their own roster under the same id and applies the change to the copy; the file is never written; "its conversations, tasks and messages stay where they are". `wk/workers/hire-blocks.ts:11-14`, `:81-86`, `:219-247`; `wk/workers/client.ts` doc comment on `edit`; `wt/worker-roster.test.ts:286-310` (the same session runs the copy on its next turn; Bob's turn runs the file). [page]
- After an edit the roster lists the worker once, still standard, marked `edited: true`; for another user it is unchanged (`edited: false`). `wt/worker-roster.test.ts:286-310`, `wk/workers/roster-view.ts:92-101`. [page, one clause; row shape is [ref]]
- The copy carries the file's other settings, skills, packages and team text: a name-only edit changes nothing else about a turn. `wt/worker-roster.test.ts:292-300`, `:323-350`. [ref]
- **A standard worker keeps its file's flow**: board tasks reach it there, so an edit that names another flow is refused: `"<id>" runs on "<flow>", as its file declares, so its flow can't be changed. Nothing was written.` `wk/workers/hire-blocks.ts:227-231`, `wt/worker-roster.test.ts:395-402`. [ref]
- A standard worker on a flow kept for standard workers cannot be edited at all. `wt/worker-roster.test.ts:385-393`, `wd:429-452`. [ref]
- **Reset:** `reset` deletes the user's copy, so the next turn reads the file again; it refuses for a worker that is not standard (`isn't a standard worker, so there is no default to reset it to`) and for one the user has not edited (`You haven't edited "<id>", so it already matches its file`). `wk/workers/hire-blocks.ts:262-277`, `wt/worker-roster.test.ts:371-383`. [page: the one clause "a reset deletes the copy and brings the standard back"; refusals [ref]]
- **Fork:** `fork` starts a new worker of the user's own from another worker's configuration under a new id; the source is a standard worker or one of the user's own. `wk/workers/hire-blocks.ts:193-211`, `dh:59-62`. [page]
- A fork copies the flow, description, instructions, team instructions, skill names and settings; it does not change when the files do, and the standard worker does not change for anyone. `dh:67-70`, `wt/worker-roster.test.ts:120-143`. [page: "starts from the same settings"; the copy list is [ref]]
- A fork of a worker the user edited starts from the user's copy, without its display name. `wk/workers/hire-blocks.ts:200-206`, `wt/worker-roster.test.ts:352-360`. [ref]
- A fork starts with no conversations; sessions stay with the worker they were held with. `dh:72-73`, `wt/worker-roster.test.ts:156-166`. [ref]
- **Hire:** a user can hire a worker from scratch while the app runs: an id, a flow (the built-in `agent` when left out) and its settings, the same keys a `WORKER.md` accepts. It takes effect on the user's next turn on any process; no files change and nothing restarts. `dh:14-21`, `dh:33-37`, `wk/workers/hire-blocks.ts:172-191`, `wt/worker-roster.test.ts:22-33`. [page]
- A hire, a fork onto, and a fire of a standard worker's id is refused, naming it and suggesting a fork: `"<id>" is a standard worker, which nobody can <verb>. Fork it to get a worker of your own.` `wk/workers/hire-blocks.ts:138-144`, `wt/worker-roster.test.ts:34-47`. [ref]
- A hire under an id already on the user's roster is refused: `"<id>" is already on your roster. Pick another id. Nothing was written.` `wk/workers/hire-blocks.ts:153-162`, `wt/worker-roster.test.ts:49-55`. [ref]
- **Fire:** deletes the row of one of the user's own workers; its past sessions stay readable; a new message there is refused naming the worker as fired. `dh:82-83`, `wk/workers/hire-blocks.ts:249-260`, `wt/worker-roster.test.ts:168-187`. [ref]
- The writes are sent as actions on the roster flow `workforce-roster` or through the client's `hire`, `fork`, `edit`, `reset`, `fire`; the same writes exist as blocks from `createWorkerHireBlocks`. `dh:19-21`, `dh:50-57`, `wk/workers/client.ts` (`WorkforceClient`: `hire`, `fork`, `edit`, `reset`, `fire`), `wk/workers/hire-blocks.ts:127`. [ref `reference/workforce`]
- `roster()` returns each worker's `id`, `flow`, `standard`, `description`, `name`, `teamName`, `forkedFrom`, `edited` and the `settings` its flow shows. `wk/workers/client.ts` (`RosterEntry`), `wk/workers/roster-view.ts:22-32`. [ref]
- `watchRoster` follows the roster and reports each change. `dh:116-142`, `wk/workers/client.ts` doc comment. [ref]
- Hiring at runtime writes no files; it stores the new worker as a row in the user's data. `ov:196`. [page]
- A user who belongs to two organizations has a separate roster in each. `dh:103-104`, `wt/worker-roster.test.ts:69-75`. [ref]
- Two users' workers under one id are two workers; neither sees the other's. `wt/worker-roster.test.ts:57-67`. [page, as the Alice/Bob point]

### The ownership figure ("Standard, edited, forked, hired"), what it can show

One roster with four workers and where each came from. Each fact below is stated above; this list is the figure's labels only.

- **Standard**: from the file; every user has it; not stored. `wd:271-273`, `dh:108-110`.
- **Edited**: a standard worker the user changed; the user's copy under the same id (`MADE FROM` the standard); the file is unchanged; another user still sees the file. `hire-blocks.ts:11-14`, `wt/worker-roster.test.ts:286-310`.
- **Forked**: a new worker under a new id, starting from another worker's settings (`MADE FROM` it); the user's own. `dh:59-70`.
- **Hired**: a worker from scratch, the user's own. `dh:14-17`.
- Stored (hatching): the edited, forked and hired workers, as rows in the user's own data (`workforce/workers/<id>`, user scope, per organization). `wk/workers/keys.ts:11-15`, `wk/workers/worker-row.ts:2-15`, `dh:106-109`. The standard worker is not stored (read from files).
- Highlighter on the edited copy (plan).
- The roster marks the edited copy `standard: true, edited: true` and shows it once. `wt/worker-roster.test.ts:300-305`.

### A user's own worker (hired, forked or edited copy), for the stored part: four questions

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The user who hired, forked or edited it, in the organization they are signed in to. | `dh:99-104`, `wk/workers/worker-row.ts:2-15` |
| Who can see it | Its owner only: another user cannot list it, open its sessions, send it a message, or create a session with it. A browser reads its `flow`, `name`, `description`, `forkedFrom` and the settings its flow shows; its instructions and other settings stay on the server. | `dh:99-104`, `wk/workers/worker-row.ts:66-80`, `wk/workers/worker-row.ts:90-100` |
| Where it is stored | One row in the user's scope at `workforce/workers/<id>`, in the app's store; per user and per organization. | `dh:106-109`, `wk/workers/keys.ts:11-15`, `wk/workers/worker-row.ts:12-14` |
| How many exist | One per id on the user's roster; as many as the user hires or forks. An edited standard worker has one copy per user, under the standard id. | `wk/workers/hire-blocks.ts:153-162`, `:213-247` |

### What a built-in worker keeps (the four questions for what a worker learns)

- A conversation keeps its recent turns; each worker keeps its own skills for each user; long-term memory, once the app adds it, is kept per user and shared by that user's workers on `agent`; standing rules are kept per worker and per user. `bw:118-120` (and its figure `built-in-worker-memory.svg`), `dh:110-114`, `wd:271-279`. [page: "what a worker learns about its user stays with that user"]
- Two users' workers on `agent` never share what they keep; it never reaches another user. `wd:277-279`, `wd:559-561`. [page]
- On a flow you write, where it keeps data is up to the flow; anything at user scope is read by every one of that user's workers on the flow unless the flow puts the worker in the key. `wd:553-563`. [ref]
- Org scope is shared with every user in the org; a worker flow can write there when it is built to; nothing stops it. `wd:547-554`, `ov:16`. [ref]
- Shared output is signed: `writeShared` records `{ userId, workerId }`. `wd:594-617`. [ref]

## 7. What runs a worker (`flow:`)

- Every worker runs on a flow. Leave `flow:` out and it runs on the built-in agent flow. `wd:76`, `bw:13`, `wd:303-305`. [page]
- To run a worker on a flow of your own: write the flow, register it under a worker flow name in `workerFlows` (or put it in `workforce/flows/workers/` and run `fsdev gen`), and give that name in the worker's `flow:`. `wd:759-825`, `wd:829-835`, `kit:58-74`, `kit:10-15`. [page: "write a flow and name it"; registration is [ref]]
- The flow itself lives in the app's code; the `WORKER.md` stays a document anyone can edit. `wd:827` ("A file of code sitting beside it changes nothing about the worker."), `wd:37`. [page]
- The pilot's example: a file at `workforce/teams/support/workers/triage/WORKER.md` with `flow: request-triage`; the flow's kind is `request-triage`. `wd:802-813`, `ov:88-96`. [page; the flow file path `src/flows/request-triage/flow.ts` in the pilot is the pilot's own and is not in a source: with the codegen convention a worker flow sits at `workforce/flows/workers/<name>.ts`, `wk/loader/read-workforce-folder.ts:50`, `wd:833`. **[verify]** the pilot's `src/flows/request-triage/flow.ts`; use the codegen path or "a flow your app registers"]
- A worker flow gets the standard configuration by composing `workerConfigSchema()`; "the flow's author, not the framework, decides what a worker on that flow may say about itself". `wd:342-356`. [ref]
- A worker flow must: take the standard configuration, take a user's message on `respond`, have the entries its roles need, declare the installation's session, receive messages from other workers, and declare any `writtenBy` resource through `sharedResource()`. `wd:402-423`. [ref]
- A flow declares what else it does by roles: `contributor` (takes tasks other workers file for it), `manager` (files tasks for its delegates, hears how each ended), `coordinator` (routes each message to its delegates). A flow that declares no role takes no tasks and files none: a worker on it cannot be a delegate. `wd:454-477`. [page: "a flow that fixed steps and takes tasks declares it"; the table is [ref]]
- The flow decides what a worker may declare in its file: a setting the flow never declared is refused at hire (for a standard worker, `hireWorkforce` throws and nothing is registered; for a user's own worker, the hire or edit is refused). `wd:382-392`, `wd:307-356`. [ref]
- The page's sitemap question 3 ("A worker needs fixed steps and a review. What do you change, and what stays a document?"): you change the flow, a flow you write that names the steps; the `WORKER.md` stays a document that names it with `flow:` and carries its instructions. `wd:759`, `wd:827`, `ov:110-112`. [page]
- A worker flow built in code can read its worker's settings per turn with `installation.resolveWorker(ctx, kind)`; `ctx.flow.config` is the shared copy's and is the same for every worker on it. `wd:358-380`. [ref]
- Every worker on a flow shares one registered copy of it: "A hundred workers on `agent` are one registered flow, not a hundred." `wd:275-276`. [page: one sentence; it explains why a worker is data and not a deployment]
- What `agent` is configured with: `catalog` (tools every worker may name), `skills`, `model`, `maxSteps`, `uses`, `afterAnswer` and more. `bw:66-100` (the options table). [ref]
- The built-in tells each worker who it is first (name, team, description, the workers it can message). `bw:37-41`. [ref]

## 8. What it gets you (benefits the page may state)

Each is a fact above; the page may state a benefit only if it is here.

- Someone who does not write TypeScript can add a worker or change one's instructions by editing a document. `wd:37`. 
- A user can hire, fork or edit a worker while the app runs, with nothing registered and nothing restarted; every process sees it on the next turn. `dh:14-17`, `wk/workers/hire-blocks.ts:1-4`.
- One registered copy of a flow serves every worker on it, so a roster of a hundred workers is not a hundred flows. `wd:275-276`.
- An app talks to any worker the same way, whichever flow runs it: the `respond` action. `wd:408-411`.
- A worker is per user: one user's worker, sessions and what it learns never reach another user. `ov:26`, `dh:99-104`.
- Workers can hand each other tasks, and each task is a session of its own on a board a page can read. `dw:10-14`, `dw:169`, `dw:188`.

## 9. How it fits with the others (links, not explanations)

- **Coordinators**: a worker run by the `coordinator` flow that hands each message to one or more of its delegates; routing is `judgment`, `best-fit`, `round-robin` or `everyone`. `co:10-12`, `co:36-44`. [link, K-06]
- **Delegation**: `delegates:` and tasks. `dw:10-14`. [link, K-07]
- **Messaging**: a worker sends another on the same user's roster a short message that wakes it; nothing filed, no result owed; a worker on another user's roster is unreachable. `mw:10-24`. [link, K-08]
- **Tasks and boards** (C-21): a board is a stored list of tasks plus the loop that works through it; a task's `assignee` can name a standard worker that takes tasks, and Workforce finds the worker. `ov:34`, `ov:126-134`, `wk/delegates/delegate-check.ts:1-20`. [link: "Where a worker's tasks show up"]
- A board's own workers are in-process blocks that claim tasks from a collection; a Workforce worker is something you open a session with and a name a board can hand a task to. `wd:957`, `ov:30-34`. [page, one sentence, or [ref]]
- Projects and workstreams, the Shift Coordinator, standing rules, routines, the Error Reporter: not on this page. `ov:118-124`. [out of scope; link to `reference/workforce` only]
- Authentication: every request runs in an organization; a `resolvePrincipal` supplies `{ userId, orgId }`. `ov:84`, `ov:138-168`. [link; K/auth page]

## 10. What the page must not state (and where it goes)

- The refusal sentences of the pilot's "What a worker won't do" ("Act for anyone but its owner", "Carry a message between two users") go to Reference; their sources are `ov:28` ("Users don't message each other through Workforce, and there are no shared conversations between users yet. A worker never acts for anyone but its owner.") and `mw:20-22`. The plan says to replace the section; the page can keep one honest sentence only if it sits in the Alice/Bob answer: another user cannot reach her worker. [ref]
- Every key of a `WORKER.md` beyond `name`, `description`, `model`, `delegates`, `flow`. `reference/worker-md`.
- Every error message above, the roles table, `workerFlows` and installation options, `showSettings`, `standardOnly`, document and reference grants, skills, packages, capabilities, TEAM.md, naming rules, `readWorkforce` and its error lists, `fsdev gen`. `reference/workforce`.
- The mechanism of the derived session id, partitions and the ledger. [cut]
- Anything about `createWorkerInstallation` / `hireWorkforce` as the manual path: the page uses the kit. The manual path is still documented (`ov:47-116`) and is [ref].

## 11. Page scenario and example check

- The cast: `engineering.lead`, `engineering.coder`, `engineering.reviewer`, with Alice and Bob. The file: `workforce/teams/engineering/workers/lead/WORKER.md` with `name`, `description`, `model`, `delegates: [engineering.coder, engineering.reviewer]`. All keys are real: `name`, `description`, `model`, `delegates`. `wd:61-88`, `bw:35`, `wd:148`. For the lead to file tasks, `engineering.coder` must exist as a worker file and take tasks: on the built-in `agent` flow it does. `bw:114`, `wk/worker-roles.ts` (`declareBuiltInRoles`). The page need not show the coder's file; it can say it is "a worker file beside it".
- **Example type check.** The talk example compiles against these signatures: `createClient({ userId, baseUrl })` (`packages/client/src/client.ts:60-70`), `createWorkforceClient(fsd: WorkforceClientSource)` (`wk/workers/client.ts:299`), `ensureWorkerSession(criteria: WorkerSessionCriteria): Promise<SessionSummary>` with `criteria.worker` (`wk/workers/client.ts` interface; `wk/workers/derive-session-id.ts` `WorkerSessionCriteria`), `fsd.flow(kind).send("respond", input, { sessionId })` (`packages/client/src/client.ts:428-433`). `session.flowKind` and `session.id` exist (`packages/client/src/types/index.ts:129-132`). The pilot's example uses `baseUrl: ""` with the comment that it is the page's own origin; `ov:182` passes a real `baseUrl`. `createClient`'s `fetcher` is the way to add the credential: `ov:168-186`, [ref `auth`]. A server-side `resolvePrincipal` is needed for a signed-in user: `ov:140-166`; the page links.
- The install example compiles against `defineKit`'s factory type: `workforce({ directory: string })` — the factory accepts the kit's config plus `directory`. `dk:90-91`, `kit:117-129`. Wrong import in the pilot (flag 1). `createFlowState` imports from `@flow-state-dev/engine`. `ks:1-60`, `wt/workforce-kit.test.ts:14`.
- **Typed:** the `fsdev.config.ts` snippet would also pass `stores` in a real app; the kit test passes `stores`. `wt/workforce-kit.test.ts:30-38`. **[verify]** whether `createFlowState({ kits })` alone, with no `stores`, starts: the kit test always passes `stores`, so the page's two-line config may omit what an app needs. The in-memory default is documented for persistence (`apps/docs/docs/persistence/overview.md:32`) but this sheet did not run the two-line form. Keep the pilot's `fsdev.config.ts` form only if the earlier pages (`what-flow-state-is`, `how-it-fits-together`) already show it the same way.

## 12. Sitemap questions: what the sheet says

1. **Alice edits the lead from inside the app. What does Bob see? What happens to the file?** Bob sees the lead unchanged: his turn runs the file's version, and his roster row shows it unedited. The file is never written. Alice's edit made her own copy of the lead under the same id; her conversations stay where they are and her next turn runs the copy. A reset deletes her copy. `wt/worker-roster.test.ts:286-310` (Bob's turn: `instructions: "Research carefully."`, `edited: false`), `wk/workers/hire-blocks.ts:11-14`, `:81-90`.
2. **The lead is asked to write code. What does it do?** It files a task for `engineering.coder` (a delegate that takes tasks). The coder works it in a session of its own, with the task as its message; its answer is recorded as the task's result; when the task ends, the lead hears it in its conversation and carries on. The lead does not write the code itself ("You do not write code yourself" is the file's own instruction). A task for a worker that is not one of its delegates is refused and names the worker. `dw:10-14`, `ov:128-132`, `co:438-466`, `wt/delegates-as-authority.test.ts:17-31`.
3. **A worker needs fixed steps and a review. What do you change, and what stays a document?** You write a flow that holds the steps and the review, and name it in the worker's `flow:`. The `WORKER.md` stays a document, still editable by someone who does not write TypeScript. `wd:759`, `wd:827`, `wd:37`.
4. **Where do a worker's tasks show up for a page to render?** On the board that belongs to the conversation that filed them; a page reads it as the `tasks` collection on any of the user's sessions, or with `BoardColumns` / `BoardList` from `@flow-state-dev/workforce/react`. `dw:169`, `dw:188`, `ui:60-130`.

## Revisions (round 1)

- The page's install import is `@flow-state-dev/workforce/kit`, as flag 1 says.
- The worker flow file sits at `workforce/flows/workers/request-triage.ts` and default-exports `workerFlow((installation) => defineFlow(...))`; `fsdev gen` registers it. `wk/workers/worker-flow.ts:1-20`, `wk/loader/read-workforce-folder.ts:13-20,50`. A `flow:` naming a flow not passed to the installation is refused at start. `wk/hire.ts:258`. [ref]
- The page links these rows instead of stating them: R-28 (WORKER.md settings table: the required `description`, what `name`, `model`, `delegates`, `flow` do, how the id is formed from the path; what makes a file unusable and the startup refusal naming the file); R-25 (refusals table: task filed for a worker not in `delegates` is refused naming the worker; limits: a worker acts only for its owner, a message crosses workers on one roster, never users). The page has no limits section.
- The page now ends with "What it gets you" (from section 8) and "How it fits with the others" (section 9).

## Revisions (round 2)

- The triage example now declares `actions.respond` (`userMessage`, `block`, `inputSchema`) because `defineFlow` requires `actions`. It uses a `handler` block as `packages/workforce/test/agent-worker-flow.test.ts:420-428` does, and `configSchema: workerConfigSchema()` per `wd:402-406`. The handler's routing on the word "refund" is the example's own, not a framework behaviour.
- `session.flowKind` is the flow the worker runs on; every worker flow takes `respond` (`wd:408-411`, `packages/client/src/types/index.ts:129-132`). So the talk call works for any worker.
- `workerFlow` passes the installation to the builder; the flow takes `installation.session()` (readonly `workerId`) and `installation.resources` (`wk/workers/worker-flow.ts:1-20`, `wd:415-420`). `fsdev gen` finds files under `workforce/flows/workers/` (`wk/loader/read-workforce-folder.ts:13-20,50`).
- Workforce is glossed at first use in the opening ("the kit that provides workers"); the coordinator clause in the closing section and the duplicate no-TypeScript sentence are cut (once in "What it gets you").

## Revisions (round 3)

- The page now has a section "Where the tasks show up", answering sitemap question 4 (section 5, "Where tasks are shown to a page"): the board of the session that filed them; a read through the `tasks` collection of that session, on a flow that keeps boards; every session the user filed from, never another user's; input, output and metadata never sent. `dw:169`, `dw:188-190`, `ui:60-130`. The example passes the conversation's session id from `ensureWorkerSession` to `BoardColumns` with `boardRef="tasks"` and a `client`, as `ui:~100-110` does. The section links the Workforce screens page for `live` and `BoardList` options.

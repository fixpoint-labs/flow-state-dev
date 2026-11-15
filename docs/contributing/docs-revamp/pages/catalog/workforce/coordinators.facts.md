# Facts for Coordinators (K-06, catalog, kit template)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: the existing user docs, the exported surface and its doc comments, tests, `goals/`, and one example. No spec, issue, changeset, `docs/internal` or `CLAUDE.md` was read. Every surface named here is built, so no fact is a spec's name marked for reconciling.

Paths are from the repo root. Abbreviations:

- `co` = `apps/docs/docs/workforce/coordinators.md` (the page this one replaces; line numbers are the file's own)
- `wd` = `apps/docs/docs/workforce/workers-on-disk.md`
- `dw` = `apps/docs/docs/workforce/delegating-work.md`
- `wf` = `packages/workforce/src`
- `wt` = `packages/workforce/test`
- `kit` = `packages/workforce/src/kit/workforce-kit.ts`
- `cc` = `packages/workforce/src/coordinator/coordinator-config.ts`
- `ck` = `packages/workforce/src/coordinator/coordinator-keys.ts`
- `cf` = `packages/workforce/src/coordinator/coordinator-flow.ts`
- `cr` = `packages/workforce/src/coordinator/coordinator-route.ts`
- `dk` = `packages/workforce/src/delegates/delegate-keys.ts`
- `dl` = `packages/workforce/src/delegates/delegate-list.ts`
- `ks` = `apps/kitchen-sink/lib/workforce-kit.ts` and `apps/kitchen-sink/workforce/teams/support/workers/` (the one running example)
- `lab` = `labs/claude-code-style/workforce/teams/desk/workers/lead/WORKER.md` and `labs/claude-code-style/host.mts`
- `wfk` = `docs/contributing/docs-revamp/pages/concepts/workers.facts.md` (the Workers page's sheet, for the worker file's four questions)

Legend: **[page]** the page states it. **[ref]** it belongs on `reference/workforce` (or `reference/worker-md`); the page links, does not state it. **[verify]** not confirmed against code in this pass, only the existing page backs it; pass 5 must read the code before any such claim reaches the page. **[cut]** history or mechanism; never on the page. **[checked]** read against code or a test in this pass.

## Flags against the page plan and the existing page (read first)

1. **A coordinator is not a kit.** The plan puts it on the kit template (what you get, install it, use it, slots it opens, slots it fills and views it serves, change it). A coordinator is a worker flow, `coordinator`, that the **workforce kit** builds when the kit's config has a `coordinator` key. It declares no slots of its own and fills no slot of another kit. The kit's own slots, `workerFlows`, `uses` and `flows`, reach it only as in fact 3.6 to 3.8. The page's "slots it opens" and "slots it fills" parts have almost nothing to hold; say so in a sentence each, or fold them. `kit:175-183`, `kit:246-256`. **[checked]**
2. **The existing page installs a coordinator the low-level way, and the kit path is not on it.** `co:56-80` builds `createWorkerInstallation`, `defineAgentWorkerFlow`, `defineCoordinatorFlow` and `hireWorkforce`, and calls `flowRegistry.registerMany`. An app on the kit does none of it: `workforce({ coordinator: { routeModel } })` builds and registers the flow. `kit:82-83`, `kit:246-256`, `ks:60`, `lab` host `host.mts:188`. The page shows the kit form. The low-level form is `reference/workforce`. **[checked]**
3. **The kit's `coordinator` key is what makes `flow: coordinator` work.** Omitted, the kit builds no coordinator flow ("Omitted: no coordinator flow, unless `workerFlows` holds one", `kit:82`), so a `WORKER.md` that names `flow: coordinator` names a flow the app does not run. A standard worker whose `flow:` is not a registered worker flow stops the app starting: ``createWorkerInstallation: standard worker "<id>" declares a `flow:` that names no flow.`` `wf/workers/installation.ts:392-395`. **[checked]** The exact message when the kit has no `coordinator` key was not run; the page may say "the app does not start" and must not quote the message. **[verify]**
4. **`routeModel` is required, even when no coordinator routes by best fit.** `cf:213-219` ("Required; the package names no default"). The kit's `coordinator` option is `CoordinatorFlowOptions` minus `installation` and `sessionFields`, so `routeModel` is the one key the app must give. `kit:30-33`, `kit:82-83`. **[checked]**
5. **`delegates: all` exists and the existing page's key table omits it.** `co:45` says "At most 25". The schema is a union of the literal `all` or an array of at most 25 ids. `all` is the whole roster, the worker itself included, read on every call; only the user's worker file sets it, no tool does. `wf/worker-config.ts:196-215`, `dk:17-24`, `cc:90-91`. Routing never hands a message to the coordinator itself even under `all`. `cf` doc comment `cf:30-31`. **[checked]**
6. **Config keys the existing page does not list.** `inferredWork` (`off`, `observe` default, `auto`): what the coordinator does with an event nobody asked it about. `cc:24-29`, `cc:83`, `ck:136`. `defaults:` (the default layer's sections, authored like `delegates`). `wf/worker-config.ts:219-232`. `routines: true` on `defineCoordinatorFlow`'s options keeps routine verbs on the flow. `cf:237-246`. All **[ref]**; none belongs on a 1,100-word page. **[checked]**
7. **Tracker ids and an "Upgrading" block ride on the existing page.** `co:609` is an Upgrading note about a retired tool name a worker file may no longer list. It is a row for the release's Upgrading page, not this page. The code carries no such string in `wf` outside tests. **[cut]**
8. **Defects in the existing page's examples that the new page must not copy.**
   - `co:628-641`: `reviewerFlow` calls `installation.session()` and `installation.resources` before `const installation` is declared, which throws at module load (temporal dead zone).
   - `co:568-603`: `loadWorker`, `researchFlow` and `researchAnswer` use `installation` as a free variable; nothing declares it in the block.
   - `co:56-80`: `flowRegistry` is declared nowhere.
   - `co:97-107`: `userId`, `baseUrl`, `fetcher` are free variables.
   These break the "no phantom names" and "no free variables" rules in `docs/contributing/user-docs.md`. **[checked]** by reading the blocks.
9. **Most of the existing page is Reference.** At 1,100 words the page keeps routing choice, answers going back out, handing out tasks and making a flow a delegate in a paragraph or example each. The following are Reference rows and stay off the page: the full key and option tables (`co:43-50`, `co:84-89`), the refusal table (`co:287-294`), the recent-lines rules (`co:213-220`), cost arithmetic (`co:320`), the route record's fields (`co:355-365`), task retries, questions, steering and follow-ups (`co:476-555`). **[ref]**
10. **Starters are early preview.** Labs that show a coordinator (`lab`, `labs/teammates`) are research software, and `labs/README.md:3-7` says so. The page may point at the kitchen-sink support desk (`ks`) as a running example and must not call a lab a supported starter. **[checked]**

## 1. What a coordinator is (opening and "what you get")

- A coordinator is a worker on the roster, run by the `coordinator` flow. The workers it hands messages to are its **delegates**. `co:10`, `cf:1-14` (module comment: "a worker that hands each of its user's messages to delegates from their own roster, by its routing policy, by filing a task"). **[page]** **[checked]**
- One registered copy of the flow runs every coordinator worker; each session names its worker when created and each turn loads that worker's configuration. `cf:16-19`. **[ref]**
- A coordinator hands a message to one or more delegates, or, under `judgment`, may answer it itself. `co:12`, `cf:22-27`. **[page]** **[checked]**
- It hands a message on by filing a **routed task** for each delegate on the conversation's task board. The task is ordinary: it shows in the user's task list, can be listed and cancelled. `co:12`, `co:324`, `cf:62-66`. **[page, one sentence; tracking details ref]** **[checked]**
- The delegate works the task in a session of its own for this conversation, and its answer lands in the conversation as a message under the delegate's worker id. `co:12`, `co:111`, `cf:62-70`, `wt/coordinator-agent-delegate.test.ts:151-158`. **[page]** **[checked]**
- Reasons to reach for it, stated as what the reader sees: one place to send work; the answer comes back under the specialist's name; the choice is one of four routings. `co:10`, `co:154-159`. **[page]**
- A conversation with a coordinator is a session of the `coordinator` flow, and a worker's session runs one worker for its whole life. `wd:837-840` (via `wfk` §4). **[page, one clause or link]**
- The Shift Coordinator is an org-level worker that can be a coordinator. `co:12`, `co:670`. **[page, link only]**

## 2. Install it

- Package: `@flow-state-dev/workforce`, version `0.5.0`. `packages/workforce/package.json:3`. **[checked]**
- Install line: `pnpm add @flow-state-dev/workforce`. The only source is the cut README copy `docs/contributing/docs-revamp/readmes/workforce.md:6`; the live `packages/workforce/README.md` carries no install block. **[reconcile]** at cutover, and the same flag as the Workers page. **[checked]**
- The kit: `import { workforce } from "@flow-state-dev/workforce/kit"`, a kit named `workforce`. `kit:171-175`, `packages/workforce/package.json:45-48`, `wf/kit/index.ts:8-15`. Node only: its folder reader reads `workforce/` from disk, so import it in server code (the page's example does so in `fsdev.config.ts`, which the `fsdev` CLI loads under Node). `wf/kit/index.ts:1-7`. **[page]** **[checked]**
- The app lists it in `createFlowState({ kits: [...] })`. `kit:2-5`, `kit:171`. **[page]** **[checked]**
- To get a coordinator, give the kit a `coordinator` key with a `routeModel`: `workforce({ agent: { model }, coordinator: { routeModel: model } })`. `kit:82-83`, `cf:213-219`, `ks:60` (`coordinator: { routeModel: ROUTE_MODEL, agent: { catalog: blocks } }`), `lab` host `host.mts:188`. **[page]** **[checked]**
- `routeModel` is a model string the app's resolver turns into an evaluation model, or an evaluation model. `cf:214-219`. The model's provider package must be installed (`co:87`, pointing at `../getting-started/setting-up-models.md#choose-a-provider`). **[page one clause; ref for the rest]** **[checked]**
- Best fit asks `routeModel` as an evaluation model first and, when that call fails on a model string, once more as a language model. `wf/fit-check.ts:15-21`, `co:87`. **[ref]** **[checked]**
- `routeModel` is shared by every coordinator on the flow, and is never called if none routes by best fit. `co:87`. **[ref]** **[verify]**
- The coordinator's own turn (what runs under `judgment`, and when best fit picks the coordinator or misses) is the built-in agent's turn. `agent` under the kit's `coordinator` key takes the options of the built-in `agent` flow: its `model`, tool `catalog`, `uses`, skills. `cf:220-229`, `co:52`, `co:88`. **[page one sentence]** **[checked]**
- The folder: `workforce/` beside the app, `directory` overrides it. `kit:182`, `wfk` §3. The kit reads it at start; a file it does not read stops the app starting. `wfk` §3. **[page, a clause; the Workers page owns it]**
- Where a coordinator's `WORKER.md` goes: `workforce/teams/<team>/workers/<name>/WORKER.md`; id is team and name joined with a dot, so `workforce/teams/support/workers/help/` is `support.help`. `wd:148-152`, `ks` (`support/workers/help/WORKER.md`). **[page]** **[checked]**
- The example that runs: kitchen-sink's `support.help`, a coordinator on `best-fit` over `support.devices`, `support.accounts`, `support.fsd`, `support.general`, with `fallback: support.general`. `apps/kitchen-sink/workforce/teams/support/workers/help/WORKER.md:1-8`, `ks:24-27`. **[page, as the pointer]** **[checked]**

## 3. Use it

### 3.1 The worker file

- A coordinator is a `WORKER.md` that names `flow: coordinator` and lists `delegates:`. `co:16`, `ks` help `WORKER.md:2-3`. **[page]** **[checked]**
- `description` is the only key a file must have. `wd:76` via `wfk` §2. **[page one clause]**
- The body is the coordinator's instructions, read by its own turn. `co:27-28`, `wd:622-624`. **[page]**
- Its keys, and what each sets (`cc:1-32`, `cc:66-85`):

  | Key | Fact | Source |
  | --- | --- | --- |
  | `delegates` | The delegates each new conversation starts with, by worker id; array of at most 25 ids, or `all`. Default `[]`. | `wf/worker-config.ts:213-215`, `dk:24` |
  | `routing` | One of `judgment` (default), `best-fit`, `round-robin`, `everyone`. | `cc:41`, `cc:69` |
  | `fallback` | The delegate that takes a message best fit can't place. Must be one of `delegates`. | `cc:15-16`, `cc:70`, `cc:114-116` |
  | `minConfidence` | Under `best-fit` only: lowest confidence, 0 to 1, at which a delegate pick is used. No default. | `cc:17-18`, `cc:72-76` |
  | `rounds` | How many times an answer goes back out: integer 0 (default) to 3. | `cc:22-23`, `cc:77-82`, `ck:175` |
  | `editsOwnDelegates` | Boolean, default `false`: whether the coordinator's own turn gets `addDelegate`, `removeDelegate`, `setFallback`. | `cc:19-21`, `cc:71` |

  **[page: the shape of the file and the keys the example uses; the full table is ref]** **[checked]**
- The file is refused at start when: `rounds` is above 3 (`rounds can be at most 3`), `minConfidence` is outside 0 to 1 or set on a coordinator that doesn't route by `best-fit`, `fallback` names a worker not in `delegates`, or a delegate is named twice. `cc:79-81`, `cc:103-121`, `cf:1829-1836`, `wt/coordinator-delegates.test.ts:50-58`, `:80-111`. **[ref]** **[checked]**
- A standard worker (one defined in files) may name only standard workers in `delegates:`; the app refuses to start otherwise. `wf/workers/installation.ts:377-408`, `wt/coordinator-delegates.test.ts:42-48`. `delegates: all` is exempt from the check. `wf/workers/installation.ts:401` (`Array.isArray`). **[ref]** **[checked]**
- A delegate is a worker on the user's roster whose flow takes tasks. The built-in `agent` and `coordinator` flows take tasks; a flow of the app's own takes them when it declares the `contributor` role. `wf/delegates/delegate-check.ts:55-79`, `wf/worker-roles.ts:5-12`, `wf/worker-roles.ts:322-328`, `co:285`. **[page]** **[checked]**

### 3.2 Choosing how it routes (answers Q1)

- Four routings. `cc:11-14`, `cc:41`:
  - **`judgment`** (the default): the coordinator's own turn reads the message and decides. It hands the message on by calling `createTask` with a delegate as `assignee`, a short `goal`, `session: "ongoing"` and `resultTo: "conversation"`, as many times as it likes, or answers itself. The delegate gets the user's message as written, with the coordinator's goal beside it. `co:156`, `cf:22-27`, `wf/coordinator/routed-brief.ts:75-90` (`<from>, through <coordinator>: <message>`, then `Your task: <goal>`). **[checked]**
  - **`best-fit`**: one evaluator call reads the message with the conversation's recent lines and picks who takes it: a delegate, by its note or else its description, or the coordinator itself by its own description. A delegate with neither is not offered. `co:157`, `cf:28-33`, `wf/best-fit.ts:33-40`, `:78-80`, `:97-133`. **[checked]**
  - **`round-robin`**: the next delegate in list order after the one the user's last message went to. No model call. `cc:13`, `wf/coordinator/coordinator-state.ts:83-98` (`turnOrder`), `wt/coordinator-rounds.test.ts:65-78`. **[checked]**
  - **`everyone`**: every delegate that can be reached. `cc:13-14`, `wt/coordinator-rounds.test.ts:137-162`. **[checked]**
- Which of them runs a model of the coordinator's own: `judgment` always; `best-fit` when it picks the coordinator or misses; `round-robin` and `everyone` never. `cc:45-54`. **[page one sentence]** **[checked]**
- While a delegate is still working the user's last message, best fit sends the next one to it too, with no call. `co:157`, `wf/best-fit.ts:98`, `wt/coordinator-routing.test.ts:99-117`. **[ref]** **[checked]**
- Every pick is checked against the user's roster when the message arrives; a fired delegate, or one whose flow takes no task, is skipped and the route record says why. Routing never hands a message to the coordinator itself, even when its own id is on its list. `cf:35-39`, `co:161`. **[page one sentence; ref]** **[checked]**
- Best fit can pick the coordinator itself (when it has a `description`): the message is then the coordinator's own job and its own turn takes it, as under `judgment`. `co:165`, `wf/best-fit.ts:112-117`, `wt/coordinator-routing.test.ts:275-300`. **[page one sentence]** **[checked]**
- A confidence floor: some evaluation models report a confidence from 0 to 1 with each answer; `minConfidence` sets the lowest at which a delegate pick is used. A pick of the coordinator is used at any confidence. `typesafe-ai/jev` reports a confidence; a language model does not. `cc:17-18`, `wf/best-fit.ts:108-125`, `co:177`, `co:87`. **[ref]** **[checked]**
- The recent lines: under `best-fit` the evaluator reads the message with the conversation's recent lines (the last 10, at most 4,000 characters, newest kept first), so a follow-up to a delegate's answer can go back to that delegate. Whatever the routing, the delegate that takes a message is shown the same lines for that one turn, as a message of the conversation, never as system text. `wf/coordinator/coordinator-lines.ts:31`, `:34`, `cf:56-61`, `co:193-217`, `wt/coordinator-followup-context.test.ts:285-330`. **[page: the first sentence; the limits ref]** **[checked]**
- A flow of the app's own that is a delegate is handed the message only, unless its generator sets `history: routedTaskHistory` (from `@flow-state-dev/workforce`). `co:220`, `co:607`, `wf/index.ts:71`, `wf/coordinator/routed-brief.ts:146`, `wt/coordinator-followup-context.test.ts:384-390`. **[ref]** **[checked]**

### 3.3 A message that fits no delegate (answers Q2)

The answer depends on the routing.

- **`judgment`**: the coordinator's own turn answers it, and the route record says it answered itself with no delegate. `cf:22-27`, `cr:314-320` (`answeredItself`), `wt/coordinator-routing.test.ts:606-626`. **[page]** **[checked]**
- **`best-fit`**: a ladder. The delegate still on the user's last message; else one evaluator call; else the `fallback:` delegate; else the coordinator's own turn. `cf:28-34`, `wf/best-fit.ts:97-133`. **[page]** **[checked]**
  - It can't place a message when the call fails, the answer is not a choice, nobody is offered, a pick falls below `minConfidence`, or no usable confidence comes back while `minConfidence` is set. `cr:270-278` (`coordinator`, `below-floor`, `no-confidence`, `failed`, `not-a-choice`, `no-delegates`), `wf/best-fit.ts:41-52`, `co:179`. **[ref]** **[checked]**
  - With no fallback, or a fallback that can't be reached, the coordinator's own turn takes it. `wf/best-fit.ts:129-132`, `wt/coordinator-routing.test.ts:225-240`. **[page]** **[checked]**
- **`round-robin` and `everyone`**: with no delegate that can be reached, nobody takes it, and the conversation says so. `wt/coordinator-rounds.test.ts:122-135`, `:164-189`. **[checked]**
- **When nobody takes it:** the coordinator emits the message ``Nobody took this message: <reason>.`` on a user's message, and records the decision `by: "unplaced"` with `none` holding the reason. `cf:1221`, `cf:1248`, `cr:1-24`, `cr:259-268`.
  - Under best fit: ``Nobody took this message: best fit couldn't place it, and the coordinator's own turn failed: <error>.`` `cf:1203-1205`.
  - Under `round-robin` and `everyone`: ``Nobody took this message: no delegate in this conversation can be reached.`` `cf:1333`, `cf:1376`. **[page]** **[checked]**
- That line is a message with no `agentName`; a delegate's answer carries the delegate's worker id; the coordinator's own turn's reply carries an `agentName` starting with `coordinator-judgment` (`COORDINATOR_JUDGMENT`, exported from `@flow-state-dev/workforce/browser`). `co:111`, `ck:149`, `wf/browser.ts:75`. **[ref]** **[verify]** (`co:111` is the only source for the `agentName` of the no-take line).

### 3.4 Talking to it

- Open a session with the coordinator and send it a message as with any worker: `createWorkforceClient(fsd)`, `workforce.ensureWorkerSession({ worker: "support.help" })`, then `fsd.flow(session.flowKind).send("respond", { message }, { sessionId: session.id })`. `co:97-107`, `wf/browser.ts:21-29`, `wfk` §4. **[page]**
- `createWorkforceClient` is exported from `@flow-state-dev/workforce/browser`, which reaches no Node built-in. `wf/browser.ts:21-29`. **[page]** **[checked]**
- The `respond` action's input is `{ message: string }` and is strict: any other key is refused. `cf:259-260`, `cf:1780-1785`. **[ref]** **[checked]**
- The delegate's answer arrives in a request of its own once the delegate's turn ends, not on the `respond` request's stream; to wait for it, follow the session with `fsd.sessions.stream`. `co:113`. **[page one sentence + link]** **[verify]**
- Messages from other workers to the coordinator land in the same conversation. `co:109`. **[ref]**

### 3.5 Letting delegates answer each other

- `rounds: 0` (default): a delegate's answer lands in the conversation and goes no further. `rounds: 1` to `3`: each answer goes back out to the other delegates by the same routing, for that many rounds. The user's message is round 0. `co:308`, `cc:22-23`, `ck:175`. **[page]** **[checked]**
- `best-fit` and `round-robin` route each answer again as it lands, never to its author. `everyone` and `judgment` wait for the round to close: `everyone` then hands each delegate the others' answers in one delivery; `judgment` runs the coordinator's turn once with the round's answers, and what it files goes out in the next round. `cf:84-96`, `co:310-312`, `wt/coordinator-rounds.test.ts:284-338`, `:376-432`. **[page one sentence; per-routing detail ref]** **[checked]**
- A round closes when every delegate in it has answered, failed or been cancelled, or at its deadline. Default deadline five minutes (`ROUND_DEADLINE_MS`), set per flow with `roundDeadlineMs` (a positive whole number of milliseconds, else it throws). `ck:177-178`, `cf:230-236`, `cf:405-410`, `wt/coordinator-rounds.test.ts:191-202`. **[ref]** **[checked]**
- A delegate still working at the deadline keeps working; the round closes without it and its answer lands once, going no further. `co:314`, `wt/coordinator-rounds.test.ts:483-510`. **[ref]** **[checked]**
- A conversation keeps at most 50 rounds open; a message past that is still delivered, but its answers go no further and its record carries a `note`. `wf/coordinator/coordinator-rounds.ts:51`, `cf:741`, `wt/coordinator-rounds.test.ts:744-795`. **[ref]** **[checked]**
- Cost: at most delegates × (rounds + 1) delegate turns per message, 100 at 25 delegates and 3 rounds. `co:320`. **[ref]** (derived from the 25 and 3 limits, `dk:24`, `ck:175`) **[verify]**
- Restart behaviour of the deadline (an engine wake on a host that keeps wakes, an in-process timer otherwise). `co:316`, `cf:84-96`, `wt/coordinator-rounds.test.ts:618-700`. **[ref]** **[checked]**

### 3.6 Handing out tasks

- A coordinator can hand a task of its own making to a delegate, not just route a message. `co:426`. **[page]**
- The task tools are the task board's, sent as actions on the conversation's session and named for its board, `tasks`: `createTask_tasks`, `getTask_tasks`, `listTasks_tasks`, `updateTask_tasks`. The coordinator has the same verbs as tools. `co:436`, `wf/conversation-board/ledger.ts:61` (`CONVERSATION_LEDGER_ID = "tasks"`, "the task actions are named for it"), `wf/conversation-board/session-board.ts:15-18`. **[page]** **[checked]**
- The assignee must be one of this conversation's delegates that takes tasks. Another user's worker and a worker nobody holds get the same answer, and nothing is stored: `{ ok: false, error: "unknown_assignee: \"<id>\" is not on this board's team. Available: ..." }`. `co:438-442`, `wt/delegates-as-authority.test.ts:17-31`, `:53-65` (as cited by `wfk` §5). **[ref]** **[verify]** (not re-read in this pass)
- `createTask_tasks` answers `{ ok: true, taskId }` once the task is stored, without waiting for it to run; the task starts at once, in a task session of its own that belongs to the user. `co:452`. **[page one sentence]** **[verify]**
- With `held: true` the task does not start until released with `updateTask_tasks` and `status: "pending"`. `co:454-460`. **[ref]** **[verify]**
- A task with no assignee goes to the conversation's only delegate that takes tasks; with several, it waits on the board unassigned. `co:450`. **[ref]** **[verify]**
- The conversation hears once when a task ends, in a line under the delegate's name. `co:466-472`. **[page one sentence]** **[verify]**
- A task gets two attempts; one filed with its result to the conversation, such as a routed task, gets one. `co:476`, `wf/conversation-board/board.ts:176` (doc comment on attempts). **[ref]** **[verify]**
- A routed task is filed with `session: "ongoing"`, `resultTo: "conversation"` and one attempt; one is filed per delegate per round; `updateTask_tasks` refuses `session`, `resultTo` and `target` on it with `filing_setting_fixed`. `co:324`, `co:334`, `cf:62-70`. **[ref]** **[verify]** for `filing_setting_fixed` (no match in `wf/coordinator`; the code is in the board).
- When the coordinator's own turn files with `createTask` while routing a message, a call with no `assignee` is refused `routed_assignee_required`; a task that can't be handed on is refused `not_routed: not handed to <worker>: <reason>. Nothing was filed.` and the refusal names the delegates that can take one; `held`, `deps`, `followUpOf` are refused with `routed_task_starts_now`. `cf:835-873`. **[ref]** **[checked]**
- Cancelling a routed task: `updateTask_tasks` with `status: "cancelled"`, while it waits or runs. The delegate's part ends with no line and its late output does not land; its turn itself runs on. `co:334`, `co:662`, `wt/coordinator-rounds.test.ts:588-616`. **[ref]** **[checked]** (test) / **[verify]** (turn-runs-on)
- A delegate stopping on a question, steering a running task, and follow-ups are `co:497-555`. **[ref]** link to `delegating-work` and the task board's page.

### 3.7 Changing delegates

- `delegates:` is where each new conversation starts. A conversation copies `delegates:` and `fallback:` into its own session state the first time its delegates are read or changed (on its first message, or the first delegate action or tool call). From then on changes stay in that conversation; other conversations with the same coordinator don't see them and the file is never written. `dl:14-19`, `wf/worker-config.ts:196-201`, `wt/coordinator-delegates.test.ts:114-139`, `co:224`. **[page]** **[checked]**
- Four actions on the conversation's session: `addDelegate({ worker, note? })`, `removeDelegate({ worker })`, `setFallback({ worker })` (`{ worker: null }` clears it), `listDelegates({})`. `dk:11-14`, `co:228-235`. The coordinator's own turn has tools of the same names; `listDelegates` always; `addDelegate`, `removeDelegate`, `setFallback` only when its file sets `editsOwnDelegates: true`. `wf/delegates/worker-delegates.ts:139-141`, `:200` (`editsOwnDelegates` reads the worker's setting), `wt/coordinator-delegates.test.ts:351-395`. **[page]** **[checked]**
- `note` is optional; best fit picks by it before the worker's description. `dl:41-44`, `co:237`. **[page one clause]** **[checked]**
- Output of every action: the conversation's list as it stands after the call: `{ delegates, fallback, max: 25, filingSessionId }`. `wf/delegates/worker-delegates.ts:113-120`. **[ref]** **[checked]**
- `listDelegates` also gives each delegate `description` (what the worker does, or `null`) and `takes` (`tasks` or `nothing`), read from the roster at call time. `wf/delegates/worker-delegates.ts:100-106`, `wt/coordinator-delegates.test.ts:164-208`. **[ref]** **[checked]**
- Refusals, each writes nothing; the request fails with the message in `result.error.message`, or a tool hands the model `{ refused: "<message>" }`. `dl:124-150`, `wf/delegates/delegate-check.ts:64-76`, `cf:798`, `co:265-267`. The messages (all **[ref]**, **[checked]**):
  - ``No worker "<id>" on your roster.`` (another user's worker and a worker nobody holds, the same answer) `delegate-check.ts:64`.
  - ``Worker "<id>" runs on flow "<flow>", which takes no task, so it can't be a delegate.`` `delegate-check.ts:73`.
  - ``"<id>" is already a delegate in this conversation.`` `dl:124`.
  - ``This conversation already has 25 delegates, the most it can hold. Remove one first.`` `dl:126-129`.
  - ``"<id>" isn't a delegate in this conversation.`` `dl:136`.
  - ``"<id>" isn't a delegate in this conversation, so it can't be the fallback.`` `dl:150`.
- A session create whose `state` carries `delegates` is refused with a 400: ``Session state field "delegates" is written only by flow "coordinator"; a caller cannot set it.`` `dk:26-29`, `wf/coordinator/coordinator-state.ts:70-77`, `wt/coordinator-delegates.test.ts:309-318`, `co:277-281`. **[ref]** **[checked]** (the exact message text only from `co:280`)
- Removing checks only the list, so a fired delegate can be removed; a delegate removed still answers a message it was already handed; removing the fallback clears it and best fit then hands what it can't place to the coordinator's own turn. `co:304`, `wt/coordinator-delegates.test.ts:267-293`. **[ref]** **[checked]**

### 3.8 Making your own flow a delegate (answers Q3)

- A worker on the built-in `agent` flow takes a coordinator's routed tasks with no setup. `co:559`, `wf/agent-worker-flow.ts` (built-in roles), `wt/coordinator-agent-delegate.test.ts:145-158`. **[page]** **[checked]**
- A worker flow of the app's own takes tasks when it declares the `contributor` role **and** its `work` task entry is built with `workerTaskEntry`. `wf/worker-roles.ts:5-12`, `wf/worker-roles.ts:322-328`, `co:613`, `wf/workers/worker-flow.ts:48-55`. **[page]** **[checked]**
- The hire checks both ways: a `contributor` without a `work` built by `workerTaskEntry` is refused, and so is a `workerTaskEntry` on a flow that doesn't declare `contributor`; each refusal names the flow, the role and the entry. `wf/worker-roles.ts:14-20`, `co:643`. **[ref]** **[checked]** (comment); message text **[verify]**
- Declaring the role: a `workerFlows` entry `{ flow, roles: ["contributor"] }`, or `workerFlow(build, { roles: ["contributor"] })`. `wf/hire.ts:129-137`, `wf/workers/worker-flow.ts:48-70`. **[page]** **[checked]**
- With the kit, a worker flow goes in the kit's `workerFlows` slot (keyed by flow name; an entry is a flow, `{ flow, roles }` or a `workerFlow(...)` builder), or in the generated module's `workerFlows`. The same key in both is refused. `kit:10-16`, `kit:178`, `kit:150-153`, `kit:200-208`. A `workerFlow(build)` builder is handed the installation, so a flow can call `installation.session()` and `installation.resources` without closing over a later variable. `kit:12-14`, `wf/workers/worker-flow.ts:44-70`, `wt/workforce-kit.test.ts:114-140`. **[page]** **[checked]**
- `workerTaskEntry(options)` takes `name` and exactly one of: `turn` (the flow's turn for one message: `{ message }` in, the answer out) or `block` (a block that takes the task itself: `taskId`, `goal`, `context`, `input`, `attempts`, plus `claim`; for work that isn't one message in and one answer out, such as a coding run). Giving both, or neither, throws. `wf/conversation-board/task-entry.ts:125-147`, `:275-285`, `co:645-653`. **[page: `turn`; `block` ref]** **[checked]**
- With `turn`, each task runs as one turn, in a task session of its own; the task as filed is the turn's message and what the turn returns is the task's result. `wf/conversation-board/task-entry.ts:296-302`, `co:651`. **[page]** **[checked]**
- A routed task's turn is handed `{ message }`, where the message reads `<from>, through <coordinator>: <message>`, plus `Your task: <goal>` on its own line when the coordinator's turn filed it with a goal. Whatever the turn returns, a string or `{ text }`, is the answer; an empty answer lands nothing. `wf/coordinator/routed-brief.ts:75-90`, `co:607`. **[ref]** **[checked]** (format); **[verify]** (`{ text }` and empty answer)
- A flow minimal enough to be a delegate, from the page's own example (to be rewritten with no phantom names): `defineFlow({ kind, configSchema: workerConfigSchema(), session: installation.session(), resources: { ...installation.resources }, actions: { respond: { inputSchema, block: turn, userMessage } }, task: { actions: { work: workerTaskEntry({ name, turn }) } } })`. `co:628-635`, `wt/delegate-takes-conversation-tasks.test.ts:25-47` (the same shape built in a test). `workerTaskEntry`, `workerConfigSchema`, `workerConfigOf` are exported from `@flow-state-dev/workforce`. `wf/index.ts:64`, `:154`. **[page]** **[checked]**
- A flow whose `work` entry takes tasks only from a board of its own is not `workerTaskEntry`'s: register it without `contributor`; `listDelegates` then reports its workers as taking `nothing`, routing skips them and `createTask` refuses them. `co:655`, `wt/delegate-takes-conversation-tasks.test.ts:81-114`. **[ref]** **[checked]**
- A delegate in the kit's own `workerFlows`: a coding worker built on the harness manager uses `block`. `co:653`, `lab` `lead/WORKER.md:4` (delegates `desk.thread-coder`, `-codex`, `-cursor`). **[ref]**

## 4. Slots it opens, slots it fills, views it serves

- **Slots it opens: none.** The `coordinator` flow declares no kit slot. `kit:177-181` lists the workforce kit's three: `workerFlows` (keyed), `uses` (a list), `flows` (keyed). **[page one sentence]** **[checked]**
- **Slots it fills: none in another kit.** What reaches the coordinator is the workforce kit's own slots: the `uses` slot's capabilities are added to the agent and coordinator flows the kit builds (`kit:17-18`, `kit:221-227`, `kit:253`), so another kit that fills `uses` (the harness kit adds its readiness this way, `kit:17-18`) reaches the coordinator's turn. **[page one sentence]** **[checked]**
- The kit also adds two capabilities of its own to the coordinator flow: consulting another conversation (`consultSessions`) and the routine tools. Each is offered only to a worker whose file picks it. `kit:24-26`, `kit:221-227`. **[ref]** **[checked]**
- A `workerFlows` entry keyed `coordinator` replaces the kit's own; the kit's `coordinator` key then must not also be set (the kit throws: ``workforce: `coordinator` is configured, and the app's worker flows hold a "coordinator" flow too. Keep one.``). `kit:12-16`, `kit:215-217`. **[page one sentence: change it]** **[checked]**
- App session fields (the kit's `sessionFields`) are declared on the agent and coordinator sessions, written on the server only; declaring them under `coordinator.sessionFields` is refused. `kit:108-111`, `kit:210-214`, `wt/workforce-kit.test.ts:203-253`. **[ref]** **[checked]**
- **Views it serves:** one session view, `listTasks_tasks`: the conversation's task list, watched with `useView`. `cf:1790-1791`, `wf/conversation-board/session-board.ts:19-20`, `:271-272`. **[page]** **[checked]**
- **Items it emits:** one `coordinator-route` data item per routing decision, never a line, never in the model's history (`itemVisibility: { client: true, history: false }`, `cr:116-123`). A client tells a record from a line by `item.type === "data"` and the `dataType` `COORDINATOR_ROUTE` (`"coordinator-route"`, `wf/coordinator/coordinator-keys.ts:25`, exported from `@flow-state-dev/workforce/browser`, `wf/browser.ts:76`; a reader doing it: `wf/coordinator/coordinator-lines.ts:215`). The record's type is `CoordinatorRouteRecord` and its Zod schema `coordinatorRouteRecordSchema`, from the package root. `cr:1-24`, `cr:109`, `wf/coordinator/index.ts:24-32`. **[page: one sentence; fields ref]** **[checked]**
- The record's fields: `messageRequestId`, `round`, `policy`, `by` (`judgment`, `held`, `evaluated`, `fallback`, `round-robin`, `everyone`, `unplaced`), `delegates` (each with `worker`, `outcome` of `delivered`, `skipped` or `failed`, and `reason`), `none`, `answeredItself`, `fit`, `evaluationFailed`, `note`. `cr:259-332`. **[ref]** **[checked]**
- A React app renders it by registering a renderer under `COORDINATOR_ROUTE` in `FlowProvider`'s `renderers.data`; the renderer receives `{ item: DataItem }` and reads the record from `item.value`. `packages/react/src/registry/block-renderers.ts:53-58,83-85`. **[ref]** **[verify]** (the example was not compiled in this pass)
- Reading the records outside a renderer: `fsd.sessions.requests(session.id, { includeItems: true })`; without `includeItems: true` a request carries no `items`. `co:405-422`. **[ref]** **[verify]**

## 5. Change it

- Change a conversation's delegates: section 3.7. **[page]**
- Change the defaults every new conversation starts from: edit `delegates:` in the `WORKER.md`. It reaches only conversations that haven't had a message or a delegate action yet. `co:224`, `wt/coordinator-delegates.test.ts:114-139`. **[page]** **[checked]**
- Change how it routes: edit `routing:` (and `fallback:`, `minConfidence:`, `rounds:`) in the `WORKER.md`. A coordinator's routing is read per message from the worker's configuration. `wf/coordinator/coordinator-flow.ts:1736-1741` (`coordinatorRunsOwnTurn(routing)` read at the turn). **[page]** **[verify]** whether an edit to a running conversation's `routing:` applies to the next message; the code reads the worker's config per turn, but no test was read for the file-edit case. The existing page is silent.
- A conversation records its `policy` on each route record from the worker's `routing:`. `cr:307`. **[ref]**
- Replace the whole flow: put a flow under the `coordinator` key of the kit's `workerFlows` slot. Section 4. **[page one sentence]** **[checked]**
- Change the coordinator's own turn: `coordinator: { agent: { ... } }` on the kit takes the built-in agent's options, and the worker's own `model`, `tools`, `skills` and `capabilities` read the way an `agent` worker's do. `listDelegates` and the task tools come with the flow whatever the `tools:` line says. `cf:220-229`, `co:52`. **[page one sentence; ref]** **[checked]**

## 6. Stored parts: the four questions

A coordinator stores data in six places. Each answers who owns it, who can see it, where it is stored, and how many exist.

### The `WORKER.md` (the coordinator's definition)

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The app: the file is in the repo. The same for every user. | `wfk` §2 table; `wf/workers/standard-workers.ts:1-12` |
| Who can see it | Every user has the worker it defines; a browser reads the roster row, never the file. A user cannot change the file from the app. A user who edits a standard worker gets their own copy under the same id. | `wfk` §2 and flag 3 |
| Where it is stored | The repo only; read when the app starts, not stored per user. | `wfk` §2 table |
| How many exist | One per `WORKER.md`. | `wd:271-275` |

### The conversation's delegate list and fallback

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The conversation, which belongs to the user who opened it. Only the flow's own code writes it; a session create that seeds it is refused with a 400. | `dl:14-24`, `dk:26-29`, `co:277-281` |
| Who can see it | The conversation's owner, through `listDelegates`. No other user's call returns it. | `dl:14-24`, `wt/coordinator-delegates.test.ts:218-227` (another user's worker gets the same answer as a missing one) |
| Where it is stored | The conversation's session state (`delegates` and `fallback`), in the app's store; `null` until first read or changed, then a copy of the file's defaults. Never written back to the file. | `dk:26-29`, `dl:50-61`, `dl:14-19` |
| How many exist | One list per conversation, of at most 25 delegates, and at most one fallback. A user has one default conversation per coordinator and may start more. | `dk:24`, `dl:126-129`, `wfk` §4 table |

### Best fit's hold, round robin's cursor, open rounds, landed answers

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The conversation. Server-written; only the routing, the rounds and a message's ending write them; a session create can't seed them. | `wf/coordinator/coordinator-state.ts:1-10`, `:62-77` |
| Who can see it | Nothing on the page reads it; the visible effect is where a message goes. | `ck:180-191` (names) |
| Where it is stored | The conversation's session state: `bestFitHold`, `roundRobin`, `openRounds`, `landedAnswers`. | `ck:181-191`, `wf/coordinator/coordinator-state.ts:62-68` |
| How many exist | One of each per conversation; `openRounds` holds at most 50 entries. | `wf/coordinator/coordinator-rounds.ts:51` |

### Routed tasks (the rows a message becomes)

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The user whose conversation it is. The ledger is at the owner's user scope. | `wf/conversation-board/ledger.ts:3-8` |
| Who can see it | The conversation's owner, in the task list; a conversation reaches only its own partition, so another conversation with the same coordinator and the same delegates never sees it. A browser reads a bounded set of a row's fields; the input, output and write log stay on the server. | `wf/conversation-board/ledger.ts:3-8`, `:77-85`, `co:482` |
| Where it is stored | The conversation task ledger, the resource `tasks`, one durable collection for every conversation, partitioned by the conversation's `filingSessionId`. A conversation deleted and created again under the same id starts with an empty board; the old rows stay in the store, unread. | `wf/conversation-board/ledger.ts:3-12`, `:61` |
| How many exist | One routed task per delegate per round per message (under `judgment`, one per `createTask` call). Up to 100 from one message at 25 delegates, `everyone` and `rounds: 3`. They stay like any finished task. A delegate handed the same message twice in one round gets one task. | `co:324`, `co:328`, `co:336`, `cf:62-66` (the id is derived from message, round and delegate record) |

### The delegate's session for this conversation

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The user. Every session a worker runs belongs to the user whose worker it is. | `wfk` §4 table (session) |
| Who can see it | Its owner only. `workforce.findWorkerSession({ worker, filingSessionId })` returns it; a lookup that names only the worker never does. | `co:263` |
| Where it is stored | The app's store, with its history. It outlives the request. | `wfk` §4 table |
| How many exist | One per conversation per delegate, reused by every message from that conversation to that delegate; it works one routed task at a time. A task a delegate works for a `session: "new"` filing runs in a task session of its own. | `co:330`, `wt/coordinator-routing.test.ts:480-509`, `co:452` |

### Route records

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The conversation's owner. | `cr:334-345` (emitted into the conversation's own request) |
| Who can see it | The owner, as `coordinator-route` data items in the conversation's requests. They never enter the model's history. | `cr:1-3`, `cr:121-122` |
| Where it is stored | With the request that made the decision, as an item; read back with `fsd.sessions.requests(session.id, { includeItems: true })`. A record the framework can't confirm was kept is a failure: the routing runs nobody. | `cr:334-345`, `co:405-422` |
| How many exist | One per routing decision: one per message per round. | `cr:259-268`, `cr:302-307` |

### Recent lines are not stored

- The conversation's recent lines are read from the conversation's own items when a message opens and shown to a delegate for one turn; the delegate's session keeps the user's message and its answer, never the lines. `cf:56-61`, `co:217`. **[ref]** **[checked]** (read path, `wf/coordinator/coordinator-lines.ts:1-30`)

## 7. Limits (state flat)

- A coordinator hands a message only to workers on the user's own roster whose flow takes tasks. Another user's worker is refused with the same answer as a missing one. `dl:124`, `wf/delegates/delegate-check.ts:64`, `co:659`. **[page]** **[checked]**
- At most 25 delegates in a written list; `all` is not bounded by the cap. `wf/worker-config.ts:196-215`, `dk:24`. **[page]** **[checked]**
- At most 3 rounds. `ck:175`. **[ref]** **[checked]**
- A change to delegates in a conversation is not written back to the `WORKER.md`. `co:660`, `dl:14-19`. **[page]** **[checked]**
- Best fit knows a delegate by its note, or else its description, and nothing else; not its instructions. `co:663`, `wf/best-fit.ts:78-80`. **[page]** **[checked]** (that options carry note or description) / **[verify]** (nothing else)
- Cancelling a routed task, or a round's deadline, ends a delegate's part but does not stop its turn. `co:661-662`. **[ref]** **[verify]**
- Without `editsOwnDelegates: true`, the coordinator's turn has `listDelegates` only. `co:666`, `wf/delegates/worker-delegates.ts:139-141`, `:200`. **[page]** **[checked]**
- A delegate may file tasks only for its own worker's delegates. `co:665`. **[ref]** **[verify]**
- It does not run models of its own under `round-robin` and `everyone`. `cc:45-54`. **[page]** **[checked]**

## 8. Answer key for the plan's three questions (for pass 2)

1. **Two ways a coordinator can choose a delegate.** Any two of: `judgment` (its own turn decides and files tasks), `best-fit` (one evaluator call over the delegates' notes and descriptions), `round-robin` (next in list order), `everyone` (all). Facts 3.2. `routing:` in the `WORKER.md`, default `judgment`.
2. **A message fits no delegate.** Under `judgment`, the coordinator's own turn answers it. Under `best-fit`: the `fallback:` delegate if it has one that can be reached, otherwise the coordinator's own turn; if that fails too, the conversation says `Nobody took this message: ...` and the route record is `unplaced`. Under `round-robin` and `everyone` with nobody reachable, the same `Nobody took this message` line. Facts 3.3.
3. **Make your own flow a delegate.** Register it as a worker flow declared `contributor` (the kit's `workerFlows` slot, `{ flow, roles: ["contributor"] }` or `workerFlow(build, { roles: ["contributor"] })`), with `task: { actions: { work: workerTaskEntry({ name, turn }) } }`; then name a worker on that flow in the coordinator's `delegates:`. Both halves are checked together at start. Facts 3.8.

## 9. What stays off the page

- The low-level API (`createWorkerInstallation`, `defineCoordinatorFlow`, `hireWorkforce`) and `flowRegistry`. **[ref]**
- The wake, restart and in-process-timer details of a round deadline, and the cost arithmetic. **[ref]**
- Every refusal message and error code in tables. **[ref]**
- The Upgrading note about the retired tool name, and anything about what a coordinator used to do. **[cut]**
- The stream-and-wait script (`co:116-146`) beyond one sentence and a link to the client page. **[ref]**
- How a task stops on a question, steering, follow-ups, held tasks, dependencies. These are the task board's and `delegating-work`'s. **[ref]**
- Tracker ids in test names (`BR-*`, `FIX-*`): never cited on the page. **[cut]**

## 10. Revise round 1 (page trimmed; facts above unchanged and still true)

The page now states less than sections 3.1 to 3.8 allow: per-mode best-fit ladder, round timing per routing, the `uses` capabilities reaching the coordinator's turn, the `delegates: all` and 25 limits, and the copy-on-first-message rule are [ref] only. `reachable` is not used on the page; the page says a delegate that "can take it" is on the user's roster with a flow that takes tasks (3.1, 3.3). Another coordinator is a delegate with no setup (3.1 line on the `agent` and `coordinator` flows).

## 11. Revise round 2 (facts above unchanged and still true)

The page now states, from facts 3.3 and 3.7 and 5: the best-fit ladder's last two rungs (no fallback or unreachable fallback goes to the coordinator's own turn; if that fails, `Nobody took this message: best fit couldn't place it, and the coordinator's own turn failed: <error>.` and `by: "unplaced"`), the `round-robin` and `everyone` no-take line, and the copy-on-first-read rule with its consequences: already-open conversations don't see an `addDelegate`, the `WORKER.md` is never written, and a later file edit reaches only conversations with no message or delegate action yet.

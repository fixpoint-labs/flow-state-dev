# Facts for Goal-seek loop (K-28, catalog, pattern page)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, and one example. No spec, issue, changeset, `docs/internal` or `CLAUDE.md` was read. Every surface named here is built, so no fact is a spec's name marked for reconciling. Tracker ids appear in the source comments; none goes on the page.

Paths are from the repo root. Abbreviations:

- `gsl` = `packages/orchestration/src/task-board/goal-seek-loop.ts`
- `tb` = `packages/orchestration/src/task-board/index.ts`
- `gt` = `packages/orchestration/test/task-board/goal-seek-loop.test.ts`
- `it` = `packages/integration-tests/src/scenarios/goal-seek-after-an-answer.test.ts`
- `pt` = `packages/patterns/src/parallelTasks/index.ts`
- `pe` = `packages/patterns/src/plan-and-execute/index.ts`
- `ca` = `packages/ui/registry/components/chat-assistant.tsx`
- `ts` = `packages/orchestration/src/tasks/schema/task-status.ts`
- `old` = `apps/docs/docs/orchestration/goal-seek-loop.md` (the page this replaces; the revamp copy at `docs/contributing/docs-revamp/pages/catalog/patterns/goal-seek-loop.md` is the same text)
- `tbd` = `apps/docs/docs/orchestration/task-board.md`
- `rm` = `packages/orchestration/README.md`, `pr` = `packages/patterns/README.md`

Legend: **[page]** the page states it. **[ref]** Reference row; the page links, does not state it. **[cut]** history or mechanism; never on the page. **[checked]** read against code and a test. **[code-read]** read in code, no test exercises it.

## Flags against the page plan and the existing page (read first)

1. **The existing page omits the second wait reason.** A task waiting on an event outside the board (`waitExternally`) ends the pass with reason `"waiting-on-an-event"`, not `"waiting-on-a-user"`: `gsl:256`, `gsl:391-397`, test `gt:645-679`. `old` documents only `waiting-on-a-user`. The page names both reasons, in one row. **[checked]**
2. **`old` is mostly Reference.** The sitemap budget is 1,000 words and four contents (the loop, writing a judge, use it, how the patterns map onto it). Leaves the page: the waiting/owed-turn mechanics (`old` paragraph on "never judges work that waits on a person"), `mapToVerdict`, the three construction guards, the "Using a goalSeekLoop as a tool" section, the stream-item shape and the renderer note, the Limits section. The page keeps a sentence and a link for each. **[ref]**
3. **The `old` example uses free names.** `researchWorker` and `planResearch` are never declared or imported; the new example must declare or import every name and title each file (`user-docs.md` "Code examples"). `ctx.cap.research.createTasks(...)` is right when the board is named `research`: the capability is keyed by the board's `name` (`tb:606`, `tb:674-675`; test seed `gt:57-67` reads `ctx.cap[board.capability.name].createTasks`). **[checked]**
4. **"Which shipped patterns are this loop underneath" has two answers, not four.** Only `parallelTasks` and `planAndExecute` call `goalSeekLoop`: `pt:190`, `pe:810`. A search of every package `src/` finds no other caller (the only other files that name it are the loop's own task-board files, comments, and the UI registry). `supervisor`, `routedSpecialists`, `blackboard` and `debate` do not. `old` lists Supervisor and `routedSpecialists` as "not built on this loop"; that is true but is a negative the page need not carry. **[checked]**
5. **`old` says "The judge looks at the settled board".** For a drain that returns `blocked` on a wait, the judge never runs (section 2), so "settled" holds only when it runs. **[checked]**
6. **Leaks to cut.** `old` "Cost hazard" caution is advice and may stay as one sentence (a `continue` with no new work re-drains a settled board until the cap, `gsl:75-78`, `gsl:503-518`); the "weakest exit signal" paragraph on LLM judges is opinion, not a fact on the sheet; cut it or soften to a stated tradeoff the author owns. **[cut]**

## 1. What it is (opening)

- `goalSeekLoop` is a config-driven loop that wraps a task board's drain: hand out work, drain it, ask a judge whether the goal is reached, and if not, hand out more and drain again. `gsl:2-10`. **[page]** **[checked]**
- It always ends: `maxIterations` is required, so the loop cannot run forever. `gsl:162-167`, `gsl:328-332`. **[page]**
- It returns a sequencer, so it composes into a flow like any block. `gsl:308` (return type `SequencerDefinition`), `gsl:575-581`. **[page, one clause]** **[checked]**
- Import: `import { goalSeekLoop } from "@flow-state-dev/orchestration/task-board"`. `tb:197-199`, `rm:901`. `mapToVerdict`, and the types `GoalSeekLoopConfig`, `Verdict`, `JudgeSlot`, `JudgeInput`, `VerdictMapping` come from the same path: `tb:197-206`. **[page]** **[checked]**
- A "drain" is the board's workers working through every task they can run until none is left to start (`tb:40-42` plan board "every row runs in the drain, and the drain waits on every one"). A "plan board" is `mode: "plan"`, the board's default (`tb:682`, `tbd:66`). **[page: define "drain" in the page's own words where it first appears]**

## 2. The loop (question 1: what two things can end the loop?)

The two exits the page names are the judge's `done` and the iteration budget. Waiting on someone and a judge failure are also ends of a pass; the page names them in one sentence and links to Reference.

- Order of one pass: seed (once, optional) → drain → count the drain → `afterDrain` (optional) → judge → replan (optional) → loop again while the verdict is not `done` → emit the termination item → project the board → `finalize` (optional). `gsl:12-19`, `gsl:583-648`. **[page]** **[checked]**
- Seed runs once, before the first drain, not on every pass. It is placed as a single step before the drain pass: `gsl:583`. **[checked]** (test: seed adds tasks once per run, `gt:57-68`, `gt:92-105`.)
- The loop goes back to the drain while the verdict's decision is anything other than `done`: `gsl:638-641`. **[page]**
- `maxIterations` is a finite positive integer, mandatory; it is the total number of drains: `gsl:162-167`, `gsl:328-332`; construction throws `[goalSeekLoop] "<name>" maxIterations must be a finite positive integer (got <n>)` for `0`, `-1`, `1.5`, `Infinity`, `NaN`: `gt:574-581`. **[page: the rule; the message is [ref]]** **[checked]**
- `maxIterations: 2` with a judge that always says `continue` performs exactly 2 drains and ends with reason `"max-iterations"`, `iterations: 2`: `gt:127-139`. **[page]** **[checked]**
- At the last allowed drain a non-`done` verdict is turned into `{ decision: "done", reason: "max-iterations" }`; a `done` on the last drain keeps its own reason: `gsl:499-518`, `gt:141-153`. **[page]** **[checked]**
- A `replan` on the last drain is turned into `max-iterations` before it runs, so no task is added that no drain will run: `gsl:499-502`, test `gt:185-201`. **[ref]** **[checked]**
- With the budget reached, the loop does not throw: it emits the termination item and still runs `finalize` over the settled board: `gsl:512-514`, `gsl:642-646`, `gt:127-139`. **[page]** **[checked]**
- The loop's `maxIterations` is not the board's `maxIterations`. The board's is a per-worker safety cap on one drain, default `10_000`: `tb:506-511`, `tb:692`. **[page, one sentence; or [ref]]** **[checked]**
- A judge returning `continue` forever with nothing new to do re-drains the same finished board until the cap: `gt:127-139` (judge `continue` "never" runs to `max-iterations`). **[page]**

### Other ways a pass ends (named in one sentence, detail to Reference)

- A judge that throws, returns something that is not a `Verdict`, or returns `replan` with no non-empty `tasks` and no `replanner` set, ends the loop with reason `"judge-error"`, and `finalize` still runs. `gsl:448-486`, `gsl:495-497`. Tests: throw `gt:338-352`, malformed `gt:390-403`, empty `tasks` with no replanner `gt:288-302`. **[ref]** **[checked]**
- `onError: "fail"` makes that failure propagate as a request error instead. `gsl:173-179`, `gsl:495-497`, test `gt:354-368`. A failure in `seed` or in the drain propagates either way: `gsl:176-178`, `gt:370-388`. **[ref]** **[checked]**
- A drain that leaves a task waiting on a person's answer ends the pass with reason `"waiting-on-a-user"`: no judge, no replan, no `finalize`, and no iteration spent (`iterations` reports `0` in the test). `gsl:21-31`, `gsl:386-398`, `gt:604-643`. **[ref; page: one sentence]** **[checked]**
- A drain that leaves a task waiting on an event outside the board, with none waiting on a person, ends the pass the same way with reason `"waiting-on-an-event"`: `gsl:30-31`, `gsl:255-256`, `gt:645-679`. **[ref]** **[checked]**
- A person's answer that lands just as a drain stops: the loop drains again, before judging, to take the turn the answer earned. These extra drains are not iterations and stop after `maxIterations`; a task that still owes a turn then ends the pass as a wait on a person does. `gsl:33-41`, `gsl:585-597`, `gt:700-751`, `gt:895`. **[ref]** **[checked]**
- To carry on after a person answers, run the loop again; the drain takes the task's next turn. This needs a board whose tasks outlive the request (a `defineTaskCollection` board). `gsl:27-29`, `it:1-13`; `it:16-18` reads the termination item after a later request. **[ref]** **[checked]**

## 3. Writing a judge (question 2: what does the judge see?)

- `judge` is required (`judge: JudgeSlot`, "MANDATORY"): `gsl:150-151`. **[page]** **[checked]**
- `JudgeSlot` is a block, a sub-sequencer (a sequencer definition), or an inline function `(input: JudgeInput, ctx: BlockContext) => Verdict | Promise<Verdict>`: `gsl:102-105`. **[page]** **[checked]**
- An inline function receives `{ collection, drainResult }`: `collection` is the board's live task collection, `drainResult` is the drain's raw result. `gsl:91-94`, `gsl:435-446`. **[page]** **[checked]**
- The collection's `list()` returns the tasks; a task has `id`, `goal`, `status`, `output`, optional `error`. `gsl:667-685` (the projection built from `ref.list()`); `gt:640-641` (`row.status`); `gt:747` (`collection.get("a")!.status`). **[page]** **[checked]**
- A task `status` is one of `pending`, `in_progress`, `held`, `completed`, `errored`, `cancelled`: `ts:14-21`. **[page: the ones the example uses (`errored`, `completed`); full list [ref]]** **[checked]**
- A block or sub-sequencer judge receives the raw drain result as its input and reads the board from `ctx` through the board's capability (`ctx.cap[board.capability.name].tasks()`): `gsl:84-90`, `gsl:655-664`. **[page, one sentence; [code-read] for the exact accessor, no test calls it from a block judge]** The accessor name is `ctx.cap.<board name>`; a block judge lists `uses: [board.capability]`: `gsl:440` is the wrapper's own `uses`; the test seed shows the pattern `gt:57-67`. **[checked for the seed; verify against `pe` evaluator before the page shows a block judge]**
- The judge runs after the drain and after `afterDrain`, so it sees the board as `afterDrain` left it: `gsl:144-149`, `gsl:599-607`. **[ref]**
- The judge runs only when no task waits on a person or owes a turn: `gsl:605-606`, `gt:604-643` (judge call count `0`). **[page: "the judge never rules on work a person still owes an answer"]** **[checked]**
- The verdict is one of three shapes:

  ```ts
  type Verdict =
    | { decision: "done"; reason: string }
    | { decision: "continue"; reason: string }
    | { decision: "replan"; reason: string; tasks?: TaskInit[] };
  ```

  `gsl:79-82`. **[page]** **[checked]** `reason` is required on every verdict: an inline judge must return a complete `Verdict` (`gsl:270-282`); a verdict without `reason` is malformed and ends the loop as `judge-error` (`gt:390-403`). **[page: one clause]** **[checked]**
- `done` is the only decision that ends the loop on its own. `continue` drains again with no new tasks. `replan` adds tasks, either the verdict's inline `tasks` or the `replanner` block's output when the verdict carries none. `gsl:73-78`, `gsl:520-525`, `gsl:608-634`, tests `gt:107-125`, `gt:161-183`, `gt:304-335`. **[page]** **[checked]**
- A `done` verdict that carries a stray `tasks` array ends the loop; the tasks are not added: `gsl:623-634`, `gt:203-226`. **[ref]** **[checked]**
- An empty `tasks: []` on a `replan` counts as no work: it falls through to the `replanner`, or ends as `judge-error` when there is none: `gsl:459-470`, `gsl:608-621`, tests `gt:228-257`, `gt:288-302`. **[ref]** **[checked]**
- No judge factories ship: "Bring-your-own". `gsl:96-101`, `gsl:214-218`. **[page]**
- `mapToVerdict(source, { decision, reason?, tasks? })` adapts another decision shape to a `Verdict`, filling a default reason (`"converged"` for `done`, `"continue"`, `"replan"`) when none is given: `gsl:194-232`, `gt:509-543`. **[page: one sentence and a link]** **[ref: the mapping table]** **[checked]**
- `replanner?: BlockDefinition`: runs on a `replan` verdict with no inline `tasks`; its output must be `{ tasks: [...] }` with at least one task, else the loop ends as `judge-error` (under `onError: "skip"`): `gsl:152-157`, `gsl:693-721`, test `gt:405-429`. **[ref]** **[checked]**
- `afterDrain?: BlockDefinition`: runs after each drain, before the judge. `gsl:144-149`. **[ref]**
- `finalize?: BlockDefinition | SequencerDefinition`: runs over the settled-board projection once, at the end. Omitted, the loop returns that projection. `gsl:168-172`, `gsl:564-571`, `gsl:646`, tests `gt:469-503`. **[page]** **[checked]**
- The projection is `{ tasks: [{ id, goal, status, output, error? }], results: unknown[] }`; `results` holds the `output` of every `completed` task whose output is defined. `gsl:667-685`, `gt:469-482`. **[page: shape]** **[checked]**
- `finalize` does not run when the pass ended waiting on a person or an event: `gsl:645-646`, `gt:604-643`. **[ref]** **[checked]**

## 4. Use it (the example)

- Config (all fields): `name` (required), `board` (required), `judge` (required), `maxIterations` (required), and optional `seed`, `afterDrain`, `replanner`, `finalize`, `onError` (`"skip"` default, `"fail"`), `inputSchema` (default `z.unknown()`), `activeStatusMessage`, `stateSchema`, `maxAttemptsPerTask` (default `1`), `taskContext`. `gsl:107-180`, `gsl:309-324`. **[page: the ones the example uses; the rest [ref]]** **[checked]**
- `seed` writes tasks to the board before the first drain, through the board's capability: `gsl:137-143`; example seed writes `await (ctx.cap as any)[board.capability.name].createTasks(ids.map((id) => ({ id, goal: id })))`: `gt:57-67`. A task needs a `goal`; give an `id` when the loop runs more than once (see below). **[page]** **[checked]**
- `seed` accepts a block or a sub-sequencer and is optional when the board has `initialTasks`: `gsl:137-143`. **[ref]**
- The board must be request- or resource-backed. Construction throws on a sequencer- or factory-backed board; the default backing (no `collection` set, or `{ collectionId }`) is request-backed. `gsl:333-339`, `gt:548-572`, `tb:253-267`. **[page, one sentence]** **[checked]** Construction message: `[goalSeekLoop] "<name>" requires a request- or resource-backed board; "<backing>" backing is unsupported ...`: `gsl:334-338`. **[ref]**
- The board must be a plan board; a `mode: "delegation"` board throws at construction, because its drain returns while delegated tasks still run: `gsl:340-349`, `tb:40-44`. **[page, one sentence]** **[checked]** (No test in `gt` exercises the delegation guard; **[code-read]**; a test `board-mode.test.ts` names it, not opened.)
- A board whose `initialTasks` include a task with no `id` and a loop with `maxIterations > 1` throws at construction: an id-less initial task is added again on every drain. Give each initial task an `id` or seed through `seed`. `maxIterations: 1` is allowed. `gsl:350-356`, `gt:583-597`. **[page: one sentence]** **[checked]**
- Request-backed tasks live on the request (`ctx.request`) and survive every block boundary and every drain within the request; they are gone when the request ends: `tb:253-267`, `tb:283-289` (sequencer backing "won't survive across `board.drain` calls"; use request backing or `defineTaskCollection` to re-enter). `gt:92-105` runs a request-backed board across drains. **[page: storage answers below]** **[checked]**
- Example loop, verified shape (runs in `testBlock`): `goalSeekLoop({ name, board, seed, judge: ({ collection }) => ..., maxIterations })` with an inline judge that returns `done` when `collection.list()` has no `errored` task and `continue` otherwise. `gt:92-125`, `old` example. **[page]** The example must declare its worker, board and seed block, titled by path, with `taskWorkerInputSchema` imported from `@flow-state-dev/orchestration/task-board` (`gt:20`, `gt:34-44`) and `handler` from `@flow-state-dev/core`. **[checked]**
- Worker shape the loop's board needs: a handler with `inputSchema: taskWorkerInputSchema`; it receives `input.goal`: `gt:34-44`. **[checked]**
- The board's drain used with the loop: `taskBoard({ name, collection: { collectionId }, workers, onIdle: "complete" })`: `gt:47-54`. `onIdle` defaults to `"complete-or-blocked"` (`tbd:66`); the page's example may omit it. **[checked]**
- `workers` accepts one block (test passes a single handler `gt:51`). **[checked]**

### Output and the stream item

- The loop's output is the settled-board projection when `finalize` is omitted, or `finalize`'s output when set: `gsl:564-571`, `gsl:646`, `gt:469-502`. **[page]** **[checked]**
- The loop emits one data item, `dataType` `"goal-seek-loop-termination"` (`GOAL_SEEK_LOOP_TERMINATION_DATA_TYPE`), when it exits, with `value` `{ collectionId, reason, iterations }`. `gsl:182-186`, `gsl:535-556`. **[page: one sentence; shape [ref]]** **[checked]**
- `iterations` is the number of drains the loop counted; `reason` is the stopping verdict's own `reason` string when the judge said `done`, otherwise `"max-iterations"`, `"judge-error"`, `"waiting-on-a-user"` or `"waiting-on-an-event"`. `gsl:546-547`, `gt:92-153`, `gt:638`, `gt:677`. **[ref]** **[checked]**
- The item's `itemVisibility` is `{ client: false, history: false }` and its key is `"<collectionId>:goalSeekLoop-termination"`. `gsl:550-554`. A data item takes its `itemVisibility` (`packages/contracts/src/items/resolve-visibility.ts:52`), so it reaches no client and no model; it is on the request's items for tooling (`gsl:182-185`, `gsl:546-549`). An app registry needs no entry for it; `ca` has none (`ca:43-45`). **[ref]** **[checked]**
- It is distinct from `task-board-meta`; the board's own snapshot item is untouched: `gt:431-462`. **[ref]**
- A `goalSeekLoop` is a block, so a generator can list it in `tools` and call the whole loop as one tool; only the loop's output returns to the model. Existing text: `old` ("Using a goalSeekLoop as a tool"). The tool's input is the loop's `inputSchema`, forwarded unchanged: `gsl:111-116`. No test in `gt` or the integration test exercises the loop as a generator tool. **[ref; if the page keeps it, [code-read] and a pass 5 re-check]**

## 5. How the patterns map onto it (question 3)

- `parallelTasks` is a one-pass loop: judge always returns `{ decision: "done", reason: "converged" }`, `maxIterations: 1`, a `seed` that plans then seeds the board, and a `finalize` that collects results and merges. `pt:174-200` (judge `pt:197`, `maxIterations: 1` `pt:198`). **[page]** **[checked]**
- `planAndExecute` re-plans across drains: its `seed` plans the goal and seeds the board; its `judge` runs the pattern's evaluator, runs its replanner when the evaluator says replan with no tasks, and maps the result to a `Verdict` (`complete` → `done`, `replan` → `replan` with tasks, anything else → `continue`); its `finalize` is a synthesizer; it passes `onError: "fail"` so an evaluator failure is a request error, not a `judge-error` ending; it forwards its own `maxIterations`. `pe:747-825` (judge adapter `pe:780-808`, call `pe:810-825`). **[page]** **[checked]**
- A `complete` decision reports reason `"max-iterations"` when the pattern's own iteration count reaches `maxIterations`, otherwise `"converged"`: `pe:796-801`. **[ref]** **[checked]**
- `supervisor` does not use `goalSeekLoop` (no call site in `packages/patterns/src/supervisor`). Its reviewer runs inside each task, a retry budget per task, and not across the board. `old` "How the patterns map onto it" states this; the code check is the absence of a call site. **[page: one clause and a link]** **[checked by search]**
- `routedSpecialists`, `blackboard`, `debate`: no call site. **[checked by search; page names none of them]**
- `pr:19` states: "`parallelTasks` and `planAndExecute` are expressed on the `goalSeekLoop` primitive (`parallelTasks` as a single pass, `planAndExecute` as a re-planning loop). Their public factories, config, and output shapes are unchanged." Use only the first clause. **[page]**
- `rm:898-911` carries the same two-pattern statement. **[checked]**

## 6. What it won't do (limits; Reference, or one line)

- No composable termination algebra, no cost or wall-clock budget, no built-in stall or no-progress detection, no configurable inner-drain factory. Termination is the judge plus `maxIterations`. `old` "Limits". Code check: `GoalSeekLoopConfig` has no such field, `gsl:107-180`. **[page: one sentence]** **[checked]**
- The loop does not judge work a task is still waiting on (a person or an outside event) and does not spend an iteration on it. **[page]** (see section 2).

## 7. Stored parts: the four questions

The loop stores two things of its own, and drains a third that belongs to the board. For each: who owns it, who can see it, where it is stored, how many.

| Part | Owner | Who sees it | Where stored | How many |
| --- | --- | --- | --- | --- |
| The board's tasks | The board the loop is given (`board`), through its collection spec | Any block in the request that lists the board's capability; `ctx.cap.<board name>` (`tb:253-267`, `gt:57-67`) | Request-backed (the default): on the request, gone when it ends (`tb:253-267`). A `defineTaskCollection` board: durable, at the scope the collection names (`session`, `user`, `org`) (`tbd:342`) | One row per task, one collection per board |
| The loop's bookkeeping: drain count, last verdict, last board projection, waiting flags | The loop's own sequencer state | The loop's blocks (`ctx.sequencer`); not a resource the client reads; `stateSchema` fields a caller adds are merged into the same container (`gsl:129-136`, `gsl:238-251`, `gsl:284-298`) | The loop sequencer's state, for the one run (`gsl:575-581`); field names carry a `goalSeekLoop` prefix (`gsl:238-239`) | One container per loop run |
| The termination item | The loop | Tooling that reads the request's items; `client: false`, `history: false`, so the SSE client filter drops it and it never enters model history (`gsl:550-554`; `packages/engine/src/streaming/client-filter.ts:36`; `gt:446-460`) | The request's items; not stored as state | One per run, at exit (`gsl:535-556`) |

- A caller's `stateSchema` must be a `z.object(...)`; any other schema throws at construction: `gsl:284-298`. **[ref]** **[checked by reading]**
- Who can see the board's durable rows depends on the collection's scope, which is the board page's subject (`tbd:342-362`); the page links to it and does not repeat it. **[page: link]**
- What survives a crash mid-loop is not stated: the loop's own bookkeeping is sequencer state and no test here crashes a run; do not state it. **[verify]**

## 8. Facts to keep off the page

- The loop is assembled from `drainPass`, `incrementDrainCount`, `stashDrainProjection`, `judgeStep`, `coerceAtCap` and similar internal blocks (`gsl:367-571`): **[cut]**, mechanism.
- Why a live collection ref is never put on the chain (`gsl:427-433`); structured-clone boundaries: **[cut]**.
- That the drain-pass owed-turn drain "does not seed again", and the `setNextDrainUnseeded` mark (`gsl:585-597`, `gt:682-698`): **[cut]**, mechanism.
- That a judge sub-sequencer "declares NO stateSchema" (`gsl:488-491`): **[cut]**.
- "Parity" with the earlier shape of `planAndExecute` (`pe:821-823`): **[cut]**, history.

## 9. Open items for later passes

- Pass 5 should re-read the delegation-board guard (no test in `gt`) and a block-form judge's `ctx.cap` access before the page shows either.
- If the page keeps the "loop as a generator tool" section from `old`, it needs its own check: nothing in `gt` or `it` calls a loop from a generator.
- The board page the revamp plans is `./task-board.md` under `catalog/orchestration`; the pattern pages sit beside this one (`parallel-tasks.md`, `plan-and-execute.md`, `supervisor.md`); the link targets are in the sitemap, not verified here.

## 10. Revise round 1 (what the page now states)

- The example judge replans with one follow-up task until three tasks have completed; it does not return `continue` over errored tasks. A re-drain does not re-run an `errored` task: a failing task retries only inside a drain, under `maxAttemptsPerTask` and the board's retry budget (`tbd:250`, `tbd:184-185`; `gsl:350-356` for config). `continue` with no new tasks re-drains a settled board with no progress (`gsl:503-518`). **[checked]**
- The tool example reuses the same loop, whose `inputSchema` is `{ question }`; the generator example passes the required `prompt`. All five example files type-check against the kitchen-sink tsconfig. **[checked]**
- `waiting-on-an-event` is a stop reason beside `waiting-on-a-user`; both end the pass without a judge, replan or `finalize`, and neither spends an iteration (`gsl:254-256`, `gsl:387-398`, `gt:645-679`). The page says "a person's answer, or an event outside the board"; the reason strings are in the Reference rows moved to the items and task board references. **[checked]**
- Moved to Reference, not on the page: budget semantics and `max-iterations` handling, `onError`, `mapToVerdict`, the three construction refusals, the stream item's fields and reasons, the late-answer extra drains and their cap, and the not-supported list beyond one sentence.
- Link targets: `./plan-and-execute.md`, `./parallel-tasks.md`, `./supervisor.md`, `../../concepts/tasks-and-boards.md`, `../../concepts/generators-and-tools.md`, `../../reference/{patterns,task-board,items}.md`.

## 11. Revise round 2 (what the page now states)

- A pass that ends waiting returns the board as the drain left it (`tasks`, `results`), the waiting task still `in_progress`; `finalize` does not run. `gt:604-643` (output row status `in_progress`), `gsl:646`. The termination item carries `waiting-on-a-user` or `waiting-on-an-event`. **[checked]**
- `drainResult` is the drain's raw result (`gsl:91-94`); the page calls it a summary of the drain that just ran. The `replanner` is a block whose output is `{ tasks }` (`gsl:152-157`). **[checked]**
- The page says the judge decides whether the loop stops once the goal is met; `maxIterations` alone guarantees it ends (`gsl:162-167`). **[checked]**
- The board's own `maxIterations` sentence now sits after the loop's `maxIterations` paragraph; the heading before the pattern table is "Patterns built on it".

## 12. Revise round 3 (what the page now states)

- "The settled board" is defined once, after the judge definition: the board's tasks as the last drain left them, whatever their status (the projection lists every task; `results` holds only completed outputs, `gsl:667-685`). **[checked]**
- A pass that ends waiting leaves the waiting task `in_progress` (`gt:604-643`).
- A board whose tasks outlive the request is one backed by `defineTaskCollection`, not the default request storage (`tb:253-267`, `it:1-13`).
- `goalSeekLoop` builds a sequencer (`gsl:308`, `gsl:575-581`).

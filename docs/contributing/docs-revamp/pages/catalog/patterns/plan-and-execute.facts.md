# Facts for Plan and Execute (K-22, catalog)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: the existing page, the exported surface and its doc comments, tests, one example. No spec is cited. Paths are from the repo root.

Legend: **[page]** the page states it. **[ref]** belongs on a Reference row; the page links, does not state it. **[gap]** nothing citable exists; the page must not assert it. **[drift]** the existing page or a doc comment disagrees with what the code does; the code wins.

Abbreviations:
- `ix` = `packages/patterns/src/plan-and-execute/index.ts`
- `sc` = `packages/patterns/src/plan-and-execute/schemas.ts`
- `ev` = `packages/patterns/src/plan-and-execute/blocks/evaluate-progress.ts`
- `sy` = `packages/patterns/src/plan-and-execute/blocks/synthesize.ts`
- `cp` = `packages/patterns/src/plan-and-execute/blocks/capture-and-plan.ts`
- `pe` = `packages/patterns/src/shared/planning-entry.ts`
- `tc` = `packages/patterns/src/shared/task-caps.ts`
- `t` = `packages/patterns/test/plan-and-execute.test.ts`
- `op` = `apps/docs/docs/patterns/plan-and-execute.md` (the page this one replaces)
- `rd` = `packages/patterns/README.md`
- `ar` = `packages/orchestration/src/task-board/apply-replan.ts`
- `gl` = `packages/orchestration/src/task-board/goal-seek-loop.ts`
- `dc` = `packages/core/src/utility/decomposer.ts`
- `fx` = `packages/integration-tests/src/scenarios/fixtures/plan-and-execute-flow.ts`
- `ex` = `examples/guides/custom-pattern/src/plan-map-reduce.ts`

## Flags against the page plan (read first)

1. **Three config options are declared and documented but do nothing, or do not do what the old page says.** **[drift]**
   - `outputSchema`: typed at `ix:144`, listed in the config block at `op:219` ("Output schema for the synthesized result"), and described at `ix:143` as applying to the default synthesizer. Nothing reads `config.outputSchema` (grep of `ix` finds it only at `ix:144`). The default synthesizer's output schema is fixed `z.string()` (`ix:591`). The fixture passes `outputSchema: z.string()` (`fx:19`) and so does not exercise it. **The page must not offer `outputSchema` as a way to shape the final answer.** To get a structured final answer, pass a `synthesizer` block with its own `outputSchema` (shown in `op:362-388`, a `generator` with `outputSchema`).
   - `plannerVisibility`: typed at `ix:240`, documented as the default planner's visibility. The default planner is built at `ix:647-652` with no `itemVisibility`, and `config.plannerVisibility` is read nowhere. The old page already says the default planner "does not currently accept itemVisibility". **[ref]**, or omit.
   - Default executor model: the old page says every default block uses `"openai/gpt-6-luna"` (`op:223`). The default **executor** is `config.model ?? "intent/synthesize"` (`ix:346`). Planner, replanner, synthesizer and LLM evaluator default to `"openai/gpt-6-luna"` (`dc` decomposer default model; `ix:275`, `ix:571`, `ev:156`). The page should not say all defaults share one model.
2. **No stored part of its own.** Plan and Execute declares no resource and no session or user state. Its tasks live on the request: the board is built with `collection: { collectionId: name }` (`ix:716`), which is the request-backed default (`packages/orchestration/src/task-board/index.ts:253-262`). See "Stored data" below; the four questions get one short answer, and the page should not imply tasks survive the action run.
3. **Names of the sibling pages.** The old page links `./parallelTasks` (`op:14`), `./supervisor`, `../orchestration/task-board`, `../orchestration/goal-seek-loop`, `../orchestration/flow-policy`. The page plan's neighbours are catalog pages; link by their K-ids' slugs when settled. **[reconcile at cutover]**
4. **Everything in the sitemap's "Keep; trim" instruction is a trim of `op`.** Mechanism that `op` carries and this page leaves to Reference: the block-composition ASCII (`op:25-36`), exported internal block factories (`op:`op:281-301), stream item shapes, the full config block, the `createApplyReplan` capability warning, the status-translation table. See section 9 for what moves.

## 1. What it is, and when you reach for it

- `planAndExecute(config)` returns a sequencer (`SequencerDefinition`) you mount as an action's block. `ix:607-609`. **[page]** Required config: `name`. `ix:111`.
- Two phases. A planner model breaks the goal into a list of tasks, each with an id, a goal and optional `deps` (the ids of tasks that must finish first). The tasks then run through a task board, one at a time by default, each after the tasks it depends on. `ix:3-8`, `ix:714-733`, `dc:7-17`, `t:181-215` (a chain `s1 -> s2 -> s3` runs in that order). **[page]**
- The default planner is `utility.decomposer`; its tasks carry `id`, `title`, `goal`, `context`, optional `deps` and optional `priority` (`"high" | "medium" | "low"`). `ix:647-652`, `dc:7-17`. **[page]** (one clause: what a task looks like) / **[ref]** (the field table)
- Use it when tasks depend on each other's results, you want per-task progress, and you want the plan to change as results arrive. `op:9-12`. For independent tasks with no dependencies the old page points at Parallel Tasks and Supervisor. `op:14`. **[page]**
- Input is `{ goal: string }`, exported as `planAndExecuteInputSchema`. `sc:81-83`, `ix:69-76`. **[page]**
- Output is a string by default: the default synthesizer returns `z.string()`. `ix:591`. With `synthesizer: false` the output is `{ goal, status, tasks, completedSteps, totalSteps }`. `sy:46-118`, `ix:674-677`. **[page]**
- It emits `task-change` (one per task transition) and `task-board-meta` (board-level status) items, so a `TaskPlan` view can show progress live. Phase statuses the pattern adds: `planning`, `replanning`, and the board's own `active` and `completed`. `t:1353-1404`, `cp`/`pe:368-378` (`planning`), `ev:271-283` (`replanning`), `op:417-420`. `rd:312` installs the renderer with `fsdev ui add task-plan`. **[page]** (a sentence) / **[ref]** (item shapes)

## 2. Basic use (the page's first example)

- Minimal form: `planAndExecute({ name: "research" })`. `op:31-60`; defaults at `ix:610-616`. **[page]**
- Mounted on a flow action whose input schema is `z.object({ goal: z.string() })`, with `userMessage: (input) => input.goal`. The fixture flow is the shape: a sequencer `.step(paeBlock)` inside an action with `userMessage: (input) => input.goal`. `fx:14-35`. **[page]** `defineFlow({ kind, requireUser: true, actions })` as in `fx:25-35`.
- The old page's example action omits the sequencer and passes the block straight as `block: research`. The fixture wraps it in a `sequencer`. Both are valid blocks; use the plain form for the short example. `op:31-60`, `fx:22-23`. **[page]**
- Import path: `import { planAndExecute } from "@flow-state-dev/patterns"` (root, `op`) or `.../patterns/plan-and-execute` (`fx:11`). **[page]** use the root. Install: `pnpm add @flow-state-dev/patterns` (`rd:10`). **[page]**
- The pattern's tests use `testBlock` with a deterministic planner (`createDeterministicPlanner`, `t:48-63`) and mock generators named `<name>-planner`, `<name>-executor`, `<name>-synthesizer`, `<name>-evaluate-llm`, `<name>-replanner`. `fx:5-8`, `ix:345`, `ix:569`, `ix:273`, `ev:154`. **[ref]** (naming for tests)

## 3. When does it replan? (sitemap question 1)

- **By default it never replans.** `enableReplanning` defaults to `false` (`ix:613`). The default evaluator is a plain function with no model call: after each drain it adds 1 to a counter, completes when the counter reaches `maxIterations`, completes when no task is left that could run, otherwise says `continue`. `ev:107-139`. **[page]**
- So with the defaults the run is single pass: plan, work every task, then synthesize. `ev:10-14`, `t:102-134`. **[page]**
- **`enableReplanning: true`** swaps in a model evaluator that looks at the goal, the iteration count and each task's `id`, `goal`, `status`, `output`, `error` and `feedback`, and answers `continue`, `replan` or `complete` with a reason. `ev:146-192` (prompt `ev:159-166`, snapshot `ev:178-185`), `ev:227-308`, `ix:613`. **[page]**
- The evaluator runs **after each pass through the board**, not after each task. The board works through everything that can run, then the evaluator judges. `ix:714-733` (board), `ix:810-826` (loop), `ev:2-8`. **[page]** Source for "pass, not per task": `ix:13-15` (judge sits after the drain) and `t:562-641` (one evaluator call per drain; three drains, three evaluator calls, three tasks run). Derived from those tests; the old page's "after each step" (`op:7`) and the config comment at `op:170` are loose. **[drift]**
- On `replan`, the replanner runs and its new tasks are added to the same board, then the board is drained again. `ix:782-787`, `ix:788-808`, `t:562-641` (extra-1, extra-2 added; planner called once; worker ran for all three). **[page]**
- The default replanner reads the goal and the plan state and returns only the **new** tasks to add, each with `id`, `goal`, `deps`; it is told not to repeat completed work. `ix:253-262`, `ix:283-299`. **[page]** (one clause)
- An evaluator can skip the replanner by returning `tasks` with its `replan` decision; those tasks are added directly. `ix:782-787` (replanner only runs when `decision === "replan"` and no `tasks` array), `ix:802-806`, `t:677-736`. **[ref]**
- **How many times:** `maxIterations` (default `3`) is a hard cap on passes through the board. `ix:612`, `gl:160-167`. At the cap a non-`done` verdict is turned into done with reason `max-iterations` and a final-pass replan adds no work. `gl:500-514`, `ix:796-801`. In the replanning evaluator, a counter that reaches `maxIterations` returns `complete` ("max iterations reached") **without calling the model**, so the model is consulted at most `maxIterations - 1` times. `ev:240-258`. Derived: with the default `3`, two model judgements. `t:534-554` checks `maxIterations: 1` completes. **[page]** the cap and what it means; the off-by-one is **[ref]**.
- Replanned tasks get the same `context` treatment as planned ones: the goal is copied in unless `taskContext` is `false`. `ar:188-204`, `t:1112-1160`. **[page]** (one clause) / **[ref]**
- A replanned task whose id already exists is renamed `<id>-replan-1` (then `-2`...) and the batch's own `deps` are rewritten to match. `ar:20-25`, `ar:160-186`, `t:796-877`. **[ref]**
- A custom `evaluator` replaces the default; it must return `{ decision: "continue" | "replan" | "complete", ... }`; `reasoning`, `score`, `feedback` and `tasks` are optional extras. `sc:101-114`, `ix:124`, `t:910-943`. **[page]** (a sentence on `evaluator`/`replanner` as the two slots) / **[ref]** (shape)
- With `enableReplanning: false` and a custom `evaluator`, the custom one still runs and can return `replan`; `enableReplanning` only picks the default evaluator. `ix:654-661`, `t:677-736`. **[ref]**

## 4. A step fails: what happens to steps that depend on it? (sitemap question 2)

- A step fails when its executor **throws**, or **returns `success: false`**. `ix:458-478` (the wrapper throws `new Error(reason)` when `success === false`; the reason defaults to `"Task did not produce a result"`), `t:392-435`. **[page]**
- Every pending task that depends on the failed one, directly or through a chain, is cancelled and reported as `skipped`. They never run. `t:259-296` (`s2`, `s3` depend on failed `s1`, both `skipped`), `ix:706-713`, `ix:714-733` (`onError: "skip"`), `sy:39-44` (`cancelled` becomes `skipped`). **[page]**
- Tasks that do not depend on the failed one carry on. `t:219-257` (`s2` fails, `s1` and `s3` still complete; `totalSteps` is 3). **[page]**
- The run itself does not error. It finishes, and the output says which tasks failed (`status: "failed"`, `error` set to the thrown message or the `reason`) and which were skipped. `t:219-257`, `t:392-435` (`error` is `"Information not available"`). **[page]**
- A skipped task's `error` says why: `"dep s1 failed"` for the direct dependent, `"dep after was cancelled"` for the next link. `t:298-359` (assertions on `error`), `ar:230-239`. **[ref]**
- **Overall status** (only visible with `synthesizer: false`): `completed` when at least one non-skipped task completed, or the plan was empty; `failed` when every non-skipped task failed. `sy:96-107`, `t:159-179` (empty plan completes). **[page]** (one sentence) / **[ref]**
- **The default synthesizer still runs when everything failed.** If no step completed, the synthesizer is told the steps did not finish, given the first error, and asked to answer the goal directly from its own knowledge, not to mention the failed plan. `ix:502-512`, `ix:565`. **[page]** One sentence; this is a surprise a reader would want.
- **Replanning after a failure.** A replan that names a failed (or cancelled) task in `deps`: that new task is skipped, and so is any new task depending on it; the rest of the replan runs and the evaluator judges again. `ar:230-255`, `t:298-359`. **[page]**
- A plan or replan whose `deps` name a task that is not on the board, or that loop back on themselves, is refused when added, and the **run fails** (error mentions `dependency_not_on_board`). `t:361-390`, `ar:253-254`, `rd:166`, `op:87`. **[page]** (one sentence) / **[ref]** (the error name)
- **Retries.** `maxAttemptsPerTask` (default `1`: one attempt, no retries) is stamped on every task. `ix:614`, `ix:153-157`, `pe:152-156`. Raising it retries a failing task before it counts as failed. `maxTotalRetries` (default `50`, `null` unbounded, `0` never retry) bounds retries across the whole board and only matters once `maxAttemptsPerTask` is above 1. At the bound the failing task ends `errored` and the board reports `terminationReason: "retry-budget-exhausted"`. `ix:176-189`, `rd:33-46`, `tc:11-21`. **[page]** one clause naming `maxAttemptsPerTask` / **[ref]** the budget.
- Board bounds on how much a plan may hold: `maxEnqueuedTasks` (default 100) and `maxTotalTasks` (default 500); a planner producing more fails the seed unless raised. `ix:165-173`, `rd:36-44`. **[ref]**

## 5. Where does the goal come from in a conversation? (sitemap question 3)

- The pattern's input is the action's `{ goal: string }`. The caller decides what that string is; the pattern does not read the chat message by itself. `sc:81-83`, `fx:14-35` (the action's `userMessage` is `input.goal`; the goal is also the input). **[page]**
- By default the goal is used word for word. A follow-up such as "now do that for all of them" is planned as that literal text. `ix:209-216`, `t:1301-1318`. **[page]**
- `synthesizeGoal: true` first runs a model call that rewrites the request into a self-contained goal, using the conversation history (the last 8 history items) to resolve "that", "those", "all of them" and keeping every concrete value. If the request is already self-contained it comes back unchanged. `pe:267-287` (`history: { limit: 8 }` at `pe:277`, prompt `pe:279-285`), `t:1232-1255` (`"now do that for all of them"` becomes `"Research asset info for a.com, b.com, c.com"`). **[page]**
- The rewritten goal is what the planner, the replanner, the evaluator and the default synthesizer all use. `ix:697-704`, `ix:749-771`, `t:1257-1299`. **[page]**
- If that model call fails, planning goes ahead with the original goal. `pe:289-306`, `t:1320-1350`. **[page]**
- Pass a block instead of `true` for your own rewrite; it must return `{ ...input, goal }`. `pe:55-61`, `pe:317-326`, `ix:216`. **[page]** / **[ref]**
- The synthesized goal is also copied into each task's `context` (default `taskContext: "goal"`), so each executor sees the request. `ix:207`, `pe:204-226`, `t:1007-1034` (a task's `context` equals the goal `"Build the MVP"`). **[page]**
- `history` (config) gives the default planner and synthesizer conversation history; `instructions` (config) is a brief the pattern folds into the planner's context and the synthesizer's prompt. `ix:222-227`, `ix:625-643`, `ix:685`, `ix:359`. **[ref]**

## 6. The step executor (custom executor example)

- Default executor: a generator named `<name>-executor` that returns `{ summary, success, reason?, sources? }`. `ix:309-321`, `ix:344-380`. **[page]** (the shape the custom example matches)
- `summary` is the step's full result, not a description; `sources` lists only web pages it actually used and stays empty for steps answered from the model's own knowledge. `ix:332-341`. **[page]**
- A custom `stepExecutor` is any block. It receives `{ stepId, goal, context?, dependencyResults? }`: `stepId` is the task id, `goal` the task's goal, `context` the per-task support text, `dependencyResults` an object keyed by the ids of the tasks it depends on, each the output of that task. Present only when the task has dependencies. `ix:439-456`, `ix:347-352`, `t:1007-1034`. **[page]**
- If the custom block returns an object with `success: false`, that fails the task, with `reason` as the error. `ix:458-478`, `t:392-435`. **[page]**
- Any block works: a handler (`t:30-39`, `echoExecutor`), a generator, a sequencer, or another pattern. `op:344-360` passes `supervisor({...})` as the `stepExecutor`. `op:344-360`. **[page]** one sentence; confirm `supervisor` import and `worker`/`reviewCriteria` config against the Supervisor page before printing it. **[reconcile]**
- `maxConcurrency` (default `1`) runs several independent steps at once within a pass. `ix:615`, `ix:723`. **[page]**
- Each step's executor can see the last 8 tool observations from the run, from any task, so a later step can skip a search an earlier one ran. `ix:726-732`, `op:411`. **[page]** one sentence / **[ref]** (policy options live on the Flow policy page).
- The task's `context` field: set by the planner when it knows what the step needs; otherwise the goal is copied in (`taskContext: "goal"`, default), `false` leaves it empty, or a block fills every task's context in one pass (receives `{ goal, tasks }`, returns `{ tasks }`). `ix:207`, `pe:228-238`, `t:1007-1112` (default; `false` leaves empty; custom block). **[page]** the default and `false`; **[ref]** the block form and its replan limit (a custom block applies to the first plan only; replanned tasks get the goal copy). `ar:50-60`, `ar:70-76`.

## 7. The synthesizer and what comes back

- The default synthesizer is a generator that integrates the step results into one answer the goal asks for, in full, citing sources only when the steps used them, never saying the work could not be done. `ix:559-566`. **[page]**
- Its output is text (`z.string()`). `ix:591`. **[page]**
- Its input is the plan so far: `{ goal, status?, tasks, completedSteps, totalSteps }`. `ix:576-590`, `sy:52-118`. **[page]** (what a custom synthesizer receives) / **[ref]**
- Task entries in that input: `{ id, goal, status, result?, error? }`; statuses are `pending`, `in-progress`, `completed`, `failed`, `skipped`. `sy:62-70`, `sy:39-44`, `sc:27`. **[page]** the five names / **[ref]** how they map from the board's own statuses.
- `synthesizer: false` skips the model call and returns the plan object. Use it when you want the task results themselves, or are chaining. `ix:674-677`, `sy:143`, `t:102-134`. **[page]**
- A custom `synthesizer` is a block that takes the plan object; it may return any shape (its own `outputSchema`). `op`'s custom synthesizer example uses a `generator` with `outputSchema` and `user: (plan) => JSON.stringify(plan)`. `op:362-388`. **[page]** (this is the real way to get a structured answer; see Flag 1)
- `synthesizeInstructions` and `executionInstructions` append to the default synthesizer's and executor's prompts. `ix:233-235`, `ix:359`, `ix:592`. **[ref]**
- Visibility defaults: executor output is on the stream but kept out of the conversation history (`{ client: true, history: false }`); the synthesizer's answer is on the stream and in history (`{ client: true, history: true }`). `ix:241-243`, `ix:379`, `ix:594`. **[page]** one sentence: the final answer is the one that joins the conversation.

## 8. Stored data (the four questions)

Plan and Execute stores no data of its own beyond the plan. The only stored parts are the tasks and its tiny run state.

| Stored part | Who owns it | Who can see it | Where it is stored | How many exist |
| --- | --- | --- | --- | --- |
| The tasks (the plan and each step's result) | The pattern's own board, named after `name` (`collectionId: name`). `ix:716` | The stream: every task change goes out as a `task-change` item, so a client view such as `TaskPlan` sees each task live. Each task's executor sees its own task and its dependencies' outputs. `t:1353-1374`, `ix:439-456` | On the request, for the length of the one action run. `ix:716`; `packages/orchestration/src/task-board/index.ts:253-262` (request-backed is the default), `gl:49-52` (loop requires a re-enterable board) | One set per run. Default ceilings: 100 tasks waiting at once, 500 in all. `ix:165-173`, `rd:36-44` |
| Run state `{ goal, status, iteration }` | The pattern's sequencer | Not exposed to the client except through `task-board-meta` status items. `sc:60-73`, `ev:271-283` | Sequencer state for the run | One per run |

- Nothing here outlives the action run on its own. A caller who wants the plan or the answer afterwards keeps it: the final output is the action's result and, for the default synthesizer, the answer joins conversation history (`synthesizerVisibility` default). `ix:243`. **[page]** one sentence.
- **[gap]** No source says whether `task-change` items for a finished run are kept in the session's item history or what a reloaded client sees. Do not state it. (The test `t:1376-1403` shows keyed items collapse to the latest snapshot per key within a run.)

## 9. What the old page carries that this page does not state

Send to Reference (the pattern's Reference page or the config table), do not state on the K-22 page:

- Full config block and every option's default (`op:152-250`); the page names about five options: `enableReplanning`, `maxIterations`, `stepExecutor`, `synthesizer`, `synthesizeGoal`, `taskContext`.
- `Task lifecycle` status table with substrate equivalents (`op:78-85`, `sy:25-44`). The page names the five output statuses only if it needs them.
- Exported schemas/types and "internal block factories" (`evaluatePlanProgress`, `createTaskEvaluator`, `createLLMEvaluator`, `createCaptureAndPlan`, `createApplyReplan`, `createSynthesize`, `createBuildPlanOutput`, `normalizeOutputStatus`) with the `createApplyReplan` capability warning. `ix:69-101`, `op:281-301`. Note the old page also lists `evaluatorVerdictSchema`, `replannerOutputSchema`, `executorOutputSchema`, `buildSynthesizerUserPrompt`, `SynthesizerPromptInput` as exports of `ix` (`ix:75`, `ix:254`, `ix:309`, `ix:502`); the old page omits these. Whether they are on the package root is a Reference question. **[ref]**
- Composability recipes (sequential chain, `.forEach` over goals, nesting Supervisor): `op:300-360`. The sitemap's example list is "basic use; a custom step executor", so these are cut or linked.
- Stream-item details (`task-change` keyed `${collectionId}/${taskId}`, `task-board-meta` statuses). `op:417-420`.
- Flow policy / `recentTrajectory` (`ix:726-732`).
- Bounds: `maxTotalTasks`, `maxEnqueuedTasks`, `maxTotalRetries`. `ix:165-189`, `tc:11-21`.
- Visibility knobs, `uses`, `tools`, `search`, `resources`, `context`. `ix:222-246`.

## 10. Example facts (for the two planned examples)

Every identifier in an example must be imported or declared there (`docs/contributing/user-docs.md` "Code examples"). Checks against the surface:

- **Basic use.** Imports: `planAndExecute` from `@flow-state-dev/patterns`; `defineFlow` from `@flow-state-dev/core`; `z` from `zod`. Shape per `fx:10-37`. `defineFlow({...})` returns a definition that the fixture calls once more (`export default planAndExecuteFlow()`, `fx:37`); the old page's example does not. **[reconcile]** how a registered flow is exported in the app layout before printing. Block file per the layout: `src/flows/research/blocks/...` or inline in `flow.ts`.
- **A custom step executor.** A `handler` with `inputSchema` and `outputSchema` returning `{ summary, success, reason? }`, receiving `{ stepId, goal, context?, dependencyResults? }`, as `echoExecutor` (`t:30-39`) and `signalingExecutor` (`t:392-435`) do. `handler` from `@flow-state-dev/core`. A custom executor that returns `{ success: false, reason }` fails the step (`t:392-435`). Typing note: `inputSchema` can be `z.any()` in the tests; a real example should declare the four fields (`ix:347-352` is the default's input schema, usable as a model). **[page]**
- A custom executor still gets the pattern's wrapper: the pattern adapts the board's task input into `{ stepId, goal, context, dependencyResults }`, so the block never sees the board's own shape. `ix:420-456`. **[ref]**
- A custom planner is any block returning `{ tasks: [{ id, goal, deps? }] }` (`t:48-63`); ids default to `step-1`, `step-2`... when absent (`ix:681`/`pe:142`, `idPrefix: "step"` at `cp:51`). **[ref]**
- Custom-pattern example outside this package (a different, hand-built `planMapReduce`) is at `ex:1-50`; it is not Plan and Execute and the page does not cite it as one. **[page]** do not use.

## 11. Neighbours this page may link

- Task board (the board the pattern drains) `apps/docs/docs/orchestration/task-board.md` (bounds at `:398`, retries at `:411`). **[page]** link
- Goal-seek loop (the judge-gated loop the pattern is written on) `apps/docs/docs/orchestration/goal-seek-loop.md`; `ix:10-20`. **[ref]** link only; the page does not explain the loop.
- Flow policy `apps/docs/docs/orchestration/flow-policy.md`. **[ref]**
- Parallel Tasks and Supervisor (`apps/docs/docs/patterns/parallel-tasks.md`, `supervisor.md`): the other board-backed patterns; "If tasks are independent, use Parallel Tasks". `op:14`, `rd:19`, `rd:36`. **[page]** one link each.
- Decomposer, the default planner `apps/docs/docs/patterns/utility-blocks/core.md`. `op:420-428`. **[ref]**

## Open items for the caller

- Flag 1: `outputSchema` and `plannerVisibility` are inert on the code path read. The old page and the doc comments still promise them. The page must not. Whether to fix the code or remove the options is the caller's call, not the page's.
- The old page says the evaluator decides "after each step" (`op:7`). The code decides after each pass through the board. The page says "pass".
- Whether `task-change` history survives a reloaded client is **[gap]**.
- Nothing in `examples/` or `labs/` uses `planAndExecute` itself (grep of `examples labs goals apps/kitchen-sink` finds only `examples/guides/custom-pattern/src/plan-map-reduce.ts`, which names it in a comment). The only runnable use is the fixture at `fx` and the tests. The page's example is therefore built from the fixture shape and the tests, and should be type-checked at pass 4.

## Revise round 1 (facts the page now states or leaves out)

- The page's example is two competitors (`acme`, `globex`) and a comparison task that depends on both; the first-pass flow, block and executor examples type-check against the package source. Task ids in the sample plan output are illustrative.
- The custom executor receives `{ stepId, goal, context?, dependencyResults? }`: `ix:439-456` adapts `taskId`, `goal`, `context`, `deps` to that shape. The old config comment (`op:165`) omitting `context` is the stale one.
- `outputSchema` is stated as having no effect on the answer's shape (Flag 1); `plannerVisibility` and every other config row are left to Reference.
- Composability recipes, internal block factories, exported schema lists, status mapping, stream-item shapes and `flowPolicy` are not on the page; they are Reference rows (R-41, R-23, R-24, R-06).
- Example model is `openai/gpt-6-luna`. Sibling links are `./parallel-tasks.md` and `./supervisor.md`.
- The page links `../../reference/items.md` for the `TaskPlan` item shapes and `<TaskPlan collectionId="research" />` (`rd:312-319`).

## Revise round 2

- Opening promise now matches the cascade: the run finishes and reports failed and skipped tasks (in the plan, with `synthesizer: false`). The default synthesizer is not asked to report failures: its prompt (`ix:559-566`) says never to say the work could not be completed, and it writes from completed tasks (`ix:511-`). Nothing in the default path reports the failure in prose.
- "Keep the answer" replaced by what the sources support (`ix:243`, section 8): the final output is the action's result and the default synthesizer's answer joins history. No session-state recipe is stated; none is citable.

## Revise round 3

- The default answer "may not mention the failures": the synthesizer's prompt (`ix:559-566`) forbids saying the work could not be done; the page states only the observable result.
- `synthesizeGoal` keeps every concrete value only as an instruction in the rewrite prompt (`pe:279-285`); no code checks it. The page says it is not guaranteed. The example is "now add Initech" to "Compare Acme, Globex and Initech for a procurement review." (illustrative; the test at `t:1232-1255` uses other values).
- `maxAttemptsPerTask` is the total attempts per task (`ix:153-157`: 1 is a single attempt, no retries).
- `collectionId` on `TaskPlan` is the pattern's `name` (`ix:716`, `collectionId: name`).

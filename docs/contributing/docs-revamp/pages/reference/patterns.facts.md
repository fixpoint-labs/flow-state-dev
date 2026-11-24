# Facts for Patterns (R-41, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests and `goals/`. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. Where a fact comes from reading the implementation rather than a test or an exported doc comment, it is marked **[source]**; where a test pins it, **[test]**; where the field's own doc comment says it, **[doc]**. Where the doc comment and the code disagree, the code wins and the row says so. Nothing here was run against a model: every default model string is the string in the code, not an observed behaviour.

Abbreviations (all paths from the repo root; `P` = `packages/patterns/src/`, `O` = `packages/orchestration/src/`):

- `rs` = `P`routedSpecialists/index.ts; `rss` = `P`routedSpecialists/schemas.ts; `rsd` = `P`routedSpecialists/blocks/dispatch-specialist.ts
- `ea` = `P`eventActors/index.ts; `eas` = `P`eventActors/schemas.ts; `eam` = `P`eventActors/match-topic.ts; `eaa` = `P`eventActors/blocks/append-entry.ts
- `pt` = `P`parallelTasks/index.ts; `pts` = `P`parallelTasks/schemas.ts; `pe` = `P`shared/planning-entry.ts; `tcap` = `P`shared/task-caps.ts; `coerce` = `P`shared/coerce.ts
- `sv` = `P`supervisor/index.ts; `svs` = `P`supervisor/schemas.ts; `svr` = `P`supervisor/blocks/reviewer-check.ts; `svl` = `P`supervisor/blocks/label-failed-reviews.ts; `svy` = `P`supervisor/blocks/synthesize.ts
- `pae` = `P`plan-and-execute/index.ts; `paes` = `P`plan-and-execute/schemas.ts; `paev` = `P`plan-and-execute/blocks/evaluate-progress.ts; `paey` = `P`plan-and-execute/blocks/synthesize.ts
- `rr` = `P`round-robin/index.ts; `rrs` = `P`round-robin/schemas.ts; blocks under `P`round-robin/blocks/ (`rra` default-roster-agent, `rrf` default-referee, `rry` default-synthesizer, `rri` init-contributions, `rrc` record-contribution)
- `db` = `P`debate/index.ts; `dbs` = `P`debate/schemas.ts; blocks under `P`debate/blocks/ (`dbd` default-debater, `dbj` default-judge, `dbm` default-moderator, `dby` default-synthesizer, `dbr` record-argument, `dbi` init-transcript)
- `ra` = `P`response-auditor/index.ts; `ras` = `P`response-auditor/schemas.ts
- `gsl` = `O`task-board/goal-seek-loop.ts; `tb` = `O`task-board/index.ts; `twi` = `O`tasks/workers/types.ts; `wst` = `O`task-board/blocks/worker-step.ts; `tc` = `O`tasks/collection/task-caps.ts
- `cfg` = `apps/docs/docs/orchestration/configuration.md`; `gsld` = `apps/docs/docs/orchestration/goal-seek-loop.md`
- `bias` = `packages/thought-fabric-core/src/metacognition/` (`bias/blocks` = bias-detection-blocks.ts, `bias/schema` = bias-detection.ts, `bias/help` = bias-detection-helpers.ts)
- Tests, all under `packages/patterns/test/`: `rst` routedSpecialists.test.ts, `eat` eventActors.test.ts, `ptt` parallelTasks.test.ts, `svt` supervisor.test.ts, `rrt` round-robin.test.ts, `dbt` debate.test.ts, `rat` response-auditor.test.ts, `tct` task-caps-writers.test.ts

## 0. Findings the writer must act on before drafting

| # | Finding | Source |
| --- | --- | --- |
| 0.1 | **The page is for nine things, not eight patterns.** Eight patterns plus `goalSeekLoop`. The eight patterns are exported from `@flow-state-dev/patterns` and its subpaths; `goalSeekLoop`, `taskBoard` and `mapToVerdict` come from `@flow-state-dev/orchestration/task-board`. `biasAnalyzer` (rows moved here from the response auditor page) is in a third package, `@thought-fabric/core/metacognition`. See 1.1. | `P`index.ts; `packages/patterns/package.json` exports; `O`task-board/goal-seek-loop.ts:79-217 |
| 0.2 | **`routedSpecialists` `maxIterations` caps loop-backs, not iterations.** With `maxIterations: 3` and a controller that never says done, 4 iterations run and the output has 4 history entries. The doc comment and the current page both say "hard cap on iterations"; both are one short. The two other loop patterns do not behave this way: `roundRobin` and `debate` run exactly `maxRounds` rounds at most. | `rst:245-274` (comment at 266 states the 1 + 3 count); `rs:626-629` |
| 0.3 | **`eventActors` `concurrency` doc comment says "Default: 16"; the code default is 4.** Code wins. | `ea:179` (stale comment), `ea:230` (code) |
| 0.4 | **`planAndExecute` `model` is not one default.** The page and the doc comment say all default blocks use `openai/gpt-6-luna`. Code: the default planner, replanner, LLM evaluator and synthesizer use `openai/gpt-6-luna`; the default step executor uses `intent/synthesize`. | `pae:275` (replanner), `pae:346` (executor), `pae:571` (synthesizer), `paev` createLLMEvaluator (`model ?? 'openai/gpt-6-luna'`), `O`utility decomposer default via `packages/core/src/utility/decomposer.ts` |
| 0.5 | **Config fields that exist in the type and do nothing.** `planAndExecute.plannerVisibility` (declared at `pae:240`, never read; the default planner is `utility.decomposer` and receives no visibility). `responseAuditor.displayMode` and `responseAuditor.alwaysRun` (declared at `ras:65,67`, read nowhere in `ra`). List them as having no effect, or leave them off the table. | `pae:240`; `ras:65-67`; grep of `P`response-auditor shows no read |
| 0.6 | **`debate` `moderator` has no default.** `debate()` never builds a moderator for you. Without one, every debater speaks every round. To get an LLM moderator you call `createModerator({ name, rosterNames, transcript })` yourself and pass the result as `moderator`, sharing one `createDebateTranscript()` with `debate({ transcript })`. The pattern-level `model`, `tools`, `uses`, `context` and `instructions` do not reach a moderator you pass in. | `db:154,206-` (moderator only read as `config.moderator`); `dbm:42-59` options; `dbt:653-700` |
| 0.7 | **Supervisor verdict `feedback` is optional in the schema.** The existing prose and a carried row say feedback is required on `reject` and `needs-revision`. The schema marks it optional; the built-in reviewer's prompt tells the model to always include it. With none, the retry's feedback is the string `Reviewer <decision> the task output` (for example `Reviewer reject the task output`). | `svs:58`; `svr:167-170`; `sv:` default reviewer prompt ("ALWAYS include feedback") |
| 0.8 | **The response-auditor threshold test is `>=`.** The `ras`/`ra` prose says "exceeds"; code surfaces a result when `score >= threshold` or `shouldSurface` is true. | `ra:110-112` |
| 0.9 | **Pattern default models are intent aliases, not model ids.** `intent/chat` and `intent/synthesize` appear as defaults for roster agents, debaters, referees, judges, moderators, synthesizers, the supervisor's reviewer and synthesizer and the default plan executor. The page states them as defaults without explaining the alias; whether to link to wherever aliases are defined is a pass-3 call. | `rra:95`, `dbd:67`, `rrf:43`, `dbj:101`, `dbm:62`, `rry:41`, `dby:74`, `sv:159,228`, `pae:346` |

## 1. What the page is

A Reference page: config tables, input and output shapes, defaults, construction errors, items emitted, and where each pattern keeps its data. Tables and signatures only. The page's own lookup: "What is the default round limit for a debate?" Answer: `maxRounds` defaults to 2 (`db:212`; warns above 4, `db:250`).

### 1.1 Imports the page's rows name

- Root, `@flow-state-dev/patterns` (`P`index.ts:1-113): `parallelTasks` (+ `parallelTasksInputSchema`, types `ParallelTasksConfig`, `SubTaskErrorStrategy`); `planAndExecute` and its schemas and helpers; `supervisor` and its schemas and helpers; `routedSpecialists`, `createWorkspace`, `controllerOutputSchema`; `eventActors`, `actor`, `createEventActorsWorkspace`, `matchTopic`, `compilePattern`, `createAppendEntry`, `normalizeToEntries`; `roundRobin` with its schemas, `createRoundRobinContributions`, `createRosterAgent`, and the helpers under renamed exports (`createRoundRobinReferee`, `createRoundRobinSynthesize`, `createRoundRobinInitContributions`, `createRoundRobinRecordContribution`); `debate` with its schemas, `createDebateTranscript`, `createDebater`. **The root does not export `responseAuditor`, `createModerator`, `createJudge` or `createReferee` under those names**: they are subpath-only (`P`index.ts:80-113 contains no `response-auditor` or `createModerator`; grep of `P`index.ts for `responseAuditor` returns nothing). The page's import lines must use the subpath for those.
- Subpaths, each a published export: `@flow-state-dev/patterns/plan-and-execute`, `/supervisor`, `/routed-specialists`, `/response-auditor`, `/event-actors`, `/round-robin`, `/debate`, `/benchmark`. `parallelTasks` has no subpath (root only). `packages/patterns/package.json` exports map.
- `taskBoard`, `goalSeekLoop`, `mapToVerdict`, type `Verdict`, `taskWorkerInputSchema`: `@flow-state-dev/orchestration/task-board` (`pt:19`, `ea:51`, `gsl:79-217`).
- `defineResource`, `utility` (`utility.decomposer`, `utility.combiner`, `utility.keyedRouter`): `@flow-state-dev/core`.
- `biasAnalyzer`: `@thought-fabric/core/metacognition` (`bias/blocks:373`; `packages/thought-fabric-core/README.md:312`).

### 1.2 Which patterns run a task board

R-41 row: "Patterns: which patterns run a task board". Verified by grep: `taskBoard(` is called only in `sv`, `pae`, `ea`, `pt`.

| Pattern | Task board? | How | Cite |
| --- | --- | --- | --- |
| `parallelTasks` | Yes | `goalSeekLoop` with `maxIterations: 1`, an always-`done` judge, board concurrency `maxConcurrency` (3), `claimOrder: "fifo"`, `onIdle: "complete"`. One drain, no feedback loop | `pt:130-143,190-200` |
| `planAndExecute` | Yes | `goalSeekLoop` over a board: concurrency `maxConcurrency` (1), `fifo`, `onError: "skip"`, flow policy `recentTrajectory({ n: 8 })`; loop `onError: "fail"` | `pae:720-733,815-825` |
| `supervisor` | Yes, directly (not `goalSeekLoop`) | One board; each worker is wrapped `worker -> reviewer -> verdict`; concurrency `maxConcurrency` (3), `fifo`, flow policy `declaredDepsOnly()` | `sv:359-372` (the `taskBoard({...})` call; the factory body is `sv:270-439`) |
| `eventActors` | Yes | One board, `fifo`, `onIdle: "complete"`, concurrency `concurrency` (4); one worker per actor | `ea:443-453` |
| `routedSpecialists` | No board | One-at-a-time loop; each iteration is a Task in a collection held in the pattern's sequencer state | `rs:596-651`; `gsld` pattern table says "not built on this loop" |
| `roundRobin` | No board | Task collection used as an audit record, one Task per (round, agent) turn | `rrc:57-65` |
| `debate` | No board | Same: one audit Task per (round, debater) turn | `dbr:52-62` |
| `responseAuditor` | No tasks at all | A sideChain sequencer with parallel analyzers | `ra:189-224` |

Which patterns are built on `goalSeekLoop`: `planAndExecute` and `parallelTasks` only. Supervisor and routedSpecialists are not. `gsld` lines 100-105 (the existing table); confirmed in `pae:815` and `pt:190`; `sv` and `rs` do not import `goalSeekLoop`.

## 2. Shared facts that several tables point at

### 2.1 Task-cap options (four patterns)

`parallelTasks`, `planAndExecute`, `supervisor` and `eventActors` all take `maxTotalTasks` and `maxEnqueuedTasks`. The first three also take `maxTotalRetries`. `eventActors` does not: its board is built with the retry budget switched off, because its tasks cannot retry. `tct:372-430` (all four accept an override), `tct:478-560` (retry budget reaches three, "installs NO budget on an eventActors board"), `ea:260-264`.

| Option | Type | Default | Meaning | Cite |
| --- | --- | --- | --- | --- |
| `maxTotalTasks` | `number \| null` | 500 | Lifetime count of tasks the board may hold, including finished ones. `null` is unbounded | `tc:221`, `tc:328-329` |
| `maxEnqueuedTasks` | `number \| null` | 100, or `maxTotalTasks` when that is lower | Count of tasks that may be waiting (`pending`) at once. `null` is unbounded | `tc:224`, `tc:341-346` |
| `maxTotalRetries` | `number \| null` | 50 | Cumulative failure retries across every task. `0` runs every task once and never retries. `null` is unbounded. At the bound a failing task settles `errored` and the board's termination reason is `retry-budget-exhausted` | `tc:243`, `tc:348-349`; `pt:49-63`, `sv` doc comment on `maxTotalRetries` |

- A plan that would cross `maxTotalTasks` or `maxEnqueuedTasks` is refused whole: nothing from it is created. `tct:100-106` ("refuses an oversized plan ... leaving nothing behind"). For `eventActors`, the unit is one dispatch call. The initial emit handles one entry: if its matching actors would cross the remaining budget, none is dispatched. With `reEmit`, one call covers all the entries one actor emitted, so the batch is refused as a whole; the entries are already appended and stay recorded, and the source task errors. `tct:124-200`; `ea:297-306,318-387` (read of `spawnTasksFor` and the re-emission call).
- `maxEnqueuedTasks` greater than `maxTotalTasks` throws at construction. `tc:294-300`. `maxTotalTasks` and `maxEnqueuedTasks` must be positive integers or `null`, so `0` is refused; `maxTotalRetries` accepts `0` (never retry). Negative and fractional values are refused for all three. `tc:246-271`.
- Omitting an option leaves the default; passing `null` is the unbounded opt-out. `tcap:1-21`; `pick-task-cap-overrides.test.ts:5`.
- `maxTotalRetries` only binds a board whose tasks can retry: `supervisor` (`maxAttemptsPerTask` 3 by default) and `planAndExecute` once `maxAttemptsPerTask` is above 1. For `parallelTasks` it binds only when the planner gives a task its own `maxAttempts` (`pe:99,152-157`).

### 2.2 `onSubTaskError`

`parallelTasks` and `supervisor`: `"skip"` (default) or `"fail"`. `pt:99`, `sv:282`, `svs:97`, `pts:14`.

| Value | Effect | Cite |
| --- | --- | --- |
| `"skip"` | A failing task is recorded `errored` (board status; `failed` is only `planAndExecute`'s output word), siblings continue, the failed task's output is left out of what the synthesizer receives. If every task fails, the synthesizer receives an empty array (`parallelTasks`) or an empty `results` (`supervisor`) | `pt:120,157-171`; `ptt:198-230`; `svt:340`; `svy` (`results` built from `completed` only) |
| `"fail"` | The first failure throws and fails the run | `ptt:232-257`; `svt:322-339` |
| `"retry"` (not in the type) | Not supported. Passing it anyway logs a warning at construction and behaves as `"skip"`. The warning text names the option. For `supervisor` it points at `maxAttemptsPerTask` | `pt:113-118`; `sv:307-312` |

### 2.3 Per-task `context` and `taskContext` (`planAndExecute`, `supervisor`)

- `taskContext`: `"goal"` (default), `false`, or a block. `pae:189`, `sv` config (`taskContext?: "goal" | false | BlockDefinition`), `pe:350`.
  - `"goal"`: every task the planner left without a `context` gets the (synthesized) goal copied in. A `context` the planner supplied is kept. `pe:204-226`.
  - `false`: tasks keep no context unless the planner set one. `pe:391`.
  - A block: runs once over `{ goal, tasks }` and returns `{ tasks }`. The block owns the contexts it returns; it is not post-filtered, so it should keep planner-supplied context itself if wanted. `pe:233-238`; `pae:179-189` doc.
- `parallelTasks` has no `taskContext`: a task carries a `context` only if the planner emitted one. `pt` (no such option); `pe:140-150`.
- Replanning (`planAndExecute`): tasks the replan adds without a `context` get the goal copied in unless `taskContext` is `false` (a custom block still gets the goal copied on replans, though the block itself runs on the initial plan only; `O`task-board/apply-replan.ts:188-215, `pae:821-822`); replanner output stays `{ id, goal, deps }`; a custom `taskContext` block applies to the initial plan only. `gsl:168-175` (`taskContext` forwarded to the replan step), `pae:228-238` (`replannerOutputSchema`); `pe` custom enricher is wired only in `createPlanningEntry`.
  - Not verified against a run: the "goal copied into replanned tasks" half is from the `goalSeekLoop` replan step's doc comment (`gsl:168-175`) and the existing `plan-and-execute.md` page. Treat as [doc].
- `synthesizeGoal`: `false` (default), `true`, or a block. `true` runs a built-in history-aware step that rewrites the goal into a self-contained one before planning, with `history: { limit: 8 }`; on a model failure it falls back to the original goal. A block must return `{ ...input, goal }` and handles its own failures. The rewritten goal is what the planner, replanner and synthesizer see. `pe:55-61,267-307,317-326`; `pae:198`; `sv:` `synthesizeGoal`.

### 2.4 The worker's input on a board pattern

Block workers on `parallelTasks` and `supervisor` receive a `TaskWorkerInput`. The `planAndExecute` step executor does not: an adapter rebuilds its input as `{ stepId, goal, context?, dependencyResults? }` and drops every other field, `priorWork` included (`pae:420-484`). The `recentTrajectory({ n: 8 })` policy is set on that board but the executor never sees it. Fields, each present only when it applies, except `taskId`, `goal` and `attempts`, which always are (`twi:39-110`, `wst:139-158`):

| Field | Type | Meaning |
| --- | --- | --- |
| `taskId` | string | The task id |
| `goal` | string | The task's goal |
| `title` | string | Short label, when the planner gave one |
| `context` | string | Per-task support text (2.3) |
| `attachments` | array of attachment references | The brief's files, when the task has some |
| `input` | any | The planner's `input` for the task; for `parallelTasks` it is the task's goal unless the planner set `input`. For `supervisor` and `planAndExecute` it is absent unless the planner set it. `pe:140`, `pe:79` |
| `deps` | `Record<taskId, output>` | Output of each declared dependency that has completed. Absent when there are none |
| `attempts` | integer | Attempt number; 1 on the first attempt (supervisor reviewer input defaults it to 1, `svs:74`) |
| `feedback` | string | Why the last attempt failed. For `supervisor` that is the reviewer's feedback. Absent on a first attempt. `svt:527-570` |
| `steers` | array of `{ message, from, question?, by? }` | Words sent into the task while it was open, oldest first |
| `followUpOf` | string | Id of the finished task this one follows up |
| `metadata` | record | The task's metadata |
| `sealed` | record | Server-written payload for the row, when it has one |
| `priorWork` | any | Selected observations from earlier tasks, when the board's flow policy selects some. `supervisor` uses `declaredDepsOnly()` (outputs of declared dependencies only) |

The R-41 row for `parallelTasks` lists all of these; for `supervisor` it lists a subset ("taskId, goal, attempts, title, context, input, feedback, metadata, deps"). The full set applies to both (same packing function). Carry the full table once and let each pattern's section say what it fills.

## 3. `parallelTasks`

Fan out, run, fan in. One pass. `pt:1-14`.

- Input: `{ goal: string }`, schema export `parallelTasksInputSchema`. `pts:10-12`.
- Output: the synthesizer's result. With the default combiner that is `{ combined: unknown, mergeNotes?: string[] }`. `packages/core/src/utility/combiner.ts:4-7,122-` ; with `outputSchema` it is shaped by that schema (below). `pt:125-128`.
- An empty list of completed outputs through the default combiner gives `{ combined: [], mergeNotes: ["No artifacts provided; returned an empty combined array."] }`. `packages/core/src/utility/combiner.ts` `combineArtifacts`.

| Option | Type | Default | What it does | Cite |
| --- | --- | --- | --- | --- |
| `name` | `string` | required | Instance name; also the task collection id | `pt:30,132` |
| `worker` | block | required | Runs once per sub-task. Receives a `TaskWorkerInput` (2.4) | `pt:33,138` |
| `maxConcurrency` | `number` | 3 | Sub-tasks running at once | `pt:36,96` |
| `maxTotalTasks` | `number \| null` | 500 | 2.1 | `pt:46` |
| `maxEnqueuedTasks` | `number \| null` | 100 | 2.1 | `pt:47` |
| `maxTotalRetries` | `number \| null` | 50 | 2.1. Retries only a task the planner gave its own `maxAttempts`; the pattern has no `maxAttemptsPerTask` | `pt:63`, `pt:48-62` |
| `planner` | block | `utility.decomposer()` | Accepts `{ goal: string }`, returns `{ tasks: [...] }` (below) | `pt:65-66,122-123` |
| `synthesizer` | block | `utility.combiner()` | Receives `unknown[]`, the output of every completed task | `pt:68-72,125-128,157-171` |
| `onSubTaskError` | `"skip" \| "fail"` | `"skip"` | 2.2 | `pt:79,99` |
| `outputSchema` | Zod schema | none | Passed to the default combiner only; ignored when you supply `synthesizer` | `pt:81-82,125-128` |

- No `model`, `uses`, `context` or visibility option exists. The default planner is a model call with the decomposer's default model `openai/gpt-6-luna`; the default combiner makes no model call. `packages/core/src/utility/decomposer.ts` `model: config.model ?? "openai/gpt-6-luna"`; `pt:122`; `combiner.ts` is a handler.
- Planner output: `{ tasks: Array<{ goal, id?, title?, assignee?, deps?, dependencies?, priority?, input?, context?, maxAttempts? }> }`. `id` defaults to `task-1`, `task-2`, in order. `deps` falls back to `dependencies`, then `[]`. `priority` counts only when it is a number. `title` and `context` of `null` are treated as absent. `pe:87-102,136-158`. The default decomposer's own output has `id`, `title|null`, `goal`, `context|null`, `deps?`, `priority?` (`"high" | "medium" | "low"`). `packages/core/src/utility/decomposer.ts:6-18`. (Its string priority is ignored by the seed, `pe:150`.)
- Synthesizer contract: receives `unknown[]`; filtered to `completed` tasks with a defined output. `pt:157-171`.
- Worker contract: `TaskWorkerInput` (2.4); for `parallelTasks` `input` is the task goal by default.
- The pattern sits in a sequencer with `.step()` unchanged (test: "works as a .step() step in another sequencer"). `ptt:259`.

## 4. `supervisor`

Plan, run workers in parallel, review each result, retry on rejection, synthesize. `sv:1-26`.

- Input: `{ goal: string }`, `supervisorInputSchema`. `svs:11-13`.
- Output: the synthesizer's output. Default synthesizer returns a string unless `outputSchema` is set. `sv:` default synthesizer `outputSchema: opts.outputSchema ?? z.string()`.
- Construction errors: neither `worker` nor `workers` given throws `[supervisor] "<name>" requires either \`worker\` or \`workers\``. `sv:293-296`. The page should say they are exclusive alternatives (doc comment "Mutually exclusive with `workers`", `sv:` config).

| Option | Type | Default | What it does | Cite |
| --- | --- | --- | --- | --- |
| `name` | `string` | required | Instance name; also the task collection id | `sv:` config |
| `worker` | block | none | One worker for every task. Mutually exclusive with `workers` | `sv:` config |
| `workers` | `Record<assignee, block>` | none | Registry; the task's `assignee` picks the worker | `sv:` config |
| `instructions` | string or `(input, ctx) => string` | none | Added to the default synthesizer's prompt | `sv:` (`instructions` passed to default synthesizer only) |
| `reviewCriteria` | `string[]` | none | Handed to the reviewer as `criteria`; the default reviewer renders them as a numbered list | `svr:143`; `svt:258-282,572-596` |
| `maxAttemptsPerTask` | `number` | 3 | Attempts per task before it fails for good. A planner-supplied `maxAttempts` on a task wins over it | `sv:280`; `pe:152-157` |
| `maxConcurrency` | `number` | 3 | Workers running at once | `sv:281` |
| `maxTotalTasks` | `number \| null` | 500 | 2.1 | `sv:` config |
| `maxEnqueuedTasks` | `number \| null` | 100 | 2.1 | `sv:` config |
| `maxTotalRetries` | `number \| null` | 50 | 2.1; binds by default because the supervisor retries by default | `sv:` doc comment |
| `planner` | block | `utility.decomposer()` (gets `context` and `history`) | Returns `{ tasks }`. `plannerOutputSchema` is `{ tasks: [{ id, goal, assignee?, deps?, priority?, context? }] }` | `sv:` default planner; `svs:82-93` |
| `taskContext` | `"goal" \| false \| block` | `"goal"` | 2.3 | `sv:` config |
| `synthesizeGoal` | `boolean \| block` | `false` | 2.3 | `sv:` config |
| `reviewer` | block or `false` | LLM reviewer, model `intent/synthesize` | Reviews each worker result. `false` removes the review: output goes straight to complete, and a task that fails is labelled `worker-error` | `sv:157-159,` `svr:` (`reviewerGenerator === undefined` returns the worker unchanged) |
| `synthesizer` | block | LLM, model `intent/synthesize` | Receives `{ goal, results, resultItems? }` (below) | `sv:228`; `svy:` build step |
| `onSubTaskError` | `"skip" \| "fail"` | `"skip"` | 2.2 | `sv:282` |
| `outputSchema` | Zod schema | `z.string()` for the default synthesizer | Schema of the default synthesizer's output | `sv:` default synthesizer |
| `context` | generator context slot | none | Forwarded to the default planner, reviewer and synthesizer | `sv:` config |
| `history` | generator history config | none | Forwarded to the default planner and synthesizer | `sv:` config |
| `uses` | capabilities | none | Forwarded to the default reviewer and synthesizer | `sv:` config |
| `reviewerVisibility` | `ItemVisibility` | `{ client: true, history: false }` | Visibility of the default reviewer's items | `sv:` default reviewer |
| `synthesizerVisibility` | `ItemVisibility` | `{ client: true, history: true }` | Visibility of the default synthesizer's items | `sv:` default synthesizer |

- No `model` option. The planner uses the decomposer's default; the reviewer and synthesizer use `intent/synthesize`. `sv:159,228`.
- Per-task review chain (observable): the worker runs, the reviewer gets its output, an `approve` verdict passes the worker's output on as the task's result, `reject` and `needs-revision` fail the attempt with the verdict's `feedback` as the error text, and the task goes back to `pending` while attempts remain. `svr:157-172`; `svt:432-470`.
- Worker input: 2.4. `feedback` carries the reviewer's feedback on a retry only. `svt:527-570`.
- Reviewer input `ReviewerInput`: `{ taskId, goal, attempts (default 1), workerOutput, criteria? }`; `criteria` only when `reviewCriteria` is non-empty. `svs:71-77`; `svr:134-144`.
- Reviewer verdict `ReviewerVerdict`: `{ decision: "approve" | "reject" | "needs-revision", feedback?: string, criteria?: Array<{ name, score }>, reasoning?: string }`. `svs:56-66`. **`feedback` is optional (0.7).** `reject` and `needs-revision` both retry. With no `feedback`, the retry's error text is `Reviewer <decision> the task output`. `svr:167-170`.
- A worker that throws spends the same attempt budget as a rejection. `svt:340-378` (skip path), `svt:597-634` (a reviewer that throws is labelled `reviewer-error`). The "same budget" half is [source]: both go through the board's fail path (`O`task-board/blocks/record-result.ts).
- Failure labels, applied once after the drain to every `errored` task: `failed-review` (last verdict was `reject` or `needs-revision`), `reviewer-error` (the reviewer step threw before returning a verdict (`entered` set, no `lastVerdict`)), `worker-error` (the worker failed before review, or `reviewer: false`). `svl:5-12,46-62`; `svt:473-526,597-634`.
- Dependents: a failed or cancelled task's pending dependents are cancelled by the board and labelled `skipped`. `sv` module doc ("A failed or cancelled task's dependents are cancelled by the board itself, labelled `skipped`").
- Synthesizer input: `{ goal: string, results: unknown[], resultItems?: Array<{ taskId, goal, items }> }`; `results` is the `output` of every `completed` task. The default synthesizer also lists the unique `source` items found in `resultItems`. `svy:` `buildResults`; `sv:` `collectUniqueSources`.
- Stages in run order (observable): plan, drain, label failures, synthesize. Step names and the seeding detail are not stated. `sv:430-439`.

## 5. `planAndExecute`

Plan a task graph, run it on a board, evaluate, optionally replan, synthesize. `pae:1-31`.

- Input: `{ goal: string }`, `planAndExecuteInputSchema`. `paes:81-83`.
- State: `{ goal: string (default ""), status?: "planning" | "executing" | "replanning" | "synthesizing" | "completed" | "failed", iteration: number (default 0) }`, `planAndExecuteStateSchema`. `paes:60-73`. (The collection-lifetime and re-entry wording is implementation: not stated.)
- Output with `synthesizer: false`: `{ goal: string, status: "completed" | "failed", tasks: Array<{ id, goal, status, result?, error? }>, completedSteps: number, totalSteps: number }`. `paey:62-96`. With a synthesizer, that shape is the synthesizer's input and its return is the output.
  - Task `status` values: `pending`, `in-progress`, `completed`, `failed`, `skipped`. Any other board status (`blocked`, `parked`) passes through under its own name. `paey:39-45`.
  - `error` is the task's error, or its feedback when it has no error. `paey:89`.
  - Overall `status`: `completed` when there are no tasks or at least one non-skipped task completed; `failed` when every non-skipped task failed, or every task was skipped. `paey:100-107`.
  - `completedSteps` counts `completed` tasks; `totalSteps` counts all tasks. `paey:92-95`.
- Board status to output status: `errored` becomes `failed`; every `cancelled` task becomes `skipped` (whether or not it carries the `skipped` label); `in_progress` becomes `in-progress`; the rest pass through. `paey:39-45`. The R-41 row says `skipped` = `cancelled` + label `skipped`; code maps any `cancelled`. Carry the code's version.
- Default step executor: model `intent/synthesize`; input `{ stepId, goal, context?, dependencyResults? }`; output `{ summary: string, success: boolean, reason: string (default ""), sources: Array<{ title (default ""), url }> (default []) }`. `pae:278-290,336-348`. A step the executor reports with `success: false`, or any thrown error, fails the task and cancels dependents (cascade). A `success: false` result throws the `reason` (or `Task did not produce a result`). `pae:466-486` (soft-failure check), `pae:` module note.
- Custom `stepExecutor` input: `{ stepId, goal, context?, dependencyResults? }`. `dependencyResults` is keyed by dependency task id, holds completed dependencies only, and is absent when there are none. `context` is the per-task support text (2.3). `pae:430-452`; `twi:90-100` (deps populated for completed dependencies).
- Evaluator: default (`enableReplanning: false`) is a handler with no model call: it increments `iteration`, returns `complete` once `iteration >= maxIterations` or no executable work remains, else `continue`. With `enableReplanning: true` it is a model call (`openai/gpt-6-luna` unless `model` is set) that returns `{ decision, reasoning, tasks? }`; the iteration cap still forces `complete`. `paev:107-135,229-262`. A custom evaluator must return `{ decision: "continue" | "complete" | "replan", score?, feedback?, reasoning?, tasks? }` (`EvaluatorVerdict`). `paes:106-112`. A `replan` with a `tasks` array adds those tasks directly; without one, the replanner runs. `pae:775-800`.
- Replanner output: `{ tasks: Array<{ id, goal, deps (default []) }> }`. `pae:230-238`.
- An evaluator that throws fails the request (loop `onError: "fail"`). `pae:821-824`.
- `maxIterations` is the number of drains the loop may run and the evaluator's iteration cap (default 3). `pae:612,819`.

| Option | Type | Default | What it does | Cite |
| --- | --- | --- | --- | --- |
| `name` | `string` | required | Instance name; collection id | `pae:101` |
| `planner` | block | `utility.decomposer()` | Returns `{ tasks }` | `pae:104,637-643` |
| `stepExecutor` | block | LLM executor (`intent/synthesize`) | Runs each task; input shape above | `pae:113` |
| `evaluator` | block | built in (above) | Decides continue / replan / complete | `pae:116` |
| `replanner` | block | LLM replanner (`openai/gpt-6-luna`) | Runs on `replan` with no inline `tasks`; output above | `pae:119` |
| `maxIterations` | `number` | 3 | Hard cap on drain-evaluate rounds | `pae:612` |
| `enableReplanning` | `boolean` | `false` | `true` turns on the model-backed evaluator | `pae:613` |
| `synthesizer` | block or `false` | LLM synthesizer (`openai/gpt-6-luna`, output `z.string()`) | `false` returns the output shape above | `pae:132,571,` default synthesizer `outputSchema: z.string()` unless `outputSchema` is set |
| `outputSchema` | Zod schema | string | Default synthesizer only | `pae:135` |
| `model` | `string` | per block, see 0.4 | Model for the default planner, executor, replanner, evaluator and synthesizer | `pae:138` |
| `maxAttemptsPerTask` | `number` | 1 (one attempt, no retries) | Stamped on every seeded task | `pae:614` |
| `maxConcurrency` | `number` | 1 | Board workers; raise it to run independent dependency-free tasks together | `pae:615` |
| `maxTotalTasks`, `maxEnqueuedTasks`, `maxTotalRetries` | | 500 / 100 / 50 | 2.1. `maxTotalRetries` binds once `maxAttemptsPerTask` is above 1 | `pae:160-175` |
| `taskContext` | `"goal" \| false \| block` | `"goal"` | 2.3 | `pae:189` |
| `synthesizeGoal` | `boolean \| block` | `false` | 2.3 | `pae:198` |
| `instructions` | string or function | none | Added to the default planner (when no custom planner), executor and synthesizer prompts | `pae:202,596-605` |
| `context` | context slot | none | Applied to all default blocks | `pae:204` |
| `history` | history config | none | Applied to the default planner, replanner and synthesizer | `pae:206,277,573` |
| `tools` | tools | none | Default executor, replanner, synthesizer | `pae:208,254,356` |
| `search` | `boolean \| GeneratorSearchConfig` | none | Default executor only | `pae:210,357` |
| `executionInstructions` | `string` | none | Appended to the default executor's prompt | `pae:212,359` |
| `synthesizeInstructions` | `string` | none | Appended to the default synthesizer's prompt | `pae:214,592` |
| `uses` | capabilities | none | Default blocks | `pae:217` |
| `plannerVisibility` | `ItemVisibility` | none | **No effect (0.5).** Declared, never read | `pae:240` |
| `stepExecutorVisibility` | `ItemVisibility` | `{ client: true, history: false }` | Default executor | `pae:221,379` |
| `synthesizerVisibility` | `ItemVisibility` | `{ client: true, history: true }` | Default synthesizer | `pae:223,687` |
| `resources` | `Record<string, any>` | none | Declared on the default executor | `pae:225,358` |

Exports from `P`plan-and-execute/index.ts: `PlanSchema`, `PlanTaskSchema`, `planAndExecuteStateSchema`, `planAndExecuteInputSchema`, `iterationOutputSchema`, `evaluatorVerdictSchema`, helpers `evaluatePlanProgress`, `createTaskEvaluator`, `createLLMEvaluator`, `createCaptureAndPlan`, `createApplyReplan`, `createSynthesize`, `createBuildPlanOutput`, `normalizeOutputStatus` and types. `pae:65-95`; the root re-exports a subset (`P`index.ts:13-37). R-41 keeps the input and output shapes and links to the generated API section for the list. (`PlanTaskSchema` has a `dependencies` field the output does not carry; do not call it the output shape.)

## 6. `routedSpecialists`

A controller picks which specialist runs next over a shared workspace, until it says done. `rs:1-26`.

- Input: not schema-bound. The first block accepts any value and passes it to `initialState` when that is a function. `rs:365-380`; test input `{ message: "go" }` at `rst:` ("testBlock(pattern, { input: { message: "go" } ... })").
- Output with `synthesizer: false`: `{ workspace: <workspace state>, iterations: number, history: Array<{ iteration, specialist, reasoning, output }> }`. `history` lists only completed iterations, oldest first; a failed iteration is left out. `rs:630-651`; `rst:213-243`. With a synthesizer (default) that shape is its input; its return is the output. `rs:653-655`.
- Controller decision (`controllerOutputSchema`): `{ specialist: string | null, done: boolean, reasoning: string }`. `rss:96-100`. `specialist` names a registered specialist when `done` is false and is `null` when done.
- Observable run order: seed the workspace from `initialState` if set; controller decides; if not done, a task is recorded and the named specialist runs; the result is stored as the task's output; the workspace snapshot is emitted; the loop continues unless done. `rs:596-651`. Internal step names are not stated.
- `maxIterations` caps loop-backs (0.2): the controller runs once, then at most `maxIterations` more times. `rs:626-629`; `rst:245-274`.
- A specialist that throws: the task is recorded `failed`, the loop continues. `rs:483-525`; `rst:213-243`.
- A controller returning `done: false` with `specialist: null` creates no task (`recordIteration` creates one only when `specialist` is set, `rs:402-440`); the dispatch error is rescued and the run does not fail at the top level; the loop continues. `rsd:21-31`; `rst:286-324`.
- An unregistered specialist name is raised by the router with the list of registered names, rescued, and the loop continues. Unlike the `null` case, `recordIteration` has already created and claimed the iteration's task, and the rescue fails it (`collection.fail`, status `errored`): `rs:476-509`. `rsd:1-8` (doc comment); [source] for "task recorded failed".
- Construction errors: `specialists` empty throws `[routedSpecialists] At least one specialist is required in "<name>"`. `rs:358-362`; `rst:276-284`.
- One task per iteration in which the controller picked a specialist. `assignee` is the specialist's name; `goal` is the controller's `reasoning` (or `iteration N` when blank); `metadata.reasoning` and `metadata.iteration` hold the reasoning and the iteration number; `output` is the specialist's return value. The collection is queryable after the run, and the default controller reads its completed tasks to build its history prompt. `rs:208-228,420-433`; `rs:632-645`.
- Items emitted: a data item of type `routedSpecialists`, key = the pattern `name`, payload `{ state: <workspace state>, iteration, specialist: string | null, done }`, visibility `{ client: true, history: false }`; the sequencer declares container component `routedSpecialists`. `rs:560-573,596-600`.

| Option | Type | Default | What it does | Cite |
| --- | --- | --- | --- | --- |
| `name` | `string` | required | Instance name; prefix of internal block names; default collection id | `rs:82` |
| `workspace` | `DefinedResource` | required | The shared writable resource; build it with `createWorkspace(stateSchema)` | `rs:89`; `rss:25-33` |
| `specialists` | `Record<string, BlockDefinition>` | required, at least one | Blocks the controller can pick, by name. Each should declare `resources: { workspace }` | `rs:96` |
| `instructions` | string or `(input, ctx) => string` | none | Overall instructions for the default controller and synthesizer. Ignored when you supply `controller` or `synthesizer` | `rs:103` |
| `controller` | block | LLM controller (below) | Returns the decision above | `rs:111` |
| `maxIterations` | `number` | 10 | 0.2 | `rs:114,354` |
| `maxHistory` | `number` | unlimited | The default controller's prompt shows only the most recent N completed iterations; the collection keeps all | `rs:122,212-215` |
| `initialState` | object or `(input) => object` | none | Applied with `setState` once at the start of each run. Without it the workspace keeps whatever the session already holds | `rs:128-132,369-379` |
| `model` | `string` | `"openai/gpt-6-luna"` | Default controller and synthesizer | `rs:135,184,279` |
| `context` | context slot | none | Default controller and synthesizer | `rs:138` |
| `uses` | capabilities | none | Default controller and synthesizer | `rs:141` |
| `controllerVisibility` | `ItemVisibility` | `{ client: true, history: false }` | Default controller | `rs:144,188` |
| `synthesizerVisibility` | `ItemVisibility` | `{ client: true, history: true }` | Default synthesizer | `rs:147,281` |
| `synthesizer` | block or `false` | LLM synthesizer | `false` returns the raw `{ workspace, iterations, history }` | `rs:154,580-593` |
| `outputSchema` | Zod schema | none | Default synthesizer only | `rs:157,282` |
| `collectionId` | `string` | `name` | Id of the iteration task collection | `rs:163,356` |

That is 16 fields; the R-41 row's list matches. `createWorkspace` is exported and returns a session-scoped writable resource. `rss:25-33`.

## 7. `eventActors`

Actors subscribe to entry topics; emitting an entry runs every matching actor. `ea:1-30`.

- `emit` input: an entry `{ type: string, topic: string, body: unknown }`. `ea:72`, `eaa:` (reads `type`, `topic`, `body`).
- `emit` appends the entry to the workspace first (unless it is a duplicate, below), then starts one task per matching actor, and each actor's block receives the entry as its input. `ea:455-462,316-324`, `ea:438`.
- Three config surfaces; each returns:
  - `createEventActorsWorkspace({ name: string, entries: ZodTypeAny })` returns `{ workspace: DefinedResource }`. `entries` is documentation only. `ea:141-160`.
  - `actor({ name, watch, block })` returns a frozen descriptor. `watch` needs at least one pattern, else it throws `[eventActors] Actor "<name>" must have at least one watch pattern`. `ea:106-135`; `eat:83-116`.
  - `eventActors({...})` returns `{ emit, workspace, actors }`; `actors` is frozen. `ea:208-215,464-468`.

| `eventActors` option | Type | Default | What it does | Cite |
| --- | --- | --- | --- | --- |
| `name` | `string` | required | Instance name | `ea:167` |
| `workspace` | `{ workspace: DefinedResource }` | required | Result of `createEventActorsWorkspace` | `ea:171` |
| `actors` | `Actor[]` | required, at least one | An empty list throws `[eventActors] "<name>" must have at least one actor` | `ea:177,236-240`; `eat:428-440` |
| `concurrency` | `number` | 4 | Actors running at once; a larger value is accepted (0.3) | `ea:179,230` |
| `reEmit` | `boolean` | `false` | Actor outputs shaped like entries are appended and dispatched again | `ea:188,231` |
| `maxDepth` | `number` | 3 | Re-emission depth cap; only matters with `reEmit` | `ea:195,232` |
| `maxTotalTasks` | `number \| null` | 500 | 2.1 | `ea:204` |
| `maxEnqueuedTasks` | `number \| null` | 100 | 2.1 | `ea:205` |

(The R-41 row names only the first six. The two cap options are public config: carry them. No `maxTotalRetries`: 2.1.)

- Topic matching: a pattern is matched against the string `${type}:${topic}`. `*` matches within one segment (segments are separated by `:` or `.`, so `*` never crosses either); `**` matches any characters, including none; the characters `. + ^ $ { } ( ) | [ ] \` are escaped and match themselves; any other character is passed into the `RegExp` as written, so `?` is a quantifier and does not match literally (`eam:30-46`). `eam:1-49`; `eat:17-42`. Examples (from the module doc and the existing page): `observation:*` matches `observation:slack`, not `observation:slack.msg`; `observation:**` matches `observation:slack.msg.edit`, not `event:slack`; `*:slack` matches `observation:slack` and `event:slack`; `observation:slack.*` matches `observation:slack.message`, not `observation:slack.a.b`; `**` matches everything. `eam:12-17`; `apps/docs/docs/patterns/event-actors.md` topic table. Note `*` also matches the empty string. `eam:35`.
- `reEmit` mechanics: an actor's output is normalised: an array, a bare entry object, or `{ entries: [...] }`; only objects with string `type`, string `topic` and a `body` key count; anything else is dropped. `normalizeToEntries`, `ea:79-100`; `eat:44-81`. Each counted entry is appended to the workspace, then dispatched to its matching actors as new tasks one level deeper. The initial dispatch is depth 1, re-emitted tasks are depth 2, 3, ... At `maxDepth` the actor still runs and its entries are still appended, but nothing is dispatched from them. `ea:353-386,406-419`; `eat:375-426`. Task `metadata` carries `{ depth, type, topic }`. `ea:293-298`.
- Duplicates: an entry whose `type` and `topic` already appear in the workspace is not appended again and no `rb-entry` item is emitted; actors are still dispatched for a repeated re-emitted entry. `eaa:133-143`; `ea:378-385` (comment: "Deliberately NOT gated on the dedup"). For the seed entry the append is skipped on a duplicate (`eat:188-246`); the dispatch step is separate and is not gated on it (`ea:316-324`) [source].
- `createAppendEntry(name, workspaceResource, resourceKey = "workspace")`: appends the entry and emits its `rb-entry` item, unless an entry with the same type and topic is already there, in which case it does neither. It returns nothing either way, so compose it with `.tap()`; with `.step()` the next step receives `undefined`. `eaa:112-143` (`@remarks`); `eat:188-246`.
- A failing actor records a failed task and the rest of the chain continues (board default `onError: "skip"`). A task already cancelled or completed keeps that status and no failure is written over it. `ea:443-453` (no `onError` set; default `"skip"`, `tb:691`); the fenced-write behaviour is [source] `O`task-board/blocks/record-result.ts:514-535 (`ifAllowed: true`). No test in `eat` covers actor failure.
- Items emitted: data item `rb-entry`, payload `{ type, topic, body }`, visibility `{ client: true, history: false }`, one per appended entry (key `entry-<n>`); the sequencer declares container component `evented-actors`. `eaa:153-161`; `ea:409-413,455-459`.
- Tasks: one per matching actor, in a request-scoped collection with id `eventActors:<name>` (not `<name>`); `assignee` is the actor name; `input` is the entry. `ea:242,289-298`.

Exports table for `@flow-state-dev/patterns/event-actors`: `eventActors`, `actor`, `createEventActorsWorkspace`, `createEventActorsWorkspaceResource`, `eventActorsWorkspaceStateSchema`, type `EventActorsWorkspaceState`, `matchTopic(pattern, topicKey)`, `compilePattern(pattern)` (returns a cached `RegExp`), `createAppendEntry`, `normalizeToEntries`, types `EventActorsConfig`, `EventActorsHandle`, `EventActorsWorkspaceConfig`, `ActorConfig`, `Actor`. `ea:60-66,79,106-125`; root `P`index.ts:60-72. The R-41 row says the signatures come from the generated API section; the page lists names and kinds only.

## 8. `roundRobin`

A fixed roster takes turns, in declared order, for up to `maxRounds` rounds; an optional referee audits each round; a synthesizer writes it up. `rr:1-24`.

- Input `{ goal: string }`, `roundRobinInputSchema`. `rrs:13-15`.
- Order, observable: per round, each roster entry in declaration order, then the referee if set, then the exit check; after the loop, the output shape, then the synthesizer. `rr:266-349`. Internal step names are not stated.
- Exit: after each round, the loop ends if the round count has reached `maxRounds`; otherwise `terminateWhen(ctx)` is called and a `true` ends it. The count check runs first. So at most `maxRounds` rounds run, exactly `maxRounds` when `terminateWhen` never fires. `rr:306-318`; `rrt:67-135`.
- `terminateWhen(ctx: BlockContext) => boolean`: `ctx.sequencer.state` holds the round counter (`round`) and referee critiques (`refereeCritiques`); `ctx.session.state` is available. Should be pure and total; a throw surfaces as a loop runtime error. `rr:106-115` [doc]; for debate the throw case is tested (`dbt:1263`), for round robin it is [doc].
- Construction errors: empty `roster` (`roster must contain at least 1 entry`); a roster entry with an empty name; duplicate roster names (`duplicate roster name "<n>"`); `maxRounds` not above 0 (`maxRounds must be > 0`); `outputSchema` with `synthesizer: false` (`cannot set outputSchema when synthesizer: false`). `rr:186-208`; `rrt:354-394`.
- Transcript entry `{ round, agentName, text }`, `round >= 1`. `rrs:19-23`. One audit task per (round, agent) turn: `goal` is `<agent> (round <n>)`, `assignee` is the roster name, `metadata.round`, `output` `{ text }`; collection id from `collectionId`. `rrc:57-65`; `rrt:415`. Cross-link to the task record row on R-24 (the page plan's note).
- Output `RoundRobinFinalShape`: `{ rounds: number (rounds actually executed), contributions: Array<{ round, agentName, text }>, refereeCritiques: Array<{ round, critique }> }`. `refereeCritiques` is empty with no referee. It is the output when `synthesizer: false`, and the synthesizer's input otherwise. `rrs:76-80`; `rr:318-328`.
- Roster agents: the default agent is a model call that streams plain text, with no `outputSchema`; each item it emits carries the roster `name` as `agentName`. Its prompt gets the goal, round number, all prior contributions grouped by round, and the referee critiques so far. Model `intent/chat` unless `model` is set; visibility `{ client: true, history: false }`. `rra:95-99,130-135`. An override `block` replaces it and must return a string or `{ text: string }`; any other value is coerced with `String()` and a warning is logged once per agent. `rr:91-96`; `coerce:23-35`; `rrt:325-352`. Override blocks are not given `instructions`, `uses`, `tools` or `context` (the pattern forwards them to the default blocks only). `rr:276-290`.
- `referee`: a block that returns `{ critique: string }`, run once per round after the roster. Its critique is stored with the round it ran in and rendered into the prompt of later rounds' default roster agents (`Referee critiques so far:`); an override roster block has to read `refereeCritiques` from sequencer state itself. The referee does not control termination or order. `rr:128-133,247-261,302-304`; `rra:135`; `rrt:162-241`. Default: none; with none the step is absent. `rrt:136-160`.
- `createReferee(opts)` is a helper, not applied automatically; pass its result as `referee`. Imported from `@flow-state-dev/patterns/round-robin` as `createReferee`, or from the root as `createRoundRobinReferee`. Options: `name`, `contributions` (the same resource passed to `roundRobin`), `model` (default `intent/synthesize`), `context`, `uses`, `tools`, `instructions`, `itemVisibility` (default `{ client: true, history: false }`), `accessorKey` (default `contributions`). `rrf:24-47`. Its prompt asks it to flag: exaggeration to defend a stance, dismissing strong opposing points without rebuttal, claims unsupported by the data, vague language used to avoid engagement, and rehashing earlier rounds without engaging the strongest opposing points. It is told not to declare a winner, not to decide whether more rounds are needed, and not to propose new questions or redirect. `rrf:60-73`.
- `synthesizer`: default is a model call that combines the transcript and referee critiques; `false` skips it and returns the raw shape; a block replaces it and receives `RoundRobinFinalShape`. `outputSchema` shapes the default synthesizer's output (default `z.string()`), and is refused with `synthesizer: false`. Default model `intent/synthesize` (or `model` when set); `synthesizerVisibility` default `{ client: true, history: true }`. `rry:41-46`; `rr:204-208,330-349`.
- `contributions` option and `createRoundRobinContributions()`: by default each `roundRobin()` call makes its own contributions resource. Pass your own to read the transcript from another block after the loop, and register that resource on the flow's `resources` so the other block can declare it. The pattern empties it at the start of every run. When several round-robins share a sequencer chain, give each a distinct `accessorKey` (default `contributions`): the framework refuses one accessor key pointing at two different resources. `rr:116-125,151-161,211-213`; `rri:32-35`; `rrt:396-414`. Cross-link to R-08 for resource registration (the page plan's note).

| Option | Type | Default | What it does | Cite |
| --- | --- | --- | --- | --- |
| `name` | `string` | required | Instance name | `rr:102` |
| `roster` | `RosterEntry[]` | required, at least 1, unique names | Who speaks, in order | `rr:103,186-200` |
| `maxRounds` | `number` | 5 | Round cap; must be above 0 | `rr:105,175,201` |
| `terminateWhen` | `(ctx) => boolean` | none | Early exit, after each round | `rr:115` |
| `contributions` | `DefinedResource` | internal one | Shared transcript resource | `rr:126` |
| `referee` | block | none | Per-round audit | `rr:133` |
| `synthesizer` | block or `false` | LLM synthesizer | `false` returns the raw shape | `rr:135` |
| `outputSchema` | Zod schema | `z.string()` (default synthesizer) | Refused with `synthesizer: false` | `rr:137` |
| `instructions` | string or function | none | Forwarded to default roster agents and the default synthesizer | `rr:139` |
| `model` | `string` | none | Applied to default roster agents and the default synthesizer. With no value, agents use `intent/chat` and the synthesizer `intent/synthesize` | `rr:141`; `rra:95`; `rry:41` |
| `uses` | capabilities | none | Default roster agents and synthesizer | `rr:143` |
| `tools` | tools | none | Default roster agents and synthesizer | `rr:145` |
| `context` | context slot | none | Default roster agents and synthesizer | `rr:147` |
| `synthesizerVisibility` | `ItemVisibility` | `{ client: true, history: true }` | Default synthesizer | `rr:148`; `rry:46` |
| `collectionId` | `string` | `name` | Audit task collection id | `rr:150,210` |
| `accessorKey` | `string` | `"contributions"` | Accessor key of the contributions resource | `rr:161,211` |

`RosterEntry`: `name` (unique, non-empty), `role?` (injected into the default agent's prompt; ignored when `block` is set), `block?` (override). `rr:80-97`. The R-41 row says `model` default is "`intent/chat`"; that is right for roster agents only, see the row above.

## 9. `debate`

Debaters argue assigned stances; a judge rules once at the end; an optional moderator runs each round. `db:1-42`.

- Input `{ question: string }`, `debateInputSchema`. `dbs:14-16`.
- Without a moderator: every debater speaks each round in declared order, then the judge, then the optional synthesizer. With a moderator: it opens each round and decides who speaks; only its `nextSpeakers` run, one at a time (concurrency 1); the judge and synthesizer follow. `db:7-42`; `db:575-607`. Internal step names are not stated.
- Turn visibility: each turn sees all earlier rounds plus earlier speakers in the current round; debaters in one round run one after another, not in parallel. `db:599-603`; `dbt:100-128,776-812`. Default debaters see prior arguments tagged by stance only (`[stance] text`), never by name. `dbd:30-37,114-123`; `dbt:505-563`.
- Termination checks run after each round, in this order: `round >= maxRounds`; the moderator's last decision has `done: true`; `terminateWhen(ctx)` returns true. `db:463-470,583-600`; `dbt:888-1008,1225`. `terminateWhen` works with or without a moderator; should be pure and total; an error it throws propagates as a run error (`dbt:1263-1285`).
- Construction errors: fewer than 2 debaters (`debaters must contain at least 2 entries`); a debater with an empty name or empty stance; duplicate debater names; `maxRounds` not above 0; `outputSchema` with `synthesizer: false`; `moderator: false` (`moderator cannot be set to false ... use undefined to opt out`). `db:227-267`; `dbt:393-452,1287-1300`. Stances are required on every debater. `db:109-113`.
- Warnings at construction: `maxRounds` above 4 (`unusually high ... diminishing`); `anonymizeTranscript: false` while using the default judge and setting `model`. `db:250-257,268-274`.
- Moderator decision `DebateModeratorOutput`: `{ nextSpeakers: string[], briefing: string | null, newAngle: string | null, done: boolean }`. `dbs:55-61`.
  - `nextSpeakers` is the ordered list for this round; a list of one is a single-speaker round; speakers named twice speak twice. `dbt:1040-1071`.
  - `nextSpeakers: []` with `done: false` is rejected by the schema (`Moderator must return non-empty nextSpeakers when done is false`). With `done: true` it is allowed. `dbs:62-67`; `dbt:1360`.
  - `done: true` lets the current round still run, then ends the loop. `dbt:888-920`.
  - An unknown name throws at dispatch with the list of available names. `dbt:1010-1038`.
  - The moderator sees speaker names (it is not subject to `anonymizeTranscript`). `dbm:5-8`.
  - Each decision is recorded; `moderatorDecisions` on the output has one entry per round with a moderator, and is `[]` without one. `db:540-560`; `dbt:1073-1125`.
  - The debaters of a round see that round's `briefing` and `newAngle`, each independently nullable. The default debater prompt renders the briefing under `Briefing from the moderator:` and the angle under `Focus for this round:`. A custom debater reads `state.moderatorDecisions`. `dbd:121-135`; `dbt:814-886`.
  - Round 1: there is no transcript yet. The default moderator's prompt asks it to default to the full roster every round, to open round 1 with the full roster and a framing briefing, and to use `newAngle` rather than dropping a debater later. It is a prompt, not enforced. (The R-41 row's "or a balanced subset" is not in the prompt: dropped.) `dbm:94-121`.
  - Moderator tools: pass `tools` or `uses` to `createModerator` to give it research tools (web search, fetch). Their results reach debaters only through `briefing`. Without tools it reasons over the transcript and its prior decisions. `dbm:9-18,76-77`. **`debate({ tools, uses })` does not reach a moderator you pass in (0.6).** `tool_output` items: tool calls stream as the generator's tool items; the existing page's wording is [doc] only, not verified.
  - `createModerator` options: `name`, `rosterNames`, `transcript`, `model` (default `intent/synthesize`), `context`, `uses`, `tools`, `instructions`, `itemVisibility` (default `{ client: true, history: false }`). `dbm:40-57`.
  - A moderator that throws surfaces as a run error. `dbt:1195-1223`. A hand-rolled moderator's output must match `debateModeratorOutputSchema` and it must declare the shared transcript resource (accessor `transcript`). `dbs:55`; `dbt:653-692`.
- `transcript` option: pass the same `createDebateTranscript()` result to `debate({ transcript })` and to any custom moderator, judge or synthesizer that declares it; otherwise `debate()` makes its own, and a second declaration of the resource is rejected by the resource merge. `db:155-165`.
- Transcript entry `{ round, agentName, stance, text }`, one per turn. `dbs:20-25`. Audit tasks: one per (round, debater) turn, `goal` `<name> (round <n>)`, `assignee` the debater name, `metadata { round, stance }`, `output { text }`, in the collection `collectionId` (default `name`). `dbr:52-62`; `dbt:367-391`.
- Debater override contract: returns a string or `{ text: string }`; other shapes coerced with `String()` and a one-time warning per agent. `db:119-124`; `coerce:23-35`.
- Judge: the default judge reads the question and transcript and returns `DebateVerdict`. Override: returns `{ verdict: string, winner: string | null, reasoning: string }`; `winner: null` marks a synthesis verdict. `dbs:31-35`; `dbt:205-231`. The `judge` option's type does not accept `false` (type-level only; no runtime guard). `db:139`. **The R-41 row says the judge receives `{ question }`; the doc comment says so, but the judge step is composed after the loop and the default judge ignores its input and reads state and the transcript resource. Say what it must return, not what it receives (dropped).** `dbj:131-152`.
- Judge's view of the transcript: `anonymizeTranscript` (default `true`) strips debater names and keeps stances (`[stance] text`); `false` renders `[name, stance] text`. `shuffleForJudge` (default `true`) shuffles argument order within each round. `dbj:60-93`; `dbt:455-503,565-651`.
- Output `DebateRawOutput`: `{ rounds: number, question: string, transcript: Array<{ round, agentName, stance, text }>, verdict: { verdict, winner: string | null, reasoning }, moderatorDecisions: Array<{ round, nextSpeakers, briefing, newAngle, done }> }`. With `synthesizer: false` this is the output. `dbs:114-122`; `db:` `buildRawOutput`.
- Synthesizer: default is a model call that answers the question directly from the verdict and arguments (it is told not to mention the debate); output `z.string()` unless `outputSchema` is set; `false` skips it and returns the raw shape; a block replaces it; `outputSchema` with `synthesizer: false` throws. Default model `intent/synthesize`; visibility `{ client: true, history: true }`. `dby:74-79`; `db:258-262`.
- Built-in mitigations and their settings: the default debater prompt tells it to hold its position and not concede (`dbd:104`); the `maxRounds` warning above 4; `anonymizeTranscript` true; `shuffleForJudge` true; `maxRounds` and `terminateWhen` bound a moderator that never says done (`dbt:981-1008`). The failure modes themselves stay on the Concepts page.
- Items emitted: data items `debate-turn-pending` (before each debater, `{ round, agentName, stance }`), `debate-turn` (`{ round, agentName, stance, text }`, key `turn-<round>-<agentName>-<n>` where `n` is the transcript entry count before the append, `dbr:62-66`; only `debate-turn-pending` has no key, `db:341-349`), `debate-decision` (the moderator decision, key `decision-<round>`), `debate-verdict` (`{ verdict, winner, reasoning }`, key `verdict`), each visibility `{ client: true, history: false }`; container component `debate`. `db:333-347,352-365,490-506`; `dbr:64-70`; `dbt:290-365`.

| `debate` option | Type | Default | What it does | Cite |
| --- | --- | --- | --- | --- |
| `name` | `string` | required | Instance name | `db:128` |
| `debaters` | `DebaterConfig[]` | required, at least 2 | The roster | `db:130` |
| `maxRounds` | `number` | 2 | Round cap; above 0; above 4 logs a warning | `db:132,212,247-257` |
| `judge` | block | LLM judge | Rules once, after the loop | `db:139` |
| `synthesizer` | block or `false` | LLM synthesizer | 9 above | `db:141` |
| `moderator` | block | none (0.6) | Opens each round | `db:154` |
| `terminateWhen` | `(ctx) => boolean` | none | Early exit | `db:174` |
| `transcript` | `DefinedResource` | internal one | Shared transcript resource | `db:165` |
| `outputSchema` | Zod schema | `z.string()` | Default synthesizer only; refused with `synthesizer: false` | `db:175` |
| `instructions` | string or function | none | Default blocks only | `db:177` |
| `model` | `string` | per block: `intent/chat` for default debaters; `intent/synthesize` for the default judge and synthesizer | Applied to the default debaters, judge and synthesizer; not to a moderator | `db:179`; `dbd:67`; `dbj:101`; `dby:74` |
| `uses` | capabilities | none | Default debaters, judge, synthesizer | `db:180` |
| `tools` | tools | none | Default debaters, judge, synthesizer | `db:181` |
| `context` | context slot | none | Default debaters, judge, synthesizer | `db:182` |
| `judgeVisibility` | `ItemVisibility` | `{ client: true, history: true }` | Default judge | `db:183`; `dbj:105` |
| `synthesizerVisibility` | `ItemVisibility` | `{ client: true, history: true }` | Default synthesizer | `db:184`; `dby:79` |
| `debaterVisibility` | `ItemVisibility` | `{ client: true, history: false }` | Default debaters | `db:185`; `dbd:80` |
| `anonymizeTranscript` | `boolean` | `true` | Judge's view, above | `db:191,221` |
| `shuffleForJudge` | `boolean` | `true` | Judge's view, above | `db:196,222` |
| `collectionId` | `string` | `name` | Audit task collection id | `db:198,276` |

`DebaterConfig`: `name` (unique), `stance` (required, non-empty), `role?` (persona line in the default debater's prompt; ignored with `block`), `block?` (override). `db:103-125`. The R-41 row lists 20 options; the table above has 19 plus the 4 fields of `DebaterConfig`; check at pass 3 that `name` plus these 19 account for the type's 20 (`db:127-199`: name, debaters, maxRounds, judge, synthesizer, moderator, transcript, terminateWhen, outputSchema, instructions, model, uses, tools, context, judgeVisibility, synthesizerVisibility, debaterVisibility, anonymizeTranscript, shuffleForJudge, collectionId = 20). The table is complete.

Exports of `@flow-state-dev/patterns/debate` (the root exports only `debate`, the input and state schemas, the entry and verdict schemas, `createDebateTranscript` and `createDebater`; `createModerator`, `createJudge` and the rest are subpath-only): `debate`, `createDebater`, `createJudge`, `formatTranscriptForJudge`, `createSynthesize`, `createModerator`, `createInitTranscript`, `createRecordArgument`, `createDebateTranscript`, the schemas and types listed at `db:75-100`. `createInitTranscript` and `createRecordArgument` are also exported from the subpath (`db:93-99`). The page no longer lists exports; the generated API section does.

## 10. `responseAuditor`

A sideChain sequencer that runs analyzers over a finished response and surfaces the findings. `ra:1-14,189-225`.

- Input `{ userInput: string, response: string }`, `auditorInputSchema`. `ras:35-40`. The `.sideChain()` connector must map the pipeline value to this shape. `ra:` module doc and `captureContext` comment.
- Each analyzer receives `{ userInput, response }` and returns an `AnalyzerResult`. `ras:63` doc.
- Analyzers run in parallel, up to `maxConcurrency` at once. `ra:219-224`; `rat:132-155,263-283`.
- A failing analyzer is dropped from the results and does not fail the audit; the rest aggregate. `ra:149-157,193-199`; `rat:220-241`.
- Output: `{ results: AnalyzerResult[], surfacedResults: AnalyzerResult[], overallScore: number }`. `ra:95-124`. `overallScore` is the average `score` of the analyzers that did not fail; `0` with no analyzers or none succeeded. `ra:76-91`; `rat:385`. `surfacedResults` holds every result whose `shouldSurface` is true or whose `score >= threshold`. `ra:108-113` (0.8); `rat:156-219`.
- Emitted item: when at least one result is surfaced, a data item of type `audit-annotation`, payload the threshold step's output (`{ results, surfacedResults, overallScore }`), visibility `{ client: true, history: false }`, with no key, so each invocation in a request produces its own card. When nothing surfaces, no item is emitted. `ra:117-145,223-224`; `rat:348-383`.
- Defaults: `threshold` 0.3. `ra:189`; `rat:284-300`.

| Option | Type | Default | What it does | Cite |
| --- | --- | --- | --- | --- |
| `analyzers` | block array | required | Pluggable analyzers; an empty list is accepted and gives `overallScore: 0` | `ras:61`; `rat:385` |
| `threshold` | `number` | 0.3 | A result at or above it surfaces | `ras:63`; `ra:189` |
| `maxConcurrency` | `number` | all analyzers at once | Parallel analyzer limit | `ras:69`; `ra:223` |
| `displayMode` | `"inline" \| "message"` | none | **No effect (0.5)** | `ras:65` |
| `alwaysRun` | `boolean` | none (the comment says `true`) | **No effect (0.5)** | `ras:67` |

`AnalyzerResult` (`AnalyzerResultSchema`, `ras:16-23`):

| Field | Type | Meaning |
| --- | --- | --- |
| `analyzerId` | string | Stable id of the analyzer |
| `category` | string | Domain it belongs to |
| `score` | number, 0 to 1 | Higher means more to surface |
| `shouldSurface` | boolean | Forces the result into `surfacedResults` whatever the score |
| `annotations` | array of annotation | The findings |
| `supplementary` | record | Domain extras a renderer may show; optional |

`AuditAnnotation` (`ras:6-12`): `type` string, `label` string, `severity` `"info" | "warning" | "critical"`, `description` string, `evidence?` string.

Exports of `@flow-state-dev/patterns/response-auditor` (subpath only; the root does not export them): `responseAuditor`, `AnalyzerResultSchema`, `AuditAnnotationSchema`, `auditorInputSchema`, `responseAuditorStateSchema`, types `AnalyzerResult`, `AuditAnnotation`, `AuditorInput`, `ResponseAuditorState`, `ResponseAuditorConfig`, `DisplayMode`, and the building blocks `captureContext` (writes `userInput`/`response` into state, returns nothing: `.tap()` only), `aggregateResults`, `applyThreshold(n)` (factory). `ra:19-35,57-70,100-109,167`. The building-block exports are in the module (`export const captureContext`, `export const aggregateResults`, `export { createApplyThreshold as applyThreshold }`); the package root does not re-export any of them.

### 10.1 `biasAnalyzer` (another package)

Rows moved here describe an example analyzer. It lives in `@thought-fabric/core/metacognition`, not in `@flow-state-dev/patterns`. Facts:

- Input `{ userInput: string, aiResponse: string }`. The field is `aiResponse`, not `response`: an adapter has to rename it. `bias/schema:109-114`.
- Pipeline: detect agreement (model), classify (model), score (deterministic), counterpoint (model, skipped below the counterpoint threshold), format (deterministic). Three model calls, two deterministic steps; the counterpoint call is conditional. Default counterpoint threshold 0.4 (`counterpointThreshold`). Model default `intent/utility`. `bias/blocks:373-405`; `bias/help:17-19`; `bias/blocks:121`. (Step names are internal and are not stated.)
- Output: `{ analyzerId: "bias-sycophancy", category: "metacognition", severity, score, label, summary, annotations, counterArguments, sycophancyScore }`. `severity`: `info` below 0.4, `warning` below 0.7, else `critical`. `annotations` entries are `{ biasType, confidence, description, evidence }`. `bias/schema:163-173`; `bias/help:68-72`.
- To use it as a patterns analyzer, an adapter must: rename `response` to `aiResponse` on the way in; on the way out add `shouldSurface`, and map each annotation from `{ biasType, confidence, description, evidence }` to `{ type, label, severity, description, evidence? }`. The bias output has no `shouldSurface` and a different annotation shape, so it does not satisfy `AnalyzerResultSchema` unadapted. `bias/schema:33-42,163-173` against `ras:6-23`; the existing page's adapter example (`apps/docs/docs/patterns/response-auditor.md:128-175`) is [doc].
- Bias types, the six values of `biasType`: `sycophancy`, `confirmation_bias`, `anchoring_bias`, `authority_deference`, `recency_bias`, `false_consensus`. `bias/schema:17-24`.
- Whether the page keeps this section is a pass-3 decision: it is a different package. If kept, it is one short table and a link.

## 11. `goalSeekLoop`

A drain-then-judge loop over a task board. `gsl:1-60`; `cfg` goalSeekLoop section. Import: `@flow-state-dev/orchestration/task-board`.

- Returns a sequencer. Judge verdict: `{ decision: "done", reason }`, `{ decision: "continue", reason }`, or `{ decision: "replan", reason, tasks?: TaskInit[] }`. `continue` re-drains with no new tasks; `replan` adds tasks (inline `tasks`, or from the `replanner` when none). `gsl:79-86`.
- Judge slot: a block, a sequencer, or a function `(input: { collection, drainResult }, ctx) => Verdict | Promise<Verdict>`. A block or sequencer judge receives the raw drain result and reads the board from `ctx`. `gsl:91-105`.
- Verdict validation: `reason` is required on every decision. A verdict that does not match is "malformed". `gsl:` `verdictSchema` (`z.discriminatedUnion`).
- `mapToVerdict(source, { decision, reason?, tasks? })`: adapts a decision-only source to a `Verdict`. `decision` is a function from the source to `done | continue | replan`; a missing `reason` is filled with `converged` (done), `continue` or `replan`; `tasks` is read only for `replan`. A source such as `{ decision: "complete" }` mapped this way is never malformed. `gsl:199-228`.
- Termination item: data type `goal-seek-loop-termination`, payload `{ collectionId, reason, iterations }`, visibility `{ client: false, history: false }`. `gsl:186`; `gsld` lines 144-150. `iterations` counts drains that ran. `reason` is the judge's `done` reason, `max-iterations`, `judge-error`, `waiting-on-a-user` or `waiting-on-an-event`. `gsl:252-254,480,511`; `gsld:150`.

| Option | Type | Default | What it does | Cite |
| --- | --- | --- | --- | --- |
| `name` | `string` | required | Outer sequencer name, prefix of internal blocks | `gsl:` config, `cfg` |
| `inputSchema` | Zod schema | `z.unknown()` | Public input of the loop | `gsl:314`, `cfg` |
| `activeStatusMessage` | `string` | none | Status text emitted before the loop runs | `gsl:` config |
| `board` | `TaskBoardHandle` | required | The board to drain. Request- or resource-backed only | `gsl:` config |
| `stateSchema` | Zod object schema | none | Extra fields merged into loop state; must be a `z.object` or construction throws | `gsl:` `mergeStateSchema` |
| `seed` | block or sequencer | none | Writes the first tasks before the first drain; optional when `initialTasks` seeded the board | `gsl:` config |
| `afterDrain` | block | none | Runs after each drain, before the judge | `gsl:` config |
| `judge` | block, sequencer or function | required | Returns a verdict | `gsl:` config |
| `replanner` | block | none | Runs on a `replan` verdict with no inline `tasks`; must emit a non-empty `{ tasks }` | `gsl:` config; `gsl:466` |
| `maxAttemptsPerTask` | `number` | 1 | Default attempts for tasks a replan adds | `gsl:317` |
| `taskContext` | context supply | none | Context for replanned tasks (2.3) | `gsl:` config |
| `maxIterations` | `number` | required | Total drains; a finite positive integer. The hard backstop | `gsl:326-330` |
| `finalize` | block or sequencer | none | Runs over the settled board; omit to return the board projection as is | `gsl:` config |
| `onError` | `"skip" \| "fail"` | `"skip"` | Judge and replanner errors only. `"skip"` exits with reason `judge-error` and still runs `finalize`. `"fail"` propagates a request error. `seed` and drain failures always propagate | `gsl:321,480` |

- `maxIterations` behaviour: when the budget runs out without a `done` verdict, the loop records reason `max-iterations`, runs `finalize` over what has settled, and does not throw. `gsl:505-512`; `gsld:27`.
- Not the same as `taskBoard`'s `maxIterations`: the board's is a per-drain cap (default 10,000, must be at least 1); the loop's is the number of drains. Setting one does not affect the other. `tb:692,716-720`; `gsld:29`; `cfg` (`maxIterations` row).
- `onError: "skip"` exits with `judge-error` when: the judge throws; the judge returns a malformed verdict; or the verdict is `replan` with no tasks and no `replanner`; also a replanner that emits no tasks. `gsl:455-480,` `buildWrappedReplanner`.
- Construction refusals (all throw at `goalSeekLoop()`): `maxIterations` not a finite positive integer (`Number.isSafeInteger`); a sequencer- or factory-backed board; a board declared `mode: "delegation"`; `maxIterations > 1` over a board whose `initialTasks` include an entry without an `id` (it would be re-added every drain; a single-drain loop is unaffected). `gsl:326-353`; `gsld:94`.
- A drain that leaves a task waiting on a person ends the pass with reason `waiting-on-a-user`: no judge, no replan, no finalize, and no iteration spent. A task waiting only on an event outside the board gives `waiting-on-an-event`. `gsl:38-53`; `gsld:50`. (These two reasons are in the termination row above; the mechanics belong to the Task board reference.)
- Not supported: composable termination (`.or()`/`.and()`), cost or wall-clock budgets, stall or no-progress detection, a configurable inner-drain factory. Termination is the judge plus `maxIterations`. `gsld:154`.
- Which patterns use it: 1.2.

## 12. Where each pattern keeps its data

The four questions for each stored part: who owns it, who can see it, where it lives, how many exist. "Client" below means `@flow-state-dev/client` readers; a resource with no `client` config is not visible to clients (`packages/core/src/types/resource.ts:323`, "Omit to keep the resource invisible to clients"). Item visibility is per emitted item: `client` and `history`.

| Part | Pattern | Owner | Who can see it | Where it lives | How many |
| --- | --- | --- | --- | --- | --- |
| Iteration tasks | `routedSpecialists` | The pattern's sequencer instance, for the run | Developers through the task collection; emitted as task items. The pattern's snapshot item (client yes, history no) shows the workspace and loop state to the client | A task collection held in the sequencer's own state (`backing: "state"`), id `collectionId` (default `name`) | One collection per pattern instance, one task per specialist-picking iteration. `rs:202-207,304-314` |
| Workspace | `routedSpecialists` | The session (scope `session`), the user's schema | Not client-visible (no `client` config on `createWorkspace`); specialists read and write it; the snapshot item copies its state to the client | A writable session resource built by `createWorkspace` | One per session per `createWorkspace()` result. Replaced by `initialState` at the start of each run when `initialState` is set; otherwise carried over. `rss:25-33`; `rs:365-380` |
| Entry log | `eventActors` | The session (scope `session`) | Visible to clients: `client.expose: ["entries"]` projects `entries`. Each appended entry also emits an `rb-entry` item (client yes, history no) | A writable session resource, accessor `eventedActors`, state `{ entries: any[] }`; append-only; never cleared by the pattern | One per `createEventActorsWorkspace()` call, per session. Entries are unique on `type` + `topic`. `eas:76-90`; `ea:243` |
| Actor tasks | `eventActors` | The request | As task items | A request-scoped collection, id `eventActors:<name>` | One collection per instance per request; one task per matching actor per entry. `ea:242,289-298` |
| Contributions | `roundRobin` | The session | Not client-visible; the output carries the transcript | A writable session resource, accessor `contributions` (configurable via `accessorKey`) | One per `roundRobin()` call unless you pass one; emptied at the start of every run. `rrs:67-73`; `rri:32-35` |
| Audit tasks | `roundRobin` | The pattern's sequencer, for the run | As task items (`task-change` items per turn, `rrt:415`) | Sequencer-state task collection, id `collectionId` | One collection; one task per (round, agent) turn. `rrc:57-65` |
| Referee critiques | `roundRobin` | The pattern's sequencer state, for the run | In the output (`refereeCritiques`) | Sequencer state | One list per run. `rrs:` state schema, `rr:247-261` |
| Transcript | `debate` | The session | Not client-visible; turns reach the client through `debate-turn` items | A writable session resource, accessor `transcript` (not configurable) | One per `debate()` call unless you pass one; emptied at the start of every run. `dbs:106-112`; `dbi:21-24` |
| Audit tasks | `debate` | The pattern's sequencer, for the run | As task items | Sequencer-state task collection, id `collectionId` | One task per (round, debater) turn. `dbr:52-62` |
| Moderator decisions | `debate` | The pattern's sequencer state, for the run | In the output (`moderatorDecisions`) and as `debate-decision` items | Sequencer state | One per round with a moderator. `dbs:83-91` |
| Board tasks | `parallelTasks`, `supervisor`, `planAndExecute` | The request | As task items; the finished board is in the pattern's output | A request-backed task collection, id `name` | One collection per instance per request. `pt:132`, `sv:` board `collection: { collectionId: name }`, `pae:719` |
| Reviewer audit data | `supervisor` | The supervisor's sequencer state, for the run | Not output; it drives the failure labels | Sequencer state, keyed by task id (`entered`, `lastVerdict`) | One slot per reviewed task. `svs:24-46`; `svl:5-12` |
| Loop bookkeeping | `goalSeekLoop`, `planAndExecute`, `parallelTasks` | The loop sequencer's state, for the run | The termination item (client no, history no) | Sequencer state | One per run. `gsl:` loop state schema |
| Analyzer state | `responseAuditor` | The sidechain's sequencer state, for the run | `audit-annotation` item when something surfaces | Sequencer state: `userInput`, `response`, `results`, `surfacedResults`, `overallScore` | One per invocation. `ras:` state schema |

Caveats the writer must keep: 
- "For the run" means the sequencer instance's own state, which a new run starts fresh. This comes from the doc comments ("per-run TaskCollection", `rri:1-5`, `dbi:1-5`) and was not checked by running two runs in one session. The two session resources that the pattern empties at run start (`roundRobin` contributions, `debate` transcript) and the two it does not (`routedSpecialists` workspace unless `initialState` is set, `eventActors` entry log) are the cases with a test or a direct code line.
- Task visibility to clients follows the board's items (the `task-board-meta` and task-change items), which belong to the Task board reference, not here. The page should link to it rather than restate which task items a client receives.

## 13. Row ledger: what each carried R-41 row became

Every row from `grep -rhE --include=*.record.md -e '→ R-41( \(corrected by pass 5\))?$' docs/contributing/docs-revamp/pages` (97 lines) was checked. "Carried" = the fact is stated above with the cite. "Corrected" = carried with a change. "Dropped" = not on the page, with the reason.

### routedSpecialists

| Row | Verdict |
| --- | --- |
| Internal block sequence, steps 1-9 (corrected by pass 5) | **Corrected, in part dropped.** Observable behaviour carried in section 6 (seed, controller, task per iteration, rescue of a failing specialist, snapshot, loop, output, optional synthesizer). Dropped: step names and numbering (`init`, `record-iteration`, `dispatch`, `record-completion`, `snapshot`, `loop check`), which are implementation. Corrected: "up to `maxIterations`" is loop-backs, so up to `maxIterations + 1` iterations run (0.2) |
| One Task per iteration (corrected by pass 5) | **Carried.** Section 6. The "queryable after the run" half has no test; it is true by construction (`collection.list`, `rs:208`, `rs:632-645`) and kept |
| 16-field config table (corrected by pass 5) | **Carried.** Section 6, all 16 fields match `rs:78-164`. Defaults checked: `maxIterations` 10, `maxHistory` unlimited, `model` `"openai/gpt-6-luna"`, `controllerVisibility` `{ client: true, history: false }`, `synthesizerVisibility` `{ client: true, history: true }`, `collectionId` = `name` |
| Output shapes | **Carried.** Section 6 |

### eventActors

| Row | Verdict |
| --- | --- |
| Cut, not moved: step list is internals; two observable rows | **Carried as stated.** The two observable facts are in section 7 (append first, then one task per actor; the block receives the entry) |
| Where actor runs are stored | **Carried.** Section 7 and 12 |
| Three config tables | **Carried and extended.** `maxTotalTasks` and `maxEnqueuedTasks` were missing from the row; added (section 7). `concurrency` doc comment contradicts the code (0.3) |
| Default concurrency 4, a caller may pass higher; `wakeOn` sentence cut | **Carried; the `wakeOn` sentence stays cut** (it names an implementation filter and has no observable surface here) |
| Topic pattern table | **Carried.** Section 7. One addition: `*` also matches the empty string |
| `reEmit` row | **Carried.** Section 7; depth semantics checked against `eat:375-426` |
| Failure row; CAS-safe wording cut | **Carried; the CAS wording stays cut.** The "already cancelled or completed keeps its status" half is [source] only (no test); flagged in section 7 |
| Entry log storage row | **Carried.** Section 7 and 12 |
| Exports table | **Carried as names and kinds only**, per the row's own note |
| `createAppendEntry` (corrected by pass 5) | **Carried.** `eaa:112-143` says exactly this |

### parallelTasks

| Row | Verdict |
| --- | --- |
| `planner` and `synthesizer` defaults, replaceable | **Carried.** Section 3 |
| One config table incl. full `TaskWorkerInput` (corrected by pass 5) | **Carried and corrected.** All ten options match `pt:27-83`; the worker input list is in 2.4, verified against `twi:39-110`. Correction: the row says `input` is "the sub-task goal"; it is the goal unless the planner supplied `input` (`pe:140`) |
| Input shape, output shape, `parallelTasksInputSchema` | **Carried.** Section 3. Output default is `{ combined, mergeNotes? }` |
| Exported names | **Carried** as names only; the generated API section holds them |
| Planner contract | **Carried and widened.** Planner output accepts more than `{ goal }` per task (section 3) |
| Synthesizer contract; `outputSchema` goes to default combiner only | **Carried** |
| `onSubTaskError` values; empty array if all fail | **Carried.** Section 2.2. The "empty array" claim: with all tasks failed `collectResults` returns `[]` and the combiner returns `{ combined: [], mergeNotes: [...] }` (checked in `combiner.ts`); no test pins it |
| Unsupported `"retry"` | **Carried.** `pt:113-118` |

### roundRobin

| Row | Verdict |
| --- | --- |
| Loop exit and final step | **Carried.** Section 8 |
| Round order observable behaviour; step names cut | **Carried; step names stay cut** |
| Transcript entry; one audit task per turn; 'session-scoped writable resource' wording cut | **Carried.** Section 8. The resource-scope wording is stated once, as data placement in section 12 (it answers the owner question) |
| Output shape `RoundRobinFinalShape` | **Carried** |
| `contributions` and `createRoundRobinContributions()` | **Carried** |
| Default roster agent; streaming-gate and `coerceText` explanation cut | **Carried; the explanation stays cut.** Only the observable facts (plain text, `agentName`, override `block` for structured output) are stated |
| `RosterEntry.block` return contract; which options reach defaults only | **Carried.** The one-time warning is per agent (`coerce:26-33`) |
| `referee` option (corrected by pass 5) | **Carried.** 'Stashes in outer state' stays cut |
| `createReferee` scope (corrected by pass 5) | **Carried.** Prompt contents are the five audit targets; the page states what it audits and what it never does, not the prompt text. The 'keeps the role narrow' rationale stays cut |
| `referee` default none | **Carried** |
| Termination options | **Carried** |
| `synthesizer` and `outputSchema` | **Carried** |
| Config table field for field (corrected by pass 5) | **Carried and corrected.** The row states `model` is `string` with `intent/chat` for agents and `intent/synthesize` for the synthesizer: matches code. 16 options (`rr:99-162`), all in the table |
| `RosterEntry` fields | **Carried** |
| Debate's `moderator` moves to Debate's table | **Carried** in section 9 |

### debate

| Row | Verdict |
| --- | --- |
| Round order without a moderator; step names cut | **Carried; names cut** |
| Round order with a moderator | **Carried.** The `forEach` / `dispatchByName` wiring stays cut |
| Turn visibility | **Carried** |
| Transcript entry; audit tasks keyed by `collectionId` | **Carried** |
| `transcript` option | **Carried** |
| Moderator decision fields | **Carried** |
| Moderator tools: `tools`/`uses` forwarded to `createModerator`; calls stream as `tool_output` items | **Corrected, in part dropped.** `createModerator` accepts `tools` and `uses` (carried), but `debate({ tools, uses })` does not forward them to a moderator you pass (0.6). The `tool_output` item name is not pinned by any test or exported doc comment: dropped, not stated |
| What debaters see of a decision (corrected by pass 5) | **Carried.** `dbd:121-135` |
| Round 1 with a moderator | **Corrected.** "full roster or a balanced subset": the prompt says default to the full roster; "balanced subset" is not there. Stated as a prompt default, not a guarantee |
| Moderator validation | **Carried.** Names seen by the moderator (not anonymized); empty `nextSpeakers` with `done: false` rejected; unknown names throw listing available names; duplicates speak twice; `moderatorDecisions` length equals rounds with a moderator |
| Termination order | **Carried** |
| Stance requirements | **Carried.** "default debater prompt forbids concession" is the prompt (`dbd:104`), stated as the default prompt |
| Transcript views | **Carried** |
| Output shape `DebateRawOutput` | **Carried** |
| Debater block override contract | **Carried** |
| Judge override contract | **Corrected.** Output contract carried. The claim that the judge's input is `{ question }` is dropped: it comes from a doc comment, but the judge is composed after the loop, the default judge ignores its input, and no test shows the input. "Judge cannot be false" is stated as a type-level fact only; there is no runtime guard, unlike the moderator |
| Moderator override contract | **Carried.** `moderator: false` throws; hand-rolled moderators declare the shared transcript resource |
| `maxRounds` default 2; above 4 warns; cost grows | **Carried.** "Cost grows with agents x rounds" is not on a code line; it is arithmetic, not stated as a fact on the page |
| Synthesizer | **Carried** |
| Built-in mitigations and settings | **Carried.** Section 9 |
| `debate` config table (corrected by pass 5) | **Carried.** 20 options, all checked (`db:127-199`); `model` default is per block |
| Exported names; `createInitTranscript` / `createRecordArgument` cut | **Carried as stated;** both internals stay cut |

### supervisor

| Row | Verdict |
| --- | --- |
| Stages of a run; step names and seeding detail cut | **Carried; names stay cut.** Stages: plan, drain, label failures, synthesize |
| Per-task review chain; tap and map names cut | **Carried; names cut** |
| Worker input fields (corrected by pass 5) | **Carried.** Section 2.4, wider than the row (the full `TaskWorkerInput`) |
| Reviewer input fields; verdict fields; "feedback is required on both" (corrected by pass 5) | **Corrected.** Fields carried. "Feedback required" is wrong against the schema: optional, with a fallback message (0.7). `reviewer: false` carried |
| `maxAttemptsPerTask` 3; failure-label table; a throwing worker spends the same budget | **Carried.** The "same budget" half is [source] (shared fail path) |
| One config table | **Carried.** All 21 option names in the row are in code (`sv:69-` config); `worker`/`workers` count as two fields, 22 in all. The row already includes the three cap options. `maxConcurrency` default 3 |
| `onSubTaskError` row | **Carried.** 2.2 |
| Output and synthesizer input shapes | **Carried** |

### planAndExecute

| Row | Verdict |
| --- | --- |
| Pattern state shape; collection-lifetime wording cut | **Carried; the wording stays cut** |
| Input shape row | **Carried** |
| Output status to substrate status mapping | **Corrected.** Every `cancelled` task maps to `skipped`; the row implies only those labelled `skipped` |
| "No row. Design defense and cross-pattern contrast; cut." | **Carried as cut** |
| Default step executor output shape and failure rule | **Carried** |
| Custom executor input shape | **Carried.** `dependencyResults` omitted when empty |
| `taskContext` modes | **Carried.** 2.3. "Cost of each" has no code cite and is not stated |
| Replan path | **Carried** as [doc]-grade (2.3); replan code path is `gsl` plus `pae:228-238` |
| `synthesizeGoal` | **Carried** |
| `plannerVisibility` ignored (corrected by pass 5) | **Carried as "no effect"** (0.5) |
| Export list | **Carried** as a link to the generated section |
| Output shape with `synthesizer: false` (corrected by pass 5) | **Carried.** Section 5; `status` and per-task statuses verified, with the pass-through of `blocked` and `parked` added |

### responseAuditor

| Row | Verdict |
| --- | --- |
| Config: `analyzers`, `threshold` 0.3, `maxConcurrency` | **Carried.** `displayMode` and `alwaysRun` added as no-effect fields (0.5) |
| Failure behaviour | **Carried** |
| Output shape; surfacing rule; `overallScore` computation | **Carried.** The surfacing test is `>=` (0.8) |
| Emitted item; key; append-only | **Carried** |
| `AnalyzerResult` fields; annotation fields and severities; analyzer input | **Carried** |
| `shouldSurface` forces surfacing; `supplementary` | **Carried** |
| `biasAnalyzer` input `aiResponse`, output, adapter mapping | **Carried with a package note** (10.1): not in `@flow-state-dev/patterns` |
| `biasAnalyzer` three model calls plus two deterministic steps; step names cut | **Carried; step names cut.** Counterpoint call is the conditional one |
| `biasAnalyzer` six bias types | **Carried** |
| Exports table for the response-auditor entry point | **Carried** as names and kinds |
| `captureContext`, `aggregateResults`, `applyThreshold(n)` | **Carried.** `captureContext` writes state and returns nothing |

### goalSeekLoop and cross-pattern

| Row | Verdict |
| --- | --- |
| `maxIterations` required, positive integer, counts drains, termination item `max-iterations`, `finalize` runs | **Carried** |
| `taskBoard` `maxIterations` (10,000) versus the loop's | **Carried** |
| `onError`: judge throws, malformed verdict, `replan` with no tasks and no `replanner` give `judge-error` and still run `finalize`; `fail` propagates; `seed` and drain failures always propagate | **Carried** |
| `mapToVerdict` | **Carried.** The default-reason strings are `converged`, `continue`, `replan` |
| Refusal: sequencer- or factory-backed board | **Carried** |
| Refusal: `mode: "delegation"` | **Carried** |
| Refusal: `maxIterations > 1` with an id-less `initialTask` | **Carried** |
| Not-supported list | **Carried** |
| "Patterns: which patterns run a task board, config table per pattern" | **Carried.** 1.2 |

## 14. Counts the page must get right

- Patterns on the page: 8 (`parallelTasks`, `planAndExecute`, `supervisor`, `routedSpecialists`, `eventActors`, `roundRobin`, `debate`, `responseAuditor`) plus `goalSeekLoop`.
- Config option counts: `parallelTasks` 10, `supervisor` 22 (counting `worker` and `workers` separately), `planAndExecute` 29, `routedSpecialists` 16, `eventActors` 8, `roundRobin` 16, `debate` 20 (+ `DebaterConfig` 4), `responseAuditor` 5 (3 effective), `goalSeekLoop` 14. Counted from the config interfaces: `pt:27-83`, `sv:69-`, `pae:98-226`, `rs:78-164`, `ea:166-206`, `rr:99-162`, `db:127-199`, `ras:59-70`, `gsl:107-185`.
- Default `maxRounds`: `roundRobin` 5, `debate` 2.
- Default concurrency: `parallelTasks` 3, `supervisor` 3, `planAndExecute` 1, `eventActors` 4, `taskBoard` 4.
- Default `maxIterations`: `routedSpecialists` 10 (loop-backs), `planAndExecute` 3, `taskBoard` 10,000, `goalSeekLoop` none (required).

## 15. Pass 3 decisions: carried rows the draft drops or changes

- Dropped: `debate-moderator` claim that tool calls stream as `tool_output` items (not pinned by a test or exported doc comment, 13). Dropped: judge input `{ question }` (13). Dropped: "or a balanced subset" for round 1 (13). Dropped: `createInitTranscript`, `createRecordArgument`, `createInitTranscript` listing as internals (13). Dropped: step names and the `wakeOn` sentence (13).
- Dropped: "cost of each" `taskContext` mode and "cost grows with agents x rounds" (no code cite, 13).
- Dropped as not a fact to state: the counted lists of exports in `planAndExecute` (linked to the generated API section instead, per the R-41 row).
- Changed from the carried rows: `maxIterations` on `routedSpecialists` is loop-backs (0.2); `concurrency` default 4 (0.3); `planAndExecute` `model` per block (0.4); `plannerVisibility`, `responseAuditor.displayMode` and `alwaysRun` listed with "No effect" (0.5); `moderator` has no default (0.6); supervisor `feedback` optional (0.7); threshold `>=` (0.8).
- `eventActors` `rb-entry` item container component `evented-actors` and the `routedSpecialists` container component are not stated on the page (no reader lookup needs them).
- The `biasAnalyzer` section is kept (10.1), as a short list under `responseAuditor`.
- Links written to R-24 and R-08 use `./task-collections.md` and `./resources.md`.


## 10. Revise round 1: what changed on the page

The page was cut to what a caller observes; the rows below are no longer on it. Where a fact moved, the destination Reference page owns it, and the fact stays on this sheet for that page's own fact sheet.

**Removed as implementation** (cut, not moved): the `routedSpecialists` run-order line; the supervisor "four stages" sentence; the `plannerVisibility`, `displayMode` and `alwaysRun` rows (no effect); the prompt headings `Referee critiques so far:`, `Briefing from the moderator:`, `Focus for this round:`; the default debater's "hold position" prompt, the default moderator's roster prompt, the referee's audit list and the default roster agent's prompt contents; the `eventActors` concurrency note "a larger value is accepted"; the `judge: false` runtime remark (the page says only that it is a type error; what an untyped caller sees was not observed); "not supported" design-vocabulary on `goalSeekLoop`.

**Moved to Task board (R-23)**: sections 2.1 task caps (defaults, `null`, whole-plan refusal, `retry-budget-exhausted`, the positive-integer rule in 2.1); claim order, `onError` and concurrency defaults of each pattern's board (1.2 and 4 to 7); dependents of a failed or cancelled task are cancelled and read `skipped`; a cancelled or completed task keeps its status when a later failure is written; `taskBoard`'s `maxIterations` (per-worker claim cap, default 10,000, at least 1) against `goalSeekLoop`'s (total drains); `waiting-on-a-user` and `waiting-on-an-event` stop reasons spend no iteration and skip judge, replan and `finalize`.

**Moved to Task collections (R-24)**: the `TaskWorkerInput` field table (2.4) and what a newly started task knows (`priorWork`, `deps`, `feedback`, `steers`, `followUpOf`, `sealed`); the audit-task record fields written by `routedSpecialists`, `roundRobin`, `debate`, `eventActors` (`metadata.reasoning`, `metadata.iteration`, `metadata.round`, `metadata { round, stance }`, `metadata { depth, type, topic }`); task-collection owner, client visibility and counts for iteration, actor, audit and board tasks (section 11 rows).

**Moved to Items (R-06)**, with the payloads and keys the page no longer states: `routedSpecialists` `{ state, iteration, specialist, done }`, key the pattern `name`; `rb-entry` `{ type, topic, body }`, key `entry-<n>`; `debate-turn-pending` `{ round, agentName, stance }`, no key; `debate-turn` `{ round, agentName, stance, text }`, key `turn-<round>-<agentName>-<n>`; `debate-decision`, key `decision-<round>`; `debate-verdict` `{ verdict, winner, reasoning }`, key `verdict`; `audit-annotation` `{ results, surfacedResults, overallScore }`, no key; all `{ client: true, history: false }`. The visibility flags (`client`, `history`) are already on the Items page.

**Moved to Resources (R-08)**: owner, client exposure and count of the workspace, entry log, contributions and transcript resources (section 11 rows). The page keeps accessor keys, `client.expose: ["entries"]` and each resource's reset rule.

**Moved to Models (R-21)**: the meaning of `intent/chat`, `intent/synthesize` and `intent/utility`, and that a `model` option overrides them.

**Moved to the generated API**: export lists for `@flow-state-dev/patterns/event-actors`, `/debate` and `/response-auditor`. One behaviour stays on the page: `captureContext` and `createAppendEntry` return nothing, so compose them with `.tap()`.

**Corrected** (round 1): `errored`, not `failed`, is the board status of a failing task (`failed` is only `planAndExecute`'s output word, `paey:34-39`); `planAndExecute`'s step executor receives `{ stepId, goal, context?, dependencyResults? }`, never a `TaskWorkerInput`; replanned tasks get the goal copied in unless `taskContext` is `false`; the `eventActors` budget unit; the two `routedSpecialists` no-task cases differ; `?` in a topic pattern is a quantifier; `debate-turn` has a key; the accessor of the entry log is `eventedActors` (the pattern is `eventActors`; the code's resource key is `eventedActors`, `ea:243`).

**Revise round 3.** Topic patterns: an unescaped `?` becomes a regex quantifier, so `slacks?` matches `slack` and `slacks` (`eam:30-40`, only `.+^${}()|[]\` are escaped); the page states the behaviour and a table row. A duplicate entry dispatches its actors whether passed to `emit` or re-emitted (`ea:383-385`, `ea:315-320`). The `contributions` and `transcript` resources are made one per call unless passed. The entry-log accessor is `eventedActors` (`ea:243`), confirmed; the page marks the spelling as differing from the pattern name.

# Facts for Patterns (K-19, catalog)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec is cited. Paths are from the repo root.

Legend: **[page]** the page states it. **[ref]** belongs on a pattern's own page or a Reference page; the chooser links, does not state it. **[gap]** nothing citable exists; the page must not assert it. **[fix]** the page it replaces says something the code contradicts; do not carry it forward.

Abbreviations: `pi` = `packages/patterns/src/index.ts` · `pp` = `packages/patterns/package.json` · `po` = `apps/docs/docs/patterns/overview.md` (the page this one replaces, with the merged guide) · `pg` = `apps/docs/guides/choosing-patterns-with-benchmarks.md` · `ptd` = `apps/docs/docs/patterns/parallelTasks.md` · `bm` = `packages/testing/src/benchmark` · `br` = `packages/patterns/src/benchmark/registry.ts` · `fb` = `packages/fsdev/src/commands/benchmark.ts` · `fr` = `packages/fsdev/README.md` · `pb` = `apps/pattern-benchmark` · `ct` = `packages/core/src/types/flow.ts`. Pattern sources are `packages/patterns/src/<dir>/index.ts` and are written `<dir>:<line>`.

## Flags against the page plan (read first)

1. **The plan says "eight" and the sibling set is nine.** The `catalog/patterns/` folder holds nine pages: the eight patterns below plus `goal-seek-loop`. `goalSeekLoop` is not exported by `@flow-state-dev/patterns` (the root has no such name, `pi:1-113`; `parallelTasks` is described as expressed on it, `parallelTasks:7-10`, and its import is `@flow-state-dev/orchestration/task-board`, `parallelTasks:20`). So the table of eight is the eight factories in `@flow-state-dev/patterns`, and `goalSeekLoop` is a link beside the table, not a row. **[page]** (one link, no explanation). Escalate if the plan meant nine rows.
2. **The page it replaces names two patterns that do not exist under those names.** `po:61` ("Blackboard") and `po:67` ("Reactive Blackboard"). The exported factories are `routedSpecialists` (`routedSpecialists:351`) and `eventActors` (`eventActors:221`). Use the factory names. **[fix]**
3. **The page it replaces describes Round Robin wrongly.** `po:63`: "After each round a judge decides whether to keep going." In code the optional `referee` "does NOT control termination"; the loop ends at `maxRounds` (default 5) or when `terminateWhen(ctx)` returns true. `round-robin:129-134`, `round-robin:105`, `round-robin:111-115`, `round-robin:175`; test `packages/patterns/test/round-robin.test.ts:67`, `:92`, `:116`, `:162`. **[fix]**
4. **The guide it merges has four import and naming errors.** Against code:
   - `defaultBenchmarkRegistry` is imported from `@flow-state-dev/patterns/benchmark`, not the root. `pp:67-70` (subpath export), `packages/patterns/src/benchmark/index.ts:16`, `pb/src/benchmark.ts:14`. The root has no such name (`pi:1-113`). Guide: `pg:69`. **[fix]**
   - `defineBenchmark` and `BenchmarkTask` come from `@flow-state-dev/testing/benchmark`. `packages/testing/src/index.ts:82` (comment: the harness is on that subpath), `bm/index.ts:128`, `bm/index.ts:141-148`, `pb/src/benchmark.ts:13`. `@flow-state-dev/core` does not export `BenchmarkTask` (a search of `packages/core/src` finds the name in no file). Guide: `pg:27`, `pg:68`; `apps/docs/docs/testing/benchmarks.md` has the same two imports. **[fix]**
   - The category list. The guide says four categories including `tool-use` (`pg:19`). Code names `reasoning`, `multi-step-research`, `critique-revision`, `planning`, and accepts any other string. `bm/contract.ts:23-29`. The shipped suite has 12 tasks, three in each of those four. `pb/src/tasks.ts` (12 `id:` entries; 3 each of `reasoning`, `multi-step-research`, `critique-revision`, `planning`). **[fix]**
   - The ranking table has two more columns than the guide lists. `pg:129` lists subject, mean, delta, `credible`, success. Code adds `rank`, `$/task` and `score/$`. `bm/report.ts:266`. **[fix]**
5. **`responseAuditor` is not on the package root.** Import it from `@flow-state-dev/patterns/response-auditor` (`pp:47-50`; `apps/kitchen-sink/flows/chat-agent/run/bias-check.ts:11`). The root exports `parallelTasks`, `planAndExecute`, `supervisor`, `routedSpecialists`, `eventActors`, `roundRobin`, `debate` only (`pi:2`, `:11`, `:36`, `:55`, `:63`, `:81`, `:100`). Every pattern except the root's seven also has its own kebab-case subpath (`pp:35-62`). The table's import column needs one rule: the root, or the subpath. **[page]**
6. **Two of the eight cannot be benchmarked with `fsdev benchmark`.** The default registry has six entries, and its header says `event-actors` and `response-auditor` are not `goal -> answer` shaped. `br:14-16`, `br:29-40`; test `packages/patterns/test/benchmark-adapters.test.ts:65` ("registry exposes exactly the six v1 patterns"). **[page]** (one sentence, in Measure)
7. **Stored data.** The page stores nothing and names no stored part, so the four questions do not apply to it. Each pattern that keeps a list or a workspace answers them on its own page. A chooser needs none of that. **[ref]**

## 1. What a pattern is

- 1.1 A pattern is a factory function that returns a block. `parallelTasks(config)` returns `SequencerDefinition`. `parallelTasks:90-92`; `supervisor:272`; `planAndExecute`'s signature returns `SequencerDefinition<any, any>`, `plan-and-execute:607-609`; `roundRobin:169-171`; `debate:206-208`; `routedSpecialists:351`. **[page]**
- 1.2 `eventActors(config)` returns a handle, not a block (the page says so in one sentence after the tables; every other pattern returns the block): `{ emit, workspace, actors }`. The block is `handle.emit`. `eventActors:221`, handle interface `eventActors:208-216` (the `EventActorsHandle` doc: "emit: Sequencer block", "workspace: Declare on your flow's `resources`"). **[page]** (the table row says "use `.emit`")
- 1.3 `responseAuditor(config)` returns a sequencer built to attach with `.sideChain()` after a generator; the answer streams first and the audit follows. `response-auditor:4-11`, `:171-186`, `:188`. It is not a step that produces the answer. **[page]**
- 1.4 A pattern block "is composable": it works as a `.step()` in another sequencer. Test `packages/patterns/test/parallelTasks.test.ts:259` ("works as a .step() step in another sequencer"), supervisor `supervisor.test.ts:379`. **[page]**
- 1.5 Three of the patterns (`parallelTasks`, `supervisor`, `planAndExecute`) and `eventActors` are built on a task board, a stored list of tasks and the loop that works through it. `parallelTasks:131-133` (`taskBoard({ ..., collection: { collectionId: name } })`), `supervisor:376-377`, `plan-and-execute:715-716`, `eventActors:444-445`. `routedSpecialists`, `roundRobin` and `debate` each record per-turn records in a task collection too (`routedSpecialists:6-9` "Per-iteration records live in a `TaskCollection`"; `round-robin:150` and `debate:198`, config `collectionId`, "Stable id for the audit `TaskCollection`"). **[ref]** The chooser says only: several run on a board, and links to Tasks and boards (C-21). Do not state which.
- 1.6 Config shared by the board patterns: `maxTotalTasks`, `maxEnqueuedTasks`, `maxTotalRetries`, forwarded from each pattern's config. `parallelTasks:46-79`, `supervisor:90-122`, `plan-and-execute:170-189`; `packages/patterns/README.md:34-56`. **[ref]** Not in the chooser.
- 1.7 Every pattern with a model-calling default takes `model`, and most take `uses`, `context`, `instructions`. Defaults are named per page. **[ref]**
- 1.8 `goalSeekLoop`: the sibling page covers it. **[page]** (one link)

## 2. The table of eight: one row per pattern

Columns the page can fill: what it does in a clause, what you pass, what you get, the import. The "pick this when" is the decision the reader makes. Each row below gives the facts a cell may use.

### 2.1 `parallelTasks` — split once, run side by side, combine

- Input `{ goal: string }`. `packages/patterns/src/parallelTasks/schemas.ts:9-11`. **[page]**
- Needs `name` and `worker`. `parallelTasks:29-33`. **[page]**
- Decomposes the goal into sub-tasks, runs the worker on each, then combines the completed outputs. One pass, no review, no loop. `parallelTasks:3-6`; `po:53`. **[page]**
- `maxConcurrency` default 3. `parallelTasks:96`. `onSubTaskError` default `"skip"`: failed sub-tasks are left out and the rest are combined; `"fail"` aborts. `parallelTasks:99`, `:74-79` (doc on the option), tests `parallelTasks.test.ts:198`, `:232`. **[ref]** (the chooser can say "failures are skipped by default"; the option is a row elsewhere)
- Default planner is `utility.decomposer()`, default synthesizer `utility.combiner()`. `parallelTasks:66-72`, `:122-127`. Overridable with `planner`, `synthesizer`. **[ref]**
- Pick when: the pieces do not depend on each other and you trust the worker. `po:53`. **[page]**
- Import: root. `pi:2`. Page: `./parallel-tasks.md`.

### 2.2 `supervisor` — run side by side, review each result, retry the rejected

- Input `{ goal: string }`. `packages/patterns/src/supervisor/schemas.ts:11-13`. **[page]**
- Needs `name` and one of `worker` or `workers` (a record keyed by assignee). `supervisor:70-76`. **[page]**
- Each task goes worker, then reviewer, then an approve/reject decision; a rejected result is re-run with the reviewer's feedback until the retry budget runs out. `supervisor:2-9`; tests `supervisor.test.ts:404` (approve first time), `:432` (reject then complete on attempt 2), `:473` (retries exhausted: task `errored`, label `failed-review`, siblings continue). **[page]**
- `maxAttemptsPerTask` default 3. `supervisor:280`. `maxConcurrency` default 3. `supervisor:281`. `reviewCriteria?: string[]` is the list the default reviewer checks against. `supervisor:78`. **[page]** (criteria are the question-1 answer: "each result needs a review before it counts")
- `reviewer: false` turns per-task review off. `supervisor:113`, `:318`. **[ref]**
- A reviewer verdict is `approve`, `reject` or `needs-revision`. default reviewer prompt `supervisor:166-172`; `reviewerVerdictSchema` exported `pi:39`. **[ref]**
- Question 1 ("each result needs a review before it counts: which pattern?"): `supervisor`. **[page]**
- Import: root. `pi:36`. Page: `./supervisor.md`.

### 2.3 `planAndExecute` — plan a task graph, work through it, replan with what came back

- Input `{ goal: string }`. `packages/patterns/src/plan-and-execute/schemas.ts:81-83`. **[page]**
- Needs `name` only; every block has a default. `plan-and-execute:107-113`. **[page]**
- Plans a dependency-ordered set of tasks, then works through them. Default `maxConcurrency` is 1, so tasks run one at a time; raise it to run independent steps together. `plan-and-execute:615`, doc `:161-165`. Tests `plan-and-execute.test.ts:182` ("respects dependency ordering"), `:219` (failed step recorded, run continues). **[page]**
- Replanning is off unless you turn it on. `enableReplanning` default `false`: with it off, the pattern runs the seeded tasks once and completes. With `true`, an evaluator reads the results after each pass and may return `continue`, `complete` or `replan`; on `replan` a replanner adds tasks and the board drains again. `plan-and-execute:134`, `:613`; `blocks/evaluate-progress.ts:1-24`, `:230`. Tests `plan-and-execute.test.ts:438` ("uses LLM evaluator when enableReplanning is true"), `:562` (re-enters the board across iterations with new tasks each time), `:643` (evaluator returning `complete` exits early). **[page]**
- `maxIterations` default 3 caps the replan loop. `plan-and-execute:131`, `:612`; test `:534` ("forces completion when maxIterations is reached"). **[ref]**
- `maxAttemptsPerTask` default 1, so a failed step is not retried unless you raise it. `plan-and-execute:157`, `:614`. **[ref]**
- Question 2 ("the plan should change as results come in: which?"): `planAndExecute` with `enableReplanning: true`. **[page]**
- Import: root. `pi:11`. Page: `./plan-and-execute.md`.

### 2.4 `routedSpecialists` — a controller picks the next specialist over a shared workspace

- Needs `name`, `workspace` (from `createWorkspace(stateSchema)`), and `specialists` (record of blocks, at least one). `routedSpecialists:78-96`; test `routedSpecialists.test.ts:276` (throws with no specialists). **[page]**
- Each turn the controller reads the workspace and returns `{ specialist, done, reasoning }`; the chosen specialist runs, writes to the workspace, and the loop goes again until `done`. `routedSpecialists:1-30`, `:104-111`; `controllerOutputSchema` `routedSpecialists/schemas.ts:96-100`. Test `routedSpecialists.test.ts:90`, `:115`. **[page]**
- `maxIterations` default 10 stops a controller that never says done. `routedSpecialists:114`, `:354`; test `:245`. **[ref]**
- A specialist that throws is rescued and the loop goes on. Test `routedSpecialists.test.ts:213`. **[ref]**
- Pick when: you do not know the order of work in advance and a model should choose the next step from what has been written so far. Derived from the controller loop above. **[page]**
- Import: root has `routedSpecialists` and `createWorkspace` (`pi:55-58`); also subpath `@flow-state-dev/patterns/routed-specialists` (`pp:43-46`). Page: `./routed-specialists.md`.

### 2.5 `roundRobin` — a fixed roster takes turns, in order, for a set number of rounds

- Input `{ goal: string }`. `round-robin/schemas.ts:13-15`. **[page]**
- Needs `name` and `roster`, an array of `{ name, role?, block? }` with unique names; an empty roster or a duplicate name throws at build time. `round-robin:78-96` (`RosterEntry`), `:186-198` (checks). **[page]**
- Every agent speaks once per round, in the declared order, seeing what came before. Ends at `maxRounds` (default 5) or when `terminateWhen(ctx)` returns true. `round-robin:1-8`, `:105`, `:111-115`, `:175`. **[page]**
- An optional `referee` critiques each round and later rounds read the critique. It does not decide when to stop. `round-robin:129-134`. **[page]**
- A synthesizer runs last by default; `synthesizer: false` returns the raw transcript shape. `round-robin:135`, header `:6-8`. **[ref]**
- Pick when: the roster and the order are part of the design (editorial review, a panel of perspectives). Derived from the above. **[page]**
- Import: root. `pi:81`. Page: `./round-robin.md`.

### 2.6 `debate` — agents argue assigned stances, a judge decides once at the end

- Input `{ question: string }`. `debate/schemas.ts:14-16`. **[page]**
- Needs `name` and `debaters`, at least two, each `{ name, stance, role?, block? }` with a unique name; `stance` is required. `debate:103-130`, check `:227-229`; throws "debaters must contain at least 2 entries". **[page]**
- Debaters speak each round in declared order; `maxRounds` default 2. A single judge runs once after the last round and returns `{ verdict, winner, reasoning }`. `debate:1-12`, `:132`, `:212`, `:139`; test `debate.test.ts:153` ("runs the judge exactly once at the end"). **[page]**
- An optional `moderator` opens each round, picks who speaks and may end the debate early. `debate:154`, doc `:141-153`. **[ref]**
- The judge sees the transcript with debater names removed and arguments shuffled within each round; both are on by default. `anonymizeTranscript` and `shuffleForJudge` default `true`. `debate:221-222`; test `debate.test.ts:565`. **[ref]**
- A judge is required: `judge?: false` is not allowed. `debate:136-137`. **[ref]**
- Pick when: the answer has real trade-offs and you want the disagreement and a verdict, not an average. Derived. **[page]**
- Import: root. `pi:100`. Page: `./debate.md`.

### 2.7 `eventActors` — actors react to the topics they watch, with no controller

- Needs `name`, `workspace` (from `createEventActorsWorkspace({ name, entries })`) and `actors` (at least one). `eventActors:166-181`, workspace `:141-163`. **[page]**
- An actor is `actor({ name, watch, block })`; `watch` is a list of glob patterns over `type:topic`, `*` matches one segment and `**` any number; at least one pattern is required, else it throws. `eventActors:106-138`; tests `eventActors.test.ts:18-35`. **[page]**
- Emit an entry with `handle.emit` and every actor whose pattern matches runs, concurrently, on that entry. `eventActors:3-14`, `:183-208`. `concurrency` default 4. `eventActors:230`. **[page]**
- `reEmit: true` appends an actor's output back as a new entry when it has the entry shape `{ type, topic, body }`, so actors can trigger actors; `maxDepth` default 3 caps the chain. `eventActors:183-195`, `:232`. **[ref]**
- The entry log is a session-scoped writable resource that exposes `entries` to clients. `eventActors/schemas.ts:22-30`. **[ref]**
- Pick when: work is triggered by events or broadcast and no step knows which comes next. Derived. **[page]**
- Import: root. `pi:63-77`; subpath `./event-actors` (`pp:51-54`). Page: `./event-actors.md`.

### 2.8 `responseAuditor` — score and annotate a finished answer

- Input `{ userInput: string, response: string }`. `response-auditor/schemas.ts:32-35`. **[page]**
- Needs `analyzers`, an array of blocks that each take `{ userInput, response }` and return an `AnalyzerResult`. `response-auditor/schemas.ts:61`. **[page]**
- Runs every analyzer at once on the finished response; a score at or above `threshold` (default 0.3) surfaces as an annotation. `maxConcurrency` limits how many run at once (default: all). `response-auditor/schemas.ts:63`, `:69`; `response-auditor:188-189`; tests `response-auditor.test.ts:132`, `:156`. **[page]**
- An analyzer that throws is dropped; the others still report. `response-auditor:193-197`; test `response-auditor.test.ts:220`. **[ref]**
- It does not change the response. It is attached with `.sideChain()`, so the answer streams without waiting. `response-auditor:4-11`, `:171-186`. **[page]**
- Pick when: you want an answer checked for bias, tone, policy and similar after it is written, without holding it back. `po:59`. **[page]**
- Import: subpath only, `@flow-state-dev/patterns/response-auditor`. `pp:47-50`. Page: `./response-auditor.md`.
- Example that uses it: `apps/kitchen-sink/flows/chat-agent/run/bias-check.ts:55-58` (`responseAuditor({ analyzers: [...], threshold: 0.3 })`).

## 3. The two questions the table answers by contrast

- Parallel Tasks and Supervisor share fan-out; the difference is the per-task review. `po:53-55`; code `supervisor:2-9` vs `parallelTasks:3-6`. **[page]**
- Plan and Execute differs from both: tasks may depend on each other, run one at a time by default, and can replan. `po:57`; code `plan-and-execute:615`, `:613`. **[page]**
- A supervisor can be the step executor of a plan: `po:97` ("Plan and Execute with a Supervisor as the `stepExecutor`"). `stepExecutor` is a `BlockDefinition` (`plan-and-execute:122`), and a `supervisor` is a block (1.1), so the types allow it. No test or example composes the two. **[gap]** as a claim that it works; the page must not recommend it.
- "A Parallel Tasks and a Supervisor accept a custom `planner`": `planner?` exists on `parallelTasks:66`, `supervisor:111` and `planAndExecute:114`. Existing page `po:99`. **[ref]**

## 4. One pattern used as an action's block

An action is an entry in `defineFlow({ actions })`; it is either a bare block or an object `{ block, inputSchema?, userMessage?, description?, ... }`. `ct:292-298` (`ActionEntry`: "the block alone, or the object form"), `ct:190-252` (`ActionCore`). `inputSchema` defaults to the block's own. `ct:202-209`. `userMessage(input)` writes the input as a user message item at the start of the request. `ct:213-219`. **[page]**

The existing page's action example, which the page may adapt with its own names: `ptd:56-72`:

```ts
const flow = defineFlow({
  kind: "research",
  requireUser: true,
  actions: {
    research: {
      inputSchema: z.object({ goal: z.string() }),
      block: researchBlock,
      userMessage: (input) => input.goal,
    },
  },
  session: { stateSchema: z.object({}) },
});
```

- `defineFlow` signature: `packages/core/src/flow/defineFlow.ts:1624`. `kind` is required (`ct:562`). `requireUser` defaults to true (`ct:603-606`), so an example may leave it out; `requireUser: false` is an explicit opt-out (`defineFlow.ts:1280-1294`). **[page]**
- Because the supervisor's input is `{ goal: string }`, an action with a bare `block: digestTickets` takes `{ goal }` with no `inputSchema` needed. Derived from `supervisor/schemas.ts:11-13` and `ct:202-209`. **[page]**
- Proposed example for the page (one pattern, question 1's answer): a `supervisor` over a ticket summarizer, as the block of one action. Names follow the sibling Supervisor page: `src/flows/digest/blocks/summarize-ticket.ts` exports `summarizeTicket`; `src/flows/digest/blocks/digest-tickets.ts` exports `digestTickets = supervisor({ name: "digest", worker: summarizeTicket, reviewCriteria: [...], maxAttemptsPerTask: 3 })` (`docs/contributing/docs-revamp/pages/catalog/patterns/supervisor.md`, the "Use it" section). The flow file imports `digestTickets` and puts it in `actions`. **[page]** Write the flow with `defineFlow`'s required fields as in the snippet above; type-check it against `packages/core/src/flow/defineFlow.ts` and `packages/patterns`.
- The page may say the pattern is a block, so it goes where any block goes: an action, a `.step()`, a router route. 1.4; `ct:292-298`. **[page]**

## 5. Measure on your own tasks

Everything here is from code or the CLI README; the guide's prose it replaces is flagged in section "Flags" item 4.

- 5.1 `fsdev benchmark <file>` loads a `defineBenchmark(...)` file, runs each named pattern plus a single-generator baseline over the same tasks on the same model, and prints a scorecard. `fr:347-351`; `fb:251-257`. **[page]**
- 5.2 One variable changes: the pattern. The task suite and the executor model are held fixed. `pb/README.md` "What it measures"; `fr:349`. **[page]**
- 5.3 A task is `{ id, category, prompt, rubric: string[] }`; `rubric` is the list of criteria the judge scores each output against; `expected` and `metadata` are optional. `bm/contract.ts:36-49`. **[page]**
- 5.4 `defineBenchmark({ name, patterns, registry, baseline, tasks, model, judgeModel, runs })`. `model` and `tasks` are required; `tasks` must be non-empty or it throws "must define at least one task". `bm/types.ts:163-198`, `bm/index.ts:128-135`. `baseline` appends the single-generator control; the default is on at run time. `bm/types.ts:176-177`. `runs` default 3. `bm/runBenchmark.ts:86`. **[page]**
- 5.5 `patterns` are names resolved against `registry`. The default registry's six names: `supervisor`, `plan-and-execute`, `parallel-tasks`, `round-robin`, `debate`, `routed-specialists`. `br:29-40`. Note the hyphenated names differ from the factory names. **[page]**
- 5.6 Judge: a separate model scores every output against the task's rubric, blind to which pattern produced it. Same model for judge and executor produces a warning. `pb/README.md` "How it scores honestly"; `bm/runBenchmark.ts:99`. **[page]**
- 5.7 The shipped suite at `apps/pattern-benchmark` has 12 tasks, three in each of four categories, each with a published rubric; it is a template to copy. `pb/src/tasks.ts`; `pb/README.md`. Its definition: `pb/src/benchmark.ts:17-47` (model `openai/gpt-6-luna`, judge `anthropic/claude-haiku-5-5`, `runs: 3`, `disableSearch: true`). **[page]**
- 5.8 Run: `fsdev benchmark ./benchmark.ts --max-cost 0.50 --format markdown`. Flags: `-m/--model`, `--judge-model`, `--runs`, `--concurrency`, `--category`, `--patterns` (comma list), `--baseline-model` (repeatable), `--no-baseline`, `--max-cost <usd>`, `--output <path>`, `--format table|markdown|json` (default `table`). `fr:377-389`; `fb:251-257`. **[page]** (name two or three; the rest are Reference)
- 5.9 Credentials come from the environment: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`. `fr:351`. **[page]**
- 5.10 Past `--max-cost` the sweep stops, prints a partial scorecard and exits non-zero (exit code 1). `fr:391`; `fb:270` (`budgetExceeded` sets `EXIT_EXECUTION_ERROR`). **[page]**
- 5.11 The table scorecard: subjects in rows, categories plus `overall` in columns, `mean±stddev` per cell. `fr:393-400`. **[page]**
- 5.12 Every format prints an overall ranking: `rank`, `subject`, `mean`, `Δ vs baseline`, `credible`, `success`, `$/task`, `score/$`. `bm/report.ts:266-285`. **[page]** (name the columns the reader needs: delta vs baseline, `credible`, cost)
- 5.13 `credible` is true when the delta from the baseline is more than about two standard errors of the difference of means and both groups have at least 2 runs; otherwise false. A baseline row shows `—`. `bm/report.ts:176-197`, `:281`; `bm/types.ts:96-101`. `credible: false` means the gap could be noise. **[page]**
- 5.14 `--baseline-model` adds a pure single-model baseline on another model, so you can ask whether patterns on a small model beat one big model; other baselines are ranked by their mean and the run model's baseline is the delta reference. `fr:369-373`, `:385`; `bm/types.ts:178-180`; `bm/report.ts:158-167`. **[ref]**
- 5.15 Limits: results describe your tasks and your model, not the patterns in general; every pattern runs on the same single shared generator, which isolates the shape but not a tuned roster. `pb/README.md` "Caveats"; `pg:131-137`. Variance: more `runs` narrows it. **[page]**
- 5.16 Six of the eight are benchmarkable; `eventActors` and `responseAuditor` are not (flag 6). **[page]**
- 5.17 Question 3 ("how do you compare two patterns on your tasks?"): a `defineBenchmark` file naming both in `patterns` and your tasks in `tasks`, run with `fsdev benchmark` and read for `Δ vs baseline` and `credible`. Use `--patterns a,b` to narrow a larger definition. `fr:362`, `:384`; `fb:114-115`. **[page]**
- 5.18 Imports for a benchmark file (corrected): `defineBenchmark`, `BenchmarkTask` from `@flow-state-dev/testing/benchmark`; `defaultBenchmarkRegistry` from `@flow-state-dev/patterns/benchmark`. `pb/src/benchmark.ts:13-14`. `@flow-state-dev/testing` declares `./benchmark` and `@flow-state-dev/patterns` lists `@flow-state-dev/testing` as an optional peer for that entry. `packages/testing/package.json:34-36`; `packages/patterns/src/benchmark/index.ts:5-6`. **[page]**
- 5.19 The `fsdev benchmark` file is a TypeScript module with `export default defineBenchmark(...)`. `pb/src/benchmark.ts:17`; `fr:355`. **[page]**

- 5.20 Page state (round 3): the page now states the import rule (flag 5), the `.sideChain()` attachment (1.3, 2.8), the six registry names (5.5, flag 6) and the `--max-cost` stop with exit code 1 (5.10).

## 6. Build your own

- 6.1 A custom pattern is usually a factory that wraps `taskBoard` and returns a block (not every shipped pattern does: `responseAuditor` has no board, 1.5): plan the work, seed the collection, drain, reduce. `apps/docs/guides/create-your-own-pattern.md:9-13`, `:25-34`. **[ref]** The chooser states the first clause and links to that guide (B-21). It does not walk the skeleton.
- 6.2 The guide's runnable code is `examples/guides/custom-pattern`. `create-your-own-pattern.md:16-18`. **[ref]** (link target for the guide, not for this page)
- 6.3 The guide's example factory is `planMapReduce`. `create-your-own-pattern.md:15`. **[ref]**
- 6.4 A task-board primitive wraps the same pieces: import from `@flow-state-dev/orchestration/task-board`. `packages/patterns/README.md:113-127`; `pi:78-79` ("moved to `@flow-state-dev/orchestration/task-board`"). **[page]** (one link to the board concept, C-21: "when none of the patterns fits, drop to the board")
- 6.5 The page it replaces says to "drop to the task board directly when none of them do". `po:23`. **[page]**

## 7. What the page must not state

- The memory aside (`po:25`), the three-tier "Primitives, utility blocks, patterns" hierarchy (`po:9-33`) and the skills aside (`po:103-107`) belong to other pages; the plan's contents list does not include them. **[ref]**
- Config tables per pattern are Reference (R-xx): one table per pattern, plus `goalSeekLoop`. **[ref]**
- Defaults for the board bounds (`maxEnqueuedTasks` 100, `maxTotalTasks` 500, `maxTotalRetries` 50): `packages/orchestration/src/tasks/collection/task-caps.ts:221-224`, `:243`. **[ref]** Note for the sibling sheets: their sheet for Parallel Tasks (`parallel-tasks.facts.md`, F41) swaps the two creation bounds (it says 500 enqueued, 100 total). The code says 100 enqueued, 500 total.
- A claim that one pattern "wins". Nothing citable ranks patterns in general; the benchmark README says results are scoped to a suite and a model. `pb/README.md` "Caveats". **[gap]** for any ranking sentence.
- How many model calls each pattern makes, or what each costs. No source states it. **[gap]**
- That a pattern is "best for" a domain beyond what its own mechanism shows. Every "Pick when" above is derived from the mechanism and stays in those terms.

## 8. Figure: Eight shapes

A figure of eight small drawings on a shared grid. Facts each drawing can show, each from section 2:

- `parallelTasks`: one goal, N sub-tasks side by side, one combine.
- `supervisor`: the same, with a review after each task and an arrow back to the worker on rejection.
- `planAndExecute`: tasks in dependency order, with a replan arrow after each pass (only with `enableReplanning`).
- `routedSpecialists`: a controller in the centre, a shared workspace, specialists around it, an arrow loop.
- `roundRobin`: a ring, fixed order, rounds.
- `debate`: two stances, rounds, one judge at the end.
- `eventActors`: an entry arrives and fans out to every actor whose watch pattern matches; with `reEmit` an actor's output is a new entry.
- `responseAuditor`: a finished answer with analyzers beside it and an annotation afterwards; the answer is not changed.

Marks (plan): arrow, highlighter on none. `docs/contributing/user-docs.md` (the figure marks table) and `docs/contributing/user-docs-figures.md`. **[page]**

## 9. Cold-read questions this sheet answers (for pass 2)

1. Each result needs review before it counts: `supervisor` (2.2).
2. The plan should change as results come in: `planAndExecute` with `enableReplanning: true` (2.3); off by default.
3. Compare two patterns on your tasks: `defineBenchmark` with both in `patterns`, `fsdev benchmark`, read `Δ vs baseline` and `credible` (5.4, 5.12, 5.13, 5.17).
4. Edge: a pattern that cannot be benchmarked: `eventActors`, `responseAuditor` (flag 6).
5. Edge: a debate where only one debater is configured: throws at build time (2.6).
6. Edge: you set a cost ceiling and it is crossed: partial scorecard, non-zero exit (5.10).
7. Edge: a result with `credible: false`: treat as no measurable difference (5.13).
8. Edge: import `responseAuditor` from the package root: the root does not export it; use the subpath (flag 5).
- The page also shows the worker, `src/flows/digest/blocks/summarize-ticket.ts`, as the same generator the Supervisor page shows (`supervisor.md`, "Use it"), so the supervisor example's import resolves. Type-checked clean with the supervisor and flow examples. **[page]**

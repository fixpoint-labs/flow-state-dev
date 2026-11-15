# Facts for Supervisor (K-21, catalog, pattern page)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, and one example. No spec, issue, changeset, `docs/internal` or `CLAUDE.md` was read. Every surface named here is built, so no fact is a spec's name marked for reconciling.

Paths are from the repo root. Abbreviations:

- `sv` = `packages/patterns/src/supervisor/index.ts`
- `sc` = `packages/patterns/src/supervisor/schemas.ts`
- `rc` = `packages/patterns/src/supervisor/blocks/reviewer-check.ts`
- `lf` = `packages/patterns/src/supervisor/blocks/label-failed-reviews.ts`
- `sy` = `packages/patterns/src/supervisor/blocks/synthesize.ts`
- `pe` = `packages/patterns/src/shared/planning-entry.ts`
- `st` = `packages/patterns/test/supervisor.test.ts`
- `wt` = `packages/orchestration/src/tasks/workers/types.ts` (the worker input contract)
- `ws` = `packages/orchestration/src/task-board/blocks/worker-step.ts`
- `ic` = `packages/orchestration/src/tasks/collection/internal.ts`
- `tc` = `packages/orchestration/src/tasks/collection/task-caps.ts`
- `old` = `apps/docs/docs/patterns/supervisor.md` (the page this one replaces; line numbers are the file's own)
- `rev` = `docs/contributing/docs-revamp/pages/catalog/patterns/supervisor.md` (the cut copy, same text as `old` with a frontmatter block)
- `readme` = `packages/patterns/README.md`

Legend: **[page]** the page states it. **[ref]** it belongs on a Reference page; the page links, does not state it. **[cut]** history or mechanism; never on the page. **[checked]** read against code or a test in this pass. **[code-read]** read in code, no test exercises it; pass 5 should re-read it.

## Flags against the page plan and the existing page (read first)

1. **The existing page contradicts the code on where planner `context` goes.** `old:88` says `input` is "typically the planner's `context` field". The code seeds `context` as its own field of the task and the worker gets it as `context`, separate from `input`: `pe:143-146`, `wt:44-50` (the `context` field and its doc comment), and the test `st:636-675` (worker reads `input.context`, gets `"support text"`). `input` stays unset for a supervisor task (`pe:140`, `inputDefault` defaults `"none"` at `pe:117`). The README repeats the old claim ("stamps that string onto the seeded `TaskInit.input`", `readme:281`); it is wrong too. The page says `context`. **[checked]**
2. **`ReviewerVerdict.criteria` is an array of `{ name, score }`, not a record.** `old:115` shows `Record<string, unknown>`. Code: `sc:62-64`; the test passes an array, `st:540-543`. Do not copy the old type block. **[checked]**
3. **The old page's pipeline diagram names a step that does not exist.** `stampReviewEntered` (`old:34`) is not a block, and the outer pipeline also has a `stampOuterGoal` tap before the planner and an optional goal-synthesis step (`sv:427-438`). The review chain is `.tap(stashTaskId) -> .step(worker) -> .tap(stashWorkerOutput) -> .tap(emitReviewingStatus) -> .map(buildReviewerInput) -> .step(reviewer) -> .step(applyVerdict)`, `rc:199-209`. All of this is **[ref]** or **[cut]**; the page keeps one sentence: each task goes worker, then reviewer, then a decision. **[checked]**
4. **The old page is mostly Reference.** Leaves the page, per `user-docs.md` "What goes to Reference": the config table (`old:181-244`), the exported API list (`old:250-271`), the retry arithmetic (`old:124-128`), the board-wide retry ceiling and creation ceilings (`old:130-140`, `old:199-204`), the failure label table (`old:144-148`), dependency handling (`old:152-162`), `onSubTaskError`, `taskContext`, `synthesizeGoal`. The page keeps the reader's three questions and one example. The sitemap budget is 1,000 words. **[ref]**
5. **Leaks to cut from the old page.** `old:42` BP-011 and "conformant"; `old:42` the "third outcome" paragraph about a task settled while the worker ran; `old:285` "deliberately not built on". Tracker ids appear in the source doc comments (`sv:83`, `sv:93`, `sv:124`), never on the page. **[cut]**
6. **The old page's example does not type-check as a worker.** `old:53-67` declares `inputSchema` with `taskId`, `goal`, `feedback`, and a `user` function over it. That part is fine (a declared schema is a filter, so a worker that declares `feedback` receives it, `wt:30-34`). But it lacks the file title and `import` of the model name convention, and `model: "openai/gpt-6-luna"` is right. The new example must title its blocks and import its own names. **[checked]**
7. **There is no `reviewer` example on the old page.** The sitemap asks for "a reviewer". The old page shows only `reviewCriteria`. A custom reviewer is a block from `ReviewerInput` to `ReviewerVerdict` (`sc:56-68`, `sc:71-79`, test helper `st:80-95`). Candidate example below, section 7. **[checked]**
8. **The default models are intents, not model names.** The default reviewer and synthesizer use `model: "intent/synthesize"` (`sv:159`, `sv:228`). An app that has not mapped that intent cannot run them; see `apps/docs/docs/fundamentals/models.md:200-203` for what the intent is for ("apps should point it at JSON-reliable models"). How an app maps an intent is the Models page's job; the Supervisor page names the intent in one clause and links. **[checked]** What happens at an unmapped intent was not run; do not state it. **[verify]**

## 1. What it is (opening)

- `supervisor` takes a goal, has a planner split it into tasks, runs each task through a worker, has a reviewer judge each result, and has a synthesizer combine the approved results into one output. `sv:3-18`, `sv:433-438`. **[page]** **[checked]**
- The pipeline order is: plan, run the tasks, label the ones that failed review, synthesize. `sv:13-14`, `sv:433-438`. **[page, one sentence]** **[checked]**
- Tasks run side by side up to a pool size, default 3 (`maxConcurrency`). `sv:81-82`, `sv:281`, `sv:384`. A task with `deps` waits for its dependencies. `pe:93-95` (planner shape), `sc:82-93`. **[page]** **[checked]**
- It returns a block, a sequencer, so it composes into a flow like any other. `sv:272-274`, `st:379-400`. **[page, one clause]** **[checked]**
- The input is `{ goal: string }`. `sc:11-13`. **[page]** **[checked]**
- The output is whatever the synthesizer returns. The default synthesizer returns a string, or the shape of `outputSchema` when set. `sv:229`, `sv:115`. **[page]** **[checked]**
- Reach for it when each result needs a quality check and a second attempt before it counts. If no review is wanted, `parallelTasks` is the pattern without one; if tasks must run in a strict order with replanning, `planAndExecute`. `old:9-15`. The neighbours' slugs: `./parallel-tasks.md`, `./plan-and-execute.md`. **[page, one sentence each]**

## 2. Install and use it

- Package `@flow-state-dev/patterns`, version `0.2.2`. `packages/patterns/package.json:3`. **[checked]**
- Install line: `pnpm add @flow-state-dev/patterns`. The README carries no install block in the live copy; the cut copy at `docs/contributing/docs-revamp/readmes/patterns.md:3` opens with one line about the package. **[reconcile]** at cutover with the same flag the other catalog sheets raise. **[verify]** the line itself is not on a cited source.
- Import: `import { supervisor } from "@flow-state-dev/patterns"` (`packages/patterns/src/index.ts:34-46`). The subpath `@flow-state-dev/patterns/supervisor` also resolves (`packages/patterns/package.json:39-42`). **[page, the root import]** **[checked]**
- `name` is required, and one of `worker` or `workers` is required. Neither given throws at construction: `[supervisor] "<name>" requires either \`worker\` or \`workers\``. `sv:70-76`, `sv:292-296`. The message is a Reference row. **[ref]** **[checked]**
- `worker` is a single block every task goes through. `workers` is a registry keyed by assignee; a task goes to the worker matching its `assignee`. `sv:73-76`, `sv:330-350`, `old:164-177`. **[page, `worker` only; `workers` one sentence]** **[checked]**
- A worker is an ordinary block whose input is the task: any block whose input matches `TaskWorkerInput` is a valid worker. `wt:5-9`, `wt:143-148`. **[page]** **[checked]**
- A worker returns its result; it does not write it back. `wt:15-17`. **[page, one clause]** **[checked]**

## 3. Who decides a result is good

- The reviewer decides, one call per finished attempt of a task. By default it is a generator that the pattern builds, named `<name>-reviewer`, using `model: "intent/synthesize"`. `sv:143-177`. **[page]** **[checked]**
- The default reviewer's prompt asks for one of three verdicts: `approve` when the output meets the goal and criteria; `reject` when it must be redone, with actionable feedback; `needs-revision` when it is close and needs targeted fixes, with feedback. `sv:165-173`. **[page]** **[checked]**
- `reviewCriteria` is a list of strings. They reach the default reviewer's prompt as a numbered "Evaluation criteria" list, and they reach any reviewer, default or yours, as `input.criteria`. `sv:151-156`, `sv:142-145` (in `rc`: `rc:142-145`), `st:572-594`. **[page]** **[checked]**
- The reviewer's input is `{ taskId, goal, attempts, workerOutput, criteria? }`. `sc:71-77`. `attempts` is the task's attempt number, 1 on the first. `sc:74`, `rc:137-145`. The reviewer is not given the task's `context` or `input`, nor an earlier attempt's output or feedback. `sc:71-77`, `rc:132-146`. **[page]** **[checked]**
- The reviewer's output is `{ decision, feedback?, criteria?, reasoning? }`, where `decision` is `"approve" | "reject" | "needs-revision"`, `criteria` is a list of `{ name, score }`, and `reasoning` is free text. `sc:56-66`. **[page, decision and feedback; the rest ref]** **[checked]**
- Your own reviewer: pass `reviewer: <block>` from `ReviewerInput` to `ReviewerVerdict`. `sv:112-113`, `sv:317-327`, `st:197-225`. **[page]** **[checked]**
- No review: `reviewer: false`. Every worker output then counts as the task's result with no verdict. `sv:112-113`, `sv:318`, `rc:91` (a wrapped worker is the bare worker when there is no reviewer), `st:322-338` (the tests that use `reviewer: false`). Retries still happen when a worker throws (section 4). **[page, one sentence]** **[checked]**
- `reviewerVisibility` sets which items the default reviewer's output is shown to. Default `{ client: true, history: false }`: the client sees it, the model history does not. `sv:120`, `sv:164`. **[ref]** **[checked]**
- Reviewer call counts: a reviewer runs once for each attempt of each task that reached it. Test: `reject-then-retry` makes two reviewer calls for one task, `st:432-471`. **[checked]**

## 4. How many retries a task gets

- `maxAttemptsPerTask` is the number of times a task may run, first attempt included. Default 3. `sv:79-80`, `sv:280`. **[page]** **[checked]**
- The planner's seed stamps `maxAttempts` on every task from `maxAttemptsPerTask`, unless the planner set `maxAttempts` for that task. `pe:152-157`. **[page, the default and one alternative: the config key]** **[ref, the per-task override]** **[checked]**
- "Attempts" counts claims: it goes to 1 when the task is first claimed. After the first failed attempt `attempts === 1`. A task retries while `attempts < maxAttempts`. So `maxAttemptsPerTask: 3` is three runs in all. `ic:534-554`. **[page, the sentence "three runs in all"]** **[checked]**
- `maxAttemptsPerTask: 1` means no retry: a rejection settles the task. `st:597-633` uses 1; `ic:554` (`attempts - abandonments < maxAttempts`, so `1 < 1` is false after the first run). **[page]** **[checked]**
- A rejection (`reject` or `needs-revision`) makes the task fail the attempt. The two verdicts act the same: both throw the verdict's `feedback`, or `"Reviewer <decision> the task output"` when none is given. `rc:148-171`, `sc:50-55`. **[page, "reject and needs-revision are handled the same"; they differ only in the default reviewer's prompt (`sv:169-170`); retry and label (`lf:53-54`) are identical; page says `needs-revision` = close, `reject` = redo, matching the default reviewer prompt (`sv:169-170`), re-read in round 2]** **[checked]**
- With attempts left, a failed attempt puts the task back to `pending`, and the error text becomes the next attempt's `feedback`. Otherwise the task ends `errored`. `ic:528-554`, `ic:483-484`. **[page]** **[checked]**
- A worker that throws is retried on the same budget, and the thrown message becomes the next attempt's feedback. The page's rejections and a worker's own errors use one counter. `ic:528-535`, `old:142`. No supervisor test throws from a worker with retries left; `st:340-377` uses `maxAttemptsPerTask: 1`. **[page, one sentence]** **[code-read]**
- A reviewer that throws is the same: it fails the attempt, and the task retries while attempts remain. `rc:199-209` (the reviewer is a step in the task's chain, so its error is the chain's error). Only the single-attempt case is tested, `st:597-633`. **[ref]** **[code-read]**
- When the budget is spent, the task ends `errored` and the others carry on. Test: t1 is rejected every time, t2 completes, output counts one result. `st:473-525`. **[page]** **[checked]**
- After the drain, each `errored` task gets one label: `failed-review` when the last verdict was `reject` or `needs-revision`; `reviewer-error` when the task reached review and no verdict was recorded; `worker-error` when it never reached review. `lf:6-13`, `lf:49-58`. Test: `failed-review` `st:473-525`, `reviewer-error` `st:597-633`. **[page, `failed-review` only; the three are a Reference row]** **[checked]**
- A board-wide ceiling also applies: `maxTotalRetries`, default 50, `null` for none, `0` to never retry. At the ceiling, the next task that fails settles `errored` instead of retrying, and the board's completion reports `terminationReason: "retry-budget-exhausted"`. `sv:94-110`, `sv:314`, `tc:243`, `old:130-140`. Because `maxAttemptsPerTask` defaults to 3, a large plan can reach it. **[ref]** with one sentence and a link on the page. **[checked]**
- `maxTotalTasks` (default 500) and `maxEnqueuedTasks` (default 100) bound how many tasks the planner may add; `null` for none. `sv:83-92`, `tc:221-224`. A plan over either is refused whole and the run fails. `old:199-204`. **[ref]** **[checked]**

## 5. What a worker receives on a retry

- Every attempt gets the same fields; a retry differs only in `attempts` and `feedback`. `ws:143-148`. **[page]** **[checked]**
- `attempts` is 1 on the first run, 2 on the first retry. `ic:534-538`, `rc:102`. **[page]** **[checked]**
- `feedback` is absent on the first attempt and holds the previous attempt's failure text on a retry: the reviewer's `feedback` string for a rejection, the thrown message for a worker error. `ws:147` (spread only when set), `ic:483-484`, `st:527-570` (first attempt `undefined`, second `"tighten the second paragraph"`). **[page]** **[checked]**
- `feedback` is only the latest failure. After a second rejection it holds the second verdict's text, not both. `ic:483-484` writes it on each failure. **[page, one clause]** **[code-read]**
- The worker is not given its previous output. `TaskWorkerInput` has no such field: `wt:39-123`. A worker that wants the earlier answer must have it in the feedback, so a reviewer's feedback should say what to keep. **[page]** **[checked]**
- The rest of what a worker receives: `taskId`, `goal`, optional `title`, `context`, `input`, `deps`, `steers`, `metadata`, `priorWork` and others. `wt:39-123`. **[ref]**; the page names `taskId`, `goal`, `context`, `attempts`, `feedback`.
- `deps`: the outputs of the task's completed dependencies, keyed by dependency task id. `wt:60-73`. **[ref]**
- A declared worker `inputSchema` is a filter: a worker only receives the fields its schema declares. So a worker that wants `feedback` must declare it. `wt:30-34`; the old page's example declares `feedback` (`old:57`). **[page]** **[checked]**
- Planner-supplied `context` reaches the worker as `context`. When the planner gave none, the goal is copied into `context` of every task, unless `taskContext` is `false` or a block. `pe:204-226`, `pe:389-395`, `sv:133`, `st:636-675`. **[page, one sentence]** **[ref, the options]** **[checked]**
- The worker's `context` and `input` are fixed at filing; only `attempts` and `feedback` change between attempts. `ws:143-148`; there is no code in the supervisor that rewrites them. **[code-read]**

## 6. What happens to the rest

- The synthesizer gets `{ goal, results, resultItems? }`. `results` is the `output` of every `completed` task, in the board's listing order; `resultItems` is each task's emitted items. A task that ended `errored` or `cancelled` is not in `results`. `sy:157-173`. **[page]** **[checked]**
- The default synthesizer's prompt asks for the final deliverable as one unified piece, and it lists the `source` items workers emitted, deduplicated by URL, when there are any. `sv:220-225`, `sv:186-208`, `sv:259-265`. **[page, one clause]** **[ref, the sources block]** **[checked]**
- `synthesizer` replaces the default; the supervisor's own `outputSchema` option (`sv:115`) shapes the default's output. `sv:114-115`, `sv:360-370`. **[page, one sentence]** **[checked]**
- A failed task does not stop the others. `onSubTaskError: "skip"` is the default; `"fail"` makes the first failed task abort the whole run with an error. `sv:116`, `sv:314-315`, `st:322-377`. **[ref]** with one clause on the page. **[checked]**
- `onSubTaskError: "retry"` is not a value. At runtime it is treated as `"skip"` with a console warning pointing at `maxAttemptsPerTask`. `sv:297-312`. **[ref]** **[checked]**
- When a task ends `errored` or `cancelled`, every task that depends on it is cancelled with the label `skipped`. `sv:16-17`, `sv:372-374`, `packages/orchestration/src/tasks/collection/cascade.ts:10`, `:30-31`. **[ref]** with one sentence. **[checked]**
- A plan whose `deps` name an unknown task, or loop, is refused when seeded, and the run fails. `old:162`, `readme:166`. **[ref]** **[verify]** the refusal's code path was not re-read; only the docs state it.
- The planner defaults to `utility.decomposer`, named `<name>-planner`, and `planner` replaces it. `sv:111`, `sv:352-358`. A planner returns `{ tasks: [{ id, goal, assignee?, deps?, priority?, context? }] }`, `sc:82-93` (the exported `plannerOutputSchema`), and the seeder also accepts `title`, `input`, `maxAttempts`. `pe:87-102`. **[page, one sentence]** **[ref, fields]** **[checked]**
- `synthesizeGoal` rewrites a goal that depends on the conversation ("do that for all of them") into a self-contained one before planning. Default `false`. `sv:135-140`, `pe:53-61`, `pe:309-326`. **[ref]** **[checked]**
- `maxConcurrency` is the worker pool size, default 3. `sv:81-82`, `sv:281`, `sv:384`. **[page, one clause]** **[checked]**
- `instructions`, `context`, `history`, `uses` shape the default planner, reviewer and synthesizer. `context` reaches all three (`sv:162`, `sv:230`, `sv:355`); `history` the synthesizer and planner (`sv:231`, `sv:356`); `uses` the reviewer and synthesizer (`sv:163`, `sv:232`); `instructions` the synthesizer only (`sv:234`, `sv:368`). **[ref]** **[checked]**

## 7. Candidate example (one scenario, carried through)

The page's one scenario: a content team summarizing support tickets. Names below are the fact sheet's proposal; the draft may change them. Layout follows `user-docs.md` "Code examples".

- A worker block, one file, one export named after it. It declares `feedback` on its input so a retry reads it. Shape from `old:53-67` and `wt:39-123`:
  `src/flows/digest/blocks/summarize-ticket.ts` exports `summarizeTicket`: `generator({ name, model: "openai/gpt-6-luna", inputSchema: z.object({ taskId, goal, context?, attempts?, feedback? }), outputSchema: z.object({ summary: z.string() }), prompt, user })`. `generator` is from `@flow-state-dev/core`. **[checked]** against `old:53-67` and `st:527-570`. The `user` function appends `feedback` when present (`old:63-66`).
- The supervisor, in the flow: `src/flows/digest/blocks/digest-tickets.ts` exports `digestTickets = supervisor({ name: "digest", worker: summarizeTicket, reviewCriteria: [...], maxAttemptsPerTask: 3 })`. `supervisor` from `@flow-state-dev/patterns`. **[checked]** `sv:69-141`, `old:67-77`.
- A custom reviewer, as the sitemap asks. Typed `handler` or `generator` with `inputSchema: reviewerInputSchema`, `outputSchema: reviewerVerdictSchema`, both exported from `@flow-state-dev/patterns` (`packages/patterns/src/index.ts:36-41`). The tests build one as a `handler` whose `execute` returns `{ decision, feedback }` (`st:80-95`). A model-backed reviewer uses a `generator` with the same schemas, which is what the default does (`sv:157-176`). **[checked]**
- `reviewerVerdictSchema` on a generator output is OpenAI strict-compatible: criteria is an array, not a record. `sc:56-64`. **[ref]**
- Using the supervisor in a flow: the returned block is placed where any block goes, for example as an action's block. Not shown on this page; link to the flows and actions pages. **[ref]**
- No example in `examples/` or `labs/` calls `supervisor(`. A search of `examples`, `labs`, `apps/kitchen-sink` and `goals` found only a code comment in `examples/guides/custom-pattern/src/plan-map-reduce.ts:4` and kitchen-sink UI components that render tasks. So the example is built from the exported surface and the tests, and its types must be checked by pass 4 against the package source. **[checked]**

## 8. What it stores (the four questions)

A supervisor stores one thing: the board of tasks it plans and runs.

| Stored part | Who owns it | Who can see it | Where it is stored | How many exist |
| --- | --- | --- | --- | --- |
| The task board (each task: goal, status, attempts, feedback, output, labels) | The supervisor block that planned it; the board is named by the supervisor's `name`. `rc:90`, `lf:31`, `sy:134` (`collectionId = name`) | The tasks reach the client as `task-change` items while the supervisor runs; the test reads them from the run's items. `st:500-523`. Labels such as `failed-review` are on the task. Whether a client sees them depends on the app's rendering, not on the supervisor | On the request: `backing: "state"` with no `state` puts the ledger on `ctx.request`, so it ends with the request and a new request starts empty. `rc:186-190`, `lf:37-41`, `sy:158-162`, `packages/orchestration/src/tasks/collection/get-or-create.ts:60-72` | One board per supervisor `name` per request; at most `maxTotalTasks` tasks (500) and `maxEnqueuedTasks` (100) waiting at once, unless set |
| Reviewer audit (`reviewMetadata[taskId]`: `entered`, `lastVerdict`) | The supervisor's own sequencer | Not shown; it only feeds the label | The supervisor sequencer's state, in memory for the run. `sc:17-24`, `sc:37-45`, `rc:48-67` | One entry per task that reached review |
| The reviewer's verdict item | The default reviewer generator | The client, by default; not the model history. `sv:164`. Set with `reviewerVisibility` | The run's items | One per reviewed attempt |
| The synthesizer's output | The synthesizer | The client and the model history, by default. `sv:233`. Set with `synthesizerVisibility` | The run's items; it is also the block's return value | One per run |

- **[page]** One short answer, in prose, to "where does the work live": the tasks live for the request; nothing a supervisor plans survives a new request. The table is for the writer, not the page. **[checked]**
- A supervisor is not a background queue: it runs inside the request that called it. Tasks and retries are not kept for a later call. `get-or-create.ts:60-72`. For a board that outlives a request, the reader goes to the Task board page (`backing: "resource"`). **[page, one sentence + link]** **[checked]**
- Checkpoint resume: the task board's state travels with a sequencer's state when the sequencer resumes from a checkpoint. `tc:56-64`. Supervisor's board sits on the request, not a sequencer's state, so this does not apply to it as built. **[cut]** do not state; it is a mechanism claim and the supervisor's resume behaviour was not run. **[verify]**

## 9. Limits and failure shapes

- Missing worker: throws at construction. `sv:292-296`. **[ref]**
- A task ends `errored` with the label as in section 4; the run itself still returns the synthesizer's output, with `result.error === null` in the test harness. `st:473-525`. **[page, one sentence]** **[checked]**
- With `onSubTaskError: "fail"` the run ends with an error and no synthesized output. `st:322-338`. **[ref]** **[checked]**
- When every task fails, `results` is an empty list and the synthesizer still runs. `sy:164-173` does not branch on an empty list. **[code-read]** No test covers it; keep it off the page or leave it to a row.
- A reject with no `feedback` still retries; the worker's `feedback` is `"Reviewer reject the task output"` or `"Reviewer needs-revision the task output"`. `rc:168-170`. **[ref]** **[checked]**
- The reviewer sees one task's output at a time; it cannot compare siblings. `rc:132-146`, `sv:387-391` (the board is built with `declaredDepsOnly`, so a task's worker sees only its declared dependencies' work). **[page, one clause]** **[checked]** for the reviewer input; **[code-read]** for the policy.
- The supervisor makes one model call per task attempt for the worker, one per task attempt for the default reviewer, one for the planner, one for the synthesizer. So a plan of N tasks that each take two attempts is 2N worker calls and 2N reviewer calls. Derived from `sv:433-438` and `rc:199-209`. **[page, one sentence, as what the reader pays]** **[checked]**

## 10. Neighbours and links

- `parallelTasks`: fan-out with no per-task review. Slug `./parallel-tasks.md` (the old page's `./parallelTasks` link was broken). `old:15`, `old:282`. **[page]**
- `planAndExecute`: a task graph with replanning. Slug `./plan-and-execute.md`. `old:15`, `old:284`. **[page]**
- Task board: the board the supervisor builds on; where `maxTotalRetries`, dependency cascades and `backing: "resource"` are explained. `old:281`, `old:140`. Slug `../concepts/tasks-and-boards.md` (the Tasks and boards concept page; see `docs/contributing/docs-revamp/pages/concepts/`). **[page, link]**
- Round robin: a judge over a fixed roster, no per-task retry. `old:283`. **[ref]** one clause at most.
- The pattern overview page (`./overview`, `old:286`) is where "which pattern" lives. **[page, link]**
- The Reference page for this page's detail does not exist yet in the page plan under a name this pass could confirm; the page links `../../reference/patterns.md` (R-41), `../../reference/task-board.md` (R-23), `../../reference/task-collections.md` (R-24) and `../../reference/models.md` (R-21), as sibling pages do. **[verify]** at cutover.
- The page states `maxAttemptsPerTask: 3` as the first run plus two retries (`attempts` is 2 on the first retry, `ic:534-554`), and says a task that settles while its worker runs is a Reference row, not page text.

## 11. Cut list (never on the page)

- The block-by-block pipeline of the per-task chain and its handler names (`rc:199-209`). Mechanism.
- BP-011 and "conformant" language (`old:42`). Design defense.
- The "third outcome" paragraph about a task settled while the worker ran (`old:40`). Mechanism and edge.
- "Deliberately not built on `GoalSeekLoop`" (`old:285`). Design defense.
- The reason `reviewMetadata` lives on the sequencer rather than the task (`rc:23-27`, `sc:17-24`). Rationale.
- Tracker ids in doc comments (`sv:83`, `sv:93`, `sv:124`, `sy:139`).
- The exported API list (`old:250-271`) beyond `supervisor` and the schemas the example imports.

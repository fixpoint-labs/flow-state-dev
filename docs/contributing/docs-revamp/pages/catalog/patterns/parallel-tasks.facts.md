# Parallel Tasks (K-20) — fact sheet

Page: `catalog/patterns/parallel-tasks`, type `catalog`, budget 800 words (plan: "Split a goal once, run the pieces side by side, combine"). Pass 1. Every fact has a file and line. Paths are from the repo root.

Sources used: `packages/patterns` exported surface and its comments, `packages/patterns/test/parallelTasks.test.ts`, the existing pages (`docs/contributing/docs-revamp/pages/catalog/patterns/parallel-tasks.md`, `apps/docs/docs/patterns/parallelTasks.md`, `apps/docs/docs/orchestration/task-board.md`), the package README, `packages/core/src/utility/{decomposer,combiner}.ts`, and `examples/guides/custom-pattern/src/plan-map-reduce.ts`. No spec, issue, PR or commit was read.

Line numbers into `packages/patterns/src/parallelTasks/index.ts` are written `index.ts:N`.

## 1. What it is

- F1. `parallelTasks(config)` returns a sequencer (`SequencerDefinition`); it composes as a `.step()` in another sequencer. `index.ts:90-92`; test `packages/patterns/test/parallelTasks.test.ts:259-279` (`block.kind === "sequencer"`, `block.name` is the config `name`).
- F2. It decomposes a goal into sub-tasks, runs the worker once per sub-task concurrently, and combines the completed outputs. One pass: no review step, no replanning. `index.ts:3-9`; existing page line 9.
- F3. The loop underneath is one drain with an always-done judge and `maxIterations: 1`, so there is exactly one pass. `index.ts:190-200` (judge at 197, `maxIterations: 1` at 198). Internal; the page may say "one pass", not the mechanism.
- F4. Input is `{ goal: string }`, exported as `parallelTasksInputSchema`. `packages/patterns/src/parallelTasks/schemas.ts:9-11`. Exported from the package root: `packages/patterns/src/index.ts:2-3`.
- F5. Exported types: `ParallelTasksConfig`, `SubTaskErrorStrategy` (`"skip" | "fail"`). `schemas.ts:13`, `index.ts:24-27`; README `packages/patterns/src/parallelTasks/README.md:63-66`.
- F6. When to use it (existing page lines 11-16): the goal decomposes into independent sub-tasks; you trust the worker's output without review; failed sub-tasks may be skipped. For review and revision use Supervisor; for dependency-ordered work, Plan and Execute (existing page 240-243).

## 2. Config

| Option | Type | Default | Where |
| --- | --- | --- | --- |
| `name` | `string` | required | `index.ts:30-31` |
| `worker` | block | required; receives `TaskWorkerInput` | `index.ts:33-34` |
| `maxConcurrency` | `number` | `3` | `index.ts:36-37`, `96`, passed as board `concurrency` at `139` |
| `planner` | block | `utility.decomposer` named `<name>-planner` | `index.ts:65-66`, `122-124` |
| `synthesizer` | block | `utility.combiner` named `<name>-merger` | `index.ts:68-72`, `125-128` |
| `onSubTaskError` | `"skip" \| "fail"` | `"skip"` | `index.ts:74-79`, `99` |
| `outputSchema` | Zod schema | none; passed only to the default combiner | `index.ts:81-82`, `127` |
| `maxTotalTasks` | `number \| null` | 100 (see F13) | `index.ts:38-46` |
| `maxEnqueuedTasks` | `number \| null` | 500 (see F13) | `index.ts:38-46` |
| `maxTotalRetries` | `number \| null` | 50 | `index.ts:48-63` |

- F7. `outputSchema` has no effect when you supply your own `synthesizer`. `index.ts:81`, `125-128`. Report row for Reference if needed.
- F8. Tasks run first-in-first-out (`claimOrder: "fifo"`); the board drains until no pending or in-progress task remains (`onIdle: "complete"`). `index.ts:140-141`.
- F9. Task dependencies (`deps`) are not set up by this pattern's default planner flow in a way the page should promise; the seeding handler does copy `deps`/`dependencies` from planner output onto tasks. `packages/patterns/src/shared/planning-entry.ts:148`. Do not state that Parallel Tasks orders by dependency; Plan and Execute is the page for that (existing page 242). Treat `deps` as out of scope.

## 3. The worker

- F10. The worker is any block whose input is `TaskWorkerInput`: `taskId`, `goal`, `title?`, `context?`, `attachments?`, `input?`, plus `attempts` and `feedback?`. `packages/orchestration/src/tasks/workers/types.ts:39-76` (`attempts` at 74, `feedback` at 75). Import `taskWorkerInputSchema` or `TaskWorkerInput` from `@flow-state-dev/orchestration/task-board` (types.ts comment 31-33).
- F11. For each task, `input` is set to the task's `goal` string unless the planner supplied `input`. `packages/patterns/src/shared/planning-entry.ts:140` and `index.ts:148` (`inputDefault: "goal"`). So `input.goal` and `input.input` both hold the sub-task text by default.
- F12. The planner's `title` and `context` (strings; `null` is treated as absent) arrive on the worker input as `title` and `context`. `planning-entry.ts:145-147`; decomposer schema `packages/core/src/utility/decomposer.ts:7-19`. The default decomposer prompt tells the model to put into `context` the concrete facts a task needs, because "a worker only sees this task, not the original request". `decomposer.ts:66`.

## 4. The planner

- F13. Default planner: `utility.decomposer`, a generator with default model `openai/gpt-6-luna`. It returns `{ tasks: [{ id, title|null, goal, context|null, deps?, priority? }] }`. `decomposer.ts:21-23`, `53`. Its prompt tells the model never to ask the user for clarification and to assume the most likely intent. `decomposer.ts:62-63`.
- F14. A custom `planner` must accept `{ goal: string }` and output `{ tasks: Array<{ goal: string, ... }> }`. Each task may carry `id`, `title`, `context`, `input`, `priority` (number), `maxAttempts`, `deps`. `planning-entry.ts:87-102`; existing page lines 95-98. A task with no `id` gets `task-<n>` (1-based). `planning-entry.ts:138`.
- F15. Seeding writes all planned tasks to the board in one batch. If the batch would cross a creation bound, none of it lands and the call throws `TaskCapExceededError`. `apps/docs/docs/orchestration/task-board.md:407` ("A batch `createTasks` is all-or-nothing"). Creation bounds default to 500 enqueued and 100 total (comment `index.ts:40-41`: "Defaults 500/100", enqueued first). `null` lifts a bound. `planning-entry.ts:160-162` (seeding), `index.ts:38-46`. Verify the 500/100 order against the task-board page before writing; if the page states them, it belongs on a Reference row, not this page.
- F16. A planner that returns zero tasks seeds nothing (`planning-entry.ts:160`), so the board has nothing to run and the synthesizer receives an empty list (see F20).
- F17. Test: a generator planner is swapped by name in tests with `generators: { "<name>-planner": mock }`. `parallelTasks.test.ts:100-105`. A handler can serve as planner. `parallelTasks.test.ts:114-141`.
- F18. Planner must be swapped when the domain is specific; existing example uses a `generator` with `outputSchema: z.object({ tasks: z.array(z.object({ goal: z.string() })) })` and `user: (input) => input.goal`. Existing page lines 147-166. This example uses an undeclared `reviewWorker` (phantom name); the new page must declare or import its own.

## 5. The synthesizer and the result

- F19. Default synthesizer: `utility.combiner`, deterministic, no model call. Returns `{ combined: unknown, mergeNotes?: string[] }`. `packages/core/src/utility/combiner.ts:78-81`, `226-235`. Test: `result.output.combined` is defined. `parallelTasks.test.ts:107-111`.
- F20. How the combiner merges, by what the worker outputs look like (`combiner.ts:189-221`):
  - no outputs: `{ combined: [], mergeNotes: ["No artifacts provided; returned an empty combined array."] }` (192-194);
  - every output an array: concatenated and de-duplicated (196-201);
  - every output a plain object: merged key by key; on a key collision a conflicting value is resolved by taking the later output, with a note in `mergeNotes` (203-213, 156-159); arrays under the same key are concatenated and de-duplicated (137-145);
  - mixed types: the outputs de-duplicated in order, with a note (215-220).
  - "Later" means later in the order the board lists completed tasks; the order is not documented as stable. Do not promise one.
- F21. A custom `synthesizer` receives `unknown[]`: the `output` of each completed task, with undefined outputs dropped. `index.ts:68-69`, `157-172` (collect handler; filter at 166-169). Test: a handler synthesizer given two tasks returns `total: 2`. `parallelTasks.test.ts:143-175`.
- F22. The custom synthesizer's own output becomes the block's output; no `{ combined }` wrapper. Test asserts `output.total`. `parallelTasks.test.ts:171-174`.
- F23. A generator synthesizer reads the list through its `user` slot: `user: (results: unknown[]) => JSON.stringify(results, null, 2)`. Existing page lines 180-186. Existing example's `sectionWorker` is a phantom name.
- F24. Ordering of the outputs given to a synthesizer is whatever `listTasks({ status: "completed" })` returns. No documented order; do not claim one. `index.ts:164-168`.
- F25. The synthesizer sees only outputs, not the goal, the task goals or which tasks failed. `index.ts:164-169` (it receives only the output array). The page can say so: if the synthesis needs the sub-task goals, the worker's output must carry them.

## 6. When a sub-task fails

Answers the sitemap question "One task fails: what does the result hold?".

- F26. `onSubTaskError: "skip"` (default): the failed task is recorded `errored`, the other tasks keep running, and the synthesizer receives only the completed tasks' outputs. `index.ts:74-79`, `158-163` (comment "failed and skipped tasks are excluded"), `120`. Test: with three tasks and the second throwing, `result.error` is null and `output.combined` is defined. `parallelTasks.test.ts:198-230`.
- F27. The block does not report which task was skipped. The result is the synthesizer's output only; nothing in the output marks a skip. Derived from `index.ts:157-172`, `190-200` (output is the finalize step's output). Say it flat: a skipped sub-task leaves no trace in the result.
- F28. If every task fails under `"skip"`, the synthesizer receives an empty array; the default combiner then returns `combined: []` with a note. `existing apps/docs/docs/patterns/parallelTasks.md` Error handling (existing page line 191); `combiner.ts:192-194`. A custom synthesizer must handle `[]` itself.
- F29. `onSubTaskError: "fail"`: the first failure fails the whole block. `result.error` is non-null. Test `parallelTasks.test.ts:232-256`. Task-board wording: `"fail"` rethrows and the board fails. `task-board.md:249`. The error is the worker's own error under `"fail"` (task-board.md:267 says "the error that surfaces is the worker's own"). The test only asserts non-null, so do not quote an error shape beyond "the worker's error".
- F30. Under `"fail"` there is no partial result: the block errors rather than returning the completed outputs. Derived from F29 plus the finalize step following the board in the same sequence, `index.ts:190-200`.
- F31. `onSubTaskError: "retry"` is not a supported value. A caller that passes it anyway (untyped JS or a cast) gets a `console.warn` at construction and the block behaves as `"skip"`. `index.ts:113-120`. The type is `"skip" | "fail"` only (`schemas.ts:13`). Page: one flat sentence at most, or leave to Reference.
- F32. Retries come from the board, per sub-task, not from the block. A sub-task is retried only when its planned task carries `maxAttempts` and `attempts < maxAttempts`; with no `maxAttempts` a failed sub-task runs once. `task-board.md:250`; `planning-entry.ts:152-157` (planner's `maxAttempts` is copied onto the task); `packages/orchestration/src/tasks/schema/task-init.ts:42-47`. The default decomposer does not emit `maxAttempts` (`decomposer.ts:7-19`), so default runs do not retry.
- F33. To retry, a custom planner puts `maxAttempts` on each task. On a retry the failure message returns to the worker as `feedback` and `attempts` counts up. `types.ts:74-75`; existing page lines 197-219.
- F34. `maxTotalRetries` bounds failure retries across every sub-task: default 50, `null` unbounded, `0` means run each task once and never retry. `index.ts:48-63`; `task-board.md:411-421`. When it is spent, the next failing task settles `errored` instead of re-pending, and the board's `terminationReason` is `"retry-budget-exhausted"` (`index.ts:55-57`). Under `"skip"` that task is then skipped like any other failure. Full semantics belong to the Task Board page ("Bounding the retries"), so link, do not restate (`existing page line 221`).

## 7. Is there a review step?

- F35. No. There is no per-task review, no replan and no second pass. `index.ts:3-9`, `197-198`; existing page line 9. Supervisor adds a reviewer per task and retries on rejection (`docs-revamp/pages/catalog/patterns/supervisor.md:9`); that is the page to link for a reviewed fan-out.

## 8. Where to swap the planner (and the other slots)

- F36. Two blocks are swappable: `planner` and `synthesizer`. The worker is required. `index.ts:33-34`, `65-72`. Reaching either by name in tests: `<name>-planner` (generator) and `<name>-merger` (combiner), `index.ts:122`, `126`.
- F37. A planner may be any block kind with the right input and output; the tests use a `handler` that returns a fixed task list. `parallelTasks.test.ts:114-141`. A synthesizer may be a handler (`143-175`) or a generator (existing page 180-186).

## 9. What gets stored (four questions)

The stored part is the task list the pattern writes to its internal board.

- F38. **What it is:** one task per planned sub-task, each with its status, `output`, `error`, `attempts`, `feedback`, plus a retry record. `packages/orchestration/src/tasks/schema/task.ts:51-80`.
- F39. **Where:** stored on the request (the run of the action), under the key `name` (the pattern's `name`; the board's `collectionId` is the config `name`). `index.ts:132`, `147`, `planning-entry.ts:127-131` (`backing: "state"`, no `state`), `task-caps.ts` comment `packages/orchestration/src/tasks/collection/task-caps.ts:56-58` ("ends with the request. A new request starts empty").
- F40. **Who owns it / who can see it:** the pattern's own board, created inside the block. The user's code never declares it; nothing in the pattern's config exposes or reads it from a client. Do not claim it is hidden from tools (the DevTool is not a source here). The page may say only: the list lives for one action run and is not a resource you declare. `index.ts:130-132` (`collection: { collectionId: name }`).
- F41. **How many:** one collection per `parallelTasks` instance per request; one row per planned task, bounded by `maxEnqueuedTasks` (default 500) and `maxTotalTasks` (default 100) as in F15. Two `parallelTasks` blocks with different `name`s in one request keep separate lists, and two with the same `name` share one collection key (`index.ts:132`; the key is the `name`). Give each instance a distinct `name`.
- F42. Nothing persists past the run beyond what the action's own output records. Derived from F39. The completed outputs reach the caller only through the synthesizer's output.

## 10. Concurrency

- F43. Up to `maxConcurrency` (default 3) sub-tasks run at once; the rest wait their turn. `index.ts:36-37`, `96`, `139`. With `maxConcurrency: 1` they run one at a time (test, `parallelTasks.test.ts:177-195`, asserts only no error).
- F44. A task never runs in two places at once; each is claimed once per attempt. Do not cite a mechanism; the page may rely on `task-board.md` for the guarantee. Verify wording against that page before stating.

## 11. Composing

- F45. As a `.step()` inside a larger sequencer, `parallelTasks` takes `{ goal }` as input, so the step before it must output `{ goal: string }` (or a superset). `schemas.ts:9-11`; existing page 229-237 (note: its `.step(parallelTasks({ name: "synthesis", worker: synthesisWorker }))` as a second step feeds it `combined` output, not `{ goal }`; do not reuse that example, it would not type-check or run as written).
- F46. A flow exposes it with `defineFlow({ kind, requireUser: true, actions: { research: { inputSchema: z.object({ goal: z.string() }), block, userMessage: (input) => input.goal } }, session: { stateSchema } })`. Existing page lines 57-75. Check this snippet against `defineFlow` before reuse; the page's example app uses `src/flows/<flow>/flow.ts`.

## 12. Example for the page

One scenario, carried through. Existing pages use "research" with a `research-task` handler; the revamp's catalog sibling pages use `openai/gpt-6-luna` for generators. Suggested scenario fits the example app (a `research` flow): split "compare three competitors" into one task per competitor.

- F47. Basic use, verified shape: `parallelTasks({ name, worker, maxConcurrency })` where `worker` is `handler({ name, inputSchema: z.any(), outputSchema, execute: async (input) => ... })` reading `input.goal`. `parallelTasks.test.ts:16-27` (handler with `inputSchema: z.any()`), existing page lines 38-52. A typed alternative is `taskWorkerInputSchema` (F10).
- F48. Custom synthesizer: a `generator` with `outputSchema`, `prompt`, and `user: (results: unknown[]) => ...`. Existing page 180-186; tests use a `handler` returning `{ total }`. `parallelTasks.test.ts:143-151`.
- F49. In the page's single-file examples, name the file (`src/flows/research/blocks/research-competitor.ts` for the worker, `.../blocks/research.ts` for the pattern block), import `handler`, `generator` from `@flow-state-dev/core`, `parallelTasks` from `@flow-state-dev/patterns`, and `z` from `zod`.
- F50. Existing flaws on the pages to avoid carrying forward: phantom names `reviewWorker`, `sectionWorker`, `synthesisWorker`, `taskWorker`, `researchWorker`, `preprocess`, `postprocess` (existing page lines 163, 182, 215, 230-236); an ASCII "Block composition" diagram that names internals (`seedTasks`, `board.drain`, `collectResults`, lines 20-27); a "Config reference" that repeats the full option list; an "Exported API" section (129-141); a "Composability" example that chains two patterns incorrectly (F45).

## 13. Packaging

- F51. Package `@flow-state-dev/patterns`, import `{ parallelTasks }` (`packages/patterns/src/index.ts:2`). Types import `ParallelTasksConfig`, `SubTaskErrorStrategy` (`index.ts:5-8`, README 63-66). The worker's input types come from `@flow-state-dev/orchestration/task-board` (`parallelTasks/index.ts:19`).
- F52. Related pages and their slugs (sitemap): Supervisor (`./supervisor.md`), Plan and Execute (`./plan-and-execute.md`), Task Board (orchestration; "Bounding the retries" at `task-board.md:411`). The existing Docusaurus page is `apps/docs/docs/patterns/parallelTasks.md`; the revamp slug is `catalog/patterns/parallel-tasks`.

## 14. Items to leave on Reference, not the page

- The three creation/retry bounds and their `null`/`0` values (F15, F34); `terminationReason` values; the `onSubTaskError: "retry"` warning (F31); the combiner's merge rules beyond one sentence (F20); `outputSchema` pass-through (F7); the `TaskWorkerInput` field list beyond `goal` (F10).

## 15. Open items for passes 2 to 5 to check

- F15's 500/100 order: `index.ts:40` reads "Defaults 500/100" and the config docs name `maxTotalTasks` first; confirm which is which in `packages/orchestration/src/task-board/index.ts` before the numbers go on a Reference row.
- F44's exactly-once wording: confirm on the Task Board page before stating it.
- F27/F30: the sheet derives "no trace of a skip" and "no partial result under fail" from reading the pipeline; the tests assert only `result.error`. A cold-read question on either needs a runnable check (`fsdev run` with a failing worker) before the page states it as fact.

## 16. Revise round 1

- Page now carries, with sources above: the sequencer/one-pass claim (F1, F2, F35); the three examples built on `taskWorkerInputSchema` from `@flow-state-dev/orchestration/task-board` (F10, F51; exported at `packages/orchestration/src/task-board/index.ts:172`); output shape `{ combined, mergeNotes? }`, array concatenation, object key merge with `mergeNotes`, empty `combined: []` (F19, F20, F28); custom synthesizer output is the block's output unwrapped (F22); synthesizer sees only completed outputs (F21, F25); skip/fail behaviour and no trace of a skip (F26, F27, F30); retry only with planner `maxAttempts`, error returned as `feedback`, default planner sets none (F32, F33); same-`name` blocks share a list (F41); a step before it must output `{ goal }` (F45).
- `generator` takes an optional `model` (`packages/core/src/blocks/generator.ts:599`); examples pass `openai/gpt-6-luna`.
- Corrected: `outputSchema` does not reshape the default combiner's result. The combiner handler still returns `{ combined, mergeNotes? }` and `outputSchema` replaces the schema it is checked against (`combiner.ts:158`). The page no longer mentions it; R-41 row.
- Moved to R-41 (page links `../../reference/patterns.md`): the whole option table, `TaskWorkerInput` fields, defaults for `maxTotalTasks`, `maxEnqueuedTasks`, `maxTotalRetries`, planner and synthesizer contracts, `onSubTaskError` values and the unsupported-`"retry"` warning (F31, `index.ts:113-120`), `parallelTasksInputSchema` and exported types.
- Moved to R-23 (page links `../../reference/task-board.md`): retry semantics under `"skip"` and `"fail"`, `maxTotalRetries` (F32, F34).
- Cut: the ASCII block composition (internals), the Config reference, Exported API and Composability code (F50, F45).

---
title: Patterns
type: reference
description: "The config, input and output shapes, defaults and construction errors of each pattern, the task caps they share, and where each one keeps its data."
---

# Patterns

A pattern is a ready-made arrangement of blocks for a shape of work that comes up often: fan a goal out to parallel workers, have a reviewer check each result, let agents take turns, run analyzers over a finished reply. You call the pattern's function with a config object and place what it returns in a flow like any other block.

Every pattern has a default block for each role it needs, usually a model call, so a config names only what differs from the default. Values written `intent/chat` or `intent/synthesize` are model aliases, not model ids; [Models](./models.md) says how they resolve. This page covers each pattern, and `goalSeekLoop`, the loop `parallelTasks` and `planAndExecute` run on.

## Imports

| Name | Import from |
| --- | --- |
| `parallelTasks`, `planAndExecute`, `supervisor`, `routedSpecialists`, `eventActors`, `roundRobin`, `debate` | `@flow-state-dev/patterns` |
| `responseAuditor`, `createModerator`, `createJudge` | Subpath only: `@flow-state-dev/patterns/response-auditor`, `/debate` |
| `createReferee` | `@flow-state-dev/patterns/round-robin`, or the root as `createRoundRobinReferee` |
| Other exports of a pattern | Its subpath: `/plan-and-execute`, `/supervisor`, `/routed-specialists`, `/event-actors`, `/round-robin`, `/debate`. `parallelTasks` has none |
| `goalSeekLoop`, `taskBoard`, `mapToVerdict`, `Verdict`, `taskWorkerInputSchema` | `@flow-state-dev/orchestration/task-board` |
| `defineResource`, `utility.decomposer`, `utility.combiner` | `@flow-state-dev/core` |
| `biasAnalyzer` | `@thought-fabric/core/metacognition` |

Signatures of every export are in the [generated patterns API](./api/patterns.md). This page lists what a caller observes.

## Which patterns run a task board

| Pattern | Task board | Notes |
| --- | --- | --- |
| `parallelTasks` | Yes, through `goalSeekLoop` | One drain, no feedback loop |
| `planAndExecute` | Yes, through `goalSeekLoop` | An evaluator decides after each drain whether to continue, replan or complete |
| `supervisor` | Yes, directly | Each task runs as worker, then reviewer, then verdict |
| `eventActors` | Yes, directly | One worker per actor |
| `routedSpecialists` | No | One iteration at a time; each iteration is a task in a collection |
| `roundRobin`, `debate` | No | A task per (round, agent) turn, kept as an audit record |
| `responseAuditor` | No tasks | A side-chain sequencer with parallel analyzers |

Claim order, the default for what a board does when a task errors, and the board's own options are on [Task board](./task-board.md). Each pattern's concurrency option and default is in its table below.

## Shared options

### Task caps

`parallelTasks`, `planAndExecute`, `supervisor` and `eventActors` take `maxTotalTasks` and `maxEnqueuedTasks`. The first three also take `maxTotalRetries`; `eventActors` has none, because its tasks cannot retry. The defaults are 500, 100 and 50, and each pattern's table repeats them. What the caps mean, how to remove one with `null`, and what happens when a plan crosses one are on [Task board](./task-board.md).

- `maxTotalRetries` binds only a board whose tasks can retry: `supervisor`, `planAndExecute` once `maxAttemptsPerTask` is above 1, and `parallelTasks` only for a task the planner gave its own `maxAttempts`.
- `eventActors` checks a batch of dispatches against the caps as one unit. See Re-emission under `eventActors`.

### `onSubTaskError`

`parallelTasks` and `supervisor`. Default `"skip"`.

| Value | Effect |
| --- | --- |
| `"skip"` | The failing task is recorded `errored` and its siblings continue. Its output is left out of what the synthesizer receives. If every task fails, the synthesizer receives an empty array (`parallelTasks`) or an empty `results` (`supervisor`) |
| `"fail"` | The first failure throws and fails the run |
| `"retry"` | Not in the type. Passing it logs a warning at construction and behaves as `"skip"`. For `supervisor` the warning points at `maxAttemptsPerTask` |

### `taskContext` and `synthesizeGoal`

`planAndExecute` and `supervisor`. `parallelTasks` has neither: a task carries a `context` only if the planner emitted one.

| Option | Value | Effect |
| --- | --- | --- |
| `taskContext` | `"goal"` (default) | Each task the planner left without a `context` gets the goal copied in. A planner-supplied `context` is kept |
| | `false` | Tasks keep no context unless the planner set one |
| | a block | Runs once over `{ goal, tasks }` and returns `{ tasks }`. The block owns the contexts it returns and is not filtered afterwards |
| `synthesizeGoal` | `false` (default) | The goal is used as given |
| | `true` | A built-in step rewrites the goal into a self-contained one before planning, reading the last 8 history items. If the model call fails, the original goal is used |
| | a block | Must return `{ ...input, goal }` and handles its own failures |

The rewritten goal is what the planner, replanner and synthesizer see. In `planAndExecute`, tasks a replan adds without a `context` get the goal copied in, with the default `taskContext` or a custom block, but not when `taskContext` is `false`. A custom block runs on the initial plan only. Replanner output has no `context`: `{ id, goal, deps }`.

### What a block worker receives

Block workers on `parallelTasks` and `supervisor` receive a `TaskWorkerInput`. Its fields are on [Task collections](./task-collections.md). Where a pattern fills one differently:

- `parallelTasks`: `input` is the task's goal unless the planner set `input`.
- `supervisor`: `input` is absent unless the planner set it. `feedback` is the reviewer's feedback on a retry. `priorWork` holds the outputs of declared dependencies only.

The `planAndExecute` step executor receives a different shape, given under its section.

### Item visibility

Every `*Visibility` option takes an `ItemVisibility`, `{ client, history }`. What each flag controls is on [Items and the stream](./items.md). The default for each option is in its table.

## `parallelTasks`

Fan a goal out into sub-tasks, run them, combine the results. One pass.

- Input: `{ goal: string }`, schema `parallelTasksInputSchema`.
- Output: the synthesizer's result. With the default combiner, `{ combined: unknown, mergeNotes?: string[] }`; with no completed outputs, `{ combined: [], mergeNotes: ["No artifacts provided; returned an empty combined array."] }`.
- Planner: receives `{ goal }`, returns `{ tasks: Array<{ goal, id?, title?, assignee?, deps?, dependencies?, priority?, input?, context?, maxAttempts? }> }`. `id` defaults to `task-1`, `task-2`, in order. `deps` falls back to `dependencies`, then `[]`. `priority` counts only when it is a number. A `title` or `context` of `null` is treated as absent.
- Synthesizer: receives `unknown[]`, the output of every completed task that has one.
- There is no `model`, `uses`, `context` or visibility option. The default planner is a model call with the decomposer's model, `openai/gpt-6-luna`; the default combiner makes no model call.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `name` | `string` | required | Instance name and task collection id |
| `worker` | block | required | Runs once per sub-task; receives a `TaskWorkerInput` |
| `maxConcurrency` | `number` | 3 | Sub-tasks running at once |
| `maxTotalTasks`, `maxEnqueuedTasks`, `maxTotalRetries` | | 500 / 100 / 50 | Task caps. `maxTotalRetries` binds only a task the planner gave its own `maxAttempts` |
| `planner` | block | `utility.decomposer()` | Returns `{ tasks }` |
| `synthesizer` | block | `utility.combiner()` | Combines the completed outputs |
| `onSubTaskError` | `"skip" \| "fail"` | `"skip"` | See `onSubTaskError` |
| `outputSchema` | Zod schema | none | Passed to the default combiner only; ignored when you supply `synthesizer` |

## `supervisor`

Plan, run workers in parallel, review each result, retry on rejection, label failures, synthesize.

- Input: `{ goal: string }`, schema `supervisorInputSchema`.
- Output: the synthesizer's output. The default synthesizer returns a string unless `outputSchema` is set.
- Giving neither `worker` nor `workers` throws ``[supervisor] "<name>" requires either `worker` or `workers` ``. The two are alternatives.
- There is no `model` option. The planner uses the decomposer's model; the reviewer and synthesizer use `intent/synthesize`.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `name` | `string` | required | Instance name and task collection id |
| `worker` | block | none | One worker for every task. Exclusive with `workers` |
| `workers` | `Record<assignee, block>` | none | The task's `assignee` picks the worker |
| `instructions` | string or `(input, ctx) => string` | none | Added to the default synthesizer's prompt |
| `reviewCriteria` | `string[]` | none | Handed to the reviewer as `criteria`; the default reviewer renders them as a numbered list |
| `maxAttemptsPerTask` | `number` | 3 | Attempts per task before it fails for good. A planner-supplied `maxAttempts` wins |
| `maxConcurrency` | `number` | 3 | Workers running at once |
| `maxTotalTasks`, `maxEnqueuedTasks`, `maxTotalRetries` | | 500 / 100 / 50 | Task caps. `maxTotalRetries` binds by default here |
| `planner` | block | `utility.decomposer()` | Returns `{ tasks: [{ id, goal, assignee?, deps?, priority?, context? }] }` |
| `taskContext` | `"goal" \| false \| block` | `"goal"` | See `taskContext` |
| `synthesizeGoal` | `boolean \| block` | `false` | See `synthesizeGoal` |
| `reviewer` | block or `false` | LLM reviewer, `intent/synthesize` | `false` removes review: output goes straight to complete, and a task that fails is labelled `worker-error` |
| `synthesizer` | block | LLM, `intent/synthesize` | Receives `{ goal, results, resultItems? }` |
| `onSubTaskError` | `"skip" \| "fail"` | `"skip"` | See `onSubTaskError` |
| `outputSchema` | Zod schema | `z.string()` | Output of the default synthesizer |
| `context` | context slot | none | Forwarded to the default planner, reviewer and synthesizer |
| `history` | history config | none | Forwarded to the default planner and synthesizer |
| `uses` | capabilities | none | Forwarded to the default reviewer and synthesizer |
| `reviewerVisibility` | `ItemVisibility` | `{ client: true, history: false }` | Default reviewer's items |
| `synthesizerVisibility` | `ItemVisibility` | `{ client: true, history: true }` | Default synthesizer's items |

### Review

The worker runs and its output goes to the reviewer. An `approve` verdict passes the output on as the task's result. `reject` and `needs-revision` fail the attempt, with the verdict's `feedback` as the error text, and the task returns to `pending` while attempts remain. A worker that throws spends the same attempt budget as a rejection.

| Shape | Fields |
| --- | --- |
| Reviewer input | `{ taskId, goal, attempts` (default 1)`, workerOutput, criteria? }`. `criteria` is present only when `reviewCriteria` is non-empty |
| Reviewer verdict | `{ decision: "approve" \| "reject" \| "needs-revision", feedback?: string, criteria?: Array<{ name, score }>, reasoning?: string }` |
| Synthesizer input | `{ goal, results: unknown[], resultItems?: Array<{ taskId, goal, items }> }`. `results` is the `output` of every `completed` task |

`feedback` is optional in the schema. With none, the retry's error text is `Reviewer <decision> the task output`, and that text is what the worker receives as `feedback` on its next attempt. The default reviewer usually includes it.

After the drain, every `errored` task gets one label. A failed or cancelled task's pending dependents are cancelled by the board and labelled `skipped` (see [Task board](./task-board.md)).

| Label | Meaning |
| --- | --- |
| `failed-review` | The last verdict was `reject` or `needs-revision` |
| `reviewer-error` | The reviewer threw before returning a verdict |
| `worker-error` | The worker failed before review, or `reviewer: false` |

## `planAndExecute`

Plan a task graph, run it on a board, evaluate, optionally replan, synthesize.

- Input: `{ goal: string }`, schema `planAndExecuteInputSchema`.
- State: `{ goal: string (default ""), status?: "planning" | "executing" | "replanning" | "synthesizing" | "completed" | "failed", iteration: number (default 0) }`, schema `planAndExecuteStateSchema`.
- Output with `synthesizer: false`: `{ goal, status: "completed" | "failed", tasks: Array<{ id, goal, status, result?, error? }>, completedSteps, totalSteps }`. With a synthesizer, that shape is its input and its return is the output.
- Replanner output: `{ tasks: Array<{ id, goal, deps (default []) }> }`.
- Step executor input, the shape your `stepExecutor` block receives (not a `TaskWorkerInput`): `{ stepId, goal, context?, dependencyResults? }`. `dependencyResults` is keyed by dependency task id, holds completed dependencies only, and is absent when there are none.
- Default step executor output: `{ summary: string, success: boolean, reason: string (default ""), sources: Array<{ title (default ""), url }> (default []) }`. A result with `success: false` throws its `reason` (or `Task did not produce a result`). That fails the task and cancels its dependents, as does any thrown error.
- An evaluator that throws fails the request.

| Output field | Values and rule |
| --- | --- |
| task `status` | `pending`, `in-progress`, `completed`, `failed`, `skipped`. Board `errored` becomes `failed`; every `cancelled` task becomes `skipped`; other board statuses (`blocked`, `parked`) pass through under their own name |
| task `error` | The task's error, or its feedback when it has no error |
| overall `status` | `completed` when there are no tasks or at least one non-skipped task completed. `failed` when no non-skipped task completed (failed, pending or blocked tasks all count), or every task was skipped |
| `completedSteps`, `totalSteps` | Count of `completed` tasks, and of all tasks |

### Evaluator

With `enableReplanning: false` the default evaluator makes no model call. It increments `iteration` and returns `complete` once `iteration >= maxIterations` or no executable work remains, else `continue`. With `enableReplanning: true` it is a model call (`openai/gpt-6-luna` unless `model` is set) returning `{ decision, reasoning, tasks? }`; the iteration cap forces `complete` all the same.

A custom evaluator returns `{ decision: "continue" | "complete" | "replan", score?, feedback?, reasoning?, tasks? }`. A `replan` carrying `tasks` adds those tasks directly; without them the replanner runs.

### Config

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `name` | `string` | required | Instance name and collection id |
| `planner` | block | `utility.decomposer()` | Returns `{ tasks }` |
| `stepExecutor` | block | LLM executor, `intent/synthesize` | Runs each task |
| `evaluator` | block | built in | Decides continue, replan or complete |
| `replanner` | block | LLM replanner, `openai/gpt-6-luna` | Runs on `replan` with no inline `tasks` |
| `maxIterations` | `number` | 3 | Drains the loop may run, and the evaluator's iteration cap |
| `enableReplanning` | `boolean` | `false` | `true` turns on the model-backed evaluator |
| `synthesizer` | block or `false` | LLM synthesizer, `openai/gpt-6-luna` | `false` returns the output shape above |
| `outputSchema` | Zod schema | `z.string()` | Not read. The default synthesizer always returns a string; pass your own `synthesizer` for a structured result |
| `model` | `string` | per block | Model for the default planner, replanner, evaluator and synthesizer (all `openai/gpt-6-luna`) and executor (`intent/synthesize`) |
| `maxAttemptsPerTask` | `number` | 1 | Attempts stamped on every seeded task; 1 means no retries |
| `maxConcurrency` | `number` | 1 | Board workers. Raise it to run independent tasks together |
| `maxTotalTasks`, `maxEnqueuedTasks`, `maxTotalRetries` | | 500 / 100 / 50 | Task caps. `maxTotalRetries` binds once `maxAttemptsPerTask` is above 1 |
| `taskContext` | `"goal" \| false \| block` | `"goal"` | See `taskContext` |
| `synthesizeGoal` | `boolean \| block` | `false` | See `synthesizeGoal` |
| `instructions` | string or function | none | Added to the default planner, executor and synthesizer prompts |
| `context` | context slot | none | Default planner, executor, replanner and synthesizer. Not the evaluator |
| `history` | history config | none | Default planner, replanner and synthesizer |
| `tools` | tools | none | Default executor, replanner and synthesizer |
| `search` | `boolean \| GeneratorSearchConfig` | none | Default executor only |
| `executionInstructions` | `string` | none | Appended to the default executor's prompt |
| `synthesizeInstructions` | `string` | none | Appended to the default synthesizer's prompt |
| `uses` | capabilities | none | Default executor, replanner and synthesizer. Not the planner or the evaluator |
| `stepExecutorVisibility` | `ItemVisibility` | `{ client: true, history: false }` | Default executor |
| `synthesizerVisibility` | `ItemVisibility` | `{ client: true, history: true }` | Default synthesizer |
| `resources` | `Record<string, any>` | none | Declared on the default executor |

## `routedSpecialists`

A controller picks which specialist block runs next, over a shared workspace, until it says it is done.

- Input: not schema-bound. A function `initialState` receives it.
- Output with `synthesizer: false`: `{ workspace, iterations: number, history: Array<{ iteration, specialist, reasoning, output }> }`. `history` lists completed iterations, oldest first; a failed iteration is left out. With a synthesizer, that shape is its input.
- Controller decision (`controllerOutputSchema`): `{ specialist: string | null, done: boolean, reasoning: string }`. `specialist` names a registered specialist while `done` is false, and is `null` when done.
- `maxIterations` caps loop-backs, not iterations: the controller runs once, then at most `maxIterations` more times. With `maxIterations: 3` and a controller that never says done, 4 iterations run.
- A specialist that throws leaves its task `errored` and the loop continues.
- A decision of `done: false` with `specialist: null` creates no task, does not fail the run, and the loop continues.
- An unregistered specialist name throws with the list of registered names. The iteration's task is created first and is left `errored`; the loop continues.
- An empty `specialists` throws `[routedSpecialists] At least one specialist is required in "<name>"`.
- Tasks: one per iteration in which the controller picked a specialist. `assignee` is the specialist's name, `goal` is the controller's `reasoning` (or `iteration N` when blank), `output` is the specialist's return value. The record's other fields are on [Task collections](./task-collections.md).
- Emits a `routedSpecialists` data item after each iteration, a snapshot of the workspace and loop state. See [Items and the stream](./items.md).

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `name` | `string` | required | Instance name; prefix of internal block names |
| `workspace` | `DefinedResource` | required | The shared writable resource. Build it with `createWorkspace(stateSchema)` |
| `specialists` | `Record<string, BlockDefinition>` | required, at least one | Blocks the controller can pick, by name. Each should declare `resources: { workspace }` |
| `instructions` | string or `(input, ctx) => string` | none | Instructions for the default controller and synthesizer. Ignored when you supply `controller` or `synthesizer` |
| `controller` | block | LLM controller | Returns the decision above |
| `maxIterations` | `number` | 10 | Loop-backs, as above |
| `maxHistory` | `number` | unlimited | The default controller's prompt shows only the latest N completed iterations; the collection keeps all |
| `initialState` | object or `(input) => object` | none | Applied with `setState` once at the start of each run. Without it the workspace keeps what the session holds |
| `model` | `string` | `"openai/gpt-6-luna"` | Default controller and synthesizer |
| `context` | context slot | none | Default controller and synthesizer |
| `uses` | capabilities | none | Default controller and synthesizer |
| `controllerVisibility` | `ItemVisibility` | `{ client: true, history: false }` | Default controller |
| `synthesizerVisibility` | `ItemVisibility` | `{ client: true, history: true }` | Default synthesizer |
| `synthesizer` | block or `false` | LLM synthesizer | `false` returns `{ workspace, iterations, history }` |
| `outputSchema` | Zod schema | none | Default synthesizer only |
| `collectionId` | `string` | `name` | Id of the iteration task collection |

## `eventActors`

Actors subscribe to topics. Emitting an entry runs every actor whose pattern matches it.

- `emit` input: an entry `{ type: string, topic: string, body: unknown }`. It appends the entry to the workspace first (unless it is a duplicate), then starts one task per matching actor. Each actor's block receives the entry as its input. If the matching actors would cross a task cap, none of them is dispatched.
- `eventActors({...})` returns `{ emit, workspace, actors }`; `actors` is frozen.
- `createEventActorsWorkspace({ name: string, entries: ZodTypeAny })` returns `{ workspace: DefinedResource }`. `entries` is documentation only.
- `actor({ name, watch, block })` returns a frozen descriptor. A `watch` with no pattern throws `[eventActors] Actor "<name>" must have at least one watch pattern`.
- An empty `actors` throws `[eventActors] "<name>" must have at least one actor`.

| `eventActors` option | Type | Default | What it does |
| --- | --- | --- | --- |
| `name` | `string` | required | Instance name |
| `workspace` | `{ workspace: DefinedResource }` | required | Result of `createEventActorsWorkspace` |
| `actors` | `Actor[]` | required, at least one | The subscribers |
| `concurrency` | `number` | 4 | Actors running at once |
| `reEmit` | `boolean` | `false` | Actor outputs shaped like entries are appended and dispatched again |
| `maxDepth` | `number` | 3 | Re-emission depth cap; matters only with `reEmit` |
| `maxTotalTasks`, `maxEnqueuedTasks` | `number \| null` | 500 / 100 | Task caps. There is no `maxTotalRetries` |

### Topic patterns

A pattern is matched against the string `${type}:${topic}`. `*` matches within one segment (segments are separated by `:` or `.`), `**` matches any characters including none, and `*` also matches the empty string. Every other character matches itself. Avoid `?` in a pattern: it makes the character before it optional, so `slacks?` matches `slack` and `slacks`.

| Pattern | Matches | Does not match |
| --- | --- | --- |
| `observation:*` | `observation:slack` | `observation:slack.msg` |
| `observation:**` | `observation:slack.msg.edit` | `event:slack` |
| `*:slack` | `observation:slack`, `event:slack` | |
| `observation:slack.*` | `observation:slack.message` | `observation:slack.a.b` |
| `**` | everything | |
| `observation:slacks?` | `observation:slack`, `observation:slacks` | `observation:slackx` |

### Re-emission

With `reEmit`, an actor's output is read as entries: an array, a bare entry object, or `{ entries: [...] }`. Only objects with a string `type`, a string `topic` and a `body` key count; anything else is dropped. Each counted entry is appended, then dispatched to its matching actors as new tasks one level deeper. One actor's entries are dispatched as a batch: if the actors they match would cross a task cap, none is dispatched, the entries stay appended, and the source task errors. The first dispatch is depth 1, re-emitted tasks are depth 2, 3 and so on. At `maxDepth` the actor runs and its entries are appended, but nothing is dispatched from them. Task `metadata` carries `{ depth, type, topic }`.

### Duplicates and failures

- An entry whose `type` and `topic` already appear in the workspace is not appended again and emits no `rb-entry` item. A duplicate entry, whether passed to `emit` or re-emitted, dispatches its matching actors but is not appended again.
- `createAppendEntry(name, workspaceResource, resourceKey = "workspace")` appends the entry and emits its `rb-entry` item, unless one with the same `type` and `topic` is already there, in which case it does neither. It returns nothing either way: compose it with `.tap()`, because `.step()` would hand the next step `undefined`.
- A failing actor records an `errored` task and the rest of the chain continues.

### Tasks and items

- Tasks: one per matching actor, in a request-scoped collection with id `eventActors:<name>`. `assignee` is the actor name and `input` is the entry. See [Task collections](./task-collections.md).
- Emits an `rb-entry` data item per appended entry. See [Items and the stream](./items.md).

## `roundRobin`

A fixed roster takes turns in declared order for up to `maxRounds` rounds. An optional referee audits each round. A synthesizer writes the result up.

- Input: `{ goal: string }`, schema `roundRobinInputSchema`.
- Each round runs every roster entry in declaration order, then the referee if set, then the exit check. After the last round, the synthesizer receives `RoundRobinFinalShape`, or that shape is returned when `synthesizer: false`.
- Exit: after each round the loop ends if the round count has reached `maxRounds`; otherwise `terminateWhen(ctx)` is called and `true` ends it. At most `maxRounds` rounds run, and exactly that many when `terminateWhen` never fires.
- `terminateWhen(ctx: BlockContext) => boolean`: `ctx.sequencer.state` holds the round counter (`round`) and the referee critiques (`refereeCritiques`); `ctx.session.state` is available. It should be pure and total. A throw surfaces as a loop runtime error.
- Construction errors: empty `roster` (`roster must contain at least 1 entry`); a roster entry with an empty name; duplicate names (`duplicate roster name "<n>"`); `maxRounds` not above 0 (`maxRounds must be > 0`); `outputSchema` with `synthesizer: false` (`cannot set outputSchema when synthesizer: false`).
- Transcript entry: `{ round, agentName, text }`, `round >= 1`. One audit task per (round, agent) turn: `goal` is `<agent> (round <n>)`, `assignee` is the roster name, `output` is `{ text }`. See [Task collections](./task-collections.md) for the task record.
- Output `RoundRobinFinalShape`: `{ rounds: number` (rounds executed)`, contributions: Array<{ round, agentName, text }>, refereeCritiques: Array<{ round, critique }> }`. `refereeCritiques` is empty with no referee. It is the output when `synthesizer: false` and the synthesizer's input otherwise.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `name` | `string` | required | Instance name |
| `roster` | `RosterEntry[]` | required, at least 1, unique names | Who speaks, in order |
| `maxRounds` | `number` | 5 | Round cap; above 0 |
| `terminateWhen` | `(ctx) => boolean` | none | Early exit, after each round |
| `contributions` | `DefinedResource` | one per call | Shared transcript resource |
| `referee` | block | none | Per-round audit; with none the step is absent |
| `synthesizer` | block or `false` | LLM synthesizer | `false` returns the raw shape |
| `outputSchema` | Zod schema | `z.string()` | Default synthesizer only; refused with `synthesizer: false` |
| `instructions` | string or function | none | Default roster agents and synthesizer |
| `model` | `string` | none | Default roster agents and synthesizer. With no value, agents use `intent/chat` and the synthesizer `intent/synthesize` |
| `uses`, `tools`, `context` | | none | Default roster agents and synthesizer |
| `synthesizerVisibility` | `ItemVisibility` | `{ client: true, history: true }` | Default synthesizer |
| `collectionId` | `string` | `name` | Audit task collection id |
| `accessorKey` | `string` | `"contributions"` | Accessor key of the contributions resource |

`RosterEntry`:

| Field | Meaning |
| --- | --- |
| `name` | Unique, non-empty |
| `role?` | Injected into the default agent's prompt; ignored when `block` is set |
| `block?` | Overrides the default agent |

### Roster agents

The default agent is a model call that streams plain text, with no `outputSchema`; each item it emits carries the roster `name` as `agentName`. It sees the goal, the round, earlier contributions and the referee critiques. It uses `intent/chat` unless `model` is set, with visibility `{ client: true, history: false }`. For structured output, supply a `block`.

An override `block` must return a string or `{ text: string }`. Any other value is coerced with `String()` and a warning is logged once per agent. Override blocks do not receive `instructions`, `uses`, `tools` or `context`: those reach the default blocks only.

### Referee

A `referee` block returns `{ critique: string }`, once per round after the roster. The critique is stored with its round and shown to the default roster agents of later rounds. An override roster block reads `refereeCritiques` from sequencer state itself. The referee does not control termination or order.

`createReferee(opts)` builds one; pass its result as `referee`. It is not applied automatically.

| `createReferee` option | Default |
| --- | --- |
| `name`, `contributions` | required; `contributions` is the resource passed to `roundRobin` |
| `model` | `intent/synthesize` |
| `context`, `uses`, `tools`, `instructions` | none |
| `itemVisibility` | `{ client: true, history: false }` |
| `accessorKey` | `contributions` |

The default referee never declares a winner and never decides whether more rounds are needed.

### Synthesizer and contributions

The default synthesizer is a model call that combines the transcript and the referee critiques, using `intent/synthesize` unless `model` is set. A block replaces it and receives `RoundRobinFinalShape`.

By default each `roundRobin()` call makes its own contributions resource. Pass one made with `createRoundRobinContributions()` to read the transcript from another block after the loop, and register it in the flow's `resources` so that block can declare it (see [Resources](./resources.md)). The pattern empties it at the start of every run. When several round-robins share a sequencer chain, give each a distinct `accessorKey`: one accessor key cannot point at two resources.

## `debate`

Debaters argue assigned stances. A judge rules once at the end. An optional moderator runs each round.

- Input: `{ question: string }`, schema `debateInputSchema`.
- Without a moderator, every debater speaks each round in declared order, then the judge, then the optional synthesizer. With a moderator, it opens each round and decides who speaks. Only its `nextSpeakers` run, one at a time. The judge and synthesizer follow.
- Each turn sees all earlier rounds plus earlier speakers in the current round. Debaters in one round speak one after another. Default debaters see earlier arguments tagged by stance only (`[stance] text`), never by name.
- Termination is checked after each round, in this order: `round >= maxRounds`; the moderator's last decision has `done: true`; `terminateWhen(ctx)` returns true. `terminateWhen` works with or without a moderator, should be pure and total, and an error it throws propagates as a run error.
- Construction errors: fewer than 2 debaters (`debaters must contain at least 2 entries`); a debater with an empty name or empty stance; duplicate names; `maxRounds` not above 0; `outputSchema` with `synthesizer: false`; `moderator: false` (`moderator cannot be set to false ... use undefined to opt out`).
- Construction warnings: `maxRounds` above 4 (`unusually high ... diminishing`); `anonymizeTranscript: false` with the default judge and `model` set.
- Transcript entry: `{ round, agentName, stance, text }`, one per turn. One audit task per (round, debater) turn: `goal` is `<name> (round <n>)`, `assignee` is the debater name, `output` is `{ text }`, in the collection `collectionId`. See [Task collections](./task-collections.md).
- Output `DebateRawOutput`: `{ rounds, question, transcript: Array<{ round, agentName, stance, text }>, verdict: { verdict, winner: string | null, reasoning }, moderatorDecisions: Array<{ round, nextSpeakers, briefing, newAngle, done }> }`. With `synthesizer: false` this is the output. `moderatorDecisions` is `[]` without a moderator.
- Debater `block` override: returns a string or `{ text: string }`; other shapes are coerced with `String()` and warned about once per agent.

| `debate` option | Type | Default | What it does |
| --- | --- | --- | --- |
| `name` | `string` | required | Instance name |
| `debaters` | `DebaterConfig[]` | required, at least 2 | The roster |
| `maxRounds` | `number` | 2 | Round cap; above 0; above 4 logs a warning |
| `judge` | block | LLM judge | Rules once, after the loop |
| `synthesizer` | block or `false` | LLM synthesizer | `false` returns `DebateRawOutput` |
| `moderator` | block | none | Opens each round. See Moderator |
| `terminateWhen` | `(ctx) => boolean` | none | Early exit |
| `transcript` | `DefinedResource` | one per call | Shared transcript resource |
| `outputSchema` | Zod schema | `z.string()` | Default synthesizer only; refused with `synthesizer: false` |
| `instructions` | string or function | none | Default blocks only |
| `model` | `string` | per block | `intent/chat` for default debaters; `intent/synthesize` for the default judge and synthesizer. Not applied to a moderator |
| `uses`, `tools`, `context` | | none | Default debaters, judge and synthesizer |
| `judgeVisibility` | `ItemVisibility` | `{ client: true, history: true }` | Default judge |
| `synthesizerVisibility` | `ItemVisibility` | `{ client: true, history: true }` | Default synthesizer |
| `debaterVisibility` | `ItemVisibility` | `{ client: true, history: false }` | Default debaters |
| `anonymizeTranscript` | `boolean` | `true` | Judge's view, below |
| `shuffleForJudge` | `boolean` | `true` | Judge's view, below |
| `collectionId` | `string` | `name` | Audit task collection id |

`DebaterConfig`:

| Field | Meaning |
| --- | --- |
| `name` | Unique |
| `stance` | Required, non-empty |
| `role?` | Persona line in the default debater's prompt; ignored with `block` |
| `block?` | Overrides the default debater |

### Judge

The default judge reads the question and the transcript and returns a verdict. An override returns `{ verdict: string, winner: string | null, reasoning: string }`; `winner: null` marks a synthesis verdict. `judge: false` is a type error. With `anonymizeTranscript: true` the judge sees `[stance] text`, with names removed; `false` renders `[name, stance] text`. With `shuffleForJudge: true` the order of arguments within each round is shuffled.

### Moderator

`debate()` never builds a moderator. Without one, every debater speaks every round. To get a model-backed moderator, call `createModerator` yourself and pass the result as `moderator`, sharing one `createDebateTranscript()` with `debate({ transcript })`. The pattern-level `model`, `tools`, `uses`, `context` and `instructions` do not reach a moderator you pass in.

| `createModerator` option | Default |
| --- | --- |
| `name`, `rosterNames`, `transcript` | required |
| `model` | `intent/synthesize` |
| `context`, `uses`, `tools`, `instructions` | none |
| `itemVisibility` | `{ client: true, history: false }` |

Give it `tools` or `uses` for research such as web search. Their results reach debaters only through `briefing`. Without tools it reasons over the transcript and its earlier decisions.

Decision `DebateModeratorOutput`: `{ nextSpeakers: string[], briefing: string | null, newAngle: string | null, done: boolean }`.

- `nextSpeakers` is the ordered list for this round. A list of one is a single-speaker round, and a name listed twice speaks twice.
- `nextSpeakers: []` with `done: false` is rejected by the schema (`Moderator must return non-empty nextSpeakers when done is false`). With `done: true` it is allowed.
- `done: true` lets the current round run, then ends the loop.
- An unknown name throws at dispatch with the list of available names.
- The moderator sees speaker names; `anonymizeTranscript` does not apply to it.
- Debaters of a round see that round's `briefing` and `newAngle`, each nullable on its own. A custom debater reads `state.moderatorDecisions`.
- A moderator that throws surfaces as a run error. A hand-written moderator must return `debateModeratorOutputSchema` output and declare the shared transcript resource, accessor `transcript`.

### Transcript, synthesizer and items

Pass the same `createDebateTranscript()` result to `debate({ transcript })` and to any custom moderator, judge or synthesizer that declares it. Otherwise `debate()` makes its own, and a second declaration of the resource is rejected.

The default synthesizer answers the question directly from the verdict and the arguments, without mentioning the debate. It uses `intent/synthesize`.

Emits `debate-turn-pending` before each debater, then `debate-turn` per turn, `debate-decision` per moderator decision and `debate-verdict` once. Payloads and keys are on [Items and the stream](./items.md).

## `responseAuditor`

Runs analyzers over a finished response and surfaces the findings. It is a side-chain sequencer, so the `.sideChain()` connector must map the pipeline value to its input.

- Input: `{ userInput: string, response: string }`, schema `auditorInputSchema`. Each analyzer receives that and returns an `AnalyzerResult`.
- Analyzers run in parallel, up to `maxConcurrency` at once.
- A failing analyzer is dropped from the results and does not fail the audit.
- Output: `{ results: AnalyzerResult[], surfacedResults: AnalyzerResult[], overallScore: number }`. `overallScore` is the average `score` of the analyzers that did not fail, and `0` with no analyzers or none succeeding. `surfacedResults` holds every result whose `shouldSurface` is true or whose `score >= threshold`.
- When at least one result surfaces, it emits an `audit-annotation` data item, one per invocation. When nothing surfaces, no item is emitted. See [Items and the stream](./items.md).

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `analyzers` | block array | required | The analyzers. An empty list is accepted and gives `overallScore: 0` |
| `threshold` | `number` | 0.3 | A result at or above it surfaces |
| `maxConcurrency` | `number` | all analyzers at once | Parallel analyzer limit |

`AnalyzerResult`:

| Field | Type | Meaning |
| --- | --- | --- |
| `analyzerId` | string | Stable id of the analyzer |
| `category` | string | Domain it belongs to |
| `score` | number, 0 to 1 | Higher means more to surface |
| `shouldSurface` | boolean | Forces the result into `surfacedResults` whatever the score |
| `annotations` | array of `AuditAnnotation` | The findings |
| `supplementary` | record, optional | Domain extras a renderer may show |

`AuditAnnotation`: `type` string, `label` string, `severity` (`"info"`, `"warning"` or `"critical"`), `description` string, `evidence?` string.

`captureContext`, a building block exported from the `@flow-state-dev/patterns/response-auditor` subpath, writes `userInput` and `response` to state and returns nothing, so use `.tap()`.

### `biasAnalyzer`

An example analyzer in `@thought-fabric/core/metacognition`, not in `@flow-state-dev/patterns`.

- Input: `{ userInput: string, aiResponse: string }`. The field is `aiResponse`, not `response`.
- It makes three model calls (detect agreement, classify, counterpoint) and two deterministic steps. The counterpoint call is skipped below `counterpointThreshold` (0.4). Model default `intent/utility`.
- Output: `{ analyzerId: "bias-sycophancy", category: "metacognition", severity, score, label, summary, annotations, counterArguments, sycophancyScore }`. `severity` is `info` below 0.4, `warning` below 0.7, else `critical`. Each annotation is `{ biasType, confidence, description, evidence }`.
- `biasType` is one of `sycophancy`, `confirmation_bias`, `anchoring_bias`, `authority_deference`, `recency_bias`, `false_consensus`.
- It does not satisfy `AnalyzerResultSchema` as it is. An adapter must rename `response` to `aiResponse` on the way in, add `shouldSurface` on the way out, and map each annotation to `{ type, label, severity, description, evidence? }`.

## `goalSeekLoop`

Drains a task board, asks a judge whether the work is done, and repeats. Returns a sequencer.

- Verdict: `{ decision: "done", reason }`, `{ decision: "continue", reason }` or `{ decision: "replan", reason, tasks?: TaskInit[] }`. `continue` drains again with no new tasks. `replan` adds tasks, from the inline `tasks` or, when none, from `replanner`. `reason` is required on every decision; a verdict that does not match is malformed.
- Judge: a block, a sequencer, or a function `(input: { collection, drainResult }, ctx) => Verdict | Promise<Verdict>`. A block or sequencer judge receives the raw drain result and reads the board from `ctx`.
- `mapToVerdict(source, { decision, reason?, tasks? })` adapts a decision-only source to a `Verdict`. `decision` maps the source to `done`, `continue` or `replan`. A missing `reason` is filled with `converged`, `continue` or `replan` respectively. `tasks` is read only for `replan`. A source mapped this way is never malformed.
- Termination: the loop records a `goal-seek-loop-termination` data item with the reason it stopped and the number of drains that ran. See [Items and the stream](./items.md).

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `name` | `string` | required | Outer sequencer name |
| `inputSchema` | Zod schema | `z.unknown()` | Public input of the loop |
| `activeStatusMessage` | `string` | none | Status text emitted before the loop runs |
| `board` | `TaskBoardHandle` | required | The board to drain. Request- or resource-backed only |
| `stateSchema` | Zod object schema | none | Extra fields merged into loop state. Must be a `z.object`, or construction throws |
| `seed` | block or sequencer | none | Writes the first tasks before the first drain. Optional when `initialTasks` seeded the board |
| `afterDrain` | block | none | Runs after each drain, before the judge |
| `judge` | block, sequencer or function | required | Returns a verdict |
| `replanner` | block | none | Runs on a `replan` verdict with no inline `tasks`. Must emit a non-empty `{ tasks }` |
| `maxAttemptsPerTask` | `number` | 1 | Default attempts for tasks a replan adds |
| `taskContext` | context supply | none | Context for replanned tasks |
| `maxIterations` | `number` | required | Total drains. A finite positive integer. Separate from the `taskBoard`'s own `maxIterations` ([Task board](./task-board.md)) |
| `finalize` | block or sequencer | none | Runs over the settled board. Omit it to return the board projection as is |
| `onError` | `"skip" \| "fail"` | `"skip"` | Judge and replanner errors only |

- When `maxIterations` runs out without a `done` verdict, the loop records reason `max-iterations`, runs `finalize` over what has settled, and does not throw.
- `onError: "skip"` exits with reason `judge-error`, runs `finalize` anyway, and covers: the judge throws, the judge returns a malformed verdict, a `replan` with no tasks and no `replanner`, and a `replanner` that emits no tasks. `"fail"` propagates a request error. A failing `seed` or drain always propagates.
- A drain that leaves a task waiting on a user or on an event ends the pass with reason `waiting-on-a-user` or `waiting-on-an-event`. What each means is on [Task board](./task-board.md).
- Construction throws for: a `maxIterations` that is not a finite positive integer; a board backed by a sequencer or a factory; a board declared `mode: "delegation"`; and `maxIterations > 1` over a board whose `initialTasks` include an entry without an `id`, which would be added again every drain. A single-drain loop is unaffected.
- There are no cost or time budgets and no stall detection. The loop stops on a `done` verdict or at `maxIterations`.

## Where each pattern keeps its data

A part is a session resource, a task collection, or the pattern's sequencer state, which a new run starts fresh. In the Lifetime column, "the run" is one execution of the pattern's sequencer, and "the request" is the client request that started it; a request-backed collection lasts for that request. What each kind means for owner, client access and count is on [Resources](./resources.md) and [Task collections](./task-collections.md). The parts specific to a pattern:

| Part | Pattern | Stored as | Lifetime |
| --- | --- | --- | --- |
| Iteration tasks | `routedSpecialists` | Task collection, id `collectionId` | The run |
| Workspace | `routedSpecialists` | Session resource from `createWorkspace` | Replaced by `initialState` each run when set, otherwise carried over |
| Entry log | `eventActors` | Session resource, accessor `eventedActors` (spelled differently from the pattern name), state `{ entries: any[] }`, `client.expose: ["entries"]` | Append-only, never cleared by the pattern, unique on `type` + `topic` |
| Actor tasks | `eventActors` | Request-scoped task collection, id `eventActors:<name>` | The request |
| Contributions | `roundRobin` | Session resource, accessor `contributions` (set with `accessorKey`) | Emptied at the start of every run |
| Audit tasks | `roundRobin`, `debate` | Task collection, id `collectionId` | The run |
| Transcript | `debate` | Session resource, accessor `transcript` (fixed) | Emptied at the start of every run |
| Board tasks | `parallelTasks`, `supervisor`, `planAndExecute` | Request-backed task collection, id `name` | The request |
| Referee critiques, moderator decisions, reviewer audit data, loop bookkeeping, analyzer state | `roundRobin`, `debate`, `supervisor`, `goalSeekLoop`, `responseAuditor` | Sequencer state | The run |

A `roundRobin()` or `debate()` call makes its own resource unless you pass one.

---
sidebar_position: 3
sidebar_label: Task Board
---

# Task Board

Task Board is the lower-level building block underneath Parallel Tasks, Supervisor, and Plan & Execute. It runs a pool of workers that pull from a shared `TaskCollection`, respects task dependencies, and drains until the collection is finished — either because every task completed, or because nothing left can run.

Most users reach for one of the wrapper patterns. Reach for Task Board directly when none of those fit: a custom worker registry, a session-scoped board that accepts tasks from external actors, or a termination policy the wrappers don't expose.

## When to use Task Board

- You need a long-running board that accepts new tasks from outside the initial seed list (Parallel Tasks decomposes once and stops).
- You need a custom dispatcher or termination predicate that none of the higher-level wrappers expose.
- You're building a new coordination pattern and want a tested concurrent-drain substrate underneath it.

## When NOT to use Task Board

Use the higher-level wrappers when their shape fits:

- **Parallel Tasks** — known-upfront fan-out, no review loop, one drain.
- **Supervisor** — per-task quality review before write-back.
- **Plan & Execute** — re-planning across drains based on partial results.
- **Round Robin** — fixed-roster turn-taking.
- **Debate** — paired adversarial contributors.

Drop to Task Board only when none of those fit.

## Block composition

```
seedCollection   (write initialTasks into the TaskCollection)
  ↓
boardMetaActive  (emit "started" status item)
  ↓
forEach worker (concurrency=N)
  ↓
  ┌─ claimTask    (CAS-claim a ready task, or report empty)
  │  ↓
  │  workerBody   (run the task's worker block, recordSuccess / recordError)
  │  ↓
  │  checkBoard   (decide: continue, or exit with a reason)
  │  ↓
  │  loopBack until checkBoard says stop
  ↓
boardMetaCompleted (emit "completed" status item with counts + terminationReason)
```

Each worker runs its own claim/run/check loop. Claims are CAS-safe — two workers never run the same task.

## Basic usage

```ts
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { handler } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

const worker = handler({
  name: "echo",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ result: z.string() }),
  execute: (input) => ({ result: `did ${input.goal}` }),
});

const board = taskBoard({
  name: "echo-board",
  collection: { collectionId: "echo" },
  workers: worker,
  initialTasks: [
    { id: "a", goal: "a" },
    { id: "b", goal: "b", deps: ["a"] },
  ],
});

// `board.drain` plugs into a parent sequencer as a normal step.
```

Defaults: request-scoped storage (`collection` is optional), concurrency `4`, `dispatcher: "topological"`, `onIdle: "complete-or-blocked"`, `onError: "skip"`.

## Termination: `onIdle` modes

A board needs a rule for "when do we stop." That rule is `onIdle`. Three values:

### `"complete-or-blocked"` (default)

Exits when one of the following is true on a worker's `checkBoard` iteration:

- **Drained** — no `pending`, `in_progress`, or `awaiting_review` tasks remain.
- **Blocked** — no worker is currently in `in_progress` or `awaiting_review`, AND no `pending` task has all of its `deps` `completed`. Continuing would just spin: the dispatcher has nothing claimable, and no in-flight work will change the dep graph.

This is the right default for DAG workloads where an upstream task can error and downstream tasks depend on it. Without the "blocked" branch, the downstream pending tasks live forever — the dispatcher can't pick them, and the loop counts them as in-flight.

The final `task-board-meta` item carries a `terminationReason` field that tells the two cases apart:

- `"all-completed"` — every task reached `completed` (or the board started empty).
- `"blocked-by-failures"` — at least one task did not reach `completed`. Could be `errored`, `cancelled`, or `pending` with unresolvable deps.

```ts
// On the final task-board-meta item:
{
  component: "task-board-meta",
  data: {
    collectionId: "echo",
    status: "completed",
    terminationReason: "all-completed",   // or "blocked-by-failures"
    counts: { total: 2, completed: 2, errored: 0, /* ... */ },
  },
}
```

### `"complete"`

Exits only when no `pending`, `in_progress`, or `awaiting_review` tasks remain. This was the pre-FIX-626 default. Use it when a pending task with a non-`completed` dep is a transient state — something outside the worker pool will eventually mark the dep complete (an external service, an HITL approval pumping a queue, etc.).

A board in `"complete"` mode with an unresolvable dep loops indefinitely. That's intentional: this mode is for boards that legitimately wait.

### `"wait"`

Never auto-exits. The loop runs until your `shouldExit` predicate returns `true` (or `maxIterations` trips). Use it for session-scoped boards that accept tasks from outside actors indefinitely.

```ts
const board = taskBoard({
  // ...
  onIdle: "wait",
  shouldExit: (collection) => collection.count() >= 100, // your call
});
```

`shouldExit` is **ignored** in both `"complete"` and `"complete-or-blocked"` modes.

### When to override the default

Most boards leave `onIdle` alone. Override when:

- You're modeling a board that legitimately waits on an external pump (use `"complete"`).
- You're building a session-scoped board that lives across many drains (use `"wait"` + `shouldExit`).

## Cascade-skipping dep-blocked tasks

`"complete-or-blocked"` ends the drain when pending tasks can no longer run, but it leaves those tasks `pending`. To fold them into a terminal status, `.tap()` the `createCascadeSkipDependents` building block after `board.drain`:

```ts
import { taskBoard, createCascadeSkipDependents } from "@flow-state-dev/orchestration/task-board";

const board = taskBoard({ name: "research", collection: { collectionId: "research" }, workers });
const cascadeSkip = createCascadeSkipDependents({ name: "research" });

sequencer({ name: "research" })
  .step(board.drain)
  .tap(cascadeSkip); // transitively cancels pendings whose deps errored
```

It walks the dependency graph from every `errored` task, cancelling each pending whose deps include a failed task, and repeats to a fixed point so multi-level chains (`a → b → c`) drain in one pass. Cancelled tasks are stamped with a `"skipped"` label. The `name` must match the board's `collectionId` so both operate on the same collection. `planAndExecute` and `supervisor` wire this in for you.

## Dispatcher modes

The dispatcher decides which `pending` task gets claimed next. All three built-ins claim a task only when its `deps` are all `completed` — dep-eligibility is enforced by the collection, not by the dispatcher — so they differ only in how they order the ready tasks:

- `"topological"` (default) — earliest-added ready task first.
- `"fifo"` — also earliest-added first. Same dep-eligibility as `topological`; the name just reads better for flat fan-out that has no deps.
- `"priority"` — highest-`priority` ready task first (ties break on earliest-added).

None of them ignore `deps`; a task with unmet deps is never claimed, whichever dispatcher you pick.

Dependency cycles are not rejected at add time. Avoiding them is the caller's responsibility when you build the `deps` graph passed to `addTask`/`addTasks` or `initialTasks`. A board that declares a `deps` cycle still runs, but those tasks never become claimable — the drain ends blocked (under `"complete-or-blocked"`) or idles until its iteration cap.

You can pass a custom `TaskDispatcher` instance too. The dispatcher contract is in `@flow-state-dev/orchestration`. For deeper dispatcher behavior (caching, ledger, flow policy), see [Flow Policy](./flow-policy).

## Worker registry

Two ways to provide workers:

- **Single uniform worker** — one block runs every claimed task. Pass it directly as `workers`.
- **Registry** — a `{ [assignee]: block }` map. Each task carries `assignee: "name"`; the substrate dispatches to the matching worker.

```ts
const board = taskBoard({
  name: "research",
  collection: { collectionId: "r" },
  workers: {
    "market-analyst": marketAnalyst,
    "financial-analyst": financialAnalyst,
    synthesizer: synthesizer,
  },
  initialTasks: [
    { id: "m", goal: "market", assignee: "market-analyst" },
    { id: "f", goal: "financial", assignee: "financial-analyst" },
    { id: "s", goal: "synthesize", assignee: "synthesizer", deps: ["m", "f"] },
  ],
});
```

Assignee resolution follows one rule: a matched assignee runs on its own worker; an unmatched or omitted assignee falls to `defaultWorker` if one is configured; only with no `defaultWorker` does it fail per `onError`.

```ts
const board = taskBoard({
  name: "research",
  collection: { collectionId: "r" },
  workers: { "market-analyst": marketAnalyst },
  // Optional fallback: any task whose assignee is unset or unmatched runs here
  // instead of failing. Reached only on a miss — declared workers are untouched.
  defaultWorker: genericWorker,
});
```

Defaults: no `defaultWorker` unless configured. This is what the skills delegation surface uses to give every board an on-demand [default worker](../skills/delegation.md#default-worker-the-floor); a plain `taskBoard` opts in explicitly.

The rule above is the board's, and it stays as stated: an unmatched assignee falls to `defaultWorker`. The skills delegation surface adds a check further up, refusing an unknown assignee when the task is created, so on those boards an unmatched assignee normally never reaches dispatch. That check needs a roster to check against: a board with no declared agents accepts any assignee, and everything lands on the default worker. A `taskBoard` you build yourself has no roster either and keeps the plain fallback behavior.

## Concurrency and error handling

- `concurrency` — max parallel workers. Default `4`.
- `onError: "skip" | "fail"` — `"skip"` records the error on the offending task; siblings continue. `"fail"` rethrows; the board fails. Default `"skip"`.
- `maxAttempts` (per task) — set on a task's `TaskInit`, not on the board. While `attempts < maxAttempts`, a failed task is re-dispatched instead of left errored. There is no board-level retry cap.
- `maxIterations` — safety cap on how many times a single worker loops back to claim again, not a cap across the board. Default `10000`.

A worker's result is not always the last word on its task. Cancelling a task does not stop the worker already running it, and neither does the worker marking the task done itself partway through, or the claim expiring and another worker picking the task up. In each of those cases the worker eventually comes back with a result for a task that has already moved on.

The board drops those results rather than recording them. Whoever changed the task had better information than a worker that has been away doing the work, so the cancel stands, the output the worker recorded for itself stands, and the second worker's claim is left alone. What matters for `onError` is that dropping the result is contained: one task is affected, the rest of the board keeps draining, and under `"fail"` the error that surfaces is the worker's real one.

One shape is worth knowing about, because it trades a loud failure for an expensive quiet one. If something keeps returning a task to `pending` — a retry budget from `maxAttempts`, or a lease that keeps expiring and reclaiming — under a worker that keeps failing, the task gets re-dispatched each time instead of settling. `maxIterations` is what stops that, which is the other reason to read it as a per-worker number when you size a board.

## Bounding how much work a board takes on

`concurrency` paces how many tasks run at once. It says nothing about how many can be created, so a coordinator that plans badly can queue far more work than anyone intended. Two more bounds cover that, and the three sit at different scopes:

- `maxEnqueuedTasks` (default `100`) — how many tasks may be **added while others are still waiting**. Checked when a task is created, against the resulting `pending` count, so a slot comes back when its task leaves `pending` — completing, erroring, or being cancelled. A task that cannot run, such as one stranded behind a failed dependency, stays `pending` and keeps its slot however long the board drains.
- `maxTotalTasks` (default `500`) — how many tasks the board may **ever hold**, completed and cancelled ones included. Never refunded by draining, so it also catches a board that keeps draining and re-queueing.
- `concurrency` (default `4`) — how many run at the same time.

Creating a task past either bound throws a `TaskCapExceededError` naming the bound it crossed, and nothing is written. A batch `addTasks` is all-or-nothing: if the batch would cross a bound, none of it lands. On a delegation board the model-facing `addTask` tool turns that into a soft `enqueued_task_cap_exceeded` or `total_task_cap_exceeded` result instead. The two recover differently — draining frees the enqueue bound, but only for tasks that can actually run, and gives nothing back against the lifetime one — and what a coordinator should do about each is in [Delegation](../skills/delegation#how-much-work-the-board-will-take-on).

That split is the general rule, not a special case for caps: the substrate throws, and the delegation tool boundary translates the errors a model can act on into results. A refused status transition works the same way — see [the status state machine](task-substrate.md#the-status-state-machine). The board's own result write-backs are the one deliberate exception, and they are why a settled task doesn't take the board down: they ask for the refusal to be silent, as described under concurrency above.

Be precise about what the enqueue bound covers. It applies **when a task is created**. Tasks also return to `pending` through the lifecycle — a retry under `maxAttempts`, an unblock, a resume from review, a reclaimed lease — and those paths are not bounded, so `pending` can sit above `maxEnqueuedTasks` for a while. The hard ceiling is `maxTotalTasks`.

### How long the counts last

Neither bound is a stored counter. Both are read off the board's task ledger at the moment a task is created: the total is the ledger's size, the enqueue count is how many of its tasks are `pending`. So the counts last exactly as long as the ledger, which depends on the backing:

- **Request-backed** (the default) — the ledger lives on the request, so a new request starts empty and both counts start from zero.
- **Sequencer-backed, resumed from a checkpoint** — the sequencer restores its whole state on resume, and the task map is part of that state. The counts come back with it. A wave of new tasks after a resume is checked against the tasks that were already there, not against an empty board.
- **Durable (resource-backed)** — neither bound is enforced. The resource layer counts instances and knows nothing about a task's status, so it can't tell how many are `pending`, and it keeps no record of tasks that have since been removed. What it does give you is `maxInstances` on the task collection, and that is a capacity limit rather than a lifetime ceiling: it caps how many task instances the collection **holds at once**, and creating one past it throws. Deleting an instance frees the slot again, so a board that deletes and re-queues can create more tasks over its life than `maxInstances` ever allows at one moment. It is not the runaway backstop `maxTotalTasks` is. Creation here also goes one instance at a time, so a batch that crosses the limit stops partway and the tasks made before it stay — the all-or-nothing behavior above belongs to the ledger-backed bounds, not to this one.

One qualifier on the sequencer bullet, because it is easy to read too broadly. `backing: "sequencer"` describes the shape of the state reference the ledger is stored in, not the kind of block it hangs off. Any block that holds its own state can supply one, and only a real sequencer block checkpoints — the general rule is in [Block State → The durability boundary](../advanced/block-state#the-durability-boundary).

A delegation board is the case where the two come apart: it uses the sequencer backing, but the ledger lives on the coordinator generator's own state rather than a sequencer's. So it does not checkpoint, and its tasks and counts start from zero after a resume.

### One writer, or hand every writer the bounds

The bounds are carried by the collection reference the board resolves. Resolving the same ledger a second time gives you a *different* reference, and it enforces only what it was built with. So a block that calls `getOrCreateTaskCollection` itself, against a board's `collectionId`, writes past the board's bounds unless it is given them:

```ts
const board = taskBoard({ name: "research", workers });

// This second reference is unbounded, even though the board has bounds.
const loose = await getOrCreateTaskCollection({ ctx, backing: "request", collectionId: "research" });

// Hand it the board's own resolved bounds and it enforces them.
const bounded = await getOrCreateTaskCollection({
  ctx,
  backing: "request",
  collectionId: "research",
  ...board.caps,
});
```

`board.caps` is on the handle for exactly this. Most code never needs it: reaching the board through `board.capability` (or letting the board's own seed and drain do the writing) is already bounded. It matters when you resolve the collection yourself.

One shipped building block is deliberately in that position. `createApplyReplan` accepts a board `capability`, and when you pass one it writes through the board's own reference and is bounded. Wired the older way — with just a name, no capability — it rebuilds the collection from that name alone, so it has no bounds and can add tasks past the board's. It cannot infer them: nothing in its options identifies which board it is writing to. Pass the `capability` when you want replanned tasks to respect the board's bounds. The bundled patterns already do.

### Where the bounds apply

They belong to the collection, so the board applies them only when it builds the collection itself — and, per the previous section, only to writers that go through the board's own reference. That means the request default and the sequencer opt-in below. If you **supply** a collection (a `defineTaskCollection`, or a factory), the board applies nothing and checks nothing: that collection carries whatever bounds it was built with and stays the sole authority. Passing the options together with a supplied `collection` is a configuration error, because a board cannot retrofit limits onto a collection it did not construct. Configure them where the collection is created instead — here, from a block running *inside* the sequencer that owns the tasks slot, so `ctx.sequencer` is that container:

```ts
const tasks = await getOrCreateTaskCollection({
  ctx,
  backing: "sequencer",
  collectionId: "my-board",
  sequencer: ctx.sequencer!,
  maxTotalTasks: 2000,
});
```

Which state ref to pass depends on where your code runs, and getting it wrong fails quietly rather than loudly — you get a working collection over the wrong slot. From a block *inside* the sequencer, it is `ctx.sequencer`. From a tool running as a child of a generator that owns the board, it is `ctx.parent` (see [wiring a bounded board by hand](../skills/delegation#board-and-overrides)).

The bounds live on the sequencer and request backing specs only. `backing: "resource"` does not accept them yet and does not enforce them, so asking there is a type error rather than a ceiling that quietly does nothing.

### If the defaults are too low for your board

This is a behavior change: a board that legitimately creates more than 500 tasks in a run, or holds more than 100 pending at once, starts being refused work with no change at its call site. Raise the bound, or turn it off in place with `null`:

```ts
// Raise it.
const board = taskBoard({ name: "big", workers, maxTotalTasks: 5_000 });

// Or opt out of one axis entirely.
const unbounded = taskBoard({ name: "streaming", workers, maxEnqueuedTasks: null });
```

Omitting an option is not an off switch — it reapplies the default. `null` is. Each option otherwise takes a positive integer; `0`, a negative, a fraction, `NaN`, `Infinity`, or an enqueue bound above the lifetime ceiling are all rejected when the board is constructed.

## Stream items emitted

A board run produces two item streams:

- `task-change` — one item per task transition (`added`, `claimed`, `completed`, `errored`, `cancelled`, etc.). Keyed by `data.task.id`.
- `task-board-meta` — board-level state. Emitted twice per run, once with `status: "active"` at start and once with `status: "completed"` at end. The completed item carries `terminationReason` and the `counts` snapshot.

Renderers like `<TaskPlan />` subscribe to both: `task-board-meta` for the board-level status header, `task-change` for per-task rows.

## Commanding the board with its capability

You pick where a board stores its tasks once, on `taskBoard({...})`. After that, the only thing other blocks touch is `board.capability`. List it in a block's `uses` and the board's tasks are on `ctx.cap.<name>` — the board name verbatim. Hyphenated names work through bracket access (`ctx.cap["my-board"]`).

```ts
const board = taskBoard({ name: "research", workers });

const enqueue = handler({
  name: "enqueue-more",
  inputSchema: z.unknown(),
  uses: [board.capability],
  execute: async (_input, ctx) => {
    await ctx.cap.research.addTask({ goal: "check competitors" });
    const open = await ctx.cap.research.countTasks({ status: "pending" });
    return { open };
  },
});
```

The accessor has `addTask`, `addTasks`, `getTask`, `listTasks`, `countTasks`, and `tasks()` (the full `TaskCollectionRef` when you need a method the sugar doesn't cover). A sibling or outer step can add tasks *before* `board.drain` runs and the board picks them up on its first pass. It can also add them *while* the board is draining, as long as both run in the same request: an idle worker notices the new task and picks it up without waiting for its poll interval.

Each sugar call re-resolves the collection so reads always reflect the latest state your request can see. That's cheap for the request and sequencer backings. A durable (resource-backed) board re-enumerates the collection on each resolve, so when you need several reads in a row without writes between them, grab the ref once with `const tasks = await ctx.cap.<name>.tasks()` and read from it.

## Collection backing

A board stores its tasks in one of three places. You choose once; nothing downstream restates it.

- **Request (default)** — tasks live on `ctx.request` and survive every block boundary in the request, including re-entry across an outer loop (Plan & Execute replans this way) and adds from sibling steps before the drain. Omit `collection` entirely, or pass `{ collectionId }` to name it (the id defaults to the board name).
- **Durable (resource-backed)** — tasks outlive the request. Declare the collection with `defineTaskCollection` and pass it as `collection`; the board registers and resolves it for you.
- **Sequencer** — tasks live on the board's own sequencer state, which lasts one `board.drain` invocation. Opt in with `{ backing: "sequencer", collectionId }`. Calling the board twice gives two independent collections.

```ts
// Request default — nothing to restate.
const board = taskBoard({ name: "research", workers });

// Sequencer opt-in — single-invocation, per-call state.
const board = taskBoard({
  name: "one-shot",
  collection: { backing: "sequencer", collectionId: "one-shot" },
  workers,
});
```

For a custom or externally-managed store, pass a factory `(ctx) => TaskCollectionRef` as `collection`.

If you write that ref by hand, `complete` and `fail` have to accept and honour the optional `TaskTransitionOptions` third argument. TypeScript won't catch it if you don't — a two-argument `complete(id, output)` satisfies the interface structurally, and the extra argument is dropped without a word. The board passes those options on every write-back so a result landing on a task someone else already settled is declined rather than thrown. A ref that ignores them throws instead, and that throw escapes the per-worker rescue and abandons the rest of the board's tasks. See [recording a result that may no longer apply](task-substrate.md#recording-a-result-that-may-no-longer-apply).

## Durable boards that survive across turns

When a board's tasks must persist past the request — a user's standing to-do list, an org-wide work queue — declare a durable collection with `defineTaskCollection` and hand it to the board. The tasks live as resource instances at the scope you name (`session`, `user`, or `org`).

```ts
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";

const todos = defineTaskCollection({
  id: "todos",
  scope: "user",
  stateSchema: z.object({ topic: z.string() }), // the task `input` payload
});

const board = taskBoard({ name: "todos", collection: todos, workers });
```

`id` names the collection (it forms the resource pattern and the board's `collectionId`), `scope` sets its lifetime, and `stateSchema` types each task's `input` payload — the rest of the task envelope is validated for you. The board installs the collection on both its own drain and `board.capability`, so a sibling action that lists `board.capability` in `uses` reads and writes the same durable tasks.

One boundary is worth knowing about. A sibling that adds a task *while the board is draining* is seen right away when it runs in the same request as the drain. A separate request that writes to the same durable collection at the same moment is not, and re-resolving inside the running request does not help: a request reads durable state into memory when it starts, so a drain already under way stays unaware of that write for the rest of its request. A *future* request picks it up. Writing before or after a drain works either way, since a new request reads what was stored.

## See also

- [GoalSeekLoop](./goal-seek-loop) — a config-driven, judge-gated loop over the board's drain.
- [Block State](../advanced/block-state) — the primitive behind the board's sequencer-scoped task collection; see [The durability boundary](../advanced/block-state#the-durability-boundary) for what survives a resume.
- [Parallel Tasks](../patterns/parallelTasks) — single-pass fan-out wrapper on top of Task Board.
- [Supervisor](../patterns/supervisor) — per-task review wrapper.
- [Plan and Execute](../patterns/plan-and-execute) — replan-loop wrapper.
- [Flow Policy](./flow-policy) — dispatcher policy and `priorWork` shaping.
- [Patterns Overview](../patterns/overview) — when to use which pattern.

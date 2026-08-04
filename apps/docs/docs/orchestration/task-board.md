---
title: Task board
sidebar_position: 3
sidebar_label: Task board
description: A pool of workers that claim ready tasks from a shared TaskCollection, respect dependencies, and drain until a termination rule you choose says stop.
---

# Task board

Task board is the building block underneath Parallel Tasks, Supervisor, and Plan and Execute. It runs a pool of workers that pull from a shared `TaskCollection`, respects task dependencies, and drains until the collection is finished: either every task completed, or nothing left can run.

Most users reach for one of the wrapper patterns. Reach for the board directly when none of those fit: a custom worker registry, a session-scoped board that accepts tasks from external actors, or a termination policy the wrappers don't expose.

## When to use a task board

- You need a long-running board that accepts new tasks from outside the initial seed list (Parallel Tasks decomposes once and stops).
- You need a custom dispatcher or termination predicate that none of the higher-level wrappers expose.
- You're building a new coordination pattern and want a tested concurrent-drain substrate underneath it.

## When NOT to use one

Use the higher-level wrappers when their shape fits:

- **Parallel Tasks** — known-upfront fan-out, no review loop, one drain.
- **Supervisor** — per-task quality review before write-back.
- **Plan and Execute** — re-planning across drains based on partial results.
- **Round Robin** — fixed-roster turn-taking.
- **Debate** — paired adversarial contributors.

Drop to the board only when none of those fit.

## Block composition

```
seedCollection   (write initialTasks into the TaskCollection)
  ↓
boardMetaActive  (emit "started" status item)
  ↓
forEach worker (concurrency=N)
  ↓
  ┌─ claimTask    (claim a ready task, or report empty)
  │  ↓
  │  workerBody   (run the task's worker block, recordSuccess / recordError)
  │  ↓
  │  checkBoard   (decide: continue, or exit with a reason)
  │  ↓
  │  loopBack until checkBoard says stop
  ↓
boardMetaCompleted (emit "completed" status item with counts + terminationReason)
```

Each worker runs its own claim/run/check loop. A claim is a single atomic compare-and-set, so two workers never run the same task: one wins, the other moves straight on to the next eligible task.

## Basic usage

```ts
import { handler } from "@flow-state-dev/core";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
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
- **Blocked** — no task is `in_progress` or `awaiting_review`, and no `pending` task has all of its `deps` `completed`. Nothing is claimable, and no in-flight work is left to change the dep graph.

The final `task-board-meta` item carries a `terminationReason` field saying which case it was:

- `"all-completed"` — every task reached `completed` (or the board started empty).
- `"blocked-by-failures"` — at least one task did not reach `completed`. Could be `errored`, `cancelled`, or `pending` with unresolvable deps.
- `"retry-budget-exhausted"` — the board refused a retry because `maxTotalRetries` was spent. See [Bounding the retries](#bounding-the-retries).

A delegation board's `runBoard` tool reports a `status` of its own, and the two count different things. `terminationReason` asks whether every task succeeded. `runBoard`'s `status` asks whether any task is still outstanding, so a board whose only problem is one errored task reads `"blocked-by-failures"` here and `"drained"` there. See [Delegation](../skills/delegation.md) for the coordinator's side.

```ts
// On the final task-board-meta item:
{
  component: "task-board-meta",
  data: {
    collectionId: "echo",
    status: "completed",
    terminationReason: "all-completed",   // or "blocked-by-failures" | "retry-budget-exhausted"
    maxTotalRetries: 50,
    counts: {
      total: 2,
      completed: 2,
      errored: 0,
      cancelled: 0,
      blocked: 0,
      awaiting_review: 0,
      in_progress: 0,
      pending: 0,
      retries: 0,
    },
  },
}
```

The choice between `"all-completed"` and `"blocked-by-failures"` comes from the counts (`completed === total`), so in `"wait"` mode a `shouldExit` that fires while tasks are still running reports `"blocked-by-failures"` even though nothing failed. Read `counts` when you override termination. `"retry-budget-exhausted"` is not a count comparison: it appears only when a retry was actually refused.

### `"complete"`

Exits only when no `pending`, `in_progress`, or `awaiting_review` tasks remain. Use it when a pending task with a non-`completed` dep is a transient state: something outside the worker pool will eventually mark the dep complete (an external service, an HITL approval pumping a queue).

A board in this mode never decides on its own that it is stuck. If a dep will never resolve, each worker keeps cycling until it hits `maxIterations` (default `10000`, counted per worker). Pick the mode when the board really is supposed to wait.

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
import { sequencer } from "@flow-state-dev/core";
import { taskBoard, createCascadeSkipDependents } from "@flow-state-dev/orchestration/task-board";

const board = taskBoard({ name: "research", collection: { collectionId: "research" }, workers });
const cascadeSkip = createCascadeSkipDependents({ name: "research" });

sequencer({ name: "research-run" })
  .step(board.drain)
  .tap(cascadeSkip); // transitively cancels pendings whose deps errored
```

It walks the dependency graph from every `errored` task, cancelling each pending whose deps include a failed task, and repeats to a fixed point so multi-level chains (`a → b → c`) drain in one pass. Cancelled tasks are stamped with a `"skipped"` label. It resolves the board's request-backed collection from `name`, so `name` must match the board's `collectionId` and the board must be on the default request backing. `planAndExecute` and `supervisor` wire this in for you.

## Dispatcher modes

The dispatcher decides which `pending` task gets claimed next. No dispatcher claims a task whose `deps` aren't all `completed`; that rule lives on the collection's `claim`. So the built-in modes differ only in how they order the tasks that are already ready:

- `"topological"` (default) — earliest-added ready task first.
- `"fifo"` — the same ordering. The name reads better for a flat fan-out with no deps.
- `"priority"` — highest-`priority` ready task first, ties break on earliest-added. An unset `priority` counts as 0.

Those three strings are the only names `dispatcher` accepts. It also takes any `TaskDispatcher` instance, and `@flow-state-dev/orchestration` exports five: the three above plus `classifierDispatcher` and `eventDispatcher`, which are factories that need config and so have no string name. Pass one of those, or your own, in place of the string. See [Task substrate → Dispatchers](./task-substrate.md#dispatchers) for what each one picks, and [Flow policy](./flow-policy) for the observation ledger, `priorWork` shaping, and tool-result caching.

Dependency cycles are not rejected at add time. Avoiding them is the caller's responsibility when you build the `deps` graph passed to `addTask`/`addTasks` or `initialTasks`. A board that declares a `deps` cycle still runs, but those tasks never become claimable: the drain ends blocked (under `"complete-or-blocked"`) or idles until its iteration cap.

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

Assignee resolution: a matched assignee runs on its own worker; an unmatched or omitted assignee falls to `defaultWorker` if one is configured; with no `defaultWorker`, the task fails per `onError`.

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

There is no `defaultWorker` unless you pass one. The skills delegation surface always passes one, which is how every delegation board gets an on-demand [default worker](../skills/delegation.md#default-worker-the-floor); a plain `taskBoard` opts in.

A delegation board catches a bad assignee earlier than that. When the skill declares agents, `addTask` with an assignee that isn't one of them returns `{ ok: false, error: "unknown_assignee: …" }` and writes nothing, so a typo is refused at creation rather than quietly landing on the default worker. The check needs a roster to check against. A delegation board with no declared agents has no roster, and neither does a `taskBoard` you wire yourself, so on those boards every assignee is accepted and an unmatched one takes the fallback path above.

## Concurrency and error handling

- `concurrency` — max parallel workers. Default `4`.
- `onError: "skip" | "fail"` — `"skip"` records the error on the offending task; siblings continue. `"fail"` rethrows; the board fails. Default `"skip"`.
- `maxAttempts` (per task) — set on a task's `TaskInit`, not on the board. While `attempts < maxAttempts`, a failed task is re-dispatched instead of left errored.
- `maxTotalRetries` (default `50`) — how many times the whole board may re-dispatch a failed task. See [Bounding how much work a board takes on](#bounding-how-much-work-a-board-takes-on).
- `maxIterations` — safety cap on how many times a single worker loops back to claim again, not a cap across the board. Default `10000`.

A worker's result is not always the last word on its task. A coordinator can cancel the task while the worker runs. The worker can mark the task done itself partway through. The claim can expire and another worker can pick the task up. In each case the worker comes back with a result for a task that has already moved on.

The board drops those results. A cancel stays cancelled, output the worker recorded for itself stays, and a second worker's claim is left alone. The drop is silent and affects exactly one task: the rest of the board keeps draining, and under `onError: "fail"` the error that surfaces is the worker's own rather than a conflict on the write-back.

A task can also keep returning to `pending` without ever settling. `maxAttempts` bounds ordinary retries, because `attempts` climbs on every claim until the budget runs out. The paths that re-pend a task *without* advancing `attempts` (`reclaim()`, `unblock`, `resumeFromReview`) never consume that budget, so if one of them runs in a loop against a worker that keeps failing, the task is re-dispatched each cycle instead of settling.

Two board-level bounds end that, and they answer different questions. `maxTotalRetries` bounds what the board **spends**: it counts failure retries across every task, and at the bound the next failing task settles instead of re-dispatching. `maxIterations` guarantees the board **terminates**: it counts loop revolutions per worker, including idle polls that claim nothing, so it cannot tell a healthy board from a failing one and is sized never to fire in normal operation. At `concurrency: 4` a board can spend four times `maxIterations` before every worker has tripped. Neither of the paths above consumes the retry budget, so on a board where the loop comes from `reclaim()` or `unblock`, `maxIterations` is still what ends it.

## Bounding how much work a board takes on

`concurrency` paces how many tasks run at once. It says nothing about how many can be *created*, so a coordinator that plans badly can queue far more work than anyone intended. The board's bounds sit at three scopes:

- `maxEnqueuedTasks` (default `100`) — how many tasks may be **added while others are still waiting**. Checked when a task is created, against the resulting `pending` count, so a slot comes back when its task leaves `pending` by completing, erroring, or being cancelled. A task that cannot run, such as one stranded behind a failed dependency, stays `pending` and keeps its slot however long the board drains.
- `maxTotalTasks` (default `500`) — how many tasks the board may **ever hold**, completed and cancelled ones included. Never refunded by draining, so it also catches a board that keeps draining and re-queueing.
- `maxTotalRetries` (default `50`) — how many failure retries the board may **authorize in total**, across every task.
- `concurrency` (default `4`) — how many run at the same time.

Creating a task past either bound throws a `TaskCapExceededError` carrying `cap` (`"enqueued"` or `"total"`), `limit`, and `attempted`. Nothing is written. A batch `addTasks` is all-or-nothing: if the batch would cross a bound, none of it lands. On a delegation board the model-facing `addTask` tool returns a soft `{ ok: false, error: "enqueued_task_cap_exceeded" }` or `"total_task_cap_exceeded"` instead of throwing. Draining frees enqueue slots, but only for tasks that can actually run, and it gives nothing back against the lifetime bound. What a coordinator should do about each is in [Delegation](../skills/delegation#how-much-work-the-board-will-take-on).

### Bounding the retries

The two bounds above count tasks the board *creates*. A retry does not create a task, it re-runs one that already exists, so a task that keeps failing keeps costing model calls while both counts hold still. `maxTotalRetries` is the bound on that.

```ts
const board = taskBoard({
  name: "research",
  workers,
  maxTotalRetries: 200,
});
```

It counts failure retries across the whole board. When the count reaches the bound, the next task that fails goes to `errored` instead of back to `pending`, with an error naming the board's budget, and its `error` reads:

```
worker timed out — not retried: collection "research" has spent its retry budget of 200 (maxTotalRetries). Raise it, or pass null to opt out.
```

The task is settled, not parked: the drain counts it as resolved and the board finishes normally. Set `null` for no bound at all, or `0` to run every task once and never retry. A first attempt is never refused, at any value.

Only failure retries count. `reclaim()`, `unblock`, and `resumeFromReview` also return a task to `pending`, and none of them spends the budget.

The budget is spent when a retry is granted, not when it runs. If a re-dispatched task is never picked up again because its worker died or its lease expired, the retry still counts.

On the durable (resource-backed) backing the retry count is accurate but the bound is not enforced. The board reports which limit was in force, so you can tell the two apart without inferring anything from the count.

Every task carries its own record of this in `task.retryLedger`:

```ts
const task = collection.get(id);
task.retryLedger;   // { granted: 2, deniedByBudget: false }
```

`granted` is how many retries this task was authorized. `deniedByBudget` is `true` once one was refused because the board's budget was spent. The field is absent on a task that has never failed, and on tasks stored before the field existed, so read it as `task.retryLedger?.granted ?? 0`.

Counting starts when you upgrade to a version that has the field. A durable task that had already retried comes back with a count of zero rather than a reconstructed history.

When a board's completion item reports `terminationReason: "retry-budget-exhausted"`, the budget is what stopped it:

```ts
// task-board-meta, status: "completed"
{
  terminationReason: "retry-budget-exhausted",
  maxTotalRetries: 200,
  counts: { total: 12, completed: 9, errored: 3, retries: 200 },
}
```

`maxTotalRetries` on that item is the limit the board's collection actually enforced, and `null` means none was. A board whose retry count happens to equal its limit but never refused a retry reports `"blocked-by-failures"`, the ordinary reason for a board that exited with unfinished tasks.

The enqueue bound applies only **when a task is created**. Tasks also return to `pending` through the lifecycle, via a retry under `maxAttempts`, an `unblock`, a `resumeFromReview`, or a reclaimed lease, and none of those paths is bounded. So `pending` can sit above `maxEnqueuedTasks` for a while. `maxTotalTasks` is the hard ceiling.

### How long the counts last

Neither bound is a stored counter. Both are computed when a task is created, from the board's stored task map: the total is that map's size, the enqueue count is how many of its tasks are `pending`. So the counts last exactly as long as the storage, which depends on the backing:

- **Request-backed** (the default) — the tasks live on the request, so a new request starts empty and both counts start from zero.
- **Sequencer-backed, resumed from a checkpoint** — the sequencer restores its whole state on resume, and the task map is part of that state. The counts come back with it, so a wave of new tasks after a resume is checked against the tasks that were already there, not against an empty board.
- **Durable (resource-backed)** — no bound is enforced. `maxTotalRetries` is the one that behaves differently rather than simply being absent: the retry count on this backing is accurate, and only the bound is missing. The board's completion item reports `maxTotalRetries: null` there, so a non-zero retry count never implies a budget applied. What the resource layer gives you instead is `maxInstances` on `defineTaskCollection`, and that is a capacity limit rather than a lifetime ceiling: it caps how many task instances the collection **holds at once**, and creating one past it throws. Deleting an instance through the resource collection frees the slot again, so a board that deletes and re-queues can create more tasks over its life than `maxInstances` ever allows at one moment. Creation here also goes one instance at a time, so a batch that crosses the limit stops partway and the tasks made before it stay; the all-or-nothing behavior above belongs to the request and sequencer backings only.

`backing: "sequencer"` names the shape of the state reference the tasks are stored in, not the kind of block it hangs off. Any block that holds its own state can supply one, and only a sequencer block checkpoints. See [Block State → The durability boundary](../advanced/block-state#the-durability-boundary).

A delegation board is where the two come apart: it uses the sequencer backing, but its tasks live on the coordinator generator's own state rather than a sequencer's. It does not checkpoint, so its tasks and counts start from zero after a resume.

### One writer, or hand every writer the bounds

The bounds are carried by the collection reference the board resolved. Resolving the same storage a second time gives you a *different* reference, and it enforces only what it was built with. So a block that calls `getOrCreateTaskCollection` itself, against a board's `collectionId`, writes past the board's bounds unless it is given them:

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

`createApplyReplan` is one of the blocks that can land on either side of that line, and it takes two shapes:

- With `capability: board.capability`, it reads and writes through the board's own reference, so the board's bounds apply.
- With only `name`, it resolves a request-backed collection under that id and enforces no bounds, because nothing in its options identifies which board it is writing to.

Pass the capability when you want replanned tasks to respect the board's bounds. The bundled patterns do.

### Where the bounds apply

The bounds belong to the collection, so the board applies them only to a collection it builds itself: the request default and the sequencer opt-in. Per the previous section, they also reach only writers that go through the board's own reference. If you **supply** a collection (a `defineTaskCollection`, or a factory), the board applies nothing and checks nothing; that collection carries whatever bounds it was built with and stays the sole authority. Passing the cap options alongside a supplied `collection` throws at `taskBoard()` construction, because a board cannot retrofit limits onto a collection it did not construct. Configure them where the collection is created instead. Here that is a block running *inside* the sequencer that owns the tasks slot, so `ctx.sequencer` is that container:

```ts
const tasks = await getOrCreateTaskCollection({
  ctx,
  backing: "sequencer",
  collectionId: "my-board",
  sequencer: ctx.sequencer!,
  maxTotalTasks: 2000,
});
```

Which state ref to pass depends on where your code runs, and getting it wrong fails quietly rather than loudly: you get a working collection over the wrong slot. From a block *inside* the sequencer, pass `ctx.sequencer`. From a tool running as a child of a generator that owns the board, pass `ctx.parent` (see [wiring a bounded board by hand](../skills/delegation#board-and-overrides)).

The cap options exist on the sequencer and request backing specs only. Passing `maxTotalTasks` or `maxEnqueuedTasks` with `backing: "resource"` is a TypeScript error, not a ceiling that quietly does nothing.

### If the defaults are too low for your board

A board that needs to create more than 500 tasks in a run, or hold more than 100 `pending` at once, is refused the task that crosses the line. Raise the bound, or turn it off with `null`:

```ts
// Raise it.
const board = taskBoard({ name: "big", workers, maxTotalTasks: 5_000 });

// Or opt out of one axis entirely.
const unbounded = taskBoard({ name: "streaming", workers, maxEnqueuedTasks: null });
```

Omitting an option is not an off switch; it reapplies the default. `null` is the off switch. Otherwise each option takes a positive integer, and `0`, a negative, a fraction, `NaN`, `Infinity`, or an enqueue bound above the lifetime ceiling all throw when the board is constructed.

## Stream items emitted

A board run produces two item streams:

- `task-change` — one item per task transition (`added`, `claimed`, `completed`, `errored`, `cancelled`, and more). Keyed by `${collectionId}/${taskId}`, so the latest change for a task replaces the previous one.
- `task-board-meta` — board-level state, keyed by `collectionId`. Emitted twice per run, once with `status: "active"` at start and once with `status: "completed"` at end. The completed item carries `terminationReason` and the `counts` snapshot.

Renderers like `<TaskPlan />` subscribe to both: `task-board-meta` for the board-level status header, `task-change` for per-task rows.

## Commanding the board with its capability

You pick where a board stores its tasks once, on `taskBoard({...})`. After that, the only thing other blocks touch is `board.capability`. List it in a block's `uses` and the board's tasks are on `ctx.cap.<name>`, the board name verbatim. Hyphenated names work through bracket access (`ctx.cap["my-board"]`).

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

The accessor has `addTask`, `addTasks`, `getTask`, `listTasks`, `countTasks`, and `tasks()` (the full `TaskCollectionRef` when you need a method the sugar doesn't cover).

A sibling or outer step can add tasks before `board.drain` runs, and the board picks them up on its first pass. It can also add them *while* the board is draining: an idle worker takes the new task promptly rather than waiting out its poll interval. Both work on all three backings, as long as the add and the drain happen in the same request.

Each sugar call re-resolves the collection, so reads always reflect the latest state. That costs something per call on every backing. When you need several reads in a row with no writes between them, grab the ref once with `const tasks = await ctx.cap.<name>.tasks()` and read from it.

## Collection backing

A board stores its tasks in one of three places. You choose once; nothing downstream restates it.

- **Request (default)** — tasks live on `ctx.request` and survive every block boundary in the request, including re-entry across an outer loop (Plan and Execute replans this way) and adds from sibling steps before or during the drain. Omit `collection` entirely, or pass `{ collectionId }` to name it (the id defaults to the board name).
- **Durable (resource-backed)** — tasks outlive the request. Declare the collection with `defineTaskCollection` and pass it as `collection`; the board registers and resolves it for you. Don't count on a running request seeing a write made by another request; a later request reads it.
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

If you write that ref by hand, `complete` and `fail` have to accept and honor the optional `TaskTransitionOptions` third argument. TypeScript won't catch it if you don't: a two-argument `complete(id, output)` satisfies the interface structurally, and JavaScript drops the extra argument without a word. The board passes those options on every write-back, so a result landing on a task someone else already settled is declined rather than thrown. A ref that ignores them throws instead, and that error fails the whole drain rather than the one task, leaving every task the board hadn't claimed yet unrun. See [recording a result that may no longer apply](task-substrate.md#recording-a-result-that-may-no-longer-apply).

## Durable boards that survive across turns

When a board's tasks must persist past the request, say a user's standing to-do list or an org-wide work queue, declare a durable collection with `defineTaskCollection` and hand it to the board. The tasks live as resource instances at the scope you name (`session`, `user`, or `org`).

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

`id` names the collection (it forms the resource pattern and the board's `collectionId`), `scope` sets its lifetime, and `stateSchema` types each task's `input` payload. The rest of the task envelope is validated for you. The board installs the collection on both its own drain and `board.capability`, so a sibling action that lists `board.capability` in `uses` reads and writes the same durable tasks.

## See also

- [Task substrate](./task-substrate.md) — the `Task` record, the status state machine, and the collection API underneath.
- [GoalSeekLoop](./goal-seek-loop) — a config-driven, judge-gated loop over the board's drain.
- [Block State](../advanced/block-state) — the primitive behind the board's sequencer-scoped task collection; see [The durability boundary](../advanced/block-state#the-durability-boundary) for what survives a resume.
- [Parallel Tasks](../patterns/parallelTasks) — single-pass fan-out wrapper on top of the board.
- [Supervisor](../patterns/supervisor) — per-task review wrapper.
- [Plan and Execute](../patterns/plan-and-execute) — replan-loop wrapper.
- [Flow policy](./flow-policy) — the observation ledger, `priorWork` shaping, and tool-result caching.
- [Patterns Overview](../patterns/overview) — when to use which pattern.

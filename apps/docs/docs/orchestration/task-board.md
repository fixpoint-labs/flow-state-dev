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

A task whose `assignee` doesn't match any worker fails per `onError`.

## Concurrency and error handling

- `concurrency` — max parallel workers. Default `4`.
- `onError: "skip" | "fail"` — `"skip"` records the error on the offending task; siblings continue. `"fail"` rethrows; the board fails. Default `"skip"`.
- `maxAttempts` (per task) — set on a task's `TaskInit`, not on the board. While `attempts < maxAttempts`, a failed task is re-dispatched instead of left errored. There is no board-level retry cap.
- `maxIterations` — board-level safety cap on total dispatch loops before the board stops. Default `10000`.

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

The accessor has `addTask`, `addTasks`, `getTask`, `listTasks`, `countTasks`, and `tasks()` (the full `TaskCollectionRef` when you need a method the sugar doesn't cover). Because the default backing is request-scoped, a sibling or outer step can add tasks *before* `board.drain` runs — the board picks them up on its first pass.

Each sugar call re-resolves the collection so reads always reflect the latest state. That's cheap for the request and sequencer backings. For a durable (resource-backed) board it re-hydrates on every call, so when you need several reads in a row without writes between them, grab the ref once with `const tasks = await ctx.cap.<name>.tasks()` and read from it.

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

## See also

- [GoalSeekLoop](./goal-seek-loop) — a config-driven, judge-gated loop over the board's drain.
- [Block State](../advanced/block-state) — the primitive behind the board's sequencer-scoped task collection.
- [Parallel Tasks](../patterns/parallelTasks) — single-pass fan-out wrapper on top of Task Board.
- [Supervisor](../patterns/supervisor) — per-task review wrapper.
- [Plan and Execute](../patterns/plan-and-execute) — replan-loop wrapper.
- [Flow Policy](./flow-policy) — dispatcher policy and `priorWork` shaping.
- [Patterns Overview](../patterns/overview) — when to use which pattern.

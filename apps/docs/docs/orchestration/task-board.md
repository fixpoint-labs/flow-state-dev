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

// `board.block` plugs into a parent sequencer as a normal step.
```

Defaults: concurrency `4`, `dispatcher: "topological"`, `onIdle: "complete-or-blocked"`, `onError: "skip"`.

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

`"complete-or-blocked"` ends the drain when pending tasks can no longer run, but it leaves those tasks `pending`. To fold them into a terminal status, `.tap()` the `createCascadeSkipDependents` building block after `board.block`:

```ts
import { taskBoard, createCascadeSkipDependents } from "@flow-state-dev/orchestration/task-board";

const board = taskBoard({ name: "research", collection: { backing: "request", collectionId: "research" }, workers });
const cascadeSkip = createCascadeSkipDependents({ name: "research" });

sequencer({ name: "research" })
  .step(board.block)
  .tap(cascadeSkip); // transitively cancels pendings whose deps errored
```

It walks the dependency graph from every `errored` task, cancelling each pending whose deps include a failed task, and repeats to a fixed point so multi-level chains (`a → b → c`) drain in one pass. Cancelled tasks are stamped with a `"skipped"` label. The `name` must match the board's `collectionId` so both operate on the same collection. `planAndExecute` and `supervisor` wire this in for you.

## Dispatcher modes

The dispatcher decides which `pending` task gets claimed next. Three built-ins:

- `"topological"` (default) — claims a `pending` task only when all of its `deps` are `completed`. Cycles in `deps` are rejected at task-add time.
- `"fifo"` — first-added-first-claimed, ignores `deps` (use for flat fan-out).
- `"priority"` — claims the highest-priority `pending` task; ignores `deps`.

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

## Collection backing: sequencer vs request

The default `collection: { collectionId: "x" }` puts the `tasks` record on the board's own sequencer state. That state lives for one invocation of `board.block`. Calling the board twice from a parent sequencer gives two independent collections.

For boards re-entered across an outer loop (Plan & Execute does this for replanning), opt into request-scoped backing:

```ts
const board = taskBoard({
  name: "replan-board",
  collection: { backing: "request", collectionId: "replan-board" },
  // ...
});
```

The collection then lives on `ctx.request` and survives every block boundary in the request. CAS semantics are identical to the sequencer-state default. For cross-request lifetime (session, user, org), pass a caller-supplied factory.

## See also

- [Parallel Tasks](../patterns/parallelTasks) — single-pass fan-out wrapper on top of Task Board.
- [Supervisor](../patterns/supervisor) — per-task review wrapper.
- [Plan and Execute](../patterns/plan-and-execute) — replan-loop wrapper.
- [Flow Policy](./flow-policy) — dispatcher policy and `priorWork` shaping.
- [Patterns Overview](../patterns/overview) — when to use which pattern.

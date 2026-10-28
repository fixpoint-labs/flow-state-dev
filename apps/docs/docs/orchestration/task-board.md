---
title: Task board
sidebar_position: 3
sidebar_label: Task board
description: A pool of workers that claim ready tasks from a shared TaskCollection, respect dependencies, and drain until a termination rule you choose says stop.
---

import Figure from "@site/src/components/Figure";
import TaskBoardPartsDrawing from "./task-board-parts.svg";

# Task board

Task board is the building block underneath Parallel Tasks, Supervisor, and Plan and Execute. It runs a pool of workers that pull from a shared `TaskCollection`, respects task dependencies, and drains until the collection is finished: either every task completed, or nothing left can run.

## When to use a task board

Start with a wrapper pattern when its shape fits:

- [**Parallel Tasks**](../patterns/parallelTasks): known-upfront fan-out, no review loop, one drain.
- [**Supervisor**](../patterns/supervisor): per-task quality review before write-back.
- [**Plan and Execute**](../patterns/plan-and-execute): re-planning across drains based on partial results.
- [**Round Robin**](../patterns/round-robin): fixed-roster turn-taking.
- [**Debate**](../patterns/debate): paired adversarial contributors.

Reach for the board directly when none of those fit:

- You need a long-running board that accepts new tasks from outside the initial seed list (Parallel Tasks decomposes once and stops).
- You need a custom worker registry, dispatcher, or termination rule that none of the wrappers expose.
- You're building a new coordination pattern and want a tested concurrent drain underneath it.

The page starts with the board you build and drain in code. Later sections cover the [task tools](#one-task-five-tools) a model uses to work a board, and boards whose [assignees dispatch](#assignees-that-dispatch) their tasks to other sessions.

## The parts

The board is a handle you drain. Its tasks are rows in a collection. Workers are blocks keyed by assignee.

<Figure svg={TaskBoardPartsDrawing} caption="Board, task collection, worker: where each lives" description={"The board is a handle that drains, the task collection holds the rows, and workers are blocks keyed by assignee"} />

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

Defaults: a plan board (`mode: "plan"`), request-scoped storage (`collection` is optional), concurrency `4`, `dispatcher: "topological"`, `onIdle: "complete-or-blocked"`, `onError: "skip"`.

## How a drain runs

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

## Plan boards and delegation boards: `mode`

A board either runs its tasks or hands them out, and you say which with `mode`. It decides whether the drain waits for the work.

- **`"plan"`** (the default) waits on every task. When the drain returns, every task it could run has ended. Most plan boards run every task inline, as the patterns do; a plan board can also [hand a row to another session](#a-plan-board-that-hands-a-row-over) and wait on it there.
- **`"delegation"`** hands every task to another session through an [assignee that dispatches](#assignees-that-dispatch), and the drain waits on none of them: it returns once each task is on its way, and the session working a task settles it.

A board has one mode, so its assignees all agree with it; `taskBoard()` throws when they don't. See [What the board requires](#what-the-board-requires).

`board.mode` reads the mode back. A [goal-seek loop](./goal-seek-loop.md) refuses a delegation board, because its judge would rule on work that is still running.

## Worker registry

Provide workers in either of these shapes:

- **Single uniform worker**: one block runs every claimed task. Pass it directly as `workers`.
- **Registry**: a `{ [assignee]: block }` map. Each task carries `assignee: "name"`; the substrate dispatches to the matching worker.

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
  // instead of failing. Reached only on a miss; declared workers are untouched.
  defaultWorker: genericWorker,
});
```

There is no `defaultWorker` unless you pass one.

The task tools can refuse a bad assignee when the task is filed instead, given a roster; see [Changing tasks from outside a run](#changing-tasks-from-outside-a-run). Without a roster every assignee is accepted, and an unmatched one takes the fallback path above.

On a delegation board, a registry assignee runs its tasks somewhere other than the request that claimed them, and so can `defaultWorker`. See [Assignees that dispatch](#assignees-that-dispatch).

## Dispatcher modes

The dispatcher decides which `pending` task gets claimed next. No dispatcher claims a task whose `deps` aren't all `completed`; that rule lives on the collection's `claim`. So the built-in modes differ only in how they order the tasks that are already ready:

- `"topological"` (default): earliest-added ready task first.
- `"fifo"`: the same ordering. The name reads better for a flat fan-out with no deps.
- `"priority"`: highest-`priority` ready task first, ties break on earliest-added. An unset `priority` counts as 0.

Those three strings are the only names `dispatcher` accepts. It also takes any `TaskDispatcher` instance: one of the three that `@flow-state-dev/orchestration` exports, or your own. See [Task substrate → Dispatchers](./task-substrate.md#dispatchers) for what each one picks, and [Flow policy](./flow-policy) for the observation ledger, `priorWork` shaping, and tool-result caching.

The `dispatcher` option only orders claims. The `dispatcher()` block from `@flow-state-dev/core` is a different thing: an [assignee that dispatches](#assignees-that-dispatch) its tasks to another session.

## Dependencies

A task's `deps` name the tasks that must complete before it can be claimed. A dependency the board could never satisfy is refused when it is filed: an id that names no task on the board, a dependency that has already failed or been cancelled, or `deps` that loop back to the task. The add throws a `TaskFilingRefusedError` and files nothing; in a `createTasks` batch or `initialTasks`, the ids in the same batch count. See [Task substrate → Dependencies are checked when you file](./task-substrate.md#dependencies-are-checked-when-you-file).

### When a dependency fails

A task that fails for good, or is cancelled, takes its open dependents with it. The collection cancels every task that depends on it, then every task that depends on those, and labels each one `skipped` with `causedBy` naming the task that ended. There is nothing to wire: every board does this, whichever backing it runs on.

The cascade is paid in the same call as the ending. If the process dies between the two, the debt is on the stored row, and the board's next drain pays it before it claims anything. A task that is retried owes nothing yet, because the retry may still succeed.

On a board that [dispatches](#assignees-that-dispatch), the failed or cancelled task's notice to the session that filed it lists the dependents it cancelled, in `cancelled`. See [Hearing how a task ended](#hearing-how-a-task-ended).

## Termination: `onIdle` modes

A board needs a rule for when to stop. That rule is `onIdle`.

### `"complete-or-blocked"` (default)

Exits when one of the following is true on a worker's `checkBoard` iteration:

- **Drained**: no `pending` or `in_progress` tasks remain.
- **Blocked**: no worker is running a task, and no `pending` task has all of its `deps` `completed`. Nothing is claimable, and no in-flight work is left to change the dep graph.

A task [waiting on a person](#a-task-waiting-on-a-user) is still `in_progress`, so the board isn't drained while it waits. Nothing the board does moves it, though: the person's answer does. It doesn't count as a running worker either, so a board whose only open tasks wait on a person stops as **blocked** and leaves them as they are. When the answer comes, the task takes its next turn and a later drain picks up whatever depends on it.

The final `task-board-meta` item carries a `terminationReason` field saying which case it was:

- `"all-completed"`: every task reached `completed` (or the board started empty).
- `"blocked-by-failures"`: at least one task did not reach `completed`. Could be `errored`, `cancelled`, or `held` waiting on a release.
- `"retry-budget-exhausted"`: the board refused a retry because `maxTotalRetries` was spent. See [Bounding the retries](#bounding-the-retries).
- `"dispatched"`: every task still outstanding is running in a dispatch run. The board finished its own part and the work continues in the background, so this is a success, not a stall. Only a board with an [assignee that dispatches](#assignees-that-dispatch) reports it, and `counts.in_progress` is how many are still running.
- `"waiting-on-a-user"`: the board stopped because the work it has left [waits on a user](#a-task-waiting-on-a-user): a question or confirm, or a run stopped for a review or approval. Nothing went wrong and nothing is finished. The next drain after the answer picks the work back up.

A refused retry outranks the others when a board ends up in more than one of these states at once. A failed, cancelled or `held` task beside one that waits on a user still reports `"blocked-by-failures"`, and so does a task whose dependencies will never complete, even once the person answers. A task that only depends on the waiting one does not change the reason.

```ts
// On the final task-board-meta item:
{
  component: "task-board-meta",
  data: {
    collectionId: "echo",
    status: "completed",
    terminationReason: "all-completed",   // or "blocked-by-failures" | "retry-budget-exhausted"
                                          //  | "dispatched" | "waiting-on-a-user"
    maxTotalRetries: 50,
    counts: {
      total: 2,
      completed: 2,
      errored: 0,
      cancelled: 0,
      held: 0,
      in_progress: 0,
      pending: 0,
      retries: 0,
    },
  },
}
```

The choice between `"all-completed"` and `"blocked-by-failures"` comes from the counts (`completed === total`), so in `"wait"` mode a `shouldExit` that fires while tasks are still running reports `"blocked-by-failures"` even though nothing failed. Read `counts` when you override termination. The other two are not count comparisons: `"retry-budget-exhausted"` appears only when a retry was actually refused, and `"dispatched"` only when every outstanding task is one a dispatch run is holding.

### `"complete"`

Exits only when no `pending` or `in_progress` tasks remain. Use it when a pending task with a non-`completed` dep is a transient state: something outside the worker pool will eventually mark the dep complete (an external service, an HITL approval pumping a queue).

A board in this mode never decides on its own that it is stuck. If a dep will never resolve, each worker keeps cycling until it hits `maxIterations` (default `10000`, counted per worker). Pick the mode when the board really is supposed to wait.

A task waiting on a person is `in_progress`, so it keeps this mode's loop alive until it is answered.

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

## Concurrency and error handling

- `concurrency`: max parallel workers. Default `4`.
- `onError: "skip" | "fail"`: `"skip"` records the error on the offending task; siblings continue. `"fail"` rethrows; the board fails. Default `"skip"`.
- `maxAttempts` (per task): set on a task's `TaskInit`, not on the board. While `attempts < maxAttempts`, a failed task is re-dispatched instead of left errored.
- `maxTotalRetries` (default `50`): how many failure retries the board may authorize in total, across every task. See [Bounding the retries](#bounding-the-retries).
- `maxIterations`: safety cap on how many times a single worker loops back to claim again, not a cap across the board. Default `10000`.

Some failures would come back the same on every attempt, such as a run refused because its task names nothing it may work on. Retrying those only spends the attempts. A worker that knows this throws `TaskEndsForGoodError`, exported from `@flow-state-dev/orchestration/task-board`, naming the task it is working on. The board ends that task on this attempt, with the error's message as its reason. It ends `errored` by default, or `cancelled` if you construct the error with `{ ending: "cancelled" }`. Dependents and filed work are cascaded as for any other ending. The error only counts for the task it names. If a board inside your worker rethrows one about its own task, your task treats it as an ordinary failure and keeps its retries.

```ts
import { TaskEndsForGoodError } from "@flow-state-dev/orchestration/task-board";

// in a worker: input.taskId is the task this worker is running
throw new TaskEndsForGoodError("the task names no project", { taskId: input.taskId });
```

`onError` reaches an [assignee that dispatches](#assignees-that-dispatch) too, where there is no board run left to fail. `"fail"` fails the dispatch run that worker is running in, so it reports `failed`. `"skip"` leaves it reporting `completed`, with the error on the task as usual. See [What `status` tells you](../server/background-work#what-status-tells-you).

A worker's result is not always the last word on its task. A coordinator can cancel the task while the worker runs. The worker can mark the task done itself partway through. The claim can expire and another worker can pick the task up. In each case the worker comes back with a result for a task that has already moved on.

The board drops those results. A cancel stays cancelled, output the worker recorded for itself stays, and a second worker's claim is left alone. The drop is silent and affects exactly one task: the rest of the board keeps draining, and under `onError: "fail"` the error that surfaces is the worker's own rather than a conflict on the write-back.

### When the board cannot record a result

A task going wrong and the board failing to write down what happened are different events, and `onError` governs only the first.

Saving a result is two steps: the store commits the write, then the change is announced to everything watching the board. The second step can fail on its own, when a block reacting to task changes throws or a resource hook rejects, and by then the work is already saved. When that happens the board says so. It emits a `task-board-recorder-failure` item:

```ts
// A task-board-recorder-failure item:
{
  component: "task-board-recorder-failure",
  data: {
    collectionId: "research",
    taskId: "summarise-findings",
    recorder: "complete",   // "complete" or "fail": which settlement it was recording
    verdict: "committed",   // "committed" or "undetermined"
    error: "task-change subscriber threw",
  },
}
```

The item is persisted, so it is still there after the run. The [`chatAssistantRenderers`](/docs/ui/flow-aware-components#chatassistant) registry maps it to `false`, so it does not appear in a chat thread; read it off the run's items. `verdict` is what the board could establish about the write:

| `verdict` | Means |
| --- | --- |
| `committed` | The result is saved. Only the announcement failed. |
| `undetermined` | The board cannot tell whether the result was saved. |

Then the board run fails, after every other task has finished. `onError: "skip"` does not suppress it: `skip` governs tasks, not the board's own bookkeeping.

`undetermined` is never reported as "it wasn't saved". It is a permanent answer, not a transient one, and you get it in these cases:

- **On a task store you wrote yourself.** A store built against `TaskCollectionRef` keeps no record of which write landed, so the board can never answer better than `undetermined`. There is no way to opt in.
- **On rows a persistent store already held.** Rows written by an earlier release of the board carry no record of which write landed, and nothing adds one, so they answer `undetermined` for as long as they live. Rows the board creates give a definite answer.

A row the board is unsure about is handed back rather than left claimed, so it settles or returns to the queue on the same pass instead of waiting out its lease.

On an [assignee that dispatches](#assignees-that-dispatch) there is no batch to drain and no board run to defer to, so the failure fails the dispatch run itself, again regardless of `onError`.

Nothing retries a failed announcement. The item and that failure are the whole of what the board does about it.

## Collection backing

A board stores its tasks in one of four places. You choose once; nothing downstream restates it.

- **Request (default)**: tasks live on `ctx.request` and survive every block boundary in the request, including re-entry across an outer loop (Plan and Execute replans this way) and adds from sibling steps before or during the drain. Omit `collection` entirely, or pass `{ collectionId }` to name it (the id defaults to the board name).
- **Durable (resource-backed)**: tasks outlive the request. Declare the collection with `defineTaskCollection` and pass it as `collection`; the board registers and resolves it for you. Don't count on a running request seeing a write made by another request; a later request reads it.
- **Sequencer**: tasks live on the board's own sequencer state, which lasts one `board.drain` invocation. Opt in with `{ backing: "sequencer", collectionId }`. Calling the board twice gives two independent collections.
- **Factory**: tasks live in a store you manage. Pass a function `(ctx) => TaskCollectionRef` as `collection`; the rules for writing that ref are below.

```ts
// Request default: nothing to restate.
const board = taskBoard({ name: "research", workers });

// Sequencer opt-in: single-invocation, per-call state.
const board = taskBoard({
  name: "one-shot",
  collection: { backing: "sequencer", collectionId: "one-shot" },
  workers,
});
```

### A task store of your own

For a custom or externally managed store, pass a factory `(ctx) => TaskCollectionRef` as `collection`. If you write that ref by hand, `complete` and `fail` should accept and honor the optional `TaskTransitionOptions` third argument. TypeScript won't catch it if you don't: a two-argument `complete(id, output)` satisfies the interface structurally, and JavaScript drops the extra argument without a word. The board passes those options on every write-back, so a result landing on a task someone else already settled is declined rather than thrown.

A ref that ignores them throws instead, and the board contains that throw: it drops the late result and keeps draining. One misbehaving write-back costs one task, not every task the board hadn't claimed yet.

Containment is not a substitute for the guards. It fires on a throw. A stale write the state machine happens to permit, such as a worker reporting success on a task another worker has since taken over, doesn't throw. It commits, and it overwrites the result the current holder is about to record. Nothing outside your store can catch that, because the decision belongs inside the write. So honor the guards to protect your data. See [recording a result that may no longer apply](task-substrate.md#recording-a-result-that-may-no-longer-apply).

Write provenance is optional for a hand-written ref. A ref that leaves `revision`, `writeLog`, and `writeLogTruncated` unset is not wrong for it: callers asking [whether their write landed](task-substrate.md#telling-whether-your-write-landed) get `undefined`, which means "cannot tell", not "your write did not land".

### Durable boards that survive across turns

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

#### A board per conversation, worked on another flow

A `session`-scoped board with `sharedToLineage: true` can hand rows to a session on its own flow. It can't hand them to another flow: a task run there starts a lineage of its own, so it never finds the row. A `user`-scoped board does cross flows, but then every session of that user shares one set of rows, and one conversation's board runs another conversation's tasks.

To keep a board per conversation and still hand its rows to another flow, give a `user`-scoped collection a `partitionBy` function:

```ts
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";

const work = defineTaskCollection({
  id: "work",
  scope: "user",
  partitionBy: ({ sessionId, lineageId }) => `${sessionId}~${lineageId}`,
});
```

Rows are stored at the user's scope, under the partition the running session's function returns. A board resolved in one session reads, claims, waits on and settles only its own partition, and so do its task tools and its `taskToolActions`. When the board dispatches a row, the dispatch carries the partition, and the task entry on the other flow reads its one row there, with every check a board's own entry runs.

On the receiving flow, declare the same collection and serve the task entry with [`taskLedgers`](#a-task-entry-served-by-many-boards). Its `resolve` gets the partition as a third argument; resolve the ledger at it:

```ts
import { taskLedgers } from "@flow-state-dev/orchestration/task-board";
import { getOrCreateTaskCollection, resolveResourceCollection } from "@flow-state-dev/orchestration/tasks";

const from = taskLedgers({
  name: "conversation-work",
  resolve: async (ledgerId, ctx, partition) => {
    const collection = resolveResourceCollection(ctx, ledgerId);
    if (ledgerId !== work.id || collection === undefined || partition === undefined) return undefined;
    return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: work.id, collection, partition });
  },
});
```

The function is handed the running session's server-set identity, `{ sessionId, lineageId, userId, orgId, tenantId }`, and nothing a caller sends. Return a value a caller can't set. A session id is reused when a session is deleted and created again, so a partition built from the id alone hands the new session its predecessor's rows. `lineageId` is minted when the session's record is created, so the two together name one life of the session, and a recreated session starts with an empty board.

The rows sit in the user's own storage, which every flow of theirs reads, even on a flow that keeps its other user state to itself with `isolateUserState`. Task ids on a partitioned ledger are a single path segment, with no `/`, and the collection doesn't take `maxInstances`.

## Bounding how much work a board takes on

`concurrency` paces how many tasks run at once. It says nothing about how many can be *created*, so a coordinator that plans badly can queue far more work than anyone intended. The board's bounds:

- `maxEnqueuedTasks` (default `100`): how many tasks may be **added while others are still waiting**. Checked when a task is created, against the resulting `pending` count, so a slot comes back when its task leaves `pending` by completing, erroring, or being cancelled. A task that cannot run, such as one stranded behind a failed dependency, stays `pending` and keeps its slot however long the board drains.
- `maxTotalTasks` (default `500`): how many tasks the board may **ever hold**, completed and cancelled ones included. Never refunded by draining, so it also catches a board that keeps draining and re-queueing.
- `maxTotalRetries` (default `50`): how many failure retries the board may **authorize in total**, across every task.
- `concurrency` (default `4`): how many run at the same time.

Creating a task past `maxEnqueuedTasks` or `maxTotalTasks` throws a `TaskCapExceededError` carrying `cap` (`"enqueued"` or `"total"`), `limit`, and `attempted`. Nothing is written. A batch `createTasks` is all-or-nothing: if the batch would cross a bound, none of it lands. The model-facing `createTask` task tool returns a soft `{ ok: false, error: "enqueued_task_cap_exceeded" }` or `"total_task_cap_exceeded"` instead of throwing. Draining frees enqueue slots, but only for tasks that can actually run, and it gives nothing back against the lifetime bound.

The enqueue bound applies only **when a task is created**. Tasks also return to `pending` through the lifecycle, via a retry under `maxAttempts`, a `release`, or a reclaimed lease, and none of those paths is bounded. So `pending` can sit above `maxEnqueuedTasks` for a while. `maxTotalTasks` is the hard ceiling.

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

The task is settled: the drain counts it as resolved and the board finishes normally. Set `null` for no bound at all, or `0` to run every task once and never retry. A first attempt is never refused, at any value.

Only failure retries count. `reclaim()` and `release` also return a task to `pending`, and neither spends the budget.

The budget is spent when a retry is granted, not when it runs. If a re-dispatched task is never picked up again because its worker died or its lease expired, the retry still counts.

A task can also keep returning to `pending` without ever settling. `maxAttempts` bounds ordinary retries, because `attempts` climbs on every claim. `reclaim()` re-pends a task *without* advancing `attempts` or spending the retry budget, so if it runs in a loop against a worker that keeps failing, the task is re-dispatched each cycle. On such a board, `maxIterations` is what ends it. It bounds how long each worker loops, idle polls that claim nothing included, so at `concurrency: 4` a board can spend four times `maxIterations` before every worker has tripped. A task handed back out because its worker died is not one of those paths: it is bounded by its own allowance and settles `errored` once that runs out.

On the durable (resource-backed) backing, retries are counted but the bound is not enforced. The completion item reports `maxTotalRetries: null` there.

Every task carries its own record of this in `task.retryLedger`:

```ts
const task = collection.get(id);
task.retryLedger;   // { granted: 2, deniedByBudget: false }
```

`granted` is how many retries this task was authorized. `deniedByBudget` is `true` once one was refused because the board's budget was spent. The field is absent on a task that has never failed, so read it as `task.retryLedger?.granted ?? 0`.

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

### How long the counts last

No count is a stored counter. All three are read off the board's stored task map at the moment the bound is checked: the total is that map's size, the enqueue count is how many of its tasks are `pending`, and the retry count is the sum of every task's `retryLedger.granted`. The two creation counts are read when a task is created; the retry count is read when a task fails. All three last exactly as long as the map does, which depends on the backing:

- **On the request** (the default): the tasks live on the request, so a new request starts empty and all three counts start from zero.
- **On a state you pass**: the counts last as long as that state does. A sequencer's state is restored from its checkpoint on resume, task map included, so work after a resume is checked against the tasks already there. A generator's own state is not checkpointed, so a board kept there starts its tasks and counts from zero after a resume. See [Block State → The durability boundary](../advanced/block-state#the-durability-boundary).
- **Durable (resource-backed)**: no bound is enforced. What the resource layer gives you instead is `maxInstances` on `defineTaskCollection`, and that is a capacity limit rather than a lifetime ceiling: it caps how many task instances the collection **holds at once**, and creating one past it throws. Deleting an instance through the resource collection frees the slot again, so a board that deletes and re-queues can create more tasks over its life than `maxInstances` ever allows at one moment. Creation here also goes one instance at a time, so a batch that crosses the limit stops partway and the tasks made before it stay; the all-or-nothing behavior above belongs to the request and sequencer backings only.

### One writer, or hand every writer the bounds

The bounds are carried by the collection reference the board resolved. Resolving the same storage a second time gives you a *different* reference, and it enforces only what it was built with. So a block that calls `getOrCreateTaskCollection` itself, against a board's `collectionId`, writes past the board's bounds unless it is given them:

```ts
const board = taskBoard({ name: "research", workers });

// This second reference is unbounded, even though the board has bounds.
const loose = await getOrCreateTaskCollection({ ctx, backing: "state", collectionId: "research" });

// Hand it the board's own resolved bounds and it enforces them.
const bounded = await getOrCreateTaskCollection({
  ctx,
  backing: "state",
  collectionId: "research",
  ...board.caps,
});
```

`taskBoard` and `getOrCreateTaskCollection` name backings differently. A board takes `collection: { backing: "request" }` or `{ backing: "sequencer" }`, a `defineTaskCollection()` value, or a factory. `getOrCreateTaskCollection` takes `backing: "state"` or `backing: "resource"`. With `backing: "state"` and no `state` field, the tasks live on the request, which is where a default board keeps them.

`board.caps` is on the handle for exactly this. Most code never needs it: reaching the board through `board.capability` (or letting the board's own seed and drain do the writing) is already bounded. It matters when you resolve the collection yourself.

`createApplyReplan` is one of the blocks that can land on either side of that line:

- With `capability: board.capability`, it reads and writes through the board's own reference, so the board's bounds apply.
- With only `name`, it resolves a request-backed collection under that id and enforces no bounds, because nothing in its options identifies which board it is writing to.

Pass the capability when you want replanned tasks to respect the board's bounds. The bundled patterns do.

### Where the bounds apply

The bounds belong to the collection, so the board applies them only to a collection it builds itself: the request default and the sequencer opt-in. Per the previous section, they also reach only writers that go through the board's own reference. If you **supply** a collection (a `defineTaskCollection`, or a factory), the board applies nothing and checks nothing; that collection carries whatever bounds it was built with and stays the sole authority. Passing the cap options alongside a supplied `collection` throws at `taskBoard()` construction, because a board cannot retrofit limits onto a collection it did not construct. Configure them where the collection is created instead. Here that is a block running *inside* the sequencer that owns the tasks slot, so `ctx.sequencer` is that container:

```ts
const tasks = await getOrCreateTaskCollection({
  ctx,
  backing: "state",
  state: ctx.sequencer!,
  collectionId: "my-board",
  maxTotalTasks: 2000,
});
```

Which state ref to pass depends on where your code runs, and getting it wrong fails quietly rather than loudly: you get a working collection over the wrong slot. From a block *inside* the sequencer, pass `ctx.sequencer`. From a tool running as a child of a generator that owns the board, pass `ctx.parent`.

The cap options exist on `backing: "state"` only. Passing `maxTotalTasks` or `maxEnqueuedTasks` with `backing: "resource"` is a TypeScript error, not a ceiling that quietly does nothing.

### If the defaults are too low for your board

A board that needs to create more than 500 tasks in a run, or hold more than 100 `pending` at once, is refused the task that crosses the line. Raise the bound, or turn it off with `null`:

```ts
// Raise it.
const board = taskBoard({ name: "big", workers, maxTotalTasks: 5_000 });

// Or opt out of one axis entirely.
const unbounded = taskBoard({ name: "streaming", workers, maxEnqueuedTasks: null });
```

Omitting an option is not an off switch; it reapplies the default. `null` is the off switch. Otherwise each option takes a positive integer, and `0`, a negative, a fraction, `NaN`, `Infinity`, or an enqueue bound above the lifetime ceiling all throw when the board is constructed.

## Commanding the board with its capability

You pick where a board stores its tasks once, on `taskBoard({...})`. After that, the only thing other blocks touch is `board.capability`. List it in a block's `uses` and the board's tasks are on `ctx.cap.<name>`, the board name verbatim. Hyphenated names work through bracket access (`ctx.cap["my-board"]`).

```ts
const board = taskBoard({ name: "research", workers });

const enqueue = handler({
  name: "enqueue-more",
  inputSchema: z.unknown(),
  uses: [board.capability],
  execute: async (_input, ctx) => {
    await ctx.cap.research.createTask({ goal: "check competitors" });
    const open = await ctx.cap.research.countTasks({ status: "pending" });
    return { open };
  },
});
```

The accessor has `createTask`, `createTasks`, `getTask`, `listTasks`, `countTasks`, and `tasks()` (the full `TaskCollectionRef` when you need a method the sugar doesn't cover).

A sibling or outer step can add tasks before `board.drain` runs, and the board picks them up on its first pass. It can also add them *while* the board is draining: an idle worker takes the new task promptly rather than waiting out its poll interval. Both work on the request, sequencer and durable backings, as long as the add and the drain happen in the same request.

Each sugar call re-resolves the collection, so reads always reflect the latest state. That costs something per call on every backing. When you need several reads in a row with no writes between them, grab the ref once with `const tasks = await ctx.cap.<name>.tasks()` and read from it.

## One task, five tools

A model works a board through five task tools. Four belong to whoever files the work:

- `createTask` files a task. It starts as its start setting says: at once, once its `deps` have finished, filed with `held: true`, when you release it, or, filed with `questions`, once the user has [answered them](#a-tasks-questions).
- `getTask({ id })` reads one task whole: its brief, every field you can edit, how it stands, and its output.
- `listTasks` lists tasks without their output. Each row carries its worker's latest status note.
- `updateTask({ id, ... })` changes one, each field by its own rule.

The fifth is the worker's. `reportProgress({ statusNote?, output? })` is offered only on a turn that is working a task, and acts on that task, so it takes no `id`.

```ts
createTask({ goal: "Find adoption numbers", assignee: "researcher" })
updateTask({ id, priority: 2, labels: ["stats"] })   // before it starts
updateTask({ id, status: "cancelled" })              // until it finishes
updateTask({ id, message: "Use the March figures" }) // until it finishes
reportProgress({ statusNote: "Drafting the summary", output: draft })
```

No tool finishes a task. A task ends when its worker's turn returns, or throws.

`createTaskToolsCapability(resolve, roster?)` from `@flow-state-dev/orchestration` points the filer's tools at a board, and [`taskToolActions`](#changing-tasks-from-outside-a-run) offers the same tools as actions for a screen. A Workforce worker gets them on its own; see [Delegating work](../workforce/delegating-work.md).

### What `updateTask` can change, and when

| Field | Allowed |
|---|---|
| `goal`, `title`, `context`, `input`, `deps`, `priority`, `labels`, `metadata`, `assignee`, `maxAttempts` | Before the task first starts |
| `status: "held"`, `status: "pending"` | Before the task first starts: hold it, or release a held one |
| `status: "cancelled"` | Until the task finishes. Sent alone |
| `message` | Until the task finishes. Sent alone, and kept on the task; see [below](#sending-a-message-to-an-open-task) |
| `answers` with `message`, or with `done` | While the question is open. Answers one of the task's [questions](#a-tasks-questions) by its id. Sent alone |

The fields are flat, beside `id`. `labels` replaces the whole list. `metadata` merges its keys over the task's. *Before it first starts* means no attempt ever claimed it, so a task back in `pending` after a failed attempt stays locked. Once a task starts, only a cancel or a message lands. Once it finishes, nothing does, its output included: file a follow-up with `createTask({ followUpOf })` to correct or extend it.

A started task keeps the worker it started with. To move it, cancel it and file it again.

Every rule is checked inside the write, so a task that starts between your read and your write is refused, not edited. A refusal is a result, not a throw, and it names the field, the state and the next move:

| Error | When |
|---|---|
| `field_locked_after_start` | A field that changes only before a start, on a task that has started. It names the fields and the task's status |
| `task_finished` | Any write to a finished task, a message included |
| `cancel_takes_no_edits` | `status: "cancelled"` sent with another field |
| `message_takes_no_edits` | `message` sent with a field or a status |
| `nothing_to_update` | No field and no status beside `id` |
| `unknown_assignee` | An `assignee` the board's roster doesn't name |
| `steer_limit` | A message to a task that already holds 20 |
| `message_not_supported` | A message on a board whose task list keeps no messages |
| `no_such_question` | An `answers` id that names no open question or confirm on the task |
| `question_answered` | Other words for a question that was already answered |
| `question_is_the_users` | The filer's tool answering a question the user answers from their Inbox |
| `question_takes_message` | A question answered without `message`, or with `done` |
| `confirm_takes_done` | A confirm answered without `done` |
| `done_without_answers` | `done` sent without `answers`, the confirm it answers |
| `answers_not_question` | `question` sent in place of `answers`. Nothing is written |
| `answer_takes_no_edits` | An answer sent with a field or a status |
| `questions_not_supported` | An answer on a board whose task list keeps no questions |

### Sending a message to an open task

`updateTask({ id, message })` sends words to a task that hasn't finished: a correction, a detail the filer forgot, a change of direction. The message is kept on the task, in order, and reaches the work without using an attempt, ending the task, or changing its status. Where it lands depends on where the task is:

- **Filed, not started yet.** The first attempt's brief carries every message, after the goal.
- **Running.** The worker takes it before its next model call, in the same turn. A coding run on a [harness manager](./harness-manager.md#steering-a-run) takes it at its next step.
- **Waiting on tasks it filed.** A turn starts with the message while those tasks keep running. On a Workforce conversation's board, a session runs one turn of a task at a time. While another of the task's turns waits on a step it filed in a session of its own, the message's turn waits until that turn answers, and so does any turn a finished task wakes.
- **After the worker's last model call**, even while the task is being settled. The task gets one more turn, with the message, before it settles. Its output follows the usual rule: the latest checkpoint, or else that turn's answer.

The last case needs a turn to run. A Workforce conversation's board has one. For a board you wire yourself, name the internal entry that runs it in `taskLedgers({ endRules: { steerTurn: { entry } } })`. Without one, the task settles and the message stays on it, untaken: on such a board, a message that arrives after the last model call may not be acted on.

The filer's model sends a message with the `updateTask` tool, and a person with the board's `updateTask` action; the task records which. A message is sent alone, not with an edit, a hold or a release, so a call never lands half of what it asked. A task takes at most 20 messages. Past that, cancel it and file it again with everything it needs, or file a follow-up once it ends.

`getTask` lists a task's messages as `steers`, oldest first, each with who sent it and whether its work has read it (`taken`). Unless it arrived before the task started, the message also shows in the task's session as a line from its sender, so later turns in that session read it.

A finished task takes no message, because its output never changes. To correct it, file a follow-up: it runs in the task's session, and `getTask` on the original shows the follow-up's output as `current`.

### A task's questions

Some work can't start until a person decides something. File it with the questions, and it waits for the answers:

```ts
createTask({
  goal: "Write the adoption script",
  assignee: "analyst",
  questions: [
    "Which CSV export should the script read?",
    { kind: "confirm", prompt: "Run it against production?" },   // a No cancels the task
  ],
})
```

A plain string is a question, answered in words. A `confirm` asks for a yes or a no. A No cancels the task, with the No and any note as the cancel's reason. File it with `onNo: "continue"` instead and the work goes on after a No, with "No." in its brief. The task stays `pending`, and nothing starts it, until every one is answered. Each answer joins the brief its first attempt gets, after the goal and beside the question it answers. Questions are set only when filing, up to 20, each up to 1,000 characters.

A worker can also ask midway, from the turn working the task. A model asks with its `askQuestion({ question })` tool. Code asks with `askMidway(ctx, board, [{ prompt }])` from `@flow-state-dev/orchestration/task-board`, or `[{ kind: "confirm", prompt, onNo }]` for a yes or a no. The turn ends there without settling the task: it keeps its attempt and everything the turn wrote. The task isn't handed out again while it waits, however long that takes. Once the user answers, the task takes one more turn on the same attempt, which starts from its brief, its last checkpoint and the answer. That turn isn't charged against `maxAttempts`.

A Workforce worker has `askQuestion` on every task turn. For a worker flow of your own, build it with `createAskQuestion({ resolve })` from `@flow-state-dev/orchestration`, which takes the task list the turn's task is on, and offer its `tool` while its `offered(ctx)` check says so: on a turn working a running task. After calling it, the model ends its turn with a short note. Nothing it answers in that turn becomes the task's result.

The worker that filed the task can hear a midway question too. Declare `onMidwayQuestion(ctx, row, questions)` in the task list's `delivery` and the board calls it after each question asked midway, from the request that asked it, with the row and its open midway questions. It's called again if the asking turn is replayed, so make it safe to repeat for the same question. A Workforce board uses it to send the question to its filer [as a message](../workforce/messaging-workers.md#when-a-task-asks-a-question). Without it, the filer reads the question with `getTask`.

`getTask` and `listTasks` show what a task waits on as `questions`. Each has an `id`, its `ask` (`kind` and `prompt`), when it was opened, and its `due` time when it has one. A question stays listed until it's answered. The same list carries a stop the task's run waits on, with `source.kind: "suspension"`; see [A task waiting on a user](#a-task-waiting-on-a-user).

The user answers from their [Inbox](#building-an-inbox). A screen of your own answers with the board's `updateTask` action, naming the question:

```ts
updateTask_tasks({ id, answers: questionId, message: "The March export, exports/2026-03.csv" })
updateTask_tasks({ id, answers: confirmId, done: true })   // or done: false, with an optional message
```

The answer is kept on the task as one of its messages, from the user, so it counts toward the 20 a task takes. Sending the same answer again is a success that writes nothing, even once the task has finished. Different words for an answered question are refused. Only the user the task was filed for, in the same tenant and organization, can answer; anyone else is answered `task_not_found`. The filer's own `updateTask` tool answers only a question the worker asked midway, on a task that runs in a session of its own. Questions asked at filing are the user's.

A question has no deadline unless the host sets [`userDeadlineMs`](/docs/configuration/runtime#createflowstate-fields). Then, on the board's first touch past it, the question closes with "No answer came before this question's deadline. Go on from your brief without it." and the work goes on as if it had been answered.

A line the user types into a held task's session answers its oldest open question. A confirm is never answered that way: it takes a yes or a no. With no question open, the line is a message to the task as usual.

While its questions are open, a task settles only by a cancel, which closes every question; an answer closes its own question and the work goes on. A turn waits once. A worker that asks midway while its run waits for the user is refused: the call is declined `held`, and nothing is asked. A run that stops for the user while its own questions are open resumes at once with `{ cancelled: true }`. Between a model's own tools the first to start waiting wins: `askQuestion` and `waitForUser` called in the same step open one wait, and the other comes back as a tool error naming it.

### Progress from the worker

`reportProgress` writes two things on the task its turn holds. `statusNote` is a one-line note for task views; `listTasks` shows it. `output` is a checkpoint of the result so far; `getTask` shows it as the task's output, marked `checkpoint: true`. Neither changes the task's status.

The latest checkpoint is the task's output. When the task completes, a checkpoint stays, and the worker's final answer becomes the output only when it never reported one. So report the whole result so far each time. A failed attempt keeps its checkpoint for the next one. Once the task has finished, `reportProgress` is refused and nothing changes.

For a worker flow of your own, build the tool with `createReportProgress({ resolve })`, which takes the task list the turn's task is on, as [`createAskQuestion`](#a-tasks-questions) does. `reportProgress` is not an action: a screen doesn't report a worker's progress.

## Changing tasks from outside a run

Workers change tasks while a board drains. Sometimes a person needs to as well: cancel a task nobody needs, hold or release one, edit one before it starts, or answer its question. `taskToolActions` gives your flow the filer's four task tools, as actions any caller of the flow can run:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { taskBoard, taskToolActions } from "@flow-state-dev/orchestration/task-board";
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";

const todos = defineTaskCollection({ id: "todos", scope: "session" });
const board = taskBoard({ name: "todos", collection: todos, workers });

defineFlow({
  kind: "ops",
  actions: {
    drain: { block: board.drain },
    ...taskToolActions(board),
  },
});
```

The actions are named for the board's collection: `createTask_todos`, `getTask_todos`, `listTasks_todos` and `updateTask_todos`. A character outside letters, digits, `_` and `-` becomes `_`, so a collection `eng.work` gives `updateTask_eng_work`. Each action carries the board's capability, so the flow doesn't have to declare the collection itself.

Pass a roster and the actions check assignees the way the model's tools do: `taskToolActions(board, roster)`, or `taskToolActions(collectionId, resolve, roster)`. A `createTask` or `updateTask` naming someone the roster doesn't is answered `{ ok: false, error: "unknown_assignee: …" }` and writes nothing. The roster can also be a function of the running block's context, `(ctx) => roster`, read on every call that checks an assignee, for a board whose team changes from one session to the next. `createTaskToolsCapability(resolve, roster)` takes the same function. Without a roster, any assignee is accepted.

Each one runs the same block the model's tool does, so every rule in [the field table](#what-updatetask-can-change-and-when) holds for a screen as for a model. A move the task can't make comes back as `{ ok: false, error }` and writes nothing. None of them claims a task, drains the board or finishes a task. A cancel lands on a task a worker is still running, and the worker's own result is declined when it arrives.

The board needs a collection that outlives a request, built with `defineTaskCollection`. `taskToolActions` throws for a board on any other backing, because a later action could never find its tasks.

These are public actions. Anyone who can call your flow can call them, so add them only to a flow whose callers you trust with the board. The DevTool's Tasks tab offers, on each row, the board's `getTask` and `updateTask` and every action that takes a `taskId`.

Each task in a `listTasks` result can carry a `run` link, `{ sessionId, requestId }`, that names the run working it, or the run that last did. A finished or failed task keeps its link, so a task list can open the run that produced the result. A task has no link until a run starts on it, and claiming it again clears the link until the next run starts. The link says which run, not whether it is still going: read `status` for that. Only the session's owner can open it.

`getTask` returns one task whole: its goal, context and input, the fields `updateTask` edits, its status, its worker's status note, what it came back with, meaning its `output` or its `error`, and the `questions` it waits on. A task with a completed follow-up also carries `current`: the latest one's `id` and `output`. An `input`, `metadata` or `output` longer than 20,000 characters as JSON comes back as that text cut to 20,000 characters, with `inputCut`, `metadataCut` or `outputCut` set. An `id` the board doesn't hold answers `{ ok: false, error: "task_not_found", taskId }`.

### Building an Inbox

Everything a task waits on a user for (a [question](#a-tasks-questions), a confirm, or a [stop in its run](#a-task-waiting-on-a-user) for an approval, a review or an input) shows in the user's Inbox. [Shift Manager](../shift-manager/overview.md) has one. For a screen of your own, `@flow-state-dev/orchestration/inbox` builds the list and answers it, and it's safe to import in a browser:

```ts
import { createInboxClient, inboxItems } from "@flow-state-dev/orchestration/inbox";

const items = inboxItems({
  rows,        // task rows: a board's listTasks, or a browser's read of the board
  suspensions, // asks a reader found in sessions
  flowOf,      // the flow that owns a session
});
await createInboxClient(client).answer(items[0], { approved: true });
```

`inboxItems` returns one item per task that waits on the user, however many questions it has, with its `questions` oldest first. A stop in that task's run lists under the task, never a second time on its own. A suspension no open task's run holds, such as a user's ask in a session of their own, is an item by itself. An item is `answerable` when one of its questions is.

The answer is typed by what the question asks: an approval takes `{ approved, data? }`, an input or a review `{ value }` (or `{ skipped: true }`), a question `{ text }`, and a confirm `{ done, note? }`. The client sends each where it belongs: a stop to the [answer call](/docs/api/client#answerbody), and a question or a confirm to its board's `updateTask` action, as the signed-in user. There a question's `text` becomes the `message`, and a confirm's `note` becomes the `message` beside `done`. The package README's [Inbox section](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/README.md#inbox) has the full call list.

## Assignees that dispatch {#assignees-that-dispatch}

<a id="assignees-that-hand-off"></a>

An assignee in the registry normally runs its tasks inline: the drain claims a row, runs the worker, records the result, claims the next. On a board declared `mode: "delegation"`, an assignee instead **dispatches** each claimed row to a **dispatch run** and moves on. The drain finishes with the row still `in_progress`, and the run settles it once [the task's work is over](#when-a-dispatched-task-is-done).

A dispatch run is an ordinary session, either of this flow or of the flow the assignee names with `flowKind`. Which session a row lands in is derived from the assignee's session key together with the identity of the session dispatching it. `per-task` gives every row a run to itself, except a follow-up task (filed with `followUpOf`), which runs in the run of the task it follows; `per-worker` and a shared `{ key }` send several rows into one run, one request each.

An assignee dispatches when it holds a `dispatcher({ action, session })` instead of a worker block. The worker is declared once on the flow, under `task.actions`, and the assignee names it by `action`. The stamped address is `type: "task"`; don't set `type` on the assignee. Every assignee on the board dispatches; work that should run inline goes on a plan board of its own:

```ts
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { taskSettledEntry, taskSettledInputSchema } from "@flow-state-dev/orchestration";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";

const issues = defineTaskCollection({
  id: "issues",
  scope: "session",
  sharedToLineage: true,
  stateSchema: z.object({ issueKey: z.string() }),
});

const board = taskBoard({
  name: "issue-work",
  boardId: "issue-work",
  mode: "delegation",                    // every task is handed to another session
  collection: issues,
  workers: {
    implement: dispatcher({              // dispatches to flow.task.actions.implement
      name: "dispatch-implement",
      action: "implement",
      session: "per-task",
    }),
  },
});

// Runs in this session each time a task the board handed out ends.
const onEnding = handler({
  name: "on-issue-ending",
  inputSchema: taskSettledInputSchema,
  outputSchema: z.object({}),
  execute: async (notice) => {
    if (notice.ending === "errored") {
      // notice.error says why; notice.cancelled lists the dependents it took with it
    }
    return {};
  },
});

export default defineFlow({
  kind: "issues",
  actions: { drain: { block: board.drain } },
  internal: {
    actions: {
      onTaskSettled: taskSettledEntry({ block: onEnding }),   // required: see below
    },
  },
  task: {
    actions: {
      implement: { block: implementBlock },   // what runs in the dispatch run
    },
  },
})();
```

The `onTaskSettled` entry is where the flow [hears how each task ended](#hearing-how-a-task-ended). `defineFlow()` refuses a flow that holds a board like this one without it.

`implementBlock` receives the same `TaskWorkerInput` an inline worker would (`taskId`, `goal`, `input`, `metadata`, and so on). A task entry accepts the same fields as an action, `inputSchema`, `concurrency`, `onCompleted`, `onErrored`, and the rest, minus the client-facing `description` and `mcp`. No client can call it; the assignee is the only way in.

The drain dispatches a row once it has claimed it, because the drain decides when each task runs. For a worker that needs another worker to start now, see [Giving another worker work](#giving-another-worker-work).

### When a dispatched task is done

The dispatch run settles its task once, when all of the task's work is over. Returning from the entry isn't enough. The task completes only when:

- the run's request has ended, along with any background work it started (`.sideChain()`) and any your flow's `onFinished` hook started;
- every task it filed has ended, and the run's session has heard each of those endings.

Until then the task stays `in_progress`, and its row's `keptOpenBy` says what it's waiting for:

| `keptOpenBy` | The task is waiting on | Lease |
| --- | --- | --- |
| `"filed"` | tasks it filed that haven't ended, or whose ending the run's session hasn't heard yet | none |
| `"wait"` | a stop: `ctx.waitForUser()`, `ctx.suspend()`, or an external event | none |

A stop that waits for a user (`ctx.waitForUser()`, or `ctx.suspend()` with `human_approval` or `human_input`) is also listed in the task's `questions`.

A task with no lease stays with its run. It isn't handed out again however long the wait lasts, including across a server restart.

#### A task waiting on a user

When the run stops to ask the user something (`ctx.waitForUser`), reading the task shows it. `getTask` and `listTasks` list the stop in the task's `questions`, with `source.kind: "suspension"`: its `ask` (`kind` is `approval`, `review` or `input`, beside the `prompt`), and its `due` time if it has one. The answer comes from the user's [Inbox](#building-an-inbox), through the [answer call](/docs/api/client#answerbody), and the same attempt carries on. Only that user can answer it.

The stop can end three other ways, and each ends it once:

- **The task is cancelled.** The run picks up where it stopped, with `waitForUser` returning `{ cancelled: true }`, and runs to its end. Nothing it writes to the task or returns is kept, and a task it tries to file is refused. Anything it does elsewhere, like a call to another service, still happens, so check `cancelled` before work you'd rather skip. An answer sent at the same moment as the cancel is told the stop is already resolved.
- **The run is stopped.** The task is cancelled rather than failed, so it isn't retried and the user isn't asked the same thing again.
- **Its deadline passes.** A stop has no deadline unless the call passes one, or the host sets [`userDeadlineMs`](/docs/configuration/runtime#createflowstate-fields). At the deadline an approval reads as a no. A review or an input fails the attempt unless the run catches `SuspensionTimeoutError`.

A block asks for a review the same way it asks for an approval:

```ts
const review = await ctx.waitForUser({ kind: "review", prompt: "Does this draft read right?" });
if (review.cancelled) return { skipped: true };
// review.answer is the user's verdict.
```

The Inbox lists the review as one item, named a review, and the user's verdict resumes the block on the same attempt: `review.answer` is what they sent.

A model asks with its `waitForUser({ kind, prompt })` tool, an approval or a review. Its result is the user's answer. The tool takes no deadline: the host's `userDeadlineMs` applies, and at it the tool comes back with `answered: false` (an approval with `approved: false`) rather than an error. On a turn working a task, `waitForUser` refuses `input` and points at `askQuestion`. On a turn working no task, `waitForUser` takes `input`, and the answer is the tool's result. A Workforce worker has the tool; for a flow of your own, build it with `createWaitForUserTool({ resolve })`.

A message sent into a task while it waits on an approval or a review doesn't answer it.

Each later request for the task in that session checks it again, and the one after which nothing holds it settles it. A stopped run resumes on the same attempt and settles when the resumed request's work is over. A request that throws fails the attempt.

Anything else that runs in that session, such as a message another worker sent it, doesn't keep the task open and isn't part of it. While the task's turn is running, it runs after that turn. It can't write to the task, and if it fails, the task's result stands. To change work that's still running, [send the task a message](#sending-a-message-to-an-open-task) instead.

Background work counts as part of the request. If a `.sideChain()` step throws in any request working the task, the attempt fails just as if the request had thrown. That covers steps your `onCompleted` or `onFinished` hooks start, and a step a plain `.waitForSideChain()` already waited on. The task runs again while it has attempts left. Otherwise it fails, and its error names the step, as in `Background work "notify" failed: ...`. The request itself still reports `completed`, so read the task, not the request, to see how the work went.

A few cases don't fail the attempt:

- **A cancel.** Once the task's request is stopped, nothing its steps do afterwards fails the task. A dropped client connection is not a cancel, so a step that throws after one still fails the attempt.
- **A stop and resume.** A step that failed before the request stopped runs again on the resume, and that run's outcome is the one that counts.
- **A step that catches its own error.** To make a step best-effort, catch inside it. A step that never throws never fails the task.

The task's output is the latest checkpoint its worker reported with `reportProgress`. With no checkpoint, it's the last answer that counts: the entry's, or that of a later request whose answer [counts toward the output](#requests-that-work-on-a-waiting-task).

If the board can't record the result, the dispatch run's request reports `failed`. See [When the board cannot record a result](#when-the-board-cannot-record-a-result).

A stream following the dispatch run's request gets its terminal status only after that check, so it ends when the task's outcome is recorded: `request.completed`, or `request.failed` when the board couldn't record the result. It never sees `completed` first. The answer itself still streams as the run produces it, and `onFinished` still runs before the check, with the request's own status.

Before it closes the stores, stopping the host waits for a request working a dispatched task, until it has recorded that task's outcome (settled, failed, or waiting on something). It shares the `shutdownDrainMs` budget (default 10 seconds) it gives requests that [wakes](../advanced/durable-execution.md#wakes) started. Past that budget the host shuts down anyway and logs how many such requests hadn't recorded an outcome.

#### Requests that work on a waiting task

On a [Workforce](../workforce/delegating-work.md#splitting-a-task) board, the notice of a piece's ending is one of these later requests, and you don't wire anything. On a flow of your own, start each such entry with `taskRequestAdmission`, and tap `noteTaskAnswer` after the step whose answer can become the task's output:

```ts
import { sequencer } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { taskSettledInputSchema } from "@flow-state-dev/orchestration";
import { noteTaskAnswer, taskRequestAdmission } from "@flow-state-dev/orchestration/task-board";
import type { Task, TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";

// Your lookup: the waiting task whose run is this session, and the ledger it's on.
async function findWaitingTask(
  ctx: BlockContext
): Promise<{ ref: TaskCollectionRef; row: Task } | undefined> {
  // e.g. resolve the ledger, then ref.list({ status: "in_progress" })
  //   .find((task) => task.run?.sessionId === ctx.session.identity.id)
}

// readThePiece is your own block: whatever this request does with the notice.
const onPieceEnded = sequencer({ name: "on-piece-ended", inputSchema: taskSettledInputSchema })
  .tap(
    taskRequestAdmission({
      name: "on-piece-ended-admission",
      answerCounts: true,
      find: (ctx) => findWaitingTask(ctx),
    })
  )
  .step(readThePiece)
  .tap(noteTaskAnswer);
```

`find` is called with the request's block context and returns the task's ledger (`ref`) and its row, or `undefined` to admit nothing. Read both from server-set state, such as session state your flow wrote, never from the request's input, and return a row only when its run is the current session. Put the admission first in the sequencer. It takes the task only while the row has a `keptOpenBy`; otherwise the request runs as usual and settles nothing. An admitted request works under the task's claim, so its task tools write as the worker, `reportProgress` included. A later request's answer becomes the task's output only when both hold: the admission has `answerCounts: true`, and the sequencer taps `noteTaskAnswer` after the step that produced the answer. `noteTaskAnswer` records the output of the step before it. Set `answerCounts: false` on an entry whose answer must never become the task's output.

By default, the tasks a task filed keep it open. To change that, pass `endRules: { filedWorkKeepsOpen }` to `taskRequestAdmission`, and to [`taskLedgers`](#a-task-entry-served-by-many-boards) when your task entry takes its tasks through one. `filedWorkKeepsOpen` is an async predicate over the context, the task row and its ledger.

### Which session a task runs in

`session` on the dispatcher decides, per row:

| `session` | How many runs | Reach for it when |
|---|---|---|
| `"per-task"` | one per task; a follow-up task runs in the session of the task it follows | tasks are independent |
| `"per-worker"` | one per assignee, shared by every task the assignee runs | the worker should remember what it already did |
| `{ key: (task: TaskWorkerInput) => string }` | one per distinct key | one issue across several assignees, or a key you compute from the task |
| `{ by: (task) => ({ key }) \| ({ id }) }` | chosen per task: a run keyed like `{ key }`, or a session that already exists | some tasks belong in a run of their own and others in a session that is already running ([below](#choosing-the-entry-and-the-session-per-task)) |

The two presets fold `boardId` into the key, so two boards' `per-task` runs stay apart even when their task ids coincide. A custom `key` is used as returned: two assignees, or two boards, that return the same string share one session. The sharing is scoped to the conversation dispatching them (the same key from another conversation is a different run) and to the instance a cross-flow assignee names. A `key` function that returns an empty string fails that task.

```ts
import type { TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";

implement: dispatcher({
  name: "dispatch-implement",
  action: "implement",
  session: { key: (task: TaskWorkerInput) => (task.input as { issueKey: string }).issueKey },
}),
```

When the flow an assignee dispatches to needs state in each new session, such as a required readonly field, give the dispatcher a `state` beside `session`: a fixed object, or `(task) => object`, which receives the row's `assignee`, `taskId` and `input`. It works with every `session` policy, the presets included. Each new run is created with it, and the target flow's [`stateSchema` and `createCheck`](../fundamentals/state-and-scopes.md#creating-sessions) accept or refuse it. A run that already exists keeps its own state. Without one, a flow that needs it refuses every new run, and the task fails with `create-refused`.

```ts
implement: dispatcher({
  name: "dispatch-implement",
  action: "implement",
  session: "per-task",
  state: (task) => ({ issueKey: (task.input as { issueKey: string }).issueKey }),
}),
```

A run that handles several tasks does so under its entry's `concurrency` policy. The entry a `per-worker` or `key` assignee dispatches to defaults to `"queue"`, so those tasks run one at a time; a `per-task` assignee's entry keeps the flow's default. An explicit `concurrency` on the entry wins:

```ts
task: { actions: { implement: { block: implementBlock, concurrency: "allow" } } },
```

The in-process dispatcher applies that policy, and so do queue workers that share a lease backend. On a deployment that hands dispatches to an external queue without one, the run starts in another worker and the entry's `concurrency` does not gate it.

A task keeps its session for its whole life. If its worker [asks a question](#a-tasks-questions), the answer brings it back to that same session for its next turn, so it carries on with everything it did before. When the task is done, the session stays open, and the task stays as it ended.

To correct or extend a finished task, add a follow-up task with `followUpOf`. A follow-up runs in the same session when the assignee dispatches `per-task` or the task is on a Workforce conversation's board. A `key` policy decides for itself, and the worker input carries `followUpOf` for it to key by. The original's output never changes: `getTask` on it shows the latest completed follow-up as `current`, with that follow-up's output, and `listTasks` names it by id. On a Workforce conversation's board, a line typed in a finished task's session is [answered from the session](../workforce/coordinators.md#after-a-task-finishes) and changes nothing.

### Sending a task to a flow chosen per task

A task dispatcher's `flowKind` can be a function instead of a string. The board calls it when it hands a task over, with the task's `assignee`, `taskId` and `input` and the running context, and sends the task to the flow id it returns. It may be async. Such a dispatcher must use `session: "per-task"`, so each task runs in a session of its own; any other policy throws when the dispatcher is built. Reach for it when the flow that should run a task is only known at that moment, such as a flow registered after the app started.

Put such a dispatcher at `defaultWorker`. Assignees with an entry of their own in `workers` keep it, and every other task is handed over under the assignee it names:

```ts
import { dispatcher } from "@flow-state-dev/core";
import type { BlockContext, TaskTargetQuery } from "@flow-state-dev/core/types";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";

// Your own lookup: the flow id that serves this assignee, or undefined.
declare function findFlowFor(assignee: string, ctx: BlockContext): Promise<string | undefined>;

const board = taskBoard({
  name: "support-work",
  boardId: "support-work",
  mode: "delegation",
  collection: supportWork,                 // a defineTaskCollection()
  workers: {
    triage: dispatcher({ name: "dispatch-triage", flowKind: "support-triage", action: "work", session: "per-task" }),
  },
  defaultWorker: dispatcher({
    name: "dispatch-by-assignee",
    action: "work",
    session: "per-task",
    flowKind: (task: TaskTargetQuery, ctx: BlockContext) => findFlowFor(task.assignee, ctx),
  }),
});
```

When the function returns `undefined` or an empty string, the hand-over is refused with a `DispatchRefusedError` whose `refused` is `"flow-not-found"`, naming the assignee, and the attempt fails through the board's ordinary error path. A task with no assignee is refused the same way, since the fallback hands a task over by the name on it. A function that throws fails the attempt with its own error.

Only a `task` dispatcher takes a function. An `internal` dispatcher given one throws when you build it. The flow the function returns is cross-flow, so `defineFlow` can't check it ahead of time; the entry named by `action` has to exist on whichever flow it returns, or the dispatch is refused `no-entry`. Workforce's worker lookup supplies one: `createWorkerLookup({ installation }).flowKind` hands a task to the flow of the worker its `assignee` names, with `state` beside it naming that worker. A workforce coordinator, a worker that hands work to other workers called its delegates, keeps a board of its own for that: see [Handing out tasks](../workforce/coordinators.md#handing-out-tasks).

### Choosing the entry and the session per task

One assignee can send different tasks to different places. Give its dispatcher an `action` of `{ among, by }` and it picks the entry for each task: `among` lists the entries it may pick, and `by` returns one of them. Give it a `session` of `{ by }` and it picks the session for each task: `{ key }` for a run of the task's own, keyed as a `{ key }` policy would key it, or `{ id }` for a session that already exists. Both functions receive the task's `assignee`, `taskId`, `input` and `filedBy`, and the running context, and either may be async. Read what they decide from the task itself, from fields your code wrote when it filed the task.

```ts
import { dispatcher } from "@flow-state-dev/core";
import type { TaskTargetQuery } from "@flow-state-dev/core/types";
import type { TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";

// Fields your code wrote on the task when it filed it.
const filed = (task: TaskTargetQuery) =>
  (task.input as TaskWorkerInput).input as { reply?: boolean; sessionId?: string };

assistant: dispatcher({
  name: "dispatch-assistant",
  action: {
    among: ["work", "reply"],
    by: (task) => (filed(task).reply ? "reply" : "work"),
  },
  session: {
    by: (task) => {
      const sessionId = filed(task).sessionId;
      return sessionId ? { id: sessionId } : { key: `work|${task.taskId}` };
    },
  },
}),
```

Every name in `among` is checked when the flow is defined, exactly as a single `action` is, so each one must be declared under `task.actions`. A `by` that returns a name outside `among` fails that task with `refused: "no-entry"` before anything is sent.

A session picked by `{ id }` is never created. If it doesn't exist, belongs to someone else, or belongs to another flow, the task fails with `session-not-found` or `session-not-addressable`, the same refusals a dispatcher's `{ id }` gets anywhere else. The session keeps its own state, so the dispatcher's `state` applies only to tasks answered with `{ key }`. An answer that isn't exactly one non-empty `key` or `id` fails the task. As with `per-worker` and `{ key }`, the entries a `{ by }` assignee dispatches to default to `"queue"` concurrency, since several tasks can land in one session.

### A task entry served by many boards

A task entry is normally reached by one board in its own flow, which puts its claim check in front of it. An entry can instead say where its tasks come from, with `from`. Its flow then needs no board at all, and any board in any flow can hand it tasks, as long as `from` knows that board's ledger.

`taskLedgers` builds the `from` value. Its `resolve` gets the ledger id each incoming task names, with the partition and the task's id, and returns that ledger, or `undefined` for a ledger the entry takes nothing from:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { taskLedgers } from "@flow-state-dev/orchestration/task-board";
import { getOrCreateTaskCollection, resolveResourceCollection } from "@flow-state-dev/orchestration/tasks";

export const reviewer = defineFlow({
  kind: "reviewer",
  actions: {},
  resources: { [frontendQueue.id]: frontendQueue, [backendQueue.id]: backendQueue },
  task: {
    actions: {
      work: {
        block: review,
        from: taskLedgers({
          name: "review-queues",
          // Answer only for ledgers this flow declares.
          resolve: async (ledgerId, ctx) => {
            const collection = resolveResourceCollection(ctx, ledgerId);
            if (collection === undefined) return undefined;
            return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: ledgerId, collection });
          },
        }),
      },
    },
  },
})();
```

The ledger id is the `boardId` the sending board dispatches under. So a board sending into a `from` entry sets `boardId` to its ledger's id, which is what `resolve` looks up.

Each arriving task gets the same checks a board's own entry runs: same attempt, same row, still `in_progress`, still for this assignee. A ledger id `resolve` doesn't answer for is refused before any row is read, with an `UnknownTaskLedgerError` (`code: "unknown-task-ledger"`) naming the entry, the task and the ledger. The id travels with the dispatch, so treat it as untrusted: answer from `ctx`, for ledgers the running request may read, never from a map of every ledger in the process.

`taskLedgers` also takes `uses` (capabilities that declare the ledgers as resources, in place of `resources` on the flow), `onError` (`"skip"` by default, as on a board), `endRules` (what else [holds a task open](#when-a-dispatched-task-is-done)), and `allowSessionState`, which accepts an entry whose blocks keep session state. Leave that off unless the entry is handed tasks `per-task`, or its session state has the same shape for every task.

Each run of the entry is a task turn: the run gets [`reportProgress`](#progress-from-the-worker), [`askQuestion`](#a-tasks-questions), whose question the task waits on until the user answers, and [`waitForUser`](#a-task-waiting-on-a-user). The entry runs only if its claim on the task is still current, and `reportProgress` from the run can touch only the task it holds.

A worker reads the claim it holds with `currentWorkerClaim(ctx)`, from `@flow-state-dev/orchestration/task-board`. Pass the block's own `ctx`. It returns the claim ticket, carrying `taskId` and `attempt` among others, in a worker the board runs inline and in one reached through a task entry, and `undefined` everywhere else: a coordinator, a block wired directly, or any other request the worker starts or resumes. A worker's task-tool writes are limited to the task it holds. A write naming a different task is refused with `task_write_declined: you hold task "<held>", not "<named>"`.

```ts
import { handler } from "@flow-state-dev/core";
import { currentWorkerClaim, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

const report = handler({
  name: "report",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ result: z.string() }),
  execute: async (input, ctx) => {
    const claim = currentWorkerClaim(ctx); // undefined outside a claimed worker
    return { result: `${input.goal} (task ${claim?.taskId}, attempt ${claim?.attempt})` };
  },
});
```

An entry with `from` that a board in the same flow also dispatches to is refused when the flow is defined. Declare a separate entry for that board.

### What the board requires

`taskBoard()` throws, naming the board and the assignee, unless all of these hold for a board with any assignee that dispatches:

- **It declares `mode: "delegation"`, and every assignee dispatches.** See [Plan boards and delegation boards](#plan-boards-and-delegation-boards-mode).
- **`boardId` is set.** It is part of every dispatch run's session identity, so renaming it orphans work already in flight.
- **The collection is a `defineTaskCollection()`.** The request, sequencer, and factory backings are refused: the run settles its row after the request that claimed it is gone.
- **A `session`-scoped collection declares `sharedToLineage: true`.** Without it the run resolves an empty ledger and never finds its row. Its assignees dispatch within this flow; to hand rows to another flow, use a partitioned `user`-scoped collection ([A board per conversation](#a-board-per-conversation-worked-on-another-flow)). `user` and `org` scope need nothing extra.
- **The dispatcher is a named registry entry or `defaultWorker`.** A uniform `workers` block has no assignee to route by, so it can't be a dispatcher. `defaultWorker` can: it hands each task over under the assignee the task names.

The mode and the assignees must agree, on any board. `taskBoard()` throws when they don't, naming the board, the assignee and the fix:

- a plan board whose dispatcher says `wait: false`: drop `wait`, or declare `mode: "delegation"`;
- a delegation board whose dispatcher says `wait: true`: drop `wait`, or drop `mode`;
- a delegation board with an assignee that runs inline, named, the uniform `workers` block, or the `defaultWorker`: put a dispatcher there, or move that work to a plan board;
- a delegation board with no dispatcher at all: drop `mode`.

`defineFlow()` throws for a flow that holds the board and declares no [`onTaskSettled`](#hearing-how-a-task-ended) internal entry, for a dispatcher assignee whose `action` the flow does not declare under `task.actions`, for a `task.actions` entry no board dispatches to and no `from` serves, for a task dispatcher reachable from an action without sitting on a board, for two boards dispatching to the same entry, for an entry with `from` that a board in the same flow also dispatches to, and for an entry block that declares `sessionStateSchema`, at its root or in any composed child. Keep a dispatched worker's state on the task. An entry with `from` can accept session state with `allowSessionState`; see [A task entry served by many boards](#a-task-entry-served-by-many-boards).

A board that dispatches tasks fixes a task's assignee while an attempt holds it: `setAssignee` on an *in progress* task, one waiting on a person included, declines with reason `immutable-assignee`. A pending or held task can change hands. The rule belongs to the collection, so a second board over the same `defineTaskCollection` value follows it too.

### What the drain reports

`board.dispatchers` lists the dispatcher assignees in declaration order, each with its `name`, `kind` (`"named"`), `label` (`assignee:<name>`), and `dispatch` address. A `defaultWorker` dispatcher comes last, with an empty `name`, kind `"floor"` and the label `floor`. Branch on `kind`; `label` is for messages. The list is empty on a board with no dispatcher.

The drain's final `task-board-meta` item reports `terminationReason: "dispatched"` when every outstanding task is running in a dispatch run, with `counts.in_progress` saying how many. The drain returned; the work did not finish. See [Termination](#termination-onidle-modes).

The dispatch block itself returns `{ dispatched: true, taskId, sessionId, requestId, adopted }`, where `sessionId` is the run and `requestId` the request the dispatch became. The task's worker input has to survive a JSON round-trip; a payload carrying a `Date`, a `Map`, a class instance, or `undefined` in object position fails the task in the drain, naming the offending path. A refused dispatch fails the task through the board's ordinary error path, with the same `DispatchRefusedError` a `dispatcher()` block throws, so a `.rescue()` can read its `refused` code either way.

Don't read `sessionId` as an id for this dispatch. `requestId` is the one value that is always one per dispatch. `sessionId` is the run, which is shared under `per-worker` and a shared `{ key }`; even under `per-task` it identifies the row rather than the dispatch, so a retry of that row re-enters the same session. `adopted` is how you tell the two apart: `false` when the dispatch created the session, `true` when it re-entered one that already existed.

When the dispatch arrives, the run re-reads the row and runs the worker only if the claim is still current: same attempt, same row, still `in_progress`, still routed to this assignee. Otherwise it throws `StaleTaskClaimError` (`code: "stale-task-claim"`) and writes nothing, so the row is left exactly as it was. If the row is still `in_progress`, whether a newer attempt, another assignee, or a row recreated under the same id holds it, that claim runs until its lease runs out and the next drain reclaims it. A row that was deleted, or is already settled, has no outstanding claim, so there is nothing to reclaim.

Nothing renews the row's lease while the dispatch waits in the host's queue, so a run that starts more than a lease later finds a row the queue already counts as free. It takes that row back rather than refusing it: the claim is renewed on the same attempt, and the run proceeds if that write lands. It refuses only when the renewal is declined, which is the case another drain has already reclaimed the row and is running it elsewhere. The board claims with the collection's default two-minute lease and exposes no setting for it, so a deep queue in front of the run costs waiting and nothing else.

The board's `onError` reaches the run too; see [Concurrency and error handling](#concurrency-and-error-handling).

### Which run is working a task

A run is the session a dispatched task executes in. When that run starts, it writes itself onto the task. The row gains a `run` field naming the session the work is running in, the request, and the attempt:

```ts
// `collection` is the board's TaskCollectionRef
const task = collection.get("task_7f2");
if (task?.run) {
  // task.run.sessionId  — the session the worker is running in
  // task.run.requestId  — this attempt's request in that session
  // task.run.attempt    — equal to task.attempts
}
```

Each row names the run that took it. Under `per-worker` or a shared `key`, several tasks name the same session and each names its own request. Two rows can share a session, but never a request.

To open the run, read the session first. An assignee can hand its tasks to another flow, so the run doesn't always belong to the flow you read the board through. The session knows its owner:

```ts
const session = await fsd.sessions.get(task.run.sessionId);
const flowKind = session.flowId; // the run's flow, never the board's
```

Every session a run is dispatched into records its flow, so `flowId` is always there to read. Don't substitute the board's flow. Pass that `flowKind` to `useSession` and to the request reads. Through any other flow, the run's request stream answers 404.

The `run_linked` change is published on the run's own session, like everything else the run writes to the task. A view following a different session, such as the conversation that drained the board, sees `run` the next time it reads the board.

The field is written just before the worker's first step. If the write is refused, because the claim moved on in the meantime, the run stops with `StaleTaskClaimError` as it would for any stale claim. If the store fails, the run stops before the worker starts and the board hands the row out again later. If the run fails after `run` was written but before the worker starts, `run` stays: it names the run that stopped, and that run's request carries the error. Under `onError: "fail"` the request reads failed; under `"skip"` it completes with the error as its output.

`run` lasts until the task is next claimed. A completed, failed or cancelled task keeps the run that last worked it, so you can open that session and see what happened. The claim that starts the next attempt clears it, so between a dispatch and the new run's start the task has no `run`.

Read it as "which run", not "is it running". Whether work is live is the task's `status` and the run's request. A task with no `run` reads as one whose run hasn't started. Tasks whose worker runs inline, in the drain itself, never get one.

Nothing a caller or a model sets can write `run`. Naming a session doesn't grant access to it: opening the session or aborting the request still goes through the server's owner check.

### Hearing how a task ended

When a task the board handed out ends, the session that filed it is told, once. The notice arrives as a request to that session's `onTaskSettled` internal entry. Every flow that holds a board that dispatches declares one, built with `taskSettledEntry({ block })` from `@flow-state-dev/orchestration`, as in [the example above](#assignees-that-dispatch). `block` is your handling of one ending; give it `taskSettledInputSchema` as its input schema, and it receives:

| Field | What it holds |
|---|---|
| `boardId` | The board the task is on |
| `taskId` | The task that ended |
| `attempt` | The attempt that ended |
| `ending` | `"completed"`, `"errored"` (failed for good) or `"cancelled"` |
| `output` | On `completed`: what the task returned |
| `error` | On `errored`: why it failed |
| `cancelled` | On `errored` or `cancelled`: the ids of the dependents this ending [cancelled](#when-a-dependency-fails) that the same session filed. Those dependents send no notice of their own |

While the request that filed the task is still running, its notice is held. When that request ends, it sends what it held right away. When it parks, on a person's approval or input or on a [`getTask` wait](#waiting-on-a-task), it holds nothing more. A task that ends during the park sends its notice right away. A notice held while the request ran goes out about two seconds after the park. So a turn that files a task and never waits on it hears the ending once that turn ends, or soon after it parks. Holding needs a host with durable execution; elsewhere a notice is sent as soon as the task ends.

If the server stops while the request is running, the held notice goes out when the request is marked `interrupted`. With default settings that is within about 90 seconds of the request's last heartbeat, or a few seconds after the server comes back if it's down longer. `staleSweepThresholdMs` and `staleSweepIntervalMs` set that window; see [connection resilience](../server/connection-resilience.md).

A task that fails and is retried sends nothing until its last attempt ends. These endings send no notice either:

- A task the filer [waited on](#waiting-on-a-task) with `getTask({ id, wait: true })`, either a wait that was open when the task ended, or one started after it ended but before an `onTaskSettled` request for that ending had started. The `getTask` call gets the result instead. A wait that reached its deadline first doesn't count: that ending goes to the request's next `getTask` only while the request is still running. If the request parks or ends first, the ending is sent as a notice.
- A cancel the filer's own model made with its `updateTask` tool (`status: "cancelled"`), in its own turn. The tool's result already told it, and names the dependents the cancel took along.

A cancel from anywhere else does send one: a person, an app calling the board's actions, or a cascade from a task another session filed.

Your block runs once per ending. If it throws, the notice stays owed and is sent again, so the same ending can reach the block a second time after a failure. A second copy never runs while the first copy's request is still running or parked. The entry queues on the session by default, so two notices run one after the other; pass `concurrency` to `taskSettledEntry` to change that.

A notice that can't be sent when it falls due, because the process died first or the send failed, is sent about two seconds later, or as soon as the server is running again if it was down then. The [durability sweeper](../advanced/durable-execution.md#retention-and-cleanup) runs `onTaskSettled` in the filing session with an empty input, which sends whatever the session's boards still owe. You may see an extra `onTaskSettled` request with empty input in the session; your block isn't called for it. This needs a host with durable execution (on by default wherever stores persist) and a store that keeps wakes, which every built-in store does. Without them, a notice is sent once, when the task ends, and a lost one isn't sent again.

If the filing session no longer exists, the notice can't be delivered. The task records that in its `metadata`, under `noticeUndeliverable:<attempt>:<ending>`, as `{ at, detail }`. A notice still owed a day after it fell due is given up the same way; the host's [`maxDebtAgeMs`](../advanced/durable-execution.md#retention-and-cleanup) sets that limit.

The entry belongs on the flow that holds the board, even when the board hands its tasks to another flow. Without it, `defineFlow()` throws, naming the flow and the board, and says how to add the entry.

### Giving another worker work

Some boards start work on filing: something starts a ready task as soon as it's written, as on a
conversation's board in Workforce. On such a board, `createTask` starts the work at once:

```ts
createTask({ goal: "Draft the release note", assignee: "writer" })
```

The call returns the task's id without waiting for it. When the task ends, you
[hear about it](#hearing-how-a-task-ended) the same way you hear about any task you filed.

To file a task without starting it, pass `held: true`. It waits until you release it, and the
same write can give it its worker:

```ts
updateTask({ id: "task_8f2", status: "pending", assignee: "writer" })
```

A board that a drain runs decides for itself when each task runs, so its `createTask` files a
task the drain starts when it claims it.

### Waiting on a task

When your next step needs a task's result, file the task, then wait on it with `getTask`:

```ts
createTask({ goal: "Which region is the outage in?", assignee: "ops" })
// → { ok: true, taskId: "task_8f2" }
getTask({ id: "task_8f2", wait: true })
```

You can wait in the same turn or in a later one. Your turn pauses until the task ends, then
carries on with the task as `getTask` always returns it: its status, and its output once it
completed. Nothing keeps a request open while it waits, so a server restart loses nothing.
A task that already ended is returned at once. If no `onTaskSettled` request for that ending
has started yet, the wait returns the ending, and no notice is sent for it.

While an `onTaskSettled` request for that ending is still running or parked, `getTask` returns this
instead of the task:

```ts
{ ok: true, taskId: "task_8f2", arrivesAsNotice: true, message: "…" }
```

`message` names the task, says its ending comes to the conversation as a notice, and tells the
model not to wait on it again. The session hears that ending once, from the notice. If the
`onTaskSettled` request fails, it runs again, and a wait keeps getting `arrivesAsNotice` until one
succeeds. After that, a wait returns the task, output and all.

You'll see it when your turn parks between filing a task and waiting on it, or when a second
turn waits on a task the first one filed. Say a turn files a task, then waits for a person's
approval. The task finishes during that wait, and `onTaskSettled` picks up its ending. After the
approval, the same turn waits on the task. It gets `arrivesAsNotice` if `onTaskSettled` hasn't
finished with that ending yet, and the task if it has. The timing isn't yours to pick, so handle
both answers.

A wait has a deadline, five minutes unless you pass `deadline` in milliseconds. At the deadline
your turn carries on with the task as it stands, usually still `in_progress`. Nothing is
cancelled: the task runs on, and you can wait on it again. If it ends while your request is
running, your next `getTask` on it returns the ending. If your request parks or ends first, you
[hear about it](#hearing-how-a-task-ended) once, the usual way.
If your request parked, waiting on the task again after the turn resumes gets `arrivesAsNotice` or the task, by
the same rule as above. A worker you're
waiting on can't stop to ask you a question; it answers with what it has, or fails. One wait
per step, where a step is one model call and the tool calls it makes.

Only wait when the result changes what you do next. Otherwise let the task run and carry on.

A turn that is itself working a task can wait too, so waits nest: a task's turn waits on a task
it filed, whose turn waits on another, and so on. A wait is refused when it would make a chain
of more than five waits, counting the waits above you and any already below the task you wait
on.

| Input | |
|---|---|
| `id` | The task to read |
| `wait` | `true` to wait until it ends, or until the deadline |
| `deadline` | How long to wait, in milliseconds. Five minutes by default; the server sets the bounds (one second to 24 hours by default). Only with `wait` |

| Error | When |
|---|---|
| `wait_not_filer` | Your session didn't file the task. Only the session that filed a task can wait on it |
| `wait_on_conversation_result` | The task's result goes to the conversation, which hears it when it ends |
| `wait_taken` | Another request already waits on this task. A task has one waiter at a time |
| `wait_on_plan_step` | The task is a step a [plan board](#a-plan-board-that-hands-a-row-over) handed to another session, and the plan waits on it. Wait on the plan instead |
| `wait_already_pending` | This step already waits on something. One wait per step |
| `wait_too_deep` | The wait would make a chain of more than five |
| `wait_deadline_out_of_range` | `deadline` is outside the server's bounds. It is never clamped |
| `deadline_without_wait` | `deadline` without `wait` |
| `wait_unavailable` | This server or board can't hold a wait |

Nothing is written when a wait is refused.

Waiting needs a board that wakes a waiting turn, and a server with durable execution, the
[durability sweeper](/docs/advanced/durable-execution#retention-and-cleanup) and a store that
keeps [wakes](/docs/advanced/durable-execution#wakes). Where it can't wait, `getTask` isn't
offered `wait`. For a board of your own, pass `{ dispatches: true }` to
`createTaskToolsCapability` only when the board [starts work on filing](#giving-another-worker-work), and add `resumesWaits: true` only when the board also
hands its tasks out, so the flow holding it declares [`onTaskSettled`](#hearing-how-a-task-ended).
When a waited-on task ends, the filing session's `onTaskSettled` request resumes the waiting
turn; after a crash, the [wake](/docs/advanced/durable-execution#wakes) sends it again.

Stopping a conversation while its turn waits ends the turn and cancels the task. Cancelling
the task a waiting turn is working ends that turn too, with no further model call. A task you
wait on is an ordinary row: `listTasks` shows it, marked `waitedOn: true`, and the board's
limits apply. The `getTask_<board>` action reads without waiting.

### A plan board that hands a row over

A plan board's drain waits on every row, so it can hand a row to another session and wait on
it there, as it waits on the rows it runs inline. Give the board a `newSession` dispatcher, and
a row filed with `session: "new"` runs in a session of its own:

```ts
const steps = taskBoard({
  name: "steps",
  boardId: "steps",
  collection: defineTaskCollection({ id: "steps", scope: "user" }),
  workers: inlineStep,
  newSession: dispatcher({ name: "own-session", action: "work", session: "per-task" }),
});
```

Every other row runs in `workers`. The drain waits for the row to end, however many
[deadlines](#waiting-on-a-task) that takes, before it starts the rows that depend on it, and
they see its output, as any dependency's. No completion notice is sent for the row. Declare
the board's [`onTaskSettled` entry](#hearing-how-a-task-ended) on the flow: without it, the drain still
learns of the row's ending, but only at its next deadline, up to five minutes later.
A plan board may also hold dispatcher assignees, whose rows it waits on the same way. A
dispatcher there that says `wait: false` is refused, and so is a delegation board's that says
`wait: true`, each naming the fix.

If the drain fails after it has handed a row over, the plan fails, whatever `onError` says.
The drain's request ends `failed` with an error that names the row, and no row that hasn't
started yet runs, whether it depends on that row or not. That covers a dispatch that throws
instead of refusing, a store write that fails while the drain waits, and a wait it can't hold
any more because another request took the row's wait slot.

A row has one waiter at a time, and a row the drain handed over is the drain's to wait on. So
a `getTask({ id, wait: true })` on it is refused with `wait_on_plan_step` for as long as the
drain waits, including the moment at each deadline when the drain lets the slot go and takes it
again. Nothing is written, and the plan runs on. The refusal tells the agent to wait on the plan
instead, which goes on once the row ends. A plain `getTask` read of the row still works.

The drain writes nothing on the row it handed over. When the session it went to is running it,
that session finishes it. When the dispatch itself threw, nothing may be running it: the row stays
`in_progress` until its lease lapses, and then the next run of the plan claims it again.

## Stream items emitted

A board run produces these item streams:

- `task-change`: one item per task transition (`added`, `claimed`, `completed`, `errored`, `cancelled`, and more). Keyed by `${collectionId}/${taskId}`, so the latest change for a task replaces the previous one.
- `task-board-meta`: board-level state, keyed by `collectionId`. Emitted twice per run, once with `status: "active"` at start and once with `status: "completed"` at end. The completed item carries `terminationReason` and the `counts` snapshot.

Renderers like `<TaskPlan />` subscribe to both: `task-board-meta` for the board-level status header, `task-change` for per-task rows.

A board that could not record a result emits one more item, `task-board-recorder-failure`. It carries no key, so each failure in a run is its own entry rather than replacing the last. See [When the board cannot record a result](#when-the-board-cannot-record-a-result).

## Migrating

**Moving from `dispatchTask`.** There is no `dispatchTask` tool or `dispatchTask_<board>` action. {/* retired-name-refusal: migration note */}
File a new task with `createTask`, which starts it on a board that starts work on filing, and release a held
one with `updateTask({ id, status: "pending" })`. To wait on it, call `getTask({ id, wait: true })`;
`deadline` takes the place of `timeoutMs`.

**Moving from `waitForResponse`.** `createTask` doesn't wait. It refuses `waitForResponse`, `wait` and `timeoutMs` with `create_task_does_not_wait`, and files nothing. File the task, then wait with `getTask`. {/* retired-name-refusal: migration note */}

**Moving from the question and review parks.** A task waiting on a person is never parked. A worker's model asks with `askQuestion` instead of `parkOnQuestion`, and the task waits on the question. {/* retired-name-refusal: migration note */}
The question is answered with `updateTask({ id, answers, message })`, which replaces `answerTask` and its action. {/* retired-name-refusal: migration note */}
A block asks for a review with `ctx.waitForUser({ kind: "review", prompt })` instead of `awaitReview`, and the Inbox answers it, so `unpark` and `unparkAndDrain` have no replacement to mount. {/* retired-name-refusal: migration note */}
A board built with `onReview` is refused: a board whose open tasks only wait on a person stops `blocked` on its own. {/* retired-name-refusal: migration note */}

**Reading older logs.** A stored `task-board-meta` item may use another name for the [`"dispatched"`](#termination-onidle-modes) termination reason.

Older logs report `"handed-off"` for the same thing.

## See also

- [Configuration](./configuration): every `taskBoard` field, including defaults.
- [Coordinators](../workforce/coordinators.md): the board each conversation with a coordinator keeps, and filing a task on it.
- [Task substrate](./task-substrate.md): the `Task` record, the status state machine, and the collection API underneath.
- [GoalSeekLoop](./goal-seek-loop): a config-driven, judge-gated loop over the board's drain.
- [Block State](../advanced/block-state): the primitive behind the board's sequencer-scoped task collection; see [The durability boundary](../advanced/block-state#the-durability-boundary) for what survives a resume.
- [Parallel Tasks](../patterns/parallelTasks): single-pass fan-out wrapper on top of the board.
- [Supervisor](../patterns/supervisor): per-task review wrapper.
- [Plan and Execute](../patterns/plan-and-execute): replan-loop wrapper.
- [Flow policy](./flow-policy): the observation ledger, `priorWork` shaping, and tool-result caching.
- [Patterns Overview](../patterns/overview): when to use which pattern.
- [Human-in-the-Loop guide](/guides/human-in-the-loop): pausing a single step for an approval with `ctx.suspend()`, and the card that resolves it.

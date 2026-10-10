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

## The parts

The board is a handle you drain. Its tasks are rows in a collection. Workers are blocks keyed by assignee.

![The board is a handle that drains, the task collection holds the rows, and workers are blocks keyed by assignee](./task-board-parts.svg)

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

- **Drained** — no `pending`, `in_progress`, or `parked` tasks remain.
- **Blocked** — no task is `in_progress` or `parked`, and no `pending` task has all of its `deps` `completed`. Nothing is claimable, and no in-flight work is left to change the dep graph.

Both checks ignore tasks sitting in `parked` when the board sets [`onReview: "exit"`](#waiting-on-a-person-onreview).

The final `task-board-meta` item carries a `terminationReason` field saying which case it was:

- `"all-completed"` — every task reached `completed` (or the board started empty).
- `"blocked-by-failures"` — at least one task did not reach `completed`. Could be `errored`, `cancelled`, or `pending` with unresolvable deps.
- `"retry-budget-exhausted"` — the board refused a retry because `maxTotalRetries` was spent. See [Bounding the retries](#bounding-the-retries).
- `"handed-off"` — every task still outstanding is running in a dispatch run. The board finished its own part and the work continues in the background, so this is a success, not a stall. Only a board with a [seat that hands off](#seats-that-hand-off) reports it, and `counts.in_progress` is how many are still running.
- `"parked-for-review"` — the board stopped because the work it has left is waiting on a person. Like `"handed-off"`, it is neither a success nor a failure: nothing went wrong, and nothing is finished. Only a board with [`onReview: "exit"`](#waiting-on-a-person-onreview) reports it. `counts.parked` is how many tasks are parked. [Picking it back up](#picking-it-back-up) is how the work restarts.

Order matters when a board ends up in more than one of these states at once. `"blocked-by-failures"` wins over `"parked-for-review"` when a task `errored`, was `cancelled`, was moved to `blocked`, or is `pending` behind a dep that will never complete. Answering the review would not clear any of those. A task waiting on the parked task itself is not that case, and the board still reports `"parked-for-review"`. In the other direction, a parked task outranks a hand-off: both let the drain go, and the one that owes a person an answer is the one you need to see. A refused retry outranks all of them.

```ts
// On the final task-board-meta item:
{
  component: "task-board-meta",
  data: {
    collectionId: "echo",
    status: "completed",
    terminationReason: "all-completed",   // or "blocked-by-failures" | "retry-budget-exhausted"
                                          //  | "handed-off" | "parked-for-review"
    maxTotalRetries: 50,
    counts: {
      total: 2,
      completed: 2,
      errored: 0,
      cancelled: 0,
      blocked: 0,
      parked: 0,
      in_progress: 0,
      pending: 0,
      retries: 0,
    },
  },
}
```

The choice between `"all-completed"` and `"blocked-by-failures"` comes from the counts (`completed === total`), so in `"wait"` mode a `shouldExit` that fires while tasks are still running reports `"blocked-by-failures"` even though nothing failed. Read `counts` when you override termination. The other three are not count comparisons: `"retry-budget-exhausted"` appears only when a retry was actually refused, `"handed-off"` only when every outstanding task is one a dispatch run is holding, and `"parked-for-review"` only when the board stopped because it was told not to wait on a review.

### `"complete"`

Exits only when no `pending`, `in_progress`, or `parked` tasks remain. Use it when a pending task with a non-`completed` dep is a transient state: something outside the worker pool will eventually mark the dep complete (an external service, an HITL approval pumping a queue).

A board in this mode never decides on its own that it is stuck. If a dep will never resolve, each worker keeps cycling until it hits `maxIterations` (default `10000`, counted per worker). Pick the mode when the board really is supposed to wait.

A task parked for review keeps this mode's loop alive, and [`onReview: "exit"`](#waiting-on-a-person-onreview) cannot change that. A board that sets both is refused when you build it.

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

## Waiting on a person: `onReview`

A worker can park a task with `awaitReview` when it needs a human to look at something. By default the board treats that task the way it treats any other unfinished work: the drain stays open, and so does the request that started it, waiting for someone to move the task out of `parked`.

That is the right default when the answer arrives in seconds. It is the wrong one when it arrives tomorrow. Nothing shortens the wait, though it does end: each worker stops after `maxIterations` (default `10000`), which on the default poll interval is most of a day. The task is left parked, and the board reports `terminationReason: "blocked-by-failures"` even when nothing failed.

`counts.parked` does not tell that board apart from one that hit a real failure. A parked task and a failed task can sit on the same board, and when they do `blocked-by-failures` is the accurate answer: the failure is there, and answering the review will not clear it. A check that sees `parked` above zero and reads no further has just missed the errored task beside it.

So read the whole of `counts`, and know what it still cannot settle. A board whose only outstanding work is a question for a person has `parked` above zero with `errored`, `cancelled`, and `blocked` all at zero. Past that the counts run out: a task queued behind the parked one and a task queued behind a dep that will never complete are both plain `pending`, and a task in `in_progress` may be running elsewhere or may have been abandoned when its worker died. Separating those means reading the tasks, not the counts — `listTasks` through [the board's capability](#commanding-the-board-with-its-capability), then checking what each pending task's `deps` are waiting for.

`onReview: "exit"` says the board should not wait:

```ts
const board = taskBoard({
  name: "reviews",
  collection: reviewLedger,   // defineTaskCollection — required for this mode
  workers,
  onReview: "exit",
});
```

With that set, a task in `parked` is not counted as work the drain waits on. Once parked tasks are the only thing left, the drain finishes, the request that started it returns, and the completion item says `terminationReason: "parked-for-review"`. The task itself is untouched: parked, on the board, and durable.

### Picking it back up

The answer goes in through `board.unparkAndDrain`, a step you mount like any other block. It takes the id of the parked task and the answer, moves the task back to `pending`, and drains the board in the same request, so the work restarts right there:

```ts
const flow = defineFlow({
  kind: "reviews",
  actions: {
    drain: { block: board.drain },
    answer: { block: board.unparkAndDrain },
  },
});

// A later request runs the `answer` action with
// { taskId: "draft-42", feedback: "approved, ship it" }
```

`feedback` reaches the worker as `input.feedback` on the next attempt. A task that has never been reviewed has no `feedback`, so a worker can branch on it. A block that wants to show the person the question first reads the parked task through [the board's capability](#commanding-the-board-with-its-capability).

The step returns whether the answer was accepted, and drains only when it was:

| Task's state when the answer arrives | Returned | Drain runs |
| --- | --- | --- |
| `parked` | `{ outcome: "recorded" }` | yes |
| `pending` (already answered and queued) | `{ outcome: "declined", reason: "disallowed", status: "pending" }` | no |
| `in_progress` or `blocked` | `{ outcome: "declined", reason: "disallowed", status }` | no |
| `completed`, `errored`, or `cancelled` | `{ outcome: "declined", reason: "terminal", status }` | no |

A refused answer writes nothing. One park takes one answer: the first accepted answer is the one the worker sees, and a second delivery for the same question is refused rather than replacing it. To change an answer, wait for the worker to park again.

**When the answer lands but the work does not start.** If the request fails after the answer is written and before the task is claimed (cancelled mid-drain, say), the answer is safe on the task and the task is queued. Delivering it again is refused, because the task is no longer parked. What you want then is a drain: run `board.drain` on a later request and it picks the task up.

**What throws.** A `taskId` the board does not hold throws rather than returning a verdict. On a board without `onReview: "exit"`, the step also throws if the collection is not a `defineTaskCollection` or an `initialTasks` entry has no `id`. A board with `onReview: "exit"` refuses both when it is built.

**The answering request has to reach the same task list.** The answer is looked up in whatever task list the request reaches, and the collection's `scope` decides which one that is. A `session`-scoped collection is reachable only from the same session under the same tenant. A `user`- or `org`-scoped collection spans every session that principal has, so anyone in the org can answer an org-scoped task. Reach the wrong task list and what happens depends on what it holds. If it has no task by that id, the step throws. If it holds a task with the same id that is also parked, the answer lands on that task and that board drains, with no error. Every board in this mode uses the ids you wrote in `initialTasks`, so two sessions parked at the same step both hold a task called `draft-42`. Nothing checks this for you.

Whichever drain gets there first claims the task and runs it, exactly as if it had been queued that moment. If another drain claims the task before the one `unparkAndDrain` starts, that drain finds nothing to claim and returns.

### What the mode requires

Every requirement below is checked when you build the board. Get one wrong and `taskBoard()` throws, naming the problem and the change to make:

- **A durable collection** — one built with `defineTaskCollection`. The parked task has to outlive the drain that let go of it, or there is nothing for a later drain to come back to.
- **The default `onIdle`.** `"complete"` and `"wait"` are both refused. If you need a wait-mode board to stop on parked tasks, put that rule in `shouldExit`.
- **An explicit `id` on every entry in `initialTasks`.** This mode makes a second drain the normal case, and each drain re-runs the seed step. Seed entries with ids are matched against what is already on the board and skipped; an entry without one is added again every time, so the board grows a duplicate task on every pass.

### What it does not change

The task lifecycle is the same under either setting. A parked task sits in `parked` until it is answered, and `onReview` decides only whether the drain counts it while it sits there.

The setting is board-wide. A board cannot park one task as "release the request" and another as "hold it".

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

There is no `defaultWorker` unless you pass one.

The task tools can catch a bad assignee earlier than that. Give `createTaskToolsCapability` a roster, and `addTask` with an assignee the roster doesn't name returns `{ ok: false, error: "unknown_assignee: …" }` and writes nothing, so a typo is refused at creation rather than quietly landing on the default worker. Without a roster every assignee is accepted, and an unmatched one takes the fallback path above.

A registry seat can also run its tasks somewhere other than the request that claimed them, and so can `defaultWorker`. See [Seats that hand off](#seats-that-hand-off).

## Seats that hand off

A seat in the registry normally runs its tasks inline: the drain claims a row, runs the worker, records the result, claims the next. A seat can instead hand each claimed row off to a **dispatch run** and move on. The drain finishes with the row still `in_progress`, and the run settles it when the worker is done.

A dispatch run is an ordinary session — of this flow, or of the flow the seat names with `flowKind`. Which session a row lands in is derived from the seat's session key together with the identity of the session dispatching it. `per-task` gives every row a run to itself; `per-worker` and a shared `{ key }` send several rows into one run, one request each.

A seat hands off when it holds a `dispatcher({ action, session })` instead of a worker block. The worker is declared once on the flow, under `task.actions`, and the seat names it by `action`. The stamped address is `type: "task"` — do not set `type` on the seat. A board can mix seats that hand off with seats that run inline:

```ts
import { defineFlow, dispatcher } from "@flow-state-dev/core";
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
  collection: issues,
  workers: {
    triage: triageBlock,                 // runs inline, in the drain
    implement: dispatcher({              // hands off to flow.task.actions.implement
      name: "hand-off-implement",
      action: "implement",
      session: "per-task",
    }),
  },
});

export default defineFlow({
  kind: "issues",
  actions: { drain: { block: board.drain } },
  task: {
    actions: {
      implement: { block: implementBlock },   // what runs in the dispatch run
    },
  },
})();
```

`implementBlock` receives the same `TaskWorkerInput` an inline worker would (`taskId`, `goal`, `input`, `metadata`, and so on). A task entry accepts the same fields as an action, `inputSchema`, `concurrency`, `onCompleted`, `onErrored`, and the rest, minus the client-facing `description` and `mcp`. No client can call it; the seat is the only way in.

### Which session a task runs in

`session` on the dispatcher decides, per row:

| `session` | How many runs | Reach for it when |
|---|---|---|
| `"per-task"` | one per task | tasks are independent |
| `"per-worker"` | one per seat, shared by every task the seat runs | the worker should remember what it already did |
| `{ key: (task: TaskWorkerInput) => string }` | one per distinct key | one issue across several seats, or a key you compute from the task |

The two presets fold `boardId` into the key, so two boards' `per-task` runs stay apart even when their task ids coincide. A custom `key` is used as returned: two seats, or two boards, that return the same string share one session. The sharing is scoped to the conversation dispatching them — the same key from another conversation is a different run — and to the instance a cross-flow seat names. A `key` function that returns an empty string fails that task.

```ts
import type { TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";

implement: dispatcher({
  name: "hand-off-implement",
  action: "implement",
  session: { key: (task: TaskWorkerInput) => (task.input as { issueKey: string }).issueKey },
}),
```

When the flow a seat hands off to needs state in each new session, such as a required readonly field, give the dispatcher a `state` beside `session`: a fixed object, or `(task) => object`, which receives the row's `assignee`, `taskId` and `input`. It works with every `session` policy, the presets included. Each new run is created with it, and the target flow's [`stateSchema` and `createCheck`](../fundamentals/state-and-scopes.md#creating-sessions) accept or refuse it. A run that already exists keeps its own state. Without one, a flow that needs it refuses every new run, and the task fails with `create-refused`.

```ts
implement: dispatcher({
  name: "hand-off-implement",
  action: "implement",
  session: "per-task",
  state: (task) => ({ issueKey: (task.input as { issueKey: string }).issueKey }),
}),
```

A run that handles several tasks does so under its entry's `concurrency` policy. The entry a `per-worker` or `key` seat hands off to defaults to `"queue"`, so those tasks run one at a time; a `per-task` seat's entry keeps the flow's default. An explicit `concurrency` on the entry wins:

```ts
task: { actions: { implement: { block: implementBlock, concurrency: "allow" } } },
```

The in-process dispatcher applies that policy, and so do queue workers that share a lease backend. On a deployment that hands dispatches to an external queue without one, the run starts in another worker and the entry's `concurrency` does not gate it.

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
  collection: supportWork,                 // a defineTaskCollection()
  workers: {
    triage: dispatcher({ name: "hand-off-triage", flowKind: "support-triage", action: "work", session: "per-task" }),
  },
  defaultWorker: dispatcher({
    name: "hand-off-by-assignee",
    action: "work",
    session: "per-task",
    flowKind: (task: TaskTargetQuery, ctx: BlockContext) => findFlowFor(task.assignee, ctx),
  }),
});
```

When the function returns `undefined` or an empty string, the hand-over is refused with a `DispatchRefusedError` whose `refused` is `"flow-not-found"`, naming the assignee, and the attempt fails through the board's ordinary error path. A task with no assignee is refused the same way, since the fallback hands a task over by the name on it. A function that throws fails the attempt with its own error.

Only a `task` dispatcher takes a function. An `internal` dispatcher given one throws when you build it. The flow the function returns is cross-flow, so `defineFlow` can't check it ahead of time; the entry named by `action` has to exist on whichever flow it returns, or the dispatch is refused `no-entry`. Workforce's worker lookup is one of these functions: see [Handing a row to the worker it names](../workforce/mailboxes.md#handing-a-row-to-the-worker-it-names).

### A task entry served by many boards

A task entry is normally reached by one board in its own flow, which puts its claim check in front of it. An entry can instead say where its tasks come from, with `from`. Its flow then needs no board at all, and any board in any flow can hand it tasks, as long as `from` knows that board's ledger.

`taskLedgers` builds the `from` value. Its `resolve` gets the ledger id each incoming task names and returns that ledger, or `undefined` for a ledger the entry takes nothing from:

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

The ledger id is the `boardId` the sending board hands off under. So a board sending into a `from` entry sets `boardId` to its ledger's id, which is what `resolve` looks up.

Each arriving task gets the same checks a board's own entry runs: same attempt, same row, still `in_progress`, still for this assignee. A ledger id `resolve` doesn't answer for is refused before any row is read, with an `UnknownTaskLedgerError` (`code: "unknown-task-ledger"`) naming the entry, the task and the ledger. The id travels with the dispatch, so treat it as untrusted: answer from `ctx`, for ledgers the running request may read, never from a map of every ledger in the process.

`taskLedgers` also takes `uses` (capabilities that declare the ledgers as resources, in place of `resources` on the flow), `onError` (`"skip"` by default, as on a board), and `allowSessionState`, which accepts an entry whose blocks keep session state. Leave that off unless the entry is handed tasks `per-task`, or its session state has the same shape for every task.

An entry with `from` that a board in the same flow also hands off to is refused when the flow is defined. Declare a separate entry for that board.

### What the board requires

`taskBoard()` throws, naming the board and the seat, unless all of these hold for a board with any seat that hands off:

- **`boardId` is set.** It is part of every dispatch run's session identity, so renaming it orphans work already in flight.
- **The collection is a `defineTaskCollection()`.** The request, sequencer, and factory backings are refused: the run settles its row after the request that claimed it is gone.
- **A `session`-scoped collection declares `sharedToLineage: true`.** Without it the run resolves an empty ledger and never finds its row. Its seats hand off within this flow; to hand rows to another flow, use a partitioned `user`-scoped collection ([A board per conversation](#a-board-per-conversation-worked-on-another-flow)). `user` and `org` scope need nothing extra.
- **The dispatcher is a named registry entry or `defaultWorker`.** A uniform `workers` block has no assignee to route by, so it can't be a dispatcher. `defaultWorker` can: it hands each task over under the assignee the task names.

`defineFlow()` throws for a dispatcher seat whose `action` the flow does not declare under `task.actions`, for a `task.actions` entry no board hands off to and no `from` serves, for a task dispatcher reachable from an action without sitting on a board, for two boards handing off to the same entry, for an entry with `from` that a board in the same flow also hands off to, and for an entry block that declares `sessionStateSchema`, at its root or in any composed child. Keep a handed-off worker's state on the task. An entry with `from` can accept session state with `allowSessionState`; see [A task entry served by many boards](#a-task-entry-served-by-many-boards).

A board that hands tasks off fixes a task's assignee while an attempt holds it: `setAssignee` on an *in progress* or *parked* task declines with reason `immutable-assignee`. A pending or blocked task can change hands. To move a parked task, `unpark` it first. The rule belongs to the collection, so a second board over the same `defineTaskCollection` value follows it too.

### What the drain reports

`board.handedOff` lists the dispatcher seats in declaration order, each with its `name`, `kind` (`"named"`), `label` (`assignee:<name>`), and `dispatch` address. A `defaultWorker` dispatcher comes last, with an empty `name`, kind `"floor"` and the label `floor`. Branch on `kind`; `label` is for messages. The list is empty on a board with no dispatcher.

The drain's final `task-board-meta` item reports `terminationReason: "handed-off"` when every outstanding task is running in a dispatch run, with `counts.in_progress` saying how many. The drain returned; the work did not finish. See [Termination](#termination-onidle-modes).

The hand-off block itself returns `{ handedOff: true, taskId, sessionId, requestId, adopted }`, where `sessionId` is the run and `requestId` the request the dispatch became. The task's worker input has to survive a JSON round-trip; a payload carrying a `Date`, a `Map`, a class instance, or `undefined` in object position fails the task in the drain, naming the offending path. A refused dispatch fails the task through the board's ordinary error path, with the same `DispatchRefusedError` a `dispatcher()` block throws, so a `.rescue()` can read its `refused` code either way.

Don't read `sessionId` as an id for this hand-off. `requestId` is the one value that is always one per dispatch. `sessionId` is the run, which is shared under `per-worker` and a shared `{ key }`; even under `per-task` it identifies the row rather than the dispatch, so a retry of that row re-enters the same session. `adopted` is how you tell the two apart: `false` when the dispatch created the session, `true` when it re-entered one that already existed.

When the dispatch arrives, the run re-reads the row and runs the worker only if the claim is still current: same attempt, same row, still `in_progress`, still routed to this seat. Otherwise it throws `StaleTaskClaimError` (`code: "stale-task-claim"`) and writes nothing, so the row is left exactly as it was. If the row is still `in_progress`, whether a newer attempt, another seat, or a row recreated under the same id holds it, that claim runs until its lease runs out and the next drain reclaims it. A row that was deleted, or is already settled or parked, has no outstanding claim, so there is nothing to reclaim.

Nothing renews the row's lease while the dispatch waits in the host's queue, so a run that starts more than a lease later finds a row the queue already counts as free. It takes that row back rather than refusing it: the claim is renewed on the same attempt, and the run proceeds if that write lands. It refuses only when the renewal is declined, which is the case another drain has already reclaimed the row and is running it elsewhere. The board claims with the collection's default two-minute lease and exposes no setting for it, so a deep queue in front of the run costs waiting and nothing else.

The board's `onError` reaches the run. `"skip"` settles the row with the error and lets that run complete; `"fail"` also fails it. See [What `status` tells you](../server/background-work#what-status-tells-you) for how that reads from the listing.

### Which run is working a task

A run is the session a handed-off task executes in. When that run starts, it writes itself onto the task. The row gains a `run` field naming the session the work is running in, the request, and the attempt:

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

To open the run, read the session first. A seat can hand its tasks to another flow, so the run doesn't always belong to the flow you read the board through. The session knows its owner:

```ts
const session = await client.getSession(task.run.sessionId);
const flowKind = session.flowId; // the run's flow, never the board's
```

Every session a run is dispatched into records its flow, so `flowId` is always there to read. Don't substitute the board's flow. Pass that `flowKind` to `useSession` and to the request reads. Through any other flow, the run's request stream answers 404.

The `run_linked` change is published on the run's own session, like everything else the run writes to the task. A view following a different session, such as the conversation that drained the board, sees `run` the next time it reads the board.

The field is written just before the worker's first step. If the write is refused, because the claim moved on in the meantime, the run stops with `StaleTaskClaimError` as it would for any stale claim. If the store fails, the run stops before the worker starts and the board hands the row out again later. If the run fails after `run` was written but before the worker starts, `run` stays: it names the run that stopped, and that run's request carries the error. Under `onError: "fail"` the request reads failed; under `"skip"` it completes with the error as its output.

`run` lasts until the task is next claimed. A completed, failed or cancelled task keeps the run that last worked it, so you can open that session and see what happened. The claim that starts the next attempt clears it, so between a hand-off and the new run's start the task has no `run`.

Read it as "which run", not "is it running". Whether work is live is the task's `status` and the run's request. Rows stored before this field existed have no `run`; treat that the same as a task whose run hasn't started. Tasks whose worker runs inline, in the drain itself, never get one.

Nothing a caller or a model sets can write `run`. Naming a session doesn't grant access to it: opening the session or aborting the request still goes through the server's owner check.

### Asking, and waiting for the answer

When the server has durable execution and runs the
[durability sweeper](/docs/advanced/durable-execution#retention-and-cleanup), `addTask` takes a
`waitForResponse` option. Set it and the task is filed as usual, on the same board a plain
`addTask` writes to, then the worker's turn parks until the task ends, and the tool returns the
task's output as its result, `{ ok: true, taskId, answer }`. One wait per step, where a step is
one model call and the tool calls it makes: a second waiting `addTask` in the same step is
refused. Where the server can't hold an ask, the option isn't in `addTask`'s schema at all, and
`addTask` files without waiting.

| Input | |
|---|---|
| `waitForResponse` | `true` to wait for the answer. Everything else is as for `addTask`, and an assignee it would refuse is refused the same way, with nothing parked |
| `timeoutMs` | How long to wait, from 30 000 (30 seconds) to 3 600 000 (an hour). Defaults to five minutes. Only with `waitForResponse`. Fires at the deadline on a long-lived server; where the sweep is an external cron, not sooner than its next run |

| Error | When |
|---|---|
| `wait_timed_out` | The task did not end within its time limit. It is cancelled |
| `wait_timeout_out_of_range` | `timeoutMs` is under 30 seconds or over an hour. Nothing is filed, and the value is never clamped |
| `wait_timeout_without_wait` | `timeoutMs` was set without `waitForResponse`. Nothing is filed |
| `wait_task_failed` | The task failed for good |
| `wait_task_cancelled` | The task was cancelled by someone else |
| `wait_already_pending` | This step is already waiting on a task. Nothing is filed |
| `wait_unavailable` | The turn is itself working a task, so it can't wait. Nothing is filed |

Stopping the conversation while its turn waits ends the turn and cancels the task. The turn
doesn't see an error, because it doesn't run again.

An asked task is an ordinary row: `listTasks` shows it, and the board's limits apply to it.
When an asked task ends, the waiting turn continues with the answer. The conversation gets no
separate completion message for it. The `addTask_<board>` action has no wait option.

## Concurrency and error handling

- `concurrency` — max parallel workers. Default `4`.
- `onError: "skip" | "fail"` — `"skip"` records the error on the offending task; siblings continue. `"fail"` rethrows; the board fails. Default `"skip"`.
- `maxAttempts` (per task) — set on a task's `TaskInit`, not on the board. While `attempts < maxAttempts`, a failed task is re-dispatched instead of left errored.
- `maxTotalRetries` (default `50`) — how many failure retries the board may authorize in total, across every task. See [Bounding the retries](#bounding-the-retries).
- `maxIterations` — safety cap on how many times a single worker loops back to claim again, not a cap across the board. Default `10000`.

`onError` reaches a [seat that hands off](#seats-that-hand-off) too, where there is no board run left to fail. `"fail"` fails the dispatch run that worker is running in, so it reports `failed`. `"skip"` leaves it reporting `completed`, with the error on the task as usual. See [What `status` tells you](../server/background-work#what-status-tells-you).

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

Then the board run fails, after every other task has finished. `onError: "skip"` does not suppress it — `skip` governs tasks, not the board's own bookkeeping.

`undetermined` is never reported as "it wasn't saved". It is a permanent answer, not a transient one, and you get it in these cases:

- **On a task store you wrote yourself.** A store built against `TaskCollectionRef` keeps no record of which write landed, so the board can never answer better than `undetermined`. There is no way to opt in.
- **On rows a persistent store already held.** Rows written by an earlier release of the board carry none, and nothing adds one, so they answer `undetermined` for as long as they live. Rows the board creates give a definite answer.

A row the board is unsure about is handed back rather than left claimed, so it settles or returns to the queue on the same pass instead of waiting out its lease.

On a [seat that hands off](#seats-that-hand-off) there is no batch to drain and no board run to defer to, so the failure fails the dispatch run itself — again regardless of `onError`.

Nothing retries a failed announcement. The item and that failure are the whole of what the board does about it.

A task can also keep returning to `pending` without ever settling. `maxAttempts` bounds ordinary retries, because `attempts` climbs on every claim until the budget runs out. The paths that re-pend a task *without* advancing `attempts` (`reclaim()`, `unblock`, `unpark`) never consume that budget, so if one of them runs in a loop against a worker that keeps failing, the task is re-dispatched each cycle instead of settling. A task handed back out because its worker died is not one of those paths: it is bounded by its own allowance and settles `errored` once that runs out.

`maxTotalRetries` bounds what the board **spends**: it counts failure retries across every task, and at the bound the next failing task settles instead of re-dispatching. `maxIterations` bounds how long a worker loops, per worker, including idle polls that claim nothing — at `concurrency: 4` a board can spend four times `maxIterations` before every worker has tripped. Neither `reclaim()` nor `unblock` spends the retry budget, so on a board looping through those, `maxIterations` is what ends it.

## Bounding how much work a board takes on

`concurrency` paces how many tasks run at once. It says nothing about how many can be *created*, so a coordinator that plans badly can queue far more work than anyone intended. The board's bounds:

- `maxEnqueuedTasks` (default `100`) — how many tasks may be **added while others are still waiting**. Checked when a task is created, against the resulting `pending` count, so a slot comes back when its task leaves `pending` by completing, erroring, or being cancelled. A task that cannot run, such as one stranded behind a failed dependency, stays `pending` and keeps its slot however long the board drains.
- `maxTotalTasks` (default `500`) — how many tasks the board may **ever hold**, completed and cancelled ones included. Never refunded by draining, so it also catches a board that keeps draining and re-queueing.
- `maxTotalRetries` (default `50`) — how many failure retries the board may **authorize in total**, across every task.
- `concurrency` (default `4`) — how many run at the same time.

Creating a task past `maxEnqueuedTasks` or `maxTotalTasks` throws a `TaskCapExceededError` carrying `cap` (`"enqueued"` or `"total"`), `limit`, and `attempted`. Nothing is written. A batch `addTasks` is all-or-nothing: if the batch would cross a bound, none of it lands. The model-facing `addTask` task tool returns a soft `{ ok: false, error: "enqueued_task_cap_exceeded" }` or `"total_task_cap_exceeded"` instead of throwing. Draining frees enqueue slots, but only for tasks that can actually run, and it gives nothing back against the lifetime bound.

The enqueue bound applies only **when a task is created**. Tasks also return to `pending` through the lifecycle, via a retry under `maxAttempts`, an `unblock`, an `unpark`, or a reclaimed lease, and none of those paths is bounded. So `pending` can sit above `maxEnqueuedTasks` for a while. `maxTotalTasks` is the hard ceiling.

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

Only failure retries count. `reclaim()`, `unblock`, and `unpark` also return a task to `pending`, and none of them spends the budget.

The budget is spent when a retry is granted, not when it runs. If a re-dispatched task is never picked up again because its worker died or its lease expired, the retry still counts.

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

- **On the request** (the default) — the tasks live on the request, so a new request starts empty and all three counts start from zero.
- **On a state you pass** — the counts last as long as that state does. A sequencer's state is restored from its checkpoint on resume, task map included, so work after a resume is checked against the tasks already there. A generator's own state is not checkpointed, so a board kept there starts its tasks and counts from zero after a resume. See [Block State → The durability boundary](../advanced/block-state#the-durability-boundary).
- **Durable (resource-backed)** — no bound is enforced. What the resource layer gives you instead is `maxInstances` on `defineTaskCollection`, and that is a capacity limit rather than a lifetime ceiling: it caps how many task instances the collection **holds at once**, and creating one past it throws. Deleting an instance through the resource collection frees the slot again, so a board that deletes and re-queues can create more tasks over its life than `maxInstances` ever allows at one moment. Creation here also goes one instance at a time, so a batch that crosses the limit stops partway and the tasks made before it stay; the all-or-nothing behavior above belongs to the request and sequencer backings only.

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

`taskBoard` and `getOrCreateTaskCollection` name backings differently. A board takes `collection: { backing: "request" }` or `{ backing: "sequencer" }`, or a `defineTaskCollection()` value. `getOrCreateTaskCollection` takes `backing: "state"` or `backing: "resource"`. With `backing: "state"` and no `state` field, the tasks live on the request, which is where a default board keeps them.

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

## Stream items emitted

A board run produces two item streams:

- `task-change` — one item per task transition (`added`, `claimed`, `completed`, `errored`, `cancelled`, and more). Keyed by `${collectionId}/${taskId}`, so the latest change for a task replaces the previous one.
- `task-board-meta` — board-level state, keyed by `collectionId`. Emitted twice per run, once with `status: "active"` at start and once with `status: "completed"` at end. The completed item carries `terminationReason` and the `counts` snapshot.

Renderers like `<TaskPlan />` subscribe to both: `task-board-meta` for the board-level status header, `task-change` for per-task rows.

A board that could not record a result emits one more item, `task-board-recorder-failure`. It carries no key, so each failure in a run is its own entry rather than replacing the last. See [When the board cannot record a result](#when-the-board-cannot-record-a-result).

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

## Changing tasks from outside a run

Workers change tasks while a board drains. Sometimes a person needs to as well: cancel a task nobody needs, bump a priority, mark one failed. `taskToolActions` gives your flow the eight task tools a model can hold, as actions any caller of the flow can run:

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

The actions are named for the board's collection: `addTask_todos`, `assignTask_todos`, `completeTask_todos`, `failTask_todos`, `blockTask_todos`, `cancelTask_todos`, `updateTask_todos` and `listTasks_todos`. A character outside letters, digits, `_` and `-` becomes `_`, so a collection `eng.work` gives `cancelTask_eng_work`. Each action carries the board's capability, so the flow doesn't have to declare the collection itself.

Pass a roster and the actions check assignees the way the model's tools do: `taskToolActions(board, roster)`, or `taskToolActions(collectionId, resolve, roster)`. An `addTask`, `assignTask` or `updateTask` naming someone the roster doesn't is answered `{ ok: false, error: "unknown_assignee: …" }` and writes nothing. The roster can also be a function of the running block's context, `(ctx) => roster`, read on every call that checks an assignee, for a board whose team changes from one session to the next. `createTaskToolsCapability(resolve, roster)` takes the same function. Without a roster, any assignee is accepted.

Each one runs the same checked transition a worker's would. A move the task can't make comes back as `{ ok: false, error }` and writes nothing. None of them claims a task or drains the board. Settling a task a worker is still running is allowed, as it is for a coordinator: your write lands, and the worker's own result is declined when it arrives.

The board needs a collection that outlives a request, built with `defineTaskCollection`. `taskToolActions` throws for a board on any other backing, because a later action could never find its tasks.

These are public actions. Anyone who can call your flow can call them, so add them only to a flow whose callers you trust with the board. The DevTool's Tasks tab offers the ones that take a `taskId` on each row.

## Collection backing

A board stores its tasks in one of four places. You choose once; nothing downstream restates it.

- **Request (default)** — tasks live on `ctx.request` and survive every block boundary in the request, including re-entry across an outer loop (Plan and Execute replans this way) and adds from sibling steps before or during the drain. Omit `collection` entirely, or pass `{ collectionId }` to name it (the id defaults to the board name).
- **Durable (resource-backed)** — tasks outlive the request. Declare the collection with `defineTaskCollection` and pass it as `collection`; the board registers and resolves it for you. Don't count on a running request seeing a write made by another request; a later request reads it.
- **Sequencer** — tasks live on the board's own sequencer state, which lasts one `board.drain` invocation. Opt in with `{ backing: "sequencer", collectionId }`. Calling the board twice gives two independent collections.
- **Factory** — tasks live in a store you manage. Pass a function `(ctx) => TaskCollectionRef` as `collection`; the rules for writing that ref are below.

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

If you write that ref by hand, `complete` and `fail` should accept and honor the optional `TaskTransitionOptions` third argument. TypeScript won't catch it if you don't: a two-argument `complete(id, output)` satisfies the interface structurally, and JavaScript drops the extra argument without a word. The board passes those options on every write-back, so a result landing on a task someone else already settled is declined rather than thrown.

A ref that ignores them throws instead, and the board contains that throw: it drops the late result and keeps draining. One misbehaving write-back costs one task, not every task the board hadn't claimed yet.

Containment is not a substitute for the guards. It fires on a throw. A stale write the state machine happens to permit — a worker reporting success on a task another worker has since taken over — doesn't throw. It commits, and it overwrites the result the current holder is about to record. Nothing outside your store can catch that, because the decision belongs inside the write. So honor the guards for the sake of your data; the board's survival is already covered. See [recording a result that may no longer apply](task-substrate.md#recording-a-result-that-may-no-longer-apply).

Write provenance is the one part you can skip. Maintaining it correctly means reproducing a bounded receipt log and its eviction flag, and the mutator that does that is internal to the two built-in backings — not a documented extension point today. A hand-written ref that leaves `revision`, `writeLog`, and `writeLogTruncated` unset is not wrong for it: callers asking [whether their write landed](task-substrate.md#telling-whether-your-write-landed) get `undefined`, which means "cannot tell", not "your write did not land".

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

### A board per conversation, worked on another flow

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

Rows are stored at the user's scope, under the partition the running session's function returns. A board resolved in one session reads, claims, waits on and settles only its own partition, and so do its task tools and its `taskToolActions`. When the board hands a row off, the dispatch carries the partition, and the task entry on the other flow reads its one row there, with every check a board's own entry runs.

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

### A board a mailbox holds

A [mailbox](../workforce/mailboxes.md) can keep a durable board of its own, declared in its `MAILBOX.md` rather than in TypeScript. The mailbox owns the ledger and gains two actions for filing and reading rows; a worker that claims those rows resolves the same collection with `mailboxBoard` and drains it like any other durable board.

```ts
import { mailboxBoard } from "@flow-state-dev/workforce";

const followups = mailboxBoard("engineering.incidents", "followups");
const board = taskBoard({ name: "followups", collection: followups, workers });
```

The collection is org-scoped, so its rows sit in the organization the mailbox runs in. The mailbox id and board name in that call are retyped, and a typo resolves a second, empty ledger rather than failing; the unattended-board warning at hire is what catches it. See [holding a board](../workforce/mailboxes.md#holding-a-board).

## See also

- [Configuration](./configuration) — every `taskBoard` field, including defaults.
- [Mailboxes](../workforce/mailboxes.md#holding-a-board) — declaring a durable board on a mailbox in Markdown, and reaching it from a worker.
- [Task substrate](./task-substrate.md) — the `Task` record, the status state machine, and the collection API underneath.
- [GoalSeekLoop](./goal-seek-loop) — a config-driven, judge-gated loop over the board's drain.
- [Block State](../advanced/block-state) — the primitive behind the board's sequencer-scoped task collection; see [The durability boundary](../advanced/block-state#the-durability-boundary) for what survives a resume.
- [Parallel Tasks](../patterns/parallelTasks) — single-pass fan-out wrapper on top of the board.
- [Supervisor](../patterns/supervisor) — per-task review wrapper.
- [Plan and Execute](../patterns/plan-and-execute) — replan-loop wrapper.
- [Flow policy](./flow-policy) — the observation ledger, `priorWork` shaping, and tool-result caching.
- [Patterns Overview](../patterns/overview) — when to use which pattern.
- [Human-in-the-Loop guide](/guides/human-in-the-loop) — pausing a single step for an approval with `ctx.suspend()`, and the card that resolves it.

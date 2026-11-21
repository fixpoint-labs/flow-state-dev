---
title: Task board
type: reference
description: "Options, task statuses and the moves between them, stop reasons, concurrency, retries, where the list is stored, and assignees that dispatch."
---

import Figure from "@site/src/components/Figure";
import States from "./figures/task-board-states.svg";

# Task board

Some work is a list: research three competitors, then write the comparison. Each item has an owner, may wait on another item, can fail and be tried again, and may end up cancelled. A task board is that list, stored, plus the loop that works through it, called the drain.
`taskBoard` from `@flow-state-dev/orchestration/task-board` builds a board and returns a handle. This page lists every option, status, stop reason and limit. For how a board works and when to use one, read [Tasks and boards](../concepts/tasks-and-boards.md).

The examples belong to one app. Its `research` flow has a board that works one task per competitor (`acme`, `globex`, `initech`) before a `compare` task writes the comparison.

```ts title="src/flows/research/blocks/research-board.ts"
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { analyst } from "./analyst";

export const researchBoard = taskBoard({
  name: "research",
  workers: analyst,
  concurrency: 3,
  maxTotalRetries: 10,
});
```

The block that does a task takes the task's `TaskWorkerInput` (its `goal`, `input`, `deps` and more) and returns the task's output.

```ts title="src/flows/research/blocks/analyst.ts"
import { handler } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

export const analyst = handler({
  name: "analyst",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ summary: z.string() }),
  execute: (task) => ({ summary: `Notes on ${task.goal}` }),
});
```

Put `researchBoard.drain` in a flow as a step.

## The handle

| Member | What it is |
|---|---|
| `drain` | The sequencer to put in a flow as a step. |
| `collectionId` | The id of the task list. It matches `data.collectionId` on the items the board emits. |
| `capability` | Put it in a block's `uses`. The board's tasks are at `ctx.cap.<name>`, with the board's `name` verbatim (`ctx.cap["my-board"]` for a hyphenated one). |
| `backing` | Where the list is stored: `"request"`, `"resource"`, `"sequencer"` or `"factory"`. See [Where the list is stored](#where-the-list-is-stored). |
| `mode` | `"plan"` or `"delegation"`. |
| `boardId` | The declared id, or absent. |
| `dispatchers` | The assignees that dispatch, in declaration order. Each has `name`, `kind` (`"named"`, or `"floor"` for `defaultWorker`, whose `name` is empty), `label` (`assignee:<name>` or `floor`) and `dispatch`. `newSession` is not listed. Empty on a board with none. |
| `hasIdlessInitialTasks` | `true` when any `initialTasks` entry has no `id`. |
| `caps` | The resolved creation caps, defaults applied. `{}` when you supplied the collection. Spread `...board.caps` into a `getOrCreateTaskCollection` that resolves the same list, or that reference enforces no caps. |

## Options

| Option | Type | Default | What it does |
|---|---|---|---|
| `name` | `string` | required | Name of the outer sequencer and the prefix of every internal block. Unique within a flow that mounts more than one board. A name that is a property of every object, such as `__proto__` or `toString`, throws. |
| `boardId` | `string` | none | A stable id. Required when any assignee, or `newSession`, dispatches. The `"per-task"` and `"per-worker"` sessions fold it into their key, so renaming it orphans live runs. A custom `{ key }` is used as returned. It also scopes the check a dispatched run makes that its claim is current. |
| `mode` | `"plan" \| "delegation"` | `"plan"` | Whether the drain waits on its tasks. See [Assignees that dispatch](#assignees-that-dispatch). |
| `collection` | request spec, sequencer spec, `defineTaskCollection(...)` or a factory | request-backed, `collectionId` = `name` | Where the list is stored. See [Where the list is stored](#where-the-list-is-stored). |
| `workers` | one block, or `{ [assignee]: block }` | required | A single block runs every claimed task. A registry routes on `task.assignee`. On a delegation board each registry value is a `dispatcher(...)`. |
| `defaultWorker` | block or task dispatcher | none | The registry fallback for a task whose assignee is unknown or absent. Without it, such a task fails as `onError` says. A task dispatcher here hands each such task over under the assignee the task names. A declared worker never routes through it. |
| `newSession` | task dispatcher | none | Plan boards only. A task filed with `session: "new"` runs in a session of its own and the drain waits on it. A delegation board that sets it throws. |
| `concurrency` | `number` | `4` | How many workers run at once. Below 1 throws. |
| `maxEnqueuedTasks` | `number \| null` | `100`, or the lifetime cap if that is lower | Most tasks that may be added while others are `pending`. `null` is unbounded. |
| `maxTotalTasks` | `number \| null` | `500` | Most tasks the list may ever hold, finished ones included. `null` is unbounded. |
| `maxTotalRetries` | `number \| null` | `50` | Failure retries the board may grant across every task. `0` never retries. `null` is unbounded. |
| `claimOrder` | `"fifo" \| "priority" \| ClaimOrder` | `"fifo"` | How a ready task is picked. See [Concurrency](#concurrency). |
| `onIdle` | `"complete-or-blocked" \| "complete" \| "wait"` | `"complete-or-blocked"` | When the worker pool stops. See [When the pool stops](#when-the-pool-stops). |
| `initialTasks` | `TaskInit[]` | `[]` | Tasks written into the list at the start of each drain. A task whose `id` already exists is skipped. One without an `id` is added again on every drain of the same list. |
| `onError` | `"skip" \| "fail"` | `"skip"` | What a worker that throws does. `"skip"` writes the failure to that task and the siblings go on. `"fail"` writes it, then rethrows, so the drain fails. With attempts left, `"fail"` rethrows after the task was re-queued. |
| `maxIterations` | `number` | `10000` | Per worker, how many times it loops back to claim again. Below 1 throws. `goalSeekLoop`'s `maxIterations` counts drains, and setting one does not set the other. |
| `shouldExit` | `(collection) => boolean` | none | The stop test for `onIdle: "wait"`, run once per worker iteration and on each wake while a worker waits idle. Ignored in the other two modes. |
| `idlePollMs` | `number` | `50` | An idle worker wakes when a task changes on the board. If none does, it re-checks after `max(idlePollMs * 100, 50)` ms, 5,000 ms by default. Below 0 throws. |
| `toolCache` | `boolean \| { enabled?, defaultTtl?, maxEntries?, defaultScope? }` | on when a worker tool is `cacheable` | Memoizes tool results for one board run, and is torn down when the run ends. `false` turns it off. `defaultScope` is `"run"`, `"request"` or `"session"`, default `"run"`. `maxEntries` defaults to 5,000. |
| `flowPolicy` | `TaskFlowPolicy` | `declaredDepsOnly()` | Which earlier tasks' observations a worker sees as `priorWork`. |

`taskBoard()` throws at construction for:

| Condition | Rule |
|---|---|
| `concurrency` or `maxIterations` below 1, `idlePollMs` below 0 | The value must be in range. |
| An unknown `claimOrder` string | Only `"fifo"` and `"priority"` are names. |
| A `dispatcher` key | The option is `claimOrder`. |
| `maxTotalTasks`, `maxEnqueuedTasks` or `maxTotalRetries` beside a supplied `defineTaskCollection` or factory | The caps apply only when the board builds its own list. |
| A cap that is not a positive integer or `null` (`maxTotalRetries`: not a nonnegative integer or `null`), or an enqueue bound above the lifetime bound | Each cap is a count. |
| A mode that contradicts the assignees, or a dispatching board missing `boardId`, a durable collection or `sharedToLineage` | See [What the board requires](#what-the-board-requires). |

## Task statuses

A task has one of six statuses: `pending`, `in_progress`, `held`, `completed`, `errored`, `cancelled`. The last three are final. A status move that the table below does not list throws `IllegalTaskTransitionError`.

<Figure svg={States} caption="A task's states" description={"Three boxes across the top: held, pending and in_progress. Pending is highlighted: it is the status a worker claims, besides an in_progress task whose lease lapsed. Arrows run both ways between held and pending, labelled hold and release, and between pending and in_progress, labelled claim and retry. Below in_progress, arrows labelled fails and done run to errored and completed. A wide cancelled box at the bottom receives cancel arrows from held, pending and in_progress. Dashed arrows, which apply only through the retryTask action, run from errored and from cancelled back to pending. Notes say a failure with attempts left sends in_progress back to pending, that a lapsed lease keeps the task in_progress until the next claim takes it back, that completed, errored and cancelled are final except for retryTask, and that a task waiting on a user keeps its status and gains a hold."} />

| From | To | What moves it |
|---|---|---|
| `pending` | `in_progress` | A worker claims it. All its `deps` are `completed`, it is not `held`, and it has no open hold. |
| `pending` | `held` | It was filed with `held: true`, or `updateTask({ status: "held" })` before the first start. |
| `held` | `pending` | Released with `updateTask({ status: "pending" })`. |
| `pending`, `held`, `in_progress` | `cancelled` | A cancel, or a cascade. See [What cancels a task?](#what-cancels-a-task) |
| `in_progress` | `completed` | The worker's turn returns. |
| `in_progress` | `errored` | The worker throws with no attempts left, the worker ends the task for good, the retry budget refuses a retry, or a claim finds the task's lease lapsed after 3 abandonments. |
| `in_progress` | `pending` | A failure with attempts left, or the collection's `reclaim()` call on a task whose lease lapsed. A lease is the time a worker's claim on a task stays valid. See [Task collections](./task-collections.md). |
| `errored`, `cancelled` | `pending` | The `retryTask` action only. The same task, id, messages, output so far and spend, with one more attempt. |

- A task waiting on a user keeps its status and gains an open hold, which the claim skips. A hold is an open question or approval for a user, or a wait on something outside the board (`actor: "system"`), which reports `waiting-on-an-event`. `getTask` and `listTasks` show open holds as `holds`. Its shape is in [Task collections](./task-collections.md).
- The `held` status is separate from a hold. It keeps a task from being claimed until it is released. It is set at filing with `held: true`, or by `updateTask({ status: "held" })` before the first start, from the filer (the block or model that filed the task) or the `updateTask_<suffix>` action, where the suffix is the collection id with every character outside `[a-zA-Z0-9_-]` turned into `_`.
- A lapsed lease does not change the status. The next claim takes the task where it stands: it stays `in_progress`, `attempts` and `abandonments` each go up by one, no failure is recorded, and the retry budget is not spent. A claim that finds a task already abandoned 3 times settles it `errored` instead, with `error` reading `[tasks] task "<id>" was abandoned by its worker 3 times without completing. Not re-dispatched.`
- Every status change emits a `task-change` item. Its key, visibility and the kinds of change are in [Items and the stream](./items.md).
- Under `onError: "skip"` a task's failure does not fail the run. The drain ends normally and the final `task-board-meta` reports `blocked-by-failures`.

### What cancels a task?

| Cancels the task | Detail |
|---|---|
| `updateTask({ id, status: "cancelled" })` | From the filer's tool or the `updateTask_<suffix>` action. Allowed until the task finishes. Sent alone. |
| A confirm answered No | A confirm question whose `onNo` is `"cancel"` (the default) cancels the task, with the No and its note as the reason. |
| `TaskEndsForGoodError(message, { taskId, ending: "cancelled" })` | Thrown by a worker for the task it holds. |
| A cascade | A task it depends on failed for good or was cancelled. |
| Stopping the run of a task that waits on a user | The task is cancelled, not failed. |
| Stopping a conversation whose turn waits on a task | The task it waits on is cancelled. |

A task that has finished cannot be cancelled. The call answers `task_finished`.

### Cascade rules

- A task that ends `errored` or `cancelled` cancels every open task whose `deps` name it, then every task that depends on those, to the end of the chain. Each is `cancelled`, labelled `"skipped"`, with `causedBy` naming the task that ended and `error` reading `dep <id> failed` or `dep <id> was cancelled`. Every board does this.
- A task that fails, retries or is cancelled also cancels the open tasks it filed, on a board whose collection sets `cascadeFiled`. The Workforce conversation board does. A plain board does not.
- A retry cancels no dependents and sends the filer no notice. A dependent that the failure cancelled stays cancelled until it is retried too.
- A filing is refused when its `deps` could never be met: `dependency_not_on_board`, `dependency_ended` or `dependency_loop`. Nothing is filed. In a batch, ids in the same batch count. `createTask` answers `{ ok: false, error }`. `createTasks` and `initialTasks` throw `TaskFilingRefusedError` with `rule` and `taskId`. A replan batch differs: a task whose dependency already ended is filed `cancelled` and `skipped`, along with the batch tasks that depend on it, and any other refusal fails the run.
- A `planAndExecute` plan's output reads `errored` as `failed`, `cancelled` as `skipped` and `in_progress` as `in-progress`. `pending` and `completed` pass through.

## Stop reasons

A drain ends with a `task-board-meta` item. Its `terminationReason` says why the board stopped, and its `counts` holds `total`, one count per status, and `retries`, the failure retries the board has granted. The item's key, visibility and fields are in [Items and the stream](./items.md).

`terminationReason` is one of six values. The board checks the conditions below in order, and the first match sets the value.

| Order | Value | Means |
|---|---|---|
| 1 | `retry-budget-exhausted` | A retry was refused because `maxTotalRetries` was spent. Reported when a task has `retryLedger.deniedByBudget: true`. |
| 2 | `all-completed` | Every task is `completed`, or the board was empty. |
| 3 | `blocked-by-failures` | A task is `errored`, `cancelled` or `held`. |
| 4 | `blocked-by-failures` | A remaining task is going nowhere: a dependency no running work will satisfy, or a running task its worker abandoned. A task that only depends on a task waiting on a user does not count. |
| 5 | `waiting-on-a-user` | The work left waits on a user: a question, a confirm, or a run stopped for a review or an approval. |
| 6 | `waiting-on-an-event` | The work left waits on something outside the board, and none of it on a user. |
| 7 | `dispatched` | Every remaining task is running in a dispatched run. Treat it as a success. `counts.in_progress` is how many are running. Only a `mode: "delegation"` board reports it. |
| 8 | `blocked-by-failures` | Anything else. |

- A failed, cancelled or `held` task beside a task waiting on a user reports `blocked-by-failures`. A `held` task with an open question is `blocked-by-failures`, not `waiting-on-a-user`.
- `waiting-on-a-user` and `waiting-on-an-event` mean nothing went wrong and nothing is finished. The next drain after the answer picks the work up. They are stop reasons on the board, not task endings, and a task stopped for a user raises no notice until it ends.
- In `onIdle: "wait"`, a `shouldExit` that fires with tasks running reports `blocked-by-failures`, though nothing failed. Read `counts` to tell.

### Which stop reason means a task is waiting on a user?

`waiting-on-a-user`, on the board's `task-board-meta` item. `goalSeekLoop` ends a pass with the same words, and with `waiting-on-an-event`. See [Patterns](./patterns.md).

### When the pool stops

`onIdle` is decided once per worker iteration.

| `onIdle` | The pool stops when |
|---|---|
| `"complete-or-blocked"` (default) | The board is **drained**: no task is `pending` or `in_progress`. Or **blocked**: no worker is running a task and no `pending` task is claimable, because every remaining one has a dependency that is not `completed` or every running one waits on a user. |
| `"complete"` | No task is `pending` or `in_progress`. A pending task whose dependency never completes keeps every worker cycling until `maxIterations`. |
| `"wait"` | `shouldExit(collection)` returns `true`, or `maxIterations` trips. Never on its own. |

A task waiting on a user is `in_progress` but does not occupy a worker. On `"complete-or-blocked"`, a board whose only open tasks wait on a user stops blocked and leaves them as they are. On `"complete"` they keep the loop alive until answered. A plan board counts every `in_progress` task as holding the drain open. On a delegation board, a running task whose lease is live does not keep the drain open. Once its lease lapses, it does until a worker claims the task again.

### What `board.drain` returns

An array with one entry per worker, so `concurrency` entries, each `{ shouldContinue: boolean, reason: "drained" | "exit" | "claimed" | "idle" | "blocked" }`. A finished worker's entry is `shouldContinue: false` with `"drained"`, `"blocked"` or `"exit"`. A worker stopped by `maxIterations` keeps its last entry, `shouldContinue: true` with `"claimed"` or `"idle"`. The drain does not return the tasks. Read them in the next step:

```ts title="src/flows/research/blocks/compare.ts"
import { handler } from "@flow-state-dev/core";
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";

export const compare = handler({
  name: "compare",
  inputSchema: z.unknown(),
  outputSchema: z.array(z.unknown()),
  execute: async (_input, ctx) => {
    const tasks = await getOrCreateTaskCollection({
      ctx,
      backing: "state",
      collectionId: "research",
    });
    return tasks.list({ status: "completed" }).map((task) => task.output);
  },
});
```

## Concurrency

| Setting or rule | Value |
|---|---|
| `concurrency` | Default `4`. The board runs exactly that many workers, each its own claim, run and check loop. |
| Readiness | A task is claimable when it is `pending`, or `in_progress` with a lapsed lease or a turn owed (a question answered, or a steer not yet taken), has no open hold, and every `deps` entry is a task on the board with status `completed`. A dependency id that names no task is not satisfied. |
| Idle wake | An idle worker wakes on a `task-change` item for this board, else re-checks on the timer set by `idlePollMs`. A task added mid-drain is taken promptly. |
| `maxIterations` | A per-worker cap on loop-backs. At `concurrency: 4`, four workers may each spend it. |
| Dispatched entries | The task entry that a `per-worker`, `{ key }` or `{ by }` dispatcher addresses defaults to `concurrency: "queue"`, so several tasks can land in one session. A `per-task` dispatcher's entry keeps the flow default. An explicit `concurrency` on the entry wins. |

A claim is held by one worker under a lease. How a claim is held, lapses and is taken back is in [Task collections](./task-collections.md).

### Claim order

`claimOrder` is `"fifo"` (the default), `"priority"`, or any `ClaimOrder`, an object with `claim(collection, workerId, ctx)`.

| Order | Picks |
|---|---|
| `"fifo"` | The earliest-created ready task. Ties break on `id`. |
| `"priority"` | The ready task with the highest `priority`, an unset one counting 0. Ties break on earliest created, then `id`. |

Neither claims a task with unmet `deps`.

## Retries

### What does `maxAttempts` change?

`maxAttempts` is set on a task's `TaskInit`, not on the board. Unset, a failure is final and the task goes to `errored`. Set, a failure puts the task back to `pending` while it has attempts left, `maxAttempts` less the attempts used so far (an attempt lost to a dead worker is not used). A retry clears the task's `error` and keeps the error text as `feedback`, which reaches the next attempt on `TaskWorkerInput.feedback`. Each retry spends one grant of `maxTotalRetries`. Once attempts are spent, the task goes to `errored`.

| Rule | Detail |
|---|---|
| What counts as an attempt | `attempts` counts every claim, including the one after a worker died. The attempts that spend `maxAttempts` are `attempts` less those recoveries. An answer to a question, and a message, each take a turn on the same attempt and use none. |
| Editing it | Only before the task first starts. |
| A conversation-result task | `resultTo: "conversation"` has one attempt. An unset `maxAttempts` reads as 1, and any other value is refused at filing with `conversation_result_one_attempt`. |
| `TaskEndsForGoodError(message, { taskId, ending? })` | From `@flow-state-dev/orchestration/task-board`. A worker that knows a failure would repeat throws it for the task it holds. The board ends that task on this attempt, `errored` or `cancelled` with `{ ending: "cancelled" }`, with the message as the reason and no retry. Dependents and filed work cascade as for any ending. It counts only for the task it names. |
| `retryTask` | Action only. Puts an `errored` or `cancelled` task back to `pending`. A task with tries left keeps them, and one with none gets exactly one more. A failure's `error` becomes the next attempt's `feedback`. A cancel's reason does not. |

### `maxTotalRetries`

| Rule | Detail |
|---|---|
| Value | A nonnegative integer or `null`. Default `50`. `0` runs every task once and never retries. `null` is unbounded. |
| What it counts | Failure retries the board grants across every task, the sum of each task's `retryLedger.granted`. A `reclaim()` or release also returns a task to `pending` and does not spend it. |
| When it is spent | When the retry is granted, not when it runs. A first attempt is never refused. |
| At the bound | The next task that fails goes to `errored` with `error` ending `not retried: collection "<id>" has spent its retry budget of <n> (maxTotalRetries). Raise it, or pass null to opt out.` and `retryLedger.deniedByBudget: true`. The drain counts it as resolved and ends normally. |
| Per-task record | `task.retryLedger = { granted, deniedByBudget }`, absent on a task that never failed. Read `task.retryLedger?.granted ?? 0`. |
| Where it applies | Only when the board builds its own collection. On a resource-backed list retries are counted and the bound is not enforced. A direct `getOrCreateTaskCollection({ backing: "state" })` with no `maxTotalRetries` applies no bound. |
| `retryTask` | Refused `retry_budget_spent` where the budget is enforced and spent. |

### Creation caps

| Bound | Default | Counts | Refund |
|---|---|---|---|
| `maxEnqueuedTasks` | `100`, or the lifetime cap if that is lower | Tasks added while others are `pending`, checked at creation against the resulting `pending` count. | A slot frees when its task leaves `pending`. |
| `maxTotalTasks` | `500` | Every task ever on the list, finished ones included. | Never. |

- Past either bound, creating a task throws `TaskCapExceededError` with `cap` (`"enqueued"` or `"total"`), `limit` and `attempted`, and writes nothing. A batch `createTasks` is all-or-nothing on the request and sequencer backings. The `createTask` tool answers `{ ok: false, error: "enqueued_task_cap_exceeded" }` or `"total_task_cap_exceeded"`. A planned or replanned set that crosses a bound is refused as a whole.
- On a request-backed board the list ends with the request, so 100 pending and 500 total apply per request.
- The enqueue bound applies only when a task is created. A task returning to `pending` by retry, release or reclaim is not bounded, so `pending` can exceed `maxEnqueuedTasks`. `maxTotalTasks` is the hard ceiling.
- An omitted enqueue bound is `min(100, maxTotalTasks)` when the total is a number. An explicit one above the lifetime bound throws, as do `0`, a negative, a fraction, `NaN` and `Infinity`.
- The bounds belong to the collection reference the board built. A second reference over the same list, made without `board.caps`, enforces none. `createApplyReplan` with `capability: board.capability` uses the board's, and with only `name` it enforces none.
- The cap options exist only on `backing: "state"`. Passing them with `backing: "resource"` is a TypeScript error.

A result the board stores but cannot report, and the `task-board-recorder-failure` item it emits, are in [Task collections](./task-collections.md).

## Where the list is stored

The `collection` option picks where the list is stored. `board.backing` reads the choice back.

| Choice (`collection:`) | `backing` | Lasts | Who can reach it |
|---|---|---|---|
| Omitted, `{ collectionId?, stateKey? }` or `{ backing: "request", ... }` | `"request"` | The request. A new request starts empty. It survives every block boundary in the request, including a second `board.drain` (a replan loop) and adds from sibling steps. | Any block in the request that lists `board.capability`, or resolves it by `collectionId` with `getOrCreateTaskCollection({ ctx, backing: "state", collectionId })`. |
| `{ backing: "sequencer", collectionId, stateKey? }` | `"sequencer"` | One `board.drain` invocation. Two calls give two lists. The parent sequencer's `stateSchema` needs a `Record<string, Task>` slot at `stateKey` (default `"tasks"`). No public schema for it is exported. | Blocks inside the board's own sequencer. The capability throws from outside it. |
| `defineTaskCollection({ id, scope, ... })` | `"resource"` | Stored as resources, so it outlives the request, for the scope named. No cap or retry budget is enforced. | By `scope`: `"session"` one session, `"user"` one user within one organization, `"org"` one organization. |
| A function `(ctx) => TaskCollectionRef` | `"factory"` | Whatever your store does. `collectionId` is the literal `"factory-supplied"`. The board applies no caps. | Whatever your store allows. |

Which sessions and users reach a stored list is in [Resources](./resources.md).

| Part | Owner | Seen by | Stored in | How many |
|---|---|---|---|---|
| The list on the request | The request | Blocks in the request | `ctx.request.state[stateKey]`, with `stateKey` defaulting to `collectionId`, which defaults to the board `name` | One per `collectionId` in a request |
| The list on a sequencer | The `board.drain` call | Blocks inside that sequencer | The sequencer's state at `stateKey` | One per invocation |
| The list as resources | The scope's owner | The users the scope names | The store, one resource instance per task at `<id>/**` | One per `id` per scope instance |
| A task | The list it is in | As the list | In the list | One per task, with at most 20 messages and 20 questions |
| `task-change` and `task-board-meta` items | The request that made the change | The client, not the model's history | The request's item stream | One `task-change` key per task, one `task-board-meta` key per `collectionId` |
| The tool-result cache | The board run | The board run | Memory, torn down when the run ends | One per run |

The options of `defineTaskCollection` are in [Task collections](./task-collections.md). `taskToolActions` throws for a board on any backing but a `defineTaskCollection`. Including a board in a flow installs its collection resources on the drain and on `board.capability`.

## Assignees that dispatch

An assignee that dispatches is a `dispatcher({ name, action, session, flowKind?, state?, wait? })` from `@flow-state-dev/core`, placed where a worker block would go. The drain claims a task, hands it to a dispatched run in another session, and moves on. The task stays `in_progress` until that run settles it. `dispatcher` sets its own `type` to `"task"`; leave it unset.

### Mode

| `mode` | Tasks run | The drain waits on |
|---|---|---|
| `"plan"` (default) | In the drain, or in another session through an assignee that dispatches or `newSession`. | Every task. |
| `"delegation"` | In another session, through a dispatcher assignee. | No task. It returns once each task is on its way, and the session working a task settles it. |

### Which worker runs a task

| Case | What happens |
|---|---|
| `workers` is one block | Every claimed task runs in it. |
| `workers` is a registry and the task's `assignee` matches | It runs on that worker. |
| The assignee is unknown or absent and `defaultWorker` is set | It runs on `defaultWorker`. A task dispatcher there hands the task over under the assignee the task names, and a task with no assignee fails. |
| The assignee is unknown or absent and there is no `defaultWorker` | The task fails as `onError` says. |

The task tools refuse an assignee that is not on a roster you give them. Without a roster, any assignee is accepted. See [Tools](./tools.md).

### What the board requires

`taskBoard()` throws, naming the board and the assignee, unless:

| Requirement | Applies to |
|---|---|
| `mode: "delegation"`, `workers` is a registry, and every assignee dispatches: the named ones and `defaultWorker` | A board with no inline assignee. |
| `boardId` is set | Any board with a dispatching assignee or `newSession`. |
| `collection` is a `defineTaskCollection()` | Request, sequencer and factory lists are refused. A request or sequencer list ends before a dispatched run settles its task. |
| A `session`-scoped collection declares `sharedToLineage: true` | `user` and `org` need nothing extra. |
| The dispatcher sits at a named registry entry or `defaultWorker` | A uniform `workers` block cannot dispatch, so a delegation board always has a registry. |
| A plan board's dispatcher does not say `wait: false`, and a delegation board's does not say `wait: true` | Plan and delegation boards with a dispatcher. |
| A delegation board has at least one dispatcher | Delegation boards. |
| `newSession` is a task dispatcher | Plan boards only. |

A board that dispatches freezes the assignee on an `in_progress` task: a change is declined `immutable-assignee`. A pending or held task can change hands.

`defineFlow` throws for a flow that holds such a board without the internal entry its endings go to (`onTaskSettled`, or on a plan board the pass entry its collection names; a board whose only dispatch is `newSession` needs none), a dispatcher `action` the flow does not declare under `task.actions`, a `task.actions` entry no board dispatches to, two boards dispatching to one entry, and an entry block that declares `sessionStateSchema`.

### Which session a dispatched task runs in

| `session` | Runs |
|---|---|
| `"per-task"` | One per task. A follow-up task (`followUpOf`) runs in the session of the task it follows. |
| `"per-worker"` | One per assignee, shared by every task it runs. |
| `{ key: (task, ctx) => string }` | One per distinct key. An empty string fails the task. |
| `{ by: (task, ctx) => { key } \| { id } }` | Chosen per task: a keyed run, or an existing session by id. The id is never created. A missing session, or one that is not the principal's or the flow's, fails the task with `session-not-found` or `session-not-addressable`. An answer that is not exactly one non-empty `key` or `id` fails the task. |

- The two presets fold `boardId` into the key, so two boards' runs stay apart. A custom `key` is used as returned.
- A task keeps its session for its whole life. When a worker asks a question, the answer returns to that session on the same attempt.
- `flowKind` may be a function `(task, ctx) => string | undefined` on a `task` dispatcher, with `session: "per-task"`. An `undefined` or empty answer is refused `flow-not-found`.
- `action` may be `{ among: string[], by: (task, ctx) => string }`. Every name in `among` must be under `task.actions`. An answer outside `among` fails the task with `no-entry` before anything is sent.
- `state` is the starting state of each new run, a fixed object or `(task) => object`. The target flow's `stateSchema` and `createCheck` accept or refuse it. An existing run keeps its own. With none, a flow that needs state refuses every new run and the task fails `create-refused`.
- A refused dispatch fails the task through the board's ordinary error path, with a `DispatchRefusedError` whose `refused` is one of `no-entry`, `flow-not-found`, `session-not-found`, `session-not-addressable`, `key-occupied`, `create-refused`, `no-dispatch-operation`, `dispatch-rejected` or `external-flow-runner`. `external-flow-runner` is a `{ by }` answer of `{ id }` on a host that runs flows on an external job queue. See [Concurrency](./concurrency.md#where-a-policy-holds).

### What a dispatch returns and when the task is done

- The dispatch returns `{ dispatched: true, taskId, sessionId, requestId, adopted }`. `adopted` is `false` when the dispatch created the session and `true` when it re-entered one.
- The entry receives the same `TaskWorkerInput` as an inline worker: `taskId`, `goal`, `title`, `context`, `input`, `deps`, `attempts`, `feedback`, `steers`, `followUpOf`, `metadata`, `priorWork`, `attachments`, `sealed`.
- The task gains `run: { sessionId, requestId, attempt, startedAt? }` when the run starts. The next claim clears it. It is not set on inline tasks.
- The run settles its task once, when all its work is over. `keptOpenBy` on the task names what is holding it open until then. [Background work](./background-work.md) has the rules.
- The task's output is the latest `reportProgress` checkpoint. With none, it is the answer from the last turn that counts toward the task, which [Background work](./background-work.md) defines.
- If the board cannot record the result, the dispatched run's request reports `failed`.
- `onError: "fail"` fails the dispatched run. `"skip"` leaves it `completed` with the error on the task.

### How a dispatched task's ending is heard

The flow declares an `onTaskSettled` internal action, which runs once per ending in the session that filed the task. The notice's fields, when it is sent and what happens when it cannot be delivered are in [Background work](./background-work.md), with `taskLedgers`, which lets one entry serve boards in several flows.

## Task tools

The tools a filer's model calls to file and manage work (`createTask`, `getTask`, `listTasks`, `updateTask`), the worker's `reportProgress`, the questions a task asks a user, and the `retryTask` action work on the collection operations in [Task collections](./task-collections.md).

## Next

- [Tasks and boards](../concepts/tasks-and-boards.md) explains what a board is and when to use one.
- [Patterns](./patterns.md) lists the patterns that run a board, the board settings each fixes, and their options.
- [Task collections](./task-collections.md) covers claims, leases, holds and the options of a stored list.
- [Tools](./tools.md) has the task tools a filer's model and a worker call.
- [Workforce](./workforce.md) covers the rules for a conversation's board.
- [Resources](./resources.md) covers the scopes a stored list uses.

---
title: Task collections
type: reference
description: "The task record, the six statuses, the collection's methods, the claim and lease rules, what a write reports, and what a newly started task is handed."
---

# Task collections

Work with more than one step needs somewhere to keep its state: which items exist, which wait on which, who holds one at this moment, how often it has been tried. A task collection is that store. It holds one record per task, and every write to an existing task answers with a value saying whether it landed, so two workers reaching for one task get one winner and one refusal instead of a corrupted record.

`getOrCreateTaskCollection` returns the handle, a `TaskCollectionRef`, and this page lists what it holds and does. A task board builds one for you. Build one yourself to file tasks before the board runs or to read results after. For how a board uses the list, read [Tasks and boards](../concepts/tasks-and-boards.md). The loop that works through it, and the board's options, are on [Task board](./task-board.md).

Names on this page come from `@flow-state-dev/orchestration/tasks`, except these, which come from `@flow-state-dev/orchestration/task-board`: `taskBoard`, `taskWorkerInputSchema`, `taskLedgers`, `taskToolActions`, `askMidway`, `UnknownTaskLedgerError`, `TaskBoardRecorderFailureError`, `TaskBoardReportFailureError` and the `RecorderFailureReport` type. The package root exports none of them. `readEveryCollectionPage` comes from `@flow-state-dev/client`, `defineSessionBoard` from `@flow-state-dev/workforce`, `sessionIdOfFiling` from `@flow-state-dev/workforce/browser`, and `useView` from `@flow-state-dev/react`.

The examples belong to one app. Its `research` flow has a board named `research` that works one task per competitor (`acme`, `globex`, `initech`), then a `compare` task that waits on all three. A handler files the four tasks in one batch.

```ts title="src/flows/research/blocks/file-competitors.ts"
import { handler } from "@flow-state-dev/core";
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";

export const fileCompetitors = handler({
  name: "file-competitors",
  inputSchema: z.object({ competitors: z.array(z.string()) }),
  outputSchema: z.object({ filed: z.number() }),
  execute: async (input, ctx) => {
    const tasks = await getOrCreateTaskCollection({
      ctx,
      backing: "state",
      collectionId: "research",
    });
    await tasks.createTasks([
      ...input.competitors.map((name) => ({
        id: name,
        goal: `Research ${name}`,
        assignee: "analyst",
      })),
      {
        id: "compare",
        goal: "Write the comparison",
        assignee: "writer",
        deps: input.competitors,
      },
    ]);
    return { filed: input.competitors.length + 1 };
  },
});
```

The block that does `compare` receives the three finished outputs, keyed by task id.

```ts title="src/flows/research/blocks/writer.ts"
import { handler } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

export const writer = handler({
  name: "writer",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ report: z.string() }),
  execute: (task) => ({
    report: Object.entries(task.deps ?? {})
      .map(([id, output]) => `${id}: ${JSON.stringify(output)}`)
      .join("\n"),
  }),
});
```

## The task record

`taskSchema` is a Zod object, so a row validates at runtime. `Task<TInput, TOutput>` narrows `input` and `output` at the call site; the schema types both `unknown`.

`get` and `list` return a `TaskHandle`: the `Task` plus `items()`, the worker's stream items from the first claim to the task's terminal event. The data fields are a snapshot, `items()` is live, and a retry does not reset its window. `task-change`, `task-board-meta` and `task-board-recorder-failure` items are left out of it. `createTask`, `createTasks` and `claim` return the raw `Task`; the other writes return what [What a write reports](#what-a-write-reports) lists.

### What you set when you file a task

`createTask(init)` and `createTasks(inits)` take a `TaskInit`.

| Field | Type | Meaning |
|---|---|---|
| `goal` | `string` | Required. |
| `id` | `string?` | Generated when omitted. On a partitioned ledger it must be one path segment. |
| `title`, `context` | `string?` | A label; prose the worker reads. |
| `attachments` | `FileContent[]?` | Set from the turn's files when a board files the task, never from model input. |
| `status` | `TaskStatus?` | Default `"pending"`. `held: true` wins over it. A task filed `cancelled` keeps its `error` and `causedBy`. |
| `held` | `boolean?` | File the task `held`. |
| `assignee`, `deps`, `priority`, `maxAttempts`, `input`, `labels`, `metadata` | optional | As given. |
| `questions` | `QuestionInit[]?` | Holds the task is filed on, see [Holds](#holds). At most 20, each prompt 1 to 1,000 characters, `onNo` only on a confirm; otherwise the filing is refused `questions_not_kept`. |
| `session` | `"new" \| "ongoing"?` | Default `"new"`. A board refuses a value it does not list (`setting_not_supported`); a plain board lists only `"new"`. |
| `resultTo` | `"filer" \| "conversation"?` | Default `"filer"`. `"conversation"` means one attempt: `maxAttempts` unset reads as 1, any other value is refused (`conversation_result_one_attempt`). |
| `target`, `targetSessionId` | `string?` | `target` names the workstream record the task goes to, for an assignee that leads a workstream; a board whose filer has no such record refuses it. The board sets `targetSessionId`; do not set it. |
| `followUpOf` | `string?` | The finished task this follows up, resolved to its root. A follow-up takes no `session`, `target` or `resultTo` (`follow_up_takes_no_session`, `follow_up_takes_no_target`, `follow_up_takes_no_result_to`); the root's are copied on. |
| `filedByTask` | `string?` | The task whose request filed this one. |
| `sealed` | `Record<string, unknown>?` | A payload the filing code writes for whatever runs the row. No tool reaches it. |
| `error`, `causedBy` | `string?` | For a task filed already cancelled. |

A filed task gets `status: "pending"` (`"held"` or `"cancelled"` when filed that way), `attempts: 0`, `createdAt` and `updatedAt` set to the filing time, and a fresh `incarnationId`. `createdBy` is the running session's user, and `filedUnder` is the request's tenant and org when it has one.

### What is stored

"Written by" says who sets the field: the filer, the collection (inside a write), a worker's run (a write that presents its claim ticket, see [Claim rules](#claim-rules)), or the caller through a patch method. A client reading the `task-change` item sees every field except the four marked server-only.

| Field | Written by | Meaning |
|---|---|---|
| `id`, `goal`, `title`, `context`, `input` | filer | As filed. |
| `attachments` | filer | The brief's files, in the order attached. Fixed once the task starts. |
| `status` | collection | One of six, see [Statuses](#statuses). |
| `attempts` | collection | Advanced by every claim except one that takes a turn on the same attempt. |
| `maxAttempts` | filer, caller until start | The retry budget. Unset: a failure is terminal. |
| `abandonments` | collection | Times the lease lapsed and a claim took the task back. Absent reads as 0. |
| `retryLedger` | collection | `{ granted, deniedByBudget }`: this task's record against the ledger's `maxTotalRetries`. Absent reads as zero granted. |
| `assignee` | filer, caller | The worker-registry routing key. `claim`'s `workerId` argument is not stored. |
| `deps` | filer, caller until start | Ids that must be `completed` before a claim. |
| `priority` | filer, caller | Higher wins under the priority claim order. Unset reads 0. |
| `labels`, `metadata` | filer, caller | `addLabel` and `removeLabel` edit labels; `patchMetadata` merges. |
| `leaseUntil`, `leaseDurationMs` | collection | When the current claim expires, and how long it was granted. Read the span with `committedLeaseSpan(task)`. |
| `claimedBy` | collection | Where the current attempt was claimed. Server-only. |
| `run` | run | `{ sessionId, requestId, attempt, startedAt? }`: the run working the task, or the last one that did. A claim that starts a new attempt clears it; settling does not. |
| `spend` | run | What the task's runs spent. Read it folded, through `taskSpendView`. |
| `output` | `complete` or a checkpoint | `complete` writes it unless the worker already checkpointed. |
| `checkpointed`, `statusNote` | run | `output` came from `reportProgress` and `complete` keeps it; the worker's last one-line note. A note is never the status. |
| `error`, `feedback` | collection | `error`: a hard fail's message, a cancel's reason, or a cascade's `dep <id> failed`. `feedback`: a soft fail's message, handed to the next attempt. |
| `cancelledVia`, `causedBy` | collection | `"tool"` or `"action"`; the task whose ending cancelled this one. |
| `steers`, `holds` | collection | Messages sent into the task, and what holds it for a user or an outside event. See [Steers](#steers) and [Holds](#holds). |
| `session`, `resultTo`, `target`, `targetSessionId`, `followUpOf`, `filedByTask` | filer | Never changed. `session` and `resultTo` absent read `"new"` and `"filer"`. |
| `sealed` | filer | See [What you set](#what-you-set-when-you-file-a-task). |
| `createdBy`, `filer`, `filedUnder` | collection | The user whose request filed the task; the session it was filed from (where its ending is delivered); that request's tenant and org. Server-only. |
| `createdAt`, `updatedAt`, `startedAt`, `completedAt` | collection | Epoch ms. `startedAt` is set on the first claim and kept. `completedAt` is set when the task completes, errors or is cancelled. |
| `revision`, `writeLog`, `writeLogTruncated`, `incarnationId`, `wait`, `resumeOwed`, `cancelOwed`, `cascadeOwed`, `turn`, `turnOwed`, `askedInTurn`, `retryPending`, `keptOpenBy` | collection | Bookkeeping the collection maintains. Do not write them. |

`keptOpenBy` is `"suspended"`, `"filed"`, `"steer"` or `null`, and is only set on an `in_progress` task: what keeps a running task open with no lease (its request is suspended, work it filed is open, or a steer no request has taken).

### Filtering

`list(filter)` and `count(filter)` take a `TaskFilter`. Fields combine with AND: `status` (one value or an array), `assignee`, `hasLabel`, `hasAllLabels`, `filedByTask`, `resumeOwed: true`, `cancelOwed: true`, `cascadeOwed: true`, and `sealed` (each key compared with `===` against plain values).

### Which fields can be changed

| Field | Can change |
|---|---|
| `goal`, `title`, `context`, `attachments`, `input`, `deps`, `priority`, `labels`, `metadata`, `assignee`, `maxAttempts`, `held` | Until the task first starts. A task has started once it has been claimed; a retry's return to `pending` does not reopen them. |
| A cancel, a `message` | Until the task finishes. |
| `followUpOf`, `session`, `resultTo`, the attempts used | Never. |
| Any field of a finished task | Never. |

`setPriority`, `addLabel`, `removeLabel` and `patchMetadata` are collection methods outside this table. They write to a finished task too.

## Statuses

Six: `pending`, `in_progress`, `held`, `completed`, `errored`, `cancelled`. The last three are terminal.

| From | To | What moves it |
|---|---|---|
| `pending` | `in_progress` | A claim of a claimable task. |
| `pending` | `held` | `hold(id)`, `patchSettings({ held: true })`, or filing with `held: true`. Declined `started` once the task has ever started. |
| `held` | `pending` | `release(id)` or `patchSettings({ held: false })`. `unchanged` when the task is not held. |
| `pending`, `held`, `in_progress` | `cancelled` | `cancel`, or a cascade. |
| `in_progress` | `completed` | `complete(id, output)`. |
| `in_progress` | `errored` | `fail` with no retry left, with `noRetry`, or when the ledger's `maxTotalRetries` is spent. Also a claim that finds a lapsed task already abandoned three times. |
| `in_progress` | `pending` | `fail` while `attempts - abandonments < maxAttempts` (a retry), or the manual `reclaim()`. |
| `errored`, `cancelled` | `pending` | `retry(id)`, which is outside the table. |

A move to the status a task already holds is allowed. Any other move off the table throws `IllegalTaskTransitionError` with `taskId`, `from` and `to`, and writes nothing. `isTransitionAllowed(from, to)` tests a move; `allowedTransitionsFrom(status)` lists the legal ones (`["completed", "errored", "pending", "cancelled"]` from `in_progress`, `[]` from a terminal status or one the table does not know). A stored status the board does not know is declined `unknown-status` and the row is left as stored.

A task waiting on a user keeps its status and gains a hold: `pending` before it starts, `in_progress` with no lease midway. `held` is a status the filer sets before the task starts. A hold is what the task waits on.

`retry(id)` keeps the task's id, steers, output so far, items window and spend. A failure's `error` becomes the next attempt's `feedback` (a cancel's reason does not). The retry is counted in `retryLedger`, undoes a cascade's `skipped` label and `causedBy`, and closes the ended attempt's unanswered holds. It runs no cascade and sends no notice. It declines `disallowed` (the task has not ended, or completed), `settling` (its last ending is owed and unpaid), `dependency-ended` (a dependency failed or was cancelled) and `retry-budget` (`maxTotalRetries` is enforced and spent).

## Collection methods

Reads (`get`, `list`, `count`) are synchronous and read the latest committed view the ref holds. Most methods that write resolve to a [`TaskWriteOutcome`](#what-a-write-reports). The table gives each method's result.

| Method | Resolves to | What it does |
|---|---|---|
| `createTask(init)` | `Task` | Files one task. |
| `createTasks(inits)` | `Task[]` | Files a batch, see [Filing a batch](#filing-a-batch). |
| `claim(workerId, options?)` | `Task \| null` | Claims the next claimable task, see [Claim rules](#claim-rules). `workerId` is trace attribution only. |
| `complete(id, output, options?)` | outcome | `in_progress` to `completed`. Keeps a checkpoint as the output. |
| `fail(id, error, options?)` | outcome | A retry or a terminal failure, see [Retry budgets](#retry-budgets). `FailOptions.noRetry` makes it terminal whatever budget is left. |
| `cancel(id, reason?, options?)` | outcome | Advisory: a task already terminal declines `terminal` rather than throwing. `reason` is stored as `error`; `CancelOptions.via` sets `cancelledVia`. |
| `hold(id)`, `release(id)` | outcome | `pending` to `held` and back. No options. |
| `patchSettings(id, patch)` | outcome | Until the task first starts, changes `held`, `deps` (replaced whole), `maxAttempts`, `goal`, `title`, `context`, `input`, `priority`, `labels` (replaced whole), `metadata` (merged) or `assignee`. Declines `started` or `terminal`; `unchanged` when nothing changes. New `deps` are checked like a filing's and cancel the task if a dependency ended meanwhile. |
| `retry(id)` | outcome | Optional. See [Statuses](#statuses). |
| `renewLease(id, leaseUntil, { claim })` | outcome | Pushes the lease out. Needs the claim's ticket and a finite deadline, else it throws. Writes one field and emits no `task-change`. |
| `reclaim(now?)` | `number` | Resets every `in_progress` task whose lease has passed to `pending` and returns the count, with one `task-change` of kind `resumed` each. Does not spend the abandonment allowance. Leaves a task with an open hold alone. |
| `linkRun(id, run, { claim })` | outcome | Records which run is working the task. Writes `run` only. |
| `reportProgress?(id, { statusNote?, output? }, { claim })` | outcome | Optional. A checkpoint becomes the output from then on. |
| `recordSpend?(id, write, { claim })` | outcome | Optional. A terminal task and a lapsed claim take it as well. Emits no `task-change`. |
| `setKeptOpenBy?(id, value, options)` | outcome | Optional. Records what a running task waits on, or that it waits on nothing. Emits no `task-change`. |
| `steer`, `answer` | outcome | Optional. See [Steers](#steers) and [Holds](#holds). |
| `takeSteers`, `ask`, `awaitExternal` | outcome, plus `taken` or `questions` | Optional. The outcome with the ids of the steers taken, or of the holds opened. See [Steers](#steers) and [Holds](#holds). |
| `payHoldDeadlines?()` | `string[]` | Closes every question past its deadline and returns the ids of the tasks it closed one on. See [Holds](#holds). |
| `setAssignee(id, assignee)` | outcome | The one field setter that refuses: `terminal`, `follow-up`, and `immutable-assignee` on an `in_progress` task of a dispatching board. `unchanged` when equal. |
| `setPriority`, `addLabel`, `removeLabel`, `patchMetadata` | outcome | Write to a terminal task too. Answer `recorded` or `unchanged`; `patchMetadata` answers `recorded` even when nothing changes. |
| `payOwedCascades?()` | `number` | Pays every cascade owed past its due time and returns how many. |
| `get(id)`, `list(filter?)`, `count(filter?)` | `TaskHandle`, `TaskHandle[]`, `number` | Reads. |
| `getCommitted?(id)` | `Promise<TaskHandle \| undefined>` | Optional. The task as stored at the time of the call, where `get` reads it as this request first did. |
| `refresh?(id)` | `Promise<void>` | Optional, on the resource backing. Brings one task to its committed state. |
| `collectionId`, `partition`, `now`, `maxTotalRetries` | properties | The id that matches `data.collectionId` on emitted items; the partition this ref reads and writes; the clock that stamps and judges leases (compare leases against it, not `Date.now()`); the retry budget this ref enforces, `null` when none is in force. |

The ref also carries optional wait and notice methods that a board uses for `getTask`'s `wait` and a filer's ending notice. Both built-in backings have them. A hand-written ref without them cannot host a wait.

### Filing a batch

`createTasks` checks every row before writing any: the filing settings, then the dependencies (an id on neither the board nor the batch, a dependency already failed or cancelled, a loop), then that the filing task is not cancelled. A refusal throws `TaskFilingRefusedError { rule, taskId }`, its message starts with the rule code, and none of the batch is filed. Ids in the batch count as on the board, so one batch can file a whole chain.

The rule codes a collection raises are `questions_not_kept`, `dependency_not_on_board`, `dependency_ended`, `dependency_loop`, `setting_not_supported`, `follow_up_takes_no_session`, `follow_up_takes_no_target`, `follow_up_takes_no_result_to`, `conversation_result_one_attempt` and `parent_cancelled`. `dependency_not_on_board` also covers another board's id. Workforce's conversation board adds `setting_not_from_task_session`, `duplicate_task_id` and `follow_up_of_unrun`. To wait on other work, file the task `held` and release it later.

A collection does not check a batch for a repeated id. On the state backing a repeat throws a plain `Error` (`[tasks] task with id "x" already exists`) and nothing is filed. On the resource backing it throws at the second row, and the rows before it stay filed.

On the state backing a store failure leaves nothing filed. On the resource backing the rows are created one at a time after the check, so a failure part-way leaves the earlier rows in place. After the rows commit, a dependency that ended while they were written cancels its dependents.

A replan's batch (from `planAndExecute` or `supervisor`) differs: a task whose dependency already ended is filed `cancelled` with the label `skipped`, along with the batch tasks that depend on it. Every other refusal, a dependency on no task or a loop, fails the run.

Exceeding a creation cap throws `TaskCapExceededError { cap: "total" | "enqueued", limit, attempted }` and inserts nothing.

### Dependencies

A claim waits until every id in `deps` is `completed`. A dependency naming a missing task counts as unmet. A task that fails for good or is cancelled cancels every open task that depends on it, then their dependents, to the end of the chain. Each is `cancelled`, labelled `skipped`, with `error` set to `dep <id> failed` or `dep <id> was cancelled` and `causedBy` set to the task that ended. A retried or completed task cancels nothing.

The ending's write records that the cascade is owed, and the same call pays it straight after. If a crash comes between them, the next drain or `payOwedCascades()` call pays it. The same call also cancels any unstarted task whose dependency has failed or been cancelled, which catches a dependent another process filed.

A lapsed lease's recovery writes no ending and cascades nothing. `retry` cancels no dependents: one the failure cancelled stays cancelled until it is retried too.

On a ledger that declares `cascadeFiled` (Workforce's conversation ledger does, a plain board does not), a task that fails, retries or is cancelled also cancels the open tasks it filed.

A `planAndExecute` plan reports `errored` as `failed`, `cancelled` as `skipped` and `in_progress` as `in-progress`. `pending` and `completed` keep their names.

### Reads

On the resource backing the view is loaded when the ref is built. Two refs resolved in one request over one collection see each other's adds at once. A write another request makes is visible to a later request, not to one already running.

## Where the list is stored

`getOrCreateTaskCollection(options)` is async on either backing, so always `await` it. It throws before touching storage when `backing` is neither `"state"` nor `"resource"` (the board's `"request"` and `"sequencer"` names belong to the board), or when `state` is present but `null` or `undefined`. A ref built without the creation caps enforces none.

| Option | Backing | Meaning |
|---|---|---|
| `ctx` | both | The block context. |
| `backing` | both | `"state"` or `"resource"`. |
| `collectionId` | both | Names the collection. It matches `data.collectionId` on items. |
| `now` | both | The clock. Default `Date.now`. |
| `changeVisibility` | both | Visibility stamped on the `task-change` items. Default `{ client: true, history: false }`. `taskBoard` has no such option. |
| `state` | state | A state ref such as `ctx.sequencer`. Omit it to keep the tasks on the request. |
| `stateKey` | state | The field holding the `Record<id, Task>`. Default `"tasks"` on a passed `state`, the `collectionId` on the request. A passed ref's schema must hold a record at that key. |
| `maxTotalTasks`, `maxEnqueuedTasks`, `maxTotalRetries` | state | The caps, below. Asking for one on the resource arm is a type error. |
| `collection` | resource | The resource collection ref, such as `ctx.resources.orgTasks`. |
| `immutableAssignee` | resource | Refuse `setAssignee` on an `in_progress` task. Set for a board with dispatching assignees. |
| `partition` | resource | A non-empty string. Required when the collection was declared with `partitionBy`, refused otherwise. |
| `readFor` | resource | The conversation a user view reads for, in place of the running session. |

| Backing | The tasks live | They last |
|---|---|---|
| `"state"`, no `state` | On the request, at the `collectionId`. A task added before `board.drain` runs is seen by the drain when both name the same `collectionId`. | The request. Two boards in one request each get their own slot. |
| `"state"`, `state: ctx.sequencer` | On that state, at `tasks`. | One sequencer invocation. A sequencer's state is checkpointed and restored on resume; a generator's own state is not. |
| `"resource"` | A resource collection declared with `defineTaskCollection`. | As long as the resource at its scope. |

A board's `collection` setting maps onto these: `request` (the default, `collectionId` defaults to the board's `name`) is `backing: "state"` with no `state`; `sequencer` is `backing: "state"` with the board sequencer's own state; a `defineTaskCollection` value is the resource backing; `factory` is your own `(ctx) => TaskCollectionRef`, passed through unchanged with `collectionId` reading `"factory-supplied"`.

### `defineTaskCollection`

Declares a resource collection `<id>/**` at `session`, `user` or `org` scope, validated against the `Task` envelope. Pass the result to `taskBoard({ collection })`; the board registers and resolves it.

| Option | Meaning |
|---|---|
| `id` | The collection id: the resource pattern, the `ctx.resources` key and the board's `collectionId`. One plain segment, with no `*`, `[param]` or `/`. |
| `scope` | `"session"`, `"user"` or `"org"`. |
| `sharedToLineage` | One ledger across the session lineage, so a dispatched child session settles against the same rows. Session scope only. |
| `partitionBy` | `(ctx) => string \| Promise<string>`. One set of rows per partition, at the owner's user scope. User scope only; not with `maxInstances`. Sees only server-set identity (`sessionId`, `lineageId?`, `userId`, `orgId?`, `tenantId?`). Task ids must be one path segment. Rows load a partition at a time, and the collection keeps a `byTaskId` index so a bare task id can be found. |
| `recordEnding` | `(row, ending) => row`. Runs inside every ending write and only the returned `metadata` is kept, so it must be pure (it may run twice). `ending` is `completed`, `errored`, `retried` or `cancelled`. |
| `settings` | `{ session?: ["new" \| "ongoing"], resultTo?: ["filer" \| "conversation"] }`. The filing settings the ledger honours beyond the defaults (`["new"]`, `["filer"]`). |
| `cascadeFiled` | `{ owes(row, ending), pay(ctx, row) }`. Cancels the open tasks a failed, retried or cancelled task filed elsewhere. |
| `delivery` | How endings reach the sessions that filed them. |
| `stateSchema` | Zod schema for each task's `input`. Default `z.unknown()`. |
| `maxInstances` | A cap on rows retained. A capacity limit, not a lifetime ceiling: `delete` frees a slot. |

A `defineTaskCollection` value sets no `client` config, so a browser reads none of its rows until the declaring layer adds one (`client: { state: { read: true }, expose: [...] }`). While an attempt holds a task on a dispatching board, `setAssignee` declines `immutable-assignee` from every ref to that ledger. The rule belongs to the declaration, so a second flow that uses the same `defineTaskCollection` value gets it too, even when its board does not dispatch.

### Retry budgets

`maxAttempts` (per task) and `maxTotalRetries` (per ledger) are described on [Task board](./task-board.md#retries). A ref reports the budget it enforces as `maxTotalRetries`, and `null` on the resource backing, which counts retries and never enforces the bound.

### Creation caps

| Cap | Meaning | Default on `taskBoard` and the patterns |
|---|---|---|
| `maxTotalTasks` | Lifetime count of all tasks, terminal included. Never refunded. | 500 |
| `maxEnqueuedTasks` | `pending` count at creation. Refreshes as tasks leave `pending`. | 100, lowered to `maxTotalTasks` when that is smaller |
| `maxTotalRetries` | See [Retry budgets](#retry-budgets). | 50 |

Values are positive integers, or `null` for unbounded (`maxTotalRetries` may be `0`). An explicit `maxEnqueuedTasks` above the resolved `maxTotalTasks` throws. The defaults apply on `taskBoard`, the board capability and `eventActors`. A direct `getOrCreateTaskCollection({ backing: "state" })` applies none, so an omitted cap is unbounded. `eventActors` opts its retry budget out with `null`.

Each cap counts the ledger's rows when checked, so it lasts as long as the ledger. Every writer for a bounded board must resolve through the board's own factory or capability, or be handed `board.caps`; a ref built without them can insert past the bounds.

## Claim rules

A task is claimable when it has no open hold, every id in `deps` names a `completed` task, and it is either `pending`, `in_progress` with a lapsed lease, or `in_progress` and owed a turn on the same attempt. A `held` task is never claimable.

| Rule | Behavior |
|---|---|
| Order | `claim` scans the claimable tasks in order and commits the first one that qualifies when the write is attempted. It claims at most one. The default order is ascending `createdAt`, ties by id. |
| Claim orders | `fifoClaimOrder` is the default. `priorityClaimOrder` sorts by `priority` descending (unset reads 0), then `createdAt`, then id. A board's `claimOrder` is `"fifo"`, `"priority"` or a `ClaimOrder` whose `claim(collection, workerId, ctx)` you write. |
| `eligibility` | `ClaimOptions.eligibility(task, rows)` narrows the claimable set and never widens it. Do not test `status === "pending"` in it: an abandoned task is `in_progress`, so that switches recovery off. |
| What a claim writes | `status: "in_progress"`, `attempts` + 1 (not when it takes a turn on the same attempt), `turn` + 1, `leaseUntil`, `leaseDurationMs`, `claimedBy`, `startedAt` (kept if set). It clears `keptOpenBy`, `retryPending` and `turnOwed`, and clears `run` unless it only takes a turn on the same attempt. It marks every steer taken by the new attempt. Recovering a lapsed task also advances `abandonments`. |
| Nothing to claim | `claim` returns `null` when nothing is claimable and when it lost a race. It can also write: a task whose abandonment allowance is spent is settled `errored` in the claim, and the scan goes on to the work behind it. |
| Ticket | `ticketForClaim(collectionId, claimedTask, partition?)` mints the ticket a fenced write presents. |
| Lease | Every claim carries one. `ClaimOptions.leaseDurationMs` defaults to 120,000 ms (2 minutes). A value below 1,000 ms, above 2,147,483,647 × 3 ms (about 74.5 days) or not finite throws; nothing is rounded into range. |
| Renewal | A task you claim by hand is not renewed: call `renewLease(id, deadline, { claim })`. A worker the board drives is renewed for you. |
| Lost lease | A ticketed write on an `in_progress` task whose lease has lapsed declines `lost-claim`. That includes a renewal committed after the lease it extends and a settlement from a worker that ran past its lease. |
| Adopting a lapsed lease | `renewLease(id, deadline, { claim, adoptLapsedLease: true })`, for a claimant that has not started work, takes the task back on the same attempt if nobody else has (`recorded`), else declines `lost-claim`. Ignored on any other write. |
| No lease | A task kept open (`keptOpenBy`) or waiting on an open hold has no lease and is left alone by `reclaim`. |
| Abandonment | A task whose lease lapses is claimed again as a fresh attempt, up to 3 times. The next claim that finds it lapsed settles it `errored` instead, with `[tasks] task "<id>" was abandoned by its worker 3 times without completing. Not re-dispatched.` That is four runs at most. No option raises the allowance (`DEFAULT_MAX_ABANDONMENTS`). The settlement publishes a `task-change` and pays the task's cascade. |
| Abandonment and `maxAttempts` | Separate. `fail` retries while `attempts - abandonments < maxAttempts`, so two crashes of a `maxAttempts: 3` task leave all three tries. A task with no `maxAttempts` gets the 3 recoveries too. |
| Recovery time | About one lease plus one idle-wake period. An idle board worker wakes on a `task-change` for its collection or on its own timeout of `max(idlePollMs × 100, 50)` ms, 5,000 ms at the default `idlePollMs` of 50. An expiring lease writes nothing, so nothing wakes a sleeper on it. |

### Renewing a lease

`withLeaseRenewal({ collection, ticket, claimedTask, signal, run })` wraps single-call work and hands `run` a signal that aborts on request cancel or lease loss. `startLeaseRenewal(...)` returns `{ signal, stop }` for multi-step work, and `stop()` must be called on every path out. A renewal goes out every third of the lease: every 40 seconds on the default. Settle the task inside `run`, because the settling write is refused once the lease has lapsed.

### Settling

`complete` and `fail` called with no options throw `IllegalTaskTransitionError` on an illegal transition. With `ifAllowed: true`, a refused write becomes a `declined` outcome. `cancel` never throws on one: a terminal task declines `terminal`. With `claim`, the ownership check runs too. Without options a legal transition goes through even when another attempt already recorded a result: `completed` to `completed` is legal, so a second unguarded `complete` overwrites the first output.

`refuseUntakenSteers: true` on a `complete` declines `untaken-steers` while the task holds a message its attempt has not taken. A task with an open hold settles only by a cancel: `complete`, `fail` and lease renewal decline `open-question`.

### Writing your own `TaskCollectionRef`

A hand-written ref must:

- implement `renewLease` fenced by the claim ticket;
- make its own `claim()` consider lapsed rows, take them over as a new attempt and settle one whose abandonment allowance is spent;
- refuse any ticketed write once the lease has run out, except a renewal passing `adoptLapsedLease`;
- take the trailing options argument on every write and check the guards in the same atomic write that changes the row.

`isClaimable(task, lookup, now)` and `committedLeaseSpan(task)` do the claimable and lease-span tests. On a ref that ignores the options, a result that arrives after its lease is dropped and the drain goes on, but its writes are not guarded. A hand-written ref keeps no write receipts, so [`didWriteLand`](#telling-whether-a-write-landed) reads `undefined` on it.

### Can two drains run one task?

Not at the same time. Two claims racing for one task give it to one and return `null` to the other, which is not an error. Two concurrent claims over two tasks return different tasks.

That is a bound on concurrent holders, not exactly-once dispatch. A lease that runs out sends the task back, so after a crash or a stall the work can run twice. Only one attempt can record a result: a ticketed write from a worker that does not hold the task is refused. Side effects the losing worker already caused are not undone.

A write with no ticket is not checked for ownership. A coordinator settling or cancelling on its own board presents none.

The guarantee covers concurrent executions inside one process. Two OS processes over a filesystem-backed store each compare against their own view, so use SQLite or Postgres for a board two processes share. Concurrent drains of one board in one process each keep their own [observation ledger](#what-flow-policy-selects).

## What a write reports

Every write to an existing task resolves to a `TaskWriteOutcome`, except these. `createTask` resolves to a `Task` and `createTasks` to a `Task[]`; a refused filing throws (`TaskFilingRefusedError`, `TaskCapExceededError` or a plain `Error`) and returns no outcome. `claim` resolves to a `Task` or `null`, `reclaim` and `payOwedCascades` to a `number`, and `payHoldDeadlines` to a `string[]`. `takeSteers`, `ask` and `awaitExternal` resolve to an outcome with `taken` or `questions` added.

| Outcome | Meaning |
|---|---|
| `{ outcome: "recorded" }` | A field changed and a `task-change` went out. A lease renewal changes `leaseUntil` and emits none. |
| `{ outcome: "unchanged" }` | The task already held that state. Nothing was written. On the resource backing the write runs anyway, so a `resource_change` can fire. |
| `{ outcome: "declined", reason, status }` | Refused. `status` is what the write observed. |

A decline is a value, not an error. A missing task, a store failure, or a write that keeps conflicting with other writers until it gives up, throws. When several reasons hold, the answer follows this precedence: `immutable-assignee`, `terminal`, `not-my-task`, `disallowed`, `lost-claim`. The rest belong to their own methods.

| Decline reason | Meaning |
|---|---|
| `immutable-assignee` | A dispatching board, and an attempt holds the task (`in_progress`, one waiting on a user included). A `pending` or `held` task can be reassigned. |
| `terminal` | The task already reached `completed`, `errored` or `cancelled`. |
| `not-my-task` | The ticket names a different board, a different task, or an id since reused for a new task. |
| `disallowed` | The state machine rejects the move from a non-terminal status, such as `pending` to `errored`. |
| `lost-claim` | The ticket names this task but does not own it: it was reclaimed or re-queued, or its lease ran out. |
| `follow-up` | An assignee change on a follow-up, which keeps its root's worker. |
| `started` | `hold` or `patchSettings` on a task that has ever started. |
| `unknown-status` | The stored status is not one the board knows. |
| `untaken-steers` | A `complete` with `refuseUntakenSteers` while a steer is untaken. |
| `steer-limit` | A steer past 20. An open question reserves one place for its answer. |
| `open-question` | The task has an open hold: a settlement, a lease renewal or a second wait is refused. |
| `answered` | An answer with other words or from another sender to a question already answered. |
| `no-such-question` | An answer naming no question or confirm on the task. |
| `settling` | A retry of a task whose last ending is owed and unpaid (a cascade, a resume or a cancel). |
| `dependency-ended` | A retry of a task one of whose dependencies failed or was cancelled. |
| `retry-budget` | A retry where `maxTotalRetries` is enforced and spent. |

### Options on a write

| Option | On | Meaning |
|---|---|---|
| `ifAllowed` | `complete`, `fail`, `cancel` | Decline a terminal task or a refused move instead of throwing. |
| `claim` | `complete`, `fail`, `cancel`, `renewLease`, `linkRun` | The claim ticket. Declines `not-my-task` or `lost-claim`. Required by `renewLease` and `linkRun`. |
| `refuseUntakenSteers` | `complete` | See [Settling](#settling). |
| `adoptLapsedLease` | `renewLease` | See [Claim rules](#claim-rules). |
| `write` | the five above | A token from `beginTaskWrite`, see below. |
| `viaTool` | | Set by the task tools only. |
| `noRetry` | `fail` (`FailOptions`) | Terminal whatever budget is left. |
| `via`, `whileHoldOpen` | `cancel` (`CancelOptions`) | `"tool"` or `"action"`; and a hold id. |

`hold`, `release` and `patchSettings` take no options.

### Telling whether a write landed

A write can commit and the call can throw anyway. Call `beginTaskWrite(tasks.get(id))` before the write, pass the token as `options.write`, and after a throw call `didWriteLand(tasks.get(id), token)`. It returns `true` (committed; the receipt is on the task), `false` (nothing changed: the write never landed, or the task already held that state) or `undefined` (cannot tell: no write receipts, the receipt aged out, or a different incarnation).

A task keeps its 4 newest receipts. Only `complete`, `fail`, `cancel`, `renewLease` and `linkRun` take a token. `createTask`, `createTasks`, `claim`, `reclaim`, `hold`, `release`, `patchSettings`, `setAssignee`, `setPriority`, `addLabel`, `removeLabel` and `patchMetadata` advance `revision` and take none.

### When the board cannot write a result down

When a board's own result write committed but could not be announced, or the board cannot tell, it emits a persisted `task-board-recorder-failure` item with visibility `{ client: false, history: false }`. The payload is a `RecorderFailureReport`: `collectionId`, `taskId`, `recorder` (`"complete"` or `"fail"`), `verdict`, `error` (the announcement's failure message) and `runId?`.

`verdict` is `"committed"` (the write landed and only the announcement failed) or `"undetermined"` (the board cannot tell whether it landed, which is always the case on a custom store or a ref without write receipts). A write that demonstrably committed nothing produces no report.

The failure waits for the drain's sibling tasks to finish, then the run fails with `TaskBoardRecorderFailureError` (`code: "task-board-recorder-failure"`, `reports`). A report that cannot be delivered fails the run at once with `TaskBoardReportFailureError` (`code: "task-board-report-failure"`), whatever `onError` says. A store that is unreachable, or commits and then fails on the way out, throws and can fail the drain.

## Holds

A task waiting on a user or an outside event keeps its status and gains an entry in `Task.holds`. A hold is either the task's own (a question, a confirm or an external wait it asked for) or a suspension hold, which appears while the task's run is suspended waiting on a user. A claim never takes a task with an open hold, at filing or midway. A task with an open hold settles only by a cancel.

| Field | Meaning |
|---|---|
| `id` | Unique on its task. A suspension hold takes its suspension id; an own hold's id is minted when it opens. |
| `actor` | `"user"` (the Inbox lists these) or `"system"` (an external wait). |
| `openedAt` | Epoch ms. |
| `due` | When it ends unanswered. Absent: it waits until answered or cancelled. |
| `ask` | `{ kind, prompt, title? }`. An own hold's `kind` is `question`, `confirm` or `external`, and a confirm also carries `onNo?: "cancel" \| "continue"`, `"cancel"` unless filed otherwise. A suspension hold's `kind` is `approval`, `review` or `input`. |
| `source` | `{ kind: "task", closedBy }` for an own hold, `closedBy` a list of `{ by: "answer" }` or `{ by: "event", event, key }`. `{ kind: "suspension", requestId, suspensionId }` for a suspension hold. |
| `midway` | Own holds only. `true` when asked midway by the turn holding the claim, not at filing. |

A prompt is at most 1,000 characters and a task takes at most 20 questions. `openHolds(row)` lists the open ones: an own hold is open until a steer carries its id, a suspension hold while it is on the row, and none on an ended row. `holdActorOf(row)` returns `"user"` while any open hold is a user's, else `"system"` while an external wait is open, else `undefined`.

- A task filed with `questions` stays `pending` and starts no attempt until each is answered. Each answer joins the first attempt's brief.
- A worker asks midway with `ask(id, asks, { claim })` from the turn holding the claim. The write drops the lease and ends the turn unsettled, and the task stays `in_progress`. The last answer owes one more turn on the same attempt, which does not count against `maxAttempts`.
- `awaitExternal(id, wait, { claim })` opens one external wait (`actor: "system"`, kind `external`, never midway, no deadline), released by any steer that answers it. `wait` is `{ prompt, title?, events: { event, key }[] }`, with at least one event and no blank name, key or prompt.
- `answer(id, { questionId, message, from, by?, key? })` is kept as a steer carrying the hold's id. The last open answer lets the work go on in the same write. The same words from the same sender again are `unchanged`, even after the task finished. Other words or sender decline `answered`; a finished task declines `terminal`; an unknown id declines `no-such-question`. Who may answer which hold is the caller's rule.
- A question has no deadline unless the host sets `userDeadlineMs`. Past it, `payHoldDeadlines()` (the board calls it for you) closes the question with "No answer came before this question's deadline. Go on from your brief without it." and the work goes on as if answered. A question with no `due` is never closed that way.
- A turn waits once: it cannot ask while its run waits on a stop, and its run cannot stop for a user while its own questions are open (`open-question`).
- A cancel closes every hold. A cancelled task that was suspended keeps that hold in `holds` until its suspended run is resumed as cancelled.

## Steers

`steer(id, { message, from, by?, key? })` keeps a message on an open task. It changes no status, claim, lease or attempt and records no ending.

- `from` is `"filer"` or `"user"` from a caller. Stored steers can also be `"board"` (closing a question at its deadline) or `"service"` (words from outside the app, sender in `by`).
- A task takes at most 20 (`steer-limit`). A finished task takes none (`terminal`). `key` makes a repeat `unchanged`.
- A steer to a task waiting on work it filed sets `keptOpenBy: "steer"` so a turn can start.
- A claim marks every steer taken by the new attempt, and the worker input carries all of them as `steers`. A request already working the task reads later ones with `takeSteers(id, { claim, takenIn })`. It marks them taken and returns their ids as `taken`. Run again under the same `takenIn`, it takes none and returns none.
- A steer is `taken` for the current attempt when `takenBy === attempts`. `getTask` lists steers oldest first, with `at`, `answers?` and `taken`.

## What a newly started task knows about earlier work

The board packs a `TaskWorkerInput` when it claims a task and hands it to the block that does the work. Declare `taskWorkerInputSchema` as that block's `inputSchema` to receive every field. A schema you declare is a filter: a field it omits reaches no worker. The worker returns its result and the board records it with `complete`.

| Field | Type | Present when |
|---|---|---|
| `taskId`, `goal`, `attempts` | `string`, `string`, `number` | Always. `attempts` is the attempt that is running. |
| `title`, `context`, `input`, `metadata` | optional | The task has one. `context` is prose to render into the prompt, not a directive. |
| `attachments` | `AttachmentReference[]?` | The task was filed with files. |
| `deps` | `Record<depId, output>?` | At least one declared dependency has an `output` that is not `undefined`. Absent, not `{}`, when there is none. |
| `feedback` | `string?` | The last attempt failed with a retry left, or a failed task was retried. |
| `steers` | `{ message, from, question?, by? }[]?` | The task holds any, taken or not. |
| `followUpOf` | `string?` | The task is a follow-up. |
| `sealed` | `Record?` | The task was filed with one. |
| `priorWork` | `TaskPriorWork?` | The board's flow policy selected at least one observation or a narrative. |

An optional field is an absent key, never a key holding `undefined`: a dispatched run's payload must be JSON-safe, and a present `undefined` is rejected by name. A task dispatched into a session of its own gets the same fields in its dispatch payload. A dependency output that is not JSON-safe refuses the dispatch after the claim.

`deps`, `feedback`, `attempts`, `steers` and `priorWork` come from the board, whichever pattern filed the task. What a pattern files:

| Filed by | `TaskInit` fields | Notes |
|---|---|---|
| `planAndExecute`, `supervisor`, `parallelTasks` | The planner's `id` (generated as `step-N` or `task-N` when absent), `title`, `context`, `deps`, `assignee`, `priority`, `input`, `maxAttempts` | `parallelTasks` also sets `input` to the goal. `supervisor` sets `maxAttempts` to 3 when the planner gives none. |
| `eventActors` | `goal` (`<actor> on <type>:<topic>`), `assignee` (the actor name), `input` (the matched entry), `metadata` (`depth`, `type`, `topic`) | Collection id `eventActors:<name>`, on the request. |
| `routedSpecialists` | `goal` (the reasoning, or `iteration N`), `assignee` (the specialist), `metadata` (`iteration`, `reasoning`) | One task per iteration where a specialist was picked; its return value is the `output`. Returned to the caller as `history`. |
| `roundRobin`, `debate` | `goal` (`<agent> (round N)`), `assignee` (the agent), `metadata` (`round`, plus `stance` for `debate`) | One per agent per round; `output` is `{ text }`. Created, claimed and completed in one block. |

`routedSpecialists`, `roundRobin` and `debate` keep their tasks on the sequencer's state, with collection id defaulting to the pattern's `name`. A caller outside the run cannot reach them.

### What flow policy selects

The board keeps an in-memory observation ledger for each drain: every tool call a worker makes, whether or not the tool is `cacheable`, and a cache hit too, marked `cached: true`. An entry is `{ seq, collectionId, taskId?, workerId?, toolName, args, result?, error?, cached, ts }`. The ledger holds at most 10,000 entries, oldest dropped, and is cleared when the drain ends, on completion or error.

Before each dispatch the board calls the configured `TaskFlowPolicy.select({ task, ledger, collection, ctx })` once. A selection with at least one observation, or a non-empty `narrative`, becomes `priorWork`. The board never puts prior work into a prompt: showing it to the model is the worker's call. `TaskPriorWork` is `{ observations: { taskId?, toolName, args, result?, error?, cached, ts }[], narrative?, meta?: { policy, selected, available, tokensApprox? } }`.

The board's default is `flowPolicy.declaredDepsOnly()`. `planAndExecute` pins `recentTrajectory({ n: 8 })` and `supervisor` pins `declaredDepsOnly()`. An unrecognised value falls back to the default.

| Policy | Selects |
|---|---|
| `flowPolicy.none()` | Nothing. |
| `flowPolicy.declaredDepsOnly()` | Observations made by the tasks in the new task's `deps`. Empty when it has none. |
| `flowPolicy.ancestors({ transitive? })` | The same, and with `transitive: true` its dependencies' dependencies too, read from the live collection. |
| `flowPolicy.recentTrajectory({ n, maxTokens? })` | The last `n` observations across all tasks, whatever their dependencies; then the newest that fit `maxTokens`. |
| `flowPolicy.allCompleted({ maxTokens? })` | Every observation from a task that is `completed`. |
| `flowPolicy.compact({ recentN, summarizer? })` | The last `recentN` observations. `summarizer` is accepted and unused. |
| `flowPolicy.custom(select, label?)` | Whatever `select` returns. `label` is stamped on `meta.policy`, default `"custom"`. |

`maxTokens` estimates characters over 4 across `args` plus `result` or `error`, keeps the newest entries that fit and stops at the first that does not. A `maxTokens` of 0 or less selects none. A custom `select` reads the ledger through `all()`, `recent(n)`, `fromTasks(ids)`, `fromAncestors(task, collection, { transitive? })`, `fromCompleted(collection)` and `bounded(observations, maxTokens)`.

`formatPriorWork(priorWork)` renders `Prior work in this run:` and one line per observation, `- [taskId] tool(args) → result: …`, or `→ error: …` when the observation has an error, with `(cached)` appended for a cache hit. Args are cut at 200 characters, a result at 400, an error at 200. It returns an empty string for no observations.

A tool opts into result caching with `cacheable` on its block config, and the cache is separate from the ledger: a tool that is not cacheable lands in it too. `taskBoard({ toolCache })` is `boolean | { enabled?, defaultTtl?, maxEntries?, defaultScope? }`. It is on when any worker tool declares `cacheable`, and `false` always wins. The store is built per drain and lives in memory, with defaults of 5 minutes, 5,000 entries (least recently used first) and scope `"run"`. A cache hit emits a normal `tool_output` item with `cached: true` and `cacheAgeMs`, and a cross-task hit also carries `sourceTask: { collectionId, taskId }`.

### What does a task see of its dependencies?

A prompt gets neither of these on its own.

- **Their outputs.** `deps` maps each dependency's task id to its `output`, for every dependency that has one. Every dependency is `completed` by the time of a claim. The `compare` task above reads `deps.acme`, `deps.globex` and `deps.initech`. A block's return becomes its task's output, unless the worker reported a checkpoint, which `complete` keeps instead.
- **The tool calls they made,** as `priorWork`, under the default policy. With `recentTrajectory`, the last `n` calls of any task instead.

`planAndExecute`'s step executor receives only `{ stepId, goal, context?, dependencyResults? }`, where `stepId` is the task id and `dependencyResults` is the `deps` map. It is not given `priorWork`, and its evaluator and replanner do not read it. The default `declaredDepsOnly` selection is empty for a task with no `deps`.

## Items a collection emits

Every write that changes a task's lifecycle emits a `task-change` data item `{ collectionId, taskId, kind, task, prevStatus? }`, keyed `<collectionId>/<taskId>` so the latest per task replaces the earlier one. Default visibility is `{ client: true, history: false }`. `task` is the row after the write without `claimedBy`, `createdBy`, `filer` and `filedUnder` (`toEmittedTask` does the stripping). `prevStatus` is omitted when the write did not change the status.

`kind` is one of `added`, `claimed`, `completed`, `errored`, `retried`, `retry_requested`, `held`, `released`, `settings_changed`, `resumed`, `cancelled`, `label_changed`, `metadata_changed`, `priority_changed`, `assignee_changed`, `run_linked`, `progress_reported`, `resume_settled`, `steered`, `cancel_owed`, `wait_changed`, `asked` or `answered`. `retried` is a failure with attempts left, an ending. `retry_requested` is a user's or an app's retry, not an ending. `resumed` is `reclaim`. `run_linked` is published on the run's own session.

`renewLease`, `takeSteers`, `recordSpend` and `setKeptOpenBy` emit no `task-change`. Every committed write also publishes a board notice to the session that filed the task, naming the board and task and carrying no rows. A view reads the board again when one arrives.

`onTaskChangeFor(collectionId)` is the wake filter for `.waitForCondition({ wakeOn })`: true only for `task-change` items of that collection.

## Where the data lives

| Stored part | Owner | Who can see it | Where | How many |
|---|---|---|---|---|
| A task on a request-backed board | The running request | The flow's blocks through the ref. A browser sees only the `task-change` items. | `ctx.request`, at the `collectionId`. Ends with the request. | One per task. `taskBoard` defaults: 500 total, 100 enqueued, 50 retries. |
| A task on a sequencer-backed board, and the tasks `routedSpecialists`, `roundRobin` and `debate` keep | The sequencer invocation | As above | The sequencer's state at `tasks` (or `stateKey`), checkpointed with it | One per task. `routedSpecialists`: one per iteration, up to `maxIterations` (default 10). `roundRobin` and `debate`: one per agent per round. |
| A task on a resource-backed ledger | The scope you declare: `session`, `user` or `org` | The flow's blocks. A browser only if the declaring layer sets `client.state.read`, and `expose` or `exclude` limit the fields. | A resource collection at `<id>/<task id>`, or `<id>/<partition segment>/<task id>` on a partitioned ledger (in the user's own cell) | One per task. `maxInstances` is the only cap enforced. |
| `task-change` items | The session that made the change | The client by default; never the model | The response's item stream | One per committed lifecycle change; the latest per task replaces |
| Observation ledger, tool-result cache | The drain | Policies and workers (`priorWork`); not a client | Memory, cleared when the drain ends | Up to 10,000 entries; up to `maxEntries` (default 5,000) |
| `holds`, `steers`, `retryLedger`, `writeLog` | The task | As the task | In the task | 20 questions, 20 steers, 4 receipts |

## Task tools

A model's turn gets `createTask`, `getTask`, `listTasks` and `updateTask`. `reportProgress` is offered only on a worker's turn working a task, and takes no `id`. `retryTask` exists only as an action, a user's or an app's move; a model files a follow-up instead. `taskToolActions(...)` offers `createTask`, `getTask`, `listTasks`, `updateTask` and `retryTask` as flow actions named `<tool>_<suffix>`, the suffix being the collection id with every character outside `[a-zA-Z0-9_-]` turned into `_`. Given a board, it throws unless the board is resource-backed; given a collection id and a resolver of your own, it has no such check.

Refusals are results, not throws, and nothing is written.

| Tool | Result |
|---|---|
| `createTask` | `{ ok: true, taskId, status?: "held" }` or `{ ok: false, error }`. Takes `goal` (required), `title`, `context`, `assignee`, `deps`, `priority`, `input` (a JSON object), `labels`, `metadata`, `followUpOf`, `held`, `questions` (strings, or `{ kind: "question" \| "confirm", prompt, onNo? }`), `session`, `resultTo`, `target`, `maxAttempts`. |
| `getTask({ id })` | `{ ok: true, task, cancelled? }`, the row nested under `task`: `id`, `goal`, `title?`, `status`, `assignee?`, `context?`, `deps?`, `priority?`, `labels?`, `metadata?`, `attempts`, `maxAttempts?`, `session?`, `resultTo?`, `target?`, `input?`, `output?`, `checkpoint?`, `statusNote?`, `error?`, `holds`, `keptOpenBy`, `followUpOf?`, `filedByTask?`, `run?`, `completedAt?`, `steers?`, `current?`. An `input`, `metadata` or `output` over 20,000 characters as JSON comes back cut, flagged `inputCut`, `metadataCut` or `outputCut`. `cancelled` lists the tasks it filed that this ending cancelled. An unknown id: `{ ok: false, error: "task_not_found", taskId }`. |
| `listTasks` | Input `status`, `assignee`, `filedByTask`, all optional, ANDed. Rows carry `id`, `goal`, `title?`, `status`, `assignee?`, `attempts`, `statusNote?`, `filedByTask?`, `run?`, `waitedOn?`, hold fields and `current?` (the id of the latest completed follow-up), never the output. The board's own read, an action or a view, adds `spend`, `updatedAt`, `createdAt`, `startedAt?`, `completedAt?`, `leaseUntil?`, `error?`, `deps?`, `attachments?`. |
| `updateTask` | Flat fields beside `id`. `labels`, `deps` and `input` replace the whole value, `metadata` merges. Each field follows [Which fields can be changed](#which-fields-can-be-changed). |
| `retryTask` | Input `{ id }`. `{ ok: true }` or `{ ok: false, taskId?, error }`. |
| `reportProgress` | Input `{ statusNote?, output? }`. Neither changes the status. |

`getTask({ id, wait: true, deadline? })` is offered only where a board wakes a waiting turn. It waits 5 minutes by default, one wait per step. Its refusals are on [Task board](./task-board.md). A model asks a user a question midway with `holdTaskForUser({ question })`; code uses `askMidway(ctx, tasks, [{ prompt }])`, where `tasks` is the `TaskCollectionRef` of the ledger the request resolves.

`createTask` errors, by what the string starts with:

| `error` | When |
|---|---|
| `no_delegation_board` | The resolver finds no board for this caller. |
| `unknown_assignee` | A roster does not name the assignee. The message lists who is available. |
| `assignee_required` | The roster names several workers, no default worker claims unassigned tasks, and the task is not held. |
| `already_open` | The same goal for the same assignee and target while a task for it is open. |
| `create_task_does_not_wait` | `wait`, `deadline` or `timeoutMs` was passed. |
| `enqueued_task_cap_exceeded`, `total_task_cap_exceeded` | A creation cap. |
| `task_files_not_kept` | The turn's files could not be kept with the task. |
| A `TaskFilingRule` code | The filing breaks a board rule. |

With no assignee named, a model's filing goes unassigned when there is no roster or the board's default worker claims unassigned tasks, goes to the one worker on a roster of one, goes unassigned when held, and is otherwise `assignee_required`. A follow-up with an assignee is refused at input.

`updateTask` errors:

| `error` | When |
|---|---|
| `field_locked_after_start` | A field that changes only until start, on a started task. |
| `task_finished` | Any write to a finished task. |
| `cancel_takes_no_edits` | `status: "cancelled"` sent with another field. |
| `message_takes_no_edits` | `message` sent with a field or status. |
| `nothing_to_update` | No field and no status beside `id`. |
| `filing_setting_fixed` | `session`, `resultTo` or `target` sent. |
| `unknown_assignee` | The roster does not name it. |
| `steer_limit` | A message to a task that already holds 20. |
| `message_not_supported`, `questions_not_supported` | The board keeps no messages, or no questions. |
| `no_such_question` | An `answers` id that is not an open question or confirm. |
| `wait_is_not_a_question` | `answers` names an external wait. |
| `question_answered` | Other words for an answered question. |
| `question_is_the_users` | The filer's tool answering a question the user answers from their Inbox. |
| `question_takes_message` | A question answered without `message`, or with `done`. |
| `confirm_takes_done` | A confirm answered without `done`. |
| `done_without_answers` | `done` without `answers`. |
| `answer_takes_no_edits` | An answer sent with a field or status. |
| `task_not_found` | No such task, or one the caller cannot reach. |

`retryTask` errors: `task_finished` (completed, so file a follow-up), `not_finished`, `dependency_ended`, `settling`, `retry_budget_spent`, `task_not_found` and `retry_not_supported` (the ref has no `retry`). `reportProgress` errors: `progress_takes_a_note_or_output` (neither sent), `not_a_task_turn`, `task_finished`, `progress_not_supported` (the ref has no `reportProgress`) and `progress_declined` (the turn does not hold the task running).

### Reading a user's tasks in a browser

Workforce's conversation board keeps its tasks in a ledger with the id `"tasks"`, so its actions are `createTask_tasks`, `getTask_tasks`, `listTasks_tasks` and `updateTask_tasks`. The task list is also a session view, `listTasks_tasks`, with the same rows, watched with `useView`. It also lists the steps its worker filed for itself when planning is wired.

A browser reads the ledger as the `tasks` collection through any of the user's sessions, covering the tasks of every session the user filed from and never another user's. The session must be on a flow that declares it (the built-in worker flow, the coordinator flow, or one built with `defineSessionBoard`), or the read fails with a 404 `Unknown resource "tasks"`. Each row is stored under a topic `<partition segment>/<task id>`. Pass the first segment, URI-decoded, to `sessionIdOfFiling` from `@flow-state-dev/workforce/browser` to get the session that filed the task.

Sent to the browser, 22 fields: `id`, `title`, `goal`, `context`, `attachments`, `status`, `assignee`, `run`, `priority`, `attempts`, `maxAttempts`, `deps`, `labels`, `error`, `feedback`, `holds`, `steers`, `spend`, `createdAt`, `updatedAt`, `startedAt`, `completedAt`. A task's `input`, `output` and `metadata` are never sent. The read answers in pages, 50 by default and up to 200 with `limit`; `readEveryCollectionPage` follows `nextCursor`.

## `taskLedgers`

`taskLedgers` gives a task entry tasks from ledgers it never built a board for. It returns a `TaskBinding` that you pass as an entry's `from`: `task: { actions: { work: { block, from: taskLedgers({ name, resolve }) } } }`. `defineFlow` runs the same checks on such an entry that a board runs before it starts a task, even though the flow has no board.

| Option | Meaning |
|---|---|
| `name` | Names the assembled blocks and the binding, so a refusal says which entry it came from. The binding's `boardId` is `<name> (by ledger)`. |
| `resolve` | `(ledgerId, ctx, partition, taskId) => Promise<TaskCollectionRef \| undefined>`. `ledgerId` is the id the dispatch carries and is untrusted, so resolve against `ctx`, never a process-wide map. `partition` is present when the sending board's ledger keeps one set of rows per partition: resolve the ledger at it, or the dispatch is refused before a row is read. `taskId` is untrusted too, and the row it names is re-read and checked on the ledger you return. |
| `uses` | Declarations the resolved ledgers need in scope. |
| `onError` | `"skip"` (default) or `"fail"`: the worker-failure policy, as on a board. |
| `allowSessionState` | Accept an entry whose blocks keep session state. Refused by default. |
| `endRules` | What else holds a task open at a request's end. |

When `resolve` returns `undefined`, the check throws `UnknownTaskLedgerError { code: "unknown-task-ledger", entry, taskId, ledgerId }` before any row is read, and writes nothing. Every check a board runs before it starts a task (row, attempt, identity, status, assignee, lease, run link) runs on the resolved ledger. A sending board over a shared ledger dispatches under the ledger's id, so a resolver keyed on ledger ids finds it.

`defineFlow` refuses an entry that declares `from` and is also dispatched to by a board in the same flow, with "One entry runs behind one gate; drop `from`, or declare a second entry for the board."

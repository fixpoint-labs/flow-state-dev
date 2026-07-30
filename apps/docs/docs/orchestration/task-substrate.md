---
title: Task substrate
sidebar_position: 2
sidebar_label: Task substrate
description: The Task record and storage-agnostic TaskCollection that the task board and every coordination pattern are built on.
---

# Task substrate

Coordination patterns in flow-state-dev share one shape: a list of work items that get claimed, run, and marked done. The task substrate is where that shape lives. It gives you the `Task` record and a `TaskCollection` that stores tasks and mutates them safely under concurrency. Dispatchers, the task board, and the patterns above them (Supervisor, Plan and Execute) all read and write through this one API.

Reach for it directly when you need a coordination shape none of the wrappers provide. Otherwise you're using it underneath one of them.

Import it from `@flow-state-dev/orchestration`:

```ts
import { taskSchema, type Task } from "@flow-state-dev/orchestration";
```

## The Task record

A `Task` is one unit of work. It carries what to do, where it is in its lifecycle, what it depends on, and the result once it finishes. The schema is a Zod object, so you get runtime validation and an inferred type from the same source.

| Field | Type | Meaning |
|-------|------|---------|
| `id` | `string` | Stable identifier. Auto-generated when you don't supply one. |
| `goal` | `string` | The full objective a worker acts on. Required. |
| `title` | `string?` | Short label for plan UIs. Rows render `title ?? goal`. |
| `context` | `string?` | Prose support text a worker reads (the slice of the request it needs). Distinct from `input`. |
| `status` | `TaskStatus` | Where the task is in its lifecycle. See below. |
| `deps` | `string[]?` | Ids that must reach `completed` before this task is eligible. |
| `input` | `TInput?` | Typed payload handed to the worker. |
| `output` | `TOutput?` | Typed result written by `complete`. |
| `error` | `string?` | Message written by a hard `fail`. |
| `feedback` | `string?` | Message written by a soft `fail` or a review, readable on the next attempt. |
| `attempts` | `number` | How many times the task has been claimed. Starts at 0. |
| `maxAttempts` | `number?` | Optional retry budget. Governs soft vs hard fail. |
| `assignee` | `string?` | Worker key a board uses to route the task. |
| `priority` | `number?` | Higher wins under the priority dispatcher. Unset reads as 0. |
| `leaseUntil` | `number?` | Timestamp after which a stale claim can be reclaimed. |
| `labels` | `string[]?` | Free-form tags, filterable via `hasLabel` / `hasAllLabels`. |
| `metadata` | `Record<string, unknown>?` | Arbitrary structured data. |
| `createdAt` / `updatedAt` | `number` | Epoch ms. |
| `startedAt` / `completedAt` | `number?` | Epoch ms, stamped on first claim and on `complete`. |

`input` and `output` validate as `unknown` on the schema. The runtime type `Task<TInput, TOutput>` narrows them at your call site, so a board over a typed collection surfaces real payload types at the worker boundary.

### The status state machine

A task moves through a fixed set of statuses, and the substrate enforces the transitions.

```
pending ─┬─→ in_progress ─┬─→ completed
         │                ├─→ errored
         │                ├─→ pending           (reclaim, after a stale lease)
         │                ├─→ cancelled
         │                └─→ awaiting_review ─┬─→ completed
         │                                     ├─→ errored
         │                                     ├─→ pending    (resumeFromReview)
         │                                     └─→ cancelled
         ├─→ blocked ─┬─→ pending               (unblock)
         │            └─→ cancelled
         └─→ cancelled
```

`completed`, `errored`, and `cancelled` are terminal. Once a task lands there it has no further transitions. A task that has reached any of the three is *settled*, the term the board and pattern pages use for a terminal task regardless of which status it landed on. `pending`, `in_progress`, `blocked`, and `awaiting_review` are live states a task can still move out of. A move to the status a task already holds is on the table, so a repeat write doesn't throw.

Anything not on that diagram is refused. You cannot drop a `completed` task back into `in_progress`; the call throws an `IllegalTaskTransitionError` carrying `taskId`, `from`, and `to`, and nothing is written.

That is what you get driving a collection from your own code. A model driving a board through the delegation task tools sees something different: those tools catch this one error and return `{ ok: false, error: "illegal_status_transition: …" }`, naming the task's current status and the calls available from it, so a refused change reads like every other bad tool call. See [Delegation](../skills/delegation.md) for the coordinator's view.

`complete` and `fail` also take an option that makes one write *advisory*, so a refused transition does nothing instead of throwing. It is opt-in per call and off by default; see [recording a result that may no longer apply](#recording-a-result-that-may-no-longer-apply) below.

The status helpers are exported so you can reason about transitions without hardcoding the table:

```ts
import {
  isTerminalStatus,
  isTransitionAllowed,
  allowedTransitionsFrom,
} from "@flow-state-dev/orchestration";

isTerminalStatus("completed"); // true
isTransitionAllowed("pending", "completed"); // false — must go through in_progress
allowedTransitionsFrom("in_progress"); // ["completed", "errored", "awaiting_review", "pending", "cancelled"]
```

### Soft fail vs hard fail

`fail` behaves differently depending on whether the task carries a retry budget.

Set `maxAttempts` and, while `attempts < maxAttempts`, a call to `fail` is a *soft* fail: the task flips back to `pending`, the error is captured on `feedback`, and the next claim increments `attempts` for a fresh run. Leave `maxAttempts` unset and `fail` is a *hard* fail: the task goes straight to terminal `errored` with the error on `task.error`. Single-attempt is the default.

## TaskCollection

A `TaskCollection` stores tasks and exposes a mutation API. Every mutation is compare-and-set, so two workers claiming at the same moment never both win the same task. You get a `TaskCollectionRef` from `getOrCreateTaskCollection`, which needs the block context and a backing choice.

The mutation surface:

- **Create** — `addTask`, `addTasks`.
- **Lifecycle** — `claim`, `complete`, `fail`, `block` / `unblock`, `awaitReview` / `resumeFromReview`, `cancel`, `reclaim` (reset stale leases back to `pending`).
- **Mutate** — `setAssignee`, `setPriority`, `addLabel` / `removeLabel`, `patchMetadata`.
- **Query** — `get`, `list`, `count`. These are synchronous reads of the latest committed view.

Nothing calls `reclaim` for you. If you want expired leases returned to `pending`, call it yourself from a block that runs alongside the work.

`complete`, `fail`, `cancel`, and the five **Mutate** methods resolve to a verdict describing what the write did — see [what a write reports](#what-a-write-reports). `block`, `unblock`, `awaitReview`, and `resumeFromReview` resolve to nothing.

### Reading tasks back

Reads return a `TaskHandle`, which is the `Task` plus an `items()` accessor. `items()` returns the stream items a worker emitted while it held the claim (its messages, tool calls, sources, reasoning), so an aggregator such as a synthesizer or reviewer can pick from a worker's natural output instead of relying only on `task.output`. The data fields on a handle are a snapshot; `items()` is live and re-reads on every call.

Here's a handler that seeds two tasks with a dependency between them and dispatches the one that's ready:

```ts
import { handler } from "@flow-state-dev/core";
import {
  getOrCreateTaskCollection,
  topologicalDispatcher,
} from "@flow-state-dev/orchestration";
import { z } from "zod";

export const seedResearchPlan = handler({
  name: "seed-research-plan",
  inputSchema: z.object({ topic: z.string() }),
  outputSchema: z.object({ claimedGoal: z.string().nullable() }),
  async execute(input, ctx) {
    const collection = await getOrCreateTaskCollection({
      ctx,
      backing: "request",
      collectionId: "research-plan",
    });

    await collection.addTask({
      id: "research",
      goal: `Research the current state of ${input.topic}`,
    });
    await collection.addTask({
      id: "draft",
      goal: `Draft a briefing on ${input.topic}`,
      deps: ["research"],
    });

    // "draft" waits on "research", so the topological dispatcher
    // claims "research" and leaves "draft" pending.
    const claimed = await topologicalDispatcher.claim(collection, "writer-1", ctx);

    return { claimedGoal: claimed?.goal ?? null };
  },
});
```

### Recording a result that may no longer apply

`complete` and `fail` take an optional third argument. It exists for a specific situation: you claimed a task, went away to do the work, and by the time you came back somebody else had already decided the task's fate. Maybe a coordinator cancelled it. Maybe the worker marked it done itself partway through. Maybe the claim expired and another worker picked it up. Recording your result now would either be refused by the state machine, or overwrite the outcome someone else recorded.

Passing the option makes the write *advisory*: record this only if it still makes sense, otherwise do nothing.

```ts
await tasks.complete(task.id, output, {
  ifAllowed: true,              // skip if the state machine won't take it
  expectAttempt: task.attempts, // skip if this is no longer my claim
});
```

`ifAllowed` asks whether the transition is legal, and also declines when the task has already reached a terminal status, so a repeat write cannot clobber a settlement someone else already recorded. `expectAttempt` asks a different question: do I still hold this task? It catches a stale result that would be a perfectly legal transition, which `ifAllowed` lets through.

The task cannot change between the check and the write. Only a refused transition and a lost claim go quiet. A missing task, a store failure, or any other error still throws. Omit the argument and both methods throw on an illegal transition.

A skipped write resolves to `{ outcome: "declined", reason, status }` instead of throwing — see [what a write reports](#what-a-write-reports).


### What a write reports

`complete`, `fail`, `cancel`, `setAssignee`, `setPriority`, `addLabel`, `removeLabel`, and `patchMetadata` all resolve to the same shape, so one check reads the whole write surface:

```ts
type TaskWriteDeclineReason = "terminal" | "disallowed" | "lost-claim";

type TaskWriteOutcome =
  | { outcome: "recorded" }
  | { outcome: "unchanged" }
  | { outcome: "declined"; reason: TaskWriteDeclineReason; status: TaskStatus };
```

`recorded` means a field changed and a `task-change` item went out. `unchanged` means the task already held the state you asked for, so nothing was written and no item was emitted. `declined` means the write was refused: `status` is the status the task was in when it was refused, and `reason` says which condition stopped it.

- `terminal` — the task had already reached `completed`, `errored`, or `cancelled`.
- `disallowed` — the state machine won't take the move from the task's current, non-terminal status, such as `pending → errored`.
- `lost-claim` — `expectAttempt` no longer holds. The task was reclaimed, re-queued, or blocked while you were working on it.

When more than one condition applies, `reason` reports the first of those three that holds.

A decline is a value, not an error. Nothing throws, nothing is written, and discarding the return value compiles:

```ts
// Ignoring the verdict is fine.
await collection.complete("research", { summary: "…" }, { ifAllowed: true });

// Or read it.
const outcome = await collection.setAssignee("draft", "backup-writer");
if (outcome.outcome === "declined") {
  // { outcome: "declined", reason: "terminal", status: "errored" }
  console.log(`draft is ${outcome.status}, so the assignee stands`);
}
```

`cancel` needs no guards to be advisory: cancelling a task that already settled declines with reason `terminal`, and the first settlement's reason and timestamps are left alone. `complete` and `fail` decline only when you pass the guards above; without them an illegal transition throws.

`setAssignee` is the one field mutator that refuses anything — it declines on a terminal task. `setPriority`, `addLabel`, `removeLabel`, and `patchMetadata` write to a terminal task, which is how a post-drain audit labels what went wrong, so those four answer only `recorded` or `unchanged`. `patchMetadata` merges the patch rather than comparing it, so it answers `recorded` even for a patch that changes nothing.

`unchanged` is a statement about the task record: no field written, no `task-change` item. On a resource-backed collection the write reaches the resource either way, so a `resource_change` event can fire for a write that reported `unchanged`.

A missing task throws on every one of these methods; those three reasons are the whole set of refusals.

If you hand `taskBoard` a `TaskCollectionRef` of your own, callers see whatever your methods return. One whose methods resolve to nothing gives no verdict, and the framework won't invent one.

## The three backings

Where a collection stores its tasks decides how long they live. `getOrCreateTaskCollection` resolves the same `TaskCollectionRef` API over any of three backings, so your pattern code doesn't change when the storage does.

| Backing | Lifetime | Reach for it when |
|---------|----------|-------------------|
| `request` (task-board default) | The whole request, across block boundaries | Most work: an outer loop re-enters the same board, or a sibling step adds tasks before the drain. |
| `sequencer` | One board invocation | A pattern decomposes work and drains it within a single sequencer run and wants per-call storage. |
| `resource` | Outlives the request | A durable queue: a user's task list, an org work pool that accepts tasks across sessions. Declare it with `defineTaskCollection`. |

The sequencer backing is per-invocation because each sequencer call allocates a fresh state container. If you need the collection to survive across those calls but stay inside one request, use `request`. For anything that has to persist between requests, use `resource` with a session-, user-, or org-scoped resource collection.

All three backings agree on freshness *within* a request: two resolutions of the same collection read the same tasks, so a task added through one is visible through the other right away. `resource` is the only backing where the question reaches past the request, and there the guarantee stops. A request already running can't rely on seeing a write made by another request. A later request reads it.

```ts
// Durable, resource-backed queue that outlives the request.
const collection = await getOrCreateTaskCollection({
  ctx,
  backing: "resource",
  collectionId: "org-work-pool",
  collection: ctx.resources.orgTasks,
});
```

The sequencer backing expects the sequencer's state schema to hold a `Record<string, Task>` at its state key (default `"tasks"`).

`getOrCreateTaskCollection` is `async` whichever backing you pick, so always `await` it. The reads on the ref it returns (`get`, `list`, `count`) are synchronous in all three cases.

## Dispatchers

A dispatcher decides which ready task gets claimed next. Five ship with the package. Each one picks and claims in a single atomic step, so under contention exactly one worker wins the task and the others move on to the next eligible one. They differ only in which tasks they consider eligible and in what order they try them.

| Dispatcher | Picks | Eligibility |
|------------|-------|-------------|
| `fifoDispatcher` | Earliest `createdAt` eligible task | Pending, all `deps` completed. |
| `topologicalDispatcher` (default) | Earliest `createdAt` eligible task | Pending, all `deps` completed. |
| `priorityDispatcher` | Highest `priority`, ties break on `createdAt` | Pending, all `deps` completed. Unset priority reads as 0. |
| `classifierDispatcher({ classify })` | The id your `classify` callback returns, or nothing when it returns `null` | Pending, all `deps` completed, then narrowed to the id you chose. |
| `eventDispatcher({ topicFor, topic })` | First matching task in `createdAt` order | Pending, all `deps` completed, `topicFor(task) === topic`. |

`fifoDispatcher` and `topologicalDispatcher` behave identically; neither one will claim a task with unmet `deps`. The two names exist so a flat fan-out with no deps can say what it means.

The classifier and event dispatchers are factories because they take config. The classifier sees only the ready set (pending, deps satisfied), calls your callback to choose one id, then narrows the claim to that id, so if a parallel worker already took it, the compare-and-set still arbitrates:

```ts
import { classifierDispatcher } from "@flow-state-dev/orchestration";

const urgencyFirst = classifierDispatcher({
  async classify(candidates) {
    // Prefer whatever is tagged urgent; otherwise take the first ready task.
    const urgent = candidates.find((task) => task.labels?.includes("urgent"));
    return (urgent ?? candidates[0]).id;
  },
});
```

## task-change items

Every mutation that changes a field emits a `task-change` component item onto the stream, keyed by `${collectionId}/${taskId}` so the latest change per task replaces the previous one.

```ts
// data on a task-change component item
{
  collectionId: "research-plan",
  taskId: "draft",
  kind: "completed",         // added | claimed | completed | errored | retried |
                             // blocked | unblocked | review_requested | resumed |
                             // cancelled | label_changed | metadata_changed |
                             // priority_changed | assignee_changed
  task: { /* the whole Task, after the mutation */ },
  prevStatus: "in_progress", // omitted when the mutation didn't change status
}
```

UIs stay in sync off that stream rather than by polling. The `<TaskPlan />` component and the DevTool subscribe to `task-change` items, filter by `collectionId`, and rebuild the board's state from them. You don't wire any of it up: every collection `getOrCreateTaskCollection` hands you emits these items itself.

## Related pages

- [Task board](./task-board.md) — the concurrent drain built on a TaskCollection.
- [Flow policy](./flow-policy.md) — shaping the prior-work a worker sees.
- [Orchestration overview](./overview.md) — how the substrate, board, and skills fit together.
- [Flow-aware components](../ui/flow-aware-components.md) — rendering `task-change` items with `<TaskPlan />`.

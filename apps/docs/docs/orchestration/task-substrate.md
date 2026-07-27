---
title: Task substrate
sidebar_position: 2
sidebar_label: Task substrate
description: The Task record and storage-agnostic TaskCollection that the task board and every coordination pattern are built on.
---

# Task substrate

Every coordination pattern in flow-state-dev, the task board, the supervisor, plan-and-execute, comes down to the same idea: a list of work items that get claimed, run, and marked done. The task substrate is where that shared shape lives. It gives you two things: the `Task` record, and a `TaskCollection` that stores tasks and mutates them safely under concurrency. Everything above it, dispatchers, boards, patterns, reads and writes through this one API.

Tasks are core, not a niche add-on. If you use a supervisor or a plan-and-execute pattern, you're using the task substrate underneath, whether you touch it directly or not. When you need a coordination shape none of the wrappers provide, this is the layer you drop to.

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
| `attempts` | `number` | How many times the task has been claimed. Starts at 0. |
| `maxAttempts` | `number?` | Optional retry budget. Governs soft vs hard fail. |
| `assignee` | `string?` | Worker key a board uses to route the task. |
| `priority` | `number?` | Higher wins under the priority dispatcher. Unset reads as 0. |
| `leaseUntil` | `number?` | Timestamp after which a stale claim can be reclaimed. |
| `labels` | `string[]?` | Free-form tags, filterable via `hasLabel` / `hasAllLabels`. |
| `metadata` | `Record<string, unknown>?` | Arbitrary structured data. |

`input` and `output` validate as `unknown` on the schema. The runtime type `Task<TInput, TOutput>` narrows them at your call site, so a board over a typed collection surfaces real payload types at the worker boundary.

### The status state machine

A task moves through a fixed set of statuses, and the substrate enforces the transitions. You cannot drop a `completed` task back into `in_progress`. Illegal transitions throw rather than silently writing a bad state, and the error is an `IllegalTaskTransitionError` carrying the task id and the refused move.

That is what you get driving a collection from your own code. A model driving a board through the delegation task tools sees something different: those tools catch this one error and return `{ ok: false, error: "illegal_status_transition: …" }`, naming the task's current status and the calls available from it, so a refused change reads like every other bad tool call. See [Delegation](../skills/delegation.md) for the coordinator's view.

```
pending ─┬─→ in_progress ─┬─→ completed
         │                 ├─→ errored
         │                 ├─→ awaiting_review ─┬─→ pending  (resumeFromReview)
         │                                       └─→ cancelled
         │                 └─→ pending          (reclaim — stale lease)
         ├─→ blocked ─→ pending  (unblock)
         └─→ cancelled
```

`completed`, `errored`, and `cancelled` are terminal. Once a task lands there it has no further transitions. `pending`, `in_progress`, `blocked`, and `awaiting_review` are live states a task can still move out of.

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

A `TaskCollection` stores tasks and exposes a mutation API. Every mutation is CAS-safe (compare-and-set), so two workers claiming at the same moment never both win the same task. You get a `TaskCollectionRef` from `getOrCreateTaskCollection`, which needs the block context and a backing choice.

The mutation surface:

- **Create** — `addTask`, `addTasks`.
- **Lifecycle** — `claim`, `complete`, `fail`, `block` / `unblock`, `awaitReview` / `resumeFromReview`, `cancel`, `reclaim` (reset stale leases back to `pending`).
- **Mutate** — `setAssignee`, `setPriority`, `addLabel` / `removeLabel`, `patchMetadata`.
- **Query** — `get`, `list`, `count`. These are synchronous reads of the latest committed view.

Reads return a `TaskHandle`, which is the `Task` plus an `items()` accessor. `items()` returns the stream items a worker emitted while it held the claim, its messages, tool calls, sources, reasoning, so an aggregator (a synthesizer or reviewer) can pick from a worker's natural output instead of relying only on `task.output`. The data fields on a handle are a snapshot; `items()` is live and re-reads on every call.

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

## The three backings

Where a collection stores its tasks decides how long they live. `getOrCreateTaskCollection` resolves the same `TaskCollectionRef` API over any of three backings, so your pattern code doesn't change when the storage does.

| Backing | Lifetime | Reach for it when |
|---------|----------|-------------------|
| `request` (task-board default) | The whole request, across block boundaries | Most work: an outer loop re-enters the same board, or a sibling step adds tasks before the drain. |
| `sequencer` | One board invocation | A pattern decomposes work and drains it within a single sequencer run and wants per-call storage. |
| `resource` | Outlives the request | A durable queue: a user's task list, an org work pool that accepts tasks across sessions. Declare it with `defineTaskCollection`. |

The sequencer backing is per-invocation because each sequencer call allocates a fresh state container. If you need the collection to survive across those calls but stay inside one request, use `request`. For anything that has to persist between requests, use `resource` with a session-, user-, or org-scoped resource collection.

```ts
// Durable, resource-backed queue that outlives the request.
const collection = await getOrCreateTaskCollection({
  ctx,
  backing: "resource",
  collectionId: "org-work-pool",
  collection: ctx.resources.orgTasks,
});
```

The sequencer backing expects the sequencer's state schema to hold a `Record<string, Task>` at its state key (default `"tasks"`). The resource backing hydrates a synchronous read-mirror at construction, which is why the factory is uniformly `async`, you `await` it regardless of backing.

## Dispatchers

A dispatcher decides which ready task gets claimed next. All five built-ins delegate to `collection.claim`, so CAS retry and lease stamping run the same way no matter which one you pick. A dispatcher only chooses the eligibility predicate and the ordering.

| Dispatcher | Picks | Eligibility |
|------------|-------|-------------|
| `fifoDispatcher` | Earliest `createdAt` pending task | Any pending task. |
| `topologicalDispatcher` (default) | Earliest pending task with deps satisfied | Pending, all `deps` completed. |
| `priorityDispatcher` | Highest `priority`, ties break on `createdAt` | Pending, deps satisfied. Unset priority reads as 0. |
| `classifierDispatcher({ classify })` | The id your `classify` callback returns | Ready set handed to an LLM, which picks one or backs off. |
| `eventDispatcher({ topicFor, topic })` | First pending task whose topic matches | Pending, deps satisfied, `topicFor(task) === topic`. |

The classifier and event dispatchers are factories because they take config. The classifier sees only the ready set (pending, deps satisfied), calls your callback to choose one id, then narrows the claim to that id, so if a parallel worker already took it, the CAS still arbitrates:

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

Every mutation on a collection emits a `task-change` component item onto the stream, keyed by `${collectionId}/${taskId}` so the latest change per task replaces the previous one. The item carries the change kind (added, claimed, completed, retried, and so on), the task snapshot, and the previous status.

This is how UIs stay in sync without polling. The `<Plan />` component and the DevTool subscribe to `task-change` items, filter by `collectionId`, and rebuild the board's state from the stream. You don't wire this up; `getOrCreateTaskCollection` adapts the substrate's change callback to `ctx.emit.component` for you.

## Related pages

- [Task board](./task-board.md) — the concurrent drain built on a TaskCollection.
- [Flow policy](./flow-policy.md) — shaping the prior-work a worker sees.
- [Orchestration overview](./overview.md) — how the substrate, board, and skills fit together.
- [Flow-aware components](../ui/flow-aware-components.md) — rendering `task-change` items with `<Plan />`.

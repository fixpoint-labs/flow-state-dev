# @flow-state-dev/tasks

Substrate package for task-shaped work primitives. Implements the unified
Plan/Task primitive locked in [FIX-443](https://linear.app/fixpoint-labs/issue/FIX-443/plantask-design-task-shape-taskcollection-dispatcherworker-contracts).

This package ships four primitives:

- **Task** — canonical work-unit schema (id, goal, status, deps, lease, etc.)
- **TaskCollection** — uniform `TaskCollectionRef` API across two backings
  (sequencer-state, resource-collection)
- **Dispatcher** — `claim` contract + five standard dispatchers
- **Worker** — `BlockDefinition<TaskWorkerInput<TIn>, TOut>` alias; uniform or
  registry shapes

Plus two helpers (`taskLoopBack`, `dispatchAndExecute`) that compose the
canonical loop shapes documented in the design spec.

Patterns layer on top of this package; this package never imports from
`@flow-state-dev/patterns`. Layering: `core` → `tasks` → `patterns`.

## Task

```ts
import { taskSchema, type Task } from "@flow-state-dev/tasks";

const task: Task<{ q: string }, { a: number }> = {
  id: "t1",
  goal: "answer the question",
  status: "pending",
  attempts: 0,
  input: { q: "what?" },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
```

Status enum: `pending | in_progress | blocked | awaiting_review | completed |
errored | cancelled`. `awaiting_review` is in the canonical vocabulary; v1
ships it for HITL forward-compat (FIX-443 §10) — dispatchers skip it,
`taskLoopBack` waits for it.

State machine (FIX-443 §2):

```
pending ─┬─→ in_progress ─┬─→ completed
         │                 ├─→ errored
         │                 ├─→ awaiting_review ─┬─→ pending  (resumeFromReview)
         │                                       └─→ cancelled
         │                 └─→ pending          (reclaim — stale lease)
         ├─→ blocked ─→ pending  (unblock)
         └─→ cancelled
```

Terminal states: `completed`, `errored`, `cancelled`. `cancel()` on a terminal
status is a no-op and emits no item. Illegal transitions throw via
`assertTransitionAllowed`.

## TaskCollectionRef

The same shape across both backings:

```ts
interface TaskCollectionRef<TInput, TOutput> {
  collectionId: string;

  // creation
  addTask(task: TaskInit<TInput>): Promise<Task>;
  addTasks(tasks: TaskInit<TInput>[]): Promise<Task[]>;

  // lifecycle (CAS-safe; emits a task_change item)
  claim(workerId: string, options?: ClaimOptions): Promise<Task | null>;
  complete(id: string, output: TOutput): Promise<void>;
  fail(id: string, error: string): Promise<void>;
  block(id: string, reason?: string): Promise<void>;
  unblock(id: string): Promise<void>;
  awaitReview(id: string, feedback?: string): Promise<void>;
  resumeFromReview(id: string, feedback?: string): Promise<void>;
  cancel(id: string, reason?: string): Promise<void>;
  reclaim(now?: number): Promise<number>;

  // mutation
  setAssignee(id: string, assignee: string): Promise<void>;
  setPriority(id: string, priority: number): Promise<void>;
  addLabel(id: string, label: string): Promise<void>;
  removeLabel(id: string, label: string): Promise<void>;
  patchMetadata(id: string, patch: Record<string, unknown>): Promise<void>;

  // query
  get(id: string): Task | undefined;
  list(filter?: TaskFilter): Task[];
  count(filter?: TaskFilter): number;
}
```

`task.assignee` is the worker-registry routing key (set at creation by the
caller). It is *not* overwritten by `claim`. The `workerId` passed to `claim`
is for trace/lease attribution only — the lease itself is `leaseUntil`.

### Sequencer-state backing (default)

```ts
import { z } from "zod";
import { handler, sequencer } from "@flow-state-dev/core";
import {
  getOrCreateTaskCollection,
  taskSchema,
  fifoDispatcher,
} from "@flow-state-dev/tasks";

const tasksStateSchema = z.object({
  tasks: z.record(z.string(), taskSchema).default({}),
});

const seedTasks = handler({
  name: "seed",
  inputSchema: z.any(),
  outputSchema: z.any(),
  sequencerStateSchema: tasksStateSchema,
  execute: async (_input, ctx) => {
    const collection = getOrCreateTaskCollection({
      ctx,
      backing: "sequencer",
      collectionId: "plan",
      sequencer: ctx.sequencer!,
    });
    await collection.addTask({ goal: "research the topic" });
    await collection.addTask({ goal: "draft the post" });
    return null;
  },
});

const dispatchOne = handler({
  name: "dispatch",
  inputSchema: z.any(),
  outputSchema: z.any(),
  sequencerStateSchema: tasksStateSchema,
  execute: async (_input, ctx) => {
    const collection = getOrCreateTaskCollection({
      ctx,
      backing: "sequencer",
      collectionId: "plan",
      sequencer: ctx.sequencer!,
    });
    const task = await fifoDispatcher.claim(collection, "worker-1", ctx);
    if (task !== null) {
      // ... do the work ...
      await collection.complete(task.id, "result");
    }
    return null;
  },
});

const pipeline = sequencer({
  name: "task-pipeline",
  stateSchema: tasksStateSchema,
})
  .then(seedTasks)
  .then(dispatchOne);
```

Tasks live as a `Record<id, Task>` on the outer sequencer's state under the
key `tasks` (override via `stateKey`). All mutations go through
`sequencer.atomicState` so two workers contending for the same task cannot
both win — `atomicState` is CAS-guarded by core's state container and retries
on conflict.

Durability follows the sequencer's checkpoint contract
([FIX-401](https://linear.app/fixpoint-labs/issue/FIX-401/durable-sequencer-checkpoint-schema-replace-transient-true-snapshots),
latest-only with always-on default). State-snapshots emit at every step
boundary; the latest is persisted to `stores.checkpoints` and overwritten on
each subsequent step.

### Resource-collection backing

```ts
import { defineResourceCollection } from "@flow-state-dev/core";

const userTodos = defineResourceCollection({
  pattern: "todos/{id}",
  scope: "user",
  stateSchema: taskSchema,
});

const handlerExecute = async (_input, ctx) => {
  const collection = getOrCreateTaskCollection({
    ctx,
    backing: "resource",
    collectionId: "user-todos",
    collection: ctx.resources.userTodos,
  });
  await collection.addTask({ goal: "buy milk" });
};
```

Use this when the collection outlives a single request — a user's persistent
todo list, an org-wide work queue, a skill that persists Tasks across
sessions. CAS rides the underlying `ResourceRef.updateState` contract;
re-eligibility is re-checked inside the updater so concurrent claim attempts
serialize correctly.

## Dispatchers

```ts
import {
  fifoDispatcher,
  topologicalDispatcher,
  priorityDispatcher,
  classifierDispatcher,
  eventDispatcher,
} from "@flow-state-dev/tasks";
```

| Dispatcher | Eligibility |
| -- | -- |
| `fifoDispatcher` | Earliest-`createdAt` `pending` task |
| `topologicalDispatcher` | Earliest-`createdAt` `pending` task with all `deps[]` `completed` |
| `priorityDispatcher` | Highest-`priority` `pending` task with deps satisfied |
| `classifierDispatcher({ classify })` | LLM (or any callback) picks among ready candidates |
| `eventDispatcher({ topicFor, topic })` | First `pending` task whose `topicFor(task)` matches the published topic |

Every standard dispatcher delegates to `collection.claim(workerId, options)`,
so the substrate's CAS retry and lease stamping run uniformly. Custom
dispatchers are user-supplied blocks satisfying the `TaskDispatcher`
interface.

All standard dispatchers skip `awaiting_review` tasks per FIX-443 §10.1.

## Workers

```ts
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import type { TaskWorkerInput, TaskWorker } from "@flow-state-dev/tasks";

const researchWorker: TaskWorker<{ topic: string }, { findings: string[] }> = handler({
  name: "research",
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: (input: TaskWorkerInput<{ topic: string }>) => ({
    findings: [`Researched: ${input.input?.topic}`],
  }),
});
```

Workers are `BlockDefinition<TaskWorkerInput<TIn>, TOut>` — no parallel
"worker" type. This preserves capability composition: a worker is a
generator/handler/sequencer like any other, free to declare its own
resources, capabilities, and tools.

A pattern accepts either:

- a single uniform worker (every task goes through it), or
- a worker registry (`Record<string, BlockDefinition>` keyed by
  `task.assignee`).

```ts
const registry = {
  researcher: researchWorker,
  writer: writerWorker,
};
```

Worker output write-back is the pattern's responsibility — workers return
their result; the pattern's `recordResult` step calls
`collection.complete(taskId, output)` or `collection.fail(taskId, error)`.

## Helpers

### `taskLoopBack`

Termination predicate for sequencer-driven task loops:

```ts
import { taskLoopBack } from "@flow-state-dev/tasks";

const loop = taskLoopBack();
// loop.shouldContinue(collection) → true while pending/in_progress/awaiting_review remain
// loop.maxIterations → 10_000 (default cap)
```

`awaiting_review` counts as in-flight (the loop waits, doesn't terminate)
per FIX-443 §10.1. Pass a custom `until` predicate to override.

### `dispatchAndExecute`

The canonical "claim one, execute it, record the result" cycle:

```ts
import { dispatchAndExecute } from "@flow-state-dev/tasks";

const result = await dispatchAndExecute(
  {
    collection,
    dispatcher: fifoDispatcher,
    workers: registry, // or a single uniform worker
    workerId: "worker-1",
    onError: "skip", // or "fail" to rethrow after collection.fail
  },
  ctx
);
// result.claimed: boolean
// result.taskId, result.output, result.error (per outcome)
```

## `task_change` items

Every lifecycle mutation emits a `task_change` item on the active stream:

```ts
type TaskChangeItem = {
  type: "task_change";
  collectionId: string;
  taskId: string;
  kind:
    | "added" | "claimed" | "completed" | "errored" | "blocked" | "unblocked"
    | "review_requested" | "resumed" | "cancelled"
    | "label_changed" | "metadata_changed" | "priority_changed" | "assignee_changed";
  task: Task;
  prevStatus?: TaskStatus;
  // ...standard OutputItem fields
};
```

Transient by default (no replay buffer). `persistTaskEvents: true` on the
factory opts the whole collection into persistence. `<Plan />` and the DevTool
subscribe to `task_change` for a given `collectionId` and rebuild the visible
state from the stream — there's no separate "load tasks" call.

`kind: "resumed"` covers two paths to the same lifecycle outcome — the task
is back to `pending`. It fires both for `resumeFromReview` (human review →
back to the queue) and for `reclaim` (stale lease detected → back to the
queue). UI consumers can disambiguate via `prevStatus`: `awaiting_review`
for review, `in_progress` for reclaim.

## HITL — what v1 ships

Per FIX-443 §10.8:

✅ `awaiting_review` status in the canonical enum
✅ Standard dispatchers skip `awaiting_review` tasks
✅ `taskLoopBack` waits for `awaiting_review` tasks
✅ `awaitReview(id, feedback?)` and `resumeFromReview(id, feedback?)`
✅ `metadata.review.history` documented as the audit-history convention

Wave 2 follow-ons (not in this package): `reviewPolicy` config field,
worker-explicit `awaiting_review` return shape, inline `<Plan />` review
affordances, `tasks.review.requested` cross-flow event topic, default review
inbox surface.

## What's not in this package

- `<Plan />` rendering — [FIX-445](https://linear.app/fixpoint-labs/issue/FIX-445)
- The `taskBoard` pattern — [FIX-446](https://linear.app/fixpoint-labs/issue/FIX-446)
- Migrations of existing patterns onto the substrate —
  [FIX-447](https://linear.app/fixpoint-labs/issue/FIX-447) /
  [FIX-448](https://linear.app/fixpoint-labs/issue/FIX-448)
- Plan Mode reshape — [FIX-449](https://linear.app/fixpoint-labs/issue/FIX-449)
- Skill-pattern frontmatter binding — [FIX-450](https://linear.app/fixpoint-labs/issue/FIX-450)

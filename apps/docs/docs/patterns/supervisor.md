---
sidebar_position: 5
---

# Supervisor

The Supervisor is a fan-out pattern with a per-task quality review loop. It decomposes a goal into sub-tasks, dispatches workers concurrently, runs a reviewer on each individual worker output, and retries via a per-task budget when the reviewer rejects.

Use it when:

- Output quality matters and individual failures should be corrected, not skipped
- Each task needs its own review — a worker output should be approved or revised before it counts as done
- You want a retry budget that triggers on review rejection (not just on worker exceptions)

If you don't need review, use [Parallel Tasks](./parallelTasks) for concurrent execution. If tasks need strict dependency ordering, use [Plan and Execute](./plan-and-execute). The supervisor honours `deps` between tasks (dependent tasks wait until their prerequisites complete) but executes independent tasks concurrently within the worker pool.

## Block composition

```
goal
  → captureAndPlan            (store goal, run planner, seed taskBoard collection)
  → board.block               (drain — each worker runs the per-task review chain)
  → cascadeSkipDependents     (.tap — cancel pendings whose deps errored)
  → labelFailedReviews        (.tap — label terminal errored tasks by failure category)
  → synthesize                (build { goal, results } and run the synthesizer)
```

Each registered worker is wrapped at supervisor-construction time in a sequencer:

```
TaskWorkerInput
  → stashTaskId (.tap — capture taskId / goal / attempts)
  → adaptedWorker        (the user's worker; legacyWorkerAdapter applied if needed)
  → stashWorkerOutput (.tap — capture worker output for applyVerdict)
  → stampReviewEntered (.tap — set metadata.review.entered for terminal labelling)
  → buildReviewerInput   (.map — { taskId, goal, attempts, workerOutput, criteria? })
  → reviewerGenerator    (produces ReviewerVerdict)
  → applyVerdict         (approve → flow workerOutput through; reject → throw)
```

When `applyVerdict` throws, the substrate's `recordError` catches it. If `attempts < maxAttempts`, the task re-pends with the verdict feedback as `task.feedback` so the next attempt can address it. When the budget exhausts, the task transitions to terminal `errored` and `labelFailedReviews` adds the `failed-review` label.

The reviewer composition is BP-011 conformant — the reviewer runs as a `.step(reviewer)` step in the worker's sequencer, not as a `block.run` call inside a handler.

## Basic usage

```ts
import { supervisor } from "@flow-state-dev/patterns";
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

const researchWorker = generator({
  name: "research-task",
  model: "gpt-5-mini",
  inputSchema: z.object({
    taskId: z.string(),
    goal: z.string(),
    feedback: z.string().optional(),
  }),
  outputSchema: z.object({ summary: z.string() }),
  prompt: "You are a research assistant. Complete the task thoroughly.",
  user: (input) => {
    const base = `Task: ${input.goal}`;
    return input.feedback ? `${base}\n\nPrior feedback: ${input.feedback}` : base;
  },
});

const researchSupervisor = supervisor({
  name: "research",
  worker: researchWorker,
  reviewCriteria: [
    "Sources are specific and relevant",
    "Summary is substantive",
    "Addresses the task goal directly",
  ],
  maxAttemptsPerTask: 3,
  maxConcurrency: 4,
});
```

## Worker input shape

The worker receives the substrate's `TaskWorkerInput`:

```ts
{
  taskId: string;
  goal: string;
  input?: unknown;          // task input — typically the planner's `context` field
  attempts: number;          // 1 on first attempt, increments on retry
  feedback?: string;         // verdict feedback from the prior attempt (if retrying)
  metadata?: Record<string, unknown>;
}
```

On the first attempt, `feedback` is absent. On retry — after a reviewer rejection — it contains the verdict's feedback string so the worker can address it.

### Legacy worker shape (back-compat)

Pre-migration the supervisor used a simpler shape: `{ id, goal, context?, feedback? }`. Workers declaring `inputSchema: executableTaskSchema` are auto-adapted via `legacyWorkerAdapter` so existing code keeps working:

```ts
import { executableTaskSchema, supervisor } from "@flow-state-dev/patterns";

const legacyWorker = handler({
  inputSchema: executableTaskSchema,
  // ... receives { id, goal, context?, feedback? }
});

supervisor({ worker: legacyWorker, ... });   // adapter wraps it transparently
```

The legacy adapter is detected by `inputSchema` reference equality. Workers without `inputSchema` are passed through unchanged — they receive `TaskWorkerInput`.

## Reviewer verdict shape

The reviewer block receives a `ReviewerInput` and must return a `ReviewerVerdict`:

```ts
type ReviewerInput = {
  taskId: string;
  goal: string;
  attempts: number;
  workerOutput: unknown;
  criteria?: string[];        // forwarded from `reviewCriteria`
};

type ReviewerVerdict = {
  decision: "approve" | "reject" | "needs-revision";
  feedback?: string;          // shown to the worker on retry; required on reject / needs-revision
  criteria?: Record<string, unknown>;
  reasoning?: string;
};
```

`reject` and `needs-revision` are functionally identical for the retry path — both throw the verdict's `feedback` so the substrate re-pends. They're separated for prompt clarity (the reviewer can express "redo from scratch" vs "polish the existing output").

Pass `reviewer: false` to disable per-task review — every worker output flows straight through to `collection.complete`.

## Per-task retry budget

`maxAttemptsPerTask` (default 3) bounds how many times a task can be re-attempted on review rejection. The substrate's `Task.maxAttempts` field is stamped at planning time:

- Attempt 1 fails review → task re-pends with feedback, `attempts: 1`.
- Attempt 2 fails review → task re-pends, `attempts: 2`.
- Attempt 3 fails review → task transitions to terminal `errored`, `labelFailedReviews` adds `failed-review`.

A worker that throws (rather than producing output the reviewer rejects) is also subject to the same budget — the substrate doesn't distinguish. After the drain, `labelFailedReviews` separates them by metadata:

| Failure kind | Label |
|---|---|
| Reviewer rejected on the final attempt | `failed-review` |
| Reviewer block itself threw | `reviewer-error` |
| Worker threw before review could run | `worker-error` |

## Task dependencies

The planner can declare dependencies between tasks using `deps`:

```ts
{ tasks: [
  { id: "gather", goal: "Collect raw data" },
  { id: "analyze", goal: "Analyze data", deps: ["gather"] },
  { id: "report", goal: "Write report", deps: ["analyze"] },
]}
```

Tasks with unmet dependencies are held back. When a task `errored`s, every task that depends on it (transitively) is `cancelled` with the `skipped` label by `cascadeSkipDependents`.

## Worker registry

When different tasks need different workers, pass a registry instead of a single `worker`:

```ts
supervisor({
  workers: {
    "search-agent": searchWorker,
    "writer-agent": writerWorker,
  },
});
```

The substrate routes each task to the worker matching `task.assignee`. Each registry entry is wrapped in its own reviewedWorker chain.

## Config reference

```ts
supervisor({
  name: string;

  // One of `worker` or `workers` is required.
  worker?: BlockDefinition;
  workers?: Record<string, BlockDefinition>;

  // Strings forwarded into the reviewer's input.criteria.
  reviewCriteria?: string[];

  // Per-task retry budget for review rejection. Default 3.
  maxAttemptsPerTask?: number;

  // Worker pool size. Default 3.
  maxConcurrency?: number;

  // Override the planning step. Default: `utility.decomposer()`.
  planner?: BlockDefinition;

  // Override the reviewer. Pass `false` to disable per-task review.
  reviewer?: BlockDefinition | false;

  // Optional outer replanner — when present, supervisor adds a replan loop
  // around the board, re-entering when failed-review tasks accumulate.
  replanner?: BlockDefinition;

  // Outer replan-loop iteration cap. Default 3.
  maxIterations?: number;

  // Final synthesizer. Receives `{ goal, results }`.
  synthesizer?: BlockDefinition;

  // How to handle worker failures (forwarded to taskBoard.onError):
  //   "skip" — capture error on the failing task, siblings continue (default).
  //   "fail" — the failing worker propagates up, aborting the supervisor.
  //   "retry" — not supported; treated as "skip". Use maxAttemptsPerTask.
  onSubTaskError?: "skip" | "fail" | "retry";

  outputSchema?: ZodSchema;
  context?: GeneratorSlot;
  history?: GeneratorHistoryConfig;
  uses?: UsesSlot;
  reviewerVisibility?: ItemVisibility;
  synthesizerVisibility?: ItemVisibility;
  instructions?: string | (input, ctx) => string;
});
```

## Exported API

```ts
import {
  supervisor,
  supervisorInputSchema,
  supervisorStateSchema,
  reviewerVerdictSchema,
  reviewerInputSchema,
  plannerOutputSchema,
  executableTaskSchema,        // legacy worker input shape
  legacyWorkerAdapter,          // back-compat shim
  buildReviewedWorker,          // build a per-task review chain manually
  createSupervisorCaptureAndPlan,
  createSupervisorSynthesize,
  createLabelFailedReviews,
} from "@flow-state-dev/patterns";

import type {
  SupervisorConfig,
  SupervisorState,
  ReviewerVerdict,
  ReviewerInput,
  PlannerOutput,
  ExecutableTask,
} from "@flow-state-dev/patterns";
```

## Output shape

The supervisor's output is whatever the synthesizer produces — typically a string for the default synthesizer. With a custom synthesizer the shape follows the synthesizer's `outputSchema`.

The synthesizer receives `{ goal: string, results: unknown[] }` where `results` is the array of `output` values from every `completed` task.

## See also

- [Task Board](../orchestration/task-board) — the substrate that powers Supervisor's worker dispatch
- [Parallel Tasks](./parallelTasks) — fan-out without per-task review
- [Round Robin](./round-robin) — fixed-roster turn-taking with a judge, no per-task retry
- [Plan and Execute](./plan-and-execute) — sequential dependency-ordered execution with optional replanning
- [Patterns Overview](./overview) — when to use which pattern

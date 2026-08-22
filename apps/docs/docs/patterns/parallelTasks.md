---
sidebar_position: 4
---

# parallelTasks

`parallelTasks` is a single-pass fan-out/fan-in pattern. It decomposes a goal into sub-tasks, runs a worker block for each concurrently (via `taskBoard`), and synthesizes the results. No review loop, no replanning — one pass.

Use it when:
- You have a goal that decomposes into parallel, independent sub-tasks
- You trust the worker to produce usable results without review
- Speed matters and you can tolerate skipping failed sub-tasks

If you need results reviewed and revised before merging, use [Supervisor](./supervisor) instead.

## Block composition

```
goal
  → planner        (decompose into sub-tasks)
  → seedTasks      (seed taskBoard collection)
  → board.drain    (drain — run worker for each task concurrently)
  → collectResults (gather completed task outputs)
  → synthesizer    (merge/combine)
```

The planner is `utility.decomposer` by default. The synthesizer is `utility.combiner`. Both are swappable via config.

## Basic usage

```ts
import { parallelTasks } from "@flow-state-dev/patterns";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const researchWorker = handler({
  name: "research-task",
  inputSchema: z.any(), // receives TaskWorkerInput: { taskId, goal, input, ... }
  outputSchema: z.object({ summary: z.string() }),
  execute: async (input) => {
    // input.goal is the sub-task goal string
    return { summary: `Findings for: ${input.goal}` };
  },
});

const researchBlock = parallelTasks({
  name: "research",
  worker: researchWorker,
  maxConcurrency: 5,
});
```

`parallelTasks` returns a sequencer. Use it in a flow like any other block:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";

const flow = defineFlow({
  kind: "research",
  requireUser: true,
  actions: {
    research: {
      inputSchema: z.object({ goal: z.string() }),
      block: researchBlock,
      userMessage: (input) => input.goal,
    },
  },
  session: {
    stateSchema: z.object({}),
  },
});
```

## Config reference

```ts
parallelTasks({
  name: string;

  // The worker block that processes each sub-task.
  // Receives TaskWorkerInput: { taskId, goal, input, attempts, feedback, metadata }.
  worker: BlockDefinition;

  // Max concurrent sub-tasks. Default: 3.
  maxConcurrency?: number;

  // Retries the whole board may authorize, across every sub-task. Default 50.
  // `null` for no bound, `0` to never retry. A sub-task retries when the
  // planner gives it a maxAttempts. See Task Board → Bounding the retries.
  maxTotalRetries?: number | null;

  // Override the planning step.
  // Must accept { goal: string } and output { tasks: Array<{ goal: string }> }.
  // Default: utility.decomposer()
  planner?: BlockDefinition;

  // Override the synthesis step. Receives unknown[] of completed task outputs.
  // Default: utility.combiner()
  synthesizer?: BlockDefinition;

  // How to handle individual sub-task failures:
  //   "skip" — exclude failed sub-tasks from synthesis (default)
  //   "fail" — abort the entire coordination on any failure
  onSubTaskError?: "skip" | "fail";

  // Output schema for the synthesized result.
  // Passed to the default combiner when no custom synthesizer is provided.
  outputSchema?: ZodSchema;
});
```

## Input schema

`parallelTasks` expects:

```ts
{ goal: string }
```

Exported as `parallelTasksInputSchema`:

```ts
import { parallelTasksInputSchema } from "@flow-state-dev/patterns";
```

## Exported API

```ts
import {
  parallelTasks,
  parallelTasksInputSchema,
} from "@flow-state-dev/patterns";

import type {
  ParallelTasksConfig,
  SubTaskErrorStrategy,  // "skip" | "fail"
} from "@flow-state-dev/patterns";
```

## Custom planner

The default planner is `utility.decomposer`. Swap it for a domain-specific one:

```ts
import { parallelTasks } from "@flow-state-dev/patterns";
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

const domainPlanner = generator({
  name: "domain-planner",
  outputSchema: z.object({
    tasks: z.array(z.object({ goal: z.string() })),
  }),
  prompt: "You are a planner specialized in software architecture reviews.",
  user: (input) => input.goal,
});

const architectureBlock = parallelTasks({
  name: "arch-review",
  worker: reviewWorker,
  planner: domainPlanner,
});
```

## Custom synthesizer

By default, `utility.combiner` merges worker results deterministically (no LLM call). To synthesize results with an LLM, supply a `generator()` with a `user` projection over the completed worker outputs (the slot receives them as `unknown[]`):

```ts
import { parallelTasks } from "@flow-state-dev/patterns";
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

const reportBlock = parallelTasks({
  name: "report",
  worker: sectionWorker,
  synthesizer: generator({
    name: "report-synthesizer",
    outputSchema: z.object({ report: z.string() }),
    prompt: "Combine the section drafts into one coherent, non-redundant report.",
    user: (results: unknown[]) => JSON.stringify(results, null, 2),
  }),
});
```

## Error handling

By default (`onSubTaskError: "skip"`), failed sub-tasks are excluded from the synthesis step. The block completes with whatever results succeeded. If all sub-tasks fail, the synthesizer receives an empty array.

With `onSubTaskError: "fail"`, any sub-task failure throws and aborts the entire coordination.

### Retrying a failed sub-task

`onSubTaskError` decides what happens once a sub-task has run out of attempts. The retries themselves come from the task board underneath, and they are set per sub-task rather than per block.

Give sub-tasks a retry budget by having a [custom planner](#custom-planner) put `maxAttempts` on each task it emits. When a sub-task that still has attempts left fails, the board re-queues it and hands the error back to the worker as `feedback`, so the next attempt can see what went wrong:

```ts
const retryingPlanner = generator({
  name: "retrying-planner",
  outputSchema: z.object({
    tasks: z.array(z.object({ goal: z.string(), maxAttempts: z.number() })),
  }),
  prompt: "Break the goal into sub-tasks. Give each one maxAttempts: 3.",
  user: (input) => input.goal,
});

const researchBlock = parallelTasks({
  name: "research",
  worker: researchWorker,
  planner: retryingPlanner,
  maxTotalRetries: 20,
});
```

`maxTotalRetries` bounds how many retries the whole board may authorize across every sub-task. It defaults to 50, and `0` means each sub-task runs exactly once. Full semantics are in [Bounding the retries](../orchestration/task-board#bounding-the-retries).

## Composability

`parallelTasks` returns a sequencer, so it composes with other sequencer steps:

```ts
// Chain sequentially
const pipeline = sequencer({ name: "full-pipeline", inputSchema })
  .step(parallelTasks({ name: "research", worker: researchWorker }))
  .step(parallelTasks({ name: "synthesis", worker: synthesisWorker }));

// Use as a step inside another sequencer
const outer = sequencer({ name: "outer", inputSchema })
  .step(preprocess)
  .step(parallelTasks({ name: "parallel-work", worker: taskWorker }))
  .step(postprocess);
```

## See also

- [Supervisor](./supervisor) — same fan-out model, adds a quality review loop
- [Plan and Execute](./plan-and-execute) — sequential dependency-ordered execution
- [GoalSeekLoop](../orchestration/goal-seek-loop) — the loop primitive Parallel Tasks is expressed on (as a single pass)
- [Patterns Overview](./overview) — when to use which pattern

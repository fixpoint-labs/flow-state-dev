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
  → board.block    (drain — run worker for each task concurrently)
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

  // Override the planning step.
  // Must accept { goal: string } and output { tasks: Array<{ goal: string }> }.
  // Default: utility.decomposer()
  planner?: BlockDefinition;

  // Override the synthesis step. Receives unknown[] of completed task outputs.
  // Default: utility.combiner()
  synthesizer?: BlockDefinition;

  // How to handle individual sub-task failures:
  //   "skip"  — exclude failed sub-tasks from synthesis (default)
  //   "fail"  — abort the entire coordination on any failure
  //   "retry" — treated as "skip" with a construction-time warning
  onSubTaskError?: "skip" | "fail" | "retry";

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
  SubTaskErrorStrategy,  // "skip" | "fail" | "retry"
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

By default, `utility.combiner` merges worker results deterministically (no LLM call). To synthesize results with an LLM, swap in `utility.synthesizer`:

```ts
import { parallelTasks } from "@flow-state-dev/patterns";
import { utility } from "@flow-state-dev/core";

const reportBlock = parallelTasks({
  name: "report",
  worker: sectionWorker,
  synthesizer: utility.synthesizer({
    name: "report-synthesizer",
    outputSchema: z.object({ report: z.string() }),
  }),
});
```

## Error handling

By default (`onSubTaskError: "skip"`), failed sub-tasks are excluded from the synthesis step. The block completes with whatever results succeeded. If all sub-tasks fail, the synthesizer receives an empty array.

With `onSubTaskError: "fail"`, any sub-task failure throws and aborts the entire coordination.

`onSubTaskError: "retry"` is not supported and behaves as `"skip"` with a one-time construction warning.

## Composability

`parallelTasks` returns a sequencer, so it composes with other sequencer steps:

```ts
// Chain sequentially
const pipeline = sequencer({ name: "full-pipeline", inputSchema })
  .then(parallelTasks({ name: "research", worker: researchWorker }))
  .then(parallelTasks({ name: "synthesis", worker: synthesisWorker }));

// Use as a step inside another sequencer
const outer = sequencer({ name: "outer", inputSchema })
  .then(preprocess)
  .then(parallelTasks({ name: "parallel-work", worker: taskWorker }))
  .then(postprocess);
```

## See also

- [Supervisor](./supervisor) — same fan-out model, adds a quality review loop
- [Plan and Execute](./plan-and-execute) — sequential dependency-ordered execution
- [Patterns Overview](./overview) — when to use which pattern

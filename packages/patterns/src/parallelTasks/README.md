# parallelTasks

Single-pass fan-out/fan-in orchestration. Decomposes a goal into sub-tasks, runs a worker for each concurrently via `taskBoard`, and synthesizes the results. No feedback loop.

Use this when sub-tasks are independent. Use [Supervisor](../supervisor/) when results need review and iteration.

## Pipeline

```
goal
  → planner        (decompose into sub-tasks)
  → seedTasks      (seed board collection)
  → board.block    (drain — run worker for each task concurrently)
  → collectResults (gather completed task outputs)
  → synthesizer    (merge/combine)
```

## Usage

```ts
import { parallelTasks } from "@flow-state-dev/patterns";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const researchWorker = handler({
  name: "research-task",
  inputSchema: z.any(), // receives TaskWorkerInput from taskBoard
  outputSchema: z.object({ summary: z.string() }),
  execute: async (input) => ({ summary: `Findings for: ${input.goal}` }),
});

const block = parallelTasks({
  name: "research",
  worker: researchWorker,
  maxConcurrency: 5,
});
```

## Config

```ts
parallelTasks({
  name: string;
  worker: BlockDefinition;       // receives TaskWorkerInput { taskId, goal, input, ... }
  maxConcurrency?: number;       // default 3
  planner?: BlockDefinition;     // must output { tasks: Array<{ goal: string }> }
  synthesizer?: BlockDefinition; // receives unknown[] of completed task outputs
  merger?: BlockDefinition;      // deprecated alias for synthesizer
  onSubTaskError?: "skip" | "fail" | "retry"; // default "skip"; "retry" treated as "skip"
  outputSchema?: ZodSchema;
});
```

## Migration from coordinator

`coordinator()` is a deprecated alias. Replace:

```ts
// Before
import { coordinator } from "@flow-state-dev/patterns";
const block = coordinator({ name: "...", worker: myWorker });

// After
import { parallelTasks } from "@flow-state-dev/patterns";
const block = parallelTasks({ name: "...", worker: myWorker });
```

Same config shape. Worker input changes from a plain string (goal) to `TaskWorkerInput` (`{ taskId, goal, input, ... }`).

## Exports

```ts
import {
  parallelTasks,
  parallelTasksInputSchema,
} from "@flow-state-dev/patterns";

import type {
  ParallelTasksConfig,
  SubTaskErrorStrategy,
} from "@flow-state-dev/patterns";
```

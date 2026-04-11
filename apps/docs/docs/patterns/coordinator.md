---
sidebar_position: 4
---

# Coordinator

The Coordinator is a single-pass fan-out/fan-in pattern. It decomposes a goal into sub-tasks, runs a worker block for each concurrently, and merges the results. No review loop, no replanning — one pass.

Use it when:
- You have a goal that decomposes into parallel, independent sub-tasks
- You trust the worker to produce usable results without review
- Speed matters and you can tolerate skipping failed sub-tasks

If you need results reviewed and revised before merging, use [Supervisor](./supervisor) instead.

## Block composition

```
goal
  → decomposer          (plan sub-tasks)
  → .map()              (extract task goals)
  → .forEach(worker)    (run worker for each, concurrently)
  → combiner            (merge results)
```

The decomposer is `utility.decomposer` by default. The combiner is `utility.combiner`. Both are swappable via config.

## Basic usage

```ts
import { coordinator } from "@flow-state-dev/patterns";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const researchWorker = handler({
  name: "research-task",
  inputSchema: z.string(),
  outputSchema: z.object({ summary: z.string() }),
  execute: async (goal) => {
    // fetch data, call an API, etc.
    return { summary: `Findings for: ${goal}` };
  },
});

const researchCoordinator = coordinator({
  name: "research",
  worker: researchWorker,
  maxConcurrency: 5,
});
```

The coordinator returns a sequencer. Use it in a flow like any other block:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";

const flow = defineFlow({
  kind: "research",
  requireUser: true,
  actions: {
    research: {
      inputSchema: z.object({ goal: z.string() }),
      block: researchCoordinator,
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
coordinator({
  name: string;

  // The worker block that processes each sub-task.
  // Receives a string (the sub-task goal).
  worker: BlockDefinition;

  // Max concurrent sub-tasks. Default: 3.
  maxConcurrency?: number;

  // Override the planning step.
  // Must accept { goal: string } and output { tasks: Array<{ goal: string }> }.
  // Default: utility.decomposer()
  planner?: BlockDefinition;

  // Override the merge step.
  // Default: utility.combiner()
  merger?: BlockDefinition;

  // How to handle individual sub-task failures:
  //   "skip"  — exclude failed sub-tasks from merge (default)
  //   "fail"  — abort the entire coordination on any failure
  //   "retry" — retry per the worker's retry policy before failing
  onSubTaskError?: "skip" | "fail" | "retry";

  // Output schema for the merged result.
  // Passed to the default combiner when no custom merger is provided.
  outputSchema?: ZodSchema;
});
```

## Input schema

The coordinator expects:

```ts
{ goal: string }
```

This is exported as `coordinatorInputSchema` if you need to reference it:

```ts
import { coordinatorInputSchema } from "@flow-state-dev/patterns";
```

## Exported API

```ts
import {
  coordinator,           // factory function
  coordinatorInputSchema // z.object({ goal: z.string() })
} from "@flow-state-dev/patterns";

import type {
  CoordinatorConfig,
  SubTaskErrorStrategy   // "skip" | "fail" | "retry"
} from "@flow-state-dev/patterns";
```

## Custom planner

The default planner is `utility.decomposer`. You can swap it for a domain-specific one:

```ts
import { coordinator } from "@flow-state-dev/patterns";
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

const architectureCoordinator = coordinator({
  name: "arch-review",
  worker: reviewWorker,
  planner: domainPlanner,
});
```

## Custom merger

By default, `utility.combiner` merges the worker results deterministically (no LLM call). To synthesize results with an LLM, swap in `utility.synthesizer`:

```ts
import { coordinator } from "@flow-state-dev/patterns";
import { utility } from "@flow-state-dev/core";

const reportCoordinator = coordinator({
  name: "report",
  worker: sectionWorker,
  merger: utility.synthesizer({
    name: "report-merger",
    outputSchema: z.object({ report: z.string() }),
  }),
});
```

## Error handling

By default (`onSubTaskError: "skip"`), failed sub-tasks are excluded from the merge step. The coordinator completes with whatever results succeeded. If all sub-tasks fail, the combiner receives an empty array.

With `onSubTaskError: "fail"`, any sub-task failure throws and aborts the entire coordination.

With `onSubTaskError: "retry"`, the coordinator respects the worker's `retry` config before failing. If the worker has no retry policy, this behaves the same as `"fail"`.

## Composability

The coordinator is a sequencer, so it composes with other sequencer steps:

```ts
// Chain coordinators sequentially
const pipeline = sequencer({ name: "full-pipeline", inputSchema })
  .then(coordinator({ name: "research", worker: researchWorker }))
  .then(coordinator({ name: "synthesis", worker: synthesisWorker }));

// Use as a step inside another sequencer
const outer = sequencer({ name: "outer", inputSchema })
  .then(preprocess)
  .then(coordinator({ name: "parallel-work", worker: taskWorker }))
  .then(postprocess);
```

## See also

- [Supervisor](./supervisor) — same fan-out model, adds a quality review loop
- [Plan and Execute](./plan-and-execute) — sequential dependency-ordered execution
- [Patterns Overview](./overview) — when to use which pattern

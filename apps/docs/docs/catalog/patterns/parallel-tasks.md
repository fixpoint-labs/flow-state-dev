---
title: Parallel Tasks
type: catalog
description: Split a goal once, run the pieces side by side, and combine what comes back.
---

# Parallel Tasks

Some goals break into pieces that don't depend on each other: compare three competitors, review five files, summarize ten documents. `parallelTasks` splits the goal into sub-tasks, runs your worker on each at the same time on a [task board](../../concepts/tasks-and-boards.md) (a stored list of tasks and the loop that works through it), and combines the results. It makes one pass. There is no review and no replanning.

Reach for it when:

- the goal splits into independent pieces,
- you trust the worker's output without review,
- skipping a piece that fails is acceptable.

If each result needs review and revision before it counts, use [Supervisor](./supervisor.md). If tasks depend on each other, use [Plan and Execute](./plan-and-execute.md).

## Use it

The examples below belong to a `research` flow that compares competitors. The worker handles one sub-task. Here it returns a one-item array, so the default combiner can concatenate the results.

```ts title="src/flows/research/blocks/research-competitor.ts"
import { handler } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

export const researchCompetitor = handler({
  name: "research-competitor",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.array(z.object({ competitor: z.string(), summary: z.string() })),
  execute: async (input) => [
    { competitor: input.goal, summary: `Findings for: ${input.goal}` },
  ],
});
```

`input.goal` is the sub-task's text. The pattern block wraps the worker:

```ts title="src/flows/research/blocks/research.ts"
import { parallelTasks } from "@flow-state-dev/patterns";
import { researchCompetitor } from "./research-competitor";

export const research = parallelTasks({
  name: "research",
  worker: researchCompetitor,
  maxConcurrency: 5,
});
```

`parallelTasks` returns a sequencer, so a flow uses it like any other block. Its input is `{ goal: string }`, the same shape `parallelTasksInputSchema` describes:

```ts title="src/flows/research/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";
import { research } from "./blocks/research";

export const researchFlow = defineFlow({
  kind: "research",
  requireUser: true,
  actions: {
    research: {
      inputSchema: z.object({ goal: z.string() }),
      block: research,
      userMessage: (input) => input.goal,
    },
  },
  session: {
    stateSchema: z.object({}),
  },
});
```

Besides `name`, only `worker` is required. `maxConcurrency` (default 3) sets how many sub-tasks run at once. Every other option is in the [patterns reference](../../reference/patterns.md).

## What comes back

The default combiner merges the workers' outputs without a model call and returns `{ combined, mergeNotes? }`. When every output is an array, as above, `combined` is them concatenated with duplicates removed:

```text
{
  combined: [
    { competitor: "Acme", summary: "Findings for: Acme" },
    { competitor: "Globex", summary: "Findings for: Globex" },
  ],
}
```

Workers that return plain objects get merged key by key instead, and `mergeNotes` records each conflict. If no sub-task completes, `combined` is an empty array. A custom synthesizer's output is the block's output as it is, with no `combined` wrapper.

## Your own planner

The default planner is a model call that splits the goal into sub-tasks. Replace it when the goal needs domain knowledge to split well. A planner takes `{ goal: string }` and returns `{ tasks: [{ goal: string }] }`:

```ts title="src/flows/research/blocks/plan-competitors.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

export const planCompetitors = generator({
  name: "plan-competitors",
  model: "openai/gpt-6-luna",
  outputSchema: z.object({
    tasks: z.array(z.object({ goal: z.string() })),
  }),
  prompt: "Name each competitor in the request. Return one task per competitor.",
  user: (input: { goal: string }) => input.goal,
});
```

In `research.ts`, add `planner: planCompetitors` to the config. The [patterns reference](../../reference/patterns.md) has the full planner contract.

## Your own synthesizer

A synthesizer receives an array of the completed workers' outputs, and only those. It doesn't see the goal or which tasks failed. To combine with a model, pass a `generator`:

```ts title="src/flows/research/blocks/write-comparison.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

export const writeComparison = generator({
  name: "write-comparison",
  model: "openai/gpt-6-luna",
  outputSchema: z.object({ report: z.string() }),
  prompt: "Combine the competitor summaries into one comparison.",
  user: (results: unknown[]) => JSON.stringify(results, null, 2),
});
```

In `research.ts`, add `synthesizer: writeComparison` to the config.

## When a sub-task fails

By default a failed sub-task is left out and the rest carry on. The synthesizer gets the outputs that succeeded, and nothing in the result says which task was skipped. Set `onSubTaskError: "fail"` and the first failure fails the whole block instead, with no partial result.

A failed sub-task runs again only when the planner gives its task a `maxAttempts`. The error then reaches the worker as `feedback` on the next attempt. The default planner sets none, so by default a sub-task runs once. The retry bounds are in the [task board reference](../../reference/task-board.md), and the `onSubTaskError` values are in the [patterns reference](../../reference/patterns.md).

## Use it inside a larger sequencer

As a step in another sequencer, `parallelTasks` needs the step before it to output `{ goal: string }`. Give each instance its own `name`: two blocks with the same name in one request share one task list.

## See also

- [Supervisor](./supervisor.md): the same fan-out with a quality review on each result
- [Plan and Execute](./plan-and-execute.md): sub-tasks that run in dependency order
- [GoalSeekLoop](./goal-seek-loop.md): the same plan, run and combine steps, repeated until a goal is met
- [Patterns overview](./index.md): which pattern to use when

---
title: Plan and Execute
type: catalog
description: Plan a task graph, work through it, and replan with what came back.
---

# Plan and Execute

Some goals are a list where later items need earlier results. Research two competitors, then write the comparison. The comparison can't start until the research is in, and if one competitor's research fails, you want the run to finish and tell you what failed and what it skipped, rather than stop. `planAndExecute` asks a model to break the goal into tasks, each naming the tasks it depends on. It works through them on a [task board](../../concepts/tasks-and-boards.md) (a stored list of tasks and the loop that works through it), in dependency order, and writes the final answer from what came back. It can also replan the remaining tasks as results arrive.

Reach for it when:

- tasks depend on each other's results,
- you want to see each task's status as it runs,
- the plan should be able to change when a step fails or turns up something new.

If the tasks are independent, use [Parallel Tasks](./parallel-tasks.md). If each result needs review before it counts, use [Supervisor](./supervisor.md).

## Install it

```bash
pnpm add @flow-state-dev/patterns
```

## Use it

The examples belong to a `research` flow that compares competitors. The pattern needs only a name:

```ts title="src/flows/research/blocks/research.ts"
import { planAndExecute } from "@flow-state-dev/patterns";

export const research = planAndExecute({
  name: "research",
});
```

`planAndExecute` returns a sequencer, so a flow uses it like any other block. Its input is `{ goal: string }`, the shape `planAndExecuteInputSchema` describes:

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

Send it "Compare Acme and Globex for a procurement review." The planner might return three tasks: one research task per company, then a comparison that depends on both. The tasks run one at a time by default. Set `maxConcurrency` to run independent tasks side by side.

The plan lasts for one action run. The final answer is the action's result, and the default answer also joins the conversation history.

## What comes back

By default the result is text: a final answer written from every completed task, answering the goal in full. To get the task results themselves, pass `synthesizer: false`:

```ts title="src/flows/research/blocks/research.ts"
import { planAndExecute } from "@flow-state-dev/patterns";

export const research = planAndExecute({
  name: "research",
  synthesizer: false,
});
```

The result is then the plan:

```text
{
  goal: "Compare Acme and Globex for a procurement review.",
  status: "completed",
  tasks: [
    { id: "acme", goal: "Research Acme", status: "completed", result: { ... } },
    { id: "globex", goal: "Research Globex", status: "failed", error: "No public pricing found" },
    { id: "compare", goal: "Write the comparison", status: "skipped" },
  ],
  completedSteps: 1,
  totalSteps: 3,
}
```

A task is `pending`, `in-progress`, `completed`, `failed` or `skipped`. The [patterns reference](../../reference/patterns.md) has the full shape. To shape the answer yourself, replace the synthesizer with a block of your own, shown below.

## When a step fails

A step fails when its executor throws, or returns `success: false`. Every pending task that depends on it, directly or through a chain, is skipped and never runs. Tasks that don't depend on it carry on. The run doesn't error: it finishes, and the plan lists which tasks failed and which were skipped. The default answer is written from the tasks that completed and may not mention the failures, so to see them in the result, pass `synthesizer: false` or a synthesizer of your own.

If every step fails, the default synthesizer runs anyway. It answers the goal from the model's own knowledge and doesn't mention the failed plan.

To retry a failing task before it counts as failed, raise `maxAttemptsPerTask`, the total number of attempts per task (default 1, so no retries). The cascade rules and retry bounds are in the [task board reference](../../reference/task-board.md).

## When does it replan?

By default it doesn't. The run is one pass: plan, work every task, synthesize.

Set `enableReplanning: true` and a model judges the plan after each pass through the board. A pass works through every task that can run, then the judge answers `continue`, `replan` or `complete`. On `replan`, a replanner returns new tasks, they join the same board, and the board runs again.

```ts title="src/flows/research/blocks/research.ts"
import { planAndExecute } from "@flow-state-dev/patterns";

export const research = planAndExecute({
  name: "research",
  enableReplanning: true,
  maxIterations: 3,
});
```

`maxIterations` (default 3) caps the passes. At the cap the run completes with what it has. A custom `evaluator` or `replanner` block replaces either model call. Their shapes are in the [patterns reference](../../reference/patterns.md).

## Where the goal comes from

The goal is the `goal` string the action receives. The pattern doesn't read the chat for you. A follow-up such as "add Initech too" is planned as that literal text.

Set `synthesizeGoal: true` and a model first rewrites the request into a self-contained goal, using the last eight items of conversation history. It is asked to keep every concrete value, but it is a model's rewrite, so it isn't guaranteed to. "Add Initech too" becomes "Compare Acme, Globex and Initech for a procurement review." The planner, replanner and synthesizer all work from the rewritten goal. If the rewrite fails, the run uses the original goal.

## Your own step executor

The step executor runs each task. The default is a generator that returns `{ summary, success, reason?, sources? }`. Any block works instead: a handler, a generator, a sequencer, or another pattern.

```ts title="src/flows/research/blocks/research-step.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const researchStep = handler({
  name: "research-step",
  inputSchema: z.object({
    stepId: z.string(),
    goal: z.string(),
    context: z.string().optional(),
    dependencyResults: z.record(z.unknown()).optional(),
  }),
  outputSchema: z.object({
    summary: z.string(),
    success: z.boolean(),
    reason: z.string().optional(),
  }),
  execute: async (input) => {
    if (!input.context) {
      return { summary: "", success: false, reason: "No request to work from" };
    }
    return { summary: `Findings for: ${input.goal}`, success: true };
  },
});
```

`dependencyResults` holds the output of each completed task this one depends on, keyed by task id. It's absent when the task has no dependencies. Returning `success: false` fails the task, and `reason` becomes its error.

In `research.ts`, add `stepExecutor: researchStep` to the config.

## What each task knows

A task sees only itself and its dependencies. The original request, with its values and constraints, reaches a task through its `context` field. By default the pattern copies the goal into the `context` of every task the planner left without one. A `context` the planner wrote is kept.

Set `taskContext: false` to leave tasks with only what the planner wrote. Pass a block to fill every task's `context` from the whole plan in one call, so each task gets only the slice it needs. That block runs on the first plan only; replanned tasks get the goal copied in. The options are in the [patterns reference](../../reference/patterns.md).

## Your own synthesizer

The default answer is text. To get a structured one, pass a block that takes the plan and returns any shape:

```ts title="src/flows/research/blocks/write-report.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

export const writeReport = generator({
  name: "write-report",
  model: "openai/gpt-6-luna",
  outputSchema: z.object({
    executiveSummary: z.string(),
    sections: z.array(z.object({ title: z.string(), content: z.string() })),
  }),
  prompt: "You are a report writer. Structure the research findings into a formal report.",
  user: (plan: { goal: string; tasks: unknown[] }) => JSON.stringify(plan),
});
```

In `research.ts`, add `synthesizer: writeReport` to the config. Setting `outputSchema` on `planAndExecute` itself does not change the answer's shape.

## What it gets you

- **Order is kept.** The comparison runs after the research it needs and receives each result.
- **A failure costs one branch.** Tasks that depend on the failed one are skipped. The rest finish.
- **The plan can change.** With replanning on, a surprising result can add tasks instead of ending the run.
- **Progress is visible.** The pattern streams each task's status as it changes. Install the `TaskPlan` view with `fsdev ui add task-plan` and render `<TaskPlan collectionId="research" items={session.items} />` to show it live. `collectionId` is the `name` you gave `planAndExecute`, and `items` is the session's items, from `useSession`. Without `items` it reads them from a `SessionItemsProvider` above it, and with neither it draws an empty board. The item shapes are in the [items reference](../../reference/items.md).

## Next

- [Patterns reference](../../reference/patterns.md): every `planAndExecute` option, the exported schemas and the output shapes.
- [Task board reference](../../reference/task-board.md): cascade rules, retry and task bounds, and the factories for building your own composition.
- [Parallel Tasks](./parallel-tasks.md): the same board with no dependencies and a single pass.
- [Supervisor](./supervisor.md): a reviewer on every result, with retries when it rejects.

---
sidebar_position: 6
---

# Plan and Execute

Plan and Execute is a two-phase agentic architecture. In the planning phase, an LLM decomposes the goal into a dependency-ordered task graph. In the execution phase, it works through tasks one at a time — respecting dependencies, handling failures with cascade-skipping, and optionally replanning remaining tasks after each step.

Use it when:
- Tasks depend on each other's results (A must complete before B starts)
- You need step-by-step progress tracking with per-task status
- You want adaptive replanning when earlier steps fail or need adjustment

If tasks are independent and can run in parallel, use [Coordinator](./coordinator) or [Supervisor](./supervisor) instead.

## Block composition

```
goal
  → captureAndPlan          (store goal, run planner, save task graph to state)
  → doUntil(complete):
      → findTask            (select next eligible pending task)
      → stepExecutor        (execute the task)
      → recordResult        (write result to state, cascade-skip if failed)
      → evaluator           (decide: continue | replan | complete)
      → [replanner]         (if replan decision)
      → [applyReplan]       (update pending tasks in state)
  → .map(planState)         (extract completed plan from sequencer state)
  → [synthesizer]           (combine task results into final answer)
```

Plan state lives entirely on the sequencer — no session resource registration is needed. The pattern self-contains its state management.

## Basic usage

```ts
import { planAndExecute } from "@flow-state-dev/patterns";

const research = planAndExecute({
  name: "research",
});
```

That's the minimal form. The default planner, executor, evaluator, and synthesizer all have reasonable defaults. Use it in a flow:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";

const flow = defineFlow({
  kind: "research",
  requireUser: true,
  actions: {
    research: {
      inputSchema: z.object({ goal: z.string() }),
      block: research,
      userMessage: (input) => input.goal,
    },
  },
  session: { stateSchema: z.object({}) },
});
```

## Input schema

```ts
{ goal: string }
```

Exported as `planAndExecuteInputSchema`:

```ts
import { planAndExecuteInputSchema } from "@flow-state-dev/patterns";
```

## Task lifecycle

Each task moves through this status sequence:

| Status | Meaning |
|--------|---------|
| `pending` | Queued, waiting for dependencies to complete |
| `in-progress` | Currently executing |
| `completed` | Finished successfully |
| `failed` | Threw an error or returned `{ success: false }` |
| `skipped` | Bypassed because a dependency failed |

When a task fails, the pattern automatically cascade-skips all tasks that depend on it (directly or transitively). This prevents the evaluator from looping indefinitely on permanently blocked tasks and gives the UI a clear signal to render them differently.

These statuses are intentionally different from Supervisor's quality-gate statuses (`needs-revision`, `escalated`) — they model a different lifecycle. Don't conflate them.

## Step executor output

The default executor returns:

```ts
{
  summary: string;
  success: boolean;
  reason?: string;    // set if success is false
  sources?: Array<{ title?: string; url: string }>;
}
```

A result with `success: false` marks the task as failed (and triggers cascade-skip on dependents). Throwing from the executor has the same effect and is caught by a rescue handler.

When you provide a custom `stepExecutor`, the executor receives:

```ts
{
  stepId: string;
  goal: string;
  dependencyResults?: Record<string, unknown>; // keyed by dependency task ID
}
```

`dependencyResults` contains the results of all completed tasks that the current task depends on, so you can build on prior work.

## Config reference

```ts
planAndExecute({
  name: string;

  // Planning generator — produces initial task graph.
  // Default: utility.decomposer() with { id, goal, deps?, priority? } output.
  planner?: BlockDefinition;

  // Executes each step.
  // Receives { stepId, goal, dependencyResults? }.
  // Default: a research generator that returns { summary, success, reason?, sources? }.
  stepExecutor?: BlockDefinition;

  // Evaluator — decides continue/replan/complete after each step.
  // Default: createTaskEvaluator (no LLM call, uses pure task state logic).
  evaluator?: BlockDefinition;

  // Replanner — adjusts remaining tasks based on current results.
  // Default: a generator with replan prompt.
  replanner?: BlockDefinition;

  // Max replanning iterations before forced completion. Default: 3.
  maxIterations?: number;

  // Enable LLM-based replanning. When false, uses a deterministic evaluator.
  // Default: false.
  enableReplanning?: boolean;

  // Final synthesis step. Receives the completed plan shape and produces
  // the final result. Pass false to skip synthesis and return the raw plan.
  // Default: a generator that integrates task findings into a coherent answer.
  synthesizer?: BlockDefinition | false;

  // Output schema for the synthesized result.
  outputSchema?: ZodSchema;

  // Model ID for default planner, executor, replanner, and synthesizer.
  // Default: "openai/gpt-5.4-mini"
  model?: string;

  // Context slot applied to all default blocks.
  context?: GeneratorSlot;

  // Tools assigned to default blocks (executor, replanner, synthesizer).
  tools?: GeneratorTool[] | ((ctx) => GeneratorTool[]);

  // Web search — applied to default executor.
  search?: boolean | GeneratorSearchConfig;

  // Appended to the default executor's system prompt.
  executionInstructions?: string;

  // Appended to the default synthesizer's system prompt.
  synthesizeInstructions?: string;

  // Resources to declare on the outer sequencer.
  sessionResources?: Record<string, any>;
  userResources?: Record<string, any>;
  projectResources?: Record<string, any>;

  // Identity for the internal planner generator. Default: "sub".
  // The default planner is a utility decomposer that does not currently
  // accept agentType; this knob applies when a custom `planner` is supplied.
  plannerAgentType?: "primary" | "sub" | "trace";

  // Identity for the internal step executor generator. Default: "sub" —
  // executor chatter stays out of the orchestrator's conversation history.
  stepExecutorAgentType?: "primary" | "sub" | "trace";

  // Identity for the final synthesizer generator. Default: "primary" —
  // synthesis is the user-facing answer for the plan.
  synthesizerAgentType?: "primary" | "sub" | "trace";
});
```

## Exported schemas and types

```ts
import {
  planAndExecute,
  planAndExecuteInputSchema,
  planAndExecuteStateSchema,
  PlanSchema,
  PlanTaskSchema,
  PlanStepSchema,   // backward-compat alias for PlanTaskSchema
  iterationOutputSchema,
} from "@flow-state-dev/patterns";

import type {
  PlanAndExecuteConfig,
  PlanAndExecuteInput,
  PlanAndExecuteState,
  Plan,
  PlanTask,
  PlanStep,         // backward-compat alias for PlanTask
  IterationOutput,
} from "@flow-state-dev/patterns";
```

## Exported internal block factories

These are exported so you can build custom plan-and-execute compositions:

```ts
import {
  selectNextStep,       // createSelectNextStep — selects next eligible task
  recordStepResult,     // createRecordResult — writes result to sequencer state
  evaluatePlanProgress, // createEvaluateProgress — evaluates progress, returns decision
  createTaskEvaluator,  // deterministic evaluator (no LLM)
  createLLMEvaluator,   // LLM-based evaluator (with replan support)
} from "@flow-state-dev/patterns";
```

Use these when you want the core task-tracking machinery but with custom orchestration around it.

## Composability

Plan and Execute is a sequencer, so it composes with other sequencer steps.

### Sequential chaining

Run two independent planning phases back to back:

```ts
import { sequencer } from "@flow-state-dev/core";
import { planAndExecute } from "@flow-state-dev/patterns";
import { z } from "zod";

const pipeline = sequencer({
  name: "full-pipeline",
  inputSchema: z.object({ goal: z.string() }),
})
  .then(planAndExecute({ name: "research", synthesizer: false }))
  .map((plan) => ({
    // transform research output into writing goal
    goal: `Write a report based on: ${plan.tasks.map((t) => t.result?.summary).join("; ")}`,
  }))
  .then(planAndExecute({ name: "writing" }));
```

### Parallel goals

Use `.forEach` to run independent goals in parallel, each with its own plan:

```ts
import { sequencer } from "@flow-state-dev/core";
import { planAndExecute } from "@flow-state-dev/patterns";
import { z } from "zod";

const parallelResearch = sequencer({
  name: "parallel-research",
  inputSchema: z.object({ topics: z.array(z.string()) }),
})
  .map((input) => input.topics.map((topic) => ({ goal: topic })))
  .forEach(planAndExecute({ name: "topic-research" }));
```

### Hierarchical nesting

Use Supervisor as the `stepExecutor` for plans where each step needs quality review:

```ts
import { planAndExecute, supervisor } from "@flow-state-dev/patterns";

const hierarchical = planAndExecute({
  name: "complex-research",
  stepExecutor: supervisor({
    name: "step-supervisor",
    worker: deepResearchWorker,
    reviewCriteria: ["Comprehensive", "Well-sourced"],
  }),
  synthesizer: false,
});
```

## Custom synthesizer

The default synthesizer integrates task findings into a coherent narrative. Swap it out for domain-specific formatting:

```ts
import { planAndExecute } from "@flow-state-dev/patterns";
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

const customSynthesizer = generator({
  name: "report-writer",
  model: "gpt-5",
  outputSchema: z.object({
    executiveSummary: z.string(),
    sections: z.array(z.object({ title: z.string(), content: z.string() })),
  }),
  prompt: "You are a report writer. Structure the research findings into a formal report.",
  user: (plan) => JSON.stringify(plan),
});

const research = planAndExecute({
  name: "research",
  synthesizer: customSynthesizer,
});
```

Pass `synthesizer: false` to skip synthesis entirely and return the raw plan object. Useful when you're chaining plan-and-execute instances or doing your own post-processing.

## Skipping synthesis

```ts
const research = planAndExecute({
  name: "research",
  synthesizer: false,
  // Output shape:
  // {
  //   goal: string;
  //   status: "planning" | "executing" | "replanning" | "completed" | "failed";
  //   tasks: Array<{ id, goal, status, result?, error? }>;
  //   completedSteps: number;
  //   totalSteps: number;
  // }
});
```

## Plan snapshots

The pattern emits plan snapshots into the chat stream at key moments (plan created, task completed, task failed). These are `ComponentItem` values with `component: "plan"`. If your renderer registers a `"plan"` component, it can display live plan progress.

The snapshot shape matches `BasePlanSchema` from `@flow-state-dev/patterns`:

```ts
import { BasePlanSchema, BasePlanTaskSchema } from "@flow-state-dev/patterns";
import type { BasePlan, BasePlanTask } from "@flow-state-dev/patterns";
```

## See also

- [Coordinator](./coordinator) — parallel execution, no dependencies, single pass
- [Supervisor](./supervisor) — parallel execution with quality review loop
- [Patterns Overview](./overview) — when to use which pattern

---
sidebar_position: 5
---

# Supervisor

The Supervisor is a fan-out pattern with a quality review loop. It decomposes a goal into sub-tasks, dispatches workers, reviews each result, replans the tasks that need revision, and repeats until all results pass review or the iteration limit is hit.

Use it when:
- Output quality matters and failures should be corrected, not just skipped
- You need a review step that can send individual tasks back for revision
- You want to escalate tasks the reviewer deems out of scope

If you just need parallel execution without review, use [Coordinator](./coordinator). If tasks depend on each other's results and need strictly sequential execution with replanning, use [Plan and Execute](./plan-and-execute). The supervisor also supports task dependencies via `deps` — dependent tasks are held back until their prerequisites complete — but executes independent tasks concurrently rather than one at a time.

## Block composition

```
goal
  → captureGoal             (store goal in sequencer state)
  → planner                 (decompose into tasks)
  → updatePlanState         (write plan to sequencer state)
  → .forEach(worker)        (dispatch concurrently)
  → reviewer                (evaluate each result)
  → applyReview             (write verdicts to state)
  → .loopBack(planner)      (replan if needsReplanning=true)
  → .map(acceptedResults)   (extract accepted results from state)
  → synthesizer             (combine into final output)
```

The `captureGoal`, `updatePlanState`, and `applyReview` blocks are exported — you can use them in custom compositions.

## Basic usage

```ts
import { supervisor } from "@flow-state-dev/patterns";
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

const researchWorker = generator({
  name: "research-task",
  model: "gpt-5-mini",
  inputSchema: z.object({
    id: z.string(),
    goal: z.string(),
    feedback: z.string().optional(),
  }),
  outputSchema: z.object({ summary: z.string(), sources: z.array(z.string()) }),
  prompt: "You are a research assistant. Complete the given task thoroughly.",
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
    "Summary is substantive (not vague)",
    "Addresses the task goal directly",
  ],
  maxIterations: 3,
  maxConcurrency: 4,
});
```

The supervisor returns a sequencer block. Use it in a flow like any other block:

```ts
const flow = defineFlow({
  kind: "research",
  requireUser: true,
  actions: {
    research: {
      inputSchema: z.object({ goal: z.string() }),
      block: researchSupervisor,
      userMessage: (input) => input.goal,
    },
  },
  session: { stateSchema: z.object({}) },
});
```

## Worker input shape

The worker receives an `ExecutableTask` for each sub-task:

```ts
{
  id: string;       // stable task identifier
  goal: string;     // what to accomplish
  feedback?: string; // reviewer feedback from prior iteration (if replanning)
}
```

On the first iteration, `feedback` is absent. On subsequent iterations, tasks that received a `"needs-revision"` verdict include the reviewer's feedback so the worker can address it.

## Task dependencies

The planner can declare dependencies between tasks using the `deps` field — an array of task IDs that must complete before a task is dispatched:

```ts
{
  tasks: [
    { id: "gather", goal: "Collect raw data from API" },
    { id: "analyze", goal: "Analyze the collected data", deps: ["gather"] },
    { id: "report", goal: "Write summary report", deps: ["analyze"] },
  ]
}
```

Tasks with unmet dependencies are held back from the worker batch. When a task fails, all tasks that depend on it (directly or transitively) are automatically marked `skipped`.

## Task assignees

The planner can optionally set an `assignee` on each task — a free-form string label that the client can display next to the task in the UI. This is useful when the supervisor coordinates different specialized workers or when you want to surface which capability handles each task:

```ts
{
  tasks: [
    { id: "search", goal: "Search for papers", assignee: "search-agent" },
    { id: "summarize", goal: "Summarize findings", assignee: "writer-agent", deps: ["search"] },
  ]
}
```

The `assignee` field has no effect on routing — all tasks go to the same worker block. It's purely a labeling mechanism for observability.

## Task statuses

Supervisor tasks use a quality-gate vocabulary. These are intentionally different from the step statuses used by Plan and Execute — they model a different kind of lifecycle:

| Status | Meaning |
|--------|---------|
| `in-progress` | Dispatched to the worker, awaiting result |
| `awaiting-review` | Worker finished, waiting for reviewer evaluation |
| `completed` | Accepted by the reviewer |
| `needs-revision` | Reviewer returned it for rework |
| `escalated` | Reviewer flagged it as out of scope |
| `failed` | Worker threw or returned an error |
| `skipped` | Skipped due to a failed dependency |

Tasks update atomically as each worker completes — the plan snapshot updates per-task rather than waiting for the entire batch to finish. This means the client sees live progress during concurrent execution.

The `needs-revision` status feeds directly into the replan loop: tasks with this status are replanned and redispatched on the next iteration.

## Config reference

```ts
supervisor({
  name: string;

  // Worker block — receives ExecutableTask, returns any result.
  worker: BlockDefinition;

  // Strings the reviewer uses as evaluation criteria.
  // Included verbatim in the reviewer's system prompt.
  reviewCriteria?: string[];

  // Max plan/dispatch/review iterations. Default: 3.
  maxIterations?: number;

  // Max concurrent sub-tasks. Default: 3.
  maxConcurrency?: number;

  // Override the planning step.
  // Must output { tasks: Array<{ id: string; goal: string; assignee?: string; deps?: string[]; priority?: string }> }
  // Default: a supervisor-aware decomposer generator.
  planner?: BlockDefinition;

  // Override the review step.
  // Must output reviewOutputSchema (assessments + needsReplanning).
  // Default: a review generator.
  reviewer?: BlockDefinition;

  // Override the final synthesis step.
  // Receives unknown[] (the accepted results array).
  // Default: utility.synthesizer()
  synthesizer?: BlockDefinition;

  // How to handle worker failures:
  //   "skip"  — exclude failed tasks from review (default)
  //   "fail"  — abort on any failure
  //   "retry" — retry per worker's retry policy
  onSubTaskError?: "skip" | "fail" | "retry";

  // Output schema for the final synthesized result.
  // Passed through to the synthesizer block.
  outputSchema?: ZodSchema;

  // Identity assigned to the internal reviewer generator.
  // Default: "sub". Override to "primary" if the reviewer's output
  // should appear in the top-level conversation stream.
  reviewerAgentType?: "primary" | "sub" | "trace";

  // Identity assigned to the internal synthesizer generator.
  // Default: "primary" — synthesis is the user-facing final answer.
  synthesizerAgentType?: "primary" | "sub" | "trace";
});
```

## Exported API

```ts
import {
  supervisor,           // factory function
  supervisorInputSchema,  // z.object({ goal: z.string() })
  supervisorStateSchema,  // full sequencer state schema
  reviewOutputSchema,     // schema for reviewer output
  plannerOutputSchema,    // schema for planner output

  // Internal blocks — re-export for custom compositions
  captureGoal,          // stores goal in sequencer state
  updatePlanState,      // writes planner output to sequencer state
  applyReview,          // applies reviewer verdicts to state
} from "@flow-state-dev/patterns";

import type {
  SupervisorConfig,
  SupervisorState,
  ReviewOutput,
  PlannerOutput,
  ExecutableTask,
  SubTaskErrorStrategy,
} from "@flow-state-dev/patterns";
```

## Custom planner

The default planner understands the supervisor's state structure — on first iteration it decomposes the goal, on subsequent iterations it replans only the tasks marked `needs-revision`. If you provide a custom planner, it receives the current sequencer state and should do the same.

```ts
import { supervisor } from "@flow-state-dev/patterns";
import { generator } from "@flow-state-dev/core";
import { plannerOutputSchema } from "@flow-state-dev/patterns";
import { z } from "zod";

const legalPlanner = generator({
  name: "legal-planner",
  model: "gpt-5",
  outputSchema: plannerOutputSchema,
  prompt: "You are a legal research task planner. Decompose legal questions into discrete research tasks.",
  user: (input) => input.goal,
});

const legalSupervisor = supervisor({
  name: "legal-research",
  worker: legalWorker,
  planner: legalPlanner,
});
```

## Custom reviewer

The reviewer receives all worker results and must output `reviewOutputSchema`. If you swap in a custom reviewer, make sure its output matches:

```ts
{
  assessments: Array<{
    taskId: string;
    verdict: "accepted" | "needs-revision" | "escalate";
    feedback: string;
    score: number; // 0–1
  }>;
  needsReplanning: boolean;
  overallAssessment: string;
}
```

Set `needsReplanning: true` if any task received `"needs-revision"` and the loop should continue.

## Composability with Plan and Execute

For complex hierarchical work, you can use Supervisor as the `stepExecutor` inside Plan and Execute:

```ts
import { planAndExecute } from "@flow-state-dev/patterns";
import { supervisor } from "@flow-state-dev/patterns";

// Each step in the plan is itself supervised
const hierarchicalPlan = planAndExecute({
  name: "complex-research",
  stepExecutor: supervisor({
    name: "step-supervisor",
    worker: deepResearchWorker,
    reviewCriteria: ["Comprehensive", "Well-sourced"],
  }),
});
```

This gives you sequential dependency ordering at the outer level and quality-reviewed parallel execution within each step.

## See also

- [Coordinator](./coordinator) — same fan-out model, no review loop
- [Plan and Execute](./plan-and-execute) — sequential dependency-ordered execution
- [Patterns Overview](./overview) — when to use which pattern

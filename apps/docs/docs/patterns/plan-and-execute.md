---
sidebar_position: 6
---

# Plan and Execute

Plan and Execute is a two-phase agentic architecture. In the planning phase, an LLM decomposes the goal into a dependency-ordered task graph. In the execution phase, it works through tasks one at a time — respecting dependencies, handling failures with cascade-skipping, and optionally replanning remaining tasks after each step.

Use it when:
- Tasks depend on each other's results (A must complete before B starts)
- You need step-by-step progress tracking with per-task status
- You want adaptive replanning when earlier steps fail or need adjustment

If tasks are independent and can run in parallel, use [Parallel Tasks](./parallelTasks) or [Supervisor](./supervisor) instead.

## Block composition

```
goal
  → captureAndPlan          (store goal, run planner, seed taskBoard collection)
  → board.block             (drain — workers process tasks until idle)   ←┐ loopBack target
  → cascadeSkipDependents   (cancel pendings whose deps errored)            │
  → evaluator               (decide: continue | replan | complete)         │
  → [replanner]             (only when replan + no inline tasks)            │
  → [applyReplan]           (add new tasks to the collection)               │
  → loopBack(when: decision !== "complete") ────────────────────────────────┘
  → synthesize              (build legacy plan output, then run synthesizer)
```

Plan tasks live on a request-scoped `TaskCollection` so the same collection survives across multiple `board.block` re-entries inside the replan loop. The outer sequencer state is minimal — `{ goal, status?, iteration }` — with the substrate's `task-change` and `task-board-meta` items as the source of truth for per-task progress.

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

The pattern's public output preserves the legacy P&E status vocabulary so existing consumers keep working:

| Output status | Meaning | Substrate equivalent |
|--------|---------|---------|
| `pending` | Queued, waiting for dependencies | `pending` |
| `in-progress` | Currently executing | `in_progress` |
| `completed` | Finished successfully | `completed` |
| `failed` | Threw an error or returned `{ success: false }` | `errored` |
| `skipped` | Bypassed because a dependency failed | `cancelled` + `label: "skipped"` |

Internally tasks are full substrate `Task` records — every transition emits a `task-change` component item on the stream so renderers see live state without polling. The `<TaskPlan />` renderer subscribes to `task-change` per task and `task-board-meta` for board-level progress; both items are emitted by the pattern out of the box.

When a task errors, `cascadeSkipDependents` runs after the drain and cancels any pending task whose deps include the failed one (transitively). This prevents the evaluator from looping indefinitely on permanently blocked tasks.

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
  context?: string;  // per-task support text (see "Per-task context" below)
  dependencyResults?: Record<string, unknown>; // keyed by dependency task ID
}
```

`dependencyResults` contains the results of all completed tasks that the current task depends on, so you can build on prior work. `context` carries the per-task support text the planner (or the context enricher) attached to this task.

## Per-task context

A worker only ever sees its own task. By default the planner writes a short instruction into each task's `goal`, but the original request — the actual values, lists, and constraints a task needs — never reaches the worker unless the planner happens to copy them into that one string. At any real scale it doesn't. (Paste 25 subdomains and ask for info on each, and you get tasks like "research the listed subdomains" with no subdomains attached.)

Each task carries a `context` field for exactly this: readable support text the worker renders into its prompt. There are three ways it gets filled, controlled by `taskContext`:

```ts
// Default. Copy the goal into every task that the planner left without
// context. Free (no extra model call) and deterministic.
planAndExecute({ name: "research", taskContext: "goal" });

// Opt out — tasks get only the context the planner emitted, if any.
planAndExecute({ name: "research", taskContext: false });

// Custom enricher — run once over the whole plan to fill per-task context.
// Receives { goal, tasks } and returns { tasks } with context filled.
planAndExecute({ name: "research", taskContext: myEnricherBlock });
```

In the default `"goal"` mode a planner-emitted `context` always wins — only the gaps are filled. A custom `BlockDefinition` enricher instead receives the full plan (tasks include any planner context) and owns the contexts it returns; it isn't post-filtered, so preserve planner context in your block if you want that. The tradeoff: `"goal"` is simple but copies the same text into every task (more tokens, no extra call), while a `BlockDefinition` enricher can hand each task only the slice it needs — at the cost of one model call over the plan. The decomposer is also prompted to fill `context` with the concrete facts a task needs, so on a good plan the enricher has little left to do.

Replan-added tasks get the same treatment: unless `taskContext` is `false`, a replanned task without context has the goal copied in on re-seed, so workers after a replan aren't blind to the request. (The replanner's own output schema stays `{ id, goal, deps }`; a custom enricher applies to the initial plan and the replan path falls back to the goal copy.)

## Synthesizing the goal from conversation

When a request depends on earlier conversation ("now do that for all of them"), the literal latest message is a poor goal to plan, replan, and synthesize against. `synthesizeGoal` rewrites it into a self-contained objective before planning:

```ts
planAndExecute({ name: "research", synthesizeGoal: true });
```

This runs a history-aware generator that resolves references against the conversation and preserves the concrete facts. The rewritten goal flows to the planner and into the pipeline state the replanner and synthesizer read, so all three reason about the same coherent objective. It's off by default (the input goal is used verbatim). Synthesis is an enhancement, not a correctness gate — if the model call fails, the run falls back to the original goal and continues. Pass a `BlockDefinition` instead of `true` to supply your own synthesizer (it must return `{ ...input, goal }`).

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

  // Per-task retry budget stamped onto every seeded TaskInit. Default 1
  // (no retries; preserves pre-migration behavior).
  maxAttemptsPerTask?: number;

  // Worker pool size for the underlying taskBoard. Default 1 (sequential
  // drain). Bump to fan out independent dep-free steps within a single
  // drain.
  maxConcurrency?: number;

  // How each task's `context` is populated when the planner didn't supply
  // one. "goal" (default): copy the goal into every gap-task. false: leave
  // empty. BlockDefinition: run once over { goal, tasks } to fill per-task
  // context. See "Per-task context".
  taskContext?: "goal" | false | BlockDefinition;

  // Synthesize a self-contained goal from conversation before planning.
  // false (default): use the input goal verbatim. true: built-in
  // history-aware synthesizer. BlockDefinition: custom synthesizer.
  // See "Synthesizing the goal from conversation".
  synthesizeGoal?: boolean | BlockDefinition;

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
  orgResources?: Record<string, any>;

  // Visibility for the internal planner generator. Default: { client: true, history: false }.
  // The default planner is a utility decomposer that does not currently
  // accept itemVisibility; this knob applies when a custom `planner` is supplied.
  plannerVisibility?: { client: boolean; history: boolean };

  // Visibility for the internal step executor generator. Default: { client: true, history: false } —
  // executor chatter stays out of the orchestrator's conversation history.
  stepExecutorVisibility?: { client: boolean; history: boolean };

  // Visibility for the final synthesizer generator. Default: { client: true, history: true } —
  // synthesis is the user-facing answer for the plan.
  synthesizerVisibility?: { client: boolean; history: boolean };
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

These are exported so you can build custom plan-and-execute compositions on top of the substrate:

```ts
import {
  evaluatePlanProgress,         // createEvaluateProgress — evaluator block factory
  createTaskEvaluator,          // deterministic evaluator (no LLM)
  createLLMEvaluator,           // LLM-based evaluator
  createCaptureAndPlan,         // entry sequencer (set state, plan, seed collection)
  createApplyReplan,            // adds replanner output to the collection
  createCascadeSkipDependents,  // cancels pendings blocked on errored deps
  createSynthesize,             // builds the legacy plan output + optional synthesizer
  createBuildPlanOutput,        // just the substrate→legacy translation
  normalizeOutputStatus,        // substrate status → legacy status helper
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
  .step(planAndExecute({ name: "research", synthesizer: false }))
  .map((plan) => ({
    // transform research output into writing goal
    goal: `Write a report based on: ${plan.tasks.map((t) => t.result?.summary).join("; ")}`,
  }))
  .step(planAndExecute({ name: "writing" }));
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

## Sharing context across iterations

Each step in a plan runs as its own worker generator. By default that worker has no awareness of what previous steps already looked up or tried — only its declared `deps` and the materialized `dependencyResults` shape get plumbed through. For a plan whose later steps refine or build on earlier ones, that's often too narrow.

Plan and Execute pins `flowPolicy.recentTrajectory({ n: 8 })` by default. Each step's worker sees the last eight tool observations the run produced, regardless of which task they came from, on its `priorWork` slot. The evaluator and replanner pick up the same trajectory, which is how they can reason about whether the plan is converging. Override with the `flowPolicy` config slot if you want a different selection (declared-deps-only for stricter isolation, `allCompleted` for an aggregating final pass). See the [Flow policy](./flow-policy) guide for the full list of built-in policies and the cross-task tool-result memoization layer that pairs with them.

## Stream items

The pattern emits two component-item streams renderers can subscribe to:

- `task-change` — one item per task transition, emitted by the substrate `TaskCollection`. Carries the full `Task` snapshot at the moment of the change. The `<TaskPlan />` renderer keys per-task rows on `data.task.id`.
- `task-board-meta` — board-level status, keyed by `data.collectionId`. The substrate emits `active` and `completed`; this pattern adds `planning`, `replanning`, and `synthesizing` at the corresponding phase boundaries so the renderer can show a status header.

Pre-migration the pattern emitted `plan-meta` and `plan-task` items. Those have been removed — the substrate items above carry strictly more information and are keyed identically.

## See also

- [Task Board](./task-board) — the substrate that powers Plan & Execute's task dispatch and replan re-entry
- [Parallel Tasks](./parallelTasks) — parallel execution, no dependencies, single pass
- [Supervisor](./supervisor) — parallel execution with quality review loop
- [Decomposer](./utility-blocks/core) — the default planner, including the `title`/`context` output fields
- [Patterns Overview](./overview) — when to use which pattern

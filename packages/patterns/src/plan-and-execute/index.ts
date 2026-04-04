/**
 * Plan and Execute Pattern
 *
 * Two-phase agentic architecture: a planner LLM generates a structured task
 * plan stored as sequencer state, then an executor works through steps with
 * optional replanning.
 *
 * Pipeline:
 *   [captureAndPlan] → doUntil(complete, [executeNextTask → evaluate → replan?])
 *
 * State lives on the outer sequencer — no session resource registration needed:
 *   planAndExecute({ name, stepExecutor }) works without any defineFlow config.
 *
 * Multi-plan composability via sequencer composition:
 *   - Sequential: .then(planAndExecute({ name: "design" })).then(planAndExecute({ name: "impl" }))
 *   - Parallel: .forEach(planAndExecute({ name: (input) => input.topic }))
 *   - Nested: stepExecutor invokes a sub-planAndExecute
 */
import { sequencer, handler, generator } from "@flow-state-dev/core";
import { utility } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import {
  planAndExecuteInputSchema,
  planAndExecuteStateSchema,
  iterationOutputSchema,
  type PlanTask,
} from "./schemas";
import { createEvaluateProgress } from "./blocks/evaluate-progress";
import { emitPlanSnapshot } from "../shared/plan";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  PlanSchema,
  PlanStepSchema,  // backward compat
  PlanTaskSchema,  // new
  planAndExecuteStateSchema,
  planAndExecuteInputSchema,
  iterationOutputSchema,
} from "./schemas";

export type {
  Plan,
  PlanStep,   // backward compat
  PlanTask,   // new
  PlanAndExecuteState,
  PlanAndExecuteInput,
  IterationOutput,
} from "./schemas";

// Re-export block factories for custom compositions
export { createSelectNextStep as selectNextStep } from "./blocks/select-next-step";
export { createRecordResult as recordStepResult } from "./blocks/record-result";
export {
  createEvaluateProgress as evaluatePlanProgress,
  createTaskEvaluator,
  createLLMEvaluator,
} from "./blocks/evaluate-progress";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PlanAndExecuteConfig<
  TOutputSchema extends ZodTypeAny = ZodTypeAny
> {
  /** Name for this plan-and-execute instance. Required. */
  name: string;

  /** The planning generator — produces the initial plan. Default: utility.decomposer(). */
  planner?: BlockDefinition<any, any>;

  /** How to execute each step — receives { stepId, goal }. Required. */
  stepExecutor: BlockDefinition<any, any>;

  /** Evaluator — decides continue/replan/complete after each step. Default: createTaskEvaluator. */
  evaluator?: BlockDefinition<any, any>;

  /** Replanner — adjusts remaining plan based on results. Default: generator with replan prompt. */
  replanner?: BlockDefinition<any, any>;

  /** Max replanning iterations before forced completion. Default: 3. */
  maxIterations?: number;

  /** Whether to enable replanning. When false, uses createTaskEvaluator (no LLM call). Default: false. */
  enableReplanning?: boolean;

  /** Final synthesis step — receives completed plan output, produces the final result.
   *  When provided, the block's output is whatever the synthesizer produces instead
   *  of the raw plan object. Default: a generator that integrates step findings into
   *  a coherent answer. Pass `false` to disable synthesis and return the plan object. */
  synthesizer?: BlockDefinition<any, any> | false;

  /** Output schema for the final synthesized result. Used by the default synthesizer. */
  outputSchema?: TOutputSchema;

  /** Model ID to use for default planner, replanner, and synthesizer. Default: "openai/gpt-5.4-mini". */
  model?: string;

  /** Session resources to declare on the outer sequencer. Required when the step executor
   *  or synthesizer use tools that access session resources (e.g. artifact collections). */
  sessionResources?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Default replanner
// ---------------------------------------------------------------------------

function createDefaultReplanner(config: {
  name: string;
  model?: string;
}) {
  return generator({
    name: `${config.name}-replanner`,
    model: config.model ?? "openai/gpt-5.4-mini",
    outputSchema: z.object({
      tasks: z.array(z.object({
        id: z.string(),
        goal: z.string(),
        deps: z.array(z.string()).optional(),
        priority: z.enum(["high", "medium", "low"]).optional(),
      })),
    }),
    sequencerStateSchema: planAndExecuteStateSchema,
    search: true,
    prompt: [
      "You are a plan replanner.",
      "Given the current plan state with completed, failed, and pending tasks,",
      "generate an updated list of remaining tasks to achieve the original goal.",
      "Keep completed tasks as-is. Replace or adjust pending/failed tasks as needed.",
      "Each task must have a unique id and clear goal.",
      "Only output the NEW tasks that should replace the current pending tasks.",
    ].join("\n"),
    user: (_input: unknown, ctx) => {
      const plan = ctx.sequencer!.state;
      return JSON.stringify({
        goal: plan.goal,
        completedTasks: plan.tasks
          .filter((s: PlanTask) => s.status === "completed")
          .map((s: PlanTask) => ({ id: s.id, goal: s.goal, result: s.result })),
        failedTasks: plan.tasks
          .filter((s: PlanTask) => s.status === "failed")
          .map((s: PlanTask) => ({ id: s.id, goal: s.goal, error: s.error })),
        pendingTasks: plan.tasks
          .filter((s: PlanTask) => s.status === "pending")
          .map((s: PlanTask) => ({ id: s.id, goal: s.goal })),
      }, null, 2);
    },
  });
}

// ---------------------------------------------------------------------------
// Apply replan
// ---------------------------------------------------------------------------

/**
 * Handler that applies replanner output to sequencer state,
 * replacing pending tasks with the new tasks.
 */
function createApplyReplan(config: { name: string }) {
  return handler({
    name: `${config.name}-apply-replan`,
    inputSchema: z.object({
      tasks: z.array(z.object({
        id: z.string(),
        goal: z.string(),
        deps: z.array(z.string()).optional(),
        priority: z.enum(["high", "medium", "low"]).optional(),
      })),
    }),
    outputSchema: iterationOutputSchema,
    sequencerStateSchema: planAndExecuteStateSchema,

    execute: async (input, ctx) => {
      const state = ctx.sequencer!.state;

      const keptTasks = state.tasks.filter(
        (s: PlanTask) => s.status === "completed" || s.status === "failed" || s.status === "skipped"
      );

      const newTasks = input.tasks.map((task) => ({
        id: task.id,
        goal: task.goal,
        status: "pending" as const,
        dependencies: task.deps ?? [],
      }));

      await ctx.sequencer!.patchState({
        tasks: [...keptTasks, ...newTasks],
        status: "executing",
        iteration: state.iteration + 1,
      });

      return { decision: "continue" as const };
    },
  });
}

// ---------------------------------------------------------------------------
// Default synthesizer
// ---------------------------------------------------------------------------

function createDefaultSynthesizer(config: {
  name: string;
  model?: string;
}) {
  return generator({
    name: `${config.name}-synthesizer`,
    model: config.model ?? "openai/gpt-5.4-mini",
    inputSchema: z.object({
      goal: z.string(),
      status: z.string().optional(),
      tasks: z.array(z.object({
        id: z.string(),
        goal: z.string(),
        status: z.string(),
        result: z.unknown().optional(),
        error: z.string().optional(),
      })),
      completedSteps: z.number(),
      totalSteps: z.number(),
    }),
    outputSchema: z.string(),
    prompt: [
      "You are synthesizing findings from a structured multi-step research process.",
      "Write a clear, direct final answer to the original goal.",
      "Integrate the findings into a coherent narrative — do not just summarize each step.",
      "Be specific and draw on the concrete facts gathered.",
      "If no findings are available, briefly explain that the research could not be completed and why, without asking the user for more information.",
    ].join("\n"),
    user: (input: {
      goal: string;
      completedSteps: number;
      tasks: Array<{ goal: string; status: string; result: unknown; error?: string }>;
    }) => {
      if (input.completedSteps === 0) {
        const failed = input.tasks.filter((t) => t.status === "failed");
        const firstError = failed[0]?.error ?? "unknown error";
        return [
          `Goal: ${input.goal}`,
          ``,
          `No research tasks completed. The plan encountered an error on the first task: ${firstError}`,
          `Downstream tasks were skipped as a result.`,
          `Acknowledge that you were unable to gather findings for this goal and briefly explain why based on the error above.`,
        ].join("\n");
      }

      const allSources: Array<{ title?: string; url: string }> = [];

      const findings = input.tasks
        .filter((t) => t.status === "completed")
        .map((t, i) => {
          const r = t.result as Record<string, unknown> | null | undefined;
          const summary =
            r && typeof r === "object" && "summary" in r
              ? String(r.summary)
              : JSON.stringify(t.result);
          if (r && typeof r === "object" && Array.isArray(r.sources)) {
            allSources.push(...(r.sources as Array<{ title?: string; url: string }>));
          }
          return `${i + 1}. ${t.goal}\n   ${summary}`;
        })
        .join("\n\n");

      const uniqueSources = allSources.filter(
        (s, i, arr) => arr.findIndex((x) => x.url === s.url) === i
      );
      const sourcesSection =
        uniqueSources.length > 0
          ? `\n\nSources:\n${uniqueSources.map((s) => `- ${s.title ? `${s.title}: ` : ""}${s.url}`).join("\n")}`
          : "";

      return `Goal: ${input.goal}\n\nFindings:\n\n${findings}${sourcesSection}`;
    },
    emit: { messages: true },
  });
}

// ---------------------------------------------------------------------------
// Cascade-skip helper
// ---------------------------------------------------------------------------

/**
 * When a task fails, transitively marks all pending tasks that depend on it
 * (directly or indirectly) as "skipped". This prevents the evaluator from
 * seeing permanently-blocked tasks as pending and looping indefinitely, and
 * gives the UI a clear signal to render them differently from unstarted tasks.
 */
function cascadeSkipDependents(tasks: PlanTask[], failedId: string): PlanTask[] {
  const blockedIds = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (task.status === "pending" && !blockedIds.has(task.id)) {
        const blockedByFailed = task.dependencies.some(
          (dep) => dep === failedId || blockedIds.has(dep)
        );
        if (blockedByFailed) {
          blockedIds.add(task.id);
          changed = true;
        }
      }
    }
  }
  if (blockedIds.size === 0) return tasks;
  return tasks.map((t) =>
    blockedIds.has(t.id)
      ? {
          ...t,
          status: "skipped" as const,
          error: `Skipped: dependency '${t.dependencies.find((dep) => dep === failedId || blockedIds.has(dep)) ?? failedId}' failed`,
        }
      : t
  );
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a plan-and-execute block — a sequencer that decomposes a goal into
 * tasks, executes them iteratively with dependency ordering, and optionally
 * replans. Plan state lives on the sequencer — no defineFlow resource
 * registration required.
 */
export function planAndExecute<
  TOutputSchema extends ZodTypeAny = ZodTypeAny
>(config: PlanAndExecuteConfig<TOutputSchema>) {
  const {
    name,
    stepExecutor,
    maxIterations = 3,
    enableReplanning = false,
  } = config;

  const planner = config.planner ?? utility.decomposer({
    name: `${name}-planner`,
    model: config.model,
  });

  const evaluator = config.evaluator ?? createEvaluateProgress({
    name,
    enableReplanning,
    model: config.model,
  });

  const replanner = config.replanner ?? createDefaultReplanner({ name, model: config.model });
  const applyReplan = createApplyReplan({ name });

  const synthesizer =
    config.synthesizer !== false
      ? (config.synthesizer ?? createDefaultSynthesizer({ name, model: config.model }))
      : null;

  // ---------------------------------------------------------------------------
  // captureAndPlan: runs once at the start — stores goal, runs the planner,
  // saves tasks into sequencer state, emits initial snapshot.
  // ---------------------------------------------------------------------------
  const captureAndPlan = handler({
    name: `${name}-plan`,
    inputSchema: planAndExecuteInputSchema,
    outputSchema: z.object({}),
    sequencerStateSchema: planAndExecuteStateSchema,

    execute: async (input, ctx) => {
      await ctx.sequencer!.patchState({
        goal: input.goal,
        maxIterations,
        status: "planning",
      });

      const plannerOutput = await planner.run(input, ctx as any) as {
        tasks: Array<{ id: string; goal: string; deps?: string[] }>;
      };

      const tasks = plannerOutput.tasks.map((task) => ({
        id: task.id,
        goal: task.goal,
        status: "pending" as const,
        dependencies: task.deps ?? [],
      }));

      await ctx.sequencer!.patchState({ tasks, status: "executing" });

      emitPlanSnapshot(
        ctx as any,
        { goal: input.goal, tasks, status: "executing", iteration: 0 },
        { key: name }
      );

      return {};
    },
  });

  // ---------------------------------------------------------------------------
  // findTask: selects the next eligible pending task, marks it in_progress,
  // and returns the input for stepExecutor. Sets currentTaskId in state so
  // recordResult and the error rescue handler know which task to update.
  // This is the loopBack target — it runs at the start of every iteration.
  // ---------------------------------------------------------------------------
  const findTask = handler({
    name: `${name}-execute-step`,
    inputSchema: z.object({
      decision: z.enum(["continue", "replan", "complete"]).optional(),
    }),
    outputSchema: z.union([
      z.object({
        stepId: z.string(),
        goal: z.string(),
        dependencyResults: z.record(z.unknown()).optional(),
      }),
      z.object({ noTask: z.literal(true) }),
    ]),
    sequencerStateSchema: planAndExecuteStateSchema,

    execute: async (_input, ctx) => {
      const state = ctx.sequencer!.state;

      const completedIds = new Set(
        state.tasks
          .filter((s: PlanTask) => s.status === "completed" || s.status === "skipped")
          .map((s: PlanTask) => s.id)
      );

      const nextStep = state.tasks.find((s: PlanTask) => {
        if (s.status !== "pending") return false;
        return s.dependencies.every((dep: string) => completedIds.has(dep));
      });

      if (nextStep === undefined) {
        return { noTask: true as const };
      }

      // Build dependency context for the executor
      const dependencyResults = Object.fromEntries(
        nextStep.dependencies
          .map((depId: string) => state.tasks.find((t: PlanTask) => t.id === depId))
          .filter((t): t is PlanTask => t !== undefined && t.result !== undefined)
          .map((t: PlanTask) => [t.id, t.result])
      );

      await ctx.sequencer!.patchState({
        currentTaskId: nextStep.id,
        tasks: state.tasks.map((s: PlanTask) =>
          s.id === nextStep.id ? { ...s, status: "in_progress" as const } : s
        ),
      });

      return {
        stepId: nextStep.id,
        goal: nextStep.goal,
        ...(Object.keys(dependencyResults).length > 0 && { dependencyResults }),
      };
    },
  });

  // ---------------------------------------------------------------------------
  // recordResult: writes the executor's output back to sequencer state,
  // applies cascade-skip for failed tasks, and emits a plan snapshot.
  // Receives either the executor output or { noTask: true } passthrough.
  // ---------------------------------------------------------------------------
  const recordResult = handler({
    name: `${name}-record-result`,
    inputSchema: z.any(),
    outputSchema: z.object({ stepResult: z.any().optional() }),
    sequencerStateSchema: planAndExecuteStateSchema,

    execute: async (input, ctx) => {
      const noTask = input && typeof input === "object" && "noTask" in input;
      if (noTask) {
        return { stepResult: undefined };
      }

      const stepResult = input;
      const state = ctx.sequencer!.state;
      const taskId = state.currentTaskId;

      if (!taskId) return { stepResult };

      // Check for explicit failure signal { success: false, reason? }
      const resultObj = stepResult as Record<string, unknown> | null | undefined;
      const signaledFailure =
        resultObj !== null &&
        resultObj !== undefined &&
        typeof resultObj === "object" &&
        resultObj.success === false;

      const newStatus: PlanTask["status"] = signaledFailure ? "failed" : "completed";
      const recordedError = signaledFailure
        ? String(resultObj!.reason ?? "Task did not produce a result")
        : undefined;

      let updatedTasks = state.tasks.map((s: PlanTask) =>
        s.id === taskId
          ? { ...s, status: newStatus, result: stepResult, error: recordedError }
          : s
      );

      if (newStatus === "failed") {
        updatedTasks = cascadeSkipDependents(updatedTasks, taskId);
      }

      await ctx.sequencer!.patchState({ tasks: updatedTasks, currentTaskId: undefined });

      emitPlanSnapshot(
        ctx as any,
        { goal: state.goal, tasks: updatedTasks, status: state.status, iteration: state.iteration },
        { key: name }
      );

      return { stepResult };
    },
  });

  // ---------------------------------------------------------------------------
  // recordExecutorError: rescue handler for the executeNextTask sequencer.
  // Fires when stepExecutor throws. Reads currentTaskId from outer state,
  // marks the task failed, cascade-skips dependents, and returns a value
  // the outer loop can continue from.
  // ---------------------------------------------------------------------------
  const recordExecutorError = handler({
    name: `${name}-executor-error`,
    inputSchema: z.unknown(),
    outputSchema: z.object({ stepResult: z.any().optional() }),
    sequencerStateSchema: planAndExecuteStateSchema,

    execute: async (error, ctx) => {
      const state = ctx.sequencer!.state;
      const taskId = state.currentTaskId;

      if (!taskId) return { stepResult: undefined };

      let updatedTasks = state.tasks.map((s: PlanTask) =>
        s.id === taskId
          ? { ...s, status: "failed" as const, error: String(error) }
          : s
      );
      updatedTasks = cascadeSkipDependents(updatedTasks, taskId);

      await ctx.sequencer!.patchState({ tasks: updatedTasks, currentTaskId: undefined });

      emitPlanSnapshot(
        ctx as any,
        { goal: state.goal, tasks: updatedTasks, status: state.status, iteration: state.iteration },
        { key: name }
      );

      return { stepResult: undefined };
    },
  });

  // ---------------------------------------------------------------------------
  // executeNextTask: inner sequencer — findTask → stepExecutor → recordResult.
  // stepExecutor runs as a proper named step (visible in trace). Errors from
  // the executor are caught by the rescue handler rather than crashing the plan.
  // ---------------------------------------------------------------------------
  const executeNextTask = sequencer({
    name: `${name}-execute-step-seq`,
    inputSchema: z.object({
      decision: z.enum(["continue", "replan", "complete"]).optional(),
    }),
  })
    .then(findTask)
    .thenIf((r) => !(r as any).noTask, stepExecutor as BlockDefinition<any, any>)
    .then(recordResult)
    .rescue([{ when: [Error], block: recordExecutorError }]);

  // ---------------------------------------------------------------------------
  // Build pipeline
  // ---------------------------------------------------------------------------

  const base = sequencer({
    name,
    inputSchema: planAndExecuteInputSchema,
    stateSchema: planAndExecuteStateSchema,
    ...(config.sessionResources ? { sessionResources: config.sessionResources } : {}),
  })
    // 1. Capture goal, run planner, store tasks
    .then(captureAndPlan)
    // 2. Execute next ready task (loopBack target)
    .then(executeNextTask)
    // 3. Evaluate progress
    .then(evaluator)
    // 4. Conditionally replan
    .thenIf(
      (result) => (result as any).decision === "replan",
      replanner
    )
    .thenIf(
      (result) => (result as any).tasks !== undefined,
      applyReplan
    )
    // Normalize decision shape
    .map((result): { decision: "continue" | "replan" | "complete" } => ({
      decision: (result as any).decision ?? "continue",
    }))
    // 5. Loop back to executeNextTask until evaluator says complete.
    // Each iteration executes one task; the loop terminates when the evaluator
    // returns "complete". The replanning guard (maxIterations) is enforced
    // inside the evaluator — the hard cap here is a safety net only.
    .loopBack(executeNextTask.name, {
      when: (result) => (result as any).decision !== "complete",
      maxIterations: 1000,
    })
    // 6. Extract final plan from sequencer state
    .map((_value, ctx) => {
      const state = (ctx.sequencer!.state as any) as typeof planAndExecuteStateSchema._type;
      return {
        goal: state.goal,
        status: state.status,
        tasks: state.tasks.map((s: PlanTask) => ({
          id: s.id,
          goal: s.goal,
          status: s.status,
          result: s.result,
          error: s.error,
        })),
        completedSteps: state.tasks.filter((s: PlanTask) => s.status === "completed").length,
        totalSteps: state.tasks.length,
      };
    });

  // 7. Optionally synthesize findings into a final answer
  if (synthesizer) {
    return base.then(synthesizer as BlockDefinition<any, any>);
  }
  return base;
}

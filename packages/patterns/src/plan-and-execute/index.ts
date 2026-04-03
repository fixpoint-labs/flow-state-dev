/**
 * Plan and Execute Pattern
 *
 * Two-phase agentic architecture: a planner LLM generates a structured task
 * plan stored as a resource collection instance, then an executor works through
 * steps with optional replanning.
 *
 * Pipeline:
 *   [init] → [plan] → [save] → doUntil(complete, [select → execute → record → evaluate → replan?])
 *
 * Resource collection enables multi-plan composability:
 *   - Sequential: .then(planAndExecute({ planId: "design" })).then(planAndExecute({ planId: "impl" }))
 *   - Parallel: .forEach(planAndExecute({ planId: (input) => input.topic }))
 *   - Nested: stepExecutor invokes a sub-planAndExecute
 */
import { sequencer, handler, generator } from "@flow-state-dev/core";
import { utility } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import {
  planAndExecuteInputSchema,
  planResources,
  iterationOutputSchema,
  type PlanStep,
} from "./schemas";
import { createInitPlan } from "./blocks/init-plan";
import { createEvaluateProgress } from "./blocks/evaluate-progress";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  PlanSchema,
  PlanStepSchema,
  planCollection,
  planResources,
  planAndExecuteInputSchema,
  iterationOutputSchema,
} from "./schemas";

export type {
  Plan,
  PlanStep,
  PlanAndExecuteInput,
  IterationOutput,
} from "./schemas";

export {
  planListClientData,
  planDetailClientData,
} from "./client-data";

// Re-export block factories for custom compositions
export { createInitPlan as initPlan } from "./blocks/init-plan";
export { createSavePlan as savePlan } from "./blocks/save-plan";
export { createSelectNextStep as selectNextStep } from "./blocks/select-next-step";
export { createRecordResult as recordStepResult } from "./blocks/record-result";
export {
  createEvaluateProgress as evaluatePlanProgress,
  createSimpleEvaluator,
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

  /** How to execute each step — receives { planId, stepId, goal }. Required. */
  stepExecutor: BlockDefinition<any, any>;

  /** Evaluator — decides continue/replan/complete after each step. Default: custom generator with decision schema. */
  evaluator?: BlockDefinition<any, any>;

  /** Replanner — adjusts remaining plan based on results. Default: generator with replan prompt. */
  replanner?: BlockDefinition<any, any>;

  /** Max replanning iterations before forced completion. Default: 3. */
  maxIterations?: number;

  /** Whether to enable replanning. When false, no evaluator LLM call. Default: true. */
  enableReplanning?: boolean;

  /** Plan ID — auto-generated UUID if omitted. Pass string for named plans, or function for dynamic IDs. */
  planId?: string | ((input: unknown) => string);

  /** Output schema for the final result. */
  outputSchema?: TOutputSchema;
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
    model: config.model ?? "gpt-5-mini",
    outputSchema: z.object({
      tasks: z.array(z.object({
        id: z.string(),
        goal: z.string(),
        deps: z.array(z.string()).optional(),
        priority: z.enum(["high", "medium", "low"]).optional(),
      })),
    }),
    sessionResources: planResources,
    prompt: [
      "You are a plan replanner.",
      "Given the current plan state with completed, failed, and pending steps,",
      "generate an updated list of remaining tasks to achieve the original goal.",
      "Keep completed steps as-is. Replace or adjust pending/failed steps as needed.",
      "Each task must have a unique id and clear goal.",
      "Only output the NEW tasks that should replace the current pending steps.",
    ].join("\n"),
    user: (input: { planId: string }, ctx) => {
      const planRef = (ctx.session.resources as any).plans.get({ planId: input.planId });
      const plan = planRef.state;
      return JSON.stringify({
        goal: plan.goal,
        completedSteps: plan.steps
          .filter((s: PlanStep) => s.status === "completed")
          .map((s: PlanStep) => ({ id: s.id, goal: s.goal, result: s.result })),
        failedSteps: plan.steps
          .filter((s: PlanStep) => s.status === "failed")
          .map((s: PlanStep) => ({ id: s.id, goal: s.goal, error: s.error })),
        pendingSteps: plan.steps
          .filter((s: PlanStep) => s.status === "pending")
          .map((s: PlanStep) => ({ id: s.id, goal: s.goal })),
      }, null, 2);
    },
  });
}

/**
 * Handler that applies replanner output to the plan resource,
 * replacing pending steps with the new tasks.
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
    sessionResources: planResources,

    execute: async (input, ctx) => {
      const planId = (input as any).planId as string;
      const planRef = ctx.session.resources.plans.get({ planId });
      const plan = planRef.state;

      // Keep completed/failed steps, replace pending with new tasks
      const keptSteps = plan.steps.filter(
        (s: PlanStep) => s.status === "completed" || s.status === "failed" || s.status === "skipped"
      );

      const newSteps = input.tasks.map((task) => ({
        id: task.id,
        goal: task.goal,
        status: "pending" as const,
        dependencies: task.deps ?? [],
      }));

      await planRef.patchState({
        steps: [...keptSteps, ...newSteps],
        status: "executing",
      });

      return { planId, decision: "continue" as const };
    },
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let planIdCounter = 0;

function generatePlanId(): string {
  planIdCounter += 1;
  return `plan-${Date.now()}-${planIdCounter}`;
}

/**
 * Creates a plan-and-execute block — a sequencer that decomposes a goal into
 * steps, executes them iteratively, and optionally replans.
 */
export function planAndExecute<
  TOutputSchema extends ZodTypeAny = ZodTypeAny
>(config: PlanAndExecuteConfig<TOutputSchema>) {
  const {
    name,
    stepExecutor,
    maxIterations = 3,
    enableReplanning = true,
  } = config;

  const planId = config.planId ?? (() => generatePlanId());

  // Sub-blocks
  const initPlan = createInitPlan({ name, planId, maxIterations });

  const planner = config.planner ?? utility.decomposer({
    name: `${name}-planner`,
  });

  const evaluator = config.evaluator ?? createEvaluateProgress({
    name,
    enableReplanning,
  });

  const replanner = config.replanner ?? createDefaultReplanner({ name });
  const applyReplan = createApplyReplan({ name });

  // Handler that runs one iteration: select step, execute, record result.
  // Wrapping in a handler keeps planId and stepId in scope across the executor call.
  const executeOneStep = handler({
    name: `${name}-execute-step`,
    inputSchema: z.object({
      planId: z.string(),
      decision: z.enum(["continue", "replan", "complete"]).optional(),
    }),
    outputSchema: z.object({
      planId: z.string(),
      stepResult: z.any().optional(),
    }),
    sessionResources: planResources,
    execute: async (input, ctx) => {
      const planRef = ctx.session.resources.plans.get({ planId: input.planId });
      const plan = planRef.state;

      const completedIds = new Set(
        plan.steps
          .filter((s: PlanStep) => s.status === "completed" || s.status === "skipped")
          .map((s: PlanStep) => s.id)
      );

      // Find next pending step whose dependencies are all satisfied
      const nextStep = plan.steps.find((s: PlanStep) => {
        if (s.status !== "pending") return false;
        return s.dependencies.every((dep: string) => completedIds.has(dep));
      });

      if (nextStep === undefined) {
        // No eligible steps — skip execution
        return { planId: input.planId, stepResult: undefined };
      }

      // Mark step as in_progress
      await planRef.patchState({
        steps: plan.steps.map((s: PlanStep) =>
          s.id === nextStep.id ? { ...s, status: "in_progress" as const } : s
        ),
      });

      // Execute the step
      let stepResult: unknown;
      let stepError: string | undefined;
      try {
        stepResult = await stepExecutor.run(
          { planId: input.planId, stepId: nextStep.id, goal: nextStep.goal },
          ctx as any
        );
      } catch (error) {
        stepError = String(error);
      }

      // Record result
      const newStatus: PlanStep["status"] = stepError ? "failed" : "completed";
      // Re-read plan state to get latest (in case it was modified during execution)
      const currentPlan = ctx.session.resources.plans.get({ planId: input.planId }).state;
      await ctx.session.resources.plans.get({ planId: input.planId }).patchState({
        steps: currentPlan.steps.map((s: PlanStep) =>
          s.id === nextStep.id
            ? { ...s, status: newStatus, result: stepResult, error: stepError }
            : s
        ),
      });

      return { planId: input.planId, stepResult };
    },
  });

  // Build the inner iteration sequencer
  const iterationBody = sequencer({
    name: `${name}-iteration`,
    inputSchema: z.object({
      planId: z.string(),
      decision: z.enum(["continue", "replan", "complete"]).optional(),
    }),
  })
    // 1. Select and execute the next step, record result
    .then(executeOneStep)
    // 2. Evaluate progress
    .then(evaluator)
    // 3. Conditionally replan
    .thenIf(
      (result) => (result as any).decision === "replan",
      replanner
    )
    .thenIf(
      (result) => {
        // If replanner ran, result has .tasks — apply the replan
        return (result as any).tasks !== undefined;
      },
      applyReplan
    )
    // Ensure consistent output shape
    .map((result): { planId: string; decision: "continue" | "replan" | "complete" } => ({
      planId: (result as any).planId,
      decision: (result as any).decision ?? "continue",
    }));

  // Handler that runs the planner and saves its output to the plan resource.
  // This keeps the planId in scope across the planner call.
  const planAndSave = handler({
    name: `${name}-plan-and-save`,
    inputSchema: z.object({ goal: z.string(), planId: z.string() }),
    outputSchema: z.object({ planId: z.string() }),
    sessionResources: planResources,
    execute: async (input, ctx) => {
      // Run planner to decompose goal into tasks
      const plannerOutput = await planner.run(input, ctx as any) as {
        tasks: Array<{ id: string; goal: string; deps?: string[] }>;
      };

      // Save planner output to plan resource
      const planRef = ctx.session.resources.plans.get({ planId: input.planId });
      await planRef.patchState({
        steps: plannerOutput.tasks.map((task) => ({
          id: task.id,
          goal: task.goal,
          status: "pending" as const,
          dependencies: task.deps ?? [],
        })),
        status: "executing",
      });

      return { planId: input.planId };
    },
  });

  // Build the outer pipeline
  return sequencer({
    name,
    inputSchema: planAndExecuteInputSchema,
  })
    // 1. Initialize plan resource
    .then(initPlan)
    // 2. Run planner and save plan
    .then(planAndSave)
    // 3. Prepare for execution loop
    .map((saveResult) => ({
      planId: saveResult.planId,
      decision: "continue" as const,
    }))
    .doUntil(
      (result) => (result as any).decision === "complete",
      iterationBody
    )
    // 5. Return final result
    .map((result, ctx) => {
      const planRef = (ctx.session.resources as any).plans.get({ planId: (result as any).planId });
      const plan = planRef.state;
      return {
        planId: (result as any).planId,
        goal: plan.goal,
        status: plan.status,
        steps: plan.steps.map((s: PlanStep) => ({
          id: s.id,
          goal: s.goal,
          status: s.status,
          result: s.result,
          error: s.error,
        })),
        completedSteps: plan.steps.filter((s: PlanStep) => s.status === "completed").length,
        totalSteps: plan.steps.length,
      };
    });
}

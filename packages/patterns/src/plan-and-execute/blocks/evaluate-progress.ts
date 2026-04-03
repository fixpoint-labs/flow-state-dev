import { handler, generator } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  planResources,
  iterationOutputSchema,
  type PlanStep,
} from "../schemas";

const inputSchema = z.object({
  planId: z.string(),
  stepResult: z.any().optional(),
});

export const evaluatorOutputSchema = z.object({
  decision: z.enum(["continue", "replan", "complete"]),
  reasoning: z.string(),
});

/**
 * Creates a simple evaluator (handler) — no LLM call.
 * Checks for pending steps and max iterations. Used when enableReplanning is false.
 */
export function createSimpleEvaluator(config: { name: string }) {
  return handler({
    name: `${config.name}-evaluate`,
    inputSchema,
    outputSchema: iterationOutputSchema,
    sessionResources: planResources,

    execute: async (input, ctx) => {
      const planRef = ctx.session.resources.plans.get({ planId: input.planId });
      const plan = planRef.state;

      // Increment iteration count
      await planRef.patchState({ iteration: plan.iteration + 1 });

      const hasPending = plan.steps.some(
        (s: PlanStep) => s.status === "pending" || s.status === "in_progress"
      );

      if (!hasPending) {
        const allFailed = plan.steps.length > 0 && plan.steps.every((s: PlanStep) => s.status === "failed");
        await planRef.patchState({
          status: allFailed ? "failed" : "completed",
        });
      }

      return {
        planId: input.planId,
        decision: hasPending ? ("continue" as const) : ("complete" as const),
      };
    },
  });
}

/**
 * Creates an LLM-backed evaluator (generator) — assesses progress and decides
 * whether to continue, replan, or complete.
 */
export function createLLMEvaluator(config: {
  name: string;
  model?: string;
}) {
  return generator({
    name: `${config.name}-evaluate-llm`,
    model: config.model ?? "gpt-5-mini",
    outputSchema: evaluatorOutputSchema,
    sessionResources: planResources,
    prompt: [
      "You are a plan progress evaluator.",
      "Given the current state of a multi-step plan, determine the next action:",
      "- 'continue': more steps remain and the plan is on track",
      "- 'replan': the plan needs adjustment based on results so far (steps failed or goals shifted)",
      "- 'complete': all steps are done or the overall goal has been achieved",
      "If the iteration count has reached maxIterations, always return 'complete'.",
      "Be concise in your reasoning.",
    ].join("\n"),
    user: (input: { planId: string; stepResult?: unknown }, ctx) => {
      const planRef = (ctx.session.resources as any).plans.get({
        planId: input.planId,
      });
      const plan = planRef.state;
      return JSON.stringify(
        {
          goal: plan.goal,
          iteration: plan.iteration,
          maxIterations: plan.maxIterations,
          steps: plan.steps.map((s: PlanStep) => ({
            id: s.id,
            goal: s.goal,
            status: s.status,
            result: s.result,
            error: s.error,
          })),
        },
        null,
        2
      );
    },
  });
}

/**
 * Creates the evaluate-progress block based on configuration.
 * When enableReplanning is false, returns a simple handler.
 * When enableReplanning is true, returns a handler that enforces maxIterations
 * before delegating to the LLM evaluator.
 */
export function createEvaluateProgress(config: {
  name: string;
  enableReplanning: boolean;
  model?: string;
}): BlockDefinition<any, any> {
  if (!config.enableReplanning) {
    return createSimpleEvaluator(config);
  }

  // For replanning mode, wrap LLM evaluator with maxIterations guard
  const llmEvaluatorBlock = createLLMEvaluator(config);

  return handler({
    name: `${config.name}-evaluate`,
    inputSchema,
    outputSchema: iterationOutputSchema,
    sessionResources: planResources,

    execute: async (input, ctx) => {
      const planRef = ctx.session.resources.plans.get({ planId: input.planId });
      const plan = planRef.state;

      // Increment iteration
      const newIteration = plan.iteration + 1;
      await planRef.patchState({ iteration: newIteration });

      // Force complete if max iterations exceeded
      if (newIteration >= plan.maxIterations) {
        const allFailed = plan.steps.length > 0 && plan.steps.every((s: PlanStep) => s.status === "failed");
        await planRef.patchState({
          status: allFailed ? "failed" : "completed",
        });
        return { planId: input.planId, decision: "complete" as const };
      }

      // Check if there are any pending steps at all
      const hasPending = plan.steps.some(
        (s: PlanStep) => s.status === "pending" || s.status === "in_progress"
      );
      if (!hasPending) {
        const allFailed = plan.steps.length > 0 && plan.steps.every((s: PlanStep) => s.status === "failed");
        await planRef.patchState({
          status: allFailed ? "failed" : "completed",
        });
        return { planId: input.planId, decision: "complete" as const };
      }

      // Delegate to LLM evaluator
      const llmResult = await llmEvaluatorBlock.run(input, ctx as any) as {
        decision: "continue" | "replan" | "complete";
        reasoning: string;
      };

      if (llmResult.decision === "replan") {
        await planRef.patchState({ status: "replanning" });
      } else if (llmResult.decision === "complete") {
        const allFailed = plan.steps.length > 0 && plan.steps.every((s: PlanStep) => s.status === "failed");
        await planRef.patchState({
          status: allFailed ? "failed" : "completed",
        });
      }

      return {
        planId: input.planId,
        decision: llmResult.decision,
      };
    },
  });
}

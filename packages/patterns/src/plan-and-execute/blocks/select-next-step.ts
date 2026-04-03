import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { planResources, type PlanStep } from "../schemas";

const inputSchema = z.object({
  planId: z.string(),
  decision: z.enum(["continue", "replan", "complete"]).optional(),
});

const outputSchema = z.object({
  planId: z.string(),
  stepId: z.string(),
  goal: z.string(),
});

/**
 * Reads the plan resource, finds the next pending step (respecting dependencies),
 * and marks it as in_progress.
 */
export function createSelectNextStep(config: { name: string }) {
  return handler({
    name: `${config.name}-select-step`,
    inputSchema,
    outputSchema,
    sessionResources: planResources,

    execute: async (input, ctx) => {
      const planRef = ctx.session.resources.plans.get({ planId: input.planId });
      const plan = planRef.state;

      const completedIds = new Set(
        plan.steps
          .filter((s: PlanStep) => s.status === "completed" || s.status === "skipped")
          .map((s: PlanStep) => s.id)
      );

      // Find first pending step whose dependencies are all satisfied
      const nextStep = plan.steps.find((s: PlanStep) => {
        if (s.status !== "pending") return false;
        return s.dependencies.every((dep: string) => completedIds.has(dep));
      });

      if (nextStep === undefined) {
        // No eligible steps — return a sentinel that evaluate will handle
        return { planId: input.planId, stepId: "__none__", goal: "" };
      }

      // Mark step as in_progress
      await planRef.patchState({
        steps: plan.steps.map((s: PlanStep) =>
          s.id === nextStep.id ? { ...s, status: "in_progress" as const } : s
        ),
      });

      return {
        planId: input.planId,
        stepId: nextStep.id,
        goal: nextStep.goal,
      };
    },
  });
}

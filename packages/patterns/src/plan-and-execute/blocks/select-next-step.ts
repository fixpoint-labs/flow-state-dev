import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { planResources, type PlanTask } from "../schemas";

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
 * Reads the plan resource, finds the next pending task (respecting dependencies),
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
        plan.tasks
          .filter((s: PlanTask) => s.status === "completed" || s.status === "skipped")
          .map((s: PlanTask) => s.id)
      );

      // Find first pending task whose dependencies are all satisfied
      const nextStep = plan.tasks.find((s: PlanTask) => {
        if (s.status !== "pending") return false;
        return s.dependencies.every((dep: string) => completedIds.has(dep));
      });

      if (nextStep === undefined) {
        // No eligible tasks — return a sentinel that evaluate will handle
        return { planId: input.planId, stepId: "__none__", goal: "" };
      }

      // Mark task as in_progress
      await planRef.patchState({
        tasks: plan.tasks.map((s: PlanTask) =>
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

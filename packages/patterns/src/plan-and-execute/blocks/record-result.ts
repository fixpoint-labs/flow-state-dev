import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { planResources, type PlanTask } from "../schemas";
import { emitPlanSnapshot } from "../../shared/plan";

const inputSchema = z.object({
  planId: z.string(),
  stepId: z.string(),
  stepResult: z.any().optional(),
  stepError: z.string().optional(),
});

const outputSchema = z.object({
  planId: z.string(),
  stepResult: z.any().optional(),
});

/**
 * Writes the task execution result back to the plan resource.
 * Marks the task as completed or failed.
 */
export function createRecordResult(config: { name: string }) {
  return handler({
    name: `${config.name}-record-result`,
    inputSchema,
    outputSchema,
    sessionResources: planResources,

    execute: async (input, ctx) => {
      const planRef = ctx.session.resources.plans.get({ planId: input.planId });
      const plan = planRef.state;

      const newStatus: PlanTask["status"] = input.stepError ? "failed" : "completed";

      await planRef.patchState({
        tasks: plan.tasks.map((s: PlanTask) =>
          s.id === input.stepId
            ? {
                ...s,
                status: newStatus,
                result: input.stepResult,
                error: input.stepError,
              }
            : s
        ),
      });

      const updatedPlan = ctx.session.resources.plans.get({ planId: input.planId }).state;
      emitPlanSnapshot(ctx, {
        goal: updatedPlan.goal,
        tasks: updatedPlan.tasks,
        status: updatedPlan.status,
        iteration: updatedPlan.iteration,
      });

      return {
        planId: input.planId,
        stepResult: input.stepResult,
      };
    },
  });
}

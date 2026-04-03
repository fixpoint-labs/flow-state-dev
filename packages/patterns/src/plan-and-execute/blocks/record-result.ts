import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { planResources, type PlanStep } from "../schemas";

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
 * Writes the step execution result back to the plan resource.
 * Marks the step as completed or failed.
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

      const newStatus: PlanStep["status"] = input.stepError ? "failed" : "completed";

      await planRef.patchState({
        steps: plan.steps.map((s: PlanStep) =>
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

      return {
        planId: input.planId,
        stepResult: input.stepResult,
      };
    },
  });
}

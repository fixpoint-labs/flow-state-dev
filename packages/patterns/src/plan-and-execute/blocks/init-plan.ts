import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { planResources, type PlanAndExecuteInput } from "../schemas";

const outputSchema = z.object({
  goal: z.string(),
  planId: z.string(),
});

/**
 * Creates a plan instance in the resource collection.
 * Idempotent via getOrCreate — safe for re-entry.
 */
export function createInitPlan(config: {
  name: string;
  planId: string | ((input: PlanAndExecuteInput) => string);
  maxIterations: number;
}) {
  return handler({
    name: `${config.name}-init`,
    inputSchema: z.object({ goal: z.string() }),
    outputSchema,
    sessionResources: planResources,

    execute: async (input, ctx) => {
      const resolvedPlanId = typeof config.planId === "function"
        ? config.planId(input)
        : config.planId;

      await ctx.session.resources.plans.getOrCreate(
        { planId: resolvedPlanId },
        {
          goal: input.goal,
          tasks: [],
          status: "planning",
          currentStepIndex: 0,
          iteration: 0,
          maxIterations: config.maxIterations,
        }
      );

      return { goal: input.goal, planId: resolvedPlanId };
    },
  });
}

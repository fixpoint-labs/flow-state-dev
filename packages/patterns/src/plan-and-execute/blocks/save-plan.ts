import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { planResources } from "../schemas";

const inputSchema = z.object({
  tasks: z.array(z.object({
    id: z.string(),
    goal: z.string(),
    deps: z.array(z.string()).optional(),
    priority: z.enum(["high", "medium", "low"]).optional(),
  })),
});

const outputSchema = z.object({
  planId: z.string(),
});

/**
 * Writes planner output (task list) into the plan resource as steps.
 * Expects the planId to be passed via a connector from init-plan.
 */
export function createSavePlan(config: { name: string }) {
  return handler({
    name: `${config.name}-save-plan`,
    inputSchema,
    outputSchema,
    sessionResources: planResources,

    execute: async (input, ctx) => {
      // planId is injected via connector from the sequencer
      const planId = (input as any).planId as string;

      const planRef = ctx.session.resources.plans.get({ planId });
      await planRef.patchState({
        steps: input.tasks.map((task) => ({
          id: task.id,
          goal: task.goal,
          status: "pending" as const,
          dependencies: task.deps ?? [],
        })),
        status: "executing",
      });

      return { planId };
    },
  });
}

import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { planAndExecuteStateSchema, type PlanTask } from "../schemas";

const inputSchema = z.object({
  decision: z.enum(["continue", "replan", "complete"]).optional(),
});

const outputSchema = z.object({
  stepId: z.string(),
  goal: z.string(),
});

/**
 * Reads the plan from sequencer state, finds the next pending task (respecting
 * dependencies), and marks it as in_progress.
 */
export function createSelectNextStep(config: { name: string }) {
  return handler({
    name: `${config.name}-select-step`,
    inputSchema,
    outputSchema,
    sequencerStateSchema: planAndExecuteStateSchema,

    execute: async (_input, ctx) => {
      const state = ctx.sequencer!.state;

      const completedIds = new Set(
        state.tasks
          .filter((s: PlanTask) => s.status === "completed" || s.status === "skipped")
          .map((s: PlanTask) => s.id)
      );

      // Find first pending task whose dependencies are all satisfied
      const nextStep = state.tasks.find((s: PlanTask) => {
        if (s.status !== "pending") return false;
        return s.dependencies.every((dep: string) => completedIds.has(dep));
      });

      if (nextStep === undefined) {
        return { stepId: "__none__", goal: "" };
      }

      await ctx.sequencer!.patchState({
        tasks: state.tasks.map((s: PlanTask) =>
          s.id === nextStep.id ? { ...s, status: "in_progress" as const } : s
        ),
      });

      return { stepId: nextStep.id, goal: nextStep.goal };
    },
  });
}

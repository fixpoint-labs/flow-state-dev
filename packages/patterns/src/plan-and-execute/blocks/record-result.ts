import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { planAndExecuteStateSchema, type PlanTask } from "../schemas";
import { emitTaskUpdate } from "../../shared/plan";

const inputSchema = z.object({
  stepId: z.string(),
  stepResult: z.any().optional(),
  stepError: z.string().optional(),
});

const outputSchema = z.object({
  stepResult: z.any().optional(),
});

/**
 * Writes the task execution result back to sequencer state.
 * Marks the task as completed or failed, then emits a per-task update.
 */
export function createRecordResult(config: { name: string }) {
  return handler({
    name: `${config.name}-record-result`,
    inputSchema,
    outputSchema,
    sequencerStateSchema: planAndExecuteStateSchema,

    execute: async (input, ctx) => {
      const state = ctx.sequencer!.state;
      const newStatus: PlanTask["status"] = input.stepError ? "failed" : "completed";

      const updatedTasks = state.tasks.map((s: PlanTask) =>
        s.id === input.stepId
          ? { ...s, status: newStatus, result: input.stepResult, error: input.stepError }
          : s
      );

      await ctx.sequencer!.patchState({ tasks: updatedTasks });

      const finishedTask = updatedTasks.find((t: PlanTask) => t.id === input.stepId)!;
      emitTaskUpdate(ctx, {
        id: finishedTask.id,
        goal: finishedTask.goal,
        status: finishedTask.status,
        result: finishedTask.result,
        error: finishedTask.error,
      }, { key: config.name });

      return { stepResult: input.stepResult };
    },
  });
}

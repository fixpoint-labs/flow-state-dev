import { handler, generator } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  planAndExecuteStateSchema,
  iterationOutputSchema,
  type PlanTask,
} from "../schemas";

const inputSchema = z.object({
  stepResult: z.any().optional(),
});

export const evaluatorOutputSchema = z.object({
  decision: z.enum(["continue", "replan", "complete"]),
  reasoning: z.string(),
});

/**
 * Creates the default task evaluator (handler) — no extra LLM call.
 * Reads a `success?: boolean` signal from the step executor's output.
 * If `success === false`, marks the last in-progress task as failed with the
 * executor's `reason`. Then checks for remaining pending tasks to decide
 * continue/complete.
 *
 * Convention: step executors may return `{ success?: boolean, reason?: string, ...rest }`.
 * Absent `success` is treated as true (backward compatible).
 */
export function createTaskEvaluator(config: { name: string }) {
  return handler({
    name: `${config.name}-evaluate`,
    inputSchema,
    outputSchema: iterationOutputSchema,
    sequencerStateSchema: planAndExecuteStateSchema,

    execute: async (_input, ctx) => {
      const state = ctx.sequencer!.state;

      // The success/failure signal from the executor is already applied to task
      // status in executeNextTask. Check for tasks that are actually executable
      // (pending AND all deps satisfied) — blocked tasks stay pending forever
      // when their dependencies failed, so checking hasPending alone can deadlock.
      const satisfiedIds = new Set(
        state.tasks
          .filter((t: PlanTask) => t.status === "completed" || t.status === "skipped")
          .map((t: PlanTask) => t.id)
      );
      const hasExecutable = state.tasks.some(
        (t: PlanTask) =>
          t.status === "pending" &&
          t.dependencies.every((dep: string) => satisfiedIds.has(dep))
      );

      if (!hasExecutable) {
        const allFailed =
          state.tasks.length > 0 &&
          state.tasks.every(
            (t: PlanTask) =>
              t.status === "failed" || t.status === "skipped" || t.status === "pending"
          );
        await ctx.sequencer!.patchState({
          status: allFailed ? "failed" : "completed",
        });
      }

      return { decision: hasExecutable ? ("continue" as const) : ("complete" as const) };
    },
  });
}

/**
 * Creates an LLM-backed evaluator (generator) — assesses overall progress and
 * decides whether to continue, replan, or complete the whole plan.
 */
export function createLLMEvaluator(config: {
  name: string;
  model?: string;
}) {
  return generator({
    name: `${config.name}-evaluate-llm`,
    model: config.model ?? "openai/gpt-5.4-mini",
    outputSchema: evaluatorOutputSchema,
    sequencerStateSchema: planAndExecuteStateSchema,
    prompt: [
      "You are a plan progress evaluator.",
      "Given the current state of a multi-step plan, determine the next action:",
      "- 'continue': more steps remain and the plan is on track",
      "- 'replan': the plan needs adjustment based on results so far (steps failed or goals shifted)",
      "- 'complete': all steps are done or the overall goal has been achieved",
      "If the iteration count has reached maxIterations, always return 'complete'.",
      "Be concise in your reasoning.",
    ].join("\n"),
    user: (_input: unknown, ctx) => {
      const state = ctx.sequencer!.state;
      return JSON.stringify(
        {
          goal: state.goal,
          iteration: state.iteration,
          maxIterations: state.maxIterations,
          tasks: state.tasks.map((s: PlanTask) => ({
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
 * When enableReplanning is false, returns createTaskEvaluator (no LLM call,
 * reads success signal from executor output).
 * When enableReplanning is true, wraps LLM evaluator with maxIterations guard.
 */
export function createEvaluateProgress(config: {
  name: string;
  enableReplanning: boolean;
  model?: string;
}): BlockDefinition<any, any> {
  if (!config.enableReplanning) {
    return createTaskEvaluator(config);
  }

  const llmEvaluatorBlock = createLLMEvaluator(config);

  return handler({
    name: `${config.name}-evaluate`,
    inputSchema,
    outputSchema: iterationOutputSchema,
    sequencerStateSchema: planAndExecuteStateSchema,

    execute: async (input, ctx) => {
      const state = ctx.sequencer!.state;

      if (state.iteration >= state.maxIterations) {
        const allFailed =
          state.tasks.length > 0 &&
          state.tasks.every((s: PlanTask) => s.status === "failed");
        await ctx.sequencer!.patchState({
          status: allFailed ? "failed" : "completed",
        });
        return { decision: "complete" as const };
      }

      const satisfiedIds = new Set(
        state.tasks
          .filter((s: PlanTask) => s.status === "completed" || s.status === "skipped")
          .map((s: PlanTask) => s.id)
      );
      const hasExecutable = state.tasks.some(
        (s: PlanTask) =>
          (s.status === "pending" || s.status === "in-progress") &&
          s.dependencies.every((dep: string) => satisfiedIds.has(dep))
      );
      if (!hasExecutable) {
        const allFailed =
          state.tasks.length > 0 &&
          state.tasks.every(
            (s: PlanTask) =>
              s.status === "failed" || s.status === "skipped" || s.status === "pending"
          );
        await ctx.sequencer!.patchState({
          status: allFailed ? "failed" : "completed",
        });
        return { decision: "complete" as const };
      }

      const llmResult = (await llmEvaluatorBlock.run(input, ctx as any)) as {
        decision: "continue" | "replan" | "complete";
        reasoning: string;
      };

      if (llmResult.decision === "replan") {
        await ctx.sequencer!.patchState({ status: "replanning" });
      } else if (llmResult.decision === "complete") {
        const allFailed =
          state.tasks.length > 0 &&
          state.tasks.every((s: PlanTask) => s.status === "failed");
        await ctx.sequencer!.patchState({
          status: allFailed ? "failed" : "completed",
        });
      }

      return { decision: llmResult.decision };
    },
  });
}

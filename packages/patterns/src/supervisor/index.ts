/**
 * Supervisor Pattern
 *
 * Agentic orchestration loop: plan → dispatch → review → replan.
 *
 * Pipeline: [captureGoal] → [planner] → [updatePlanState] → [forEach(worker)]
 *           → [reviewer] → [applyReview] → loopBack(planner) → [synthesizer]
 *
 * Unlike the Coordinator (single-pass), the Supervisor includes a review-and-replan
 * feedback loop powered by `.loopBack()` and sequencer `stateSchema`.
 */
import { sequencer, handler, generator } from "@flow-state-dev/core";
import { utility } from "@flow-state-dev/core";
import { emitPlanSnapshot } from "../shared/plan";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import {
  supervisorInputSchema,
  supervisorStateSchema,
  reviewOutputSchema,
  plannerOutputSchema,
  executableTasksSchema,
  applyReviewOutputSchema,
  type SubTaskErrorStrategy,
  type PlannerOutput,
  type ReviewOutput,
  type ExecutableTask,
} from "./schemas";

export {
  supervisorInputSchema,
  supervisorStateSchema,
  reviewOutputSchema,
  plannerOutputSchema,
} from "./schemas";


export type {
  SupervisorInput,
  SupervisorState,
  ReviewOutput,
  PlannerOutput,
  ExecutableTask,
  SubTaskErrorStrategy,
} from "./schemas";

export interface SupervisorConfig<
  TOutputSchema extends ZodTypeAny = ZodTypeAny
> {
  /** Name for this supervisor instance. */
  name: string;

  /** The worker block that processes each sub-task. Receives `{ id, goal, feedback? }`. */
  worker: BlockDefinition<any, any, ExecutableTask, any>;

  /** Criteria the reviewer uses to evaluate sub-task quality. */
  reviewCriteria?: string[];

  /** Maximum number of plan/dispatch/review iterations. Defaults to 3. */
  maxIterations?: number;

  /** Maximum number of sub-tasks to run concurrently. Defaults to 3. */
  maxConcurrency?: number;

  /** Override the planning step. Must output `{ tasks: [{ id, goal, ... }] }`. Defaults to a supervisor-aware decomposer. */
  planner?: BlockDefinition<any, any, any, PlannerOutput>;

  /** Override the review step. Must output `reviewOutputSchema`. Defaults to a review generator. */
  reviewer?: BlockDefinition<any, any, any, ReviewOutput>;

  /** Override the final synthesis step. Receives `unknown[]` (accepted results). Defaults to `utility.synthesizer()`. */
  synthesizer?: BlockDefinition<any, any, unknown[], any>;

  /**
   * How to handle individual sub-task failures.
   * - `skip` (default): exclude failed sub-tasks from review
   * - `fail`: abort entire supervision on any failure
   * - `retry`: retry per worker's retry policy before failing
   */
  onSubTaskError?: SubTaskErrorStrategy;

  /** Schema for the final synthesized output. */
  outputSchema?: TOutputSchema;
}

const SKIPPED_SENTINEL = "__supervisorSkipped";
type SkippedTaskResult = {
  [SKIPPED_SENTINEL]: true;
  error: string;
};

function isSkippedTaskResult(value: unknown): value is SkippedTaskResult {
  return (
    value !== null &&
    typeof value === "object" &&
    SKIPPED_SENTINEL in value
  );
}

/**
 * Stores the original goal in sequencer state so it's available on re-plan iterations.
 */
export const captureGoal = handler({
  name: "capture-goal",
  inputSchema: supervisorInputSchema,
  sequencerStateSchema: supervisorStateSchema,
  execute: async (input, ctx) => {
    await ctx.sequencer!.patchState({ goal: input.goal });
  },
});

/**
 * Records the planner's decomposition into sequencer state and returns
 * executable task objects for the forEach dispatch step.
 */
export const updatePlanState = handler({
  name: "update-plan-state",
  inputSchema: plannerOutputSchema,
  outputSchema: executableTasksSchema,
  sequencerStateSchema: supervisorStateSchema,
  execute: async (input, ctx) => {
    const state = ctx.sequencer!.state;
    const isFirstIteration = state.iteration === 0;
    const newPlan = input.tasks.map((t) => ({
      id: t.id,
      goal: t.goal,
      status: "in-progress" as const,
    }));

    await ctx.sequencer!.patchState({
      plan: isFirstIteration
        ? newPlan
        : [
            ...state.plan.filter(
              (t) =>
                t.status === "completed" || t.status === "escalated"
            ),
            ...newPlan,
          ],
      iteration: state.iteration + 1,
    });

    const updatedState = ctx.sequencer!.state;
    emitPlanSnapshot(ctx, {
      goal: updatedState.goal,
      tasks: updatedState.plan,
      iteration: updatedState.iteration,
    });

    // On re-plan, include feedback from prior iterations so workers know what was wrong
    return newPlan.map((t) => {
      const prior = state.plan.find((p) => p.id === t.id);
      return {
        id: t.id,
        goal: t.goal,
        feedback: prior?.feedback,
      };
    });
  },
});

/**
 * Applies reviewer verdicts to sequencer state and returns a signal
 * that drives the loopBack condition.
 */
export const applyReview = handler({
  name: "apply-review",
  inputSchema: reviewOutputSchema,
  outputSchema: applyReviewOutputSchema,
  sequencerStateSchema: supervisorStateSchema,
  execute: async (input, ctx) => {
    const state = ctx.sequencer!.state;
    const newAccepted = [...state.acceptedResults];
    const updatedPlan = state.plan.map((task) => {
      const assessment = input.assessments.find(
        (a) => a.taskId === task.id
      );
      if (!assessment) return task;
      if (assessment.verdict === "accepted" && task.result !== undefined) {
        newAccepted.push(task.result);
      }
      const mappedStatus =
        assessment.verdict === "accepted"
          ? ("completed" as const)
          : assessment.verdict === "escalate"
            ? ("escalated" as const)
            : ("needs-revision" as const);
      return {
        ...task,
        status: mappedStatus,
        feedback: assessment.feedback,
      };
    });
    await ctx.sequencer!.patchState({
      acceptedResults: newAccepted,
      plan: updatedPlan,
    });
    const finalState = ctx.sequencer!.state;
    emitPlanSnapshot(ctx, {
      goal: finalState.goal,
      tasks: finalState.plan,
      iteration: finalState.iteration,
    });
    return { needsReplanning: input.needsReplanning };
  },
});

function buildDefaultPlanner(name: string) {
  return generator({
    name: `${name}-planner`,
    model: "preset/fast",
    outputSchema: plannerOutputSchema,
    sequencerStateSchema: supervisorStateSchema,
    prompt: (_input, ctx) => {
      const state = ctx.sequencer?.state;
      if (!state || state.iteration === 0) {
        return [
          "You are a task decomposition assistant.",
          "Break broad requests into independent, actionable sub-tasks.",
          "Each task must include a stable unique id and a clear goal.",
          "Use deps only when a task depends on one or more prior task ids.",
          "Set priority when useful using high, medium, or low.",
          "Order tasks so dependencies can be executed correctly.",
          "Return output that exactly matches the required schema.",
        ].join("\n");
      }
      const needsRevision = state.plan.filter(
        (t) => t.status === "needs-revision"
      );
      return [
        `Original goal: ${state.goal}`,
        `Iteration ${state.iteration + 1}. Re-plan only the following tasks based on review feedback:`,
        ...needsRevision.map(
          (t) => `- Task "${t.id}" (${t.goal}): ${t.feedback}`
        ),
        "Return revised sub-tasks that address the feedback. Do not re-plan tasks that were already accepted.",
        "Return output that exactly matches the required schema.",
      ].join("\n");
    },
    user: (input) =>
      typeof input === "string" ? input : JSON.stringify(input),
  });
}

function buildDefaultReviewer(
  name: string,
  reviewCriteria?: string[]
) {
  const criteriaBlock = reviewCriteria?.length
    ? `\nEvaluation criteria:\n${reviewCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
    : "";

  return generator({
    name: `${name}-reviewer`,
    model: "preset/fast",
    outputSchema: reviewOutputSchema,
    prompt: [
      "You are a quality review assistant.",
      "Evaluate each sub-task result against the original goal and review criteria.",
      "For each task, provide a verdict: accepted, needs-revision, or escalate.",
      "Set needsReplanning to true if ANY task received a needs-revision verdict.",
      "Provide specific, actionable feedback for tasks that need revision.",
      "Score each task from 0 to 1 based on quality.",
      criteriaBlock,
      "Return output that exactly matches the required schema.",
    ]
      .filter(Boolean)
      .join("\n"),
    emit: { messages: false, reasoning: false },
    user: (input) =>
      typeof input === "string" ? input : JSON.stringify(input),
  });
}

/**
 * Creates a supervisor block — a sequencer that decomposes a goal into
 * sub-tasks, dispatches workers, reviews results, and re-plans when needed.
 */
export function supervisor<TOutputSchema extends ZodTypeAny = ZodTypeAny>(
  config: SupervisorConfig<TOutputSchema>
) {
  const name = config.name;
  const errorStrategy = config.onSubTaskError ?? "skip";
  const maxIterations = config.maxIterations ?? 3;

  const planner =
    config.planner ?? buildDefaultPlanner(name);

  const reviewer =
    config.reviewer ?? buildDefaultReviewer(name, config.reviewCriteria);

  const finalSynthesizer =
    config.synthesizer ??
    utility.synthesizer({
      name: `${name}-synthesizer`,
      ...(config.outputSchema ? { outputSchema: config.outputSchema } : {}),
    });

  // Wrap the worker in a sequencer with rescue for skip/retry strategies.
  // "fail" uses the bare worker so errors propagate naturally.
  // "skip"/"retry" wrap in a sequencer with .rescue() that returns the sentinel.
  const taskRunner =
    errorStrategy === "fail"
      ? config.worker
      : sequencer({
          name: `${name}-task-runner`,
          inputSchema: z.any(),
        })
          .then(config.worker)
          .rescue([
            {
              block: handler({
                name: `${name}-task-rescue`,
                inputSchema: z.instanceof(Error),
                outputSchema: z.any(),
                execute: (error) => ({
                  [SKIPPED_SENTINEL]: true,
                  error: error.message,
                }),
              }),
            },
          ]);

  // Instance-specific handlers that pass a stable plan key for UI deduplication.
  // The exported updatePlanState / applyReview lack access to config.name,
  // so supervisor() creates named closures to ensure all snapshots share the
  // same key and only the latest snapshot is rendered (via ItemsRenderer dedup).

  const updatePlanStateBlock = handler({
    name: "update-plan-state",
    inputSchema: plannerOutputSchema,
    outputSchema: executableTasksSchema,
    sequencerStateSchema: supervisorStateSchema,
    execute: async (input, ctx) => {
      const state = ctx.sequencer!.state;
      const isFirstIteration = state.iteration === 0;
      const newPlan = input.tasks.map((t) => ({
        id: t.id,
        goal: t.goal,
        status: "in-progress" as const,
      }));

      await ctx.sequencer!.patchState({
        plan: isFirstIteration
          ? newPlan
          : [
              ...state.plan.filter(
                (t) =>
                  t.status === "completed" || t.status === "escalated"
              ),
              ...newPlan,
            ],
        iteration: state.iteration + 1,
      });

      const updatedState = ctx.sequencer!.state;
      emitPlanSnapshot(ctx, {
        goal: updatedState.goal,
        tasks: updatedState.plan,
        iteration: updatedState.iteration,
      }, { key: `${name}:iter-${updatedState.iteration}` });

      return newPlan.map((t) => {
        const prior = state.plan.find((p) => p.id === t.id);
        return {
          id: t.id,
          goal: t.goal,
          feedback: prior?.feedback,
        };
      });
    },
  });

  const applyReviewBlock = handler({
    name: "apply-review",
    inputSchema: reviewOutputSchema,
    outputSchema: applyReviewOutputSchema,
    sequencerStateSchema: supervisorStateSchema,
    execute: async (input, ctx) => {
      const state = ctx.sequencer!.state;
      const newAccepted = [...state.acceptedResults];
      const updatedPlan = state.plan.map((task) => {
        const assessment = input.assessments.find(
          (a) => a.taskId === task.id
        );
        if (!assessment) return task;
        if (assessment.verdict === "accepted" && task.result !== undefined) {
          newAccepted.push(task.result);
        }
        const mappedStatus =
          assessment.verdict === "accepted"
            ? ("completed" as const)
            : assessment.verdict === "escalate"
              ? ("escalated" as const)
              : ("needs-revision" as const);
        return {
          ...task,
          status: mappedStatus,
          feedback: assessment.feedback,
        };
      });
      await ctx.sequencer!.patchState({
        acceptedResults: newAccepted,
        plan: updatedPlan,
      });
      const finalState = ctx.sequencer!.state;
      emitPlanSnapshot(ctx, {
        goal: finalState.goal,
        tasks: finalState.plan,
        iteration: finalState.iteration,
      }, { key: `${name}:iter-${finalState.iteration}` });
      return { needsReplanning: input.needsReplanning };
    },
  });

  // Store worker results back into plan state so applyReview can access them.
  // Returns results paired with task IDs/goals so the reviewer can reference them.
  const storeResults = handler({
    name: `${name}-store-results`,
    inputSchema: z.any(),
    outputSchema: z.any(),
    sequencerStateSchema: supervisorStateSchema,
    execute: async (results: unknown[], ctx) => {
      const state = ctx.sequencer!.state;
      const pendingTasks = state.plan.filter((t) => t.status === "in-progress");
      const reviewableResults: { taskId: string; goal: string; result: unknown }[] = [];
      const updatedPlan = state.plan.map((task) => {
        const taskIndex = pendingTasks.findIndex((t) => t.id === task.id);
        if (taskIndex < 0 || taskIndex >= results.length) return task;
        const result = results[taskIndex];
        if (isSkippedTaskResult(result)) {
          const errorMessage =
            result.error || "Worker failed and task was skipped";
          ctx.emitStatus(
            `[supervisor:${name}] skipped task "${task.id}": ${errorMessage}`
          );
          return {
            ...task,
            status: "skipped" as const,
            error: errorMessage,
            feedback: errorMessage,
          };
        }
        reviewableResults.push({ taskId: task.id, goal: task.goal, result });
        return { ...task, result, status: "awaiting-review" as const };
      });
      await ctx.sequencer!.patchState({ plan: updatedPlan });
      const finalState = ctx.sequencer!.state;
      emitPlanSnapshot(ctx, {
        goal: finalState.goal,
        tasks: finalState.plan,
        iteration: finalState.iteration,
      }, { key: `${name}:iter-${finalState.iteration}` });
      return reviewableResults;
    },
  });

  let pipeline = sequencer({
    name,
    inputSchema: supervisorInputSchema,
    stateSchema: supervisorStateSchema,
  })
    .tap(captureGoal)
    .then(planner)
    .then(updatePlanStateBlock)
    .forEach(taskRunner, {
      maxConcurrency: config.maxConcurrency ?? 3,
    });

  return pipeline
    .then(storeResults)
    .then(reviewer)
    .then(applyReviewBlock)
    .loopBack(planner.name, {
      when: (value) =>
        (value as { needsReplanning: boolean }).needsReplanning,
      maxIterations,
    })
    // Pass the goal and accepted results to the synthesizer so it has
    // context for producing a coherent final output.
    .map((_value, ctx) => {
      const state = ctx.sequencer!.state;
      return { goal: state.goal, results: state.acceptedResults };
    })
    .then(finalSynthesizer);
}

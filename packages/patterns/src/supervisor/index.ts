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
      deps: t.deps ?? [],
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
        deps: t.deps ?? [],
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
          "You are a task decomposition assistant for a supervisor workflow.",
          "Break the request into sub-tasks that can ALL run in parallel — every task you emit will execute concurrently.",
          "If some work depends on the output of other work, only include the independent tasks now.",
          "Dependent follow-up tasks will be planned in a later iteration once earlier results are available.",
          "Each task must include a stable unique id and a clear goal.",
          "Optionally assign each task an assignee — a role, team member, or specialist best suited for that task.",
          "Return output that exactly matches the required schema.",
        ].join("\n");
      }

      const completed = state.plan.filter((t) => t.status === "completed");
      const needsRevision = state.plan.filter((t) => t.status === "needs-revision");

      const completedSummary = completed.length > 0
        ? `\nCompleted tasks from prior iterations:\n${completed.map(
            (t) => `- "${t.id}" (${t.goal}): ${typeof t.result === "string" ? t.result.slice(0, 200) : "done"}`
          ).join("\n")}`
        : "";

      if (needsRevision.length > 0) {
        return [
          `Original goal: ${state.goal}`,
          completedSummary,
          `\nIteration ${state.iteration + 1}. The following tasks need revision:`,
          ...needsRevision.map(
            (t) => `- Task "${t.id}" (${t.goal}): ${t.feedback}`
          ),
          "Return revised sub-tasks that address the feedback.",
          "Also include any NEW follow-up tasks that can now run given the completed results above.",
          "Do not re-plan tasks that were already accepted.",
          "Return output that exactly matches the required schema.",
        ].join("\n");
      }

      // No revisions — this is a follow-up wave for dependent tasks
      return [
        `Original goal: ${state.goal}`,
        completedSummary,
        `\nIteration ${state.iteration + 1}. The tasks above are complete.`,
        "Plan the next wave of tasks that depend on or build upon the completed results.",
        "If the goal is fully addressed, return an empty tasks array.",
        "Every task you emit will run concurrently, so only include tasks that are independent of each other.",
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
      "You are a quality review assistant for a supervisor workflow.",
      "Evaluate each sub-task result against the original goal and review criteria.",
      "For each task, provide a verdict: accepted, needs-revision, or escalate.",
      "Set needsReplanning to true if:",
      "  - ANY task received a needs-revision verdict, OR",
      "  - The completed tasks are only a partial step toward the goal and more work is needed",
      "    (e.g., foundational tasks are done but the main deliverable hasn't been produced yet).",
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

function buildDefaultSynthesizer(
  name: string,
  outputSchema?: ZodTypeAny
) {
  return generator({
    name: `${name}-synthesizer`,
    model: "preset/fast",
    outputSchema: outputSchema ?? z.string(),
    emit: { messages: true, reasoning: false },
    prompt: [
      "You are a final synthesis step in a supervisor workflow.",
      "A team of workers has already completed the tasks. You will receive the original goal and their outputs.",
      "Your job is to combine the workers' outputs into the FINAL DELIVERABLE that the user requested.",
      "Your output IS the end product — not a summary, not a recommendation, not commentary about the process.",
      "If the workers wrote a story, output the story. If they produced a report, output the report. If they built a plan, output the plan.",
      "Merge overlapping content, resolve conflicts, and ensure the result reads as one unified piece — not a list of fragments.",
      "Do NOT describe what the workers did. Do NOT recommend next steps. Do NOT output JSON unless the goal explicitly requires it.",
      "Deliver the finished work.",
    ].join("\n"),
    user: (input: unknown) => {
      if (typeof input === "string") return input;
      const data = input as { goal?: string; results?: unknown[] };
      const parts: string[] = [];
      if (data.goal) parts.push(`Goal: ${data.goal}`);
      if (data.results && Array.isArray(data.results)) {
        data.results.forEach((r, i) => {
          const text = typeof r === "string" ? r : JSON.stringify(r, null, 2);
          parts.push(`--- Task ${i + 1} Result ---\n${text}`);
        });
      }
      return parts.join("\n\n");
    },
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
    buildDefaultSynthesizer(name, config.outputSchema);

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
    outputSchema: z.any(),
    sequencerStateSchema: supervisorStateSchema,
    execute: async (input, ctx) => {
      const state = ctx.sequencer!.state;
      const isFirstIteration = state.iteration === 0;
      const newPlan = input.tasks.map((t) => ({
        id: t.id,
        goal: t.goal,
        ...(t.assignee ? { assignee: t.assignee } : {}),
        deps: t.deps ?? [],
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
      }, { key: name });

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
      }, { key: name });
      return { needsReplanning: input.needsReplanning };
    },
  });

  // Collect reviewable results from the forEach output (task statuses already
  // updated incrementally inside the forEach factory).
  const collectResults = handler({
    name: `${name}-collect-results`,
    inputSchema: z.any(),
    outputSchema: z.any(),
    sequencerStateSchema: supervisorStateSchema,
    execute: async (results: unknown[], ctx) => {
      const state = ctx.sequencer!.state;
      return state.plan
        .filter((t) => t.status === "awaiting-review" && t.result !== undefined)
        .map((t) => ({ taskId: t.id, goal: t.goal, result: t.result }));
    },
  });

  // Per-task status updater: runs inside forEach after each worker completes.
  // Updates that task's status in sequencer state and emits a fresh snapshot
  // so the UI reflects each completion incrementally.
  const updateTaskStatus = (task: { id: string; goal: string }) =>
    handler({
      name: `${name}-update-task-${task.id}`,
      inputSchema: z.any(),
      outputSchema: z.any(),
      sequencerStateSchema: supervisorStateSchema,
      execute: async (result: unknown, ctx) => {
        if (isSkippedTaskResult(result)) {
          const errorMessage =
            result.error || "Worker failed and task was skipped";
          ctx.emitStatus(
            `[supervisor:${name}] skipped task "${task.id}": ${errorMessage}`
          );
          // Functional updater reads the latest state to avoid race conditions
          // when multiple tasks complete concurrently.
          await ctx.sequencer!.patchState("plan" as any, (currentPlan: any[]) =>
            currentPlan.map((t: any) =>
              t.id === task.id
                ? { ...t, status: "skipped" as const, error: errorMessage, feedback: errorMessage }
                : t
            )
          );
        } else {
          await ctx.sequencer!.patchState("plan" as any, (currentPlan: any[]) =>
            currentPlan.map((t: any) =>
              t.id === task.id
                ? { ...t, result, status: "awaiting-review" as const }
                : t
            )
          );
        }
        const updatedState = ctx.sequencer!.state;
        emitPlanSnapshot(ctx, {
          goal: updatedState.goal,
          tasks: updatedState.plan,
          iteration: updatedState.iteration,
        }, { key: name });
        return result;
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
    .forEach(
      (task: ExecutableTask, _index, _ctx) =>
        sequencer({ name: `${name}-task-${task.id}`, inputSchema: z.any() })
          .then(taskRunner)
          .then(updateTaskStatus(task)),
      { maxConcurrency: config.maxConcurrency ?? 3 },
    );

  return pipeline
    .then(collectResults)
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

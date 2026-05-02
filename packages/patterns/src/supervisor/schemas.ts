/**
 * Schemas for the supervisor pattern (post-FIX-447 migration onto taskBoard).
 *
 * Outer state is minimal — task storage lives on the request-scoped
 * TaskCollection, not here. Per-task review verdicts conform to
 * `reviewerVerdictSchema`; the legacy aggregate `reviewOutputSchema`
 * is kept as an export for pre-migration consumers.
 */
import { z } from "zod";

export const supervisorInputSchema = z.object({
  goal: z.string().describe("The goal to supervise"),
});

export type SupervisorInput = z.infer<typeof supervisorInputSchema>;

/** Outer sequencer state: goal, optional pattern-level status, iteration
 * counter, plus per-task reviewer audit metadata. `reviewMetadata` is
 * populated by `stampReviewEntered` / `applyVerdict` and read by
 * `labelFailedReviews` to classify terminal task failures. Lives on the
 * supervisor sequencer's own (in-memory, lock-serialized) state instead
 * of the task collection so reviewer writes stay off the request scope's
 * shared mutation queue. */
export const supervisorStateSchema = z.object({
  goal: z.string().default(""),
  status: z
    .enum([
      "planning",
      "executing",
      "replanning",
      "synthesizing",
      "completed",
      "failed",
    ])
    .optional(),
  iteration: z.number().default(0),
  reviewMetadata: z
    .record(
      z.string(),
      z.object({
        entered: z.boolean().optional(),
        lastVerdict: z.enum(["approve", "reject", "needs-revision"]).optional(),
      })
    )
    .default({}),
});

export type SupervisorState = z.infer<typeof supervisorStateSchema>;

/**
 * Per-task reviewer verdict. `applyVerdict` flows the worker output
 * through on `approve`; on `reject` / `needs-revision` it throws so
 * the substrate's `recordError` + `maxAttempts` machinery handles the
 * retry.
 */
export const reviewerVerdictSchema = z.object({
  decision: z.enum(["approve", "reject", "needs-revision"]),
  feedback: z.string().optional(),
  criteria: z.record(z.string(), z.unknown()).optional(),
  reasoning: z.string().optional(),
});

export type ReviewerVerdict = z.infer<typeof reviewerVerdictSchema>;

/** Input shape passed to a reviewer block — worker output plus task metadata. */
export const reviewerInputSchema = z.object({
  taskId: z.string(),
  goal: z.string(),
  attempts: z.number().int().nonnegative().default(1),
  workerOutput: z.unknown(),
  criteria: z.array(z.string()).optional(),
});

export type ReviewerInput = z.infer<typeof reviewerInputSchema>;

/** Planner output — task list. */
export const plannerOutputSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      goal: z.string(),
      assignee: z.string().optional(),
      deps: z.array(z.string()).optional(),
      priority: z.enum(["high", "medium", "low"]).optional(),
      context: z.string().optional(),
    }),
  ),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

/**
 * Legacy worker input shape — `{ id, goal, context?, feedback? }`.
 * `legacyWorkerAdapter` detects this schema by reference equality and
 * adapts the substrate's `TaskWorkerInput` into it before invoking a
 * pre-migration worker.
 */
export const executableTaskSchema = z.object({
  id: z.string(),
  goal: z.string(),
  context: z.string().optional(),
  feedback: z.string().optional(),
});

export type ExecutableTask = z.infer<typeof executableTaskSchema>;

/** Legacy aggregate review output. Preserved for back-compat imports only. */
export const reviewOutputSchema = z.object({
  assessments: z.array(
    z.object({
      taskId: z.string(),
      verdict: z.enum(["accepted", "needs-revision", "escalate"]),
      feedback: z.string(),
      score: z.number().min(0).max(1),
    }),
  ),
  needsReplanning: z.boolean(),
  overallAssessment: z.string(),
});

export type ReviewOutput = z.infer<typeof reviewOutputSchema>;

export type SubTaskErrorStrategy = "skip" | "fail" | "retry";

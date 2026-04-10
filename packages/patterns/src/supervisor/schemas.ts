import { z } from "zod";

export const supervisorInputSchema = z.object({
  goal: z.string().describe("The goal to supervise"),
});

export type SupervisorInput = z.infer<typeof supervisorInputSchema>;

export const supervisorPlanTaskSchema = z.object({
  id: z.string(),
  goal: z.string(),
  // Quality-gate statuses — tasks initialize directly as in_progress (dispatched immediately via forEach)
  status: z.enum([
    "in_progress",
    "completed",
    "failed",
    "skipped",
    "needs-revision",
    "escalated",
  ]),
  result: z.unknown().optional(),
  feedback: z.string().optional(),
  error: z.string().optional(),
});

export const supervisorStateSchema = z.object({
  goal: z.string().default(""),
  plan: z.array(supervisorPlanTaskSchema).default([]),
  iteration: z.number().default(0),
  acceptedResults: z.array(z.unknown()).default([]),
});

export type SupervisorState = z.infer<typeof supervisorStateSchema>;

export const reviewOutputSchema = z.object({
  assessments: z.array(
    z.object({
      taskId: z.string(),
      verdict: z.enum(["accepted", "needs-revision", "escalate"]),
      feedback: z.string(),
      score: z.number().min(0).max(1),
    })
  ),
  needsReplanning: z.boolean(),
  overallAssessment: z.string(),
});

export type ReviewOutput = z.infer<typeof reviewOutputSchema>;

/** Schema for the planner output (decomposed tasks). */
export const plannerOutputSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      goal: z.string(),
      deps: z.array(z.string()).optional(),
      priority: z.enum(["high", "medium", "low"]).optional(),
    })
  ),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

/** Schema for the updatePlanState output — executable tasks for forEach dispatch. */
export const executableTaskSchema = z.object({
  id: z.string(),
  goal: z.string(),
  feedback: z.string().optional(),
});

export type ExecutableTask = z.infer<typeof executableTaskSchema>;

export const executableTasksSchema = z.array(executableTaskSchema);

/** Schema for the applyReview output — drives the loopBack condition. */
export const applyReviewOutputSchema = z.object({
  needsReplanning: z.boolean(),
});

export type SubTaskErrorStrategy = "skip" | "fail" | "retry";

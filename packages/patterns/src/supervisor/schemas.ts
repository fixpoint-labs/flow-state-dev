import { z } from "zod";

export const supervisorInputSchema = z.object({
  goal: z.string().describe("The goal to supervise"),
});

export type SupervisorInput = z.infer<typeof supervisorInputSchema>;

export const supervisorStateSchema = z.object({
  goal: z.string().default(""),
  plan: z
    .array(
      z.object({
        id: z.string(),
        goal: z.string(),
        // Quality-gate statuses — intentionally different from Plan & Execute's execution-state statuses
        status: z.enum(["pending", "completed", "needs-revision", "escalated"]),
        result: z.unknown().optional(),
        feedback: z.string().optional(),
      })
    )
    .default([]),
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

export type SubTaskErrorStrategy = "skip" | "fail" | "retry";

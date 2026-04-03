import { z } from "zod";

// ---------------------------------------------------------------------------
// Plan Task
// ---------------------------------------------------------------------------

export const PlanTaskSchema = z.object({
  id: z.string(),
  goal: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "failed", "skipped"]),
  dependencies: z.array(z.string()).default([]),
  result: z.any().optional(),
  error: z.string().optional(),
});

export type PlanTask = z.infer<typeof PlanTaskSchema>;

// Backward-compat aliases
export const PlanStepSchema = PlanTaskSchema;
export type PlanStep = PlanTask;

// ---------------------------------------------------------------------------
// Plan (kept as a type alias for the snapshot shape)
// ---------------------------------------------------------------------------

export const PlanSchema = z.object({
  goal: z.string(),
  tasks: z.array(PlanTaskSchema),
  status: z.enum(["planning", "executing", "replanning", "completed", "failed"]),
  currentStepIndex: z.number().default(0),
  iteration: z.number().default(0),
  maxIterations: z.number().default(3),
});

export type Plan = z.infer<typeof PlanSchema>;

// ---------------------------------------------------------------------------
// Sequencer State Schema
// Replaces the session resource collection. Plan state lives on the outer
// planAndExecute sequencer — no defineFlow registration required.
// ---------------------------------------------------------------------------

export const planAndExecuteStateSchema = z.object({
  goal: z.string().default(""),
  tasks: z.array(PlanTaskSchema).default([]),
  status: z.enum(["planning", "executing", "replanning", "completed", "failed"]).default("planning"),
  iteration: z.number().default(0),
  maxIterations: z.number().default(3),
});

export type PlanAndExecuteState = z.infer<typeof planAndExecuteStateSchema>;

// ---------------------------------------------------------------------------
// Input / Output Schemas
// ---------------------------------------------------------------------------

export const planAndExecuteInputSchema = z.object({
  goal: z.string().describe("The goal to plan and execute"),
});

export type PlanAndExecuteInput = z.infer<typeof planAndExecuteInputSchema>;

/** Output of each iteration in the loop. */
export const iterationOutputSchema = z.object({
  decision: z.enum(["continue", "replan", "complete"]),
});

export type IterationOutput = z.infer<typeof iterationOutputSchema>;

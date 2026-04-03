import { z } from "zod";
import { defineResourceCollection } from "@flow-state-dev/core";

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
// Plan
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
// Resource Collection
// ---------------------------------------------------------------------------

export const planCollection = defineResourceCollection({
  pattern: "plans/[planId]",
  stateSchema: PlanSchema,
  maxInstances: 50,
  eviction: "none",
});

/** Convenience spread for defineFlow({ session: { resources: { ...planResources } } }) */
export const planResources = { plans: planCollection } as const;

// ---------------------------------------------------------------------------
// Input / Output Schemas
// ---------------------------------------------------------------------------

export const planAndExecuteInputSchema = z.object({
  goal: z.string().describe("The goal to plan and execute"),
});

export type PlanAndExecuteInput = z.infer<typeof planAndExecuteInputSchema>;

/** Output of each iteration in the doUntil loop. */
export const iterationOutputSchema = z.object({
  planId: z.string(),
  decision: z.enum(["continue", "replan", "complete"]),
});

export type IterationOutput = z.infer<typeof iterationOutputSchema>;

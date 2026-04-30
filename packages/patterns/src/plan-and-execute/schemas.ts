/**
 * Schemas for the plan-and-execute pattern.
 *
 * After the FIX-447 migration onto the taskBoard substrate, the pattern's
 * own state is intentionally minimal — task storage lives on the request-
 * scoped TaskCollection (see `getOrCreateTaskCollection({ backing: "request" })`)
 * and the outer sequencer only tracks the original goal, an optional
 * pattern-specific status, and the iteration counter consumed by the
 * replan loop.
 *
 * `PlanTaskSchema` and `PlanSchema` are kept as legacy exports so
 * external consumers that imported them before the migration keep
 * compiling. New code should depend on the substrate `Task` type from
 * `@flow-state-dev/tasks` instead.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Legacy plan task / plan shapes (kept for backward compat)
// ---------------------------------------------------------------------------

/** Legacy P&E task shape — preserved for output compatibility. */
export const PlanTaskSchema = z.object({
  id: z.string(),
  goal: z.string(),
  status: z.enum(["pending", "in-progress", "completed", "failed", "skipped"]),
  dependencies: z.array(z.string()).default([]),
  result: z.any().optional(),
  error: z.string().optional(),
});

export type PlanTask = z.infer<typeof PlanTaskSchema>;

/** Backward-compat alias — pre-migration the task type was named `PlanStep`. */
export const PlanStepSchema = PlanTaskSchema;
export type PlanStep = PlanTask;

/** Legacy plan shape — preserved for the synthesizer's input contract. */
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
// Sequencer state (post-migration: minimal)
// ---------------------------------------------------------------------------

/**
 * Outer sequencer state for plan-and-execute.
 *
 * Tasks themselves live on the request-scoped TaskCollection — they are
 * NOT stored here. `iteration` is owned by the replan loop and bumped
 * by `evaluatePlanProgress`; `status` is a pattern-level status used
 * for the `task-board-meta` extensions (`planning | executing |
 * replanning | synthesizing`).
 */
export const planAndExecuteStateSchema = z.object({
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
});

export type PlanAndExecuteState = z.infer<typeof planAndExecuteStateSchema>;

// ---------------------------------------------------------------------------
// Input / iteration output
// ---------------------------------------------------------------------------

export const planAndExecuteInputSchema = z.object({
  goal: z.string().describe("The goal to plan and execute"),
});

export type PlanAndExecuteInput = z.infer<typeof planAndExecuteInputSchema>;

/**
 * Output of each iteration in the replan loop. The `loopBack` predicate
 * exits when `decision === "complete"`.
 */
export const iterationOutputSchema = z.object({
  decision: z.enum(["continue", "replan", "complete"]),
});

export type IterationOutput = z.infer<typeof iterationOutputSchema>;

// ---------------------------------------------------------------------------
// Evaluator verdict (extended shape)
// ---------------------------------------------------------------------------

/**
 * Evaluator output. Custom evaluators may return `score` / `feedback` /
 * `reasoning` for richer telemetry, and may pre-bake `tasks` to skip the
 * replanner step when `decision === "replan"`.
 */
export const evaluatorVerdictSchema = z.object({
  decision: z.enum(["continue", "complete", "replan"]),
  score: z.number().optional(),
  feedback: z.string().optional(),
  reasoning: z.string().optional(),
  tasks: z.array(z.unknown()).optional(),
});

export type EvaluatorVerdict = z.infer<typeof evaluatorVerdictSchema>;

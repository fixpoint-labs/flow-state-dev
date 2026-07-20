/**
 * Deprecated plan/task type shapes. Pre-substrate (P&E + supervisor) used these
 * to drive the `plan-meta`/`plan-task` ComponentItems. Both patterns now run on
 * `@flow-state-dev/orchestration` and emit `task-change` + `task-board-meta` instead.
 *
 * Types are kept exported for backward compatibility with consumers that imported
 * them from `@flow-state-dev/patterns`. They're not used internally.
 *
 * @deprecated Use the substrate's `Task` type from `@flow-state-dev/orchestration`
 *             and the `task-change` / `task-board-meta` ComponentItem shapes.
 */
import { z } from "zod";

/**
 * Base schema for a plan task.
 *
 * @deprecated Use the substrate's `Task` type from `@flow-state-dev/orchestration`.
 */
export const BasePlanTaskSchema = z.object({
  id: z.string(),
  goal: z.string(),
  assignee: z.string().optional(),
  status: z.enum([
    "pending",
    "in-progress",
    "awaiting-review",
    "completed",
    "failed",
    "skipped",
    "needs-revision",
    "escalated",
  ]),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

/** @deprecated Use the substrate's `Task` type from `@flow-state-dev/orchestration`. */
export type BasePlanTask = z.infer<typeof BasePlanTaskSchema>;

/**
 * Base schema for a plan.
 *
 * @deprecated Use the substrate's `TaskCollection` from `@flow-state-dev/orchestration`.
 */
export const BasePlanSchema = z.object({
  goal: z.string(),
  tasks: z.array(BasePlanTaskSchema),
  status: z
    .enum(["planning", "executing", "replanning", "reviewing", "completed", "failed"])
    .optional(),
  iteration: z.number().optional(),
});

/** @deprecated Use the substrate's `TaskCollection` from `@flow-state-dev/orchestration`. */
export type BasePlan = z.infer<typeof BasePlanSchema>;

/** @deprecated Use `task-board-meta` ComponentItem data shape instead. */
export type PlanMeta = {
  goal: string;
  taskOrder: string[];
  taskGoals: Record<string, string>;
  status?: string;
  iteration?: number;
};

/** @deprecated Use `task-change` ComponentItem data shape instead. */
export type PlanTaskUpdate = {
  id: string;
  goal: string;
  status: string;
  result?: unknown;
  error?: string;
  feedback?: string;
  assignee?: string;
};

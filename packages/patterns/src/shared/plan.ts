import { z } from "zod";

// ---------------------------------------------------------------------------
// Base Task
// ---------------------------------------------------------------------------

/**
 * Base schema for a plan task. All plan-oriented patterns extend this.
 *
 * Status vocabulary:
 *   - pending         P&E only — queued, waiting its turn
 *   - in-progress      both — actively executing
 *   - awaiting-review Supervisor only — worker done, pending reviewer verdict
 *   - completed       both — done successfully
 *   - failed          P&E only — hard failure
 *   - skipped         P&E only — bypassed (dependency not met or explicitly skipped)
 *   - needs-revision  Supervisor only — quality gate failed, needs rework
 *   - escalated       Supervisor only — out of scope, escalated
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

export type BasePlanTask = z.infer<typeof BasePlanTaskSchema>;

// ---------------------------------------------------------------------------
// Base Plan
// ---------------------------------------------------------------------------

/**
 * Base schema for a plan. Both plan-and-execute and supervisor produce
 * values conforming to this shape for emitComponent and clientData.
 *
 * `status` and `iteration` are optional — supervisor omits the plan-level
 * status since it's derived from the review loop, and not all patterns
 * track iterations at the plan level.
 */
export const BasePlanSchema = z.object({
  goal: z.string(),
  tasks: z.array(BasePlanTaskSchema),
  status: z
    .enum(["planning", "executing", "replanning", "reviewing", "completed", "failed"])
    .optional(),
  iteration: z.number().optional(),
});

export type BasePlan = z.infer<typeof BasePlanSchema>;

// ---------------------------------------------------------------------------
// Granular emission types
// ---------------------------------------------------------------------------

/** Data shape for the plan-meta ComponentItem. */
export type PlanMeta = {
  goal: string;
  taskOrder: string[];
  taskGoals: Record<string, string>;
  status?: string;
  iteration?: number;
};

/** Data shape for a plan-task ComponentItem. */
export type PlanTaskUpdate = {
  id: string;
  goal: string;
  status: string;
  result?: unknown;
  error?: string;
  assignee?: string;
};

// Minimal context type accepted by emission helpers.
type EmitCtx = {
  emitComponent: (
    component: string,
    data: Record<string, unknown>,
    options?: { key?: string },
  ) => { done(): void };
};

// ---------------------------------------------------------------------------
// Granular emit helpers
// ---------------------------------------------------------------------------

/**
 * Emit plan-level metadata (goal, task ordering, status) as a keyed
 * ComponentItem. The `taskOrder` array is the authoritative render order
 * and `taskGoals` lets the UI show labels before individual task items
 * arrive.
 */
export function emitPlanMeta(
  ctx: EmitCtx,
  meta: PlanMeta,
  options?: { key?: string },
): void {
  const key = options?.key ? `${options.key}:plan-meta` : "plan-meta";
  ctx.emitComponent(
    "plan-meta",
    meta as unknown as Record<string, unknown>,
    { key },
  ).done();
}

/**
 * Emit a single task update as a keyed ComponentItem. The key is derived
 * from the task ID so each task's item is deduplicated independently.
 */
export function emitTaskUpdate(
  ctx: EmitCtx,
  task: PlanTaskUpdate,
  options?: { key?: string },
): void {
  const prefix = options?.key ? `${options.key}:` : "";
  const key = `${prefix}plan-task:${task.id}`;
  ctx.emitComponent(
    "plan-task",
    task as unknown as Record<string, unknown>,
    { key },
  ).done();
}

// ---------------------------------------------------------------------------
// Legacy emit helper (deprecated)
// ---------------------------------------------------------------------------

/**
 * Emit a point-in-time plan snapshot into the chat stream as a ComponentItem.
 *
 * @deprecated Use {@link emitPlanMeta} + {@link emitTaskUpdate} instead.
 * This function now delegates to the granular helpers. Kept as a migration
 * bridge — will be removed in a future release.
 */
export function emitPlanSnapshot(
  ctx: EmitCtx,
  plan: BasePlan,
  options?: { key?: string },
): void {
  emitPlanMeta(ctx, {
    goal: plan.goal,
    taskOrder: plan.tasks.map((t) => t.id),
    taskGoals: Object.fromEntries(plan.tasks.map((t) => [t.id, t.goal])),
    status: plan.status,
    iteration: plan.iteration,
  }, options);

  for (const task of plan.tasks) {
    emitTaskUpdate(ctx, {
      id: task.id,
      goal: task.goal,
      status: task.status,
      result: task.result,
      error: task.error,
      assignee: task.assignee,
    }, options);
  }
}

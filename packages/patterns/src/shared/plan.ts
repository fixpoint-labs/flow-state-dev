import { z } from "zod";

// ---------------------------------------------------------------------------
// Base Task
// ---------------------------------------------------------------------------

/**
 * Base schema for a plan task. All plan-oriented patterns extend this.
 *
 * Status vocabulary:
 *   - pending        P&E only — queued, waiting its turn
 *   - in_progress    both — actively executing
 *   - completed      both — done successfully
 *   - failed         P&E only — hard failure
 *   - skipped        P&E only — bypassed (dependency not met or explicitly skipped)
 *   - needs-revision Supervisor only — quality gate failed, needs rework
 *   - escalated      Supervisor only — out of scope, escalated
 */
export const BasePlanTaskSchema = z.object({
  id: z.string(),
  goal: z.string(),
  status: z.enum([
    "pending",
    "in_progress",
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
// Emit helper
// ---------------------------------------------------------------------------

/**
 * Emit a point-in-time plan snapshot into the chat stream as a ComponentItem.
 * Renderers can register a "plan" component to display it; if none is registered
 * the item is silently ignored.
 *
 * Call this at key lifecycle moments (plan created, task completed, review applied).
 */
export function emitPlanSnapshot(
  ctx: { emitComponent: (component: string, data: Record<string, unknown>) => { done(): void } },
  plan: BasePlan
): void {
  ctx.emitComponent("plan", plan as unknown as Record<string, unknown>).done();
}

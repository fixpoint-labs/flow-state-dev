/**
 * The one test of whether a turn is a task turn: a turn the receiving gate
 * serves, working the row a hand-off claimed (FIX-1816 BR-5a, FIX-1817 S1).
 *
 * Defined here once, and imported wherever a rule depends on it: an ask
 * (`addTask({ waitForResponse })`) is refused on a task turn, so asks never
 * nest, and FIX-1817's question park is offered only on one.
 *
 * Read from server-set state only, never from input (BP-031):
 *
 * - **The claim.** The gate (and an inline drain's worker body) stamps the
 *   claim it holds into the turn's async scope before the turn runs
 *   (`currentWorkerClaim`). Nothing else stamps it.
 * - **The task session.** A board's hand-over opens a task session born
 *   naming its task in session state under {@link TASK_SESSION_TASK_KEY}, a
 *   field the session's flow declares readonly and refuses at create from any
 *   caller but the hand-over. It outlives the claim's async scope, so a turn
 *   replayed after a park is still known for what it is.
 *
 * A flow that lets a caller write that field can only make its own turns
 * refuse to wait: the test never grants anything.
 */
import { currentWorkerClaim } from "./flow-policy-wiring";

/**
 * The session-state field a task session's hand-over names its task in.
 * Workforce's conversation board writes it (its `TASK_ID_STATE_KEY` is this
 * field, held equal by a test).
 */
export const TASK_SESSION_TASK_KEY = "taskId";

/** Whether the running turn is a task turn: a turn the gate serves, on the row it claimed. */
export function isTaskTurn(ctx: { readonly session?: { readonly state?: unknown } }): boolean {
  if (currentWorkerClaim() !== undefined) return true;
  const state = ctx.session?.state as Record<string, unknown> | undefined;
  return typeof state?.[TASK_SESSION_TASK_KEY] === "string";
}

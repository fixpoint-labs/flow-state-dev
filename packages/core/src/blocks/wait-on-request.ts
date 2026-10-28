/**
 * `waitOnRequest` — park the running request on the one wait gate, bound to a
 * request that already exists, and map how that request ended (FIX-2239).
 *
 * The park half of `dispatcher({ wait: true })`: it sends nothing. A caller
 * that dispatches sends first, under its own `runOnce` key, then waits here; a
 * caller that waits again on a request it already started only waits. The
 * caller runs its own checks before anything is written (the host can hold a
 * wait, the chain's depth), since what counts as "written" is the caller's.
 */
import type { BlockContext } from "../types/block";
import { parkOnWait } from "../types/wait-gate";

/** Arguments to {@link waitOnRequest}. */
export type WaitOnRequestInput = {
  /** The request to wait on. Its ending resumes this one. */
  readonly requestId: string;
  /**
   * The gate's id on the first plan, unique within the session. Only that first
   * value counts: it is kept under `planKey`, so a replay parks on the stored id
   * even when the caller passes a fresh one.
   */
  readonly gateId: string;
  /**
   * The `runOnce` key the wait's plan (its gate and deadline) is kept under,
   * so a replay parks on the same gate with the same deadline.
   */
  readonly planKey: string;
  /** How long to wait, in ms from now. The host's default when unset. */
  readonly deadlineMs?: number;
  /**
   * When to stop waiting (epoch ms), for a caller that parks more than once
   * under one deadline. Wins over `deadlineMs`.
   */
  readonly deadlineAt?: number;
  /** Shown wherever the suspension is listed. */
  readonly message?: string;
};

/**
 * How the waited-on request ended: its output, its error, or `running` when the
 * deadline came first or a person stopped the waiting request. Nothing stops
 * the waited-on request.
 */
export type RequestWaitOutcome =
  | { readonly status: "completed"; readonly output: unknown }
  | { readonly status: "failed"; readonly error: string }
  | { readonly status: "running" };

/**
 * Park on the wait gate until the request `requestId` ends or the deadline
 * comes. A person stopping the waiting request ends it, and the waited-on
 * request runs on.
 *
 * Needs a durable host that keeps wakes (`canHoldWait`); the caller checks
 * that first, and this throws without `ctx.runOnce` or `RequestHost.waits`.
 */
export async function waitOnRequest(ctx: BlockContext, input: WaitOnRequestInput): Promise<RequestWaitOutcome> {
  const waits = ctx.requestHost?.waits;
  if (waits === undefined || ctx.runOnce === undefined) {
    throw new Error("waitOnRequest needs a host that can hold a wait (ctx.runOnce and RequestHost.waits).");
  }
  const planned = await ctx.runOnce(input.planKey, async () => ({
    gateId: input.gateId,
    deadline: input.deadlineAt ?? Date.now() + (input.deadlineMs ?? waits.deadlines.defaultMs)
  }));
  const outcome = await parkOnWait(ctx, {
    gateId: planned.gateId,
    binding: { requestId: input.requestId },
    deadline: planned.deadline,
    ...(input.message !== undefined ? { message: input.message } : {})
  });
  if (outcome.answered) return { status: "completed", output: outcome.answer };
  if ("deadline" in outcome) return { status: "running" };
  if ("stopped" in outcome) {
    // A person stopped this request: it ends, and the work it waits on runs on.
    await ctx.session?.stopRequest?.(ctx.request.identity.id);
    return { status: "running" };
  }
  return { status: "failed", error: outcome.error.message };
}

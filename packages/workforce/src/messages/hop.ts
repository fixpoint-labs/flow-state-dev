/**
 * Server-owned hop count (FIX-1989 D2): worker messages since the last
 * person's turn. A person's turn writes 0; a message's turn writes that
 * message's count; a task session is born with its filer's count. A send
 * uses the turn's count plus one. The task chain is a different counter.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";

/** The session-state field a session's current hop count is kept in. Server-owned. */
export const MESSAGE_HOP_STATE = "workforceMessageHop";

/** The request-state field a turn's hop count is copied to, and the per-turn send count beside it. */
export const TURN_HOP_STATE = "workforceTurnHop";
export const TURN_SENT_STATE = "workforceMessagesSent";

/** The session state a flow that takes messages declares. */
export const messageHopStateShape = {
  [MESSAGE_HOP_STATE]: z.number().int().nonnegative().default(0)
} as const;

/** The request state the hop and the per-turn count are kept in. */
export const messageTurnStateSchema = z.object({
  [TURN_HOP_STATE]: z.number().int().nonnegative().optional(),
  [TURN_SENT_STATE]: z.number().int().nonnegative().optional()
});

/** A session's current hop count: 0 for one that keeps none. */
export function sessionHopOf(state: unknown): number {
  const value = (state as Record<string, unknown> | undefined)?.[MESSAGE_HOP_STATE];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** The running turn's hop count: what its start copied to request state, else the session's. */
export function turnHopOf(ctx: Pick<BlockContext, "request" | "session">): number {
  const value = (ctx.request?.state as Record<string, unknown> | undefined)?.[TURN_HOP_STATE];
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  return sessionHopOf(ctx.session.state);
}

/**
 * Start this turn at `hop`: the session's current count, and this request's.
 * The session field is written only on a flow that keeps it.
 *
 * @param also More request state to write in the same patch.
 */
export async function startTurnAtHop(ctx: BlockContext, hop: number, also: Record<string, unknown> = {}): Promise<void> {
  const state = ctx.session.state as Record<string, unknown> | undefined;
  if (typeof state?.[MESSAGE_HOP_STATE] === "number" && state[MESSAGE_HOP_STATE] !== hop) {
    await ctx.session.patchState({ [MESSAGE_HOP_STATE]: hop } as never);
  }
  await ctx.request.patchState({ ...also, [TURN_HOP_STATE]: hop, [TURN_SENT_STATE]: 0 } as never);
}

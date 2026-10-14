/**
 * The hop count (FIX-1989 D2): how many worker messages a turn is from the
 * last user's turn, so a ring of workers passing messages on stops however
 * many workers it goes through.
 *
 * Written by the server only. A session keeps its current count in a
 * server-owned session-state field; a turn copies it into request state when
 * it starts from something that sets it:
 *
 * - a user's turn writes 0, at the user-turn mark (`markUserTurn`);
 * - a turn a message wakes is at that message's count (`onWorkerMessage`);
 * - a task session is born with its filer's current count, beside the task
 *   chain fields the hand-over sets;
 * - every other turn (a notice's, a post's, a task's) reads the session's.
 *
 * A message is sent at its turn's count plus one. Messages never touch the
 * task chain, and the task chain never touches this.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";

/** The session-state field a session's current hop count is kept in. Server-owned. */
export const MESSAGE_HOP_STATE = "workforceMessageHop";

/** The request-state field a turn's hop count is copied to, and the per-turn send count beside it. */
export const TURN_HOP_STATE = "workforceTurnHop";
export const TURN_SENT_STATE = "workforceMessagesSent";
/** The request-state field the workers this turn has messaged are kept in. */
export const TURN_MESSAGED_STATE = "workforceMessagedWorkers";

/** The session state a flow that takes messages declares. */
export const messageHopStateShape = {
  [MESSAGE_HOP_STATE]: z.number().int().nonnegative().default(0)
} as const;

/** The request state the hop and the per-turn count are kept in. */
export const messageTurnStateSchema = z.object({
  [TURN_HOP_STATE]: z.number().int().nonnegative().optional(),
  [TURN_SENT_STATE]: z.number().int().nonnegative().optional(),
  [TURN_MESSAGED_STATE]: z.array(z.string()).optional()
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
 * The session field is written only when it would read differently, so a
 * session that keeps none (absent reads 0) is written the first time a
 * message moves it off 0, and a user's turn on a flow without the field
 * writes nothing.
 *
 * @param also More request state to write in the same patch.
 */
export async function startTurnAtHop(ctx: BlockContext, hop: number, also: Record<string, unknown> = {}): Promise<void> {
  if (sessionHopOf(ctx.session.state) !== hop) {
    await ctx.session.patchState({ [MESSAGE_HOP_STATE]: hop } as never);
  }
  await ctx.request.patchState({ ...also, [TURN_HOP_STATE]: hop, [TURN_SENT_STATE]: 0, [TURN_MESSAGED_STATE]: [] } as never);
}

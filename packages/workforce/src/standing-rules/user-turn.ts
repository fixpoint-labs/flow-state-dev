/**
 * The mark on a turn a user's own message started (FIX-1945 S3, D2): only
 * a marked turn is offered the rule tools, and a rule tool refuses on any
 * other.
 *
 * An allowlist, set on each door a user's message comes through: the
 * agent flow's public `run` action and the coordinator's round-0 post. Every
 * other entry point (a task turn, a coordinator's post to a delegate, a
 * delegate's answer reaching a coordinator, a task-ended notice, a
 * workstream's open) never sets it, so an entry point added later is safe by
 * default. Kept in request state, which only the server writes and a resumed
 * request keeps.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { messageTurnStateSchema, newChainId, sessionUserLinesOf, startTurnAtHop, USER_LINES_STATE } from "../messages/hop";
import { FILING_SESSION_STATE_KEY, TASK_ID_STATE_KEY } from "../workers/keys";

/** The request-state field the mark is kept in. */
export const USER_TURN_STATE = "workforceUserTurn";

/** The request state the mark is kept in. */
export const userTurnStateSchema = z.object({ [USER_TURN_STATE]: z.boolean().optional() }).merge(messageTurnStateSchema);

/**
 * Mark this request as a user's turn. Skips a task session and a
 * conversation's delegate session: that message is task input. A user's
 * turn also starts the worker-message hop count again, at 0 in a new chain
 * (FIX-1989 D2), and counts one more user's line on the session (FIX-2106).
 *
 * Once the task and every follow-up in its session have ended, a user's line
 * there is still no user's turn (no rule tools), but it is one a user typed:
 * it starts a fresh budget all the same (FIX-2238).
 */
export async function markUserTurn(ctx: BlockContext): Promise<void> {
  const state = (ctx.session.state ?? {}) as Record<string, unknown>;
  const taskId = state[TASK_ID_STATE_KEY];
  let mark: Record<string, unknown> = { [USER_TURN_STATE]: true };
  if (typeof taskId === "string") {
    // The same read that sends the line to the task as a steer while it is open.
    // Loaded here, not at the top: its module graph reaches back to this one.
    const { sessionTaskChainEnded } = await import("../conversation-board/steer");
    if (!(await sessionTaskChainEnded(ctx))) return;
    mark = {};
  } else if (typeof state[FILING_SESSION_STATE_KEY] === "string") {
    return;
  }
  await startTurnAtHop(ctx, 0, newChainId(), mark, (current) => ({
    [USER_LINES_STATE]: sessionUserLinesOf(current) + 1
  }));
}

/** Whether this request is a turn a user's own message started. */
export function isUserTurn(ctx: BlockContext): boolean {
  return (ctx.request.state as Record<string, unknown> | undefined)?.[USER_TURN_STATE] === true;
}

/** {@link markUserTurn} as a step, for a door whose message passes through untouched. */
export const markUserTurnStep = handler({
  name: "workforce-mark-user-turn",
  inputSchema: z.unknown(),
  outputSchema: z.object({}),
  requestStateSchema: userTurnStateSchema,
  execute: async (_input, ctx) => {
    await markUserTurn(ctx as never);
    return {};
  }
});

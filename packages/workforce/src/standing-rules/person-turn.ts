/**
 * The mark on a turn a person's own message started (FIX-1945 S3, D2): only
 * a marked turn is offered the rule tools, and a rule tool refuses on any
 * other.
 *
 * An allowlist, set on each door a person's message comes through: the
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
import { FILING_SESSION_STATE_KEY, TASK_ID_STATE_KEY } from "../workers/keys";

/** The request-state field the mark is kept in. */
export const PERSON_TURN_STATE = "workforcePersonTurn";

export const personTurnStateSchema = z.object({ [PERSON_TURN_STATE]: z.boolean().optional() });

/** Skip a task session and a conversation's delegate session: that message is task input. */
export async function markPersonTurn(ctx: BlockContext): Promise<void> {
  const state = (ctx.session.state ?? {}) as Record<string, unknown>;
  if (typeof state[TASK_ID_STATE_KEY] === "string" || typeof state[FILING_SESSION_STATE_KEY] === "string") return;
  await ctx.request.patchState({ [PERSON_TURN_STATE]: true } as never);
}

export function isPersonTurn(ctx: BlockContext): boolean {
  return (ctx.request.state as Record<string, unknown> | undefined)?.[PERSON_TURN_STATE] === true;
}

/** {@link markPersonTurn} as a step, for a door whose message passes through untouched. */
export const markPersonTurnStep = handler({
  name: "workforce-mark-person-turn",
  inputSchema: z.unknown(),
  outputSchema: z.object({}),
  requestStateSchema: personTurnStateSchema,
  execute: async (_input, ctx) => {
    await markPersonTurn(ctx as never);
    return {};
  }
});

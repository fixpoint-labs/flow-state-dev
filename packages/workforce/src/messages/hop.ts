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
 * - a task's turn is at its filing turn's count, which the filing records on
 *   the row (FIX-2106), so a task run in an existing session (an ongoing one,
 *   or a follow-up's) counts on from its filer too. The record stands only
 *   while its chain is still the filer session's current chain when the
 *   board claims the row: a user's line in the filer's conversation since the
 *   filing ended that chain, so the claim clears the record and the turn runs
 *   as a row with none. A row with none (one filed before rows recorded it)
 *   reads its born-with count, or its session's;
 * - every other turn (a notice's, a post's) reads the session's.
 *
 * The limit is the whole exchange's, not one path's: everything descending
 * from one user's turn shares one budget. A user's turn starts a new chain id
 * beside the 0, and the chain id travels with the count everywhere above (a
 * message row carries it, a woken turn and a filed task take it). Each send
 * appends its message id to the chain's row in the user's scope, one guarded
 * write, and its count is its place in that row, so two branches sending at
 * once both count. A send is refused once that place passes the limit.
 *
 * Messages never touch the task chain, and the task chain never touches this.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";

/** The session-state field a session's current hop count is kept in. Server-owned. */
export const MESSAGE_HOP_STATE = "workforceMessageHop";

/** The session-state field the chain id a session's count belongs to is kept in. Server-owned. */
export const MESSAGE_CHAIN_STATE = "workforceMessageChain";

/** The request-state field a turn's chain id is copied to. */
export const TURN_CHAIN_STATE = "workforceTurnChain";

/** The request-state field a turn's hop count is copied to, and the per-turn send count beside it. */
export const TURN_HOP_STATE = "workforceTurnHop";
export const TURN_SENT_STATE = "workforceMessagesSent";
/** The request-state field the workers this turn has messaged are kept in. */
export const TURN_MESSAGED_STATE = "workforceMessagedWorkers";

/** The session state a flow that takes messages declares. */
export const messageHopStateShape = {
  [MESSAGE_HOP_STATE]: z.number().int().nonnegative().default(0),
  [MESSAGE_CHAIN_STATE]: z.string().nullable().default(null)
} as const;

/** The request state the hop and the per-turn count are kept in. */
export const messageTurnStateSchema = z.object({
  [TURN_HOP_STATE]: z.number().int().nonnegative().optional(),
  [TURN_CHAIN_STATE]: z.string().nullable().optional(),
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

/** A new chain id, for a user's turn. */
export function newChainId(): string {
  return `chain_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

/** A session's current chain id, or `undefined` for one that keeps none. */
export function sessionChainOf(state: unknown): string | undefined {
  const value = (state as Record<string, unknown> | undefined)?.[MESSAGE_CHAIN_STATE];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The running turn's chain id: what its start copied to request state, else the session's. */
export function turnChainOf(ctx: Pick<BlockContext, "request" | "session">): string | undefined {
  const request = ctx.request?.state as Record<string, unknown> | undefined;
  if (request !== undefined && Object.hasOwn(request, TURN_CHAIN_STATE)) {
    const value = request[TURN_CHAIN_STATE];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }
  return sessionChainOf(ctx.session.state);
}

/** The hop count and chain a task's session is born with: its filer's, so the task counts on in the filer's exchange. */
export function carriedHopState(state: unknown): Record<string, unknown> {
  return { [MESSAGE_HOP_STATE]: sessionHopOf(state), [MESSAGE_CHAIN_STATE]: sessionChainOf(state) ?? null };
}

/** Where a turn stands in its exchange: its hop count, and the chain it belongs to. */
export interface HopMark {
  readonly hop: number;
  readonly chain: string | null;
}

/** The running turn's count and chain, for a filing to record on its row (FIX-2106). */
export function turnHopMark(ctx: Pick<BlockContext, "request" | "session">): HopMark {
  return { hop: turnHopOf(ctx), chain: turnChainOf(ctx) ?? null };
}

const hopMarkSchema = z.object({ hop: z.number().int().nonnegative(), chain: z.string().min(1).nullable() });

/** A recorded {@link HopMark}, or `undefined` for anything else (a row filed before rows recorded one). */
export function hopMarkOf(value: unknown): HopMark | undefined {
  const parsed = hopMarkSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Start this turn at `hop` in `chain`: the session's current count and chain,
 * and this request's. The session fields are written only when they would
 * read differently. A `null` chain (a message row from before rows carried
 * one) leaves the turn to start one at its first send.
 *
 * @param also More request state to write in the same patch.
 */
export async function startTurnAtHop(ctx: BlockContext, hop: number, chain: string | null, also: Record<string, unknown> = {}): Promise<void> {
  if (sessionHopOf(ctx.session.state) !== hop || (sessionChainOf(ctx.session.state) ?? null) !== chain) {
    await ctx.session.patchState({ [MESSAGE_HOP_STATE]: hop, [MESSAGE_CHAIN_STATE]: chain } as never);
  }
  await ctx.request.patchState({
    ...also,
    [TURN_HOP_STATE]: hop,
    [TURN_CHAIN_STATE]: chain,
    [TURN_SENT_STATE]: 0,
    [TURN_MESSAGED_STATE]: []
  } as never);
}

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
 * - a turn a message wakes is at that message's count (`onMessageReceived`);
 * - a task session is born with its filer's current count, beside the task
 *   chain fields the hand-over sets;
 * - a task's turn is at its filing turn's count, which the filing records on
 *   the row (FIX-2106), so a task run in an existing session (an ongoing one,
 *   or a follow-up's) counts on from its filer too. The record stands until
 *   a user's line in the filer's conversation: the record keeps how many user
 *   lines that session had seen at the filing, and a claim that finds more
 *   clears it, so the turn runs as a row with none. A message from another
 *   chain moving the filer's session elsewhere leaves it standing. A row with
 *   none (one filed before rows recorded it) reads its born-with count, or
 *   its session's;
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

/**
 * The session-state field counting the user's lines a session has taken, one
 * per user's turn (`markUserTurn`), so a filed task's record can tell whether
 * the user wrote there since (FIX-2106). Server-owned. Absent reads 0.
 */
export const USER_LINES_STATE = "workforceUserLines";

/** The request-state field a turn's chain id is copied to. */
export const TURN_CHAIN_STATE = "workforceTurnChain";

/** The request-state field a turn's hop count is copied to, and the per-turn send count beside it. */
export const TURN_HOP_STATE = "workforceTurnHop";
export const TURN_SENT_STATE = "workforceMessagesSent";
/** The request-state field naming the ids the per-turn count already holds, so a send repeated after a crash pays once (FIX-2269). */
export const TURN_PAID_STATE = "workforceMessagesPaid";

/** The session state a flow that takes messages declares. */
export const messageHopStateShape = {
  [MESSAGE_HOP_STATE]: z.number().int().nonnegative().default(0),
  [MESSAGE_CHAIN_STATE]: z.string().nullable().default(null),
  [USER_LINES_STATE]: z.number().int().nonnegative().default(0)
} as const;

/** The request-state field naming the call an `onMessageReceived` request answers (FIX-2239), so its reply step marks the row. */
export const RECEIVED_CALL_STATE = "workforceReceivedCall";

/** The request-state field saying an `onMessageReceived` request landed its message, so its reply step reads it by construction. */
export const RECEIVED_LANDED_STATE = "workforceReceivedLanded";

/** The request state the hop and the per-turn count are kept in. */
export const messageTurnStateSchema = z.object({
  [TURN_HOP_STATE]: z.number().int().nonnegative().optional(),
  [TURN_CHAIN_STATE]: z.string().nullable().optional(),
  [TURN_SENT_STATE]: z.number().int().nonnegative().optional(),
  [TURN_PAID_STATE]: z.array(z.string()).optional(),
  [RECEIVED_CALL_STATE]: z.string().optional(),
  [RECEIVED_LANDED_STATE]: z.boolean().optional()
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

/** How many user's lines a session has taken: 0 for one that counts none. */
export function sessionUserLinesOf(state: unknown): number {
  const value = (state as Record<string, unknown> | undefined)?.[USER_LINES_STATE];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
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

/**
 * Where a turn stands in its exchange: its hop count, the chain it belongs to,
 * and how many user's lines its session had taken.
 */
export interface HopMark {
  readonly hop: number;
  readonly chain: string | null;
  readonly lines: number;
}

/** The running turn's count and chain, and its session's user lines, for a filing to record on its row (FIX-2106). */
export function turnHopMark(ctx: Pick<BlockContext, "request" | "session">): HopMark {
  return { hop: turnHopOf(ctx), chain: turnChainOf(ctx) ?? null, lines: sessionUserLinesOf(ctx.session.state) };
}

/**
 * The mark for a task filed held (FIX-2238): released, it starts a fresh
 * chain at 0, since no exchange waits on it. The chain is minted here, once,
 * so every request the task runs counts in the same budget. The filer's user
 * lines are kept, so a user's line since still clears it.
 */
export function freshHopMark(ctx: Pick<BlockContext, "session">): HopMark {
  return { hop: 0, chain: newChainId(), lines: sessionUserLinesOf(ctx.session.state) };
}

/**
 * Whether a filing holds its task from the start: filed `held`, or waiting on
 * questions. Released, such a task starts a fresh chain ({@link freshHopMark});
 * a midway hold carries its budget on.
 */
export function heldFromFiling(init: { readonly held?: boolean; readonly status?: string; readonly questions?: readonly unknown[] }): boolean {
  return init.held === true || init.status === "held" || (init.questions?.length ?? 0) > 0;
}

const hopMarkSchema = z.object({
  hop: z.number().int().nonnegative(),
  chain: z.string().min(1).nullable(),
  lines: z.number().int().nonnegative()
});

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
 * @param alsoSession More session state for the session's write, worked out
 *   from the session's state as that write reads it (again on a retry), so a
 *   count kept there loses no step to a write that landed first. Written only
 *   when the session's count or chain moves, in the same atomic write.
 */
export async function startTurnAtHop(
  ctx: BlockContext,
  hop: number,
  chain: string | null,
  also: Record<string, unknown> = {},
  alsoSession?: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>
): Promise<void> {
  if (sessionHopOf(ctx.session.state) !== hop || (sessionChainOf(ctx.session.state) ?? null) !== chain) {
    const fields = { [MESSAGE_HOP_STATE]: hop, [MESSAGE_CHAIN_STATE]: chain };
    await (alsoSession === undefined
      ? ctx.session.patchState(fields as never)
      : ctx.session.atomicState(((state: Readonly<Record<string, unknown>>) => ({ ...fields, ...alsoSession(state) })) as never));
  }
  await ctx.request.patchState({
    ...also,
    [TURN_HOP_STATE]: hop,
    [TURN_CHAIN_STATE]: chain,
    [TURN_SENT_STATE]: 0
  } as never);
}

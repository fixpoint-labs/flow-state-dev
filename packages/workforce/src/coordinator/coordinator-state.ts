/**
 * What a coordinator conversation keeps beside its delegate list
 * (`../delegates/delegate-list`): best fit's hold, round robin's turn, the
 * rounds still open and the answers that landed last. Server-written: only
 * the routing, the rounds and a post's ending write these fields, and the
 * flow declares them `serverOwned`, so a session create can't seed them.
 *
 * Nothing here records a delivery: each one is a row on the conversation's
 * board, and the row's claim is what lets its answer land once. A session
 * saved with the old delivery ledger (`deliveries`, retired-name-refusal) reads as if it had none,
 * and the key is dropped at its next write (BP-030).
 */
import { z } from "zod";
import {
  DELEGATE_SERVER_OWNED,
  delegateStateShape,
  delegateRefSchema,
  sameDelegate,
  type DelegateRef
} from "../delegates/delegate-list";
import { HOLD_STATE, LANDED_STATE, ROUND_ROBIN_STATE, ROUNDS_STATE } from "./coordinator-keys";
import { landedAnswersSchema } from "./coordinator-lines";

/** The key a session saved with the old delivery ledger keeps it under. retired-name-refusal: BP-030 */
const RETIRED_DELIVERIES_STATE = "deliveries"; // retired-name-refusal: BP-030, the legacy reader

/**
 * The patch that drops a saved delivery ledger (retired-name-refusal), for a write that runs on
 * every post: nothing reads it, and a session that still carries one sheds
 * it here.
 */
export function dropRetiredLedger(state: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return RETIRED_DELIVERIES_STATE in state ? { [RETIRED_DELIVERIES_STATE]: undefined } : {}; // retired-name-refusal: BP-030
}

/** Who best fit holds the user's next post for: the delegate the last one went to. */
export const bestFitHoldSchema = z.object({ messageRequestId: z.string(), delegate: delegateRefSchema });

/**
 * Where round robin's turn stands: the delegate the user's last post went
 * to, and where it stood in the list then, so the turn goes on from the same
 * place when that delegate has since been removed.
 */
export const roundRobinCursorSchema = z.object({ delegate: delegateRefSchema, index: z.number().int().min(0) });

export type RoundRobinCursor = z.infer<typeof roundRobinCursorSchema>;

/** An answer that landed in an open round: its author and what it said. */
export const roundAnswerSchema = delegateRefSchema.extend({ body: z.string() });

export type RoundAnswer = z.infer<typeof roundAnswerSchema>;

/** A round still open: below the coordinator's limit, and waiting for its answers (`coordinator-rounds.ts`). */
export const openRoundSchema = z.object({
  messageRequestId: z.string(),
  round: z.number().int().min(0),
  /** Routings still filing rows in it. It doesn't close on its answers while one runs. */
  opening: z.number().int().min(0),
  /** When it closes without what is still out. Set by its first post row. */
  deadlineAt: z.number().optional(),
  /** The answers that landed in it, in the order they landed. */
  answers: z.array(roundAnswerSchema),
  /**
   * How many routings have started filing rows in it, so a close can tell a
   * read of its rows went stale. A round saved before it reads as none.
   */
  begun: z.number().int().min(0).default(0)
});

export type OpenRound = z.infer<typeof openRoundSchema>;

/**
 * The coordinator's server-written session state, as a flow spreads it into
 * its session `stateSchema`.
 */
export const coordinatorStateShape = {
  ...delegateStateShape,
  [HOLD_STATE]: bestFitHoldSchema.nullable().default(null),
  [ROUND_ROBIN_STATE]: roundRobinCursorSchema.nullable().default(null),
  [ROUNDS_STATE]: z.array(openRoundSchema).default([]),
  [LANDED_STATE]: landedAnswersSchema.default([])
} as const;

/** The fields only the flow's own code writes. */
export const COORDINATOR_SERVER_OWNED: readonly string[] = [
  ...DELEGATE_SERVER_OWNED,
  HOLD_STATE,
  ROUND_ROBIN_STATE,
  ROUNDS_STATE,
  LANDED_STATE
];

export const coordinatorSessionStateSchema = z.object(coordinatorStateShape);

export type CoordinatorSessionState = z.infer<typeof coordinatorSessionStateSchema>;

/**
 * The list in round robin's order: starting right after `after`, or at the
 * place it stood when it has since been removed, and going round once.
 *
 * @param list The conversation's delegates, in list order.
 * @param after Who had the last turn, or `null` to start at the top.
 */
export function turnOrder<T extends DelegateRef>(list: readonly T[], after: RoundRobinCursor | null): T[] {
  if (list.length === 0) return [];
  let start = 0;
  if (after !== null) {
    const at = list.findIndex((record) => sameDelegate(record, after.delegate));
    start = (at >= 0 ? at + 1 : after.index) % list.length;
  }
  return [...list.slice(start), ...list.slice(0, start)];
}

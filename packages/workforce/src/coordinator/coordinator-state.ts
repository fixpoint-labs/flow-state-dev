/**
 * What a coordinator conversation keeps beside its delegate list
 * (`../delegates/delegate-list`): best fit's hold, round robin's turn, the
 * delivery ledger, the rounds still open and the answers that landed last.
 * Server-written: only the delivery code, the rounds and the answer's claim
 * write these fields, and the flow declares them `serverOwned`, so a session
 * create can't seed them.
 */
import { z } from "zod";
import { deliveryDelegateSchema, deliveryLedgerSchema } from "../delivery-ledger";
import { DELEGATE_SERVER_OWNED, delegateStateShape, sameDelegate } from "../delegates/delegate-list";
import type { DeliveryDelegate } from "../delivery-ledger";
import { DELIVERIES_STATE, HOLD_STATE, LANDED_STATE, ROUND_ROBIN_STATE, ROUNDS_STATE } from "./coordinator-keys";
import { landedAnswersSchema } from "./coordinator-lines";

/** Who best fit holds the person's next post for: the delegate the last one went to. */
export const bestFitHoldSchema = z.object({ postId: z.string(), delegate: deliveryDelegateSchema });

/**
 * Where round robin's turn stands: the delegate the person's last post went
 * to, and where it stood in the list then, so the turn goes on from the same
 * place when that delegate has since been removed.
 */
export const roundRobinCursorSchema = z.object({ delegate: deliveryDelegateSchema, index: z.number().int().min(0) });

export type RoundRobinCursor = z.infer<typeof roundRobinCursorSchema>;

/** An answer that landed in an open round: its author and what it said. */
export const roundAnswerSchema = deliveryDelegateSchema.extend({ body: z.string() });

export type RoundAnswer = z.infer<typeof roundAnswerSchema>;

/** A round still open: below the coordinator's limit, and waiting for its answers (`coordinator-rounds.ts`). */
export const openRoundSchema = z.object({
  postId: z.string(),
  round: z.number().int().min(0),
  /** Routings still adding deliveries to it. It doesn't close on its answers while one runs. */
  opening: z.number().int().min(0),
  /** When it closes without what is still out. Set by its first delivery. */
  deadlineAt: z.number().optional(),
  /** The answers that landed in it, in the order they landed. */
  answers: z.array(roundAnswerSchema)
});

export type OpenRound = z.infer<typeof openRoundSchema>;

/**
 * The coordinator's server-written session state, as a flow spreads it into
 * its session `stateSchema`.
 */
export const coordinatorStateShape = {
  ...delegateStateShape,
  [HOLD_STATE]: bestFitHoldSchema.nullable().default(null),
  [DELIVERIES_STATE]: deliveryLedgerSchema.default([]),
  [ROUND_ROBIN_STATE]: roundRobinCursorSchema.nullable().default(null),
  [ROUNDS_STATE]: z.array(openRoundSchema).default([]),
  [LANDED_STATE]: landedAnswersSchema.default([])
} as const;

/** The fields only the flow's own code writes. */
export const COORDINATOR_SERVER_OWNED: readonly string[] = [
  ...DELEGATE_SERVER_OWNED,
  HOLD_STATE,
  DELIVERIES_STATE,
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
export function turnOrder<T extends DeliveryDelegate>(list: readonly T[], after: RoundRobinCursor | null): T[] {
  if (list.length === 0) return [];
  let start = 0;
  if (after !== null) {
    const at = list.findIndex((record) => sameDelegate(record, after.delegate));
    start = (at >= 0 ? at + 1 : after.index) % list.length;
  }
  return [...list.slice(start), ...list.slice(0, start)];
}

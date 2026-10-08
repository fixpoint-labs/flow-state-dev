/**
 * The delivery ledger: one record per (post, round, delegate record), so each
 * delegate answers each post once per round, however many times the post or
 * its answer arrives.
 *
 * A record is opened `pending` with a fresh token before anything is
 * dispatched, then settled `delivered` (with the session it went to) or
 * `failed` (with why). An answer hands its token back and is claimed once: a
 * second answer for the same delivery writes nothing, and a token the ledger
 * never minted is refused. The round, the delegate and the post come from the
 * record the token names, never from the answer.
 *
 * A delegate that has no answer for a delivery can say so with the same
 * token: its turn failed, or the round's deadline came first. That marks the
 * delivery `missed`, once. Its answer, if one still comes, is claimed once all
 * the same.
 *
 * Pure functions over a value the caller keeps in server-written state, so
 * one definition serves every flow that delivers to delegates. The caller
 * resolves which session a delivery goes to; the ledger only records it.
 *
 * Not re-exported from the package root.
 */
import { z } from "zod";

/** The delegate a delivery goes to: a worker, and the target a caller resolved for it, if any. */
export const deliveryDelegateSchema = z.object({
  worker: z.string().min(1),
  target: z.string().min(1).optional()
});

export type DeliveryDelegate = z.infer<typeof deliveryDelegateSchema>;

/** One delivery. */
export const deliveryRecordSchema = z.object({
  /** The post delivered. */
  postId: z.string().min(1),
  /** The round it was delivered in: 0 for a person's post. */
  round: z.number().int().min(0),
  delegate: deliveryDelegateSchema,
  /** What the answer hands back. Unguessable, one per delivery. */
  token: z.string().min(1),
  status: z.enum(["pending", "delivered", "failed"]),
  /** The session it was delivered into, once delivered. */
  sessionId: z.string().optional(),
  /** Why it failed, once failed. */
  reason: z.string().optional(),
  /** Whether its answer has landed. Claimed once. */
  answered: z.boolean(),
  /** Why the delegate said it has no answer, once it said so: its turn failed, or the deadline came first. */
  missed: z.string().optional()
});

export type DeliveryRecord = z.infer<typeof deliveryRecordSchema>;

/** The ledger, oldest delivery first. */
export const deliveryLedgerSchema = z.array(deliveryRecordSchema);

export type DeliveryLedger = z.infer<typeof deliveryLedgerSchema>;

/**
 * How many posts' deliveries the ledger keeps. An older post's answer is
 * refused as unknown, and a redelivery of it is a new delivery.
 */
export const DELIVERY_LEDGER_POSTS = 200;

/** One key per delegate record: a worker with two targets is two delegates. */
export function delegateKey(delegate: DeliveryDelegate): string {
  return JSON.stringify([delegate.worker, delegate.target ?? null]);
}

function sameDelivery(record: DeliveryRecord, postId: string, round: number, key: string): boolean {
  return record.postId === postId && record.round === round && delegateKey(record.delegate) === key;
}

/** Keep the deliveries of the last {@link DELIVERY_LEDGER_POSTS} posts. */
function bounded(ledger: DeliveryLedger): DeliveryLedger {
  const posts: string[] = [];
  for (const record of ledger) if (!posts.includes(record.postId)) posts.push(record.postId);
  if (posts.length <= DELIVERY_LEDGER_POSTS) return ledger;
  const kept = new Set(posts.slice(-DELIVERY_LEDGER_POSTS));
  return ledger.filter((record) => kept.has(record.postId));
}

/** A fresh, unguessable token. */
export function mintDeliveryToken(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Open a delivery, or find the one already opened for the same post, round
 * and delegate record.
 *
 * @returns The ledger to commit and the delivery. `deliver` is true when the
 *   caller should dispatch it: a new delivery, or one still `pending` from an
 *   attempt that never settled (the same token, so its answer is still claimed
 *   once). A delivery already `delivered` or `failed` is not dispatched again.
 */
export function openDelivery(
  ledger: DeliveryLedger,
  opening: { postId: string; round: number; delegate: DeliveryDelegate },
  token: string
): { ledger: DeliveryLedger; delivery: DeliveryRecord; deliver: boolean } {
  const key = delegateKey(opening.delegate);
  const existing = ledger.find((record) => sameDelivery(record, opening.postId, opening.round, key));
  if (existing !== undefined) return { ledger, delivery: existing, deliver: existing.status === "pending" };
  const delivery: DeliveryRecord = {
    postId: opening.postId,
    round: opening.round,
    delegate: { ...opening.delegate },
    token,
    status: "pending",
    answered: false
  };
  return { ledger: bounded([...ledger, delivery]), delivery, deliver: true };
}

/**
 * Settle a pending delivery: delivered into `sessionId`, or failed with `reason`.
 * A delivery already settled keeps what it has.
 */
export function settleDelivery(
  ledger: DeliveryLedger,
  token: string,
  outcome: { delivered: string } | { failed: string }
): DeliveryLedger {
  return ledger.map((record) => {
    if (record.token !== token || record.status !== "pending") return record;
    return "delivered" in outcome
      ? { ...record, status: "delivered" as const, sessionId: outcome.delivered }
      : { ...record, status: "failed" as const, reason: outcome.failed };
  });
}

/** What claiming an answer came to. */
export type AnswerClaim =
  /** The answer is this delivery's, and the first: land it. */
  | { readonly claimed: true; readonly ledger: DeliveryLedger; readonly delivery: DeliveryRecord }
  /** This delivery's answer already landed. Write nothing. */
  | { readonly claimed: false; readonly reason: "answered"; readonly delivery: DeliveryRecord }
  /** No delivery carries this token. Write nothing. */
  | { readonly claimed: false; readonly reason: "unknown-token" };

/**
 * Claim the answer for the delivery `token` names, once.
 */
export function claimAnswer(ledger: DeliveryLedger, token: string): AnswerClaim {
  const delivery = ledger.find((record) => record.token === token);
  if (delivery === undefined) return { claimed: false, reason: "unknown-token" };
  if (delivery.answered) return { claimed: false, reason: "answered", delivery };
  const claimed: DeliveryRecord = { ...delivery, answered: true };
  return {
    claimed: true,
    ledger: ledger.map((record) => (record.token === token ? claimed : record)),
    delivery: claimed
  };
}

/** What marking a delivery missed came to. */
export type MissClaim =
  /** The delivery is now missed. */
  | { readonly marked: true; readonly ledger: DeliveryLedger; readonly delivery: DeliveryRecord }
  /** Its answer already landed, or it was already missed. Write nothing. */
  | { readonly marked: false; readonly reason: "answered" | "missed"; readonly delivery: DeliveryRecord }
  /** No delivery carries this token. Write nothing. */
  | { readonly marked: false; readonly reason: "unknown-token" };

/**
 * Mark the delivery `token` names missed, once, with why. A delivery whose
 * answer already landed stays answered.
 */
export function markMissed(ledger: DeliveryLedger, token: string, why: string): MissClaim {
  const delivery = ledger.find((record) => record.token === token);
  if (delivery === undefined) return { marked: false, reason: "unknown-token" };
  if (delivery.answered) return { marked: false, reason: "answered", delivery };
  if (delivery.missed !== undefined) return { marked: false, reason: "missed", delivery };
  const marked: DeliveryRecord = { ...delivery, missed: why };
  return {
    marked: true,
    ledger: ledger.map((record) => (record.token === token ? marked : record)),
    delivery: marked
  };
}

/** The deliveries of one post in one round. */
export function deliveriesOf(ledger: DeliveryLedger, postId: string, round: number): DeliveryRecord[] {
  return ledger.filter((record) => record.postId === postId && record.round === round);
}

/** Whether a delivery has come to an end: answered, missed, or failed to dispatch. */
export function deliveryEnded(record: DeliveryRecord): boolean {
  return record.answered || record.missed !== undefined || record.status === "failed";
}

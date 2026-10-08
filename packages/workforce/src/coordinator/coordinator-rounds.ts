/**
 * Rounds: how far a delegate's answer goes back out (`rounds:`).
 *
 * A person's post is round 0. An answer that lands in round r, below the
 * coordinator's limit, goes back out in round r + 1:
 *
 * - **best fit and round robin** route each answer again as it lands, never
 *   to its own author;
 * - **everyone**, when round r closes, hands each delegate the others'
 *   answers from it, in one delivery;
 * - **judgment**, when round r closes, wakes the coordinator's own turn once
 *   with the round's answers. Its hand-offs in that turn are round r + 1's.
 *
 * At the limit, or with `rounds: 0`, an answer routes nowhere.
 *
 * **What is tracked.** Only a round below the limit: one open-round record
 * per post and round, in server-written session state. A round closes once no
 * routing is still adding deliveries to it and each of its deliveries has
 * ended (answered, missed, or failed to dispatch), or once its deadline has
 * passed, whatever is still out. Closing removes the record, so an answer that
 * lands after its round closed lands once and routes nowhere. The deadline is
 * set by the round's first delivery, and every delivery in the round carries
 * it, so a delegate still working at the deadline says so then
 * (`delegated-post.ts`).
 *
 * A delegate gets at most one delivery per post per round under every policy
 * (the delivery ledger), so a post costs at most delegates × (rounds + 1)
 * delegate turns.
 *
 * Pure functions over the values the flow keeps in session state.
 */
import { z } from "zod";
import {
  deliveriesOf,
  deliveryDelegateSchema,
  deliveryEnded,
  type DeliveryDelegate,
  type DeliveryLedger,
  type DeliveryRecord
} from "../delivery-ledger";
import type { CoordinatorRouting } from "./coordinator-config";
import {
  delegateLabel,
  roundAnswerSchema,
  sameDelegate,
  type OpenRound,
  type RoundAnswer
} from "./coordinator-delegates";

/** The most open rounds a conversation keeps. An older one is dropped, and its late answers route nowhere. */
export const MAX_OPEN_ROUNDS = 50;

/**
 * Answers going back out in a round after the person's post: what the
 * conversation's own code hands its route-on entry.
 */
export const routeOnSchema = z
  .object({
    /** The person's post the answers came from. */
    postId: z.string().min(1),
    /** The round they go out in. */
    round: z.number().int().min(1),
    /** The answers, by author. */
    answers: z.array(roundAnswerSchema),
    /** Who they never go back to: the author, under best fit and round robin. */
    exclude: deliveryDelegateSchema.optional()
  })
  .strict();

export type RouteOn = z.infer<typeof routeOnSchema>;

/** A round that just closed: what went out in it and what came back. */
export type ClosedRound = { postId: string; round: number; deliveries: number; answers: RoundAnswer[] };

const indexOf = (rounds: readonly OpenRound[], postId: string, round: number) =>
  rounds.findIndex((open) => open.postId === postId && open.round === round);

/**
 * A routing starts adding deliveries to a round below the limit: open it, or
 * hold it open while another routing adds to it too.
 */
export function beginRound(rounds: readonly OpenRound[], postId: string, round: number): OpenRound[] {
  const at = indexOf(rounds, postId, round);
  if (at >= 0) return rounds.map((open, i) => (i === at ? { ...open, opening: open.opening + 1 } : open));
  const opened: OpenRound[] = [...rounds, { postId, round, opening: 1, answers: [] }];
  return opened.length > MAX_OPEN_ROUNDS ? opened.slice(-MAX_OPEN_ROUNDS) : opened;
}

/**
 * The deadline a delivery in this round carries: set by the round's first
 * delivery, shared by the rest. `undefined` when the round isn't open, which
 * is a round at the limit: nothing waits for its answers.
 */
export function roundDeadline(
  rounds: readonly OpenRound[],
  postId: string,
  round: number,
  now: number,
  deadlineMs: number
): { rounds: OpenRound[]; deadlineAt?: number } {
  const at = indexOf(rounds, postId, round);
  if (at < 0) return { rounds: [...rounds] };
  const open = rounds[at]!;
  if (open.deadlineAt !== undefined) return { rounds: [...rounds], deadlineAt: open.deadlineAt };
  const deadlineAt = now + deadlineMs;
  return { rounds: rounds.map((r, i) => (i === at ? { ...r, deadlineAt } : r)), deadlineAt };
}

/** A routing finished adding deliveries to a round. */
export function endRound(rounds: readonly OpenRound[], postId: string, round: number): OpenRound[] {
  return rounds.map((open) =>
    open.postId === postId && open.round === round ? { ...open, opening: Math.max(0, open.opening - 1) } : open
  );
}

/** Remove the open round at `at`, as closed. */
function closeAt(rounds: readonly OpenRound[], at: number, ledger: DeliveryLedger): { rounds: OpenRound[]; closed: ClosedRound } {
  const open = rounds[at]!;
  return {
    rounds: rounds.filter((_r, i) => i !== at),
    closed: {
      postId: open.postId,
      round: open.round,
      deliveries: deliveriesOf(ledger, open.postId, open.round).length,
      answers: open.answers
    }
  };
}

const pastDeadline = (open: OpenRound, now: number) => open.deadlineAt !== undefined && now >= open.deadlineAt;

/**
 * Close a round that is done: no routing is still adding to it and each of
 * its deliveries has ended; or its deadline has passed. Nothing happens to a
 * round that isn't open.
 */
export function closeRound(
  rounds: readonly OpenRound[],
  ledger: DeliveryLedger,
  postId: string,
  round: number,
  now: number
): { rounds: OpenRound[]; closed?: ClosedRound } {
  const at = indexOf(rounds, postId, round);
  if (at < 0) return { rounds: [...rounds] };
  const open = rounds[at]!;
  const done = open.opening === 0 && deliveriesOf(ledger, postId, round).every(deliveryEnded);
  return done || pastDeadline(open, now) ? closeAt(rounds, at, ledger) : { rounds: [...rounds] };
}

/**
 * An answer landed for `delivery`. A round past its deadline closes first,
 * without it. Otherwise the answer is kept on its open round, and the round
 * closes if that was the last one out.
 *
 * @param ledger The ledger with this answer already claimed.
 * @returns `kept` when the answer landed in an open round, so it may go back
 *   out; and the round, when it closed.
 */
export function landAnswer(
  rounds: readonly OpenRound[],
  ledger: DeliveryLedger,
  delivery: DeliveryRecord,
  body: string,
  now: number
): { rounds: OpenRound[]; kept: boolean; closed?: ClosedRound } {
  const at = indexOf(rounds, delivery.postId, delivery.round);
  if (at < 0) return { rounds: [...rounds], kept: false };
  if (pastDeadline(rounds[at]!, now)) return { ...closeAt(rounds, at, ledger), kept: false };
  const answer: RoundAnswer = { ...delivery.delegate, body };
  const kept = rounds.map((open, i) => (i === at ? { ...open, answers: [...open.answers, answer] } : open));
  return { ...closeRound(kept, ledger, delivery.postId, delivery.round, now), kept: true };
}

/**
 * Where an answer goes as it lands, under best fit and round robin: back out
 * in the next round, never to its author. Nowhere when it landed late, at the
 * limit, or under another policy.
 */
export function routeOnAfterAnswer(
  delivery: DeliveryRecord,
  body: string,
  kept: boolean,
  policy: CoordinatorRouting,
  limit: number
): RouteOn | undefined {
  if (!kept || (policy !== "best-fit" && policy !== "round-robin") || delivery.round >= limit) return undefined;
  const author: DeliveryDelegate = { ...delivery.delegate };
  return { postId: delivery.postId, round: delivery.round + 1, answers: [{ ...author, body }], exclude: author };
}

/**
 * Where a round's answers go when it closes, under everyone and judgment:
 * back out in the next round. Nowhere at the limit, for a round nothing was
 * delivered in, or under another policy.
 */
export function routeOnAfterClose(closed: ClosedRound, policy: CoordinatorRouting, limit: number): RouteOn | undefined {
  if ((policy !== "everyone" && policy !== "judgment") || closed.deliveries === 0 || closed.round >= limit) {
    return undefined;
  }
  return { postId: closed.postId, round: closed.round + 1, answers: closed.answers };
}

/** The answers as one delegate is handed them: who said it, and what. */
export function passedOn(answers: readonly RoundAnswer[]): { from: string; body: string } {
  if (answers.length === 1) return { from: delegateLabel(answers[0]!), body: answers[0]!.body };
  return {
    from: answers.map(delegateLabel).join(", "),
    body: answers.map((answer) => `${delegateLabel(answer)}: ${answer.body}`).join("\n\n")
  };
}

/** The answers as the coordinator's own turn reads them when a round wakes it. */
export function wakeMessage(round: number, answers: readonly RoundAnswer[]): string {
  return [
    `Your delegates answered (round ${round}):`,
    ...answers.map((answer) => `${delegateLabel(answer)}: ${answer.body}`)
  ].join("\n\n");
}

/** The answers `delegate` hasn't seen: everyone else's. */
export function othersOf(answers: readonly RoundAnswer[], delegate: DeliveryDelegate): RoundAnswer[] {
  return answers.filter((answer) => !sameDelegate(answer, delegate));
}

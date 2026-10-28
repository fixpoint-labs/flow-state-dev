/**
 * Rounds: how far a delegate's answer goes back out (`rounds:`).
 *
 * A user's post is round 0. An answer that lands in round r, below the
 * coordinator's limit, goes back out in round r + 1:
 *
 * - **best fit and round robin** route each answer again as it lands, never
 *   to its own author;
 * - **everyone**, when round r closes, hands each delegate the others'
 *   answers from it, in one delivery;
 * - **judgment**, when round r closes, wakes the coordinator's own turn once
 *   with the round's answers. Its dispatches in that turn are round r + 1's.
 *
 * At the limit, or with `rounds: 0`, an answer routes nowhere.
 *
 * **What is tracked.** Only a round below the limit: one open-round record
 * per post and round, in server-written session state, holding its deadline,
 * the routings still adding to it, and the answers that landed in it. What
 * went out in a round is not kept here: each delegate's post is a row on the
 * conversation's board carrying its round, and the caller reads those rows
 * ({@link RoundRows}). A round closes once no routing is still adding rows to
 * it, each of its rows has ended (completed, failed or cancelled) and each
 * reply among them has landed here, or once its deadline has passed, whatever
 * is still out. Closing removes the record,
 * so an answer that lands after its round closed lands once and routes
 * nowhere. The deadline is set by the round's first row, and the coordinator
 * owes a wake on its own session at it (FIX-2083 D2), so a round whose
 * delegate is still working closes then, after a host restart too. Every
 * wake also closes each overdue round ({@link closeOverdue}).
 *
 * At most {@link MAX_OPEN_ROUNDS} rounds stay open per conversation. A round
 * past that is refused, not opened: its deliveries still go out, but nothing
 * waits for their answers, which land once and go no further. The routing
 * says so in its record's `note`. Every wake first closes the overdue rounds,
 * so the cap is reached only by that many rounds within their deadline.
 *
 * A delegate gets at most one row per post per round under every policy (the
 * row's id is derived from the post, the round and the delegate record), so a
 * post costs at most delegates × (rounds + 1) delegate turns.
 *
 * Pure functions over the values the flow keeps in session state.
 */
import { z } from "zod";
import type { CoordinatorRouting } from "./coordinator-config";
import { MAX_ROUNDS } from "./coordinator-keys";
import { delegateLabel, delegateRefSchema, sameDelegate, type DelegateRef } from "../delegates/delegate-list";
import { roundAnswerSchema, type OpenRound, type RoundAnswer } from "./coordinator-state";

/** The most open rounds a conversation keeps. One more is refused: its answers go no further. */
export const MAX_OPEN_ROUNDS = 50;

/**
 * Answers going back out in a round after the user's post: what the
 * conversation's own code hands its route-on entry.
 */
export const routeOnSchema = z
  .object({
    /** The user's post the answers came from. */
    postId: z.string().min(1),
    /** The round they go out in. */
    round: z.number().int().min(1).max(MAX_ROUNDS),
    /** The answers, by author. */
    answers: z.array(roundAnswerSchema),
    /** Who they never go back to: the author, under best fit and round robin. */
    exclude: delegateRefSchema.optional()
  })
  .strict();

export type RouteOn = z.infer<typeof routeOnSchema>;

/** A round that just closed: what went out in it and what came back. */
export type ClosedRound = { postId: string; round: number; deliveries: number; answers: RoundAnswer[] };

/**
 * A round's rows, as the caller read them off the board, read before the
 * write that may close the round, once per write.
 *
 * A row can end before its ending lands here, so a reply's row holds its
 * round open until the reply is among the round's answers: a delegate has
 * one row per post per round, so the reply is matched by its author.
 */
export type RoundRows = (postId: string, round: number) => RoundRead;

/** One round's rows as read, with the round as it stood just before the read. */
export interface RoundRead {
  /** Every post row that went out in it. */
  readonly ids: readonly string[];
  /** Whether any of them hasn't ended yet. */
  readonly running: boolean;
  /** The authors of the ones that ended with a reply. */
  readonly replied: readonly DelegateRef[];
  /**
   * The round's {@link OpenRound.begun} and {@link OpenRound.opening} when
   * read. A routing that was filing then, or began since, may have filed a
   * row the read missed, so the round doesn't close on it.
   */
  readonly begun: number;
  readonly opening: number;
}

/** A post that went out in a round: which post, which round, and to whom. */
export type RoundPost = { postId: string; round: number; delegate: DelegateRef };

const indexOf = (rounds: readonly OpenRound[], postId: string, round: number) =>
  rounds.findIndex((open) => open.postId === postId && open.round === round);

/**
 * A routing starts adding deliveries to a round below the limit: open it, or
 * hold it open while another routing adds to it too.
 *
 * @returns `opened` false when the round isn't open and {@link MAX_OPEN_ROUNDS}
 *   already are: it is refused, and the rounds are unchanged.
 */
export function beginRound(
  rounds: readonly OpenRound[],
  postId: string,
  round: number
): { rounds: OpenRound[]; opened: boolean } {
  const at = indexOf(rounds, postId, round);
  if (at >= 0) {
    const held = rounds.map((open, i) => (i === at ? { ...open, opening: open.opening + 1, begun: open.begun + 1 } : open));
    return { rounds: held, opened: true };
  }
  if (rounds.length >= MAX_OPEN_ROUNDS) return { rounds: [...rounds], opened: false };
  return { rounds: [...rounds, { postId, round, opening: 1, begun: 1, answers: [] }], opened: true };
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
function closeAt(
  rounds: readonly OpenRound[],
  at: number,
  rows: RoundRows
): { rounds: OpenRound[]; closed: ClosedRound } {
  const open = rounds[at]!;
  return {
    rounds: rounds.filter((_r, i) => i !== at),
    closed: {
      postId: open.postId,
      round: open.round,
      deliveries: rows(open.postId, open.round).ids.length,
      answers: open.answers
    }
  };
}

const pastDeadline = (open: OpenRound, now: number) => open.deadlineAt !== undefined && now >= open.deadlineAt;

/**
 * Close a round that is done: no routing is still adding to it, each of its
 * rows has ended, and each reply among them has landed here; or its deadline
 * has passed. Nothing happens to a round that isn't open.
 *
 * @param routing Set by the routing whose end this write records: it was
 *   still filing when its rows were read, and filed nothing after.
 */
export function closeRound(
  rounds: readonly OpenRound[],
  rows: RoundRows,
  postId: string,
  round: number,
  now: number,
  routing = false
): { rounds: OpenRound[]; closed?: ClosedRound } {
  const at = indexOf(rounds, postId, round);
  if (at < 0) return { rounds: [...rounds] };
  const open = rounds[at]!;
  const read = rows(postId, round);
  const current = read.begun === open.begun && read.opening === (routing ? 1 : 0);
  const done =
    open.opening === 0 &&
    current &&
    !read.running &&
    read.replied.every((author) => open.answers.some((answer) => sameDelegate(answer, author)));
  return done || pastDeadline(open, now) ? closeAt(rounds, at, rows) : { rounds: [...rounds] };
}

/**
 * Close every open round whose deadline has passed, whatever is still out.
 * Each wake of the conversation runs it (a user's post, a post row's ending,
 * a deadline's wake, the end of a routing), so a round whose delegate never
 * reported, because its process stopped, still closes once the conversation
 * next wakes after its deadline.
 */
export function closeOverdue(
  rounds: readonly OpenRound[],
  rows: RoundRows,
  now: number
): { rounds: OpenRound[]; closed: ClosedRound[] } {
  let remaining: OpenRound[] = [...rounds];
  const closed: ClosedRound[] = [];
  for (let at = remaining.findIndex((open) => pastDeadline(open, now)); at >= 0; ) {
    const closing = closeAt(remaining, at, rows);
    remaining = closing.rounds;
    closed.push(closing.closed);
    at = remaining.findIndex((open) => pastDeadline(open, now));
  }
  return { rounds: remaining, closed };
}

/** Whether any open round's deadline has passed: the cheap read before a sweep writes anything. */
export function anyOverdue(rounds: readonly OpenRound[], now: number): boolean {
  return rounds.some((open) => pastDeadline(open, now));
}

/**
 * An answer landed for `posted`. A round past its deadline closes first,
 * without it. Otherwise the answer is kept on its open round, and the round
 * closes if that was the last one out.
 *
 * An answer its round already keeps (the same ending, heard again after a
 * failure past this write) is not kept twice: a delegate has one row per post
 * per round.
 *
 * @param rows The round's rows, with this answer's row already ended.
 * @returns `kept` when the answer landed in an open round, so it may go back
 *   out; `again` when its round already kept it; and the round, when it closed.
 */
export function landAnswer(
  rounds: readonly OpenRound[],
  rows: RoundRows,
  posted: RoundPost,
  body: string,
  now: number
): { rounds: OpenRound[]; kept: boolean; again?: true; closed?: ClosedRound } {
  const at = indexOf(rounds, posted.postId, posted.round);
  if (at < 0) return { rounds: [...rounds], kept: false };
  if (pastDeadline(rounds[at]!, now)) return { ...closeAt(rounds, at, rows), kept: false };
  if (rounds[at]!.answers.some((kept) => sameDelegate(kept, posted.delegate))) {
    return { ...closeRound(rounds, rows, posted.postId, posted.round, now), kept: false, again: true };
  }
  const answer: RoundAnswer = {
    worker: posted.delegate.worker,
    ...(posted.delegate.target === undefined ? {} : { target: posted.delegate.target }),
    body
  };
  const kept = rounds.map((open, i) => (i === at ? { ...open, answers: [...open.answers, answer] } : open));
  return { ...closeRound(kept, rows, posted.postId, posted.round, now), kept: true };
}

/**
 * Where an answer goes as it lands, under best fit and round robin: back out
 * in the next round, never to its author. Nowhere when it landed late, at the
 * limit, or under another policy.
 */
export function routeOnAfterAnswer(
  posted: RoundPost,
  body: string,
  kept: boolean,
  policy: CoordinatorRouting,
  limit: number
): RouteOn | undefined {
  if (!kept || (policy !== "best-fit" && policy !== "round-robin") || posted.round >= limit) return undefined;
  const author: DelegateRef = {
    worker: posted.delegate.worker,
    ...(posted.delegate.target === undefined ? {} : { target: posted.delegate.target })
  };
  return { postId: posted.postId, round: posted.round + 1, answers: [{ ...author, body }], exclude: author };
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
export function othersOf(answers: readonly RoundAnswer[], delegate: DelegateRef): RoundAnswer[] {
  return answers.filter((answer) => !sameDelegate(answer, delegate));
}

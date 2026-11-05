/**
 * One wait on a person per task turn (FIX-2131, on FIX-2133's rule): a turn
 * that holds a task's claim either asks a question (`holdTaskForUser`, which holds
 * the task) or stops for the user (`suspendForUser`, which suspends its run),
 * never both. Within one model step the two tools run side by side, so the
 * first to take the turn's wait wins, and the other is refused naming it.
 *
 * Keyed on the turn, never on which holds the row has open now: a turn that
 * asked is read from the row's turn-asked fact (`askedInTurn`, written by the
 * ask itself), and a turn whose model tool took the wait in this process from
 * a per-request mark taken before either tool awaits anything. An open hold
 * says what waits on a person now; it says nothing about which turn opened it,
 * so it never decides this.
 */
import { onRequestEnded } from "@flow-state-dev/core/types";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { Task, TaskClaimTicket } from "../tasks";
import { askedOnTicket } from "../tasks/collection/holds";

/** The two model tools that wait on a person from a task turn. */
export type PersonWaitTool = "holdTaskForUser" | "suspendForUser";

/** The wait each running request's turn took, by request and turn. Each entry leaves at its request's end. */
const taken = new Map<string, PersonWaitTool>();

function keyOf(ctx: BlockContext, claim: TaskClaimTicket): string | undefined {
  const requestId = ctx.request?.identity?.id;
  if (requestId === undefined) return undefined;
  return `${requestId}:${claim.collectionId}:${claim.taskId}:${claim.attempt}:${claim.turn}`;
}

/**
 * Take the turn's one wait on a person for `by`.
 *
 * @returns `undefined` when the turn's wait is `by`'s (taken now, or before by
 *   the same tool), or the other tool's name when it took the wait first.
 */
export function takeTurnWait(
  ctx: BlockContext,
  held: { readonly claim: TaskClaimTicket; readonly row: Task | undefined },
  by: PersonWaitTool
): PersonWaitTool | undefined {
  if (askedOnTicket(held.row, held.claim)) return by === "holdTaskForUser" ? undefined : "holdTaskForUser";
  const key = keyOf(ctx, held.claim);
  // Unreachable on a real turn: a held row means a claim, which only a request
  // holds, and `BlockContext.request.identity` is required; the guard is for a hand-built test context.
  if (key === undefined) return undefined;
  const already = taken.get(key);
  if (already !== undefined) return already === by ? undefined : already;
  taken.set(key, by);
  onRequestEnded(ctx as never, () => {
    taken.delete(key);
  });
  return undefined;
}

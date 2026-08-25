/**
 * The bound claim ticket — the token a task write presents to prove it owns
 * the row it is writing to (FIX-981).
 *
 * The token this replaces was a bare attempt number. Attempt numbers are small
 * and collide constantly across a board — two freshly claimed tasks are both on
 * attempt 1 — so a token that is only a counter is satisfied by *a different
 * task that happens to sit on the same attempt*. A worker holding task "a"
 * could settle task "b" and the guard would pass.
 *
 * A ticket names its target, so the guard can ask "is this the task you
 * claimed?" before it asks anything about that task's state. Four fields, and
 * each closes a distinct way the wrong row could satisfy the check:
 *
 * - `collectionId` — two boards may both hold a task id, and a coordinator may
 *   legitimately file the same id on both.
 * - `taskId` — the cross-task case above, which is the defect this exists for.
 * - `attempt` — the same task, but a later claim than the caller's (a lease
 *   reclaim handed it on).
 * - `createdAt` — the same id, but a *different task*: deleted and recreated
 *   under that id, which resets `attempts` to 0 and would otherwise let a stale
 *   ticket match again (the ABA case). `Task.createdAt` is already persisted,
 *   so this costs no schema change.
 *
 * A fifth field, `incarnationId`, is **carried and not compared here**. The
 * guard's four fields are the ones every write presents; the nonce is for the
 * one holder that re-verifies its claim in a different process, where a
 * millisecond stamp is not enough to tell two incarnations apart. See its own
 * doc on {@link TaskClaimTicket}.
 *
 * Tickets are **server-derived and never caller-supplied** (BP-031): they are
 * minted here from a claim the substrate just committed. A model naming a task
 * id therefore supplies the *target* of a check and never the *authority* for
 * it.
 */
import { z } from "zod";
import type { Task } from "./schema/task";

/**
 * Proof that the holder claimed a specific task on a specific board.
 *
 * Minted by {@link ticketForClaim} from a committed claim; presented on
 * `TaskTransitionOptions.claim`. Callers do not construct one by hand — a
 * hand-assembled ticket is an ownership assertion nobody checked.
 */
export interface TaskClaimTicket {
  /** The board the claim was taken on. */
  readonly collectionId: string;
  /** The task the claim was taken on. */
  readonly taskId: string;
  /** `task.attempts` as of the claim — i.e. post-increment, this attempt. */
  readonly attempt: number;
  /** `task.createdAt` as of the claim — task identity across delete/recreate. */
  readonly createdAt: number;
  /**
   * `task.incarnationId` as of the claim — the row's identity nonce, and the
   * only one of these fields that survives a same-millisecond recreate.
   *
   * `createdAt` above is a millisecond clock, and a delete-then-recreate under
   * the same id lands in the same millisecond often enough (measured 198/200,
   * see `schema/task.ts`) that the two rows share it. Carried so a holder that
   * has to re-verify its claim *across a process boundary* — the detached start
   * gate is the one that does — can ask the question `createdAt` cannot answer.
   *
   * **Absent on a row persisted before `incarnationId` shipped, and on any
   * hand-written `TaskCollectionRef` that maintains no provenance** (BP-030).
   * A reader compares it only when both sides carry one, exactly as
   * `didWriteLand`'s incarnation arm does; absent is "cannot tell", never "does
   * not match".
   */
  readonly incarnationId?: string;
}

/**
 * Runtime shape for a ticket carried on sequencer state.
 *
 * Needed because the board stamps the ticket onto its worker-body state, which
 * is schema-validated on every patch. Nothing validates a ticket at the guard —
 * the guard compares fields and a malformed one simply fails to match.
 */
export const taskClaimTicketSchema = z.object({
  collectionId: z.string(),
  taskId: z.string(),
  attempt: z.number(),
  createdAt: z.number(),
  // Declared, not merely allowed: a Zod object strips keys it does not name, so
  // an undeclared field would be dropped the moment the board patches the
  // ticket onto its worker-body state. Optional because the row it is copied
  // from may not carry one (BP-030).
  incarnationId: z.string().optional(),
});

/**
 * Mint a ticket for a task the caller has just claimed.
 *
 * Pass the task **returned by `claim()`**, never the pre-claim task: `attempts`
 * is incremented by the claim, so a ticket built from an `addTask()` result
 * names an attempt nobody holds and every write presenting it is refused.
 */
export function ticketForClaim(collectionId: string, claimed: Task): TaskClaimTicket {
  return {
    collectionId,
    taskId: claimed.id,
    attempt: claimed.attempts,
    createdAt: claimed.createdAt,
    // Spread conditionally so an absent nonce stays an ABSENT KEY. A present
    // key holding `undefined` reads the same to `ticketNamesTask` and does not
    // to a JSON boundary, and this ticket's fields are copied onto a detached
    // dispatch envelope that has to survive one.
    ...(claimed.incarnationId !== undefined
      ? { incarnationId: claimed.incarnationId }
      : {}),
  };
}

/**
 * True when `ticket` names `task` on `collectionId` — the target-binding
 * question, and the one part of the ownership guard that reads no mutable task
 * state at all.
 *
 * That property is why the guard evaluates this arm early (see
 * `TaskWriteDeclineReason`): every other arm's verdict can be an artifact of
 * the basis the caller happened to hold, and this one cannot. `createdAt` is
 * identity here, not freshness — a task recreated under a recycled id is a
 * different task, so a ticket for the old one does not name it.
 */
export function ticketNamesTask(
  ticket: TaskClaimTicket,
  collectionId: string,
  task: Task
): boolean {
  return (
    ticket.collectionId === collectionId &&
    ticket.taskId === task.id &&
    ticket.createdAt === task.createdAt
  );
}

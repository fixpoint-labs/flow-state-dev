/**
 * The claim gate a board puts in front of each task entry its seats hand off
 * to — what a `task` dispatch actually enters in the child session.
 *
 * The flow declares a task entry as a plain block, `task: { actions: { implement:
 * { block } } }`. The board cannot wrap it itself — the flow owns the entry — so
 * `taskBoard()` builds this gate once and binds it onto the hand-off it
 * installs at each dispatcher seat (`bindTaskDispatcher`), and `defineFlow`
 * applies it to every entry a reachable hand-off addresses. A `task` dispatch
 * therefore resolves the *gate around the block* and never the bare block;
 * there is no path from a `task` dispatch to an entry that skips the sequence
 * below.
 *
 * ## The four things that must happen before a handed-off worker runs
 *
 * All four are the same read, which is the point — one durable read per
 * dispatched request, doing four jobs:
 *
 * 1. **The start gate.** Between claim and dispatch there is no request, so a
 *    cancel or a reclaim landing in that gap leaves the claimant proceeding from
 *    a stale snapshot — a cancelled task running to completion. The gate re-reads
 *    the row and aborts unless the claim is still current: `attempts` matches,
 *    `createdAt` matches, the row's incarnation matches, the status is still
 *    `in_progress`, the claim's lease has not run out, and the row still routes
 *    to THIS seat.
 * 2. **The task-scope mark.** `_markTaskScope` walks up to the first sequencer
 *    parent, so the entry's root must be a sequencer and this must happen in
 *    its leading `.tap`, before any child scope exists. Without it every item the
 *    worker emits is unattributed and the task's own item view is empty.
 * 3. **The claim-ticket re-mint.** The parent stamped its ticket into an
 *    `AsyncLocalStorage`, which is per-process and per-async-chain and therefore
 *    cannot reach here — deliberately, since a ticket carried on a payload is the
 *    forgeable shape the substrate rejects. The ticket is re-minted from the row
 *    the gate just verified, which makes it server-derived.
 * 4. **Lease renewal**, started from the child's own async chain, so a lapsed
 *    lease means "no live worker holds this" rather than "the worker is taking
 *    a while".
 *
 * ## Why this is an identity check and not a counter check
 *
 * A task deleted and recreated under the same id inside the claim→dispatch
 * window passes an attempt-only gate: the recreate resets `attempts`, and the
 * replacement's first claim lands the counter right back where the dispatch
 * left it. So the gate checks *which row* as well as *which attempt* —
 * `createdAt` as the cheap half, `incarnationId` as the sound one.
 *
 * ## And why identity alone is not enough
 *
 * Nothing renews a handed-off row's lease between the parent's hand-off and the
 * child's first breath, so a child that waits in the host's queue longer than
 * the lease starts on a row the substrate already counts as free. Letting that
 * through is the expensive direction: the worker's side effects commit first
 * and the refusal arrives second. Refused instead — the row keeps its lapsed
 * lease and `in_progress` status, which `isClaimable` reads as recoverable, so
 * the next drain takes it and the work runs once.
 */
import { sequencer } from "@flow-state-dev/core";
import type { DefinedCapability } from "@flow-state-dev/core";
import { taskDispatchInputSchema } from "@flow-state-dev/core/types";
import type {
  ActionCore,
  BlockContext,
  TaskBinding,
  TaskDispatchInput,
} from "@flow-state-dev/core/types";
import { z } from "zod";
import { assertHandOffBlockSupported } from "./hand-off";
import { ticketForClaim } from "../tasks/claim-ticket";
import { startLeaseRenewal } from "../tasks/lease-renewal";
import {
  currentLeaseRenewal,
  stampLeaseRenewal,
  withLeaseRenewalScope,
} from "../tasks/lease-renewal-scope";
import { stampCurrentClaim } from "./flow-policy-wiring";
import { createRecordError, createRecordSuccess } from "./blocks/record-result";
import { taskBoardWorkerBodyStateSchema } from "./schemas";
import {
  leaseLapsed,
  type Task,
  type TaskCollectionRef,
  type TaskWorker,
  type TaskWorkerInput,
} from "../tasks";

/** The `task` envelope, re-exported from core: `{ boardId, seat, taskId, attempt, createdAt, incarnationId?, payload }`. */
export { taskDispatchInputSchema };
export type { TaskDispatchInput };

/**
 * Thrown by the start gate when the claim this dispatch names is no longer the
 * row's current claim.
 *
 * Superseded, expired and re-routed all land here rather than each getting a
 * name of its own: what this dispatch must do about any of them is the same —
 * stop, write nothing, leave the row to be recovered. A named error rather
 * than a silent return: a request that stops because its claim was superseded
 * is a *correct* outcome, but one that stops with no trace is
 * indistinguishable from one that never ran.
 */
export class StaleTaskClaimError extends Error {
  readonly code = "stale-task-claim";

  constructor(
    readonly taskId: string,
    detail: string
  ) {
    super(`[task-board] task dispatch for "${taskId}" is stale: ${detail}`);
    this.name = "StaleTaskClaimError";
  }
}

export interface TaskGateOptions {
  /** Board name, used to name the assembled blocks. */
  name: string;
  /** The board's stable id — what a dispatch for this board carries, and what the gate is scoped to. */
  boardId: string;
  /**
   * Resolve this board's collection from a block context.
   *
   * **Resolved against the running context, which in the child is the child's
   * own session.** A session-scoped board is therefore reachable here only when
   * it resolves to the lineage root (`sharedToWorkstream`); `taskBoard()` refuses
   * the other shape at construction, because arriving here would mean the gate
   * reads an empty ledger and calls every claim stale.
   */
  collection: (ctx: BlockContext) => Promise<TaskCollectionRef>;
  /**
   * The board's own resource declarations — the same `uses` the drain carries.
   * The entry is a second action root, not a step under the drain: a `task`
   * dispatch enters here directly, so nothing the drain installed is in scope.
   */
  uses?: readonly DefinedCapability[];
  /**
   * The board's worker-failure policy, threaded rather than re-chosen.
   * `"skip"` settles the row and lets the child's request complete; `"fail"`
   * additionally fails that request.
   */
  onError: "skip" | "fail";
}

/**
 * Build this board's claim gate: the function `defineFlow` applies to each task
 * entry a reachable hand-off of this board addresses.
 *
 * The gated entry's `inputSchema` is the dispatch envelope narrowed to THIS
 * board — `runAction` parses the input before the block is entered, so a
 * dispatch addressed to a board that has since been removed or renamed is
 * refused before the gate reads a row. Without that the gate could pass every
 * arm on a row that happens to match under a different board's ledger. The
 * entry's own execution policy (`concurrency`, hooks) rides through untouched.
 */
export function createTaskGate(options: TaskGateOptions): TaskBinding["gate"] {
  const { name, boardId, collection: collectionFactory, uses, onError } = options;

  // The same recorders the inline drain composes, bound to this board's
  // collection. Reused rather than reimplemented: they own the ticket-fenced
  // write-back and the rule for when lease renewal stops.
  const recordSuccess = createRecordSuccess({
    name: `${name}-gate-record-success`,
    collection: collectionFactory,
  });
  const recordError = createRecordError({
    name: `${name}-gate-record-error`,
    collection: collectionFactory,
    onError,
  });

  return (entry: ActionCore, target: string): ActionCore => {
    const worker = entry.block as TaskWorker;
    assertHandOffBlockSupported({ name, target, block: worker });

    const block = sequencer({
      name: `${name}-${target}-gate`,
      stateSchema: taskBoardWorkerBodyStateSchema,
      ...(uses !== undefined ? { uses } : {}),
    })
      .tap(async (dispatch: TaskDispatchInput, ctx) =>
        // FIRST STATEMENT, before any await: this publishes the slot the lease
        // driver is installed into; past the first `await` it would land on a
        // continuation scope that dies with this tap.
        withLeaseRenewalScope(async () => {
          const board = await collectionFactory(ctx);
          const row = board.get(dispatch.taskId) as Task | undefined;

          // THE START GATE. Each arm closes a different window.
          if (row === undefined) {
            throw new StaleTaskClaimError(
              dispatch.taskId,
              `no such row on board "${boardId}" — it was deleted, or this board resolved to a ` +
                `different ledger than the one that claimed it`
            );
          }
          if (row.attempts !== dispatch.attempt) {
            throw new StaleTaskClaimError(
              dispatch.taskId,
              `attempt ${dispatch.attempt} was superseded by attempt ${row.attempts}`
            );
          }
          if (row.createdAt !== dispatch.createdAt) {
            throw new StaleTaskClaimError(
              dispatch.taskId,
              "the row was deleted and recreated under the same id after this dispatch was addressed"
            );
          }
          if (
            row.incarnationId !== undefined &&
            dispatch.incarnationId !== undefined &&
            row.incarnationId !== dispatch.incarnationId
          ) {
            throw new StaleTaskClaimError(
              dispatch.taskId,
              "the row was deleted and recreated under the same id after this dispatch was " +
                "addressed (its incarnation differs, though its creation stamp does not)"
            );
          }
          if (row.status !== "in_progress") {
            throw new StaleTaskClaimError(
              dispatch.taskId,
              `the row is "${row.status}", so no claim is outstanding on it`
            );
          }
          // The one arm about liveness rather than identity. Refused, not
          // renewed: `renewLease` is fenced on this exact subtraction, and
          // adopting the row would mean re-claiming it under a fresh attempt.
          if (leaseLapsed(row, board.now())) {
            throw new StaleTaskClaimError(
              dispatch.taskId,
              "its lease ran out before this dispatch started, so the row is back in " +
                "the claim queue and any work done under it could not be recorded"
            );
          }
          // The row must still route to the seat that handed it off. A hand-off
          // board freezes a task's assignee at admission precisely because it is
          // the address the hand-off is reached by; a mismatch means that guard
          // was bypassed, and running would mix two workers' histories under one
          // child.
          if (row.assignee !== dispatch.seat) {
            throw new StaleTaskClaimError(
              dispatch.taskId,
              `this dispatch was sent from seat "${dispatch.seat}" but the row now routes to ` +
                `"${row.assignee ?? "(no assignee)"}"`
            );
          }

          // The ticket is minted from the row just verified, never carried on the
          // envelope — the envelope supplied the target of the check and never the
          // authority for it. It rides the state under the SAME key the drain's
          // worker body uses, so the shipped recorders settle this row without a
          // second implementation of the fence.
          const ticket = ticketForClaim(board.collectionId, row);
          await ctx.sequencer!.patchState({ currentClaim: ticket });

          ctx._markTaskScope?.(row.id);
          stampCurrentClaim(ticket);
          stampLeaseRenewal(
            startLeaseRenewal({
              collection: board,
              ticket,
              claimedTask: row,
              signal: ctx.signal,
            })
          );
        })
      )
      // The worker receives the payload the parent packed at claim time, not a
      // re-pack: dependency outputs and flow-policy `priorWork` are selected
      // against the parent's live board, which does not exist here.
      .step(
        worker.connectInput<TaskDispatchInput>(
          (dispatch) => dispatch.payload as TaskWorkerInput
        ),
        {
          // Losing the claim stops the worker paying for work it can no longer
          // record; the substrate's write fence is what makes the hand-off safe.
          abortSignal: () => currentLeaseRenewal()?.signal,
          // Suspension is the one exit neither recorder sees: `SuspensionError`
          // bypasses `.rescue()` and a suspended request never aborts its signal,
          // so the driver would otherwise renew a parked worker's row forever.
          onSettled: (_ctx, outcome) => {
            if (outcome === "suspended") currentLeaseRenewal()?.stop();
          },
        }
      )
      // The child settles its own task through the SAME fenced recorders the
      // inline drain uses — both read the claim off `currentClaim`.
      .tap(recordSuccess)
      .rescue([{ block: recordError }]);

    return { ...entry, block, inputSchema: boardScopedSchema(boardId) };
  };
}

/**
 * The dispatch schema, narrowed to the board this entry belongs to.
 *
 * `boardId` is half the durable address, and an entry that accepted any
 * `boardId` would let a dispatch addressed to a since-removed board be
 * re-resolved from its persisted envelope into whatever board holds this seat
 * name now. If the two share a ledger, the gate can pass every arm — same row,
 * same attempt — because none of them asks which board the dispatch named.
 */
function boardScopedSchema(boardId: string) {
  return taskDispatchInputSchema.superRefine((input, ctx) => {
    if (input.boardId === boardId) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["boardId"],
      message:
        `[task-board] this dispatch is addressed to board "${input.boardId}", but this entry ` +
        `belongs to board "${boardId}". The envelope names a board that no longer holds this ` +
        `seat — it was removed or renamed since the dispatch was addressed.`,
    });
  });
}

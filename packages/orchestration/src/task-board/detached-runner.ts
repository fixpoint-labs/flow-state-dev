/**
 * The block a detached dispatch for one board enters (FIX-982 P3a).
 *
 * `taskBoard()` builds exactly one of these per board and stamps it onto every
 * binding that board declares, so `core`'s flow-level assembly routes to a
 * *board* and never to a worker. That is what makes the pre-worker sequence
 * below unbypassable: there is no path from a detached dispatch to a bare worker
 * block, and adding a worker to a board that already has a runner is covered by
 * construction rather than by remembering to wrap it.
 *
 * ## The four things that must happen before a detached worker runs
 *
 * All four are the same read, which is the point — one durable read per detached
 * request, doing four jobs:
 *
 * 1. **The start gate.** Between claim and spawn there is no request, so a
 *    cancel or a reclaim landing in that gap leaves the claimant proceeding from
 *    a stale snapshot — a cancelled task running to completion. The gate re-reads
 *    the row and aborts unless the claim is still current: `attempts` matches,
 *    `createdAt` matches, the row's incarnation matches, the status is still
 *    `in_progress`, and the claim's lease has not run out.
 * 2. **Worker selection.** The route comes from the row's own `assignee`, not
 *    from the dispatch envelope (BP-031). The envelope names a board; the ledger
 *    names the worker.
 * 3. **The task-scope mark.** `_markTaskScope` walks up to the first sequencer
 *    parent, so the runner's root must be a sequencer and this must happen in
 *    its leading `.tap`, before any child scope exists. Without it every item the
 *    detached worker emits is unattributed and the task's own item view is empty.
 * 4. **The claim-ticket re-mint.** The parent stamped its ticket into an
 *    `AsyncLocalStorage`, which is per-process and per-async-chain and therefore
 *    cannot reach here — deliberately, since a ticket carried on a payload is the
 *    forgeable shape the substrate rejects. The ticket is re-minted from the row
 *    the gate just verified, which makes it server-derived. Skipping it would
 *    leave every `completeTask` / `failTask` / `updateTask` the worker's model
 *    calls running unfenced, silently: "no ticket presented" and "not a claimed
 *    worker" are the same condition to the guard.
 *
 * ## Why this is an identity check and not a counter check
 *
 * A task deleted and recreated under the same id inside the claim→spawn window
 * passes an attempt-only gate: the recreate resets `attempts`, and the
 * replacement's first claim lands the counter right back where the dispatch
 * left it. The gate therefore checks *which row* as well as *which attempt*.
 *
 * `createdAt` is the cheap half and not the sound half. It is a millisecond
 * clock, and a delete-then-recreate under the same id lands inside the same
 * millisecond often enough (measured 198/200, see `tasks/schema/task.ts`) that
 * the replacement wears the original's stamp. `incarnationId` is the nonce
 * minted per incarnation for exactly this, and it is the field that actually
 * separates the two rows — with `createdAt` kept as the arm that still works on
 * a row or an envelope predating the nonce. Both ride the ticket the board
 * minted from the row it claimed, so neither costs an extra read.
 *
 * ## And why identity alone is not enough
 *
 * Every arm above compares the dispatch against the row. None of them asks
 * whether the claim is still *live*, and those are different questions: a claim
 * loses its row by running out of time as readily as by being superseded, and
 * the row looks untouched when it does. Nothing renews a detached row's lease
 * between the parent's hand-off and the child's first breath (FIX-1070), so a
 * child that waits in the host's queue longer than the lease starts on a row the
 * substrate already counts as free — same attempt, same stamps, still
 * `in_progress`, because no successor has come along and taken it yet.
 *
 * Letting that through is the expensive direction. The worker's side effects
 * commit first and the refusal arrives second: settlement is fenced on the same
 * lease, so `complete()` is declined `lost-claim`, the row stays recoverable,
 * and the next drain runs the whole thing again.
 */
import { sequencer, utility } from "@flow-state-dev/core";
import type { DefinedCapability } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition } from "@flow-state-dev/core/types";
import type { WorkstreamDispatchInput } from "@flow-state-dev/core";
import { z } from "zod";
import { ticketForClaim } from "../tasks/claim-ticket";
import { startLeaseRenewal } from "../tasks/lease-renewal";
import {
  currentLeaseRenewal,
  stampLeaseRenewal,
  withLeaseRenewalScope,
} from "../tasks/lease-renewal-scope";
import { stampCurrentClaim } from "./flow-policy-wiring";
import { coordinateKey, type WorkerCoordinate } from "./coordinate";
import { createRecordError, createRecordSuccess } from "./blocks/record-result";
import { taskBoardWorkerBodyStateSchema } from "./schemas";
import type { ResolvedWorkerSlot } from "./detached";
import { leaseLapsed, type Task, type TaskCollectionRef } from "../tasks";

/**
 * Thrown by the start gate when the claim this dispatch names is no longer the
 * row's current claim.
 *
 * **Superseded and expired both land here**, rather than the second getting a
 * name of its own. A claim stops being the row's live claim by running out of
 * time exactly as it does by being taken, the substrate already spells both
 * `lost-claim` at the fence, and what this dispatch must do about it is the same
 * either way: stop, write nothing, leave the row to be recovered. A second error
 * type would split one outcome across two names and invite a caller to handle
 * them differently when there is no different handling to do.
 *
 * A named error rather than a silent return: a detached request that stops
 * because its claim was superseded is a *correct* outcome, but one that stops
 * with no trace is indistinguishable from one that never ran. The board's
 * recorder path is not reached — the successor owns the row now, and writing
 * anything against it is precisely what the fence exists to refuse.
 */
export class StaleDetachedClaimError extends Error {
  readonly code = "stale-detached-claim";

  constructor(
    readonly taskId: string,
    detail: string
  ) {
    super(`[task-board] detached dispatch for task "${taskId}" is stale: ${detail}`);
    this.name = "StaleDetachedClaimError";
  }
}

/**
 * The runner's own sequencer state: the row the gate verified.
 *
 * Held as state rather than in a closure because the runner is built once and
 * shared by every detached request on the board — a closure cell would be one
 * cell for all of them, which is the concurrency bug the drain's own worker body
 * avoids the same way.
 */
const detachedRunnerStateSchema = taskBoardWorkerBodyStateSchema.extend({
  /**
   * The coordinate the verified row's assignee resolved to. `null` until the
   * gate runs.
   *
   * The only thing the gate has to hand forward beyond the claim, because it is
   * the only thing a later step needs and cannot re-derive: the router runs
   * after the tap and has no board read of its own. The verified row itself is
   * deliberately NOT kept — the worker receives the payload the parent packed,
   * so a copy of the row would be checkpointed on every detached request with no
   * consumer.
   */
  routedCoordinateKey: z.string().nullable().default(null),
});

export interface BuildDetachedRunnerOptions {
  /** Board name, used to name the assembled blocks. */
  name: string;
  /** The board's stable id — what a dispatch for this board carries. */
  boardId: string;
  /**
   * Resolve this board's collection from a block context.
   *
   * **Resolved against the running context, which inside a Workstream is the
   * Workstream's own.** A session-scoped board is therefore not reachable here,
   * and that is a real bound rather than an oversight: the general
   * resolve-the-parent's-board seam is settlement's, and a board whose rows a
   * detached worker must reach has to be addressable from the child — user or
   * org scope, or a session-scoped board that resolves to the lineage root.
   *
   * A board declared that way no longer reaches this code: `taskBoard()`
   * refuses it at construction (FIX-1074), because arriving here means the gate
   * reads an empty ledger, calls the claim stale, and leaves the row to be
   * reclaimed and redispatched forever. The gate's own `no such row` refusal
   * still names the possibility, since a board can also resolve to a different
   * ledger for reasons construction cannot see.
   */
  collection: (ctx: BlockContext) => Promise<TaskCollectionRef>;
  /**
   * Every worker this board declared detached, with its coordinate.
   *
   * The floor and uniform cases are read off these coordinates rather than
   * passed separately: a floor worker that was never declared detached is not
   * reachable here at all, so a second parameter naming one could disagree with
   * the slots and route a dispatch at a worker with no binding.
   */
  detached: readonly ResolvedWorkerSlot[];
  /**
   * The board's own resource declarations — the same `uses` the drain carries
   * (FIX-982).
   *
   * **The runner is a second action root, not a step under the drain.** A
   * detached dispatch enters here directly, so nothing the drain installed is
   * in scope: without this the durable ledger resolves as a freshly-declared,
   * empty collection and the start gate rejects every dispatch with "no such
   * row on board" — the row is there, this execution simply never declared the
   * resource holding it. Failing that way is what makes it worth naming: the
   * message reads as a stale claim, and the claim is perfectly current.
   */
  uses?: readonly DefinedCapability[];
}

/**
 * Resolve which coordinate a row's `assignee` routes to, using the board's own
 * three-case resolution.
 *
 * Deliberately not `dispatch-and-execute`'s helper, which throws on an unknown
 * assignee and has no floor. The `Object.hasOwn` shape matters for the same
 * reason it does in the drain: `assignee` arrives from a model-facing tool, so a
 * bare index would resolve an inherited `Object.prototype` member and return a
 * non-worker while skipping both the floor and the error.
 */
function coordinateForTask(
  task: Task,
  declared: ReadonlySet<string>,
  hasFloor: boolean,
  uniform: boolean
): WorkerCoordinate {
  if (uniform) return { kind: "uniform" };
  if (task.assignee !== undefined && declared.has(task.assignee)) {
    return { kind: "assignee", name: task.assignee };
  }
  if (hasFloor) return { kind: "floor" };
  throw new StaleDetachedClaimError(
    task.id,
    task.assignee === undefined
      ? "the row carries no assignee and this board declares no floor worker"
      : `no detached worker is declared for assignee "${task.assignee}" and this board declares no floor worker`
  );
}

/**
 * Build the board's detached runner.
 *
 * Returns `undefined` when the board declared no detached workers — the same
 * "honest absence" the flow-level core relies on, since a board with nothing
 * detached must stamp no binding and contribute no route.
 */
export function buildDetachedRunner(
  options: BuildDetachedRunnerOptions
): BlockDefinition<any, any> | undefined {
  const { name, boardId, collection: collectionFactory, detached, uses } = options;
  if (detached.length === 0) return undefined;

  // The same recorders the inline drain composes, bound to this board's
  // collection. Reused rather than reimplemented: they own the ticket-fenced
  // write-back and the rule for when lease renewal stops, and a second copy of
  // that rule is how the two paths drift.
  const recordSuccess = createRecordSuccess({
    name: `${name}-workstream-record-success`,
    collection: collectionFactory,
  });
  const recordError = createRecordError({
    name: `${name}-workstream-record-error`,
    collection: collectionFactory,
    // Swallow after writing the failure. Rethrowing would fail the Workstream's
    // request as well, and the request is not the thing that failed — the task
    // is, and the row now says so. A failed detached request would additionally
    // look to recovery like work to retry.
    onError: "skip",
  });

  const declaredAssignees = new Set<string>();
  let uniform = false;
  let hasFloor = false;
  for (const slot of detached) {
    if (slot.coordinate.kind === "assignee") declaredAssignees.add(slot.coordinate.name);
    if (slot.coordinate.kind === "uniform") uniform = true;
    if (slot.coordinate.kind === "floor") hasFloor = true;
  }

  // Route by the board's own encoded coordinate rather than by raw assignee, so
  // a board that legally declares an assignee spelled `"uniform"` or `"floor"`
  // cannot alias the slot of the same name.
  const routes: Record<string, BlockDefinition<any, any>> = {};
  for (const slot of detached) {
    routes[coordinateKey(slot.coordinate)] = slot.worker as BlockDefinition<any, any>;
  }

  const workerRouter = utility.keyedRouter({
    name: `${name}-workstream-router`,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    blocks: routes,
    select: (_input: unknown, ctx: BlockContext) => {
      const routed = ctx.sequencer?.state?.routedCoordinateKey;
      if (typeof routed !== "string") {
        // Unreachable through the assembled runner — the gate writes this before
        // the router is reached. Named anyway, because the failure it guards
        // against is the router being composed somewhere the gate is not.
        throw new Error(
          `[task-board] detached runner for board "${boardId}" reached its worker router ` +
            `without a verified route. The router must run inside the runner's sequencer, ` +
            `after the start gate.`
        );
      }
      return routed;
    },
  });

  return sequencer({
    name: `${name}-workstream-runner`,
    stateSchema: detachedRunnerStateSchema,
    // Same declarations the drain carries — see `uses` on the options type for
    // why a second action root has to repeat them.
    ...(uses !== undefined ? { uses } : {}),
  })
    .tap(async (dispatch: WorkstreamDispatchInput, ctx) =>
      // Same first-statement discipline the drain's worker body uses: the lease
      // renewal slot has to be published before the first `await`, or it lands
      // on a continuation scope that dies with this tap and every later reader
      // sees `undefined`.
      withLeaseRenewalScope(async () => {
        const board = await collectionFactory(ctx);
        const row = board.get(dispatch.taskId) as Task | undefined;

        // THE START GATE. Three facts, and each closes a different window.
        if (row === undefined) {
          throw new StaleDetachedClaimError(
            dispatch.taskId,
            `no such row on board "${boardId}" — it was deleted, or this board resolved to a ` +
              `different ledger than the one that claimed it (a session-scoped detached board ` +
              `is not reachable from its Workstream)`
          );
        }
        if (row.attempts !== dispatch.attempt) {
          throw new StaleDetachedClaimError(
            dispatch.taskId,
            `attempt ${dispatch.attempt} was superseded by attempt ${row.attempts}`
          );
        }
        if (row.createdAt !== dispatch.createdAt) {
          // Not a counter check: the id was reused, so this is a different task
          // wearing the same name.
          throw new StaleDetachedClaimError(
            dispatch.taskId,
            "the row was deleted and recreated under the same id after this dispatch was addressed"
          );
        }
        // The same question `createdAt` above asks, asked with a value that can
        // actually answer it. Compared only when BOTH sides carry a nonce
        // (BP-030): a row persisted before `incarnationId` shipped has none,
        // and so does an envelope enqueued by the previous version, and neither
        // is evidence of a recreate. Absence therefore leaves exactly the
        // protection this gate had before — `createdAt` alone — rather than
        // refusing work that is perfectly current.
        if (
          row.incarnationId !== undefined &&
          dispatch.incarnationId !== undefined &&
          row.incarnationId !== dispatch.incarnationId
        ) {
          throw new StaleDetachedClaimError(
            dispatch.taskId,
            "the row was deleted and recreated under the same id after this dispatch was " +
              "addressed (its incarnation differs, though its creation stamp does not)"
          );
        }
        if (row.status !== "in_progress") {
          throw new StaleDetachedClaimError(
            dispatch.taskId,
            `the row is "${row.status}", so no claim is outstanding on it`
          );
        }
        // The one arm that is about liveness rather than identity — see the
        // header for why the two cannot substitute for each other.
        //
        // **Refused, not renewed**, and that is not a preference between two
        // available moves. `renewLease` is fenced on this exact subtraction, so
        // it declines a lapsed lease by construction; adopting the row would
        // mean *re-claiming* it, minting a fresh attempt to run a payload the
        // parent packed against the old one. Modelling a hand-off that holds its
        // row across the queue wait is FIX-1070's question and the lease's shape
        // to change, not a branch to add here.
        //
        // Refusing costs nothing it did not already cost: the row keeps its
        // lapsed lease and its `in_progress` status, which is exactly what
        // `isClaimable` reads as recoverable, so the next drain takes it and the
        // work runs once. The clock is the collection's for the reason every
        // other reader of this subtraction takes it from there — the deadline
        // was stamped against it by the claim write.
        if (leaseLapsed(row, board.now())) {
          throw new StaleDetachedClaimError(
            dispatch.taskId,
            "its lease ran out before this dispatch started, so the row is back in " +
              "the claim queue and any work done under it could not be recorded"
          );
        }

        // The ticket is minted from the row just verified, never carried on the
        // envelope — the envelope supplied the target of the check and never the
        // authority for it.
        const ticket = ticketForClaim(board.collectionId, row);
        const routed = coordinateForTask(row, declaredAssignees, hasFloor, uniform);
        const routedKey = coordinateKey(routed);

        // The envelope's coordinate is checked, not trusted — routing above
        // already came from the row. This asserts the two agree.
        //
        // They can only disagree if the row's assignee moved between spawn and
        // start, which a detached board forbids: `freezeLedgerAssignee` makes
        // the assignee immutable after admission precisely because it is what
        // the routing coordinate derives from. So a mismatch is not a stale
        // claim in the ordinary sense — it means that guard did not hold, and
        // the consequence is specific and bad: the child session was derived
        // from the SPAWN's coordinate, so the work would run as a different
        // worker inside a Workstream addressed for the original one, mixing two
        // workers' histories under one topic.
        //
        // Cheap to check and it needs no read, since both values are already in
        // hand. Without it the field would be decorative — persisted on every
        // detached dispatch and consulted by nothing.
        if (dispatch.coordinateKey !== routedKey) {
          throw new StaleDetachedClaimError(
            dispatch.taskId,
            `this dispatch was addressed to ${dispatch.coordinateKey} but the row now routes to ` +
              `${routedKey}. A detached board freezes a task's assignee at admission, so this ` +
              `means that guard was bypassed — the Workstream it would run in belongs to a ` +
              `different worker.`
          );
        }

        // The ticket rides the state under the SAME key the drain's worker body
        // uses, which is what lets the shipped recorders below settle this row
        // without a second implementation of the fence.
        await ctx.sequencer!.patchState({
          currentClaim: ticket,
          routedCoordinateKey: routedKey,
        });

        // Marks this scope so every item the detached worker emits carries the
        // task id at emit time. Must be inside the runner's own sequencer, which
        // is why the runner's root is one.
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
    // against the parent's live board and its run state, neither of which exists
    // here. That payload is what the parent validated as JSON-safe before it
    // spawned, so what arrives is what was checked.
    .step(
      workerRouter.connectInput<WorkstreamDispatchInput>(
        (dispatch: WorkstreamDispatchInput) => dispatch.payload
      ),
      {
        // The same two lifecycle options the inline worker body carries, for the
        // same reasons — a detached worker is not a different kind of worker.
        //
        // Losing the claim stops the worker paying for work it can no longer
        // record. It is not what makes the hand-off safe (the substrate's write
        // fence is), but without it a displaced worker runs to completion and
        // its result is then declined.
        abortSignal: () => currentLeaseRenewal()?.signal,
        // Suspension is the one exit neither recorder below sees:
        // `SuspensionError` bypasses `.rescue()` by design, and a suspended
        // request never aborts its signal. Without this the driver would renew
        // an `in_progress` row for as long as the host lives — the task held by
        // a worker that is parked, recoverable by nobody. That is the deadlock
        // the lease exists to remove, rebuilt out of a park.
        //
        // ONLY on that exit: the returned and threw paths still owe the
        // substrate a ticket-fenced write, and stopping renewal before it would
        // get a healthy worker's result declined on a lapsed lease.
        onSettled: (_ctx, outcome) => {
          if (outcome === "suspended") currentLeaseRenewal()?.stop();
        },
      }
    )
    // The Workstream settles its own task, through the SAME fenced recorders the
    // inline drain uses — not a second settlement path. Both read the claim off
    // `currentClaim`, which the gate stamped above, so a displaced attempt
    // declines here exactly as it would inline.
    //
    // Without these two the row would sit `in_progress` forever while the
    // renewal driver kept asserting a lease for a worker that had finished: the
    // task never completes, nothing can reclaim it, and the detached path would
    // be strictly worse than running inline.
    .tap(recordSuccess)
    .rescue([{ block: recordError }]);
}

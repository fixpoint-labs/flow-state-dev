/**
 * Board-level meta emission.
 *
 * The substrate's `task-change` component items carry per-task
 * lifecycle state (added → claimed → completed/errored/...). This file
 * adds a complementary `task-board-meta` component item that carries
 * the *aggregate* state of the board itself — "the drain is starting"
 * vs "the drain is finished" — plus a summary of task counts when the
 * board exits.
 *
 * Why a separate item type:
 *
 * - **Renderer pivot.** A future `<TaskPlan />` renderer subscribes to
 *   `task-board-meta` for board-level state (a header / status badge /
 *   completion summary) and to `task-change` for per-task rows.
 *   Without the meta item the renderer would have to infer board state
 *   from task aggregates, which is fragile.
 *
 * - **Pattern-specific extensions.** Wrappers around `taskBoard`
 *   (P&E, supervisor) carry richer status vocabularies — `planning`,
 *   `replanning`, `reviewing`, etc. Those wrappers can emit their own
 *   `task-board-meta` updates with extended `data.status` strings on
 *   top of the substrate's baseline `active` / `completed`.
 *
 * Both emitting blocks are state-mutation-only sentinels — they
 * produce no novel output, just side-effect a component item via
 * `ctx.emit.component`. Wired with `.tap()` per BP-012.
 *
 * ## Why dispatch needs a reason of its own
 *
 * The structural test is `counts.completed === counts.total`, and a dispatched
 * board that did exactly what it was built to do fails it: the row it handed
 * over is still `in_progress`, owned by a child session. So every successful
 * dispatch drain announced itself as `"blocked-by-failures"` — permanently,
 * since no later drain re-emits this item once the child settles. The feature
 * whose entire point is that background work is *visible* was reporting its own
 * success as a terminal failure.
 *
 * Reusing `"all-completed"` would be the same defect facing the other way: a
 * consumer reads it as "nothing left to do" and stops watching while a child is
 * still working. The honest answer is a third thing, so it is a third value.
 *
 * A board is `"dispatched"` only when **every** remaining non-`completed` row is
 * dispatched. One errored row alongside them is a board that had failures, and
 * `"blocked-by-failures"` still says so. When the reason is `"dispatched"`,
 * `counts.in_progress` is exactly the number of rows still running elsewhere —
 * there is no other kind of remaining row left for it to count.
 *
 * The `counts` are a final snapshot. They are descriptive, and a caller
 * reading them wants the board's actual last state.
 *
 * The retry reason is read from a persisted DENIAL MARKER on the tasks,
 * never inferred from `counts.retries === maxTotalRetries` — that
 * arithmetic does not establish a refusal. A task can consume the last
 * grant and then succeed while an unrelated task with no `maxAttempts`
 * fails normally, leaving the count exactly at the limit with an errored
 * task on the board and no retry ever denied. A termination reason that
 * can lie is worse than no new reason at all.
 *
 * The emitted item is keyed by `collectionId`, so the latest state
 * replaces the previous one in the client UI — `active` then
 * `completed` resolves to one rendered status per board.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { Task, TaskCollectionRef } from "../../tasks";
import { anyRetryDeniedByBudget, sumGrantedRetries } from "../../tasks/collection/internal";
import { isDispatched, waitsOnUser, type RunsElsewhere } from "../shared";
import { hasOpenHold, leaseLapsed } from "../../tasks";

/** Component-item type emitted by both board-meta blocks. */
export const TASK_BOARD_META_COMPONENT_TYPE = "task-board-meta";

export interface BoardMetaOptions {
  name: string;
  collection: (ctx: BlockContext) => Promise<TaskCollectionRef>;
  collectionId: string;
}

export interface BoardMetaCompletedOptions extends BoardMetaOptions {
  /**
   * Rows whose work is routed to a child session (FIX-982) — the same predicate
   * the board hands its exit question, and for the same reason it has to be the
   * same one. See {@link isDispatched}.
   *
   * Absent for a plan board (FIX-2076), which is what keeps the reason this
   * block reports bit-for-bit what it was for those boards.
   */
  runsElsewhere?: RunsElsewhere;
}

/**
 * Emit `{ status: "active" }` at the top of the pipeline so consumers
 * know the board has started. Fires once per board invocation,
 * before `seedCollection`.
 */
export function createBoardMetaActive(options: BoardMetaOptions) {
  const { name, collectionId } = options;
  return handler({
    name,
    // Substrate-internal meta-emitter. The task-board-meta
    // ComponentItem it emits IS the user-visible signal; the
    // auto-emitted block_output trace is redundant noise.
    transient: true,
    inputSchema: z.unknown(),
    execute: async (_input, ctx) => {
      ctx.emit.component(
        TASK_BOARD_META_COMPONENT_TYPE,
        { collectionId, status: "active" },
        { key: collectionId }
      );
    },
  });
}

/**
 * Is any remaining row going nowhere — stuck on dependencies that no running
 * work will satisfy (FIX-1234)?
 *
 * A dispatched row is moving elsewhere right now; a `pending` row waiting on a
 * task that will never complete is moving nowhere at all, and that is the fact
 * an operator needs.
 *
 * **A reachability closure, not a one-level check**: the seed set is
 * everything that will resolve on its own (already completed, worked right
 * now under a live lease, or running and waiting on a user's answer) and the
 * loop closes over the `pending` rows those
 * release, so a dependent of a dependent of running work is not called stuck.
 * It runs once, after the pool has finished, never on the exit predicate's
 * hot path.
 */
function hasRowGoingNowhere(
  all: readonly Task[],
  remaining: readonly Task[],
  now: number
): boolean {
  // Seed: rows this board's dependency graph is not what resolves. Either they
  // are already done, or a running row waits on a user, or somebody is
  // working them right now.
  //
  // **The last of those is a lease question, not a status or routing one**, and
  // that is the whole correctness of this seed. `in_progress` alone would seed
  // an ABANDONED row — a worker died, the lease lapsed, and nothing is coming
  // back for it until a later drain reclaims it. `isDispatched` alone would miss
  // a row another drain's live worker is holding, because that predicate needs
  // `runsElsewhere` and a plan board passes none; the row would be called
  // stuck while it is being actively worked. The live lease answers for both,
  // which is why this reads it directly instead of asking where the work was
  // routed.
  const willResolve = new Set<string>();
  for (const task of all) {
    if (
      task.status === "completed" ||
      // A row that asked midway dropped its lease, so the lease test below
      // would call it abandoned; the answer owes it a turn, so it is not.
      // Only the running one: a `pending` row filed on questions still needs
      // its deps once answered, so it enters through the expansion below.
      waitsOnUser(task) ||
      (task.status === "in_progress" && !leaseLapsed(task, now))
    ) {
      willResolve.add(task.id);
    }
  }
  // Close over the rows those release. `pending` only: expansion models
  // "becomes runnable once its deps resolve", which is a property of a row
  // waiting to be claimed. An `in_progress` row is not waiting on deps at all,
  // so its fate is settled by the seed above and admitting it here would let a
  // lapsed one back in through a vacuously-true empty `deps` list.
  //
  // Each pass adds at least one row or the loop ends, so it is bounded by the
  // board's row count.
  let added = true;
  while (added) {
    added = false;
    for (const task of all) {
      if (willResolve.has(task.id)) continue;
      // `errored` / `cancelled` / `held` never resolve, and rung 3 has
      // already reported them by the time this runs.
      if (task.status !== "pending") continue;
      if ((task.deps ?? []).every((dep) => willResolve.has(dep))) {
        willResolve.add(task.id);
        added = true;
      }
    }
  }
  return remaining.some((task) => !willResolve.has(task.id));
}

/**
 * Emit `{ status: "completed", terminationReason, counts }` after the forEach
 * drains. The counts snapshot the final lifecycle distribution so a renderer can
 * display "5 completed, 1 errored" without re-walking the per-task event stream.
 *
 * `terminationReason` says why the board stopped:
 *
 * - `"all-completed"` — every task reached `completed`.
 * - `"blocked-by-failures"` — something is stuck for a reason no review will
 *   clear.
 * - `"retry-budget-exhausted"` — the collection's cumulative retry budget
 *   refused a retry (FIX-948). Read from a persisted denial marker, never
 *   inferred from `counts.retries === maxTotalRetries`, which does not
 *   establish that a refusal happened.
 * - `"dispatched"` — every remaining row is running in a child session (FIX-1074).
 *   A success, not a stall; `counts.in_progress` is how many.
 * - `"waiting-on-a-user"` — the board stopped because the work it has left
 *   waits on a user: a question, a confirm, or a run's stop for a review or
 *   approval (FIX-2214). The same words `goalSeekLoop` ends a pass with.
 *
 * **The ladder's order is the contract.** First match wins:
 *
 * 1. a persisted retry-denial marker exists → `retry-budget-exhausted`.
 * 2. nothing un-`completed` remains → `all-completed`.
 * 3. any remaining row is `errored`, `cancelled`, or `held` →
 *    `blocked-by-failures`.
 * 4. any remaining row is going nowhere → `blocked-by-failures`. Rung 3 catches
 *    a row stuck by its own *status*; this catches one stuck by its
 *    *dependencies*, or abandoned by a worker that died. See
 *    {@link hasRowGoingNowhere}.
 * 5. any remaining row has an open hold, so waits on a user →
 *    `waiting-on-a-user`. Rung 3 left only `pending` and `in_progress`
 *    rows, and rung 4 already vouches for the others.
 * 6. every remaining row is dispatched → `dispatched`.
 * 7. otherwise → `blocked-by-failures`.
 *
 * Note: in `onIdle: "wait"` mode an early-firing `shouldExit` while tasks are
 * still `in_progress` / `pending` reports `"blocked-by-failures"` even though
 * nothing failed. Callers overriding termination can read `counts` to
 * disambiguate.
 *
 * Why each reason exists and why the ladder is ordered this way is in the module
 * header; the closure rung's reasoning is on {@link hasRowGoingNowhere}.
 */
export function createBoardMetaCompleted(options: BoardMetaCompletedOptions) {
  const { name, collection: collectionFactory, collectionId, runsElsewhere } = options;
  return handler({
    name,
    // Substrate-internal meta-emitter. The task-board-meta
    // ComponentItem it emits IS the user-visible signal; the
    // auto-emitted block_output trace is redundant noise.
    transient: true,
    inputSchema: z.unknown(),
    execute: async (_input, ctx) => {
      const collection = await collectionFactory(ctx);
      const all = collection.list();
      const counts = {
        total: all.length,
        completed: collection.count({ status: "completed" }),
        errored: collection.count({ status: "errored" }),
        cancelled: collection.count({ status: "cancelled" }),
        held: collection.count({ status: "held" }),
        in_progress: collection.count({ status: "in_progress" }),
        pending: collection.count({ status: "pending" }),
        /** Failure retries this board authorized (FIX-948). */
        retries: sumGrantedRetries(all),
      };
      // Read off the COLLECTION, not this board's config: a board handed a
      // collection it did not construct knows nothing about that collection's
      // caps, and a caller who built one with a budget deliberately would
      // otherwise be told `null` — "nothing was enforced" — about a limit they
      // set themselves. `?? null` tolerates a custom `TaskCollectionRef`
      // predating this field at runtime; `null` means no limit is in force.
      const maxTotalRetries = collection.maxTotalRetries ?? null;
      // Evaluated against the collection's own clock, because the lease the
      // dispatch test reads was stamped against it by the claim write — the
      // same reason every other reader of that deadline takes it from here.
      const now = collection.now();
      const remaining = all.filter((task) => task.status !== "completed");
      const allRemainingDispatched =
        remaining.length > 0 &&
        remaining.every((task) => isDispatched(task, now, runsElsewhere));
      // Rung 3: a row that is stuck for a reason of its own. `held` joins the
      // two failure statuses here.
      const anyRemainingStuck = remaining.some(
        (task) =>
          task.status === "errored" ||
          task.status === "cancelled" ||
          task.status === "held"
      );
      const terminationReason:
        | "all-completed"
        | "blocked-by-failures"
        | "retry-budget-exhausted"
        | "dispatched"
        | "waiting-on-a-user" = anyRetryDeniedByBudget(all)
        ? "retry-budget-exhausted"
        : remaining.length === 0
          ? "all-completed"
          : anyRemainingStuck
            ? "blocked-by-failures"
            : hasRowGoingNowhere(all, remaining, now)
              ? "blocked-by-failures"
              : remaining.some(hasOpenHold)
                ? "waiting-on-a-user"
                : allRemainingDispatched
                  ? "dispatched"
                  : "blocked-by-failures";
      ctx.emit.component(
        TASK_BOARD_META_COMPONENT_TYPE,
        { collectionId, status: "completed", terminationReason, counts, maxTotalRetries },
        { key: collectionId }
      );
    },
  });
}

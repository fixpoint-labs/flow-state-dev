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
 * ## Why hand-off needs a reason of its own
 *
 * The structural test is `counts.completed === counts.total`, and a detached
 * board that did exactly what it was built to do fails it: the row it handed
 * over is still `in_progress`, owned by a Workstream. So every successful
 * detached drain announced itself as `"blocked-by-failures"` — permanently,
 * since no later drain re-emits this item once the child settles. The feature
 * whose entire point is that background work is *visible* was reporting its own
 * success as a terminal failure.
 *
 * Reusing `"all-completed"` would be the same defect facing the other way: a
 * consumer reads it as "nothing left to do" and stops watching while a child is
 * still working. The honest answer is a third thing, so it is a third value.
 *
 * A board is `"handed-off"` only when **every** remaining non-`completed` row is
 * handed off. One errored row alongside them is a board that had failures, and
 * `"blocked-by-failures"` still says so. When the reason is `"handed-off"`,
 * `counts.in_progress` is exactly the number of rows still running elsewhere —
 * there is no other kind of remaining row left for it to count.
 *
 * ## Why the park reason is carried in rather than derived here
 *
 * This block runs *after* the worker pool finishes and it reads the collection
 * fresh. A resume landing in that window turns the parked row back into a
 * `pending` one, so a reason inferred from the rows at this moment cannot see
 * why the drain stopped — it would report a board that exited successfully for
 * review as a failure. So the causal verdict is recorded where it is decided,
 * in `checkBoard`, and travels here on the worker loop's own output.
 *
 * That path is the drain's dataflow, not a shared bag: each worker's final
 * `checkBoard` output is an element of the `forEach` result, which is the value
 * this block's `.tap` receives. It is therefore scoped to this drain
 * *invocation* by construction — two drains of the same board, even inside one
 * request, each read their own pool's outputs and cannot see the other's. A
 * verdict parked on the board's flow-state bag would not have that property:
 * that object is allocated once per board *definition*, so one drain's teardown
 * would clear the other's mid-run.
 *
 * The `counts`, by contrast, stay a final snapshot. They are descriptive, and a
 * caller reading them wants the board's actual last state.
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
import { isHandedOff, type RunsElsewhere } from "../shared";
import { leaseLapsed } from "../../tasks";

/** Component-item type emitted by both board-meta blocks. */
export const TASK_BOARD_META_COMPONENT_TYPE = "task-board-meta";

export interface BoardMetaOptions {
  name: string;
  collection: (ctx: BlockContext) => Promise<TaskCollectionRef>;
  collectionId: string;
}

export interface BoardMetaCompletedOptions extends BoardMetaOptions {
  /**
   * Rows whose work is routed to a Workstream (FIX-982) — the same predicate
   * the board hands its exit question, and for the same reason it has to be the
   * same one. See {@link isHandedOff}.
   *
   * Absent for every board that declares nothing detached, which is what keeps
   * the reason this block reports bit-for-bit what it was for those boards.
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
 * Is any remaining row going nowhere — stuck on dependencies that answering
 * every review would not satisfy (FIX-1234)?
 *
 * This is the question that keeps a review gate from masking an unrelated
 * stall. A parked row moves when a person acts; a handed-off row is moving
 * elsewhere right now; a `pending` row waiting on a task that will never
 * complete is moving nowhere at all, and that is the fact an operator needs
 * even when a review also happens to be outstanding.
 *
 * **A reachability closure, not a one-level check**, and the difference is
 * load-bearing. `A` depends on the parked row and `B` depends on `A`: answering
 * the review releases both, so neither is going nowhere. A one-level test —
 * "would this row be claimable if the parked rows completed?" — sees `B`'s
 * dependency unsatisfied and would report a stall on a board that only needs an
 * answer. So the seed set is everything that will resolve on its own (already
 * completed, parked and therefore answerable, or handed to a Workstream) and
 * the loop closes over the rows those release.
 *
 * **The condition is causal, not positional, and that distinction is the whole
 * design.** "Is anything here stuck?" is the cheap question and it is the wrong
 * one: a `pending` row that depends on the parked row is stuck by that measure,
 * and answering the review releases it. Reporting a stall there would be wrong
 * on the *expected* shape rather than a corner — §6 decision 3 refuses
 * `onIdle: "complete"` precisely because a parked task's dependent is the
 * normal case. So the question asked is "would resuming the parked work unstick
 * this?", and only a row the answer cannot reach is reported.
 *
 * **Two routes were available and this takes the more expensive one.**
 * Establishing downstream-ness costs this closure; declining to establish it
 * and keeping `blocked-by-failures` whenever causality is unproven costs
 * nothing but misreports every dependent of a parked row — the common shape.
 * The cost objection that ruled a dependency walk out once does not transfer:
 * §6 decision 3 rejected one in the **exit predicate**, which `boardQuiescence`
 * evaluates on every idle-wait fan-out event, the hottest read the board has.
 * This runs once, after the pool has finished, at the same position where the
 * board's own `createCascadeSkipDependents` already walks the graph
 * transitively. Same walk, three orders of magnitude fewer evaluations.
 *
 * **Why not "the park was the sole cause".**
 * The tempting shape for rung 5 is a guard asking whether anything
 * *other than the park* contributed to the exit. It was considered and
 * rejected, and rung 4 exists because of what it got wrong: on a board
 * with a parked row **and** a handed-off row, the hand-off exclusion
 * also contributed, so under a sole-cause rule the reason falls
 * through to `handed-off` and the operator loses the one fact they
 * need. Rung 4 asks a different question — is anything here going
 * nowhere? — and handed-off work is going somewhere, so it is not
 * caught. That is the whole distinction: `parked-for-review` must keep
 * beating `handed-off`, and must not beat a row that will never run.
 *
 * **Three routes to a park verdict standing beside a row this closure did not
 * flag, and they do not have the same answer.** The empty `deps` list is
 * vacuously true, so any row admitted to the expansion loop joins `willResolve`
 * whatever it is waiting for. Whether that matters depends on how the row got
 * there:
 *
 * 1. **An unrelated *ready* `pending` row — unreachable.** Such a row stops the
 *    park verdict from being issued at all. `classifyBoard` carries
 *    `excusedParked: true` out of exactly two returns and a ready row defeats
 *    both: `"drained"` needs `inFlight.waiting === 0`, and `countWaitable`
 *    counts a `pending` row that is neither handed off nor parked; `"blocked"`
 *    needs `!hasClaimableTask`, and `isClaimable` reduces to `depsSatisfied`
 *    for a `pending` row (there is deliberately no attempts arm), which is
 *    vacuously true here. The classifier answers `continue`, carrying
 *    `excusedParked: false`. An exhausted `maxIterations` cannot manufacture
 *    one either: the cap trips on whatever the last classification returned,
 *    and that was the `continue`.
 * 2. **A row added *after* the pool's last classification — real, and the
 *    reason correctly stays `parked-for-review`.** The excusal was decided
 *    honestly, when nothing else was waitable; the collection moved afterwards.
 *    The late row is not something this drain declined to run, and reporting
 *    `blocked-by-failures` would announce a failure on a board where nothing
 *    failed and the new row is perfectly runnable — the same defect class this
 *    rung exists to remove, since that is how hand-off used to report its own
 *    success as a terminal failure. "Another drain is required" is not evidence
 *    against the reason; it is what the reason means.
 * 3. **A row whose lease lapsed after that classification — real, and it is
 *    what the lease check in the seed handles.** A handed-off row with a live
 *    lease is excused by `countWaitable`, so the drain can exit `drained` with
 *    a park verdict while that row is still in flight. If the lease then lapses
 *    before this block takes its own `collection.now()`, the row is abandoned
 *    rather than in flight, and answering the review does not recover it — a
 *    lease reclaim on a later drain does. Here `parked-for-review` genuinely
 *    would be wrong, and the ladder already agrees: with no review outstanding,
 *    `allRemainingHandedOff` re-reads the lease, finds it lapsed, and falls
 *    through to `blocked-by-failures`. Seeding on the lease rather than on
 *    `in_progress` is what keeps the park rung from masking that.
 */
function hasRowGoingNowhere(
  all: readonly Task[],
  remaining: readonly Task[],
  now: number
): boolean {
  // Seed: rows this board's dependency graph is not what resolves. Either they
  // are already done, or a person owes an answer on them, or somebody is
  // working them right now.
  //
  // **The last of those is a lease question, not a status or routing one**, and
  // that is the whole correctness of this seed. `in_progress` alone would seed
  // an ABANDONED row — a worker died, the lease lapsed, and nothing is coming
  // back for it until a later drain reclaims it. `isHandedOff` alone would miss
  // a row another drain's live worker is holding, because that predicate needs
  // `runsElsewhere` and an inline board declares none; the row would be called
  // stuck while it is being actively worked. The live lease answers for both,
  // which is why this reads it directly instead of asking where the work was
  // routed.
  const willResolve = new Set<string>();
  for (const task of all) {
    if (
      task.status === "completed" ||
      task.status === "parked" ||
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
      // `errored` / `cancelled` / `blocked` never resolve, and rung 3 has
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
 * Did this drain's worker pool stop because rows parked for a human were
 * excused from the board's waitable count (FIX-1234)?
 *
 * **This answers about the pool, not about the board, and the ladder pairs it
 * with a check on the board.** A carried verdict is a statement about a moment
 * that has passed: the pool decided, and the collection kept moving. It can
 * therefore be *stale* — a resume landing before the pool finishes, on a board
 * whose other workers then stop for their own reasons, leaves this reading
 * `true` with nothing parked any more.
 *
 * Rung 5 requires `counts.parked > 0` alongside it for that reason, and
 * the shape of that guard is deliberate. Three separate attempts were made to
 * enumerate the routes by which this verdict can go stale, and each turned up
 * another one. `"parked-for-review"` names a state, so the cheap and complete
 * check is whether the board is in it — a check that cannot be wrong about the
 * thing it names beats one that has to be right about how it got there.
 *
 * The verdict is still necessary: the counts alone cannot tell a board that
 * stopped *because* of a review from one that merely happens to have a parked
 * row while stopping for another reason. Verdict says why, counts say whether;
 * the reason needs both.
 *
 * `input` is the value the completion tap receives, which in the composed board
 * is the `forEach` result — one final `checkBoard` output per worker loop. Any
 * one worker deciding it stopped for that reason is enough: workers exit
 * independently, and the ladder above is what keeps a *stale* park claim from
 * mattering (a resumed row that then completed reaches rung 2, an errored one
 * rung 3, both before the park rung is consulted).
 *
 * Written defensively, and permissively, rather than by declaring an
 * `inputSchema` on the block: this block is exported and constructed directly
 * by callers outside the composed drain, so an input that is anything else has
 * to mean "no park verdict was carried", not a validation failure. The
 * end-to-end board tests are what hold the wiring, since a rewiring that broke
 * the carry would change the reported reason.
 */
function excusedParkedByPool(input: unknown): boolean {
  if (!Array.isArray(input)) return false;
  // A property check rather than a cast: this input crosses no schema boundary
  // (the block declares `inputSchema: z.unknown()` so callers outside the
  // composed drain keep working), so asserting the shape with `as` would be
  // claiming a guarantee nothing checked.
  return input.some(
    (exit) =>
      typeof exit === "object" &&
      exit !== null &&
      "excusedParked" in exit &&
      (exit as { excusedParked?: unknown }).excusedParked === true
  );
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
 * - `"handed-off"` — every remaining row is running in a Workstream (FIX-1074).
 *   A success, not a stall; `counts.in_progress` is how many.
 * - `"parked-for-review"` — the board stopped because the work it has left is
 *   waiting on a person (FIX-1234). Only a board with `onReview: "exit"`
 *   reports it; `counts.parked` is how many.
 *
 * **The ladder's order is the contract.** First match wins:
 *
 * 1. a persisted retry-denial marker exists → `retry-budget-exhausted`.
 * 2. nothing un-`completed` remains → `all-completed`.
 * 3. any remaining row is `errored`, `cancelled`, or `blocked` →
 *    `blocked-by-failures`.
 * 4. any remaining row is going nowhere → `blocked-by-failures`. Rung 3 catches
 *    a row stuck by its own *status*; this catches one stuck by its
 *    *dependencies*, or abandoned by a worker that died. See
 *    {@link hasRowGoingNowhere}.
 * 5. the exit decision excused rows as parked, **and a row is still parked** →
 *    `parked-for-review`. The verdict comes from this drain's own pool, never
 *    from the rows as they stand now — but the reason names a state, so it is
 *    also checked against that state: a board with nothing in `parked`
 *    never reports it, whatever the pool carried.
 * 6. every remaining row is handed off → `handed-off`.
 * 7. otherwise → `blocked-by-failures`.
 *
 * **On a board with no parked row the reason is exactly what it was before
 * FIX-1234.** Rung 5 is unreachable without a parked row — checkable by looking
 * at `counts.parked`, not by reasoning about how the verdict got here —
 * and rung 4 fires only where rung 7 already reported `blocked-by-failures` by
 * another route.
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
    execute: async (input, ctx) => {
      const collection = await collectionFactory(ctx);
      const all = collection.list();
      const counts = {
        total: all.length,
        completed: collection.count({ status: "completed" }),
        errored: collection.count({ status: "errored" }),
        cancelled: collection.count({ status: "cancelled" }),
        blocked: collection.count({ status: "blocked" }),
        parked: collection.count({ status: "parked" }),
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
      // hand-off test reads was stamped against it by the claim write — the
      // same reason every other reader of that deadline takes it from here.
      const now = collection.now();
      const remaining = all.filter((task) => task.status !== "completed");
      const allRemainingHandedOff =
        remaining.length > 0 &&
        remaining.every((task) => isHandedOff(task, now, runsElsewhere));
      // Rung 3: a row that is stuck for a reason of its own. `blocked` joins the
      // two failure statuses here so an unrelated review gate cannot mask it.
      const anyRemainingStuck = remaining.some(
        (task) =>
          task.status === "errored" ||
          task.status === "cancelled" ||
          task.status === "blocked"
      );
      const terminationReason:
        | "all-completed"
        | "blocked-by-failures"
        | "retry-budget-exhausted"
        | "handed-off"
        | "parked-for-review" = anyRetryDeniedByBudget(all)
        ? "retry-budget-exhausted"
        : remaining.length === 0
          ? "all-completed"
          : anyRemainingStuck
            ? "blocked-by-failures"
            : hasRowGoingNowhere(all, remaining, now)
              ? "blocked-by-failures"
              : excusedParkedByPool(input) && counts.parked > 0
                ? "parked-for-review"
                : allRemainingHandedOff
                  ? "handed-off"
                  : "blocked-by-failures";
      ctx.emit.component(
        TASK_BOARD_META_COMPONENT_TYPE,
        { collectionId, status: "completed", terminationReason, counts, maxTotalRetries },
        { key: collectionId }
      );
    },
  });
}

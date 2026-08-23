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
 * The emitted item is keyed by `collectionId`, so the latest state
 * replaces the previous one in the client UI — `active` then
 * `completed` resolves to one rendered status per board.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { TaskCollectionRef } from "../../tasks";
import { anyRetryDeniedByBudget, sumGrantedRetries } from "../../tasks/collection/internal";
import { isHandedOff, type RunsElsewhere } from "../shared";

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
 * Emit `{ status: "completed", terminationReason, counts: ... }` after
 * the forEach drains. The counts snapshot the final lifecycle
 * distribution so a renderer can display "5 completed, 1 errored"
 * without re-walking the per-task event stream.
 *
 * `terminationReason` distinguishes a clean drain (`"all-completed"`)
 * from a board that exited with non-`completed` tasks remaining
 * (`"blocked-by-failures"`), from one the collection's cumulative
 * retry budget stopped (`"retry-budget-exhausted"`, FIX-948), from one
 * that exited because it handed its remaining work to a Workstream
 * (`"handed-off"`, FIX-1074), and from one that exited because the
 * only work left is parked for a human (`"parked-for-review"`,
 * FIX-1234). Note: in `onIdle: "wait"` mode an early-firing
 * `shouldExit` while tasks are still `in_progress` / `pending` will
 * report `"blocked-by-failures"` even though nothing actually failed;
 * users overriding termination can read `counts` directly to
 * disambiguate.
 *
 * ## The ladder, in order — the order is the contract
 *
 * First match wins, and getting the order wrong silently regresses
 * behaviour that is deliberate:
 *
 * 1. a persisted retry-denial marker exists → `retry-budget-exhausted`.
 *    First because an operator needs to know the *budget* stopped the
 *    board, and a denied retry settles its task terminal `errored`, so
 *    any later failure rule would swallow it.
 * 2. nothing un-`completed` remains → `all-completed`.
 * 3. any remaining row is `errored`, `cancelled`, or `blocked` →
 *    `blocked-by-failures`. Something did fail, and the failure is the
 *    more actionable fact. `blocked` sits on THIS rung rather than
 *    falling through to the default because a row moved to `blocked`
 *    deliberately is a second, independent reason the board stopped —
 *    and rung 4 may not say "we stopped because a human is owed an
 *    answer" while something else is also stuck. This changes no
 *    reported string: with no parked row a remaining `blocked` row
 *    reported `blocked-by-failures` before and reports it here, only
 *    the rung deciding it moved.
 * 4. the exit decision excused rows as parked → `parked-for-review`.
 *    Read from the carried verdict, never from the rows as they stand
 *    now. Reachable only once rungs 1–3 have ruled out every other
 *    reason the board could have stopped, which is what lets it mean
 *    "the park is why" without a second predicate that has to be kept
 *    in step with the exclusion list.
 * 5. every remaining row is handed off → `handed-off`.
 * 6. otherwise → `blocked-by-failures`.
 *
 * With no parked row anywhere, rung 4 is inert and the ladder is
 * exactly the classifier it was before FIX-1234.
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
 */
/**
 * Did this drain's worker pool stop because rows parked for a human were
 * excused from the board's waitable count (FIX-1234)?
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
        awaiting_review: collection.count({ status: "awaiting_review" }),
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
            : excusedParkedByPool(input)
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

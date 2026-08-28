/**
 * Termination handler for the Task Board worker loop (FIX-621).
 *
 * Pure exit-decision: reads the board's in-flight count (and
 * `shouldExit` for `onIdle: "wait"`) and returns
 * `{ shouldContinue, reason }`. The pattern's worker `loopBack`
 * predicate consumes `shouldContinue` to decide whether to iterate.
 *
 * Modes:
 *
 * - `complete-or-blocked` (default): exit when no `pending`,
 *   `in_progress`, or `parked` tasks remain (`drained`), OR
 *   when no in-flight worker is active AND no `pending` task is
 *   claimable because every remaining pending has a non-`completed`
 *   dep (`blocked`). The blocked exit closes the dispatcher-deadlock
 *   class of bug where a `pending` task with an `errored` /
 *   `cancelled` dep keeps `inFlightCount` non-zero forever.
 *
 * - `complete`: exit only when no `pending`, `in_progress`, or
 *   `parked` tasks remain. Legacy default; preserves the
 *   spinning-poll behavior for boards that legitimately wait on an
 *   external pump to mark deps complete.
 *
 *   `parked` keeps the loop alive in both modes above
 *   (FIX-443 §10.1) while `onReview` is on its default `"hold"`: the
 *   worker's preceding `.waitForCondition` blocks until an external
 *   actor transitions the task back to `pending` (or to a terminal
 *   state).
 *
 *   `onReview: "exit"` (FIX-1234) is the second knob, and it changes
 *   that answer for the default `onIdle` only — the mode is refused at
 *   construction on `complete` and on `wait`. There, parked rows are
 *   excused from the counts, so the drain returns and leaves the row
 *   parked for a later drain to claim once it is resumed.
 *
 * - `wait`: never exit on idle. Defers to the user-supplied
 *   `shouldExit` predicate, evaluated once per iteration. Without
 *   `shouldExit`, the loop runs until `maxIterations` trips.
 *
 * Pre-FIX-621 this block also slept `idlePollMs` between iterations to
 * bound busy-poll cost. That responsibility now lives in the worker
 * sequencer's `.waitForCondition` step (event-driven wake), so this
 * handler is purely synchronous decision logic.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { TaskCollectionRef } from "../../tasks";
import {
  checkBoardOutputSchema,
  taskBoardWorkerStateSchema,
  type CheckBoardOutput,
} from "../schemas";
import { classifyBoard } from "../quiescence";
import type { RunsElsewhere } from "../shared";

export interface CheckBoardOptions {
  name: string;
  collection: (ctx: BlockContext) => Promise<TaskCollectionRef>;
  onIdle: "wait" | "complete" | "complete-or-blocked";
  shouldExit?: (collection: TaskCollectionRef) => boolean;
  /**
   * Rows a Workstream is running (FIX-982). Forwarded verbatim to
   * `classifyBoard`, which is the only thing that reads it — this block
   * keeps mapping the verdict straight onto its `reason` and holds no second
   * opinion about what counts as in-flight.
   */
  runsElsewhere?: RunsElsewhere;
  /**
   * The board declared `onReview: "exit"` (FIX-1234). Forwarded verbatim, on
   * the same terms as `runsElsewhere`: the classifier owns what it means, and
   * this block only carries the answer out.
   */
  excuseParked?: boolean;
}

export function createCheckBoard(options: CheckBoardOptions) {
  const {
    name,
    collection: collectionFactory,
    onIdle,
    shouldExit,
    runsElsewhere,
    excuseParked,
  } = options;

  return handler({
    name,
    // Substrate-internal exit-decision block. Same transient rationale
    // as `claimTask` — fires once per worker per loop iteration.
    transient: true,
    inputSchema: z.unknown(),
    outputSchema: checkBoardOutputSchema,
    sequencerStateSchema: taskBoardWorkerStateSchema,
    execute: async (_input, ctx): Promise<CheckBoardOutput> => {
      const collection = await collectionFactory(ctx);
      const claimed = ctx.sequencer!.state.lastClaimed;

      // One classifier, shared with the worker's idle-wait predicate
      // (FIX-990). Each terminal verdict is this block's exit `reason`
      // verbatim, so the mapping carries no second opinion of its own.
      const { verdict, excusedParked } = classifyBoard(collection, {
        onIdle,
        ...(shouldExit !== undefined ? { shouldExit } : {}),
        ...(runsElsewhere !== undefined ? { runsElsewhere } : {}),
        ...(excuseParked !== undefined ? { excuseParked } : {}),
      });
      if (verdict !== "continue") {
        // FIX-1234: the exit reason is recorded HERE, where the drain decides
        // to stop, and travels to the completion item on this output. The
        // completion item runs after the pool and re-reads the collection, so a
        // resume landing in that window would show it a `pending` row and it
        // would report a successful review exit as a failure. The key is
        // omitted entirely when nothing was excused, so a board on the default
        // `onReview` emits exactly the output it always did.
        return {
          shouldContinue: false,
          reason: verdict,
          ...(excusedParked ? { excusedParked: true } : {}),
        };
      }
      return { shouldContinue: true, reason: claimed ? "claimed" : "idle" };
    },
  });
}

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
 *   `in_progress`, or `awaiting_review` tasks remain (`drained`), OR
 *   when no in-flight worker is active AND no `pending` task is
 *   claimable because every remaining pending has a non-`completed`
 *   dep (`blocked`). The blocked exit closes the dispatcher-deadlock
 *   class of bug where a `pending` task with an `errored` /
 *   `cancelled` dep keeps `inFlightCount` non-zero forever.
 *
 * - `complete`: exit only when no `pending`, `in_progress`, or
 *   `awaiting_review` tasks remain. Legacy default; preserves the
 *   spinning-poll behavior for boards that legitimately wait on an
 *   external pump to mark deps complete.
 *
 *   `awaiting_review` keeps the loop alive in both modes above
 *   (FIX-443 §10.1) — the worker's preceding `.waitForCondition`
 *   blocks until an external actor transitions the task back to
 *   `pending` (or to a terminal state).
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
import type { TaskCollectionRef } from "@flow-state-dev/tasks";
import {
  checkBoardOutputSchema,
  taskBoardWorkerStateSchema,
  type CheckBoardOutput,
} from "../schemas";
import { hasClaimableTask, inFlightCount } from "../shared";

export interface CheckBoardOptions {
  name: string;
  collection: (ctx: BlockContext) => Promise<TaskCollectionRef>;
  onIdle: "wait" | "complete" | "complete-or-blocked";
  shouldExit?: (collection: TaskCollectionRef) => boolean;
}

export function createCheckBoard(options: CheckBoardOptions) {
  const {
    name,
    collection: collectionFactory,
    onIdle,
    shouldExit,
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

      if (onIdle === "complete") {
        if (inFlightCount(collection) === 0) {
          return { shouldContinue: false, reason: "drained" };
        }
        return { shouldContinue: true, reason: claimed ? "claimed" : "idle" };
      }

      if (onIdle === "complete-or-blocked") {
        // Drained dominates: every task reached a terminal status.
        if (inFlightCount(collection) === 0) {
          return { shouldContinue: false, reason: "drained" };
        }
        // No worker is producing state changes AND no `pending` task
        // has all deps `completed`, so the dispatcher cannot claim
        // anything. Continuing would spin at idle-poll forever.
        if (
          collection.count({ status: ["in_progress", "awaiting_review"] }) === 0 &&
          !hasClaimableTask(collection)
        ) {
          return { shouldContinue: false, reason: "blocked" };
        }
        return { shouldContinue: true, reason: claimed ? "claimed" : "idle" };
      }

      // onIdle === "wait"
      if (shouldExit?.(collection) === true) {
        return { shouldContinue: false, reason: "exit" };
      }
      return { shouldContinue: true, reason: claimed ? "claimed" : "idle" };
    },
  });
}

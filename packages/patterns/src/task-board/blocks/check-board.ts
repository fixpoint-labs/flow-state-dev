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
 * - `complete`: exit when no `pending`, `in_progress`, or
 *   `awaiting_review` tasks remain. `awaiting_review` keeps the loop
 *   alive (FIX-443 §10.1) — the worker's preceding `.waitForCondition`
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
import { inFlightCount } from "../shared";

export interface CheckBoardOptions {
  name: string;
  collection: (ctx: BlockContext) => TaskCollectionRef;
  onIdle: "wait" | "complete";
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
      const collection = collectionFactory(ctx);
      const claimed = ctx.sequencer!.state.lastClaimed;

      if (onIdle === "complete") {
        if (inFlightCount(collection) === 0) {
          return { shouldContinue: false, reason: "drained" };
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

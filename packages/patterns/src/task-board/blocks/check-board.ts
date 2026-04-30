/**
 * Termination + idle-poll handler for the Task Board worker loop.
 *
 * Reads the worker's `lastClaimed` flag from sequencer state (set by
 * `claimTask`), checks the board's in-flight count, and returns
 * `{ shouldContinue, reason }`. The pattern's worker `loopBack`
 * predicate consumes `shouldContinue` to decide whether to iterate.
 *
 * Modes:
 *
 * - `complete`: exit when no `pending`, `in_progress`, or
 *   `awaiting_review` tasks remain. `awaiting_review` keeps the loop
 *   alive (FIX-443 §10.1) — workers idle-poll until an external actor
 *   transitions the task back to `pending` (or to a terminal state).
 *
 * - `wait`: never exit on idle. Defers to the user-supplied
 *   `shouldExit` predicate, evaluated once per iteration. Without
 *   `shouldExit`, the loop runs until `maxIterations` trips. Used for
 *   long-running session-scoped boards that keep accepting tasks from
 *   external actors.
 *
 * In both modes, when `lastClaimed` is false, the worker sleeps
 * `idlePollMs` before returning `shouldContinue` — bounds the
 * busy-waiting cost when the board is idle.
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
import { inFlightCount, sleep } from "../shared";

export interface CheckBoardOptions {
  name: string;
  collection: (ctx: BlockContext) => TaskCollectionRef;
  onIdle: "wait" | "complete";
  idlePollMs: number;
  shouldExit?: (collection: TaskCollectionRef) => boolean;
}

export function createCheckBoard(options: CheckBoardOptions) {
  const {
    name,
    collection: collectionFactory,
    onIdle,
    idlePollMs,
    shouldExit,
  } = options;

  return handler({
    name,
    // Substrate-internal idle-poll block. Same transient rationale as
    // `claimTask` — fires once per worker per `idlePollMs` tick.
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
        if (!claimed) {
          await sleep(idlePollMs);
          return { shouldContinue: true, reason: "idle" };
        }
        return { shouldContinue: true, reason: "claimed" };
      }

      // onIdle === "wait"
      if (shouldExit?.(collection) === true) {
        return { shouldContinue: false, reason: "exit" };
      }
      if (!claimed) {
        await sleep(idlePollMs);
        return { shouldContinue: true, reason: "idle" };
      }
      return { shouldContinue: true, reason: "claimed" };
    },
  });
}

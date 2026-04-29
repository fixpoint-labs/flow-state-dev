/**
 * Termination + idle-poll handler for the Task Board worker loop.
 *
 * Modes:
 *
 * - `complete`: exit when no `pending`, `in_progress`, or
 *   `awaiting_review` tasks remain. `awaiting_review` keeps the loop
 *   alive (FIX-443 §10.1) — workers spin-poll until an external actor
 *   transitions the task back to `pending` (or to a terminal state).
 *
 * - `wait`: never exit on idle. Defers to the user-supplied
 *   `shouldExit` predicate, evaluated once per iteration. Without
 *   `shouldExit`, the loop runs until `maxIterations` trips. Used for
 *   long-running session-scoped boards that keep accepting tasks from
 *   external actors.
 *
 * In both modes, when the previous step's `claimed` is false, the
 * worker sleeps `idlePollMs` before returning `shouldContinue` — keeps
 * the busy-waiting cost bounded when the board is idle.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { TaskCollectionRef } from "@flow-state-dev/tasks";
import { inFlightCount, sleep } from "../shared";

export interface CheckBoardOptions {
  name: string;
  collection: (ctx: BlockContext) => TaskCollectionRef;
  onIdle: "wait" | "complete";
  idlePollMs: number;
  shouldExit?: (collection: TaskCollectionRef) => boolean;
}

/**
 * Input shape: anything the upstream step produces. The check reads
 * `claimed` (the canonical signal from `claimAndExecute` /
 * `claimTask`) when present. Other shapes are tolerated — `claimed`
 * defaults to `true` so a chain of custom blocks doesn't accidentally
 * trigger the idle-sleep path.
 */
export interface CheckBoardInput {
  claimed?: boolean;
}

export interface CheckBoardOutput {
  shouldContinue: boolean;
  reason: "drained" | "exit" | "claimed" | "idle";
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
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (
      input: CheckBoardInput,
      ctx
    ): Promise<CheckBoardOutput> => {
      const collection = collectionFactory(ctx);
      const claimed = input?.claimed !== false;

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

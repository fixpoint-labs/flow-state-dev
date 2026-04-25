/**
 * Check Pool Handler
 *
 * Reads the pool-level projection (via `ctx.getTarget(poolName)`) and emits
 * `{ shouldContinue }` into the worker pipeline. The worker's `loopBack`
 * consumes that value to decide whether to iterate again.
 *
 * Termination invariant:
 *   shouldContinue = queuePending > 0 || inFlight > 0
 *
 * A worker only exits when the whole pool is drained — both no work waiting
 * and no siblings in-flight (whose `markDone` could still enqueue follow-up
 * items). A worker that fails to lease on the current iteration but has
 * sibling work in-flight will loop back to leaseNext rather than exit.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  drainPoolProjectionSchema,
  type DrainPoolProjection,
} from "../schemas";

export function createCheckPool(poolName: string) {
  return handler({
    name: `${poolName}-worker-check-pool`,
    inputSchema: z.any(),
    outputSchema: z.object({ shouldContinue: z.boolean() }),
    execute: async (_input, ctx) => {
      const pool = ctx.getTarget<DrainPoolProjection>(poolName);
      if (pool === undefined) {
        // No pool projection reachable — fail safe by exiting the loop
        // rather than spinning indefinitely.
        return { shouldContinue: false };
      }
      const state = pool.state;
      return {
        shouldContinue: state.queuePending > 0 || state.inFlight > 0,
      };
    },
  });
}

export { drainPoolProjectionSchema };

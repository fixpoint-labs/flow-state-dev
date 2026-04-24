/**
 * Mark Done Handlers
 *
 * Finalise the lifecycle of a leased queue item. Authoritative writes
 * land in the pool-level `items` map via `atomicState`; collection item
 * fields are mirrored for durability and client observability.
 *
 *  - `createMarkDoneSuccess` — success path, immediately after the
 *    user's worker block returns. Flips the pool-item to `"done"`, bumps
 *    the `completed` counter.
 *
 *  - `createMarkDoneError` — invoked via `.rescue()` when the worker
 *    body throws. Retries (flip to `pending`, +queuePending) if
 *    `attempts < maxAttempts`; otherwise flips to `failed`. Re-throws
 *    on `onError: "fail"` so the error propagates.
 */
import { handler } from "@flow-state-dev/core";
import type { DefinedResourceCollection, ResourceCollectionRef, ResourceRef, StateRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  drainPoolProjectionSchema,
  drainPoolWorkerStateSchema,
  type DrainPoolItem,
  type DrainPoolProjection,
  type DrainPoolWorkerState,
} from "../schemas";
import { sanitizeStats } from "../shared";

type QueueRef<TItem> = ResourceCollectionRef<any> & {
  get(key: string): ResourceRef<any> & { state: Readonly<DrainPoolItem<TItem>> };
};

/**
 * Builds the success-path markDone handler.
 */
export function createMarkDoneSuccess<TItem>(
  poolName: string,
  queueKey: string,
  queueCollection: DefinedResourceCollection
) {
  return handler({
    name: `${poolName}-worker-mark-done`,
    inputSchema: z.any(),
    outputSchema: z.any(),
    sessionResources: { [queueKey]: queueCollection },
    sequencerStateSchema: drainPoolWorkerStateSchema,
    execute: async (input, ctx) => {
      const workerState = (ctx.sequencer as StateRef<DrainPoolWorkerState>).state;
      const itemId = workerState.currentLeasedItemId;
      if (itemId === undefined) {
        throw new Error(
          `[drain-pool] markDone-success: no currentLeasedItemId in worker state for pool "${poolName}"`
        );
      }

      const pool = ctx.getTarget<DrainPoolProjection>(poolName);
      if (pool !== undefined) {
        await pool.atomicState((state) => {
          const existing = state.items?.[itemId];
          if (existing === undefined) return {};
          const nextItems = { ...(state.items ?? {}) };
          nextItems[itemId] = {
            ...existing,
            status: "done",
            leasedBy: undefined,
            leaseUntil: undefined,
          };
          return {
            items: nextItems,
            inFlight: Math.max(0, state.inFlight - 1),
            completed: state.completed + 1,
          };
        });
        ctx.emitComponent("drain-pool-stats", sanitizeStats(pool.state), {
          key: "stats",
        });
      }

      const collection = (ctx.session.resources as unknown as Record<string, QueueRef<TItem>>)[queueKey];
      const ref = collection.get(itemId) as ResourceRef<any>;
      await ref.updateState((current: any) => ({
        ...current,
        status: "done",
        completedAt: Date.now(),
        leasedBy: undefined,
        leaseUntil: undefined,
      }));

      await (ctx.sequencer as StateRef<DrainPoolWorkerState>).patchState({
        currentLeasedItemId: undefined,
      });

      return input;
    },
  });
}

/**
 * Builds the error-path markDone handler. Wired into `.rescue()` on the
 * worker body. Receives the caught error as input.
 */
export function createMarkDoneError<TItem>(
  poolName: string,
  queueKey: string,
  queueCollection: DefinedResourceCollection,
  maxAttempts: number,
  onError: "skip" | "fail"
) {
  return handler({
    name: `${poolName}-worker-mark-error`,
    inputSchema: z.any(),
    outputSchema: z.any(),
    sessionResources: { [queueKey]: queueCollection },
    sequencerStateSchema: drainPoolWorkerStateSchema,
    execute: async (error, ctx) => {
      const workerState = (ctx.sequencer as StateRef<DrainPoolWorkerState>).state;
      const itemId = workerState.currentLeasedItemId;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (itemId === undefined) {
        if (onError === "fail") {
          throw error instanceof Error ? error : new Error(errorMessage);
        }
        return { skipped: true, error: errorMessage };
      }

      const pool = ctx.getTarget<DrainPoolProjection>(poolName);
      // These closure vars are reset at the top of every mutator pass so
      // that a CAS retry never leaks a stale decision from a failed pass
      // into the post-atomicState collection-mirror write. `committed`
      // tracks whether the final pass actually wrote a state transition;
      // if not (item already missing), the collection update is skipped.
      let exhausted = false;
      let committed = false;
      if (pool !== undefined) {
        await pool.atomicState((state) => {
          committed = false;
          exhausted = false;
          const existing = state.items?.[itemId];
          if (existing === undefined) return {};
          committed = true;
          exhausted = existing.attempts >= maxAttempts;
          const nextItems = { ...(state.items ?? {}) };
          if (exhausted) {
            nextItems[itemId] = {
              ...existing,
              status: "failed",
              leasedBy: undefined,
              leaseUntil: undefined,
            };
            return {
              items: nextItems,
              inFlight: Math.max(0, state.inFlight - 1),
              failed: state.failed + 1,
            };
          }
          nextItems[itemId] = {
            ...existing,
            status: "pending",
            leasedBy: undefined,
            leaseUntil: undefined,
          };
          return {
            items: nextItems,
            inFlight: Math.max(0, state.inFlight - 1),
            queuePending: state.queuePending + 1,
          };
        });
        ctx.emitComponent("drain-pool-stats", sanitizeStats(pool.state), {
          key: "stats",
        });
      }

      if (!committed) {
        // No pool-state transition happened (item missing from pool.items
        // on the final mutator pass). Clear the worker handoff and exit
        // without touching the collection — the item is no longer ours
        // to finalise.
        await (ctx.sequencer as StateRef<DrainPoolWorkerState>).patchState({
          currentLeasedItemId: undefined,
        });
        if (onError === "fail") {
          throw error instanceof Error ? error : new Error(errorMessage);
        }
        return { skipped: true, error: errorMessage };
      }

      const collection = (ctx.session.resources as unknown as Record<string, QueueRef<TItem>>)[queueKey];
      const ref = collection.get(itemId) as ResourceRef<any>;
      if (exhausted) {
        await ref.updateState((current: any) => ({
          ...current,
          status: "failed",
          lastError: errorMessage,
          completedAt: Date.now(),
          leasedBy: undefined,
          leaseUntil: undefined,
        }));
      } else {
        await ref.updateState((current: any) => ({
          ...current,
          status: "pending",
          lastError: errorMessage,
          leasedBy: undefined,
          leaseUntil: undefined,
        }));
      }

      await (ctx.sequencer as StateRef<DrainPoolWorkerState>).patchState({
        currentLeasedItemId: undefined,
      });

      if (onError === "fail") {
        throw error instanceof Error ? error : new Error(errorMessage);
      }

      return { skipped: true, error: errorMessage };
    },
  });
}

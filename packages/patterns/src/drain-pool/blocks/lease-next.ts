/**
 * Lease Next Handler
 *
 * Arbitrates concurrent leases across N workers using the pool sequencer's
 * `atomicState`. The pool's `items` map is the authoritative lifecycle
 * record; all lease decisions read from and mutate it inside the CAS
 * mutator, so two workers contending for item X cannot both win.
 *
 * Collection item fields mirror the pool state for durability and
 * client-side observability, but are NOT authoritative under contention.
 *
 * ## Multi-process note
 *
 * Correct under single-process concurrency (all workers share the same
 * pool state container). Multi-process support requires an adapter-level
 * atomic primitive (e.g. Postgres SELECT FOR UPDATE SKIP LOCKED). Out
 * of scope for Phase 1.
 */
import { handler } from "@flow-state-dev/core";
import type { DefinedResourceCollection, ResourceCollectionRef, ResourceRef, StateRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  drainPoolProjectionSchema,
  drainPoolWorkerStateSchema,
  type DrainPoolItem,
  type DrainPoolItemMeta,
  type DrainPoolProjection,
  type DrainPoolWorkerState,
} from "../schemas";
import { sanitizeStats } from "../shared";

type QueueRef<TItem> = ResourceCollectionRef<any> & {
  get(key: string): ResourceRef<any> & { state: Readonly<DrainPoolItem<TItem>> };
};

export type LeaseNextOutput<TItem> =
  | { ok: true; id: string; payload: TItem }
  | { ok: false };

/**
 * Builds the leaseNext handler for a specific worker.
 *
 * @param poolName         Name of the outer drainPool sequencer.
 * @param queueKey         Session-resource key for the queue collection.
 * @param queueCollection  Defined collection (declared for auto-install).
 * @param workerId         Integer worker index, captured at `.forEach`
 *                         construction time. Rendered as `worker-${id}` in
 *                         `leasedBy` for human-readable traces.
 * @param leaseDurationMs  Lease TTL in milliseconds.
 */
export function createLeaseNext<TItem>(
  poolName: string,
  queueKey: string,
  queueCollection: DefinedResourceCollection,
  workerId: number,
  leaseDurationMs: number
) {
  const leasedByTag = `worker-${workerId}`;

  return handler({
    name: `${poolName}-worker-lease-next`,
    inputSchema: z.any(),
    outputSchema: z.any(),
    resources: { [queueKey]: queueCollection },
    sequencerStateSchema: drainPoolWorkerStateSchema,
    execute: async (_input, ctx): Promise<LeaseNextOutput<TItem>> => {
      const pool = ctx.getTarget<DrainPoolProjection>(poolName);
      if (pool === undefined) {
        return { ok: false };
      }

      // Single atomicState call that both scans pool.items for an
      // eligible entry and flips it to leased. Running the scan inside
      // the mutator avoids the TOCTOU between scan and commit: on CAS
      // retry, the mutator re-reads the latest items map.
      let wonItemId: string | undefined = undefined;
      let leaseUntil = 0;
      await pool.atomicState((state) => {
        const now = Date.now();
        const items = state.items ?? {};
        // FIFO pick over eligible entries. A minor inefficiency (O(n)
        // per attempt) acceptable for Phase 1 queues in the 10k-item
        // range; indexed storage is a future concern.
        let pickedId: string | undefined = undefined;
        let pickedEnqueuedAt = Infinity;
        for (const [id, meta] of Object.entries(items)) {
          if (meta.status === "done" || meta.status === "failed") continue;
          if (
            meta.status === "leased" &&
            (meta.leaseUntil ?? 0) >= now
          ) {
            continue;
          }
          if (meta.enqueuedAt < pickedEnqueuedAt) {
            pickedId = id;
            pickedEnqueuedAt = meta.enqueuedAt;
          }
        }

        if (pickedId === undefined) {
          return {};
        }

        const picked = items[pickedId]!;
        const wasStale =
          picked.status === "leased" && (picked.leaseUntil ?? 0) < now;
        wonItemId = pickedId;
        leaseUntil = now + leaseDurationMs;
        const nextItems: Record<string, DrainPoolItemMeta> = {
          ...items,
          [pickedId]: {
            status: "leased",
            leasedBy: leasedByTag,
            leaseUntil,
            attempts: picked.attempts + 1,
            enqueuedAt: picked.enqueuedAt,
          },
        };
        return {
          items: nextItems,
          // If the previous state was stale-leased, inFlight already
          // reflects it (never decremented at expiry). Only decrement
          // queuePending when transitioning from pending.
          queuePending: wasStale
            ? state.queuePending
            : Math.max(0, state.queuePending - 1),
          inFlight: wasStale ? state.inFlight : state.inFlight + 1,
        };
      });

      if (wonItemId === undefined) {
        return { ok: false };
      }

      // Under CAS retry, `wonItemId` captures the last successful mutator
      // pass. Confirm we actually own the lease on the committed state
      // — defensive check, should always pass in single-process use.
      const finalLease = pool.state.items?.[wonItemId];
      if (finalLease?.leasedBy !== leasedByTag) {
        return { ok: false };
      }

      // Mirror the lease onto the collection for durability / client-
      // side observability. Best-effort — not authoritative.
      const collection = (ctx.resources as unknown as Record<string, QueueRef<TItem>>)[queueKey];
      const ref = collection.get(wonItemId) as ResourceRef<any>;
      const payload = ref.state.payload as TItem;
      await ref.updateState((current: any) => ({
        ...current,
        status: "leased",
        leasedBy: leasedByTag,
        leaseUntil,
        attempts: finalLease.attempts,
      }));

      await (ctx.sequencer as StateRef<DrainPoolWorkerState>).patchState({
        currentLeasedItemId: wonItemId,
      });

      ctx.emitComponent("drain-pool-stats", sanitizeStats(pool.state), {
        key: "stats",
      });

      return { ok: true, id: wonItemId, payload };
    },
  });
}

export { drainPoolProjectionSchema, drainPoolWorkerStateSchema };

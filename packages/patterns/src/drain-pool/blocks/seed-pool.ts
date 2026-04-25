/**
 * Seed Pool Handler
 *
 * Writes the configured `initialItems` into the queue collection as
 * `pending` entries, populates the pool-level `items` map (the
 * authoritative lifecycle map) and initialises counters.
 *
 * Idempotent on retry: when the collection already has entries (e.g.
 * FIX-294's retry brought us back into a mid-drain request), seeding
 * is skipped but the pool state is rebuilt from the collection so
 * workers see accurate `queuePending` and `items` after re-entry.
 * Previously-leased items with no surviving request are reset to
 * pending on re-entry — the previous request is dead, its leases stale.
 */
import { handler } from "@flow-state-dev/core";
import type { DefinedResourceCollection, ResourceCollectionRef, ResourceRef, StateRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  drainPoolProjectionSchema,
  type DrainPoolItem,
  type DrainPoolItemMeta,
  type DrainPoolProjection,
} from "../schemas";
import { randomItemId, sanitizeStats } from "../shared";

// Loose collection alias; collections store plain JSON and the payload
// is user-typed. See seed-pool.ts for the rationale.
type QueueRef<TItem> = ResourceCollectionRef<any> & {
  list(): ReadonlyArray<ResourceRef<any> & { state: Readonly<DrainPoolItem<TItem>> }>;
};

/**
 * Builds the seedPool handler. Runs once at the start of the drainPool
 * sequencer, before the worker forEach.
 */
export function createSeedPool<TItem>(
  poolName: string,
  queueKey: string,
  queueCollection: DefinedResourceCollection,
  initialItems: readonly TItem[]
) {
  return handler({
    name: `${poolName}-seed`,
    inputSchema: z.any(),
    outputSchema: z.any(),
    sessionResources: { [queueKey]: queueCollection },
    sequencerStateSchema: drainPoolProjectionSchema,
    execute: async (input, ctx) => {
      const collection = (ctx.session.resources as unknown as Record<string, QueueRef<TItem>>)[queueKey];
      const pool = ctx.sequencer as StateRef<DrainPoolProjection>;

      const existing = collection.list();
      if (existing.length > 0) {
        // Retry path. Rebuild pool state from collection. Previously-
        // leased items are reset to pending (that request is gone).
        const items: Record<string, DrainPoolItemMeta> = {};
        let pending = 0;
        let completed = 0;
        let failed = 0;
        for (const ref of existing) {
          const snap = ref.state;
          const status =
            snap.status === "leased" ? "pending" : snap.status;
          items[snap.id] = {
            status,
            attempts: snap.attempts ?? 0,
            enqueuedAt: snap.enqueuedAt,
          };
          if (status === "pending") pending += 1;
          if (status === "done") completed += 1;
          if (status === "failed") failed += 1;
        }
        await pool.atomicState(() => ({
          items,
          queuePending: pending,
          inFlight: 0,
          completed,
          failed,
        }));
        ctx.emitComponent("drain-pool-stats", sanitizeStats(pool.state), {
          key: "stats",
        });
        return input;
      }

      const now = Date.now();
      const newItems: Record<string, DrainPoolItemMeta> = {};
      for (const payload of initialItems) {
        const id = randomItemId();
        await collection.create(id, {
          id,
          payload,
          status: "pending",
          attempts: 0,
          enqueuedAt: now,
        } as unknown as Record<string, unknown>);
        newItems[id] = { status: "pending", attempts: 0, enqueuedAt: now };
      }
      await pool.atomicState(() => ({
        items: newItems,
        queuePending: initialItems.length,
      }));

      ctx.emitComponent("drain-pool-stats", sanitizeStats(pool.state), {
        key: "stats",
      });

      return input;
    },
  });
}

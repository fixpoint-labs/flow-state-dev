/**
 * Enqueue Helper Factory
 *
 * Produces a handler block that appends items to the queue collection and
 * registers them in the pool-level `items` map + bumps `queuePending`.
 * Users compose the result into a worker body via `.tap(enqueue(items))`.
 *
 * ## Correctness constraint (load-bearing)
 *
 * The returned handler is only safe to use from INSIDE a worker body —
 * i.e. between `leaseNext` and `markDone`. Calling it outside that window
 * (e.g. from a sibling `.tap()` in the parent flow) risks silent item
 * loss: if the external enqueue commits after all workers have observed
 * `shouldContinue: false`, the new items sit pending forever and the
 * drainPool exits.
 *
 * Enqueue-from-worker-body is safe because the worker's own `inFlight`
 * count keeps the termination invariant from firing until after the
 * enqueue + markDone are both committed.
 *
 * Throws a descriptive error at runtime if invoked outside a pool context
 * (detected via absence of the queue collection in `ctx.session.resources`).
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext, DefinedResourceCollection, ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { ZodType } from "zod";
import { z } from "zod";
import {
  drainPoolProjectionSchema,
  type DrainPoolItemMeta,
  type DrainPoolProjection,
} from "../schemas";
import { randomItemId, sanitizeStats } from "../shared";

export type EnqueueResolver<TItem> =
  | TItem
  | TItem[]
  | ((
      input: unknown,
      ctx: BlockContext
    ) => TItem | TItem[] | Promise<TItem | TItem[]>);

/**
 * Builds the enqueue helper factory. Invoke it with items (or an item-
 * resolver function) to get a handler block you can `.tap()` into a
 * worker body.
 */
export function createEnqueueHelper<TItem>(
  poolName: string,
  queueKey: string,
  queueCollection: DefinedResourceCollection,
  _itemSchema: ZodType<TItem>
) {
  return (items: EnqueueResolver<TItem>) =>
    handler({
      name: `${poolName}-enqueue`,
      inputSchema: z.any(),
      outputSchema: z.any(),
      sessionResources: { [queueKey]: queueCollection },
      execute: async (input, ctx) => {
        const resolved = typeof items === "function"
          ? await (items as (
              input: unknown,
              ctx: BlockContext
            ) => TItem | TItem[] | Promise<TItem | TItem[]>)(input, ctx)
          : items;
        const list = Array.isArray(resolved) ? resolved : [resolved];
        if (list.length === 0) {
          return input;
        }

        const resources = ctx.session.resources as unknown as Record<string, ResourceCollectionRef<any> | undefined>;
        const collection = resources[queueKey];
        if (collection === undefined) {
          throw new Error(
            `[drain-pool] enqueue called outside worker context — queue collection "${queueKey}" not found in session.resources`
          );
        }

        // Durable write first (collection), then CAS-atomic pool-state
        // update (items map + counter). Order matters: a worker that
        // starts a lease scan in between sees no entry in pool.items,
        // so it can't pick this item prematurely — it won't be picked
        // until the pool-state CAS lands.
        const now = Date.now();
        const newMetas: Record<string, DrainPoolItemMeta> = {};
        for (const payload of list) {
          const id = randomItemId();
          await collection.create(id, {
            id,
            payload,
            status: "pending",
            attempts: 0,
            enqueuedAt: now,
          } as unknown as Record<string, unknown>);
          newMetas[id] = { status: "pending", attempts: 0, enqueuedAt: now };
        }

        const pool = ctx.getTarget<DrainPoolProjection>(poolName);
        if (pool !== undefined) {
          await pool.atomicState((state) => ({
            items: { ...(state.items ?? {}), ...newMetas },
            queuePending: state.queuePending + list.length,
          }));
          ctx.emitComponent("drain-pool-stats", sanitizeStats(pool.state), {
            key: "stats",
          });
        }

        return input;
      },
    });
}

export { drainPoolProjectionSchema };

/**
 * Drain Pool Schemas
 *
 * Schema definitions for the drainPool pattern's three state surfaces:
 *
 *  1. Queue item state — a per-entry resource in the queue collection. Holds
 *     the user payload plus lease/retry metadata.
 *  2. Pool projection state — sequencer state on the outer drainPool sequencer.
 *     Caches pending / inFlight / completed / failed counters so loopBack
 *     checks don't have to scan the collection each iteration.
 *  3. Worker-local state — sequencer state on each worker sequencer. Holds
 *     the id of the item the worker is currently processing so markDone can
 *     finalize it without ctx plumbing.
 */
import { z, type ZodType } from "zod";

/**
 * Lifecycle status for a queue item. Mutated by `leaseNext` (pending → leased),
 * `markDone` (leased → done / failed / pending-for-retry), and internal
 * expiry reclamation (leased → pending when `leaseUntil < now`).
 */
export const drainPoolItemStatusSchema = z.enum([
  "pending",
  "leased",
  "done",
  "failed",
]);

export type DrainPoolItemStatus = z.infer<typeof drainPoolItemStatusSchema>;

/**
 * Creates the Zod schema for a single queue item, parameterised over the
 * user-supplied payload schema.
 *
 * Fields:
 *  - `id`: idempotency key for the item; stable across retries.
 *  - `payload`: user payload (typed by `payloadSchema`).
 *  - `status`: lifecycle state.
 *  - `leasedBy`: workerId string ("worker-0", "worker-1", …) set when leased.
 *  - `leaseUntil`: epoch ms; item becomes re-leasable once `Date.now()` passes.
 *  - `attempts`: incremented on each lease (including retries).
 *  - `lastError`: last error message, recorded on markDone-failure paths.
 *  - `enqueuedAt` / `completedAt`: wall-clock timestamps for ordering and UI.
 */
export function createDrainPoolItemSchema<TItem>(payloadSchema: ZodType<TItem>) {
  return z.object({
    id: z.string(),
    payload: payloadSchema,
    status: drainPoolItemStatusSchema,
    leasedBy: z.string().optional(),
    leaseUntil: z.number().optional(),
    attempts: z.number().default(0),
    lastError: z.string().optional(),
    enqueuedAt: z.number(),
    completedAt: z.number().optional(),
  });
}

export type DrainPoolItem<TItem> = {
  id: string;
  payload: TItem;
  status: DrainPoolItemStatus;
  leasedBy?: string;
  leaseUntil?: number;
  attempts: number;
  lastError?: string;
  enqueuedAt: number;
  completedAt?: number;
};

/**
 * Per-item lifecycle metadata held in the pool-level projection. Does NOT
 * carry the user payload — that lives in the session-resource collection
 * for durability. The pool state's `items` map is the CAS-protected
 * authority for lease arbitration and terminal status.
 */
export const drainPoolItemMetaSchema = z.object({
  status: drainPoolItemStatusSchema,
  leasedBy: z.string().optional(),
  leaseUntil: z.number().optional(),
  attempts: z.number().default(0),
  enqueuedAt: z.number(),
});

export type DrainPoolItemMeta = z.infer<typeof drainPoolItemMetaSchema>;

/**
 * Outer (pool-level) sequencer state. Two responsibilities:
 *
 *  1. Counter projections (`queuePending`, `inFlight`, `completed`, `failed`)
 *     — cached so `loopBack.when` and devtool emissions don't re-walk the
 *     collection on every iteration.
 *
 *  2. Authoritative per-item lifecycle map (`items`). Because sequencer
 *     state mutations go through `atomicState` (CAS-protected via the
 *     store's expectedVersion contract), this map is the single point
 *     where "only one worker gets item X" is enforced under contention.
 *     Collection item fields mirror the map for durability and client-
 *     side observability, but are not authoritative.
 *
 *  Keeping the map on the pool state — rather than reading the collection
 *  inside the CAS mutator — avoids a TOCTOU between the collection scan
 *  and the CAS: by the time a worker's queued atomicState runs after a
 *  retry, the collection status it originally saw may be stale.
 */
export const drainPoolProjectionSchema = z.object({
  queuePending: z.number().default(0),
  inFlight: z.number().default(0),
  completed: z.number().default(0),
  failed: z.number().default(0),
  items: z.record(z.string(), drainPoolItemMetaSchema).default({}),
});

export type DrainPoolProjection = z.infer<typeof drainPoolProjectionSchema>;

/**
 * Worker-local sequencer state. `currentLeasedItemId` is written by
 * leaseNext on a successful lease and read by markDone to locate the
 * item being finalized. Stays in worker-local scope so concurrent workers
 * don't step on each other's handoff value.
 */
export const drainPoolWorkerStateSchema = z.object({
  currentLeasedItemId: z.string().optional(),
});

export type DrainPoolWorkerState = z.infer<typeof drainPoolWorkerStateSchema>;

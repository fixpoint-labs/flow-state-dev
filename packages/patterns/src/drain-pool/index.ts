/**
 * Drain Pool Pattern
 *
 * Concurrent streaming dispatch over a durable, dynamic queue. N workers
 * continuously pull items from a shared session-resource collection,
 * process them, and loop until the queue is drained and all workers are
 * idle. Workers may enqueue follow-up items mid-drain; the parent
 * sequencer awaits full completion.
 *
 * ## Shape
 *
 *   const { block, queue, enqueue } = drainPool({
 *     name: "dispatch",
 *     item: ItemSchema,
 *     concurrency: 4,
 *     initialItems: seeds,
 *     block: workerBody,
 *     onError: "skip",
 *     maxAttempts: 3,
 *   });
 *
 *   defineFlow({ resources: { [queue key]: queue }, ... })
 *
 * The returned `block` is a sequencer composed of:
 *   - `seedPool` — writes initialItems to the collection
 *   - `.forEach` — spawns N worker sequencers, each running a drain loop
 *
 * Each worker loops: leaseNext → (user block → markDone) → checkPool →
 * loopBack. `leaseNext` picks the oldest eligible item (pending, or
 * stale-leased for recovery), flips its status atomically (best-effort
 * with read-back verification — see `lease-next.ts` for the concurrency
 * model), and stashes the item id in worker-local state. `markDone`
 * reads that id to finalize the item. `checkPool` reads the pool-level
 * projection and returns `shouldContinue` — a worker exits only when
 * both `queuePending` and `inFlight` are zero.
 *
 * ## At-least-once semantics
 *
 * A worker can crash after side effects but before `markDone`; the
 * lease expires and another worker re-leases the same item. Side
 * effects run more than once in that scenario. Non-idempotent side
 * effects must be deduped by the caller — use `item.id` (uuid v4 by
 * default) as an idempotency key.
 *
 * ## Durability
 *
 * The queue is a session resource collection. Durability follows the
 * session store adapter:
 *   - In-memory store → ephemeral (lost on process restart)
 *   - Filesystem / Postgres → survives restart; on retry the pool
 *     picks up where it left off and stale leases reclaim naturally.
 *
 * Mid-block checkpoint resume (FIX-141) is out of scope for this
 * pattern — drainPool composes with it cleanly when it lands.
 */
import { sequencer, defineResourceCollection } from "@flow-state-dev/core";
import type { SequencerDefinition } from "@flow-state-dev/core";
import type {
  BlockDefinition,
  DefinedResourceCollection,
} from "@flow-state-dev/core/types";
import type { ZodType } from "zod";

import {
  createDrainPoolItemSchema,
  drainPoolProjectionSchema,
  drainPoolWorkerStateSchema,
  type DrainPoolItem,
  type DrainPoolProjection,
  type DrainPoolWorkerState,
} from "./schemas";
import { createSeedPool } from "./blocks/seed-pool";
import { createLeaseNext, type LeaseNextOutput } from "./blocks/lease-next";
import {
  createMarkDoneSuccess,
  createMarkDoneError,
} from "./blocks/mark-done";
import { createCheckPool } from "./blocks/check-pool";
import {
  createEnqueueHelper,
  type EnqueueResolver,
} from "./blocks/enqueue";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  createDrainPoolItemSchema,
  drainPoolProjectionSchema,
  drainPoolWorkerStateSchema,
  drainPoolItemMetaSchema,
} from "./schemas";
export type {
  DrainPoolItem,
  DrainPoolItemStatus,
  DrainPoolItemMeta,
  DrainPoolProjection,
  DrainPoolWorkerState,
} from "./schemas";
export { createSeedPool } from "./blocks/seed-pool";
export { createLeaseNext } from "./blocks/lease-next";
export type { LeaseNextOutput } from "./blocks/lease-next";
export {
  createMarkDoneSuccess,
  createMarkDoneError,
} from "./blocks/mark-done";
export { createCheckPool } from "./blocks/check-pool";
export { createEnqueueHelper } from "./blocks/enqueue";
export type { EnqueueResolver } from "./blocks/enqueue";

// ---------------------------------------------------------------------------
// Public config / handle
// ---------------------------------------------------------------------------

export interface DrainPoolConfig<TItem> {
  /**
   * Unique pool name. Used as the sequencer block name, collection key,
   * and prefix on internal block names. MUST be unique per drainPool
   * instance per session — name collisions share the queue collection
   * and break isolation.
   */
  name: string;

  /** Zod schema describing queue item payloads. */
  item: ZodType<TItem>;

  /**
   * Number of parallel workers. The pool spawns exactly this many worker
   * sequencers via `.forEach({ maxConcurrency: N })`. Default: 4.
   */
  concurrency?: number;

  /** Payloads seeded into the queue at pool start. Optional. */
  initialItems?: readonly TItem[];

  /**
   * Per-item worker block. Receives the leased payload as input. Can be
   * any block kind — handler, generator, sequencer, or router.
   *
   * Also accepts a factory `(helpers) => block` so workers can compose
   * `enqueue` (returned on the pool handle, but needed inside the body)
   * before the pool exists. Use the factory form when the worker body
   * calls `.tap(helpers.enqueue(...))` to append follow-up items
   * mid-drain.
   */
  block:
    | BlockDefinition<any, any>
    | ((helpers: DrainPoolBlockHelpers<TItem>) => BlockDefinition<any, any>);

  /**
   * Failure policy. Default: `"skip"`.
   *  - `"skip"`: capture error, record it on the item, isolate the
   *    failure; siblings continue. Item transitions to `failed` on
   *    attempts exhaustion.
   *  - `"fail"`: propagate the error up through `.forEach` — the
   *    worker's Promise.all rejects, which fails the parent sequencer.
   */
  onError?: "skip" | "fail";

  /**
   * Max attempts per item before terminal failure. `1` means no retry.
   * Retries have no delay (exponential backoff is out of scope). Items
   * that fail and still have attempts remaining transition back to
   * `pending` and are eligible for any worker's next lease.
   * Default: 1.
   */
  maxAttempts?: number;

  /**
   * Lease duration in milliseconds. Items whose `leaseUntil` has passed
   * are re-leasable by any worker — this is the crash-recovery hook.
   * Tune up for long-running worker bodies (e.g. generator calls):
   * rule of thumb is >= 6× p99 processing time. Default: 30_000.
   */
  leaseDurationMs?: number;

  /**
   * Per-worker loopBack safety cap. Each worker exits after this many
   * lease-process iterations, even if the pool isn't drained. Acts as
   * a circuit breaker against pathological enqueue-cycles. Default:
   * 10_000.
   */
  maxIterations?: number;

  /**
   * Devtool container hint. Defaults to `{ component: "drain-pool" }`.
   * The pool emits `drain-pool-stats` component items as workers lease
   * and complete items — a renderer registered for "drain-pool" can
   * display live `{ pending, inFlight, completed, failed }` counters.
   */
  container?: {
    component?: string;
    label?: string;
    metadata?: Record<string, unknown>;
  };
}

/** Helpers surface passed to the `block` factory when used in factory form. */
export interface DrainPoolBlockHelpers<TItem> {
  enqueue: (
    items: EnqueueResolver<TItem>
  ) => BlockDefinition<any, any>;
}

export interface DrainPoolHandle<TItem> {
  /**
   * The composed sequencer block. Plug into a parent flow or sequencer.
   * Auto-installs the queue collection via its block-level
   * `resources` declaration — callers don't need to register the
   * collection manually on `defineFlow`.
   */
  block: SequencerDefinition<any, any>;

  /**
   * The queue collection. Exposed so callers can inspect config or
   * register it explicitly on `defineFlow({ resources })` when
   * they prefer explicit-over-implicit flow wiring.
   */
  queue: DefinedResourceCollection;

  /**
   * The resource key under which the queue collection is installed.
   * Caller-code can read it via `ctx.resources[queueKey]`.
   */
  queueKey: string;

  /**
   * Factory for the enqueue helper block. Invoke with items (or a
   * resolver function) to get a handler block, then `.tap(...)` it
   * inside a worker body to append follow-up items mid-drain.
   *
   * ONLY safe to use from inside a worker body — see
   * `blocks/enqueue.ts` for the correctness constraint.
   */
  enqueue: (
    items: EnqueueResolver<TItem>
  ) => BlockDefinition<any, any>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Builds a drainPool pattern instance. See the module doc comment for the
 * full pipeline semantics.
 */
export function drainPool<TItem>(
  config: DrainPoolConfig<TItem>
): DrainPoolHandle<TItem> {
  const {
    name,
    item: itemSchema,
    concurrency = 4,
    initialItems = [],
    block: blockOrFactory,
    onError = "skip",
    maxAttempts = 1,
    leaseDurationMs = 30_000,
    maxIterations = 10_000,
    container,
  } = config;

  if (concurrency < 1) {
    throw new Error(
      `[drain-pool] "${name}" concurrency must be >= 1 (got ${concurrency})`
    );
  }
  if (maxAttempts < 1) {
    throw new Error(
      `[drain-pool] "${name}" maxAttempts must be >= 1 (got ${maxAttempts})`
    );
  }

  const queueKey = `${name}-queue`;
  const queueItemSchema = createDrainPoolItemSchema(itemSchema);
  const queueCollection = defineResourceCollection({
    pattern: `${queueKey}/**`,
    scope: "session",
    stateSchema: queueItemSchema,
  });

  const seedPool = createSeedPool<TItem>(
    name,
    queueKey,
    queueCollection,
    initialItems
  );
  const checkPool = createCheckPool(name);
  const leaseNextStepName = `${name}-worker-lease-next`;

  // Build the enqueue factory up-front so it can be wired into worker
  // bodies at composition time. (The factory is returned on the handle,
  // and also surfaced to the `block` factory when the user passes the
  // factory form.)
  const enqueueFactory = createEnqueueHelper<TItem>(
    name,
    queueKey,
    queueCollection,
    itemSchema
  );

  // Resolve the worker block. Factory form lets callers compose
  // `enqueue` inside the body before the pool handle exists.
  const workerBlock: BlockDefinition<any, any> =
    typeof blockOrFactory === "function" &&
    !(blockOrFactory as { kind?: string }).kind
      ? (blockOrFactory as (helpers: DrainPoolBlockHelpers<TItem>) => BlockDefinition<any, any>)({
          enqueue: enqueueFactory,
        })
      : (blockOrFactory as BlockDefinition<any, any>);

  /**
   * Build a single worker's sequencer. `workerId` is captured here in a
   * closure; each worker's `leaseNext` stamps "worker-${id}" into
   * `leasedBy`.
   *
   * All N workers share block names (the factory produces the same
   * `${name}-worker-lease-next` etc.) — each `executeBlock` invocation
   * inside `.forEach` creates a fresh runtime, so loopBack name
   * resolution stays strictly per-worker-scope.
   */
  function makeWorker(workerId: number): SequencerDefinition<any, any> {
    const leaseNext = createLeaseNext<TItem>(
      name,
      queueKey,
      queueCollection,
      workerId,
      leaseDurationMs
    );
    const markDoneSuccess = createMarkDoneSuccess<TItem>(
      name,
      queueKey,
      queueCollection
    );
    const markDoneError = createMarkDoneError<TItem>(
      name,
      queueKey,
      queueCollection,
      maxAttempts,
      onError
    );

    // Inner body: run the user block, then success-mark. Wrap in a
    // sequencer with `.rescue()` so exceptions from the user block flow
    // to `markDoneError` (which knows how to finalize the item). For
    // `onError: "fail"`, markDoneError re-throws so the error escapes
    // to the worker sequencer and bubbles to `.forEach`.
    const workerBody = sequencer({
      name: `${name}-worker-body`,
    })
      .then(workerBlock)
      .then(markDoneSuccess)
      .rescue([{ block: markDoneError }]);

    return sequencer({
      name: `${name}-worker`,
      stateSchema: drainPoolWorkerStateSchema,
    })
      .then(leaseNext)
      .thenIf(
        (x: LeaseNextOutput<TItem>) => x.ok,
        (x: LeaseNextOutput<TItem>) => (x as { payload: TItem }).payload,
        workerBody
      )
      .then(checkPool)
      .loopBack(leaseNextStepName, {
        when: (v: { shouldContinue: boolean }) => v.shouldContinue,
        maxIterations,
      }) as SequencerDefinition<any, any>;
  }

  const block = sequencer({
    name,
    stateSchema: drainPoolProjectionSchema,
    container: container ?? { component: "drain-pool" },
  })
    .then(seedPool)
    .forEach(
      () => Array.from({ length: concurrency }, (_, i) => i),
      (workerId: number) => makeWorker(workerId),
      { maxConcurrency: concurrency }
    ) as SequencerDefinition<any, any>;

  return {
    block,
    queue: queueCollection,
    queueKey,
    enqueue: enqueueFactory,
  };
}

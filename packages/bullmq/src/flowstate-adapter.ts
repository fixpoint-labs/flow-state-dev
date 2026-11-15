/**
 * bullmqJobQueue — the one-option `createFlowState` integration.
 *
 * Composes the queue runtime, the Redis stream bridge, the job queue runner
 * (enqueue side), and the job processor (processing side) into a single
 * `JobQueueAdapter` for `createFlowState({ jobQueue: bullmqJobQueue({...}) })`.
 * The lower-level factories (`createBullmqRuntime`, `createJobProcessor`,
 * `createJobQueueRunner`, `createRedisStreamBridge`) remain public as the
 * extension layer for custom topologies; this is the setup path.
 *
 * It also supplies the engine a lease backend on the same Redis
 * (`createRedisLeaseBackend`), so a flow's `queue` / `reject` concurrency
 * policy holds across every enqueuing and processing process of the deployment, and a
 * delivery into an existing session is accepted rather than refused.
 */
import type { Queue } from "bullmq";
import type {
  FlowStateRuntime,
  JobQueueAdapter,
  JobQueueMode
} from "@flow-state-dev/engine/host";
import { createBullmqRuntime, type BullmqRuntime } from "./runtime";
import { createRedisStreamBridge } from "./stream-bridge";
import { createJobQueueRunner } from "./runner";
import { createRedisLeaseBackend } from "./lease-backend";
import type { BullmqConnectionOptions, RetryConfig } from "./types";

export interface BullmqJobQueueOptions extends BullmqConnectionOptions {
  /** Queue name. Default "fsd-flows". */
  queueName?: string;
  /** Retry/backoff/DLQ config applied to enqueued jobs and the job processor. */
  retry?: RetryConfig;
  /** Concurrent jobs per processing process. Default 2. */
  concurrency?: number;
  /** Job lock duration (ms). Default 300000 — LLM calls are slow. */
  lockDuration?: number;
  /** Redis pub/sub channel prefix for the stream bridge. Default "fsd:stream". */
  channelPrefix?: string;
  /**
   * Which sides this process runs: `"colocated"` (default — enqueue and
   * process in one process), `"enqueue-only"` (web process; a separate
   * processing container consumes the queue), or `"process-only"` (dedicated
   * processing process; call `flowstate.ready()` to start consuming).
   */
  mode?: JobQueueMode;
  /**
   * How long a concurrency place lives past its last renewal (ms). A process
   * that stops renewing (it died, or lost Redis) frees the session's key
   * within this; a running holder that cannot renew is stopped at half of
   * it. Default 10000.
   */
  leaseMs?: number;
}

/**
 * The adapter handed to `createFlowState({ jobQueue })`, with the underlying
 * queue/runtime exposed for admin consoles (Bull Board) and direct
 * `enqueueAction` use.
 */
export interface BullmqJobQueueAdapter extends JobQueueAdapter {
  readonly mode: JobQueueMode;
  /** Underlying BullMQ queue — e.g. for Bull Board. */
  readonly queue: Queue;
  /** The composed runtime handle (`enqueueAction`, `createJobProcessor`, `close`). */
  readonly runtime: BullmqRuntime;
}

/**
 * Build a BullMQ execution-backend adapter for `createFlowState`.
 *
 * `createFlowState` hands both sides the same resolved
 * `{ registry, stores, runtimeConfig }` the router uses, so processed jobs' writes
 * are always visible to streaming, refresh, and the devtool — there is no
 * way to wire a mismatched store registry through this path.
 */
export function bullmqJobQueue(options: BullmqJobQueueOptions): BullmqJobQueueAdapter {
  const runtime = createBullmqRuntime({
    connection: options.connection,
    prefix: options.prefix,
    queueName: options.queueName,
    retry: options.retry,
  });
  const bridge = createRedisStreamBridge({
    connection: options.connection,
    channelPrefix: options.channelPrefix,
  });
  const leaseBackend = createRedisLeaseBackend({
    connection: options.connection,
    prefix: options.prefix,
    queue: runtime.queue,
    leaseMs: options.leaseMs,
  });

  return {
    mode: options.mode ?? "colocated",
    queue: runtime.queue,
    runtime,
    leaseBackend,

    createRunner: () =>
      createJobQueueRunner({
        queue: runtime.queue,
        bridge,
        retryConfig: options.retry,
      }),

    startProcessing: (rt: FlowStateRuntime) => {
      const processor = runtime.createJobProcessor({
        registry: rt.registry,
        stores: rt.stores,
        runtimeConfig: rt.runtimeConfig,
        // The host's own resolver, so the processor's built-in flows agree with the host (FIX-2624).
        resolvePrincipal: rt.resolvePrincipal,
        bridge,
        concurrency: options.concurrency,
        lockDuration: options.lockDuration,
        leaseBackend,
      });
      return { close: () => processor.close() };
    },

    // Closes processors created via runtime.createJobProcessor and the queue(s).
    // FlowState.dispose() closes the processing handle first; BullMQ's
    // Worker.close() is idempotent, so the double close is benign.
    close: async () => {
      await runtime.close();
      await leaseBackend.close();
    },
  };
}

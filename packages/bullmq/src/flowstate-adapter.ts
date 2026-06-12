/**
 * bullmqWorker — the one-option `createFlowState` integration.
 *
 * Composes the queue runtime, the Redis stream bridge, the worker dispatcher
 * (enqueue side), and the flow worker (processing side) into a single
 * `WorkerAdapter` for `createFlowState({ worker: bullmqWorker({...}) })`.
 * The lower-level factories (`createBullmqRuntime`, `createFlowWorker`,
 * `createWorkerDispatcher`, `createRedisStreamBridge`) remain public as the
 * extension layer for custom topologies; this is the setup path.
 */
import type { Queue } from "bullmq";
import type {
  FlowStateRuntime,
  WorkerAdapter,
  WorkerMode,
} from "@flow-state-dev/server";
import { createBullmqRuntime, type BullmqRuntime } from "./runtime";
import { createRedisStreamBridge } from "./stream-bridge";
import { createWorkerDispatcher } from "./dispatcher";
import type { BullmqConnectionOptions, RetryConfig } from "./types";

export interface BullmqWorkerOptions extends BullmqConnectionOptions {
  /** Queue name. Default "fsd-flows". */
  queueName?: string;
  /** Retry/backoff/DLQ config applied to enqueued jobs and the worker. */
  retry?: RetryConfig;
  /** Concurrent jobs per worker. Default 2. */
  concurrency?: number;
  /** Job lock duration (ms). Default 300000 — LLM calls are slow. */
  lockDuration?: number;
  /** Redis pub/sub channel prefix for the stream bridge. Default "fsd:stream". */
  channelPrefix?: string;
  /**
   * Which sides this process runs: `"colocated"` (default — dispatch and
   * process in one process), `"dispatch-only"` (web process; a separate
   * worker container consumes the queue), or `"worker-only"` (dedicated
   * worker process; call `flowstate.ready()` to start consuming).
   */
  mode?: WorkerMode;
}

/**
 * The adapter handed to `createFlowState({ worker })`, with the underlying
 * queue/runtime exposed for admin consoles (Bull Board) and direct
 * `enqueueAction` use.
 */
export interface BullmqWorkerAdapter extends WorkerAdapter {
  readonly mode: WorkerMode;
  /** Underlying BullMQ queue — e.g. for Bull Board. */
  readonly queue: Queue;
  /** The composed runtime handle (`enqueueAction`, `createWorker`, `close`). */
  readonly runtime: BullmqRuntime;
}

/**
 * Build a BullMQ execution-backend adapter for `createFlowState`.
 *
 * `createFlowState` hands both sides the same resolved
 * `{ registry, stores, runtimeConfig }` the router uses, so worker writes
 * are always visible to streaming, refresh, and the devtool — there is no
 * way to wire a mismatched store registry through this path.
 */
export function bullmqWorker(options: BullmqWorkerOptions): BullmqWorkerAdapter {
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

  return {
    mode: options.mode ?? "colocated",
    queue: runtime.queue,
    runtime,

    createDispatcher: () =>
      createWorkerDispatcher({
        queue: runtime.queue,
        bridge,
        retryConfig: options.retry,
      }),

    startWorker: (rt: FlowStateRuntime) => {
      const worker = runtime.createWorker({
        registry: rt.registry,
        stores: rt.stores,
        runtimeConfig: rt.runtimeConfig,
        bridge,
        concurrency: options.concurrency,
        lockDuration: options.lockDuration,
      });
      return { close: () => worker.close() };
    },

    // Closes workers created via runtime.createWorker and the queue(s).
    // FlowState.dispose() closes the worker handle first; BullMQ's
    // Worker.close() is idempotent, so the double close is benign.
    close: () => runtime.close(),
  };
}

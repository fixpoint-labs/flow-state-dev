/**
 * createBullmqRuntime — the main entry point for the BullMQ adapter.
 *
 * Returns a runtime handle with `enqueueAction`, `createWorker`, and `close`.
 * The producer side (queue) lives in the web process; workers can be spawned
 * in the same process or in dedicated worker containers.
 */
import { Queue } from "bullmq";
import type { Worker } from "bullmq";
import { resolveProducerConnection } from "./connection";
import { toJobOptions, resolveDlqName, wireDlqHandler } from "./retry";
import { createFlowWorker } from "./worker";
import type { FlowWorkerDeps } from "./worker";
import type {
  BullmqConnectionOptions,
  FlowJobData,
  EnqueueOptions,
  RetryConfig,
} from "./types";

/** Handle returned by `createBullmqRuntime`. */
export interface BullmqRuntime {
  /** The underlying BullMQ Queue instance (useful for monitoring tools like Bull Board). */
  readonly queue: Queue;
  /** Enqueue a flow action for durable, off-request execution. Returns the BullMQ job id. */
  enqueueAction(data: FlowJobData, opts?: EnqueueOptions): Promise<string>;
  /** Construct a Worker that processes flow-run jobs by calling runAction. */
  createWorker(deps: FlowWorkerDeps): Worker;
  /** Close all connections/queues/workers. Wire to SIGTERM/SIGINT. */
  close(): Promise<void>;
}

export interface CreateBullmqRuntimeOptions extends BullmqConnectionOptions {
  queueName?: string;
  retry?: RetryConfig;
}

const DEFAULT_QUEUE_NAME = "fsd-flows";

/**
 * Creates the BullMQ runtime: a queue for enqueuing flow-run jobs, a factory
 * for constructing workers, and a `close` hook for graceful shutdown.
 */
export function createBullmqRuntime(
  options: CreateBullmqRuntimeOptions
): BullmqRuntime {
  const { connection, prefix } = resolveProducerConnection(options);
  const queueName = options.queueName ?? DEFAULT_QUEUE_NAME;
  const defaultRetry = options.retry;
  const defaultJobOpts = toJobOptions(defaultRetry);

  const queue = new Queue(queueName, { connection, prefix });
  const workers: Worker[] = [];

  // Set up DLQ queue if configured
  const dlqName = resolveDlqName(queueName, defaultRetry);
  let dlqQueue: Queue | undefined;
  if (dlqName) {
    dlqQueue = new Queue(dlqName, { connection, prefix });
  }

  const enqueueAction = async (
    data: FlowJobData,
    opts?: EnqueueOptions
  ): Promise<string> => {
    const jobOpts = opts?.retry
      ? { ...defaultJobOpts, ...toJobOptions(opts.retry) }
      : { ...defaultJobOpts };

    if (opts?.priority !== undefined) jobOpts.priority = opts.priority;
    if (opts?.delay !== undefined) jobOpts.delay = opts.delay;
    if (opts?.jobId !== undefined) jobOpts.jobId = opts.jobId;

    const job = await queue.add("flow-run", data, jobOpts);
    return job.id ?? "unknown";
  };

  const createWorkerFn = (deps: FlowWorkerDeps): Worker => {
    const worker = createFlowWorker({
      connection: options.connection,
      prefix: options.prefix,
      queueName,
      retry: defaultRetry,
      deps,
    });

    // Wire DLQ handler if configured
    if (dlqQueue && defaultRetry) {
      wireDlqHandler(worker, dlqQueue, defaultRetry.attempts ?? 3);
    }

    workers.push(worker);
    return worker;
  };

  const close = async () => {
    await Promise.all(workers.map((w) => w.close()));
    await queue.close();
    if (dlqQueue) await dlqQueue.close();
  };

  return { queue, enqueueAction, createWorker: createWorkerFn, close };
}

/**
 * Flow-run job processor. Dequeues BullMQ jobs and calls runAction for each,
 * mapping execution results back to BullMQ job completion/failure semantics.
 *
 * Non-retryable errors (validation, unknown flow/action) are wrapped in
 * BullMQ's UnrecoverableError so they go straight to failed without retries.
 * All other errors follow the queue's retry/backoff config.
 */
import { Worker, UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";
import { runAction } from "@flow-state-dev/engine";
import type {
  FlowRegistry,
  StoreRegistry,
  RuntimeConfig,
  StreamBridge,
  StreamPublisher,
} from "@flow-state-dev/engine";
import type { OutputItem } from "@flow-state-dev/core/items";
import { resolveWorkerConnection } from "./connection";
import type { BullmqConnectionOptions, FlowJobData, RetryConfig } from "./types";

/** Dependencies injected into the flow worker. */
export interface FlowWorkerDeps {
  registry: FlowRegistry;
  stores: StoreRegistry;
  runtimeConfig: RuntimeConfig;
  bridge?: StreamBridge;
  concurrency?: number;
  lockDuration?: number;
  onItem?: (jobId: string, item: OutputItem, kind: "added" | "updated" | "done") => void;
}

export interface CreateFlowWorkerOptions extends BullmqConnectionOptions {
  queueName?: string;
  retry?: RetryConfig;
  deps: FlowWorkerDeps;
}

const DEFAULT_QUEUE_NAME = "fsd-flows";
const DEFAULT_CONCURRENCY = 2;
/** 5 minutes — LLM calls are slow, so we extend the default lock. */
const DEFAULT_LOCK_DURATION = 300_000;

/**
 * Builds the job processor used by `createFlowWorker`. Exported separately so
 * the retry/terminal-publish semantics are testable without a Redis
 * connection (constructing a BullMQ `Worker` connects eagerly).
 */
export function createFlowJobProcessor(deps: FlowWorkerDeps) {
  const { registry, stores, runtimeConfig, bridge, onItem } = deps;

  return async (job: Job<FlowJobData>) => {
    const data = job.data;
    const flow = registry.get(data.flowKind);
    if (!flow) {
      throw new UnrecoverableError(`Unknown flow "${data.flowKind}"`);
    }

    // On a retry attempt the previous run may have persisted events under
    // the same requestId. Resume sequence numbering past them — tailing
    // clients filter on `sequence_number > cursor`, so a restart at zero
    // would hide the retry's events and corrupt cursor-based replay.
    // `attemptsMade` counts completed attempts inside a processor (BullMQ
    // increments it after moveToCompleted/moveToFailed), so > 0 means retry.
    let startSequenceNumber: number | undefined;
    if (job.attemptsMade > 0 && data.requestId !== undefined) {
      const prior = await stores.request
        .getEvents(data.requestId)
        .catch(() => []);
      startSequenceNumber = prior[prior.length - 1]?.sequence_number;
    }

    let publisher: StreamPublisher | undefined;
    if (bridge) {
      publisher = bridge.createPublisher(data.requestId ?? job.id ?? "unknown");
    }

    let terminalPublished = false;
    try {
      const result = await runAction({
        flow,
        actionName: data.actionName as keyof typeof flow.actions & string,
        input: data.input,
        userId: data.userId,
        sessionId: data.sessionId,
        requestId: data.requestId,
        orgId: data.orgId,
        tenantId: data.tenantId,
        source: data.source ?? "bullmq",
        metadata: data.metadata,
        stores,
        runtimeConfig,
        startSequenceNumber,
        onItem: (item: OutputItem, kind: "added" | "updated" | "done") => {
          onItem?.(job.id ?? "unknown", item, kind);
          if (publisher) {
            publisher
              .publishEvent({
                event: `item.${kind}`,
                data: JSON.stringify(item),
              })
              .catch(() => {}); // bridge is best-effort
          }
        },
      });

      if (result.error) {
        if (isNonRetryable(result.error)) {
          if (publisher) {
            await publisher.publishTerminal(result).catch(() => {});
            terminalPublished = true;
          }
          throw new UnrecoverableError(result.error.message);
        }
        // Retryable error: don't publish terminal yet — BullMQ will retry
        // and the subscriber needs to stay alive to receive the eventual
        // success or final-failure terminal.
        throw new Error(result.error.message);
      }

      if (publisher) {
        await publisher.publishTerminal(result).catch(() => {});
      }

      return result;
    } catch (err) {
      // Publish the error terminal only when BullMQ will NOT retry this
      // job: a non-retryable error or the final configured attempt. Earlier
      // attempts skip the publish so the web-side subscriber stays alive for
      // the retry. Mirrors BullMQ's own `shouldRetryJob` predicate
      // (`attemptsMade + 1 < attempts`, UnrecoverableError checked by name
      // too for cross-realm errors).
      const willRetry =
        !(err instanceof UnrecoverableError) &&
        (err as Error | undefined)?.name !== "UnrecoverableError" &&
        job.attemptsMade + 1 < (job.opts.attempts ?? 1);
      if (publisher && !terminalPublished && !willRetry) {
        const errorResult = {
          error: { message: err instanceof Error ? err.message : String(err) }
        };
        await publisher.publishTerminal(errorResult as any).catch(() => {});
      }
      throw err;
    } finally {
      if (publisher) {
        await publisher.close().catch(() => {});
      }
    }
  };
}

/**
 * Creates a BullMQ Worker that processes flow-run jobs by calling `runAction`.
 * Each job carries a `FlowJobData` payload; the worker resolves the flow from
 * the registry, executes it, and maps the result back to BullMQ job
 * completion/failure semantics.
 */
export function createFlowWorker(options: CreateFlowWorkerOptions): Worker {
  const { connection, prefix } = resolveWorkerConnection(options);
  const queueName = options.queueName ?? DEFAULT_QUEUE_NAME;
  const { concurrency, lockDuration } = options.deps;
  const processor = createFlowJobProcessor(options.deps);

  return new Worker(queueName, processor, {
    connection,
    prefix,
    concurrency: concurrency ?? DEFAULT_CONCURRENCY,
    lockDuration: lockDuration ?? DEFAULT_LOCK_DURATION,
  });
}

function isNonRetryable(error: { retryable?: boolean }): boolean {
  return error.retryable === false;
}

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
import { runAction } from "@flow-state-dev/server";
import type {
  FlowRegistry,
  StoreRegistry,
  RuntimeConfig,
  StreamBridge,
  StreamPublisher,
} from "@flow-state-dev/server";
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
 * Creates a BullMQ Worker that processes flow-run jobs by calling `runAction`.
 * Each job carries a `FlowJobData` payload; the worker resolves the flow from
 * the registry, executes it, and maps the result back to BullMQ job
 * completion/failure semantics.
 */
export function createFlowWorker(options: CreateFlowWorkerOptions): Worker {
  const { connection, prefix } = resolveWorkerConnection(options);
  const queueName = options.queueName ?? DEFAULT_QUEUE_NAME;
  const { registry, stores, runtimeConfig, bridge, concurrency, lockDuration, onItem } =
    options.deps;

  const processor = async (job: Job<FlowJobData>) => {
    const data = job.data;
    const flow = registry.get(data.flowKind);
    if (!flow) {
      throw new UnrecoverableError(`Unknown flow "${data.flowKind}"`);
    }

    let publisher: StreamPublisher | undefined;
    if (bridge) {
      publisher = bridge.createPublisher(data.requestId ?? job.id ?? "unknown");
    }

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
        onItem: (item, kind) => {
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
        if (publisher) {
          await publisher.publishTerminal(result).catch(() => {});
        }
        if (isNonRetryable(result.error)) {
          throw new UnrecoverableError(result.error.message);
        }
        throw new Error(result.error.message);
      }

      if (publisher) {
        await publisher.publishTerminal(result).catch(() => {});
      }

      return result;
    } catch (err) {
      if (publisher) {
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

  return new Worker(queueName, processor, {
    connection,
    prefix,
    concurrency: concurrency ?? DEFAULT_CONCURRENCY,
    lockDuration: lockDuration ?? DEFAULT_LOCK_DURATION,
  });
}

/** Error codes / types that should not be retried. */
function isNonRetryable(error: { code?: string; type?: string }): boolean {
  const nonRetryableCodes = [
    "VALIDATION_ERROR",
    "FLOW_NOT_FOUND",
    "ACTION_NOT_FOUND",
  ];
  return (
    nonRetryableCodes.includes(error.code ?? "") ||
    error.type === "validation" ||
    error.type === "permanent"
  );
}

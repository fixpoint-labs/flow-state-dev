/**
 * WorkerDispatcher — routes all flow dispatches through a BullMQ queue.
 *
 * The web process enqueues and subscribes to live events via the bridge.
 * The subscriber is created *before* the job is enqueued so no early events
 * are lost. The returned handle exposes the request id, a `finished` promise,
 * and an `abort` hook.
 */
import type { Queue } from "bullmq";
import type {
  FlowDispatcher,
  FlowDispatchHandle,
  DispatchEnvelope,
  StreamBridge,
} from "@flow-state-dev/server";
import { toJobOptions } from "./retry";
import type { RetryConfig } from "./types";

export interface CreateWorkerDispatcherOptions {
  queue: Queue;
  bridge: StreamBridge;
  retryConfig?: RetryConfig;
}

/**
 * Creates a `FlowDispatcher` that enqueues flow-run jobs to a BullMQ queue
 * and bridges live events back to the caller via a `StreamBridge`.
 */
export function createWorkerDispatcher(
  options: CreateWorkerDispatcherOptions
): FlowDispatcher {
  const { queue, bridge, retryConfig } = options;
  const jobOpts = toJobOptions(retryConfig);

  return {
    async dispatch(
      envelope: DispatchEnvelope,
      _bridge?: StreamBridge
    ): Promise<FlowDispatchHandle> {
      const activeBridge = _bridge ?? bridge;

      // Subscribe before enqueuing so we don't miss early events
      const subscriber = activeBridge.createSubscriber(envelope.requestId);

      // Enqueue the job — clean up subscriber connections on failure
      try {
        await queue.add(
          "flow-run",
          {
            flowKind: envelope.flowKind,
            actionName: envelope.actionName,
            input: envelope.input,
            userId: envelope.userId,
            sessionId: envelope.sessionId,
            orgId: envelope.orgId,
            tenantId: envelope.tenantId,
            source: envelope.source,
            metadata: envelope.metadata,
            requestId: envelope.requestId,
          },
          jobOpts
        );
      } catch (err) {
        await subscriber.close().catch(() => {});
        throw err;
      }

      return {
        requestId: envelope.requestId,
        finished: subscriber.completed.finally(() =>
          subscriber.close().catch(() => {})
        ),
        abort: () => subscriber.abort(),
      };
    },

    async close() {
      // Queue lifecycle managed by createBullmqRuntime
    },
  };
}

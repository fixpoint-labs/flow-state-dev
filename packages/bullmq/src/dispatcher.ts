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
} from "@flow-state-dev/engine";
import { toJobOptions } from "./retry";
import { leaseJobId } from "./lease-backend";
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

      // A job that carries a place is enqueued under the id the place names,
      // so the lease backend can read the job's state when the place's lease
      // runs out, without a second write to bind the two.
      const place = envelope.leasePlace ?? undefined;

      // Enqueue the job — clean up subscriber connections on failure
      try {
        const job = await queue.add(
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
            ...(place !== undefined ? { leasePlace: place } : {}),
          },
          place !== undefined ? { ...jobOpts, jobId: leaseJobId(place) } : jobOpts
        );
        // BullMQ answers an `add` under an id it already has with the existing
        // job and writes nothing: a reused ticket would drop this request
        // silently. Refused by name instead.
        if (place !== undefined && job?.data?.requestId !== envelope.requestId) {
          throw new Error(
            `Job id "${leaseJobId(place)}" already belongs to request "${String(job?.data?.requestId)}"; ` +
              `request "${envelope.requestId}" was not enqueued. Lease tickets must be unique.`
          );
        }
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

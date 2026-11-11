/**
 * WorkerRunner — routes all flow dispatches through a BullMQ queue.
 *
 * The web process enqueues and subscribes to live events via the bridge.
 * The subscriber is created *before* the job is enqueued so a fast job's
 * terminal is not missed. The returned handle exposes the request id, a `finished` promise,
 * and an `abort` hook.
 *
 * `finished` settles on the worker's terminal message, or, when that message
 * never comes (its publish failed, pub/sub dropped it, the worker died before
 * sending it), once the job itself has ended: the runner reads the job's state
 * in BullMQ every `DEFAULT_LEASE_MS`, as the lease backend does for a place
 * whose lease ran out. Either way the subscriber and its two Redis connections
 * are closed, and whatever the caller keeps until `finished` settles is
 * released. A job still waiting, delayed, or running keeps the dispatch open.
 */
import type { Queue } from "bullmq";
import type {
  ExecutionResult,
  FlowRunner,
  RunnerHandle,
  DispatchEnvelope,
  StreamBridge
} from "@flow-state-dev/engine/host";
import { toJobOptions } from "./retry";
import { DEFAULT_LEASE_MS, leaseJobId } from "./lease-backend";
import type { RetryConfig } from "./types";

export interface CreateWorkerRunnerOptions {
  queue: Queue;
  bridge: StreamBridge;
  retryConfig?: RetryConfig;
}

/**
 * Creates a `FlowRunner` that enqueues flow-run jobs to a BullMQ queue
 * and bridges live events back to the caller via a `StreamBridge`.
 */
export function createWorkerRunner(
  options: CreateWorkerRunnerOptions
): FlowRunner {
  const { queue, bridge, retryConfig } = options;
  const jobOpts = toJobOptions(retryConfig);

  return {
    async dispatch(
      envelope: DispatchEnvelope,
      _bridge?: StreamBridge
    ): Promise<RunnerHandle> {
      const activeBridge = _bridge ?? bridge;

      // Subscribe before enqueuing so a fast job's terminal is not missed
      const subscriber = activeBridge.createSubscriber(envelope.requestId);

      // A job that carries a place is enqueued under the id the place names,
      // so the lease backend can read the job's state when the place's lease
      // runs out, without a second write to bind the two.
      const place = envelope.leasePlace ?? undefined;

      // Enqueue the job — clean up subscriber connections on failure
      let jobId: string | undefined;
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
            ...(envelope.attachments !== undefined ? { attachments: envelope.attachments } : {}),
            requestId: envelope.requestId,
            ...(place !== undefined ? { leasePlace: place } : {}),
            ...(envelope.leaseTurn != null ? { leaseTurn: envelope.leaseTurn } : {}),
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
        jobId = job.id;
      } catch (err) {
        await subscriber.close().catch(() => {});
        throw err;
      }

      const jobEnd = jobId !== undefined ? watchJobEnd(queue, jobId) : undefined;
      const settled = jobEnd
        ? Promise.race([subscriber.completed, jobEnd.ended])
        : subscriber.completed;

      return {
        requestId: envelope.requestId,
        finished: settled.finally(() => {
          jobEnd?.stop();
          return subscriber.close().catch(() => {});
        }),
        abort: () => subscriber.abort(),
      };
    },

    async close() {
      // Queue lifecycle managed by createBullmqRuntime
    },
  };
}

/**
 * Job states after which no worker runs the job again, so no terminal is still
 * coming. `unknown` is a job BullMQ no longer has (removed by its retention).
 */
const ENDED_STATES = new Set(["completed", "failed", "unknown"]);

/**
 * Watch a dispatched job until it has ended, every `DEFAULT_LEASE_MS`.
 * `ended` resolves with the result the lost terminal would have carried: the
 * job's return value, or an error terminal of the same shape the worker
 * publishes. It never rejects; a failed state read is tried again next time.
 */
function watchJobEnd(
  queue: Queue,
  jobId: string
): { ended: Promise<ExecutionResult>; stop(): void } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ended = new Promise<ExecutionResult>((resolve) => {
    const schedule = () => {
      timer = setTimeout(() => void check(), DEFAULT_LEASE_MS);
      // A dispatch left waiting must not keep the process alive.
      timer.unref?.();
    };
    const check = async () => {
      const state = await queue.getJobState(jobId).catch(() => undefined);
      if (stopped) return;
      if (state === undefined || !ENDED_STATES.has(state)) {
        schedule();
        return;
      }
      const job = state === "unknown" ? undefined : await queue.getJob(jobId).catch(() => undefined);
      if (state === "completed" && job?.returnvalue != null && typeof job.returnvalue === "object") {
        resolve(job.returnvalue as ExecutionResult);
        return;
      }
      const message =
        state === "failed"
          ? job?.failedReason || `Job "${jobId}" failed`
          : `Job "${jobId}" ended without delivering a result`;
      resolve({ error: { message } } as unknown as ExecutionResult);
    };
    schedule();
  });
  return {
    ended,
    stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

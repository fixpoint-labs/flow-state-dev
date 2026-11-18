/**
 * The fixture app's `FlowState` (FIX-2368): the board flow over Postgres,
 * shared by its Node host (`host.mts`) and its Next route (`next-route.ts`).
 *
 * `postgresStores` connects to `FSD_DB_URL`. No bus line, no push option, no
 * poll interval: the defaults are what the run grades. With `FSD_REDIS_URL`
 * set, actions run on BullMQ: `FSD_WORKER_MODE=enqueue-only` enqueues,
 * `process-only` runs the queue. Unset is enqueue-only.
 *
 * `GOAL_CONTROL=main-before` copies this file, byte for byte, into `db498b976`,
 * which still exports `bullmqWorker` and takes `worker:`. The same bytes have
 * to load there, so the queue option follows whichever export that checkout has.
 *
 * Sign-in is a cookie naming a token the app knows: A and B in org 1, C in org 2.
 */
import * as bullmq from "@flow-state-dev/bullmq";
import { createFlowState } from "@flow-state-dev/engine";
import type { JobQueueMode } from "@flow-state-dev/engine/host";
import { postgresStores } from "@flow-state-dev/store-postgres";
import { boardFlow } from "./flow.ts";

const people: Record<string, { userId: string; orgId: string }> = {
  "tok-a": { userId: "user-a", orgId: "org-1" },
  "tok-b": { userId: "user-b", orgId: "org-1" },
  "tok-c": { userId: "user-c", orgId: "org-2" }
};

function signedIn(request: Request | undefined): { userId: string; orgId: string } | null {
  const cookie = request?.headers.get("cookie") ?? "";
  const token = /(?:^|;\s*)board-token=([^;]+)/.exec(cookie)?.[1];
  return token === undefined ? null : (people[token] ?? null);
}

const redis = process.env.FSD_REDIS_URL;

/** Which side of the queue this process runs, when the app runs on BullMQ. */
function queueMode(value: string | undefined): JobQueueMode {
  if (value === undefined || value === "enqueue-only") return "enqueue-only";
  if (value === "process-only") return "process-only";
  throw new Error(`FSD_WORKER_MODE must be enqueue-only or process-only (got ${value})`);
}

const workerMode = queueMode(process.env.FSD_WORKER_MODE);

/**
 * Which queue export this checkout has. Current packages export
 * `bullmqJobQueue` (`jobQueue:`). The pinned `main-before` checkout exports
 * `bullmqWorker` (`worker:`, modes `dispatch-only` / `worker-only`). A named
 * import of the missing one throws as the file loads, so this reads the namespace.
 */
export function queueOption(mod: object, connection: string, mode: JobQueueMode): { jobQueue: unknown } | { worker: unknown } {
  if ("bullmqJobQueue" in mod && typeof mod.bullmqJobQueue === "function") {
    return { jobQueue: mod.bullmqJobQueue({ connection, mode }) };
  }
  if ("bullmqWorker" in mod && typeof mod.bullmqWorker === "function") {
    return {
      worker: mod.bullmqWorker({
        connection,
        mode: mode === "process-only" ? "worker-only" : "dispatch-only",
      }),
    };
  }
  throw new Error("this checkout exports neither bullmqJobQueue nor bullmqWorker");
}

const flow = {
  flows: [boardFlow()],
  stores: { default: { primary: postgresStores({ connectionString: process.env.FSD_DB_URL }) } },
  resolvePrincipal: (context: { request?: Request }) => signedIn(context.request),
};

/** The app's `FlowState`. */
export const app = createFlowState(
  redis === undefined
    ? flow
    : attachQueue(flow, queueOption(bullmq, redis, workerMode)),
);

/**
 * `jobQueue` is the current option. `worker` is the option the pinned
 * checkout still reads; the current `createFlowState` type does not name it,
 * and the property has to be on the object anyway when that checkout loads
 * these same bytes.
 */
function attachQueue<T extends object>(
  options: T,
  queue: { jobQueue: unknown } | { worker: unknown },
): T {
  if ("jobQueue" in queue) {
    const withQueue: T & { jobQueue: ReturnType<typeof bullmq.bullmqJobQueue> } = {
      ...options,
      jobQueue: queue.jobQueue as ReturnType<typeof bullmq.bullmqJobQueue>,
    };
    return withQueue;
  }
  const withWorker: T & { worker: unknown } = { ...options, worker: queue.worker };
  return withWorker;
}

/** Whether this process only runs the queue and serves nothing. */
export const workerOnly = redis !== undefined && workerMode === "process-only";

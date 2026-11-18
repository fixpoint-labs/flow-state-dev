/**
 * The fixture app's `FlowState` (FIX-2368): the board flow over Postgres,
 * shared by its Node host (`host.mts`) and its Next route (`next-route.ts`).
 *
 * `postgresStores` connects to `FSD_DB_URL`. No bus line, no push option, no
 * poll interval: the defaults are what the run grades. With `FSD_REDIS_URL`
 * set, actions run on BullMQ: `FSD_WORKER_MODE=enqueue-only` enqueues,
 * `process-only` runs the queue. Unset is enqueue-only.
 *
 * Sign-in is a cookie naming a token the app knows: A and B in org 1, C in org 2.
 */
import { bullmqJobQueue } from "@flow-state-dev/bullmq";
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

/** The app's `FlowState`. */
export const app = createFlowState({
  flows: [boardFlow()],
  stores: { default: { primary: postgresStores({ connectionString: process.env.FSD_DB_URL }) } },
  resolvePrincipal: (context) => signedIn(context.request),
  ...(redis === undefined ? {} : { jobQueue: bullmqJobQueue({ connection: redis, mode: workerMode }) })
});

/** Whether this process only runs the queue and serves nothing. */
export const workerOnly = redis !== undefined && workerMode === "process-only";

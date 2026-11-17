/**
 * The fixture app's `FlowState` (FIX-2368): the board flow over Postgres,
 * shared by its Node host (`host.mts`) and its Next route (`next-route.ts`).
 *
 * `postgresStores` connects to `FSD_DB_URL`. No bus line, no push option, no
 * poll interval: the defaults are what the run grades. With `FSD_REDIS_URL`
 * set, actions run on BullMQ as the adapter's setup reads:
 * `FSD_WORKER_MODE=dispatch-only` enqueues, `worker-only` runs the queue.
 *
 * Sign-in is a cookie naming a token the app knows: A and B in org 1, C in org 2.
 */
import { bullmqWorker } from "@flow-state-dev/bullmq";
import { createFlowState } from "@flow-state-dev/engine";
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
export const workerMode = process.env.FSD_WORKER_MODE === "worker-only" ? "worker-only" : "dispatch-only";

/** The app's `FlowState`. */
export const app = createFlowState({
  flows: [boardFlow()],
  stores: { default: { primary: postgresStores({ connectionString: process.env.FSD_DB_URL }) } },
  resolvePrincipal: (context) => signedIn(context.request),
  ...(redis === undefined ? {} : { worker: bullmqWorker({ connection: redis, mode: workerMode }) })
});

/** Whether this process only runs the queue and serves nothing. */
export const workerOnly = redis !== undefined && workerMode === "worker-only";

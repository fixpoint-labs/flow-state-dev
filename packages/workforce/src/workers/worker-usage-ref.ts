// FIX-2624.
/**
 * The client's handle on the worker usage view: the roster flow's address and
 * the view's name, typed by the view through a type import. Holds no block,
 * so it is safe in a browser bundle.
 */
import { viewRef } from "@flow-state-dev/client";
import { ROSTER_FLOW, WORKER_USAGE_VIEW } from "./keys";
import type { WorkerUsageViewDefinition } from "./worker-usage";

/** Each worker's usage over a period, for `client.view(workerUsageView, { days })` or `useView`. */
export const workerUsageView = viewRef<WorkerUsageViewDefinition>(ROSTER_FLOW, WORKER_USAGE_VIEW);

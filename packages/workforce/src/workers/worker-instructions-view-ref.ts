/**
 * The client's handle on the roster flow's `workerInstructions` view. Holds
 * no block, so it is safe in a browser bundle.
 */
import { viewRef } from "@flow-state-dev/client";
import { ROSTER_FLOW, WORKER_INSTRUCTIONS_VIEW } from "./keys";
import type { WorkerInstructionsView } from "./worker-instructions-view";

/** One worker's instructions, for `client.view(workerInstructionsView, { id })`. */
export const workerInstructionsView = viewRef<WorkerInstructionsView>(ROSTER_FLOW, WORKER_INSTRUCTIONS_VIEW);

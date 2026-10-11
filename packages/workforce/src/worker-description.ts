/**
 * A hired worker's `description`, kept beside the worker rather than in its
 * settings.
 *
 * The hire reads `description` and hands the worker flow everything else, so a worker's
 * settings never carry it, and adding it there would be a new key every
 * hand-written worker flow schema refuses at boot. A routed mailbox still needs it:
 * the route describes each member to its evaluator by its `WORKER.md`
 * `description:`. So the hire records it here, against the worker it minted,
 * and the route reads it back. Every mint path (the files, the runtime `hire`
 * tool, the boot reload) runs through `hireWorkforce`, so every worker whose
 * record carries one has it here.
 */

import type { FlowInstance } from "@flow-state-dev/core/types";

const descriptions = new WeakMap<FlowInstance, string>();

/**
 * Keep a worker's description. Called by `hireWorkforce` for each worker it mints
 * from a record carrying one.
 */
export function recordWorkerDescription(worker: FlowInstance, description: string): void {
  descriptions.set(worker, description);
}

/** A hired worker's description, verbatim, or `undefined` when its record carried none. */
export function workerDescription(worker: FlowInstance): string | undefined {
  return descriptions.get(worker);
}

/**
 * A hired seat's `description`, kept beside the seat rather than in its
 * settings.
 *
 * The hire reads `description` and hands the kind everything else, so a seat's
 * settings never carry it, and adding it there would be a new key every
 * hand-written kind schema refuses at boot. A routed channel still needs it:
 * the route describes each member to its evaluator by its `WORKER.md`
 * `description:`. So the hire records it here, against the seat it minted,
 * and the route reads it back. Every mint path (the files, the runtime `hire`
 * tool, the boot reload) runs through `hireWorkforce`, so every seat whose
 * record carries one has it here.
 */

import type { FlowInstance } from "@flow-state-dev/core/types";

const descriptions = new WeakMap<FlowInstance, string>();

/**
 * Keep a seat's description. Called by `hireWorkforce` for each seat it mints
 * from a record carrying one.
 */
export function recordSeatDescription(seat: FlowInstance, description: string): void {
  descriptions.set(seat, description);
}

/** A hired seat's description, verbatim, or `undefined` when its record carried none. */
export function seatDescription(seat: FlowInstance): string | undefined {
  return descriptions.get(seat);
}

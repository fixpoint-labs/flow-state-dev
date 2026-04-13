/**
 * Reactive Blackboard Schemas
 *
 * Defines the resource schema for the entry log and the sequencer control
 * state for the emit block. The entry log is a simple writable resource
 * with an entries array — consistent with FIX-317's approach.
 */
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Entry Log Resource
// ---------------------------------------------------------------------------

/**
 * Creates the blackboard entry log resource. Entries are stored as an
 * append-only array. The actual entry shape is user-defined via config;
 * the resource stores them as `z.any()` to avoid generic complexity.
 *
 * The resource exposes its entries array via `client.data` so that
 * UI components can read the reactive chain in real-time via the
 * session snapshot.
 */
export function createReactiveBlackboard() {
  return defineResource({
    stateSchema: reactiveBlackboardStateSchema,
    writable: true,
    client: {
      data: (state) => ({ entries: state.entries }),
    },
  });
}

/**
 * Resource state schema for the reactive blackboard entry log.
 * `entries` is the append-only log of all emitted entries.
 */
export const reactiveBlackboardStateSchema = z.object({
  entries: z.array(z.any()).default([]),
});

export type ReactiveBlackboardState = z.infer<typeof reactiveBlackboardStateSchema>;

// ---------------------------------------------------------------------------
// Emit Sequencer Control State
// ---------------------------------------------------------------------------

/**
 * Sequencer state for the emit block. Tracks emission count
 * for observability.
 */
export const emitControlSchema = z.object({
  emissionCount: z.number().default(0),
});

export type EmitControlState = z.infer<typeof emitControlSchema>;

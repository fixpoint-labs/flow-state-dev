/**
 * eventActors schemas — workspace resource (entry log) and the worker
 * meta we attach as `task.metadata`.
 *
 * The entry log lives as a sibling writable session resource — substrate
 * Tasks are about actor invocations, not entry storage. This mirrors the
 * design spec's split: TaskCollection drives actor dispatch; the entry
 * log stays as content.
 */
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

/**
 * Creates the entry-log workspace resource. Entries are stored as an
 * append-only array. The actual entry shape is user-defined via config;
 * the resource stores them as `z.any()` to avoid generic depth issues.
 *
 * `client.data` projects the entries array so UI components can read the
 * reactive chain in real time.
 */
export function createEventActorsWorkspaceResource() {
  return defineResource({
    scope: "session",
    stateSchema: eventActorsWorkspaceStateSchema,
    writable: true,
    client: {
      data: (state) => ({ entries: state.entries }),
    },
  });
}

export const eventActorsWorkspaceStateSchema = z.object({
  entries: z.array(z.any()).default([]),
});

export type EventActorsWorkspaceState = z.infer<
  typeof eventActorsWorkspaceStateSchema
>;

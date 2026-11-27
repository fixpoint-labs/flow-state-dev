/**
 * append-entry — add an entry to the workspace resource if not already
 * present, emit a keyed `rb-entry` data record for live rendering.
 *
 * Deduplication: skip when an entry with the same `type` + `topic`
 * already exists. Concurrent forEach dispatches can produce duplicates
 * when multiple actors emit entries with identical topics; treating
 * (type, topic) as the dedupe key matches the original pattern's
 * behavior.
 */
import { handler } from "@flow-state-dev/core";
import type { DefinedResource } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  eventActorsWorkspaceStateSchema,
  type EventActorsWorkspaceState,
} from "../schemas";

/**
 * State-only: writes the workspace resource and emits, returns nothing.
 * @remarks Compose with `.tap(createAppendEntry(...))`, never `.step()` —
 * it returns nothing, so `.step()` hands `undefined` to the next step.
 */
export function createAppendEntry(
  name: string,
  workspaceResource: DefinedResource,
  resourceKey = "workspace"
) {
  return handler({
    name: `${name}-append`,
    inputSchema: z.any(),
    resources: { [resourceKey]: workspaceResource as DefinedResource<EventActorsWorkspaceState> },
    activeStatusMessage: (entry) => {
      const entryTopic =
        (entry as Record<string, unknown> | undefined)?.topic ?? "";
      return entryTopic
        ? `Considering ${entryTopic}...`
        : "Considering an entry...";
    },
    execute: async (entry, ctx) => {
      const workspace = ctx.resources[resourceKey];
      const state = workspace.state;

      const entryType = (entry as Record<string, unknown>).type ?? "unknown";
      const entryTopic = (entry as Record<string, unknown>).topic ?? "";
      const isDuplicate = state.entries.some(
        (e: Record<string, unknown>) =>
          e.type === entryType && e.topic === entryTopic
      );
      if (isDuplicate) return;

      await workspace.patchState({
        entries: [...state.entries, entry],
      });

      const emissionCount = ctx.sequencer?.state.emissionCount ?? state.entries.length;

      ctx.emit.data(
        "rb-entry",
        {
          type: entryType,
          topic: entryTopic,
          body: (entry as Record<string, unknown>).body,
        },
        { key: `entry-${emissionCount}`, itemVisibility: { client: true, history: false } }
      );
    },
  });
}

/** Re-export for parity with the workspace state schema users may want. */
export { eventActorsWorkspaceStateSchema };

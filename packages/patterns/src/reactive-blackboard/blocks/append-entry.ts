/**
 * Append Entry Handler
 *
 * Appends an entry to the reactive blackboard resource's entries array
 * and bumps the emission counter in sequencer state. Emits a status
 * message for observability.
 */
import { handler } from "@flow-state-dev/core";
import type { DefinedResource } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  emitControlSchema,
  type EmitControlState,
  type ReactiveBlackboardState,
} from "../schemas";

/**
 * Creates a handler that appends the input entry to the blackboard
 * resource and returns the entry unchanged for downstream fan-out.
 *
 * @param resourceKey - Session resource key. Defaults to `"reactiveBlackboard"`.
 *   Override when co-existing with other blackboard patterns in the same
 *   router to avoid resource key conflicts.
 */
export function createAppendEntry(
  name: string,
  blackboardResource: DefinedResource,
  resourceKey = "reactiveBlackboard"
) {
  return handler({
    name: `${name}-append`,
    inputSchema: z.any(),
    outputSchema: z.any(),
    sessionResources: { [resourceKey]: blackboardResource },
    sequencerStateSchema: emitControlSchema,
    // Declarative in-flight indicator for this append step. The function form
    // reads the entry to surface which entry is being appended without an
    // imperative `emitStatus` call mid-execute.
    activeStatusMessage: (entry) => {
      const entryTopic = (entry as Record<string, unknown> | undefined)?.topic ?? "";
      return entryTopic ? `Considering ${entryTopic}...` : 'Considering an entry...';      
    },
    execute: async (entry, ctx) => {
      const state = (ctx.session.resources as Record<string, any>)[resourceKey]
        .state as ReactiveBlackboardState;

      // Deduplicate: skip if an entry with the same type+topic already exists.
      // Concurrent forEachBackground dispatches can produce duplicates when
      // multiple actors emit entries with identical topics.
      const entryType = (entry as Record<string, unknown>).type ?? "unknown";
      const entryTopic = (entry as Record<string, unknown>).topic ?? "";
      const isDuplicate = state.entries.some(
        (e: Record<string, unknown>) =>
          e.type === entryType && e.topic === entryTopic
      );
      if (isDuplicate) return entry;

      await (ctx.session.resources as Record<string, any>)[resourceKey].patchState({
        entries: [...state.entries, entry],
      });

      const controlState = ctx.sequencer!.state as EmitControlState;
      await ctx.sequencer!.patchState({
        emissionCount: controlState.emissionCount + 1,
      });

      // Emit a non-transient component item so container renderers can
      // track entries in real-time. Status items are transient and filtered
      // by useSession, but component items survive and are visible to
      // useContainerItems.
      ctx.emitComponent("rb-entry", {
        type: entryType,
        topic: entryTopic,
        body: (entry as Record<string, unknown>).body,
      }, { key: `entry-${controlState.emissionCount}` });

      return entry;
    },
  });
}

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
 */
export function createAppendEntry(
  name: string,
  blackboardResource: DefinedResource
) {
  return handler({
    name: `${name}-append`,
    inputSchema: z.any(),
    outputSchema: z.any(),
    sessionResources: { blackboard: blackboardResource },
    sequencerStateSchema: emitControlSchema,
    execute: async (entry, ctx) => {
      const state = ctx.session.resources.blackboard
        .state as ReactiveBlackboardState;
      await ctx.session.resources.blackboard.patchState({
        entries: [...state.entries, entry],
      });

      const controlState = ctx.sequencer!.state as EmitControlState;
      await ctx.sequencer!.patchState({
        emissionCount: controlState.emissionCount + 1,
      });

      const entryType = (entry as Record<string, unknown>).type ?? "unknown";
      const entryTopic = (entry as Record<string, unknown>).topic ?? "";
      ctx.emitStatus(
        `[reactive-blackboard:${name}] emitted ${entryType}:${entryTopic}`
      );

      return entry;
    },
  });
}

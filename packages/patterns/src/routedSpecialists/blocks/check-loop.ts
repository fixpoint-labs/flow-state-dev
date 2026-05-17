/**
 * Materializes the loop-continue signal for `loopBack.when` to inspect.
 * Reads `done` from sequencer state (set by recordIteration) so the
 * predicate doesn't have to peek into context.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { routedSpecialistsControlSchema } from "../schemas";

export function createCheckLoop(name: string) {
  return handler({
    name: `${name}-check`,
    inputSchema: z.any(),
    outputSchema: z.object({ continue: z.boolean() }),
    sequencerStateSchema: routedSpecialistsControlSchema,
    execute: async (_input, ctx) => {
      const state = ctx.sequencer!.state;
      return { continue: !state.done };
    },
  });
}

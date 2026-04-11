import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { blackboardControlSchema } from "../schemas";

/**
 * Materializes the loop-continue signal into the pipeline value.
 * Reads `done` from sequencer state (set by recordDecision) so the
 * `loopBack.when` callback can inspect the pipeline value directly.
 */
export function createCheckBlackboard(name: string) {
  return handler({
    name: `${name}-check`,
    inputSchema: z.any(),
    outputSchema: z.object({ continue: z.boolean() }),
    sequencerStateSchema: blackboardControlSchema,
    execute: async (_input, ctx) => {
      return { continue: !ctx.sequencer!.state.done };
    },
  });
}

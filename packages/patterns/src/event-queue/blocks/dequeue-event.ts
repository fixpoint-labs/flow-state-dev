import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import type { createEventQueueStateSchema } from "../schemas";

/**
 * Creates a handler that dequeues the head event from the sequencer state queue.
 * Returns `{ event: TEvent }` if events remain, or `{ event: null }` if empty.
 */
export function createDequeueEvent<TEvent>(
  name: string,
  stateSchema: ReturnType<typeof createEventQueueStateSchema<TEvent>>
) {
  return handler({
    name: `${name}-dequeue`,
    inputSchema: z.any(),
    outputSchema: z.object({ event: z.any() }),
    sequencerStateSchema: stateSchema,
    execute: async (_input, ctx) => {
      const { queue } = ctx.sequencer!.state;
      if (queue.length === 0) return { event: null };
      const [event, ...rest] = queue;
      await ctx.sequencer!.patchState({ queue: rest });
      return { event };
    },
  });
}

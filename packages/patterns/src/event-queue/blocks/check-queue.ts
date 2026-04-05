import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import type { createEventQueueStateSchema } from "../schemas";

/**
 * Creates a handler that checks whether events remain in the queue.
 * Runs inside the sequencer's execution scope where `ctx.sequencer` is
 * correctly populated, so the result can drive `loopBack.when` via the
 * pipeline value instead of relying on `ctx` in the loopBack callback.
 */
export function createCheckQueue<TEvent>(
  name: string,
  stateSchema: ReturnType<typeof createEventQueueStateSchema<TEvent>>
) {
  return handler({
    name: `${name}-check-queue`,
    inputSchema: z.any(),
    outputSchema: z.object({ hasMore: z.boolean() }),
    sequencerStateSchema: stateSchema,
    execute: async (_input, ctx) => {
      return { hasMore: ctx.sequencer!.state.queue.length > 0 };
    },
  });
}

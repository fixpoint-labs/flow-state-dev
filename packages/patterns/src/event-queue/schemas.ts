import { z, type ZodType } from "zod";

/**
 * Creates a Zod schema for event queue sequencer state.
 * The queue holds an array of typed events that are drained one per iteration.
 */
export function createEventQueueStateSchema<TEvent>(eventSchema: ZodType<TEvent>) {
  return z.object({
    queue: z.array(eventSchema).default([]),
  });
}

export type EventQueueState<TEvent> = { queue: TEvent[] };

import { router } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";

/**
 * Creates a router that dispatches to the appropriate handler based on `event.type`.
 * Throws a descriptive error if no handler is registered for the event type.
 */
export function createDispatchEvent<TEvent extends { type: string }>(
  name: string,
  handlers: Record<string, BlockDefinition<any, any>>
) {
  return router({
    name: `${name}-dispatch`,
    inputSchema: z.object({ event: z.any() }),
    outputSchema: z.any(),
    routes: Object.values(handlers),
    execute: (input: { event: TEvent }) => {
      const target = handlers[input.event.type];
      if (!target) {
        throw new Error(
          `[event-queue] No handler registered for event type "${input.event.type}" in "${name}"`
        );
      }
      return target;
    },
  });
}

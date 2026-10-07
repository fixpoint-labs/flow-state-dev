/**
 * One door for a fixture worker flow.
 *
 * The worker contract requires exactly one public action that declares
 * `userMessage` and takes `{ message }`. A goal whose point is something else
 * spreads this into its `actions`:
 *
 * ```ts
 * actions: { ...workerDoor, drain: { block: board.drain } }
 * ```
 *
 * The door answers by saying what it heard, so a check that sends a line can
 * see it was read.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

/** One door, under the action name `message`. */
export const workerDoor = {
  message: {
    inputSchema: z.object({ message: z.string() }),
    userMessage: (input: { message: string }) => input.message,
    block: handler({
      name: "fixture-door",
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.object({ heard: z.string() }),
      execute: (input, ctx) => {
        ctx.emit.message(`Heard: ${input.message}`);
        return { heard: input.message };
      },
    }),
  },
};

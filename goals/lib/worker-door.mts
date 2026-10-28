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
 *
 * Every worker flow on an installation also hears other workers' messages, and
 * the hire refuses one that can't. A fixture flow spreads {@link hearsMessages}
 * into `defineFlow`.
 */
import { handler } from "@flow-state-dev/core";
import { MESSAGE_RECEIVED_ENTRY, messageReceivedEntry, workerMessagesResources, type WorkerInstallation } from "@flow-state-dev/workforce";
import { z } from "zod";

/** One door, `respond`, the action every worker flow takes a user's message on. */
export const workerDoor = {
  respond: {
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

/**
 * The `resources` and `internal` a fixture worker flow spreads into `defineFlow`
 * so the hire accepts it. No turn: a message lands as its items and nothing runs.
 *
 * @param installation The installation whose workers run on the flow.
 * @param flowKind The flow's kind.
 * @param resources Resources the flow already declares. Defaults to the installation's.
 */
export function hearsMessages(installation: WorkerInstallation, flowKind: string, resources: object = installation.resources) {
  return {
    resources: { ...resources, ...workerMessagesResources },
    internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind }) } },
  };
}

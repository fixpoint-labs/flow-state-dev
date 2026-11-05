/**
 * The `pins` flow: the threads you pinned (FIX-2157 D4). Pinning is your
 * choice, not a task's state, so it is kept in your own user state as task
 * ids, never on the task row. The board reads it to put a pinned thread under
 * *Pinned*; a pin outlives the thread's status.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

/** The flow kind the screen reads and writes pins through. */
export const PINS_FLOW = "pins";

const pinsSchema = z.object({ pinned: z.array(z.string()) });
const pinsUserStateSchema = z.object({ pinned: z.array(z.string()).default([]) });

/**
 * Your pins as stored. The engine doesn't apply the schema's `.default([])` to
 * stored user state, so a user who has never pinned has no `pinned` yet.
 */
const pinnedOf = (state: { pinned?: string[] }): string[] => state.pinned ?? [];

/** A handler that changes your pins by `change` and answers them. */
const pinsBlock = (name: string, change: (pinned: string[], taskId: string) => string[]) =>
  handler({
    name,
    inputSchema: z.object({ taskId: z.string().min(1) }),
    outputSchema: pinsSchema,
    userStateSchema: pinsUserStateSchema,
    execute: async (input, ctx) => {
      const pinned = change(pinnedOf(ctx.user.state), input.taskId);
      await ctx.user.patchState({ pinned });
      return { pinned };
    },
  });

/** Build the flow: list (a read), pin and unpin, over your user state. */
export function definePinsFlow() {
  return defineFlow({
    kind: PINS_FLOW,
    user: { stateSchema: pinsUserStateSchema },
    // A read, not an action: the screen reads your pins whenever they change, and a read stores no request.
    reads: {
      listPins: {
        block: handler({
          name: "listPins",
          inputSchema: z.object({}),
          outputSchema: pinsSchema,
          userStateSchema: pinsUserStateSchema,
          execute: async (_input, ctx) => ({ pinned: pinnedOf(ctx.user.state) }),
        }),
      },
    },
    actions: {
      pin: { block: pinsBlock("pin", (pinned, id) => (pinned.includes(id) ? pinned : [...pinned, id])) },
      unpin: { block: pinsBlock("unpin", (pinned, id) => pinned.filter((p) => p !== id)) },
    },
  });
}

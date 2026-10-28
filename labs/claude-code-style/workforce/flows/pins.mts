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
const pinnedOf = (ctx: { user: { state: unknown } }) => (ctx.user.state as { pinned?: string[] }).pinned ?? [];

/** A handler that changes your pins by `change` and answers them. */
const pinsBlock = (name: string, change: (pinned: string[], taskId: string) => string[]) =>
  handler({
    name,
    inputSchema: z.object({ taskId: z.string().min(1) }),
    outputSchema: pinsSchema,
    execute: async (input, ctx) => {
      const pinned = change(pinnedOf(ctx), input.taskId);
      await ctx.user.patchState({ pinned });
      return { pinned };
    },
  });

/** Build the flow: list, pin and unpin, over your user state. */
export function definePinsFlow() {
  const taskInput = z.object({ taskId: z.string().min(1) });
  return defineFlow({
    kind: PINS_FLOW,
    user: { stateSchema: z.object({ pinned: z.array(z.string()).default([]) }) },
    actions: {
      listPins: {
        inputSchema: z.object({}),
        block: handler({
          name: "listPins",
          inputSchema: z.object({}),
          outputSchema: pinsSchema,
          execute: async (_input, ctx) => ({ pinned: pinnedOf(ctx) }),
        }),
      },
      pin: { inputSchema: taskInput, block: pinsBlock("pin", (pinned, id) => (pinned.includes(id) ? pinned : [...pinned, id])) },
      unpin: { inputSchema: taskInput, block: pinsBlock("unpin", (pinned, id) => pinned.filter((p) => p !== id)) },
    },
  } as never);
}

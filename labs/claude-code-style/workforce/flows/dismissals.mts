/**
 * The `dismissals` flow: the failed threads you dismissed. A failure waits on
 * you until you retry or dismiss it; dismissing is your choice, not the task's
 * state, so like a pin it is kept in your own user state, never on the task
 * row. Each entry is a task id and attempt (`dismissalKey`), so a retry that
 * fails again waits on you again.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { userMarksSchema } from "./user-marks.mts";

/** The flow kind the screen reads and writes dismissals through. */
export const DISMISSALS_FLOW = "dismissals";

const dismissedSchema = z.object({ dismissed: z.array(z.string()) });
const dismissalsUserStateSchema = userMarksSchema;

/** Build the flow: list (a read) and dismiss, over your user state. */
export function defineDismissalsFlow() {
  return defineFlow({
    kind: DISMISSALS_FLOW,
    user: { stateSchema: dismissalsUserStateSchema },
    // A read, not an action: the screen reads your dismissals whenever they change, and a read stores no request.
    reads: {
      listDismissed: {
        block: handler({
          name: "listDismissed",
          inputSchema: z.object({}),
          outputSchema: dismissedSchema,
          userStateSchema: dismissalsUserStateSchema,
          execute: async (_input, ctx) => ({ dismissed: ctx.user.state.dismissed }),
        }),
      },
    },
    actions: {
      dismiss: {
        inputSchema: z.object({ key: z.string().min(1) }),
        block: handler({
          name: "dismiss",
          inputSchema: z.object({ key: z.string().min(1) }),
          outputSchema: dismissedSchema,
          userStateSchema: dismissalsUserStateSchema,
          execute: async (input, ctx) => {
            const { dismissed: was } = ctx.user.state;
            const dismissed = was.includes(input.key) ? was : [...was, input.key];
            await ctx.user.patchState({ dismissed });
            return { dismissed };
          },
        }),
      },
    },
  } as never);
}

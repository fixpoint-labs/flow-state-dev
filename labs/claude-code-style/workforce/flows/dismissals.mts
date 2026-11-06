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

/** The task id a `dismissalKey` (`<task id>#<attempt>`) names. */
const taskOfKey = (key: string) => key.slice(0, key.lastIndexOf("#") === -1 ? key.length : key.lastIndexOf("#"));

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
          // The key alone: an action's return is recorded on its request, and the list only grows.
          outputSchema: z.object({ key: z.string() }),
          userStateSchema: dismissalsUserStateSchema,
          execute: async (input, ctx) => {
            // One key per task: a newer attempt's dismissal replaces the older one's. The updater
            // form recomputes against the stored list, so two tabs dismissing at once both land.
            const task = taskOfKey(input.key);
            await ctx.user.patchState("dismissed", (dismissed) => [...dismissed.filter((key) => taskOfKey(key) !== task), input.key]);
            return { key: input.key };
          },
        }),
      },
    },
  } as never);
}

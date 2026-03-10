/**
 * Test fixture: a flow with session state to test --session and --seed-session.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const sessionStateSchema = z.object({
  count: z.number().default(0),
});

const counterHandler = handler({
  name: "counter-handler",
  inputSchema: z.object({ increment: z.number().default(1) }),
  outputSchema: z.object({ count: z.number() }),
  sessionStateSchema,
  execute: async (input, ctx) => {
    const current = ctx.session.state.count ?? 0;
    const next = current + input.increment;
    await ctx.session.patchState({ count: next });
    return { count: next };
  },
});

const statefulFlow = defineFlow({
  kind: "stateful",
  actions: {
    increment: {
      inputSchema: z.object({ increment: z.number().default(1) }),
      block: counterHandler,
    },
  },
  session: {
    stateSchema: sessionStateSchema,
  },
});

const flow = statefulFlow({ id: "default" });

export default flow;

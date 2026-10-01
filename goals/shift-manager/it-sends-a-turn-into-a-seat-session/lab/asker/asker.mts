/**
 * The goal's fixture seat kind: a seat that asks a person, and a door that
 * hears them.
 *
 * - `ask`, durable: suspends on the framework's stock `human_approval`, so
 *   Inbox lists it.
 * - `message`, the door: a person's line into the seat's session. The engine
 *   stores the line as a user item before the step runs; the step then says
 *   what it heard, as an item of its own, so the check can see the line was
 *   taken by the seat and not only written down.
 *
 * No model. A test fixture, not a Lab: Shift Manager names nothing in it.
 */
import { defineFlow, handler, sequencer, SuspensionRejectedError } from "@flow-state-dev/core";
import { workerConfigSchema } from "@flow-state-dev/workforce";
import { z } from "zod";

/** The kind the fixture's `WORKER.md` names. */
export const ASKER_KIND = "asker";

/** How the seat says what it heard. The check looks for this line. */
export const heardLine = (message: string) => `Heard: ${message}`;

const askSchema = z.object({ what: z.string().min(1) });
const messageSchema = z.object({ message: z.string() });

const hear = handler({
  name: "turn-goal-asker-hear",
  inputSchema: messageSchema,
  outputSchema: z.object({ heard: z.string() }),
  execute: (input, ctx) => {
    ctx.emit.message(heardLine(input.message));
    return { heard: input.message };
  },
});

const gate = handler({
  name: "turn-goal-asker-gate",
  inputSchema: askSchema,
  outputSchema: z.object({ what: z.string(), approved: z.boolean() }),
  execute: async (input, ctx) => {
    try {
      await ctx.suspend!({ reason: "human_approval", message: `Approve: ${input.what}` });
      return { what: input.what, approved: true };
    } catch (error) {
      if (error instanceof SuspensionRejectedError) return { what: input.what, approved: false };
      throw error;
    }
  },
});

/** The kind `hireWorkforce` mints one copy of per `asker` record. */
export function defineAskerFlow() {
  return defineFlow({
    kind: ASKER_KIND,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    actions: {
      ask: { block: sequencer({ name: "turn-goal-asker-ask", inputSchema: askSchema }).step(gate), durable: true },
      message: {
        block: hear,
        inputSchema: messageSchema,
        userMessage: (input: { message: string }) => input.message,
        description: "A person's line into this seat's session.",
      },
    },
  } as never);
}

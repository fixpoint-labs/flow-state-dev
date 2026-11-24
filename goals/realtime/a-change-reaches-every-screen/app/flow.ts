/**
 * The fixture app's one flow (FIX-2368): a board two people in one org watch.
 *
 * Plain app code. Org state (`plan`), an org collection (`seats`) and a chat
 * reply that writes nothing but its items and status. Nothing here names a
 * bus, a push option or a poll interval: what the run grades is the default.
 * The same file runs on today's `main` and on the control commit; the runner
 * prints its hash.
 */
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";

/** The org's seats: a row per seat, readable by every member of the org. */
export const seats = defineResourceCollection({
  pattern: "seats/*",
  scope: "org",
  stateSchema: z.object({ name: z.string().default("") }),
  client: { state: { read: true } }
});

const value = z.object({ value: z.string() });

/** The board flow: `setPlan` patches org state, `addSeat` adds an org row, `say` replies. */
export const boardFlow = defineFlow({
  kind: "board",
  resources: { seats },
  org: {
    stateSchema: z.object({ plan: z.string().default("free") }),
    client: { expose: ["plan"] }
  },
  actions: {
    setPlan: {
      inputSchema: value,
      block: handler({
        name: "set-plan",
        inputSchema: value,
        outputSchema: z.object({}),
        execute: async ({ value }, ctx) => {
          if (ctx.org === undefined) throw new Error("setPlan needs a signed-in org");
          await ctx.org.patchState({ plan: value });
          return {};
        }
      })
    },
    addSeat: {
      inputSchema: value,
      block: handler({
        name: "add-seat",
        inputSchema: value,
        outputSchema: z.object({}),
        resources: { seats },
        execute: async ({ value }, ctx) => {
          await ctx.resources.seats.create(value, { name: value });
          return {};
        }
      })
    },
    // A plain reply: items and a status, no resource, state or task.
    say: {
      inputSchema: value,
      block: handler({
        name: "say",
        inputSchema: value,
        outputSchema: z.object({}),
        execute: async ({ value }, ctx) => {
          ctx.emit.message(value);
          return {};
        }
      })
    }
  }
});

/**
 * Test fixture: a flow whose sessions are each created bound to a worker, in a
 * readonly state field, to test `fsdev run --seed-session` against a create
 * check, a readonly field and a server-owned one.
 *
 * The check accepts a `workerId` starting `ok-`.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const sessionStateSchema = z.object({
  workerId: z.string().readonly(),
  granted: z.array(z.string()).default([]),
  note: z.string().optional(),
});

const boundFlow = defineFlow({
  kind: "bound",
  actions: {
    who: {
      inputSchema: z.object({}),
      block: handler({
        name: "bound-who",
        inputSchema: z.object({}),
        outputSchema: z.object({ workerId: z.string().nullable() }),
        execute: async (_input, ctx) => ({
          workerId: (ctx.session.state as { workerId?: string }).workerId ?? null,
        }),
      }),
    },
  },
  session: {
    stateSchema: sessionStateSchema,
    serverOwned: ["granted"],
    createCheck: ({ state }) =>
      typeof state.workerId === "string" && state.workerId.startsWith("ok-")
        ? { ok: true }
        : { ok: false, message: "Name a worker this flow knows." },
  },
});

const flow = boundFlow();

export default flow;

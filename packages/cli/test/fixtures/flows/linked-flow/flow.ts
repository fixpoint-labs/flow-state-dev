/**
 * Test fixture: a flow whose sessions are each created with a link, to test
 * `--worker` and the refusal of a seeded server-owned field.
 *
 * The check accepts a link starting `ok-`; an accepted link is stored as sent.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const linkedFlow = defineFlow({
  kind: "linked",
  actions: {
    who: {
      inputSchema: z.object({}),
      block: handler({
        name: "linked-who",
        inputSchema: z.object({}),
        outputSchema: z.object({ link: z.string().nullable() }),
        execute: async (_input, ctx) => ({ link: ctx.session.link ?? null }),
      }),
    },
  },
  session: {
    stateSchema: z.object({ granted: z.array(z.string()).default([]), note: z.string().optional() }),
    serverOwned: ["granted"],
    createCheck: ({ link }) =>
      link !== undefined && link.startsWith("ok-")
        ? { ok: true }
        : { ok: false, message: "Name a worker to create this session." },
  },
});

const flow = linkedFlow();

export default flow;

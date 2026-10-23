/**
 * Test fixture: a flow that stops for a person. A step that counts its runs,
 * an approval stop, then a step that answers. Used by the `fsdev run` local
 * store tests (FIX-2063).
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

/** How many times the step before the stop ran, in this process. */
export const runs = { before: 0 };

const draft = handler({
  name: "review-draft",
  inputSchema: z.object({ title: z.string() }),
  outputSchema: z.object({ title: z.string() }),
  execute: async (input) => {
    runs.before += 1;
    return input;
  },
});

const approve = handler({
  name: "review-approve",
  inputSchema: z.object({ title: z.string() }),
  outputSchema: z.object({ title: z.string() }),
  execute: async (input, ctx) => {
    await ctx.suspend!({ reason: "human_approval", message: `Publish "${input.title}"?` });
    return input;
  },
});

const publish = handler({
  name: "review-publish",
  inputSchema: z.object({ title: z.string() }),
  outputSchema: z.object({ published: z.string() }),
  execute: async (input) => ({ published: input.title }),
});

export default defineFlow({
  kind: "review",
  actions: {
    submit: {
      inputSchema: z.object({ title: z.string() }),
      block: sequencer({ name: "review-seq" }).step(draft).step(approve).step(publish),
    },
  },
})();

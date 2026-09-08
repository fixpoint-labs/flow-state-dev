/**
 * One collection definition, instantiated twice by the goal. Each instance
 * writes the marker it was created with into session state, so a later read
 * says which copy actually ran.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

export const REVIEW_KIND = "review";

const inputSchema = z.object({});

export const reviewDefinition = defineFlow({
  kind: REVIEW_KIND,
  cardinality: "collection",
  actions: {
    run: {
      inputSchema,
      block: handler({ name: "review-run", inputSchema, execute: () => ({}) }),
    },
  },
  session: {
    stateSchema: z.object({ marker: z.string().nullable().default(null) }),
  },
});

/** A registered copy of `review` that records `marker` on every run. */
export function reviewInstance(id: string, marker: string) {
  return reviewDefinition({
    id,
    actions: {
      run: {
        inputSchema,
        block: handler({
          name: `review-run-${id}`,
          inputSchema,
          outputSchema: z.object({ marker: z.string() }),
          execute: async (_input, ctx) => {
            await ctx.session.patchState({ marker });
            return { marker };
          },
        }),
      },
    },
  });
}

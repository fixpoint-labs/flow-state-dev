/**
 * A ticket collection with index-time facets: `write`, `search`, `reindex`.
 *
 * `defineFacetedCollection` defines the collection and classifies each
 * ticket's body once, when it is written, with the evaluator the flow is
 * given. Its search filters the stored answers and makes no model call. The
 * flow never names a model: the app builds the evaluator where it configures
 * models and passes it in.
 */
import { defineFacetedCollection, defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import type { TicketEvaluator } from "./facets";

/** Build the ticket flow around the app's evaluator block. */
export function ticketsFlow(triage: TicketEvaluator) {
  const tickets = defineFacetedCollection({
    name: "tickets",
    pattern: "tickets/*",
    scope: "user",
    stateSchema: z.object({ title: z.string() }), // facets and indexedAs are added
    evaluator: triage,
  });

  const write = handler({
    name: "write-ticket",
    inputSchema: z.object({
      key: z.string().min(1),
      title: z.string().optional(),
      body: z.string().optional(),
    }),
    outputSchema: z.object({ key: z.string() }),
    resources: { tickets: tickets.collection },
    execute: async (input, ctx) => {
      const existing = await ctx.resources.tickets.getOptional(input.key);
      const ref =
        existing ?? (await ctx.resources.tickets.create(input.key, { title: input.title ?? input.key }));
      if (existing !== undefined && input.title !== undefined) {
        await ref.patchState({ title: input.title });
      }
      // The body write is what classifies the ticket.
      if (input.body !== undefined) await ref.writeContent(input.body);
      return { key: input.key };
    },
  });

  return defineFlow({
    kind: "index-time-facets",
    requireUser: true,
    resources: tickets.resources,
    actions: {
      write: { block: write },
      search: { block: tickets.search }, // { topic?, status?, minConfidence? } → { keys }
      reindex: { block: tickets.reindex }, // { force? } → { reindexed }
    },
  })();
}

/**
 * A ticket collection with index-time facets: `write`, `search`, `reindex`.
 *
 * Each ticket's body is classified once, when it is written, by the evaluator
 * the flow is given (see `index-facets.ts`). Searching filters the stored
 * answers and makes no model call. The flow never names a model: the app
 * builds the evaluator where it configures models and passes it in.
 */
import {
  defineFlow,
  defineResourceCollection,
  handler,
  sequencer,
  type ResourceContentChange,
} from "@flow-state-dev/core";
import { z } from "zod";
import {
  facetQuerySchema,
  matchesFacets,
  ticketStateSchema,
  type TicketEvaluator,
} from "./facets";
import { indexFacets } from "./index-facets";

const PREFIX = "tickets/";

/** Build the ticket flow around the app's evaluator block. */
export function ticketsFlow(triage: TicketEvaluator) {
  // No `client` config: content edited straight from a client runs no
  // reaction, so this collection doesn't allow it. Every body write goes
  // through a flow turn and gets classified.
  const tickets = defineResourceCollection({
    pattern: "tickets/*",
    scope: "user",
    stateSchema: ticketStateSchema, // title, facets (null until classified), indexedAs
    reactTo: { contentUpdated: indexFacets(triage) },
  });

  const write = handler({
    name: "write-ticket",
    inputSchema: z.object({
      key: z.string().min(1),
      title: z.string().optional(),
      body: z.string().optional(),
    }),
    outputSchema: z.object({ key: z.string() }),
    resources: { tickets },
    execute: async (input, ctx) => {
      const existing = await ctx.resources.tickets.getOptional(input.key);
      const ref =
        existing ?? (await ctx.resources.tickets.create(input.key, { title: input.title ?? input.key }));
      if (existing !== undefined && input.title !== undefined) {
        await ref.patchState({ title: input.title });
      }
      // The body write fires the collection's contentUpdated reaction.
      if (input.body !== undefined) await ref.writeContent(input.body);
      return { key: input.key };
    },
  });

  /**
   * The facet search. Offer this block to an agent as a tool, too. Keep it
   * registered as a flow action as well: resources declared only on a
   * generator's tool don't register with the flow.
   */
  const search = handler({
    name: "search-tickets",
    description:
      "Find support tickets by topic and status. Filters stored classifications; makes no model call.",
    inputSchema: facetQuerySchema,
    outputSchema: z.object({ keys: z.array(z.string()) }),
    resources: { tickets },
    execute: async (query, ctx) => {
      const all = await ctx.resources.tickets.list();
      const keys = all
        .filter((t) => matchesFacets(t.state.facets, query))
        .map((t) => t.path.slice(PREFIX.length));
      return { keys };
    },
  });

  const selectForReindex = handler({
    name: "select-for-reindex",
    inputSchema: z.object({ force: z.boolean().optional() }),
    resources: { tickets },
    execute: async (input, ctx): Promise<ResourceContentChange[]> => {
      const all = await ctx.resources.tickets.list();
      return all
        // `== null` also picks up tickets stored before `facets` existed.
        .filter((t) => input.force === true || t.state.facets == null)
        .map((t) => ({ key: t.path.slice(PREFIX.length), ref: t.path, kind: "contentUpdated" as const }));
    },
  });

  // Reindex runs the same reaction a body write does, once per selected
  // ticket: documents from before facets existed, failed classifications, or
  // everything after the questions change (`force`).
  const reindex = sequencer({
    name: "reindex-tickets",
    inputSchema: z.object({ force: z.boolean().optional() }),
  })
    .step(selectForReindex)
    .forEach(indexFacets(triage))
    .step(
      handler({
        name: "reindex-summary",
        inputSchema: z.array(z.object({ key: z.string(), body: z.string() })),
        outputSchema: z.object({ reindexed: z.array(z.string()) }),
        execute: async (stamps: Array<{ key: string; body: string }>) => ({
          reindexed: stamps.filter((s) => s.body.trim().length > 0).map((s) => s.key),
        }),
      }),
    );

  return defineFlow({
    kind: "index-time-facets",
    requireUser: true,
    actions: {
      write: { block: write },
      search: { block: search },
      reindex: { block: reindex },
    },
  })();
}

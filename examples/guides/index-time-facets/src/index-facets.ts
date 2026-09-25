/**
 * The reaction that turns a body write into stored facets.
 *
 * Bound to the ticket collection's `reactTo.contentUpdated`, so every
 * server-side body write (an action, a tool, an agent's content write) indexes
 * the same way. Three rules, each needed:
 *
 * 1. Clear first. The blocking step clears `facets` and stamps a fresh
 *    `indexedAs` token in one state write, before the body is read. If the
 *    classification then fails, the ticket has no facets, never stale ones.
 * 2. Classify on a side chain. A failed or refused model call shows in the
 *    trace and does not fail the write. The side chain drains before the turn
 *    ends, so the next turn's search sees the facets.
 * 3. Store only answers about the current body. The answers are written with
 *    `updateState`, whose updater runs against the stored row and re-runs on a
 *    version conflict, so the token check and the write commit together. A
 *    classification of a body that has since been rewritten is discarded.
 *
 * Storing facets is a state write, so it never fires `contentUpdated` again.
 */
import { handler, resourceContentChangeSchema, sequencer } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TicketEvaluator, TicketFacets, TicketState } from "./facets";

/**
 * The collection, read through `ctx.resources` and typed from its schema.
 *
 * These blocks are the one place the collection can't be declared with
 * `resources: { tickets }`: the collection's `reactTo` needs these blocks to
 * exist when it is defined, so they can't also need the collection. Every
 * other block in the example declares it.
 */
function ticketsOf(ctx: { resources: unknown }): ResourceCollectionRef<TicketState> {
  return (ctx.resources as { tickets: ResourceCollectionRef<TicketState> }).tickets;
}

const stamped = z.object({ key: z.string(), token: z.string(), body: z.string() });

/** Blocking: clear the facets and stamp a fresh token, then read the body. */
const clearAndStamp = handler({
  name: "clear-facets-and-stamp",
  inputSchema: resourceContentChangeSchema(),
  outputSchema: stamped,
  execute: async (change, ctx) => {
    const ref = await ticketsOf(ctx).get(change.key);
    const token = randomUUID();
    await ref.patchState({ facets: null, indexedAs: token });
    // Read after the token is written: whichever reaction holds the current
    // token also read the newest body.
    const body = (await ref.readContent()) ?? "";
    return { key: change.key, token, body };
  },
});

/** Store the answers only if this classification's token is still current. */
const storeIfCurrent = handler({
  name: "store-facets-if-current",
  inputSchema: z.object({ answers: z.record(z.string(), z.unknown()) }),
  parentInputSchema: stamped,
  execute: async ({ answers }, ctx) => {
    const { key, token } = ctx.parent!.input;
    const ref = await ticketsOf(ctx).getOptional(key);
    if (ref === undefined) return;
    await ref.updateState((state) =>
      state.indexedAs === token ? { ...state, facets: answers as TicketFacets } : state,
    );
  },
});

/**
 * Build the `contentUpdated` reaction for a ticket collection registered
 * under the resource name `tickets`.
 *
 * @param triage - The app's evaluator. It is called once per body write, with
 *   the body as its input.
 */
export function indexFacets(triage: TicketEvaluator) {
  const classify = sequencer({ name: "classify-ticket", inputSchema: stamped })
    .step((stamp) => stamp.body, triage)
    .step(storeIfCurrent);

  return sequencer({ name: "index-facets", inputSchema: resourceContentChangeSchema() })
    .step(clearAndStamp)
    .sideChainIf((stamp) => stamp.body.trim().length > 0, classify);
}
